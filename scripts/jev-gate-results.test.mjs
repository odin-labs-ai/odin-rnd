import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertPublishable, computeResults, loadRecords, meanCosts, percentile, validateGateRun } from '../experiments/jev-gate/results.mjs';
import { FIXTURE_BANNER } from '../experiments/jev-gate/runner-guard.mjs';

// EXP 005 WO-03: the results record, checked against a fixture whose every number is worked out by hand
// below. No gate is called; the runs are synthetic and carry the FIXTURE banner.
const pinsFile = 'experiments/jev-gate/fixtures/pins.fixture.json';
const pins = JSON.parse(readFileSync(pinsFile, 'utf8'));
const records = () => loadRecords({ pins, amendmentFile: join('experiments/jev-gate/fixtures', pins.amendmentFile) });

// The hand-computed scenario (primary population = all 60 items, 30 RED / 30 GREEN):
//   Jev: misses RED c004 and c005 at confidence 0.95, abstains on RED c006 (failure, no cost), decides RED c012
//        correctly at confidence 0.7 (escalated), falsely rejects GREEN c001 at 0.6 (escalated); every other item
//        right at 0.95. Each call $0.0001 except c006 (null).
//   Reviewer (k = 3): every run right except c012 (ACCEPT, ACCEPT, REJECT -> majority ACCEPT) and c002
//        (REJECT, timeout, ACCEPT -> no majority, an abstention). $0.2 a run, except c001 run 2 (null).
const [R1, R2, R3, R4, G1, G2] = ['c004', 'c005', 'c006', 'c012', 'c001', 'c002'];

function runs(stamp, labels, { jevCost = 0.0001, reviewerPartial = null } = {}) {
  const head = gate => ({ schemaVersion: 1, kind: 'gate-run', gate, fixture: true, banner: FIXTURE_BANNER, parentSha256: stamp.parentSha256, amendmentSha256: stamp.amendmentSha256, notBefore: stamp.notBefore, items: labels.items.map(i => i.id), partial: null, calls: [] });
  const t = { startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z' };
  const jev = head('jev'), reviewer = head('reviewer');
  reviewer.pins = { patches: [] };
  reviewer.partial = reviewerPartial;
  labels.items.forEach((item, i) => {
    const right = item.label === 'RED' ? 'REJECT' : 'ACCEPT';
    let decision = right, confidence = 0.95, abstention = null, status = 'ok', costUsd = jevCost;
    if (item.id === R1 || item.id === R2) decision = 'ACCEPT';
    if (item.id === R4) confidence = 0.7;
    if (item.id === G1) { decision = 'REJECT'; confidence = 0.6; }
    if (item.id === R3) { decision = null; abstention = 'failure'; status = 'http-503'; costUsd = null; }
    const p = decision === null ? null : decision === 'REJECT' ? confidence : 1 - confidence;
    jev.calls.push({ id: item.id, run: 1, gate: 'jev', ...t, latencyMs: 100 + i, status, decision, p, confidence: decision === null ? null : confidence, abstention, costUsd, costBasis: 'listed-price', excluded: null });
    for (let k = 1; k <= 3; k += 1) {
      let d = right, harnessFailure = null, ab = null, cost = 0.2;
      if (item.id === R4 && k < 3) d = 'ACCEPT';
      if (item.id === G2) { d = ['REJECT', null, 'ACCEPT'][k - 1]; if (k === 2) { harnessFailure = 'timeout'; ab = 'failure'; } }
      if (item.id === G1 && k === 2) cost = null;
      reviewer.calls.push({ id: item.id, run: k, gate: 'reviewer', ...t, latencyMs: 1000 * k, status: harnessFailure ?? 'ok', harnessFailure, decision: d, abstention: ab, costUsd: cost, costBasis: 'api-equivalent', hook: { error: false } });
    }
  });
  return { jev, reviewer };
}


test('the results record matches the hand-computed fixture exactly', () => {
  const { prereg, amendment, stamp, labels, baselines } = records();
  const r = computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs(stamp, labels) });
  const { refuted, notEstablished, passes } = prereg.thresholdRule.states;
  const g = r.primary.gates;
  assert.equal(r.fixture, true); assert.equal(r.banner, FIXTURE_BANNER);
  assert.deepEqual([r.primary.items, r.primary.red, r.primary.green], [60, 30, 30]);
  // Jev: 3 of 30 RED missed (two accepts, one abstention), 1 of 30 GREEN falsely rejected.
  assert.deepEqual([g.jev.missedDrift.x, g.jev.missedDrift.n, g.jev.falseReject.x], [3, 30, 1]);
  assert.deepEqual(g.jev.missedIds.sort(), [R1, R2, R3].sort());
  assert.deepEqual([g.jev.abstentionRate.red.x, g.jev.decidedOnly.missedDrift.x, g.jev.decidedOnly.missedDrift.n], [1, 2, 29]);
  assert.equal(g.jev.agreement.x, 56);
  // High confidence: 57 decided items at >= 0.9 (60 less c006, c012, c001), 2 of them wrong.
  assert.deepEqual([g.jev.accuracyAtHighConfidence.x, g.jev.accuracyAtHighConfidence.n], [55, 57]);
  // Reviewer majority: misses c012, abstains on c002.
  assert.deepEqual([g.reviewer.missedDrift.x, g.reviewer.falseReject.x, g.reviewer.abstentionRate.green.x], [1, 1, 1]);
  assert.equal(g.reviewer.reviewerVariance.items.x, 2);
  assert.deepEqual(g.reviewer.reviewerVariance.perRunIndex.map(p => [p.missedDrift.x, p.falseReject.x]), [[1, 1], [1, 1], [0, 0]]);
  // Cascade: escalates c006, c012, c001; misses c004, c005 (Jev) and c012 (reviewer); no false reject.
  assert.deepEqual([g.cascade.escalation.x, g.cascade.missedDrift.x, g.cascade.falseReject.x], [3, 3, 0]);
  // Criteria.
  const c = Object.fromEntries(r.criteria.map(x => [x.id, x]));
  assert.equal(c['jev-missed-drift'].state, notEstablished, '3/30 = 0.1 is not above 0.1, its upper bound is');
  assert.equal(c['jev-false-reject'].state, passes, '1/30: upper bound 0.167 is under 0.25');
  assert.deepEqual(c['cascade-vs-reviewer'].table, { a: 1, b: 2, c: 0, d: 27 });
  assert.equal(c['cascade-vs-reviewer'].state, refuted);
  assert.deepEqual(c['jev-vs-best-baseline'].table, { a: 0, b: 3, c: 0, d: 27 });
  assert.equal(c['jev-vs-best-baseline'].state, refuted);
  // Cost: cascade = (60 x 0.0001 [c006 imputed] + 9 escalated runs x 0.2 [c001 run 2 imputed]) / 60 = 0.0301;
  // reviewer alone = (180 x 0.2 - 0.2 [missing counts 0]) / 60 = 0.59667.
  assert.ok(Math.abs(c['cascade-cost'].cascadeMean - 0.0301) < 1e-12);
  assert.ok(Math.abs(c['cascade-cost'].reviewerMean - 35.8 / 60) < 1e-12);
  assert.equal(c['cascade-cost'].state, passes);
  assert.equal(r.claim.refuted, true);
  // Latency, numpy-style percentiles.
  assert.equal(r.latency.reviewer.p50Ms, 2000);
  assert.equal(r.latency.jev.p50Ms, 129.5);
  // Spotlight: run-level missed drift 2/90, false reject 2/90; item level 1/30 each; self-agreement 58/60;
  // harness failures 1/180; no patch.
  const s = Object.fromEntries(r.spotlight.criteria.map(x => [x.id, x]));
  assert.deepEqual([s['missed-drift'].runLevel.x, s['missed-drift'].runLevel.n, s['missed-drift'].itemLevel.interval.x], [2, 90, 1]);
  assert.equal(s['missed-drift'].itemLevel.state, notEstablished);
  assert.equal(s['false-reject'].itemLevel.state, passes);
  assert.deepEqual([s['self-agreement'].x, s['self-agreement'].n], [58, 60]);
  assert.deepEqual([s['zero-patches'].harnessFailures.x, s['zero-patches'].harnessFailures.n], [1, 180]);
  assert.equal(r.spotlight.verdict, 'PASS');
  assert.equal(r.spotlight.notEstablishedPhrase, notEstablished);
});

test('spotlight thresholds come from the amendment alone', () => {
  const { prereg, amendment, stamp, labels, baselines } = records();
  const strict = structuredClone(amendment);
  strict.changes.spotlight.criteria.find(x => x.id === 'self-agreement').threshold = 0.99;
  const r = computeResults({ prereg, amendment: strict, stamp, labels, baselines, runs: runs(stamp, labels) });
  assert.equal(r.spotlight.verdict, 'FAIL');
  assert.deepEqual(r.spotlight.reasons, ['self-agreement does not hold']);
  const failing = structuredClone(amendment);
  failing.changes.spotlight.criteria.find(x => x.id === 'zero-patches').harnessFailureMax = 0;
  assert.equal(computeResults({ prereg, amendment: failing, stamp, labels, baselines, runs: runs(stamp, labels) }).spotlight.verdict, 'FAIL');
  // A local patch fails zero-patches whatever the failure rate.
  const patched = runs(stamp, labels); patched.reviewer.pins.patches = ['edited .claude/agents/reviewer.md'];
  assert.equal(computeResults({ prereg, amendment, stamp, labels, baselines, runs: patched }).spotlight.verdict, 'FAIL');
});

test('a partial run gives no criterion a state, decides nothing and gives no spotlight', () => {
  const { prereg, amendment, stamp, labels, baselines } = records();
  const r = computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs(stamp, labels, { reviewerPartial: { reason: 'spend-cap' } }) });
  assert(r.criteria.every(c => c.state === null));
  assert.equal(r.claim.refuted, null);
  assert.equal(r.spotlight.verdict, 'FAIL');
  assert.deepEqual(r.partial, [{ gate: 'reviewer', reason: 'spend-cap' }]);
});

test('a truncated, killed, split or over-k run is partial from coverage alone, even with partial:null (refute B1, N5)', () => {
  const { prereg, amendment, stamp, labels, baselines } = records();
  const score = r => computeResults({ prereg, amendment, stamp, labels, baselines, runs: r });

  // Half the corpus, with partial:null (a crash that left the field unset): no criterion state, no spotlight.
  const half = runs(stamp, labels);
  const keep = new Set(labels.items.slice(0, 30).map(i => i.id));
  half.reviewer.calls = half.reviewer.calls.filter(c => keep.has(c.id));
  half.reviewer.partial = null;
  const rHalf = score(half);
  assert(rHalf.criteria.every(c => c.state === null), 'half-covered gives no criterion a state');
  assert.equal(rHalf.claim.refuted, null);
  assert.equal(rHalf.spotlight.verdict, 'FAIL');
  assert.deepEqual(rHalf.partial.map(p => [p.gate, p.reason]), [['reviewer', 'incomplete-coverage']]);

  // A killed run: the runner leaves partial:{reason:'in-progress'} on its last save.
  const killed = runs(stamp, labels);
  killed.reviewer.partial = { reason: 'in-progress' };
  assert.deepEqual(score(killed).partial, [{ gate: 'reviewer', reason: 'in-progress' }]);

  // A split invocation: one item is one run short (2 of k=3).
  const split = runs(stamp, labels);
  const drop = labels.items[0].id;
  split.reviewer.calls = split.reviewer.calls.filter(c => !(c.id === drop && c.run === 3));
  assert(score(split).partial.some(p => p.reason === 'incomplete-coverage'), 'a short item is incomplete');

  // More than k runs on an item (a merged record) skews the majority, so it is incomplete too (N5).
  const merged = runs(stamp, labels);
  merged.reviewer.calls.push({ ...merged.reviewer.calls.find(c => c.id === drop && c.run === 1), run: 4 });
  assert(score(merged).partial.some(p => p.reason === 'incomplete-coverage'), 'over-k is incomplete');

  // A typed gate missing items is partial as well.
  const jevShort = runs(stamp, labels);
  jevShort.jev.calls = jevShort.jev.calls.slice(0, 50);
  assert(score(jevShort).partial.some(p => p.gate === 'jev' && p.reason === 'incomplete-coverage'));
});

test('no recorded cost gives judgeCost null, never undefined or NaN, and the cost criterion is refuted', () => {
  const { prereg, amendment, stamp, labels, baselines } = records();
  const r = computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs(stamp, labels, { jevCost: null }) });
  const cost = r.criteria.find(c => c.id === 'cascade-cost');
  assert.equal(cost.cascadeMean, null);
  assert.equal(cost.ratio, null);
  assert.equal(cost.state, prereg.thresholdRule.states.refuted);
  assert.deepEqual(meanCosts({ ids: [] }, {}, {}, new Set()), { cascade: null, reviewerAlone: null, basis: 'mixed-basis: Jev listed price + reviewer API-equivalent', imputedJevAt: null, imputedReviewerAt: null });
});

test('the FIXTURE banner blocks publication, and no site file carries it', () => {
  const { prereg, amendment, stamp, labels, baselines } = records();
  const r = computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs(stamp, labels) });
  assert.throws(() => assertPublishable(r), /FIXTURE/);
  assert.throws(() => assertPublishable({ ...r, fixture: false }), /FIXTURE/, 'the banner alone blocks it');
  assert.throws(() => assertPublishable({ fixture: false, note: FIXTURE_BANNER }), /FIXTURE/);
  assert.doesNotThrow(() => assertPublishable({ fixture: false, value: 1 }));
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of walk('site').filter(f => /\.(json|html|js|mjs|svg|txt|md)$/.test(f))) {
    assert.ok(!readFileSync(file, 'utf8').includes(FIXTURE_BANNER), `${file} carries the FIXTURE banner`);
  }
});

test('the run schema refuses undefined costs, key material and mismatched abstentions', () => {
  const { stamp, labels } = records();
  const good = runs(stamp, labels);
  assert.doesNotThrow(() => validateGateRun(good.jev));
  const bad = structuredClone(good.jev); bad.calls[0].costUsd = undefined;
  assert.throws(() => validateGateRun(bad), /costUsd/);
  const nan = structuredClone(good.reviewer); nan.calls[0].costUsd = Number.NaN;
  assert.throws(() => validateGateRun(nan), /costUsd/);
  const key = structuredClone(good.jev); key.calls[0].status = 'Authorization: Bearer x';
  assert.throws(() => validateGateRun(key), /header or key/);
  const ab = structuredClone(good.reviewer); ab.calls[0].abstention = 'model';
  assert.throws(() => validateGateRun(ab), /abstention/);
  const noBanner = structuredClone(good.jev); delete noBanner.banner;
  assert.throws(() => validateGateRun(noBanner), /FIXTURE banner/);
});

test('percentiles match numpy linear interpolation', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([10, 20, 30, 40, 50], 90), 46);
  assert.equal(percentile([], 50), null);
});

test('no spotlight threshold is written in the runner or metrics code', () => {
  const { amendment } = records();
  const values = amendment.changes.spotlight.criteria.flatMap(c => [c.threshold, c.harnessFailureMax]).filter(v => typeof v === 'number');
  const files = ['results.mjs', 'run_reviewer.mjs', 'runner-guard.mjs', 'run_gates.py'].map(f => `experiments/jev-gate/${f}`);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const v of values) assert.doesNotMatch(src, new RegExp(`(?<![\\w.])${String(v).replace('.', '\\.')}(?![\\w.])`), `${file} states ${v}`);
  }
});

test('the committed runner outputs (fake Jev server, fake Laya model, fake claude) keep the run schema and stay FIXTURE', () => {
  const dir = 'experiments/jev-gate/fixtures/gate-runs';
  const files = readdirSync(dir).filter(f => f.endsWith('.fixture.json')).sort();
  assert.deepEqual(files, ['jev.fixture.json', 'laya.fixture.json', 'reviewer.fixture.json']);
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8'), run = JSON.parse(raw);
    validateGateRun(run);
    assert.equal(run.fixture, true, `${f} is a fixture`);
    assert.equal(run.parentSha256, '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a');
    assert.doesNotMatch(raw, /Bearer |sk_[A-Za-z0-9_-]{8,}|\/Users\/|\/private\/|\/var\/folders/, `${f}: credential or local path`);
  }
});
