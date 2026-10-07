import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, mcnemar, validity, wilsonUpper } from '../experiments/composable-harness/analysis/analyse.mjs';

// EXP 009 bundle 3 WO-05: analyse.mjs on synthetic rows only. It covers the pass path, the refute path, and every
// validity-gate failure path (each one alone turns the record uninformative, never a pass).

const GOOD = {
  k1: { detected: 12, of: 12 }, k2: { residueProbes: 0 }, r0Rerun: { sampled: 40, identical: 40 }, r0Restart: { identical: true },
  pins: { verified: true, kernelShaInPrereg: true }, leases: { blocks: 5, held: 5 },
};
const trials = (n, divergentAt = []) => Array.from({ length: n }, (_, i) => ({ arm: 'H1', trial: i, divergences: divergentAt.includes(i) ? [{ step: 3, kind: 'decision' }] : [] }));
const p2 = (bad = 0) => Array.from({ length: 120 }, (_, i) => ({ config: `c${i}`, faulty: i < 60, kernel: i < bad ? 'silent-inert' : 'correct', baseline: i < 60 && i % 2 ? 'silent-inert' : 'correct' }));

test('Wilson: 0 of 381 puts the 95% upper bound at <= 1%, 0 of 380 does not; McNemar exact', () => {
  assert.ok(wilsonUpper(0, 381) <= 0.01);
  assert.ok(wilsonUpper(0, 380) > 0.01);
  assert.equal(wilsonUpper(0, 0), 1);
  assert.equal(mcnemar(0, 0).p, 1);
  assert.equal(Number(mcnemar(0, 6).p.toFixed(6)), 0.03125);
  assert.equal(Number(mcnemar(3, 3).p.toFixed(6)), 1);
});

test('pass path: 0 divergences in 400 trials and a clean P2 corpus support P1 and P2', () => {
  const r = analyse({ trials: trials(400), p2: p2(), gates: GOOD, timings: [{ arm: 'H1', readyMs: 10, breach: false }, { arm: 'R0', readyMs: 900, breach: false }, { arm: 'H1', readyMs: 50, breach: true }] });
  assert.equal(r.validity.informative, true);
  assert.equal(r.P1.verdict, 'supported');
  assert.ok(r.P1.wilsonUpper95 <= 0.01);
  assert.equal(r.P2.verdict, 'supported');
  assert.deepEqual(r.P2.baseline, { silentInert: 30, silentDropped: 0, falseInactive: 0 });
  assert.equal(r.P2.mcnemar.b, 30);
  assert.deepEqual(r.S3, { h1MedianReadyMs: 10, r0MedianReadyMs: 900, excludedBreachSamples: 1 });
});

test('refute path: one divergent trial refutes P1; one silent-inert config refutes P2', () => {
  const r = analyse({ trials: trials(400, [17]), p2: p2(1), gates: GOOD });
  assert.equal(r.P1.verdict, 'refuted');
  assert.equal(r.P1.divergentTrials, 1);
  assert.equal(r.P2.verdict, 'refuted');
});

test('fewer than 381 trials with no divergence is underpowered, not supported', () => {
  assert.equal(analyse({ trials: trials(200), p2: p2(), gates: GOOD }).P1.verdict, 'underpowered');
});

const broken = {
  'k1-teeth': { k1: { detected: 10, of: 12 } },
  'r0-rerun': { r0Rerun: { sampled: 40, identical: 39 } },
  'r0-restart': { r0Restart: { identical: false } },
  pins: { pins: { verified: true, kernelShaInPrereg: false } },
  leases: { leases: { blocks: 5, held: 4 } },
};
for (const [id, patch] of Object.entries(broken)) {
  test(`validity gate ${id} failing alone makes every claim uninformative, never a pass`, () => {
    const gates = { ...GOOD, ...patch };
    const v = validity(gates);
    assert.deepEqual(v.gates.filter(g => !g.pass).map(g => g.id), [id]);
    const r = analyse({ trials: trials(400), p2: p2(), gates });
    assert.equal(r.validity.informative, false);
    assert.equal(r.P1.verdict, 'uninformative');
    assert.equal(r.P2.verdict, 'uninformative');
  });
}

test('a missing gate record fails its gate (fail closed)', () => {
  const v = validity({});
  assert.equal(v.informative, false);
  assert.equal(v.gates.filter(g => g.pass).length, 0);
});

test('S1 states H2 residue against the 10% line; S1-S3 decide nothing', () => {
  const h2 = Array.from({ length: 50 }, (_, i) => ({ arm: 'H2', trial: i, divergences: [], residue: i < 5 ? ['inside.timers'] : [] }));
  const r = analyse({ trials: [...trials(400), ...h2], p2: p2(), gates: GOOD });
  assert.equal(r.S1.share, 0.1);
  assert.equal(r.S1.statement, 'H2 leaves residue in >= 10% of trials');
  assert.equal(r.P1.n, 400, 'H2 rows never count toward P1');
  assert.match(r.decides, /S1-S3 decide nothing/);
});

// ------------------------------------------------------------------------------------------- P2 mapping (synthetic)
import { censusMap, classifyBaseline, classifyKernel, p2Rows } from '../experiments/composable-harness/analysis/analyse.mjs';
import { enabled, runConfig } from '../experiments/composable-harness/arms/p2.mjs';

const synth = (over = {}) => ({
  id: 'syn-1', label: 'faulty', floorEpoch: 'pre',
  registry: [{ name: 'core-01', needs: [], provides: ['a.x'] }, { name: 'x-ledger', needs: ['b.y', 'a.x'], provides: [] }, { name: 'x-notes', needs: [], provides: ['b.y'] }, { name: 'q', needs: ['q.release', 'q.resume'], provides: [] }],
  profile: { enabledExtensions: ['x-ledger'] }, schedule: [],
  expected: { 'core-01': 'active', 'x-ledger': 'inactive: missing b.y', 'x-notes': 'excluded', q: 'excluded' },
  ...over,
});

test('P2 mapping: a plugin absent from the census is excluded (absent <=> excluded), and nothing else is', () => {
  const m = censusMap([{ name: 'core-01', status: 'active' }, { name: 'x-ledger', status: 'inactive: missing b.y' }], ['core-01', 'x-ledger', 'x-notes', 'q']);
  assert.deepEqual(m, { 'core-01': 'active', 'x-ledger': 'inactive: missing b.y', 'x-notes': 'excluded', q: 'excluded' });
  assert.throws(() => censusMap([{ name: 'ghost', status: 'active' }], ['core-01']), /does not register/);
});

test('P2 runner: only enabled plugins enter the kernel; a withdraw unloads (absent = excluded), a restore reloads', async () => {
  const c = synth();
  assert.deepEqual(enabled(c), ['core-01', 'x-ledger']);
  const r = await runConfig(c);
  assert.deepEqual(censusMap(r.end, c.registry.map(p => p.name)), c.expected, 'missing keys listed sorted, excluded = absent');
  const w = synth({ profile: null, schedule: [{ step: 1, op: 'withdraw', name: 'x-notes' }] });
  const end = censusMap((await runConfig(w)).end, w.registry.map(p => p.name));
  assert.equal(end['x-notes'], 'excluded', 'a withdrawn plugin is absent, so excluded');
  assert.equal(end['x-ledger'], 'inactive: missing b.y');
  const back = synth({ profile: null, schedule: [{ step: 1, op: 'withdraw', name: 'x-notes' }, { step: 2, op: 'restore', name: 'x-notes' }] });
  assert.equal(censusMap((await runConfig(back)).end, back.registry.map(p => p.name))['x-ledger'], 'active');
});

test('P2 classification: silent-inert, false-inactive, mislabelled and correct, per config (the worst plugin)', () => {
  const e = { a: 'active', b: 'inactive: missing k', c: 'excluded' };
  assert.equal(classifyKernel(e, { a: 'active', b: 'inactive: missing k', c: 'excluded' }), 'correct');
  assert.equal(classifyKernel(e, { a: 'active', b: 'active', c: 'excluded' }), 'silent-inert');
  assert.equal(classifyKernel(e, { a: 'excluded', b: 'inactive: missing k', c: 'excluded' }), 'false-inactive');
  assert.equal(classifyKernel(e, { a: 'active', b: 'inactive: missing z', c: 'excluded' }), 'mislabelled');
  assert.equal(classifyKernel(e, { a: 'excluded', b: 'active', c: 'excluded' }), 'silent-inert', 'the worst outcome wins');
});

test('P2 baseline rows (baseline/outputs.json shape) map to silent-inert, silent-dropped, false-inactive or correct, and feed McNemar', () => {
  const row = (label, b) => ({ id: 'syn-1', label, baseline: { signalled: false, silentInert: [], silentDropped: [], ...b } });
  assert.equal(classifyBaseline(row('faulty', { silentInert: ['x'] })), 'silent-inert');
  assert.equal(classifyBaseline(row('faulty', { silentDropped: ['q'] })), 'silent-dropped');
  assert.equal(classifyBaseline(row('faulty', { signalled: true, silentInert: ['x'] })), 'correct');
  assert.equal(classifyBaseline(row('clean', { signalled: true })), 'false-inactive');
  assert.equal(classifyBaseline(row('clean', {})), 'correct');
  const c = synth();
  const rows = p2Rows({ configs: [c], kernelCensus: { 'syn-1': [{ name: 'core-01', status: 'active' }, { name: 'x-ledger', status: 'inactive: missing b.y' }] }, baseline: [row('faulty', { silentDropped: ['q'] })] });
  assert.deepEqual(rows, [{ config: 'syn-1', faulty: true, kernel: 'correct', baseline: 'silent-dropped' }]);
  const r = analyse({ p2: rows, gates: GOOD, trials: [] });
  assert.deepEqual(r.P2.mcnemar, { b: 1, c: 0, p: 1 });
  assert.equal(r.P2.baseline.silentDropped, 1);
  assert.throws(() => p2Rows({ configs: [c], kernelCensus: {}, baseline: [] }), /no kernel census/);
});
