import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSequence, confidence, formatAnswer, questionFromForm, renderOptions, temperatureBucket, toInternal } from '../site/assets/laya-core.mjs';
import { pins, totalBytes } from '../site/assets/laya-browser.mjs';

// A stand-in tokenizer: one id per whitespace-separated word, so layouts can be checked by hand.
const vocab = new Map();
const encode = text => text.split(/\s+/).filter(Boolean).map(word => { if (!vocab.has(word)) vocab.set(word, 100 + vocab.size); return vocab.get(word); });
const special = { cls: 1, sep: 2, mask: 3 };

test('options render as in rl_common.render_options', () => {
  assert.deepEqual(renderOptions(toInternal({ type: 'choice', instructions: 'Team?', criteria: { bug: 'Something is broken', sales: null } })), ['bug: Something is broken', 'sales']);
  assert.deepEqual(renderOptions(toInternal({ type: 'choice', instructions: 'Team?', criteria: ['a', 'b'] })), ['a', 'b']);
  assert.deepEqual(renderOptions(toInternal({ type: 'score', instructions: 'How?', criteria: ['low', 'high'] })), ['level 0: low', 'level 1: high']);
  assert.deepEqual(renderOptions(toInternal({ type: 'noul', instructions: 'True?' })), ['false: no, the statement does not hold', 'true: yes, the statement holds']);
});

test('sequence layout: [CLS] head [SEP] [MASK] option ... [SEP] state [SEP]', () => {
  const q = toInternal({ type: 'choice', instructions: 'pick [MASK] one', criteria: { a: null, b: 'bee' } });
  const { ids, markers } = buildSequence(encode, special, 'the state', q, 64, 32);
  const words = ['choice', 'question:', 'pick', 'one'].map(w => vocab.get(w));
  assert.deepEqual(ids.slice(0, 6), [1, ...words, 2]);
  assert.deepEqual(markers, [6, 8]);
  assert.equal(ids[6], 3); assert.equal(ids[8], 3);
  assert.deepEqual(ids.slice(-4), [2, vocab.get('the'), vocab.get('state'), 2]);
  assert(!ids.slice(1).includes(1));
});

test('state is truncated to the remaining room and the total never exceeds max_len', () => {
  const q = toInternal({ type: 'noul', instructions: 'x' });
  const { ids, markers } = buildSequence(encode, special, Array.from({ length: 200 }, (_, i) => 'w' + i).join(' '), q, 40, 24);
  assert.equal(ids.length, 40);
  assert.equal(ids.at(-1), 2);
  assert.equal(markers.length, 2);
});

test('temperature buckets and calibrated answers follow rl_agent_api.system_one', () => {
  assert.equal(temperatureBucket(0, 2), 'choice:2');
  assert.equal(temperatureBucket(1, 4), 'score:3-5');
  assert.equal(temperatureBucket(0, 12), 'choice:11+');
  const cfg = { temperature: [1, 1, 1], temperature_by_options: { 'choice:2': 2 } };
  const choice = formatAnswer(toInternal({ type: 'choice', instructions: 'x', criteria: ['a', 'b'] }), [2, 0], cfg);
  assert.equal(choice.choice, 'a');
  assert.equal(choice.probabilities.a, Math.round(1 / (1 + Math.exp(-1)) * 1e4) / 1e4);
  const score = formatAnswer(toInternal({ type: 'score', instructions: 'x', criteria: ['l', 'm', 'h'] }), [0, 0, 0], cfg);
  assert.equal(score.score, 1);
  assert.equal(score.confidence, 0);
  assert.equal(formatAnswer(toInternal({ type: 'noul', instructions: 'x' }), [0, 0], cfg).noul, 0.5);
  assert.equal(confidence([1, 0]), 1);
});

test('form input becomes a typed question or a readable error', () => {
  assert.deepEqual(questionFromForm({ type: 'choice', instructions: ' Team? ', options: 'bug: broken\n\nsales' }).question, { type: 'choice', instructions: 'Team?', criteria: { bug: 'broken', sales: null } });
  assert.deepEqual(questionFromForm({ type: 'score', instructions: 'How?', options: 'low\nhigh' }).question.criteria, ['low', 'high']);
  assert.deepEqual(questionFromForm({ type: 'noul', instructions: 'True?', options: 'ignored' }).question, { type: 'noul', instructions: 'True?' });
  assert.match(questionFromForm({ type: 'choice', instructions: 'x', options: 'one' }).error, /two options/);
  assert.match(questionFromForm({ type: 'choice', instructions: 'x', options: 'a\na' }).error, /twice/);
  assert.match(questionFromForm({ type: 'choice', instructions: '', options: 'a\nb' }).error, /question/);
});

test('every download is pinned to an immutable address and a hash', () => {
  const recorded = JSON.parse(readFileSync('research/laya-browser/pins.json', 'utf8'));
  const files = [...Object.values(pins.runtime), ...Object.values(pins.source), pins.model.graph];
  for (const file of files) {
    assert(file.sha256 ? /^[0-9a-f]{64}$/.test(file.sha256) : /^[A-Za-z0-9+/]{64}$/.test(file.sha384), file.url);
    assert(Number.isInteger(file.size) && file.size > 0);
  }
  for (const file of Object.values(pins.runtime)) assert.match(file.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[\w-]+\/)?[\w-]+@\d+\.\d+\.\d+\/dist\/[\w.-]+$/);
  for (const file of Object.values(pins.source)) assert(file.url.startsWith(`https://huggingface.co/${recorded.source.repo}/resolve/${recorded.source.revision}/${recorded.source.subfolder}/`), file.url);
  const weights = `https://huggingface.co/${recorded.browserBuild.repo}/resolve/${recorded.browserBuild.revision}/`;
  assert(pins.model.graph.url.startsWith(weights));
  assert(pins.model.data.parts.every(part => part.startsWith(weights)));
  assert.equal(pins.model.data.parts.length, Math.ceil(pins.model.data.size / pins.model.data.partBytes));
  assert.match(pins.model.data.sha256, /^[0-9a-f]{64}$/);
  const provenance = JSON.parse(readFileSync('research/laya-browser/provenance-2026-09-24.json', 'utf8'));
  assert.equal(provenance.hosted.data, pins.model.data.sha256);
  assert.equal(provenance.hosted.graph, pins.model.graph.sha256);
  assert.equal(provenance.hosted.revision, recorded.browserBuild.revision);
  assert.equal(provenance.sameSource, true);
  assert.equal(totalBytes(), 463725456);
});

test('the page states the size and the privacy boundary before any download', () => {
  const html = readFileSync('site/projects/laya-browser/index.html', 'utf8');
  assert.match(html, /Runs on your device\. Nothing you type is sent anywhere\./);
  assert.match(html, /id="laya-load"[^>]*>Download the model \(<span id="laya-size">442 MiB<\/span>\)/);
  assert.equal((totalBytes() / 1048576).toFixed(0), '442');
  // No third-party resource is referenced by the markup itself; downloads start only from the button handler.
  const loaded = [...html.matchAll(/<(?:script|img)\b[^>]*\bsrc="([^"]+)"|<link\b(?![^>]*rel="canonical")[^>]*\bhref="([^"]+)"/g)].map(m => m[1] || m[2]);
  assert(loaded.length > 0);
  for (const link of loaded) assert(!/^(https?:)?\/\//.test(link), 'external resource in markup: ' + link);
});
