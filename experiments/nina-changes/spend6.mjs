// EXP 006 spend guard (I2, R2-6, R3-4, R4-6), enforced IN CODE, not only in prose.
//   - Cap $60.0000000 on ALL paid calls of EXP 006 (probes, matrices, dry run, counted), from the fresh ledger
//     experiments/nina-changes/spend-ledger.jsonl: one line per paid call, cost to 7 dp, from the client's
//     total_cost_usd (API-equivalent).
//   - A call whose cost is unknown (no positive total_cost_usd: a timeout, a crash) is charged its upper bound,
//     max(largest single EXP 006 call so far, $0.60), with costBasis "upper-bound". Never a $0 line.
//   - Before a call: refused when the recorded total + reserve would exceed $60, reserve = max(largest single call so
//     far, $0.60).
//   - Pre-counted ceiling $10.0000000 (pre-freeze matrix rounds + the practice dry run: every kind but "counted" and
//     the post-freeze "prerun-matrix" probe): a pre-counted call is refused when the pre-counted total + reserve would
//     exceed it. Reaching it = STOP + ASK-FORK.
//   - Before bundle 3: spent + 180 × p90(dry-run per-run cost) + one pre-run probe + $0.60 > $60 → ASK-FORK. p90 is
//     results.mjs `percentile` (numpy linear interpolation), the pre-registered method.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { percentile } from '../jev-gate/results.mjs';

export const LIMITS6 = Object.freeze({ capUsd: 60, preCountedCeilingUsd: 10, unknownCostFloorUsd: 0.6, countedRuns: 180, decimals: 7 });
export const LEDGER6 = 'experiments/nina-changes/spend-ledger.jsonl';
// D4 (refute r1 B2): the pre-run matrix probe made after the freeze, on the frozen runner, as part of the measured
// run, is charged ONLY against the $60 cap; every other non-counted call (pre-freeze probes, the practice dry run) is
// pre-counted and stays under the $10 ceiling.
export const PRERUN_KIND = 'prerun-matrix';
export const CAP_ONLY_KINDS = Object.freeze(['counted', PRERUN_KIND]);
export const isPreCounted = kind => !CAP_ONLY_KINDS.includes(kind);

export const round7 = v => Number(v.toFixed(LIMITS6.decimals));
// Sums are made in integer units of 1e-7 USD so 7-dp figures add exactly.
const units = v => Math.round(v * 1e7);
const fromUnits = u => u / 1e7;
// A reported cost counts only if it survives rounding to 7 dp (refute r2 N1): a sub-5e-8 cost is charged as unknown.
const known = v => typeof v === 'number' && Number.isFinite(v) && round7(v) > 0;
export const KINDS6 = Object.freeze(['isolation-matrix', 'practice', 'counted', PRERUN_KIND]);

/** A ledger line as spend6 writes it; anything else makes the ledger corrupt (refute r2 N2: fail closed, never NaN). */
export function validLine(e) {
  return e !== null && typeof e === 'object' && typeof e.ts === 'string' && KINDS6.includes(e.kind)
    && typeof e.costUsd === 'number' && Number.isFinite(e.costUsd) && e.costUsd > 0 && e.costUsd === round7(e.costUsd)
    && ['api-equivalent', 'upper-bound'].includes(e.costBasis);
}

export class SpendLedger6 {
  constructor(path, limits = LIMITS6) { this.path = path; this.limits = limits; this.pendingPath = path.replace(/\.jsonl$/, '') + '.pending.jsonl'; }
  /** A paid call whose ledger line could not be written (refute r3 N1): kept in the sidecar; every later call refuses. */
  recordPending(meta) {
    mkdirSync(dirname(this.pendingPath), { recursive: true });
    appendFileSync(this.pendingPath, `${JSON.stringify(meta)}\n`);
  }
  /**
   * Crash-safe accounting (refute r4 N1): an INTENT line is appended to the pending sidecar BEFORE a paid spawn (call id,
   * kind, the upper-bound cost it would be charged) and cleared once the real ledger line is written. A leftover intent
   * (the process killed mid-call, or both writes failed) keeps the sidecar non-empty, so every later call refuses until
   * the operator reconciles it at the upper bound. If this append fails, the caller must not spawn.
   */
  writeIntent({ callId, kind, id, run }) {
    const intent = { intent: true, callId, kind, id, run, upperBoundUsd: round7(this.reserve()), ts: new Date().toISOString() };
    this.recordPending(intent);
    return intent;
  }
  /**
   * Removes only this call's own intent line (refute r5 N1); every other line, an earlier failed-write line or an
   * unparseable one included, is kept. The rewrite is atomic: a temp file in the same directory, then a rename, so a
   * crash mid-rewrite leaves either the old sidecar or the new one, never a truncated one.
   */
  clearIntent(callId) {
    const own = l => { try { const e = JSON.parse(l); return e?.intent === true && e.callId === callId; } catch { return false; } };
    const keep = readFileSync(this.pendingPath, 'utf8').split('\n').filter(Boolean).filter(l => !own(l));
    const tmp = `${this.pendingPath}.${process.pid}.tmp`;
    writeFileSync(tmp, keep.length ? `${keep.join('\n')}\n` : '');
    renameSync(tmp, this.pendingPath);
  }
  pendingLines() { return existsSync(this.pendingPath) ? readFileSync(this.pendingPath, 'utf8').split('\n').filter(Boolean).length : 0; }
  /** Every line, validated; a corrupt line throws (the guard then refuses: fail closed). */
  entries() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map((l, i) => {
      let e = null;
      try { e = JSON.parse(l); } catch { /* invalid below */ }
      if (!validLine(e)) throw new Error(`spend ledger line ${i + 1} is corrupt: the spend guard refuses every call until it is repaired`);
      return e;
    });
  }
  total(filter = () => true) { return fromUnits(this.entries().filter(filter).reduce((s, e) => s + units(e.costUsd), 0)); }
  preCountedTotal() { return this.total(e => isPreCounted(e.kind)); }
  largest() { return this.entries().reduce((m, e) => Math.max(m, e.costUsd), 0); }
  reserve() { return Math.max(this.largest(), this.limits.unknownCostFloorUsd); }
  /** Whether one more call of this kind may start. {ok, reason, askFork, spent, preCounted, reserve}. */
  check(kind, { prereg6Sha256 = null } = {}) {
    if (this.pendingLines() > 0) return { ok: false, reason: 'pending-ledger-line', askFork: true, pending: this.pendingPath };
    let entries;
    try { entries = this.entries(); } catch (error) { return { ok: false, reason: 'corrupt-ledger', askFork: true, error: error.message }; }
    // Only ONE post-freeze pre-run probe per frozen pre-registration (refute r2 N3). A prerun-matrix line WITHOUT a
    // prereg6Sha256 (an operator-reconciled line, say) counts as made under the current one: fail closed (r5 N3).
    if (kind === PRERUN_KIND && entries.some(e => e.kind === PRERUN_KIND && (!e.prereg6Sha256 || e.prereg6Sha256 === prereg6Sha256))) return { ok: false, reason: 'prerun-already-made', askFork: true };
    const spent = this.total(), preCounted = this.preCountedTotal(), reserve = this.reserve();
    const base = { spent, preCounted, reserve, capUsd: this.limits.capUsd, preCountedCeilingUsd: this.limits.preCountedCeilingUsd };
    if (units(spent) + units(reserve) > units(this.limits.capUsd)) return { ok: false, reason: 'cap', askFork: true, ...base };
    if (isPreCounted(kind) && units(preCounted) + units(reserve) > units(this.limits.preCountedCeilingUsd)) return { ok: false, reason: 'pre-counted-ceiling', askFork: true, ...base };
    return { ok: true, reason: null, askFork: false, ...base };
  }
  /** The ledger line for one paid call; an unknown cost is charged the upper bound. Returns the line written. */
  record({ ts, kind, id, run, reportedCostUsd, fixture = false, recordSha256 = null, prereg6Sha256 = null }) {
    if (!KINDS6.includes(kind)) throw new Error(`unknown ledger kind ${kind}`);
    const upper = this.reserve();
    const line = known(reportedCostUsd)
      ? { ts, gate: 'reviewer', kind, id, run, costUsd: round7(reportedCostUsd), costBasis: 'api-equivalent', reportedCostUsd, fixture }
      : { ts, gate: 'reviewer', kind, id, run, costUsd: round7(upper), costBasis: 'upper-bound', reportedCostUsd: reportedCostUsd ?? null, fixture };
    if (recordSha256) line.recordSha256 = recordSha256;
    if (kind === PRERUN_KIND) line.prereg6Sha256 = prereg6Sha256;
    if (!(line.costUsd > 0)) throw new Error('a ledger line is never $0');
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(line)}\n`);
    return line;
  }
}

/** The pre-bundle-3 projection: spent + runs × p90(dry-run costs) + probe + $0.60 against the cap. */
export function countedProjection({ spentUsd, dryRunCosts, probeUsd, limits = LIMITS6 }) {
  const p90 = percentile(dryRunCosts, 90);
  if (p90 === null) throw new Error('no dry-run cost to project from');
  const reserve = limits.countedRuns * p90 + probeUsd + limits.unknownCostFloorUsd;
  const total = spentUsd + reserve;
  return { p90: round7(p90), reserve: round7(reserve), total: round7(total), capUsd: limits.capUsd, askFork: total > limits.capUsd, method: 'results.mjs percentile (numpy linear interpolation), q = 90' };
}
