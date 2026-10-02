// EXP 008 (latent-handoff) spend guard, bundle 3 WO-07 — the $100 cap enforced IN CODE, on the EXP 006 spend6 shape.
//
// The cap authority is the mission ledger in the private mission state dir, named by LH_SPEND_LEDGER (no default: an
// unset ledger refuses every paid call). Lines use the mission's spend.py format: a `reserve` line
// {rid, upperUsd, bundle, label} written BEFORE every paid call (GPU hour, refute round, API), and an `actual` line
// {rid, usd} after it when the real cost is known.
// experiments/latent-handoff/spend-ledger.jsonl mirrors every line this module writes.
//   - A reservation is refused when committed total + max(largest call so far, $5, this call) > $100.
//   - Never a $0 line: a reservation or an actual must be > 0.
//   - An unknown cost (a timeout, a crash) is simply never settled: the reservation stays charged at its upper bound.
// Every paid path in bundles 3-5 calls `paid()` (or reserve/settle itself).
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAP_USD = 100;
export const MIN_RESERVE_USD = 5;
export const LEDGER = process.env.LH_SPEND_LEDGER || null;
export const MIRROR = process.env.LH_SPEND_MIRROR || join(dirname(fileURLToPath(import.meta.url)), 'spend-ledger.jsonl');

// Sums in integer units of 1e-7 USD so the boundary is exact ($95.01 + $5 is refused, $95 + $5 is not).
const units = v => Math.round(v * 1e7);

export class SpendRefused extends Error {}

export function readLedger(path = LEDGER) {
  if (!path) throw new SpendRefused('no ledger: set LH_SPEND_LEDGER to the mission ledger');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
    const r = JSON.parse(l);
    const ok = (r.kind === 'reserve' && typeof r.rid === 'string' && Number.isFinite(r.upperUsd) && r.upperUsd > 0)
      || (r.kind === 'actual' && typeof r.rid === 'string' && Number.isFinite(r.usd) && r.usd > 0);
    if (!ok) throw new Error(`${path}:${i + 1}: not a valid ledger line (fail closed)`);
    return r;
  });
}

/** Committed total and largest call: actual where known, else the reservation's upper bound. */
export function state(rows) {
  const actual = new Map(rows.filter(r => r.kind === 'actual').map(r => [r.rid, r.usd]));
  let total = 0;
  let largest = 0;
  for (const r of rows.filter(x => x.kind === 'reserve')) {
    const c = units(actual.get(r.rid) ?? r.upperUsd);
    total += c;
    largest = Math.max(largest, c);
  }
  return { totalUsd: total / 1e7, largestUsd: largest / 1e7 };
}

const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function append(row, { ledger, mirror }) {
  const line = `${JSON.stringify({ ...row, ts: stamp() })}\n`;
  appendFileSync(ledger, line);
  if (mirror) appendFileSync(mirror, line);
}

export function reserve(upperUsd, bundle, label, { ledger = LEDGER, mirror = MIRROR } = {}) {
  if (!(Number.isFinite(upperUsd) && upperUsd > 0)) throw new SpendRefused('a reservation must be > 0 (never a $0 line)');
  const { totalUsd, largestUsd } = state(readLedger(ledger));
  const reserveUnits = Math.max(units(largestUsd), units(MIN_RESERVE_USD), units(upperUsd));
  if (units(totalUsd) + reserveUnits > units(CAP_USD)) {
    throw new SpendRefused(`total ${totalUsd} + max(largest ${largestUsd}, ${MIN_RESERVE_USD}, this ${upperUsd}) > ${CAP_USD}`);
  }
  const rid = randomBytes(5).toString('hex');
  append({ kind: 'reserve', rid, upperUsd, bundle, label }, { ledger, mirror });
  return rid;
}

export function settle(rid, usd, { ledger = LEDGER, mirror = MIRROR } = {}) {
  if (!(Number.isFinite(usd) && usd > 0)) throw new SpendRefused('never a $0 line; leave the reservation at its upper bound');
  if (!readLedger(ledger).some(r => r.kind === 'reserve' && r.rid === rid)) throw new SpendRefused(`unknown reservation ${rid}`);
  append({ kind: 'actual', rid, usd }, { ledger, mirror });
}

/**
 * Run one paid call under a reservation. `fn` returns { costUsd } when the real cost is known; a throw, a timeout or
 * an unknown cost leaves the reservation charged at its upper bound.
 */
export async function paid(upperUsd, bundle, label, fn, opts = {}) {
  const rid = reserve(upperUsd, bundle, label, opts);
  const out = await fn(rid);
  if (Number.isFinite(out?.costUsd) && out.costUsd > 0) settle(rid, out.costUsd, opts);
  return out;
}
