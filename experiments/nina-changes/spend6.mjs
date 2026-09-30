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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
const known = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

export class SpendLedger6 {
  constructor(path, limits = LIMITS6) { this.path = path; this.limits = limits; }
  entries() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  total(filter = () => true) { return fromUnits(this.entries().filter(filter).reduce((s, e) => s + units(e.costUsd), 0)); }
  preCountedTotal() { return this.total(e => isPreCounted(e.kind)); }
  largest() { return this.entries().reduce((m, e) => Math.max(m, e.costUsd), 0); }
  reserve() { return Math.max(this.largest(), this.limits.unknownCostFloorUsd); }
  /** Whether one more call of this kind may start. {ok, reason, askFork, spent, preCounted, reserve}. */
  check(kind) {
    const spent = this.total(), preCounted = this.preCountedTotal(), reserve = this.reserve();
    const base = { spent, preCounted, reserve, capUsd: this.limits.capUsd, preCountedCeilingUsd: this.limits.preCountedCeilingUsd };
    if (units(spent) + units(reserve) > units(this.limits.capUsd)) return { ok: false, reason: 'cap', askFork: true, ...base };
    if (isPreCounted(kind) && units(preCounted) + units(reserve) > units(this.limits.preCountedCeilingUsd)) return { ok: false, reason: 'pre-counted-ceiling', askFork: true, ...base };
    return { ok: true, reason: null, askFork: false, ...base };
  }
  /** The ledger line for one paid call; an unknown cost is charged the upper bound. Returns the line written. */
  record({ ts, kind, id, run, reportedCostUsd, fixture = false, recordSha256 = null }) {
    const upper = this.reserve();
    const line = known(reportedCostUsd)
      ? { ts, gate: 'reviewer', kind, id, run, costUsd: round7(reportedCostUsd), costBasis: 'api-equivalent', reportedCostUsd, fixture }
      : { ts, gate: 'reviewer', kind, id, run, costUsd: round7(upper), costBasis: 'upper-bound', reportedCostUsd: reportedCostUsd ?? null, fixture };
    if (recordSha256) line.recordSha256 = recordSha256;
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
