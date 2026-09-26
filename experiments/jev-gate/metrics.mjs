// EXP 005 interval and verdict arithmetic. Every threshold, the confidence level and z come from
// preregistration.json; nothing here may state one (scripts/jev-gate-prereg.test.mjs greps for it).
// The paired interval is implemented here once; the verdict code and the renderers call it.
import assert from 'node:assert/strict';

const count = (x, name) => assert(Number.isInteger(x) && x >= 0, `${name} must be a non-negative integer`);

// Wilson score interval for x successes out of n. Null when there is nothing to estimate.
export function wilson(x, n, z) {
  count(x, 'x'); count(n, 'n'); assert(x <= n, 'x must not exceed n'); assert(Number.isFinite(z) && z > 0, 'z required');
  if (n === 0) return null;
  const p = x / n, z2 = z * z;
  const centre = p + z2 / (2 * n), spread = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)), scale = 1 + z2 / n;
  return { estimate: p, lower: Math.max(0, (centre - spread) / scale), upper: Math.min(1, (centre + spread) / scale), x, n };
}

// Newcombe (1998) method 10: the difference p1 - p2 of two proportions measured on the same n items.
// a = both, b = only the first, c = only the second, d = neither.
export function newcombePaired({ a, b, c, d }, z) {
  for (const [k, v] of Object.entries({ a, b, c, d })) count(v, k);
  const n = a + b + c + d;
  if (n === 0) return null;
  const first = wilson(a + b, n, z), second = wilson(a + c, n, z);
  const p1 = first.estimate, p2 = second.estimate, theta = p1 - p2;
  const denominator = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const phi = denominator === 0 ? 0 : (a * d - b * c) / denominator;
  const dl1 = p1 - first.lower, du1 = first.upper - p1, dl2 = p2 - second.lower, du2 = second.upper - p2;
  const delta = Math.sqrt(Math.max(0, dl1 * dl1 - 2 * phi * dl1 * du2 + du2 * du2));
  const epsilon = Math.sqrt(Math.max(0, du1 * du1 - 2 * phi * du1 * dl2 + dl2 * dl2));
  return { estimate: theta, lower: Math.max(-1, theta - delta), upper: Math.min(1, theta + epsilon), phi, first, second, n };
}

export const states = record => record.thresholdRule.states;

// Three-state verdict for a single rate against its pre-registered threshold.
export function judgeSingleRate(record, criterion, x, n) {
  assert.equal(criterion.kind, 'single-rate'); assert.equal(criterion.refutedWhen, 'greater-than');
  const [refuted, notEstablished, passes] = states(record);
  const interval = wilson(x, n, record.statistics.z);
  if (!interval) return { state: 'no items', interval };
  const state = interval.estimate > criterion.threshold ? refuted : interval.upper > criterion.threshold ? notEstablished : passes;
  return { state, interval };
}

// Paired comparison of point estimates on the same items; "not established" when the interval includes 0.
export function judgePaired(record, criterion, table) {
  assert.equal(criterion.kind, 'paired-difference'); assert.equal(criterion.refutedWhen, 'greater-than');
  const [refuted, notEstablished, passes] = states(record);
  const interval = newcombePaired(table, record.statistics.z);
  if (!interval) return { state: 'no items', interval };
  const state = interval.estimate > criterion.threshold ? refuted : interval.lower <= criterion.threshold && criterion.threshold <= interval.upper ? notEstablished : passes;
  return { state, interval };
}

// The baseline is valid unless the reviewer's own missed-drift point estimate exceeds its threshold.
export function baselineValid(record, x, n) {
  const interval = wilson(x, n, record.statistics.z);
  return Boolean(interval) && !(interval.estimate > record.baselineValidity.threshold);
}

// A model-free baseline's misses and false rejects on the given items, from baselines.json results:
// explicit counts when recorded, otherwise its per-item decisions (a missing decision counts against it).
const rejects = decision => ['REJECT', 'REJECTED', 'RED'].includes(String(decision).toUpperCase());
const accepts = decision => ['ACCEPT', 'ACCEPTED', 'APPROVED', 'GREEN'].includes(String(decision).toUpperCase());
export function baselineCounts(baseline, { red, green }) {
  const r = baseline.results, decisions = r.decisions;
  const missedRed = Number.isInteger(r.missedRed) ? r.missedRed : decisions ? red.filter(id => !rejects(decisions[id])).length : null;
  const falseReject = Number.isInteger(r.falseReject) ? r.falseReject : decisions ? green.filter(id => !accepts(decisions[id])).length : null;
  assert(Number.isInteger(missedRed), `Baseline ${baseline.id} records neither missedRed nor per-item decisions`);
  return { missedRed, falseReject };
}

// The better baseline: fewest missed RED items, then fewest false rejects, then the id that sorts first.
export function pickBestBaseline(baselines, items) {
  if (!baselines.length) return { id: null, missedRed: null };
  const ranked = baselines.map(b => ({ id: b.id, ...baselineCounts(b, items) }))
    .sort((x, y) => x.missedRed - y.missedRed || (x.falseReject ?? Infinity) - (y.falseReject ?? Infinity) || x.id.localeCompare(y.id));
  return { id: ranked[0].id, missedRed: ranked[0].missedRed };
}
