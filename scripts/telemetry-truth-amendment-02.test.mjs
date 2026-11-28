import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { outputs } from '../experiments/telemetry-truth/amendment-02/analyse-anon.mjs';

const dir = 'experiments/telemetry-truth';
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const amendment = JSON.parse(readFileSync(`${dir}/amendment-02/amendment.json`, 'utf8'));

test('EXP 015 amendment 02 is pinned, and copies amendment-01\'s decision.rule verbatim', () => {
  assert.equal(readFileSync(`${dir}/amendment-02/amendment.sha256`, 'utf8').trim().split(/\s+/)[0], sha(`${dir}/amendment-02/amendment.json`));
  const prereg = JSON.parse(readFileSync(`${dir}/preregistration.json`, 'utf8'));
  assert.deepEqual(amendment.decision.rule, prereg.decision.rule, 'copied verbatim, not reinvented');
  assert.equal(amendment.amendment.number, 2);
  assert.equal(amendment.amendment.amends, 'EXP 015');
});

test('amendment-02\'s window is the second untouched week after EXP 015\'s own, not overlapping either', () => {
  const from = Date.parse(amendment.window.from), to = Date.parse(amendment.window.to);
  assert.equal(to - from, 7 * 86400e3, 'seven whole UTC days');
  assert.ok(from >= Date.parse('2026-11-11T00:00:00Z'), 'does not overlap EXP 015\'s own window or the first untouched week');
});

test('no capture row names a broker; the published rows carry only letters (reusing amendment-01\'s own anonymise.mjs)', () => {
  const files = readdirSync(`${dir}/amendment-02/runs-anon`).filter(f => f.endsWith('.jsonl'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = readFileSync(`${dir}/amendment-02/runs-anon/${f}`, 'utf8');
    for (const word of ['openrouter', 'eurouter', 'requesty', 'bedrock', 'foundry', 'local-agents', 'price-book', 'azure'])
      assert.ok(!text.toLowerCase().includes(word), `${f} mentions ${word}`);
  }
});

test('outputs() recomputes exactly what is committed as results.json', () => {
  const committed = readFileSync(`${dir}/amendment-02/results.json`, 'utf8');
  assert.equal(outputs(), committed, 'results.json is not what amendment-02/analyse-anon.mjs computes from runs-anon/');
});

test('every broker\'s verdict class is unchanged from amendment-01 -- confirming this is not a kill-the-cadence event', () => {
  const amend01 = JSON.parse(readFileSync(`${dir}/results.json`, 'utf8'));
  const amend02 = JSON.parse(readFileSync(`${dir}/amendment-02/results.json`, 'utf8'));
  for (const letter of Object.keys(amend01.perBroker)) {
    assert.equal(amend02.perBroker[letter].verdict, amend01.perBroker[letter].verdict, letter);
  }
});
