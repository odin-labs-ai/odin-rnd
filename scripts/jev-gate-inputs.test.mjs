// EXP 005 WO-06: the gate inputs are the pinned construction, carry no labels, and fit Laya uncut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildInputs, buildState, cutReasons, NEGATIVE_CONTROL_ID, OPTION_CAP, tokenizerAvailable } from '../experiments/jev-gate/gate-input.mjs';
import { lintConfig, lintText } from '../experiments/jev-gate/lint.mjs';

const dir = new URL('../experiments/jev-gate/', import.meta.url).pathname;
const read = rel => readFileSync(join(dir, rel), 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const inputsText = read('inputs.json');
const inputs = JSON.parse(inputsText);
const limits = { maxLen: inputs.tokenizer.maxLen, headMaxLen: inputs.tokenizer.headMaxLen };

test('inputs.sha256 pins inputs.json', () => {
  assert.equal(read('inputs.sha256'), `${sha256(inputsText)}  inputs.json\n`);
});

test('the question is stored once, verbatim, and referenced by hash', () => {
  assert.equal(read('gate-question.json'), '{\n  "type": "noul",\n  "instructions": "Does this change break any of these rules?"\n}\n');
  assert.deepEqual(inputs.question, { file: 'gate-question.json', sha256: sha256(read('gate-question.json')) });
  assert.equal(inputs.rules.sha256, sha256(read('rules.txt')));
  assert.ok(!inputsText.includes('Does this change break'), 'the question text lives only in gate-question.json');
});

test('every state is rules.txt + blank line + the patch, and carries no labels', () => {
  const rules = read('rules.txt');
  const ids = JSON.parse(read('labels.json')).items.map(i => i.id);
  assert.deepEqual(inputs.items.map(i => i.id), ids);
  assert.equal(inputs.stateConstruction, 'state = rules.txt + "\\n\\n" + diff');
  for (const item of inputs.items) {
    const diff = read(`corpus/${item.id}.patch`);
    assert.deepEqual(Object.keys(item).sort(), ['id', 'patchSha256', 'state', 'stateSha256', 'stateTokens', 'totalTokens', 'truncated']);
    assert.equal(item.state, buildState(rules, diff));
    assert.equal(item.patchSha256, sha256(diff));
    assert.equal(item.stateSha256, sha256(item.state));
  }
  for (const word of ['"label"', '"intended"', '"family"', '"RED"', '"GREEN"']) assert.ok(!inputsText.includes(word), `inputs.json must not contain ${word}`);
  const cfg = lintConfig();
  assert.deepEqual(inputs.items.flatMap(i => lintText(i.state, 'state:' + i.id, cfg)), []);
});

test('pre-cut counts: no state, head or option is cut; truncation is 0', () => {
  assert.deepEqual(limits, { maxLen: 1024, headMaxLen: 256 });
  const h = inputs.head;
  assert.ok(h.optionTokens.every(n => n <= OPTION_CAP) && h.headBudget >= 16 && h.headTokens <= h.headBudget && h.headTokens <= 256);
  for (const item of inputs.items) {
    const c = { ...h, stateTokens: item.stateTokens, totalTokens: item.totalTokens };
    assert.deepEqual(cutReasons(c, limits), [], item.id);
    assert.equal(item.truncated, false);
    assert.equal(item.totalTokens, 1 + h.headTokens + 1 + h.optionTokens.reduce((a, n) => a + n + 1, 0) + 1 + item.stateTokens + 1);
  }
  assert.equal(inputs.stats.truncated, 0);
  assert.ok(inputs.stats.maxStateTokens <= h.room && inputs.stats.maxTotalTokens <= 1024);
});

test('negative control: the planted too-long input was refused, and the Node check refuses it too', () => {
  const neg = inputs.negativeControl;
  assert.equal(neg.id, NEGATIVE_CONTROL_ID);
  assert.equal(neg.refused, true);
  assert.ok(neg.stateTokens > neg.room);
  const c = { ...inputs.head, stateTokens: neg.stateTokens, totalTokens: 1024 + 1 };
  assert.ok(cutReasons(c, limits).some(r => r.startsWith('state')));
  assert.ok(cutReasons({ ...inputs.head, optionTokens: [49, 7], stateTokens: 1, totalTokens: 100 }, limits).some(r => r.startsWith('option')));
  assert.ok(cutReasons({ ...inputs.head, headTokens: 300, stateTokens: 1, totalTokens: 400 }, limits).some(r => r.startsWith('question head')));
});

test('with the Laya tokenizer present, inputs.json rebuilds byte for byte (runs the real negative control)', { skip: tokenizerAvailable() ? false : 'Laya tokenizer not installed here (see experiments/jev-gate/README.md)' }, () => {
  assert.equal(JSON.stringify(buildInputs(), null, 2) + '\n', inputsText);
});
