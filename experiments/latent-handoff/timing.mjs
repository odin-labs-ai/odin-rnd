// EXP 008 (latent-handoff) timing protocol, bundle 3 WO-06.
//
// Per item: the memory gate is checked (and waited on) before the item; the arm order is a seeded random permutation
// of the arms; each arm gets 1 warm-up + 5 timed reps and reports the median. The gate is read again after the item.
// If the readings drifted during the item (any of the six gate conditions failing after it), the item's timing is
// re-queued, at most twice, and then marked `timing-unstable`. Every result row carries the gate readings taken
// before and after its item.
import { createHash } from 'node:crypto';
import { GATE, judge, read, waitUntilClear } from './mem-gate.mjs';

export const PROTOCOL = Object.freeze({ warmups: 1, reps: 5, maxRequeues: 2 });

/** mulberry32 seeded from sha256(seed + item id): a reproducible per-item stream. */
export function rngFor(seed, itemId) {
  let a = createHash('sha256').update(`${seed}:${itemId}`).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function armOrder(arms, seed, itemId) {
  const rng = rngFor(seed, itemId);
  const out = [...arms];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Time every item. `runArm(item, arm)` performs one call and returns { ms, ...anything } (the last rep's extra fields
 * are kept on the row). `readers`, `sleep`, `log` and `now` are injectable for tests.
 * Returns { rows, unstable } where each row is { itemId, arm, order, msMedian, msReps, gateBefore, gateAfter, attempt }.
 */
export async function timeItems({
  items, arms, seed, runArm, readers, peakGB = 0, footprintGB = 0, gate = GATE,
  sleep, log = () => {}, maxWaits, protocol = PROTOCOL,
}) {
  const rows = [];
  const unstable = [];
  const queue = items.map(item => ({ item, attempt: 0 }));
  let prev = null;
  while (queue.length) {
    const { item, attempt } = queue.shift();
    const before = await waitUntilClear({ readers, peakGB, footprintGB, prev, gate, sleep, log, maxWaits });
    if (!before.ok) throw new Error(`memory gate never cleared before item ${item.id}`);
    const order = armOrder(arms, seed, item.id);
    const itemRows = [];
    for (const arm of order) {
      for (let w = 0; w < protocol.warmups; w += 1) await runArm(item, arm, { warmup: true });
      const reps = [];
      let last = {};
      for (let r = 0; r < protocol.reps; r += 1) {
        last = await runArm(item, arm, { warmup: false });
        reps.push(last.ms);
      }
      itemRows.push({ ...last, itemId: item.id, arm, order, msReps: reps, msMedian: median(reps), attempt });
    }
    const after = judge(read(readers), { prev: before.readings, peakGB, footprintGB, gate });
    prev = after.readings;
    if (!after.ok) {
      if (attempt < protocol.maxRequeues) {
        log(`timing: item ${item.id} drifted (${after.failures.join('; ')}); re-queued (attempt ${attempt + 1})`);
        queue.push({ item, attempt: attempt + 1 });
        continue;
      }
      unstable.push(item.id);
      for (const row of itemRows) rows.push({ ...row, timing: 'timing-unstable', gateBefore: before.readings, gateAfter: after.readings, gateAfterFailures: after.failures });
      continue;
    }
    for (const row of itemRows) rows.push({ ...row, timing: 'stable', gateBefore: before.readings, gateAfter: after.readings });
  }
  return { rows, unstable };
}
