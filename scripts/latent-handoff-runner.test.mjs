// EXP 008 (latent-handoff) bundle 3 WO-04: the runner (python, stdlib parts), the scorer split and the ffr rows.
//   - test_runner.py: every arm's control flow, OOM / NaN abstentions, the C1 STOP, a leaky transfer failing the
//     zero-prefill gate, the derangement, the single-token readout and the labels guard;
//   - score.mjs reads labels, counts an abstention as wrong, and checks C1 against A0;
//   - every arm's runner row, abstentions included, becomes a valid ffr.v1 event.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ARMS, ffrRow, STAGE1_ARMS } from '../experiments/latent-handoff/arms.mjs';
import { handoffEvent } from '../experiments/latent-handoff/ffr8.mjs';
import { loadTruth, score } from '../experiments/latent-handoff/score.mjs';

// Python children inherit this: no __pycache__ is written into the source tree (the publish gate seals it).
process.env.PYTHONDONTWRITEBYTECODE = '1';

const MODELS = JSON.parse(readFileSync(new URL('../experiments/latent-handoff/models.json', import.meta.url), 'utf8'));

test('runner control flow, abstentions, C1 stop, zero-prefill and the labels guard (python3, stdlib)', () => {
  const r = spawnSync('python3', ['-B', 'experiments/latent-handoff/test_runner.py'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ran 12 tests/);
  assert.match(r.stderr, /OK/);
});

test('the stage 1 arms: A0, A1, the KV controls C1, C2, C3, and the labelled public baselines A2a, A2b', () => {
  assert.deepEqual([...STAGE1_ARMS], ['A0', 'A1', 'C1', 'C2', 'C3', 'A2a', 'A2b']);
  assert.deepEqual(Object.keys(ARMS).filter(a => ARMS[a].kind === 'kv'), ['C1', 'C2', 'A2a', 'A2b']);
  assert.match(ARMS.A2a.what, /^our extension of /);
  assert.match(ARMS.A2b.what, /^our reimplementation of /);
});

test('the mapper maths: alignment, RoPE inverse, fits, numpy/torch agreement (skips without numpy + torch)', () => {
  const r = spawnSync('python3', ['-B', 'experiments/latent-handoff/test_kvmap.py'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ran 7 tests/);
});

const row = (itemId, arm, decision, extra = {}) => ({ runId: 'practice-x', pair: 'D1', stratum: 'S', itemId, arm, decision, abstain: false, ts: '2026-10-01T20:00:00Z', prefillTok: 25, prefillMs: 1, ttftMs: 2, peakMemGB: 9, ...extra });

test('the scorer counts an abstention as wrong and checks C1 against A0', () => {
  const truth = new Map([['c001', 'RED'], ['c002', 'GREEN']]);
  const out = score([
    row('c001', 'A0', 'REJECT'), row('c002', 'A0', 'ACCEPT'),
    row('c001', 'C1', 'REJECT', { klVsA0: 0 }), row('c002', 'C1', 'ACCEPT', { klVsA0: 1e-6 }),
    row('c001', 'C3', null, { abstain: true, reason: 'oom' }), row('c002', 'C3', 'REJECT'),
  ], truth);
  const by = Object.fromEntries(out.map(g => [g.arm, g]));
  assert.equal(by.A0.accuracy, 1);
  assert.equal(by.C1.decisionAgreementWithA0, 1);
  assert.equal(by.C1.maxKlVsA0, 1e-6);
  assert.equal(by.C3.accuracy, 0);
  assert.equal(by.C3.abstentions, 1);
  assert.equal(by.C3.falseReject, 1);
  assert.equal(by.C1.c1Pass, true);
});

test('a C1 abstention is a C1 failure, and so is a KL over the bound', () => {
  const truth = new Map([['c006', 'RED'], ['c007', 'GREEN']]);
  const out = score([
    row('c006', 'A0', 'REJECT'), row('c007', 'A0', 'ACCEPT'),
    row('c006', 'C1', null, { abstain: true, reason: 'oom' }), row('c007', 'C1', 'ACCEPT', { klVsA0: 2e-3 }),
  ], truth);
  const c1 = out.find(g => g.arm === 'C1');
  assert.equal(c1.c1Pass, false);
  assert.deepEqual(c1.c1Failures.map(f => f.reason), ['abstain:oom', 'kl']);
});

test('the truth covers all 200 items, 100 RED / 100 GREEN', () => {
  const truth = loadTruth();
  assert.equal(truth.size, 200);
  assert.equal([...truth.values()].filter(v => v === 'RED').length, 100);
});

test('every arm row, and an abstention, becomes a valid ffr.v1 event', async () => {
  for (const arm of STAGE1_ARMS) {
    const ev = await handoffEvent(ffrRow(row('c001', arm, 'ACCEPT'), MODELS));
    assert.equal(ev.handoff.channel, { A0: 'text', A1: 'summary', C3: 'text' }[arm] ?? 'kv-transferred');
  }
  const ab = await handoffEvent(ffrRow(row('c001', 'C2', null, { abstain: true, reason: 'oom' }), MODELS));
  assert.equal(ab.usage.ttftMs, null);
  assert.equal(ab.quality.nullReasons.ttftMs, 'oom-abstention');
});
