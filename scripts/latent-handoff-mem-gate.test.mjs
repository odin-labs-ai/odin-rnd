// EXP 008 (latent-handoff) bundle 3 WO-06: the memory gate and the timing protocol, with stubbed readers.
//   - each of the six failing conditions -> WAIT, never proceed (6/6);
//   - the gate and timing sources contain no process-control call (static test);
//   - every result row carries the gate readings; a drifted item is re-queued, then marked timing-unstable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GATE, judge, parseMemoryPressure, parseSwapUsage, read, waitUntilClear } from '../experiments/latent-handoff/mem-gate.mjs';
import { armOrder, timeItems } from '../experiments/latent-handoff/timing.mjs';

const QUIET = { freePct: 80, totalGB: 128, swapUsedMB: 100, mlxServerPids: [], load1: 2 };
const readersOf = (over = {}) => Object.fromEntries(Object.entries({ ...QUIET, ...over }).map(([k, v]) => [k, () => (typeof v === 'function' ? v() : v)]));

const FAILING = {
  'free < 50%': { readers: { freePct: 49 } },
  'headroom below peak + 16 GB': { readers: { freePct: 50 }, peakGB: 60 }, // 64 GB available < 76
  // swap keeps growing between readings (a gate that compares against the last reading waits while it grows)
  'swap growth': { readers: { swapUsedMB: (() => { let s = 100; return () => (s += 10); })() } },
  'mlx_lm.server resident': { readers: { mlxServerPids: ['4242'] } },
  'load above the frozen bound': { readers: { load1: 12 } },
  'pair footprint over the 24 GB design bound': { footprintGB: 24.5 },
};

test('the quiet stub passes', () => {
  assert.equal(judge(read(readersOf())).ok, true);
});

for (const [name, c] of Object.entries(FAILING)) {
  test(`${name} -> wait, never proceed`, async () => {
    const sleeps = [];
    const logs = [];
    const v = await waitUntilClear({
      readers: readersOf(c.readers), peakGB: c.peakGB ?? 0, footprintGB: c.footprintGB ?? 0,
      sleep: async ms => { sleeps.push(ms); }, log: l => logs.push(l), maxWaits: 4,
    });
    assert.equal(v.ok, false);
    assert.equal(v.gaveUp, true);
    assert.deepEqual(sleeps, [5_000, 30_000, 60_000, 120_000, 240_000]); // swap baseline, then backoff from 30 s
    assert.equal(logs.length, 4);
    assert.ok(logs.every(l => l.startsWith('mem-gate WAIT')));
  });
}

test('given the previous reading, no baseline interval is taken', async () => {
  const sleeps = [];
  const v = await waitUntilClear({ readers: readersOf(), prev: { ...QUIET }, sleep: async ms => { sleeps.push(ms); }, maxWaits: 1 });
  assert.equal(v.ok, true);
  assert.deepEqual(sleeps, []);
});

test('the backoff is capped at 10 minutes', async () => {
  const sleeps = [];
  await waitUntilClear({ readers: readersOf({ freePct: 10 }), sleep: async ms => { sleeps.push(ms); }, maxWaits: 8 });
  assert.equal(Math.max(...sleeps), 600_000);
});

test('a condition that clears lets the gate proceed', async () => {
  let n = 0;
  const v = await waitUntilClear({ readers: readersOf({ freePct: () => (n++ < 2 ? 40 : 70) }), prev: { ...QUIET }, sleep: async () => {}, maxWaits: 10 });
  assert.equal(v.ok, true);
  assert.equal(v.waits, 2);
});

test('static: the gate and the timing loop never control another process', () => {
  for (const f of ['mem-gate.mjs', 'timing.mjs']) {
    const src = readFileSync(new URL(`../experiments/latent-handoff/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /kill|signal|renice/i, f);
    const spawned = [...src.matchAll(/run\('([^']+)'/g)].map(m => m[1]);
    for (const cmd of spawned) assert.ok(['memory_pressure', 'sysctl', 'pgrep'].includes(cmd), `${f} runs ${cmd}`);
  }
});

test('parsers read the real command formats', () => {
  assert.equal(parseMemoryPressure('...\nSystem-wide memory free percentage: 76%\n'), 76);
  assert.equal(parseSwapUsage('vm.swapusage: total = 8192.00M  used = 6516.44M  free = 1675.56M  (encrypted)'), 6516.44);
  assert.equal(parseSwapUsage('vm.swapusage: total = 8.00G  used = 1.50G  free = 6.50G'), 1536);
});

test('arm order is a seeded permutation, stable per item', () => {
  const arms = ['A0', 'A1', 'C1', 'C2', 'C3'];
  assert.deepEqual(armOrder(arms, 7, 'c001'), armOrder(arms, 7, 'c001'));
  assert.deepEqual([...armOrder(arms, 7, 'c001')].sort(), [...arms].sort());
  const orders = new Set(['c001', 'c002', 'c003', 'c004', 'c005', 'c006'].map(id => armOrder(arms, 7, id).join()));
  assert.ok(orders.size > 1);
});

test('every row carries gate readings; 1 warm-up + 5 reps; median reported', async () => {
  const calls = [];
  const { rows, unstable } = await timeItems({
    items: [{ id: 'p1' }, { id: 'p2' }], arms: ['A0', 'C3'], seed: 1, readers: readersOf(), sleep: async () => {},
    runArm: async (item, arm, { warmup }) => { calls.push({ item: item.id, arm, warmup }); return { ms: calls.length }; },
  });
  assert.equal(unstable.length, 0);
  assert.equal(rows.length, 4);
  assert.equal(calls.length, 2 * 2 * 6);
  assert.equal(calls.filter(c => c.warmup).length, 4);
  for (const r of rows) {
    assert.equal(r.msReps.length, 5);
    assert.equal(r.msMedian, r.msReps[2]);
    assert.equal(typeof r.gateBefore.freePct, 'number');
    assert.equal(typeof r.gateAfter.swapUsedMB, 'number');
    assert.equal(r.timing, 'stable');
  }
});

test('a drifted item is re-queued at most twice, then marked timing-unstable', async () => {
  let swap = 100;
  const logs = [];
  const { rows, unstable } = await timeItems({
    items: [{ id: 'drift' }, { id: 'calm' }], arms: ['A0'], seed: 1, sleep: async () => {}, maxWaits: 50, log: l => logs.push(l),
    readers: readersOf({ swapUsedMB: () => swap }),
    // swap grows during every run of "drift" (the after-reading sees growth), never during "calm"
    runArm: async item => { if (item.id === 'drift') swap += 1; return { ms: 1 }; },
  });
  assert.deepEqual(unstable, ['drift']);
  assert.equal(logs.filter(l => l.includes('re-queued')).length, 2);
  const drift = rows.find(r => r.itemId === 'drift');
  assert.equal(drift.timing, 'timing-unstable');
  assert.equal(drift.attempt, 2);
  assert.ok(drift.gateAfterFailures.some(f => f.startsWith('swap grew')));
  assert.equal(rows.find(r => r.itemId === 'calm').timing, 'stable');
});

test('an untimed computation ignores only the load criterion', () => {
  const busy = read(readersOf({ load1: 30 }));
  assert.equal(judge(busy).ok, false);
  assert.equal(judge(busy, { untimed: true }).ok, true);
  const tight = read(readersOf({ load1: 30, freePct: 40 }));
  assert.deepEqual(judge(tight, { untimed: true }).failures, ['free 40% < 50%']);
});

test('a resumable run between its own segments adds its own footprint back, never more than that', () => {
  const r = read(readersOf({ freePct: 35 })); // 44.8 GB available of 128
  assert.equal(judge(r, { untimed: true }).ok, false);
  assert.equal(judge(r, { untimed: true, ownGB: 20 }).ok, true); // 35% + 15.6% = 50.6%
  assert.equal(judge(r, { untimed: true, ownGB: 10 }).ok, false); // 35% + 7.8% < 50%
});

test("a pair's own measured bound (D1' only, 48 GB) admits 26.9 GB; the design bound does not", () => {
  const r = read(readersOf());
  assert.equal(judge(r, { footprintGB: 26.9 }).ok, false);
  assert.equal(judge(r, { footprintGB: 26.9, gate: { ...GATE, maxFootprintGB: 48 } }).ok, true);
});
