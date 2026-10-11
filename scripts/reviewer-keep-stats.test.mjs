import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR, RESAMPLES, SEED, TOOL_ORDER, alwaysRed, balancedAccuracy, discordant, itemMajority, mcnemarExact, resolveCall, reviewerCalls, runLevel, SPOT_CHECK, spotCheckSample, subgroupDifferences, mulberry32, orCall, primary, rates, selectBestBaseline, stratifiedBootstrap, threeState, wilson } from './reviewer-keep-stats.mjs';

// EXP 011: the frozen scorer, proven on synthetic inputs only (no item exists yet).
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const items = (red, green) => [...Array.from({ length: red }, (_, i) => ({ id: `r${i}`, label: 'RED' })), ...Array.from({ length: green }, (_, i) => ({ id: `g${i}`, label: 'GREEN' }))];
/** Calls that reject the first `tp` RED items and the first `fr` GREEN items. */
const calls = (its, tp, fr) => {
  let r = 0, g = 0;
  return Object.fromEntries(its.map(i => [i.id, i.label === 'RED' ? (r++ < tp ? 'REJECT' : 'ACCEPT') : (g++ < fr ? 'REJECT' : 'ACCEPT')]));
};

test('the pins: seed 10010, 10,000 resamples, bar 0.20, the fixed tool order', () => {
  assert.deepEqual([SEED, RESAMPLES, BAR], [10010, 10000, 0.2]);
  assert.deepEqual(TOOL_ORDER, ['tsc', 'eslint', 'prettier', 'churn', 'OR']);
});

test('a known BA: 30 of 36 RED rejected and 3 of 36 GREEN rejected give BA (30/36 + 33/36) / 2', () => {
  const its = items(36, 36);
  const r = rates(its, calls(its, 30, 3));
  close(r.tpr, 30 / 36); close(r.tnr, 33 / 36); close(r.fr, 3 / 36); close(r.ba, 63 / 72);
  close(balancedAccuracy(its, calls(its, 36, 0)), 1);
  close(balancedAccuracy(its, alwaysRed(its)), 0.5);
  assert.throws(() => balancedAccuracy(its, { r0: 'REJECT' }), /no REJECT\/ACCEPT call/);
  assert.throws(() => balancedAccuracy([{ id: 'x', label: 'BLUE' }], { x: 'REJECT' }), /RED or GREEN/);
});

test('item majority: the verdict of a strict majority of the three scheduled runs, else NONE, scored as wrong (EXP 006 mapping)', () => {
  assert.equal(itemMajority(['REJECT', 'REJECT', 'ACCEPT']), 'REJECT');
  assert.equal(itemMajority(['ACCEPT', 'ACCEPT', 'BLIND']), 'ACCEPT');
  assert.equal(itemMajority(['REJECT', 'ABSTAIN', 'FAIL']), 'NONE');
  assert.equal(itemMajority(['REJECT', 'ACCEPT'], 2), 'NONE');
  assert.equal(resolveCall('NONE', 'RED'), 'ACCEPT');
  assert.equal(resolveCall('NONE', 'GREEN'), 'REJECT');
  assert.equal(resolveCall('REJECT', 'GREEN'), 'REJECT');
  assert.throws(() => itemMajority(['REJECT', 'REJECT']), /expected 3 runs/);
  assert.throws(() => itemMajority(['REJECT', 'REJECT', 'MAYBE']), /unknown run outcome/);
  assert.equal(orCall(['ACCEPT', 'REJECT']), 'REJECT');
  assert.equal(orCall([]), 'ACCEPT');
});

test('run level: a run without a decision is a miss on RED and a false reject on GREEN; self-agreement needs three equal decided runs', () => {
  const its = items(2, 2);
  const r = runLevel(its, { r0: ['REJECT', 'REJECT', 'REJECT'], r1: ['REJECT', 'ABSTAIN', 'ACCEPT'], g0: ['ACCEPT', 'ACCEPT', 'ACCEPT'], g1: ['FAIL', 'FAIL', 'FAIL'] });
  assert.deepEqual([r.missed, r.redRuns, r.falseRejects, r.greenRuns, r.agree], [2, 6, 3, 6, 2]);
  close(r.missRate, 2 / 6); close(r.falseRejectRate, 0.5); close(r.selfAgreement, 0.5);
  const calls = reviewerCalls(its, { r0: ['REJECT', 'REJECT', 'REJECT'], r1: ['REJECT', 'ABSTAIN', 'ACCEPT'], g0: ['ACCEPT', 'ACCEPT', 'ACCEPT'], g1: ['FAIL', 'FAIL', 'FAIL'] });
  assert.deepEqual(calls, { r0: 'REJECT', r1: 'ACCEPT', g0: 'ACCEPT', g1: 'REJECT' });
});

test('the bootstrap is deterministic under the seed, and a different seed moves it', () => {
  const its = items(36, 36);
  const reviewer = calls(its, 32, 4), baseline = calls(its, 20, 5);
  const a = stratifiedBootstrap(its, reviewer, baseline), b = stratifiedBootstrap(its, reviewer, baseline);
  assert.deepEqual(a, b);
  close(a.point, (32 - 20) / 72 + (5 - 4) / 72);
  assert.ok(a.lower <= a.point && a.point <= a.upper);
  const c = stratifiedBootstrap(its, reviewer, baseline, { seed: SEED + 1 });
  assert.notEqual(c.mean, a.mean, 'another seed draws other resamples');
  // The first draw of the seeded stream is pinned, so a silent PRNG change is caught.
  assert.equal(mulberry32(SEED)(), mulberry32(10010)());
  close(mulberry32(1)(), 0.6270739405881613);
});

// An independent re-implementation of the pre-registered bootstrap (its own PRNG copy, its own counting), to check an
// endpoint of the frozen scorer against a value computed another way.
function independentInterval(its, a, b, seed, B, stratified) {
  let x = seed >>> 0;
  const rnd = () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const red = its.filter(i => i.label === 'RED'), green = its.filter(i => i.label === 'GREEN');
  const ba = (calls, sample) => {
    const r = sample.filter(i => i.label === 'RED'), g = sample.filter(i => i.label === 'GREEN');
    return (r.filter(i => calls[i.id] === 'REJECT').length / r.length + g.filter(i => calls[i.id] === 'ACCEPT').length / g.length) / 2;
  };
  const d = [];
  while (d.length < B) {
    const sample = stratified
      ? [...red.map(() => red[Math.floor(rnd() * red.length)]), ...green.map(() => green[Math.floor(rnd() * green.length)])]
      : its.map(() => its[Math.floor(rnd() * its.length)]);
    if (!sample.some(i => i.label === 'RED') || !sample.some(i => i.label === 'GREEN')) continue;
    d.push(ba(a, sample) - ba(b, sample));
  }
  d.sort((p, q) => p - q);
  return { lower: d[Math.floor(0.025 * B)], upper: d[Math.ceil(0.975 * B) - 1] };
}

test('the bootstrap is class-stratified: on unbalanced, non-identical arms its endpoints match an independent computation and differ from unstratified resampling', () => {
  const its = items(6, 30);
  const reviewer = calls(its, 5, 3), baseline = calls(its, 2, 1);
  const r = stratifiedBootstrap(its, reviewer, baseline, { resamples: 4000 });
  const ind = independentInterval(its, reviewer, baseline, SEED, 4000, true);
  close(r.lower, ind.lower); close(r.upper, ind.upper);
  close(r.point, (3 / 6 - 2 / 30) / 2);
  const flat = independentInterval(its, reviewer, baseline, SEED, 4000, false);
  assert.ok(flat.lower !== r.lower || flat.upper !== r.upper, 'unstratified resampling gives another interval');
  // Against the constant 0.5 reference the difference is the reviewer's BA minus 0.5 on every resample.
  const perfect = calls(its, 6, 0);
  const ref = stratifiedBootstrap(its, perfect, 0.5, { resamples: 500 });
  assert.deepEqual([ref.point, ref.lower, ref.upper], [0.5, 0.5, 0.5]);
});

test('best baseline: highest BA within FR <= 15%; ties go to the lower FR, then tsc, eslint, prettier, churn, OR', () => {
  const its = items(20, 20);
  // churn has the highest BA but FR 20%: not eligible.
  let r = selectBestBaseline(its, { tsc: calls(its, 10, 2), churn: calls(its, 20, 4), OR: calls(its, 12, 4) });
  assert.equal(r.best.name, 'tsc');
  // Equal BA (0.75): the lower FR wins (eslint FR 0 over tsc FR 10%).
  r = selectBestBaseline(its, { tsc: calls(its, 12, 2), eslint: calls(its, 10, 0) });
  assert.equal(r.best.name, 'eslint');
  // Equal BA and equal FR: the fixed order decides, whatever order the candidates are given in.
  r = selectBestBaseline(its, { OR: calls(its, 10, 1), prettier: calls(its, 10, 1), churn: calls(its, 10, 1) });
  assert.equal(r.best.name, 'prettier');
  // FR exactly 15% is within the budget.
  r = selectBestBaseline(its, { churn: calls(its, 18, 3) });
  assert.equal(r.best.name, 'churn');
  assert.throws(() => selectBestBaseline(its, { jev: calls(its, 1, 1) }), /unknown baseline/);
});

test('when no baseline reaches FR <= 15%, the hardness gate passes and the primary compares against BA 0.5', () => {
  const its = items(10, 10);
  const runs = Object.fromEntries(its.map(i => [i.id, i.label === 'RED' ? ['REJECT', 'REJECT', 'ACCEPT'] : ['ACCEPT', 'ACCEPT', 'REJECT']]));
  const loud = calls(its, 10, 5);
  const p = primary(its, runs, { tsc: loud, eslint: loud, prettier: loud, churn: loud }, loud, { resamples: 200 });
  assert.equal(p.best, null);
  assert.equal(p.hardness.passes, true);
  assert.match(p.hardness.reason, /no baseline reaches FR <= 15%/);
  assert.equal(p.comparator, 'always-RED / prevalence-random');
  close(p.bar.difference, 0.5);
  assert.equal(p.bar.passes, true);
  assert.equal(p.paired, null);
});

test('the primary bar needs a difference >= 0.20 AND a lower bound > 0; the hardness gate fails above BA 0.75', () => {
  const its = items(36, 36);
  const runsFrom = c => Object.fromEntries(its.map(i => [i.id, c[i.id] === 'REJECT' ? ['REJECT', 'REJECT', 'ACCEPT'] : ['ACCEPT', 'ACCEPT', 'REJECT']]));
  const base = calls(its, 18, 2);
  const tools = { tsc: base, eslint: calls(its, 0, 0), prettier: calls(its, 0, 0), churn: calls(its, 0, 0) };
  const strong = primary(its, runsFrom(calls(its, 34, 2)), tools, base, { resamples: 2000 });
  assert.equal(strong.best, 'tsc');
  assert.equal(strong.hardness.passes, true);
  close(strong.bar.difference, (34 - 18) / 72);
  assert.equal(strong.bar.passes, true);
  assert.ok(strong.paired.tpr.p < 0.05 && strong.paired.tnr.p === 1);
  const weak = primary(its, runsFrom(calls(its, 22, 2)), tools, base, { resamples: 2000 });
  assert.equal(weak.bar.passes, false, 'a difference of 4/72 is below the bar');
  const easy = primary(its, runsFrom(calls(its, 36, 0)), { ...tools, tsc: calls(its, 34, 1) }, base, { resamples: 200 });
  assert.equal(easy.hardness.passes, false);
  assert.match(easy.hardness.reason, /decidable model-free/);
});

test('exact McNemar: known values', () => {
  close(mcnemarExact(0, 5).p, 0.0625);
  close(mcnemarExact(5, 0).p, 0.0625);
  close(mcnemarExact(1, 9).p, 2 * (1 + 10) / 1024);
  assert.equal(mcnemarExact(0, 0).p, 1);
  assert.equal(mcnemarExact(4, 4).p, 1);
  assert.throws(() => mcnemarExact(-1, 2), /counts/);
  const its = items(2, 2);
  assert.deepEqual(discordant(its, { r0: 'REJECT', r1: 'REJECT', g0: 'ACCEPT', g1: 'REJECT' }, { r0: 'ACCEPT', r1: 'REJECT', g0: 'REJECT', g1: 'ACCEPT' }), { b: 2, c: 1 });
});

test('Wilson intervals and the three-state label', () => {
  const w = wilson(0, 72);
  assert.equal(w.lower, 0);
  close(w.upper, 0.050651, 1e-6);
  const h = wilson(36, 72);
  close(h.lower, 0.387471, 1e-6); close(h.upper, 0.612529, 1e-6);
  assert.equal(threeState(0, 72, 0.15, 'max'), 'passes');
  assert.equal(threeState(8, 72, 0.15, 'max'), 'passes, not established at this N');
  assert.equal(threeState(12, 72, 0.15, 'max'), 'fails');
  assert.equal(threeState(72, 72, 0.9, 'min'), 'passes');
  assert.equal(threeState(60, 72, 0.9, 'min'), 'fails');
  assert.throws(() => wilson(3, 2), /0 <= k <= n/);
});

const fourTools = (its, base) => ({ tsc: base, eslint: calls(its, 0, 0), prettier: calls(its, 0, 0), churn: calls(its, 0, 0) });
const runsOf = (its, c, n = 3) => Object.fromEntries(its.map(i => [i.id, c[i.id] === 'REJECT' ? (n === 3 ? ['REJECT', 'REJECT', 'ACCEPT'] : ['REJECT', 'REJECT']) : (n === 3 ? ['ACCEPT', 'ACCEPT', 'REJECT'] : ['ACCEPT', 'ACCEPT'])]));

test('refute r1 #1: the matched budget binds the reviewer too; the 72-item counterexample (reviewer FR 33.3%, difference 0.25, lower bound 0.1528) fails', () => {
  const its = items(36, 36);
  const base = calls(its, 6, 0);
  const p = primary(its, runsOf(its, calls(its, 36, 12)), fourTools(its, base), base);
  close(p.bar.reviewerFr, 12 / 36);
  close(p.bar.difference, 0.25);
  close(p.bar.lower, 0.15277777777777768);
  assert.equal(p.hardness.passes, true);
  assert.equal(p.bar.reviewerWithinBudget, false);
  assert.equal(p.bar.passes, false, 'a reviewer above the 15% false-reject budget cannot pass');
  // The same reviewer within budget (5 of 36 = 13.9%) passes.
  const ok = primary(its, runsOf(its, calls(its, 36, 5)), fourTools(its, base), base);
  assert.equal(ok.bar.reviewerWithinBudget, true);
  assert.equal(ok.bar.passes, true);
});

test('refute r1 #3: a difference >= 0.20 whose lower bound is <= 0 fails', () => {
  const its = items(3, 3);
  const base = calls(its, 1, 0);
  const p = primary(its, runsOf(its, calls(its, 3, 0)), fourTools(its, base), base);
  close(p.bar.difference, 1 / 3);
  assert.ok(p.bar.lower <= 0, `lower ${p.bar.lower}`);
  assert.equal(p.bar.reviewerWithinBudget, true);
  assert.equal(p.bar.passes, false);
});

test('refute r1 #3: the exact boundaries hold within the 1e-12 slack: difference == 0.20 passes, hardness BA == 0.75 passes', () => {
  const its = items(20, 20);
  const base = calls(its, 8, 0);
  const at = primary(its, runsOf(its, calls(its, 16, 0)), fourTools(its, base), base, { resamples: 2000 });
  close(at.bar.difference, 0.2);
  assert.ok(at.bar.lower > 0);
  assert.equal(at.bar.passes, true, 'a difference of exactly 0.20 meets the bar');
  const below = primary(its, runsOf(its, calls(its, 15, 0)), fourTools(its, base), base, { resamples: 2000 });
  close(below.bar.difference, 0.175);
  assert.equal(below.bar.passes, false);
  const hard = calls(its, 10, 0); // BA (10/20 + 1) / 2 = 0.75 exactly
  const edge = primary(its, runsOf(its, calls(its, 20, 0)), fourTools(its, hard), hard, { resamples: 200 });
  close(edge.hardness.bestBa, 0.75);
  assert.equal(edge.hardness.passes, true, 'BA == 0.75 passes the hardness gate');
  const over = calls(its, 11, 0); // 0.775
  assert.equal(primary(its, runsOf(its, calls(its, 20, 0)), fourTools(its, over), over, { resamples: 200 }).hardness.passes, false);
});

test('refute r1 #4: the scorer runs the 2-run fallback; a 1-1 tie is no majority and is scored wrong; other schedules are refused', () => {
  const its = items(10, 10);
  const base = calls(its, 2, 0);
  const runs = runsOf(its, calls(its, 10, 0), 2);
  runs.r0 = ['REJECT', 'ACCEPT']; runs.g0 = ['ACCEPT', 'REJECT'];
  const p = primary(its, runs, fourTools(its, base), base, { runsPerItem: 2, resamples: 500 });
  assert.equal(p.runsPerItem, 2);
  assert.equal(itemMajority(['REJECT', 'ACCEPT'], 2), 'NONE');
  close(p.reviewer.tpr, 9 / 10); close(p.reviewer.fr, 1 / 10);
  close(p.runLevel.selfAgreement, 18 / 20);
  assert.throws(() => primary(its, runs, fourTools(its, base), base, { runsPerItem: 4 }), /runsPerItem/);
  assert.throws(() => primary(its, runs, fourTools(its, base), base), /expected 3 runs/);
});

test('refute r1 #5: the mapped/unmapped subgroup differences are computed per rule set and reported only', () => {
  const its = [...items(4, 4)].map((i, k) => ({ ...i, ruleId: k % 4 < 2 ? 'mapped/a' : 'unmapped/b' }));
  const reviewer = Object.fromEntries(its.map(i => [i.id, i.label === 'RED' ? 'REJECT' : 'ACCEPT']));
  const base = Object.fromEntries(its.map(i => [i.id, i.ruleId === 'mapped/a' && i.label === 'RED' ? 'REJECT' : 'ACCEPT']));
  const g = subgroupDifferences(its, reviewer, base, new Set(['mapped/a']));
  assert.deepEqual([g.mapped.items, g.unmapped.items], [4, 4]);
  close(g.mapped.difference, 0); close(g.unmapped.difference, 0.5);
  const runs = Object.fromEntries(its.map(i => [i.id, reviewer[i.id] === 'REJECT' ? ['REJECT', 'REJECT', 'REJECT'] : ['ACCEPT', 'ACCEPT', 'ACCEPT']]));
  const p = primary(its, runs, fourTools(its, base), base, { mappedRules: new Set(['mapped/a']), resamples: 200 });
  close(p.subgroups.unmapped.difference, 0.5);
  assert.throws(() => subgroupDifferences(items(1, 1), reviewer, base, new Set()), /no ruleId/);
});

test('refute r1 #6: the human spot-check sample is frozen: 8 RED + 8 GREEN by seed 10011, deterministic, independent of input order', () => {
  assert.deepEqual(SPOT_CHECK, { seed: 10011, red: 8, green: 8 });
  const its = items(36, 36);
  const a = spotCheckSample(its), b = spotCheckSample([...its].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual([a.red.length, a.green.length], [8, 8]);
  assert.ok(a.red.every(id => id.startsWith('r')) && a.green.every(id => id.startsWith('g')));
  assert.notDeepEqual(spotCheckSample(its, { seed: 10012 }), a);
  assert.throws(() => spotCheckSample(items(7, 36)), /needs 8 RED/);
});
