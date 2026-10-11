// EXP 011 (reviewer-keep): the frozen scorer. Pure functions over item labels and calls; no file, no clock, no network.
// The pre-registration pins this file by sha256, so the counted analysis is the code below, not a later rewrite.
//
// Vocabulary. An item is { id, label: 'RED' | 'GREEN' } (RED = the change breaks its rule). A call is 'REJECT' or
// 'ACCEPT'. A positive is a REJECT: the true-positive rate (TPR) is the share of RED items rejected, the true-negative
// rate (TNR) the share of GREEN items accepted, the false-reject rate (FR) the share of GREEN items rejected.
// Balanced accuracy BA = (TPR + TNR) / 2 (Youden's J = TPR + TNR - 1 = 2 BA - 1).

export const SEED = 10010;
export const RESAMPLES = 10_000;
export const BAR = 0.2;
export const FR_BUDGET = 0.15;
export const HARDNESS_MAX_BA = 0.75;
// The fixed tie order of v3 §5. A tool's position here breaks a tie left after the lower FR.
export const TOOL_ORDER = ['tsc', 'eslint', 'prettier', 'churn', 'OR'];
// Comparisons of a figure computed from integer counts against a decimal bar allow this much floating-point slack.
const EPS = 1e-12;
const Z95 = 1.959963984540054;

/** mulberry32, the 32-bit PRNG EXP 007 uses for its seeded sample (experiments/blueprint-floor/extract.mjs), copied. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isCall = c => c === 'REJECT' || c === 'ACCEPT';
function checkInputs(items, calls) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('no items');
  const ids = new Set();
  for (const item of items) {
    if (item.label !== 'RED' && item.label !== 'GREEN') throw new Error(`item ${item.id}: label must be RED or GREEN`);
    if (ids.has(item.id)) throw new Error(`item ${item.id} twice`);
    ids.add(item.id);
    if (!isCall(calls[item.id])) throw new Error(`item ${item.id}: no REJECT/ACCEPT call`);
  }
}

/** TPR, TNR, FR and BA of one arm's calls over the given items (indices into `items` may repeat: a resample). */
export function rates(items, calls, indices = items.map((_, i) => i)) {
  let red = 0, green = 0, tp = 0, fr = 0;
  for (const i of indices) {
    const { id, label } = items[i];
    if (label === 'RED') { red++; if (calls[id] === 'REJECT') tp++; } else { green++; if (calls[id] === 'REJECT') fr++; }
  }
  if (red === 0 || green === 0) throw new Error('BA needs at least one RED and one GREEN item');
  const tpr = tp / red, tnr = (green - fr) / green;
  return { red, green, tp, fr: fr / green, falseRejects: fr, tpr, tnr, ba: (tpr + tnr) / 2 };
}

export function balancedAccuracy(items, calls) {
  checkInputs(items, calls);
  return rates(items, calls).ba;
}

/** A run's outcome: a decided verdict, or no decision (an abstention, a harness failure, a DIFF-BLIND run). */
export const RUN_OUTCOMES = ['REJECT', 'ACCEPT', 'ABSTAIN', 'FAIL', 'BLIND'];
const decided = r => r === 'REJECT' || r === 'ACCEPT';
function checkRuns(runs, scheduled) {
  if (!Array.isArray(runs) || runs.length !== scheduled) throw new Error(`expected ${scheduled} runs, got ${runs?.length}`);
  for (const r of runs) if (!RUN_OUTCOMES.includes(r)) throw new Error(`unknown run outcome ${r}`);
}

/**
 * The reviewer's item-level call from its scheduled runs: the decided verdict that a strict majority of the
 * SCHEDULED runs gave; otherwise NONE. EXP 006's mapping: a run without a decision (abstained, harness failure,
 * DIFF-BLIND) is no decision, and an item without a majority verdict is scored as the wrong answer for its label.
 */
export function itemMajority(runs, scheduled = 3) {
  checkRuns(runs, scheduled);
  for (const v of ['REJECT', 'ACCEPT']) if (runs.filter(r => r === v).length * 2 > scheduled) return v;
  return 'NONE';
}

/** An item-level call made scoreable: NONE becomes the wrong answer for the item's label. */
export const resolveCall = (call, label) => (call === 'NONE' ? (label === 'RED' ? 'ACCEPT' : 'REJECT') : call);

/** The reviewer's scoreable item calls from its runs. */
export function reviewerCalls(items, runsById, scheduled = 3) {
  return Object.fromEntries(items.map(i => [i.id, resolveCall(itemMajority(runsById[i.id], scheduled), i.label)]));
}

/**
 * Run-level secondaries (EXP 006 shape): the miss rate is the share of RED runs that are not REJECT, the false-reject
 * rate the share of GREEN runs that are not ACCEPT (a run without a decision is wrong either way); self-agreement is
 * the share of items whose scheduled runs all gave the same decided verdict.
 */
export function runLevel(items, runsById, scheduled = 3) {
  let redRuns = 0, missed = 0, greenRuns = 0, falseRejects = 0, agree = 0;
  for (const { id, label } of items) {
    const runs = runsById[id];
    checkRuns(runs, scheduled);
    if (label === 'RED') { redRuns += runs.length; missed += runs.filter(r => r !== 'REJECT').length; } else { greenRuns += runs.length; falseRejects += runs.filter(r => r !== 'ACCEPT').length; }
    if (decided(runs[0]) && runs.every(r => r === runs[0])) agree++;
  }
  return { redRuns, missed, missRate: missed / redRuns, greenRuns, falseRejects, falseRejectRate: falseRejects / greenRuns, items: items.length, agree, selfAgreement: agree / items.length };
}

/** The OR of several tools' calls on one item: REJECT iff any of them rejects. An empty set never rejects. */
export function orCall(toolCalls) {
  return toolCalls.some(c => c === 'REJECT') ? 'REJECT' : 'ACCEPT';
}

/**
 * The best baseline, v3 §5, one definition for the hardness gate and the primary: among the candidates (each tool and
 * the OR of tools), the one with the highest BA subject to FR <= 15% on GREEN items. Ties: the lower FR, then
 * TOOL_ORDER. Returns null when no candidate reaches FR <= 15%.
 * `candidates` maps a TOOL_ORDER name to that candidate's calls ({ itemId: 'REJECT' | 'ACCEPT' }).
 */
export function selectBestBaseline(items, candidates) {
  const names = Object.keys(candidates);
  for (const n of names) if (!TOOL_ORDER.includes(n)) throw new Error(`unknown baseline ${n}`);
  const scored = TOOL_ORDER.filter(n => names.includes(n)).map(name => { checkInputs(items, candidates[name]); return { name, ...rates(items, candidates[name]) }; });
  const eligible = scored.filter(s => s.fr <= FR_BUDGET + EPS);
  if (eligible.length === 0) return { best: null, scored };
  eligible.sort((a, b) => (Math.abs(b.ba - a.ba) > EPS ? b.ba - a.ba : Math.abs(a.fr - b.fr) > EPS ? a.fr - b.fr : TOOL_ORDER.indexOf(a.name) - TOOL_ORDER.indexOf(b.name)));
  return { best: eligible[0], scored };
}

/** The always-RED reference: rejects every item (TPR 1, TNR 0, BA 0.5, FR 1). */
export const alwaysRed = items => Object.fromEntries(items.map(i => [i.id, 'REJECT']));
/** The prevalence-random reference has expected BA 0.5 whatever its rate; it is reported by its expectation, never sampled. */
export const PREVALENCE_RANDOM_BA = 0.5;

/**
 * The class-stratified bootstrap of BA(reviewer) - BA(comparator): each resample draws, with replacement, as many RED
 * items as there are from the RED items and as many GREEN items from the GREEN items (mulberry32(SEED), RED draws
 * first, then GREEN, item order as given), and recomputes both BAs on the same resample. The comparator is fixed
 * before resampling (it is not re-selected per resample). `comparator` is a calls map, or a number (a constant BA,
 * for the always-RED / prevalence-random reference, whose BA is 0.5 on every resample).
 * The 95% interval is the percentile interval: sorted differences d[0..B-1], lower d[floor(0.025 B)], upper
 * d[ceil(0.975 B) - 1].
 */
export function stratifiedBootstrap(items, reviewerCalls, comparator, { seed = SEED, resamples = RESAMPLES } = {}) {
  checkInputs(items, reviewerCalls);
  if (typeof comparator !== 'number') checkInputs(items, comparator);
  const red = [], green = [];
  items.forEach((item, i) => (item.label === 'RED' ? red : green).push(i));
  if (!red.length || !green.length) throw new Error('the bootstrap needs both classes');
  const baOf = (calls, idx) => (typeof calls === 'number' ? calls : rates(items, calls, idx).ba);
  const point = baOf(reviewerCalls, items.map((_, i) => i)) - baOf(comparator, items.map((_, i) => i));
  const rand = mulberry32(seed);
  const diffs = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    const idx = [];
    for (let k = 0; k < red.length; k++) idx.push(red[Math.floor(rand() * red.length)]);
    for (let k = 0; k < green.length; k++) idx.push(green[Math.floor(rand() * green.length)]);
    diffs[b] = baOf(reviewerCalls, idx) - baOf(comparator, idx);
  }
  let mean = 0;
  for (const d of diffs) mean += d / resamples;
  diffs.sort();
  return { point, mean, lower: diffs[Math.floor(0.025 * resamples)], upper: diffs[Math.ceil(0.975 * resamples) - 1], resamples, seed };
}

/** log of n choose k, exact enough for n in the hundreds. */
function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * The exact McNemar test on paired item-level calls: b = items the reviewer gets right and the comparator wrong,
 * c = the reverse; two-sided p = min(1, 2 * P(X <= min(b, c))) with X ~ Binomial(b + c, 1/2); p = 1 when b + c = 0.
 */
export function mcnemarExact(b, c) {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) throw new Error('b and c are counts');
  const n = b + c;
  if (n === 0) return { b, c, p: 1 };
  let tail = 0;
  for (let k = 0; k <= Math.min(b, c); k++) tail += Math.exp(logChoose(n, k) - n * Math.LN2);
  return { b, c, p: Math.min(1, 2 * tail) };
}

/** Discordant pairs of two arms over the items of one class (or all items): right/wrong against the label. */
export function discordant(items, callsA, callsB) {
  let b = 0, c = 0;
  for (const { id, label } of items) {
    const want = label === 'RED' ? 'REJECT' : 'ACCEPT';
    const a = callsA[id] === want, z = callsB[id] === want;
    if (a && !z) b++; else if (!a && z) c++;
  }
  return { b, c };
}

/** The Wilson 95% score interval for k successes in n. */
export function wilson(k, n, z = Z95) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0 || k < 0 || k > n) throw new Error('wilson needs 0 <= k <= n, n > 0');
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den, half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { k, n, p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/**
 * The three-state label of an item-level rate against a bar (EXP 006 shape): "passes" when the Wilson interval lies
 * wholly on the passing side, "fails" when the point estimate is on the failing side, otherwise "passes, not
 * established at this N". `direction` is 'max' (the rate must be <= bar, e.g. a miss rate) or 'min' (>= bar).
 */
export function threeState(k, n, bar, direction) {
  const w = wilson(k, n);
  if (direction === 'max') return w.p > bar + EPS ? 'fails' : w.upper <= bar + EPS ? 'passes' : 'passes, not established at this N';
  if (direction === 'min') return w.p < bar - EPS ? 'fails' : w.lower >= bar - EPS ? 'passes' : 'passes, not established at this N';
  throw new Error('direction is max or min');
}

/** The runs-per-item schedules the frozen scorer accepts: 3 (pre-registered) and 2 (the $60 fallback). */
export const RUNS_PER_ITEM = [3, 2];
export const SPOT_CHECK = { seed: 10011, red: 8, green: 8 };

/**
 * The frozen human spot-check sample, chosen before any label exists: within each class, the item ids sorted by code
 * unit, Fisher-Yates shuffled by mulberry32(seed) (RED first, then GREEN, one stream), and the first `red` RED and
 * `green` GREEN ids taken, returned in sorted order. The class is the author's intent at authoring time.
 */
export function spotCheckSample(items, { seed = SPOT_CHECK.seed, red = SPOT_CHECK.red, green = SPOT_CHECK.green } = {}) {
  const rand = mulberry32(seed);
  const pick = (label, k) => {
    const ids = items.filter(i => i.label === label).map(i => i.id).sort();
    if (ids.length < k) throw new Error(`the spot-check needs ${k} ${label} items, there are ${ids.length}`);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return ids.slice(0, k).sort();
  };
  return { red: pick('RED', red), green: pick('GREEN', green) };
}

/**
 * The primary analysis, at a MATCHED false-reject budget on both sides. `reviewerRuns` maps item id to its scheduled
 * runs; `toolCalls` maps a tool name (tsc, eslint, prettier, churn) to its calls; `orCalls` are the OR-of-tools calls.
 * The bar passes only when the BA difference >= 0.20, AND the stratified-bootstrap lower bound > 0, AND the reviewer's
 * item-level false-reject rate on GREEN items <= 15% (the baseline is held to the same budget by its selection).
 * Options: runsPerItem (3, or 2 for the fallback), seed, resamples, and mappedRules (a Set of the rule ids that map to
 * at least one tool; items then carry ruleId) for the mapped/unmapped subgroup secondary, reported, never judged.
 */
export function primary(items, reviewerRuns, toolCalls, orCalls, options = {}) {
  const { runsPerItem = 3, mappedRules = null, ...bootOptions } = options;
  if (!RUNS_PER_ITEM.includes(runsPerItem)) throw new Error(`runsPerItem must be one of ${RUNS_PER_ITEM.join(', ')}`);
  const reviewer = reviewerCalls(items, reviewerRuns, runsPerItem);
  const { best, scored } = selectBestBaseline(items, { ...toolCalls, OR: orCalls });
  const hardness = best === null
    ? { passes: true, reason: 'no baseline reaches FR <= 15%: the gate passes, and the primary compares against always-RED / prevalence-random (BA 0.5)' }
    : { passes: best.ba <= HARDNESS_MAX_BA + EPS, bestBa: best.ba, reason: best.ba <= HARDNESS_MAX_BA + EPS ? 'best baseline BA <= 0.75' : 'decidable model-free: best baseline BA > 0.75' };
  const comparator = best === null ? { name: 'always-RED / prevalence-random', calls: PREVALENCE_RANDOM_BA } : { name: best.name, calls: best.name === 'OR' ? orCalls : toolCalls[best.name] };
  const boot = stratifiedBootstrap(items, reviewer, comparator.calls, bootOptions);
  const reviewerRates = rates(items, reviewer);
  const reviewerWithinBudget = reviewerRates.fr <= FR_BUDGET + EPS;
  const bar = { difference: boot.point, lower: boot.lower, reviewerFr: reviewerRates.fr, reviewerWithinBudget, passes: boot.point >= BAR - EPS && boot.lower > 0 && reviewerWithinBudget };
  const red = items.filter(i => i.label === 'RED'), green = items.filter(i => i.label === 'GREEN');
  const paired = typeof comparator.calls === 'number' ? null : {
    tpr: { difference: reviewerRates.tpr - rates(items, comparator.calls).tpr, ...mcnemarExact(...Object.values(discordant(red, reviewer, comparator.calls))) },
    tnr: { difference: reviewerRates.tnr - rates(items, comparator.calls).tnr, ...mcnemarExact(...Object.values(discordant(green, reviewer, comparator.calls))) },
  };
  const subgroups = mappedRules ? subgroupDifferences(items, reviewer, comparator.calls, mappedRules) : null;
  return { reviewer: reviewerRates, runLevel: runLevel(items, reviewerRuns, runsPerItem), runsPerItem, scored, best: best?.name ?? null, comparator: comparator.name, hardness, bootstrap: boot, bar, paired, subgroups };
}

/**
 * The mapped/unmapped subgroup secondary (published, never judged): the BA difference between the reviewer and the
 * fixed comparator on the items of rules that map to at least one tool, and on the items of rules that map to none.
 * A subgroup without both classes has no BA (null).
 */
export function subgroupDifferences(items, reviewer, comparator, mappedRules) {
  const diff = group => {
    if (!group.some(i => i.label === 'RED') || !group.some(i => i.label === 'GREEN')) return null;
    const ba = calls => (typeof calls === 'number' ? calls : rates(group, calls).ba);
    return { items: group.length, difference: ba(reviewer) - ba(comparator) };
  };
  for (const i of items) if (typeof i.ruleId !== 'string') throw new Error(`item ${i.id} has no ruleId`);
  return { mapped: diff(items.filter(i => mappedRules.has(i.ruleId))), unmapped: diff(items.filter(i => !mappedRules.has(i.ruleId))) };
}
