// EXP 005 results (bundle 3 WO-03, as amended by REVISION-5 and its sections 5.1 and 5.2): the run-record schema, every
// pre-registered metric, the five criteria, and the nina spotlight verdict.
//
// Thresholds, the confidence level and z come only from the two records: preregistration.json for the
// metrics and the five criteria, amendment-01.json for the spotlight. The interval and verdict arithmetic is
// metrics.mjs (pinned by sha in the pre-registration); this file only counts and calls it.
// loadRecords() goes through runner-guard.mjs, so both shas are asserted before a verdict is computed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineValid, judgeCost, judgePaired, judgeSingleRate, wilson } from './metrics.mjs';
import { checkPreflightForScoring, checkRecords, FIXTURE_BANNER, REPO_ROOT } from './runner-guard.mjs';

const DIR = join(REPO_ROOT, 'experiments', 'jev-gate');
const DECISIONS = ['ACCEPT', 'REJECT'];

// ----------------------------------------------------------------------------- schema

const isStr = v => typeof v === 'string' && v.length > 0;
const isNumOrNull = v => v === null || (typeof v === 'number' && Number.isFinite(v));

/** The shape every runner writes (run_gates.py, run_reviewer.mjs). Throws with the first problem found. */
export function validateGateRun(run) {
  const where = `gate run ${run?.gate ?? '?'}`;
  assert.equal(run?.schemaVersion, 1, `${where}: schemaVersion`);
  assert.equal(run.kind, 'gate-run', `${where}: kind`);
  assert(['jev', 'laya', 'reviewer'].includes(run.gate), `${where}: gate`);
  assert.equal(typeof run.fixture, 'boolean', `${where}: fixture flag`);
  if (run.fixture) assert.equal(run.banner, FIXTURE_BANNER, `${where}: a fixture run carries the FIXTURE banner`);
  for (const k of ['parentSha256', 'amendmentSha256']) assert.match(run[k] ?? '', /^[0-9a-f]{64}$/, `${where}: ${k}`);
  if (run.amendment02Sha256 != null) assert.match(run.amendment02Sha256, /^[0-9a-f]{64}$/, `${where}: amendment02Sha256`);
  assert(isStr(run.notBefore) && Number.isFinite(Date.parse(run.notBefore)), `${where}: notBefore`);
  assert(run.partial === null || isStr(run.partial?.reason), `${where}: partial is null or has a reason`);
  assert(Array.isArray(run.items) && Array.isArray(run.calls), `${where}: items and calls`);
  for (const c of run.calls) {
    const w = `${where} ${c.id} run ${c.run}`;
    assert(isStr(c.id) && Number.isInteger(c.run) && c.run >= 1, `${w}: id and run`);
    if (c.stageError) continue; // a workspace that could not be built; the run stops there
    assert.equal(c.gate, run.gate, `${w}: gate`);
    assert(isStr(c.startedAt) && isStr(c.endedAt), `${w}: start and end time`);
    assert(isNumOrNull(c.latencyMs), `${w}: latencyMs`);
    assert(c.decision === null || DECISIONS.includes(c.decision), `${w}: decision`);
    assert(c.decision === null ? ['model', 'failure'].includes(c.abstention) : c.abstention === null, `${w}: abstention matches decision`);
    assert(isNumOrNull(c.costUsd), `${w}: costUsd is a number or null, never undefined or NaN`);
    assert(isStr(c.costBasis), `${w}: costBasis`);
    assert(c.excluded === undefined || c.excluded === null || isStr(c.excluded), `${w}: excluded`);
    if (run.gate !== 'reviewer') {
      assert(c.run === 1, `${w}: one call per item`);
      if (c.decision) assert(typeof c.p === 'number' && typeof c.confidence === 'number', `${w}: p and confidence`);
      assert.doesNotMatch(JSON.stringify(c), /Bearer |Authorization/i, `${w}: no header or key`);
    } else {
      assert(c.harnessFailure === null || isStr(c.harnessFailure), `${w}: harnessFailure`);
      if (c.harnessFailure) assert.equal(c.abstention, 'failure', `${w}: a harness failure is a failure abstention`);
    }
  }
  return run;
}

// ----------------------------------------------------------------------------- helpers

const rate = (x, n, z) => ({ x, n, ...(wilson(x, n, z) ?? { estimate: null, lower: null, upper: null }) });

/** Linear-interpolation percentile (numpy's default), q in 0..100. */
export function percentile(values, q) {
  const xs = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * q / 100, lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Items of a population, split by bce's label. */
export function population(labels, which) {
  const labelled = labels.items.filter(i => i.label === 'RED' || i.label === 'GREEN');
  const items = which === 'primary' ? labelled.filter(i => !i.disagree) : labelled;
  return { ids: items.map(i => i.id), red: items.filter(i => i.label === 'RED').map(i => i.id), green: items.filter(i => i.label === 'GREEN').map(i => i.id), label: Object.fromEntries(items.map(i => [i.id, i.label])) };
}

/** One call per item for a typed gate. An excluded call (clock) counts as an abstention and is listed. */
function typedDecisions(run) {
  const out = {};
  for (const c of run?.calls ?? []) out[c.id] = { decision: c.excluded ? null : c.decision, confidence: c.excluded ? null : c.confidence ?? null, call: c };
  return out;
}

/** The reviewer's runs per item (counted runs only), and its majority: more than half of k runs. */
function reviewerDecisions(run, k) {
  const byItem = {};
  for (const c of run?.calls ?? []) if (!c.stageError) (byItem[c.id] ??= []).push(c);
  const out = {};
  for (const [id, runs] of Object.entries(byItem)) {
    const decisions = runs.map(r => (r.excluded ? null : r.decision));
    const majority = DECISIONS.find(d => decisions.filter(x => x === d).length > k / 2) ?? null;
    out[id] = { decision: majority, runs, decisions };
  }
  return out;
}

/** Headline and decided-only rates for one gate's per-item decisions over a population. */
function gateMetrics(prereg, pop, decide) {
  const z = prereg.statistics.z;
  const comment = new Set(prereg.commentOnlyRed.ids);
  const missed = pop.red.filter(id => decide(id) !== 'REJECT');
  const falseRej = pop.green.filter(id => decide(id) !== 'ACCEPT');
  const abstRed = pop.red.filter(id => decide(id) === null), abstGreen = pop.green.filter(id => decide(id) === null);
  const decidedRed = pop.red.filter(id => decide(id) !== null), decidedGreen = pop.green.filter(id => decide(id) !== null);
  const codeRed = pop.red.filter(id => !comment.has(id)), commentRed = pop.red.filter(id => comment.has(id));
  return {
    agreement: rate(pop.ids.filter(id => decide(id) === (pop.label[id] === 'RED' ? 'REJECT' : 'ACCEPT')).length, pop.ids.length, z),
    missedDrift: rate(missed.length, pop.red.length, z),
    falseReject: rate(falseRej.length, pop.green.length, z),
    abstentionRate: { red: rate(abstRed.length, pop.red.length, z), green: rate(abstGreen.length, pop.green.length, z), all: rate(abstRed.length + abstGreen.length, pop.ids.length, z) },
    decidedOnly: {
      missedDrift: rate(decidedRed.filter(id => decide(id) === 'ACCEPT').length, decidedRed.length, z),
      falseReject: rate(decidedGreen.filter(id => decide(id) === 'REJECT').length, decidedGreen.length, z),
    },
    missedDriftSplit: {
      codeLevel: rate(codeRed.filter(id => decide(id) !== 'REJECT').length, codeRed.length, z),
      commentOnly: rate(commentRed.filter(id => decide(id) !== 'REJECT').length, commentRed.length, z),
    },
    missedIds: missed, falseRejectIds: falseRej,
  };
}

function latency(calls) {
  const ms = calls.filter(c => !c.stageError).map(c => c.latencyMs);
  return { p50Ms: percentile(ms, 50), p90Ms: percentile(ms, 90), calls: ms.filter(v => typeof v === 'number').length };
}

// Paired 2x2 of misses on the same RED items: a = both miss, b = only the first, c = only the other, d = neither.
function pairedTable(red, firstMisses, otherMisses) {
  const t = { a: 0, b: 0, c: 0, d: 0 };
  for (const id of red) {
    const f = firstMisses(id), o = otherMisses(id);
    t[f && o ? 'a' : f ? 'b' : o ? 'c' : 'd'] += 1;
  }
  return t;
}

// ----------------------------------------------------------------------------- cost

/**
 * meanCostPerChange as pre-registered. Cascade: Jev's listed-price cost on every item plus the reviewer's
 * API-equivalent cost of all k runs on escalated items; a missing Jev cost or escalated-run cost is imputed at
 * the largest recorded per-call cost for that gate; a gate the cascade uses with no recorded cost at all gives
 * null (nothing to impute). Reviewer alone: all k runs on every item, a missing cost counted as 0.
 * Always a number or null, never undefined or NaN.
 */
export function meanCosts(pop, jev, reviewer, escalated) {
  const jevCosts = Object.values(jev).map(v => v.call?.costUsd).filter(v => typeof v === 'number');
  const revCosts = Object.values(reviewer).flatMap(v => v.runs.map(r => r.costUsd)).filter(v => typeof v === 'number');
  const jevMax = jevCosts.length ? Math.max(...jevCosts) : null, revMax = revCosts.length ? Math.max(...revCosts) : null;
  const usesReviewer = pop.ids.some(id => escalated.has(id));
  let cascade = null;
  if (pop.ids.length && jevMax !== null && (!usesReviewer || revMax !== null)) {
    cascade = mean(pop.ids.map(id => {
      const jc = jev[id]?.call?.costUsd;
      let cost = typeof jc === 'number' ? jc : jevMax;
      if (escalated.has(id)) for (const r of reviewer[id]?.runs ?? []) cost += typeof r.costUsd === 'number' ? r.costUsd : revMax;
      return cost;
    }));
  }
  const reviewerAlone = pop.ids.length ? mean(pop.ids.map(id => (reviewer[id]?.runs ?? []).reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0))) : null;
  for (const v of [cascade, reviewerAlone]) assert(v === null || Number.isFinite(v), 'a mean cost is a number or null');
  return { cascade, reviewerAlone, basis: 'mixed-basis: Jev listed price + reviewer API-equivalent', imputedJevAt: jevMax, imputedReviewerAt: revMax };
}

function costPer1000(calls, basis) {
  const costs = calls.filter(c => !c.stageError).map(c => c.costUsd);
  const known = costs.filter(v => typeof v === 'number');
  return { usd: known.length ? mean(known) * 1000 : null, basis, callsWithCost: known.length, callsWithoutCost: costs.length - known.length };
}

// ----------------------------------------------------------------------------- the spotlight

/**
 * The four spotlight criteria of the amendment, on the reviewer's counted runs over the population
 * (REVISION-5 and 5.1–5.2). Every threshold is read from amendment.changes.spotlight.criteria.
 */
export function spotlightVerdict(prereg, amendment, pop, reviewer, reviewerRun, partial) {
  const z = prereg.statistics.z;
  const crit = Object.fromEntries(amendment.changes.spotlight.criteria.map(c => [c.id, c]));
  const { refuted, notEstablished, passes } = prereg.thresholdRule.states;
  const runsOf = ids => ids.flatMap(id => reviewer[id]?.runs ?? []);
  const dec = r => (r.excluded ? null : r.decision);
  // Item-level three-state label on the majority (n = items), REVISION-5.1 §5 and 5.2 §3.
  const label = (x, n, threshold) => {
    const w = wilson(x, n, z);
    if (!w) return { state: 'no items', interval: null };
    return { state: w.estimate > threshold ? refuted : w.upper > threshold ? notEstablished : passes, interval: w };
  };
  const rateCriterion = (c, ids, wrong) => {
    assert.equal(c.refutedWhen, 'greater-than', `spotlight ${c.id}: refutedWhen`);
    const runs = runsOf(ids);
    const runLevel = rate(runs.filter(r => wrong(dec(r))).length, runs.length, z);
    const items = label(ids.filter(id => wrong(reviewer[id]?.decision ?? null)).length, ids.length, c.threshold);
    const holds = runLevel.n > 0 && !(runLevel.estimate > c.threshold) && items.state !== refuted;
    return { id: c.id, threshold: c.threshold, runLevel, itemLevel: items, holds };
  };
  const missed = rateCriterion(crit['missed-drift'], pop.red, d => d !== 'REJECT');
  const falseRej = rateCriterion(crit['false-reject'], pop.green, d => d !== 'ACCEPT');

  const sa = crit['self-agreement'];
  assert.equal(sa.refutedWhen, 'less-than', 'spotlight self-agreement: refutedWhen');
  // A change agrees only when all k runs gave the same DECIDED verdict; any abstaining run disagrees (5.1 §3).
  const agreeing = pop.ids.filter(id => { const d = (reviewer[id]?.runs ?? []).map(dec); return d.length === prereg.gates.reviewer.k && d[0] !== null && d.every(x => x === d[0]); });
  const selfAgreement = { id: sa.id, threshold: sa.threshold, ...rate(agreeing.length, pop.ids.length, z) };
  selfAgreement.holds = selfAgreement.n > 0 && !(selfAgreement.estimate < sa.threshold);

  const zp = crit['zero-patches'];
  // Harness failures over all counted runs (5.1 §4); probes and dry-run rows are not in a counted run record.
  const counted = (reviewerRun?.calls ?? []).filter(c => !c.stageError);
  const failures = counted.filter(c => c.harnessFailure);
  const hookErrors = counted.filter(c => c.hook?.error);
  const patches = reviewerRun?.pins?.patches;
  const zeroPatches = {
    id: zp.id, harnessFailureMax: zp.harnessFailureMax, patches: patches ?? null,
    harnessFailures: rate(failures.length, counted.length, z), byReason: Object.fromEntries([...new Set(failures.map(f => f.harnessFailure))].map(r => [r, failures.filter(f => f.harnessFailure === r).length])),
    hookErrors: rate(hookErrors.length, counted.length, z),
  };
  zeroPatches.holds = Array.isArray(patches) && patches.length === 0 && counted.length > 0 && !(failures.length / counted.length > zp.harnessFailureMax);

  // Where the amendment states a criterion's denominator, a run over a different number is no spotlight run.
  const denominators = { 'missed-drift': missed.runLevel.n, 'false-reject': falseRej.runLevel.n, 'self-agreement': selfAgreement.n, 'zero-patches': zeroPatches.harnessFailures.n };
  for (const c of [missed, falseRej, selfAgreement, zeroPatches]) {
    const want = crit[c.id].n;
    c.denominatorAsRegistered = want === undefined || want === denominators[c.id];
    if (!c.denominatorAsRegistered) c.holds = false;
  }
  const criteria = [missed, falseRej, selfAgreement, zeroPatches];
  const verdict = partial ? 'FAIL' : criteria.every(c => c.holds) ? 'PASS' : 'FAIL';
  return {
    verdict, partial: Boolean(partial), criteria,
    reasons: partial ? ['a partial run gives no spotlight'] : criteria.filter(c => !c.holds).map(c => `${c.id} does not hold${c.denominatorAsRegistered ? '' : ' (denominator differs from the amendment)'}`),
    notEstablishedPhrase: [missed, falseRej].some(c => c.itemLevel.state === notEstablished) ? notEstablished : null,
  };
}

/** Null if the run covers the scored corpus with the required calls per item; otherwise the first gap found. */
function coverageGap(run, corpusIds, k) {
  const need = new Set(corpusIds);
  const runsById = {};
  for (const c of run.calls) {
    if (c.stageError) return `workspace stage error at ${c.id} run ${c.run}`;
    (runsById[c.id] ??= []).push(c.run);
  }
  for (const id of need) {
    const got = (runsById[id] ?? []).slice().sort((a, b) => a - b);
    if (run.gate === 'reviewer') {
      const want = Array.from({ length: k }, (_, i) => i + 1);
      if (got.length !== k || want.some((w, i) => got[i] !== w)) return `item ${id} has reviewer runs [${got.join(',')}], not 1..${k}`;
    } else if (got.length !== 1 || got[0] !== 1) {
      return `item ${id} has ${got.length} ${run.gate} calls, not one`;
    }
  }
  for (const id of Object.keys(runsById)) if (!need.has(id)) return `item ${id} is not in the scored corpus`;
  return null;
}

// ----------------------------------------------------------------------------- the whole record

/**
 * Every metric, the five criteria and the spotlight, from verified records and the gate runs.
 * runs: {jev, laya, reviewer}; any may be missing (a gate not run), which the record states.
 */
export function computeResults({ prereg, amendment, stamp, labels, baselines, runs, preflight }) {
  for (const r of Object.values(runs)) if (r) validateGateRun(r);
  const z = prereg.statistics.z, k = prereg.gates.reviewer.k;
  const corpusIds = population(labels, 'sensitivity').ids;
  for (const r of Object.values(runs)) if (r) {
    assert.equal(r.parentSha256, stamp.parentSha256, `${r.gate} run was made under another parent`);
    assert.equal(r.amendmentSha256, stamp.amendmentSha256, `${r.gate} run was made under another amendment`);
    assert.equal(r.fixture, stamp.fixture, `${r.gate} run and the records disagree on fixture mode`);
    if (!stamp.fixture) {
      // A counted results computation re-checks what the runners enforced (refute N4): the run was made by the
      // frozen code, in counted mode, under amendment 02's clock and sha, and no call started before the not-before.
      assert.deepEqual(r.code, stamp.code, `${r.gate} run was made by other runner code than the frozen one`);
      assert.equal(r.mode, 'counted', `${r.gate} run is not a counted run (mode ${r.mode})`);
      assert.equal(r.notBefore, stamp.notBefore, `${r.gate} run has a different not-before time`);
      assert.equal(r.amendment02Sha256 ?? null, stamp.amendment02Sha256 ?? null, `${r.gate} run was made under another amendment 02`);
      const firstCall = r.calls.find(c => !c.stageError);
      for (const c of r.calls) if (!c.stageError) assert.ok(Date.parse(c.startedAt) > Date.parse(r.notBefore), `${r.gate} ${c.id} run ${c.run} started at ${c.startedAt}, not after the not-before time`);
      // The counted run committed to a pre-flight record, committed WITH the results here. Re-check it against what
      // the RUN recorded — the record's self-sha, kind/mode/ok/no-override/empty-copies, its runnersSha256 against
      // the run's OWN code pins, its head and roots against what the run stamped, and the endedAt window before this
      // gate's first call — NEVER against the scorer's live git HEAD, temp roots or a path on disk. That is what lets
      // a committed run re-score after more commits, in a fresh checkout and under any TMPDIR (refute r5-B1). A
      // rehearsal carries a record and goes through this SAME check (no exemption).
      checkPreflightForScoring({ record: preflight, run: r, firstCallStartedAt: firstCall?.startedAt });
    }
  }
  // A run whose calls do not cover the scored corpus with the required calls per item (reviewer: exactly runs
  // 1..k) is partial, whatever its `partial` field says: a crash that left partial:null, or a split invocation,
  // must give no criterion a state and no spotlight (refute B1, N5).
  const partialRuns = [];
  for (const r of Object.values(runs)) {
    if (!r) continue;
    if (r.partial) { partialRuns.push({ gate: r.gate, ...r.partial }); continue; }
    const gap = coverageGap(r, corpusIds, k);
    if (gap) partialRuns.push({ gate: r.gate, reason: 'incomplete-coverage', detail: gap });
  }
  const partial = partialRuns.length > 0;
  const jev = typedDecisions(runs.jev), laya = typedDecisions(runs.laya), reviewer = reviewerDecisions(runs.reviewer, k);
  const baselineList = Object.entries(baselines.baselines).map(([id, b]) => ({ id, ...b }));
  const best = baselineList.find(b => b.id === prereg.bestBaseline.id);
  assert(best, 'the pre-registered best baseline is in baselines.json');

  const build = which => {
    const pop = population(labels, which);
    const thr = prereg.cascade.confidenceThreshold;
    const escalated = new Set(pop.ids.filter(id => !(jev[id]?.decision && jev[id].confidence >= thr)));
    const cascadeDecision = id => (escalated.has(id) ? reviewer[id]?.decision ?? null : jev[id].decision);
    const gates = {
      jev: runs.jev ? gateMetrics(prereg, pop, id => jev[id]?.decision ?? null) : null,
      laya: runs.laya ? gateMetrics(prereg, pop, id => laya[id]?.decision ?? null) : null,
      reviewer: runs.reviewer ? gateMetrics(prereg, pop, id => reviewer[id]?.decision ?? null) : null,
      cascade: runs.jev && runs.reviewer ? { ...gateMetrics(prereg, pop, cascadeDecision), escalation: rate(escalated.size, pop.ids.length, z) } : null,
    };
    for (const b of baselineList) gates[b.id] = gateMetrics(prereg, pop, id => (b.predictions[id] === 'RED' ? 'REJECT' : b.predictions[id] === 'GREEN' ? 'ACCEPT' : null));
    for (const g of ['jev', 'laya']) if (gates[g]) {
      const hi = pop.ids.filter(id => (g === 'jev' ? jev : laya)[id]?.decision && (g === 'jev' ? jev : laya)[id].confidence >= thr);
      const d = g === 'jev' ? jev : laya;
      gates[g].accuracyAtHighConfidence = rate(hi.filter(id => d[id].decision === (pop.label[id] === 'RED' ? 'REJECT' : 'ACCEPT')).length, hi.length, z);
    }
    if (gates.reviewer) {
      const varied = pop.ids.filter(id => { const d = reviewer[id]?.decisions ?? []; return d.length !== k || d.some(x => x !== d[0]) || d[0] === null; });
      gates.reviewer.reviewerVariance = {
        items: rate(varied.length, pop.ids.length, z),
        perRunIndex: Array.from({ length: k }, (_, i) => {
          const at = id => { const r = (reviewer[id]?.runs ?? []).find(x => x.run === i + 1); return r && !r.excluded ? r.decision : null; };
          return { run: i + 1, missedDrift: rate(pop.red.filter(id => at(id) !== 'REJECT').length, pop.red.length, z), falseReject: rate(pop.green.filter(id => at(id) !== 'ACCEPT').length, pop.green.length, z) };
        }),
      };
    }
    return { pop, gates, escalated, cascadeDecision };
  };

  const primary = build('primary'), sensitivity = build('sensitivity');
  const { pop, gates, escalated, cascadeDecision } = primary;
  const costs = runs.jev && runs.reviewer ? meanCosts(pop, jev, reviewer, escalated) : { cascade: null, reviewerAlone: null, basis: 'not computed: a gate was not run' };

  // The five criteria; a partial run gives no criterion a state.
  const miss = { jev: id => jev[id]?.decision !== 'REJECT', cascade: id => cascadeDecision(id) !== 'REJECT', reviewer: id => reviewer[id]?.decision !== 'REJECT', bestBaseline: id => best.predictions[id] !== 'RED' };
  const criteria = prereg.criteria.map(c => {
    const base = { id: c.id, kind: c.kind, statement: c.statement };
    if (partial) return { ...base, state: null, note: 'partial run: no state' };
    if (c.kind === 'single-rate') {
      const m = gates[c.gate]?.[c.metric];
      return m ? { ...base, ...judgeSingleRate(prereg, c, m.x, m.n) } : { ...base, state: null, note: `${c.gate} not run` };
    }
    if (c.kind === 'paired-difference') {
      if (!gates[c.gate === 'cascade' ? 'cascade' : c.gate] || (c.comparedWith === 'reviewer' && !gates.reviewer)) return { ...base, state: null, note: 'a gate was not run' };
      const table = pairedTable(pop.red, miss[c.gate], miss[c.comparedWith]);
      if (c.comparedWith === 'reviewer' && !baselineValid(prereg, gates.reviewer.missedDrift.x, gates.reviewer.missedDrift.n)) {
        return { ...base, table, state: 'uninformative', note: prereg.baselineValidity.consequence };
      }
      return { ...base, table, ...judgePaired(prereg, c, table) };
    }
    return { ...base, cascadeMean: costs.cascade, reviewerMean: costs.reviewerAlone, basis: costs.basis, ...judgeCost(prereg, c, costs.cascade ?? null, costs.reviewerAlone ?? null) };
  });
  const layaCriteria = runs.laya && !partial ? prereg.criteria.filter(c => c.kind === 'single-rate').map(c => ({ id: c.id.replace(/^jev/, 'laya'), ...judgeSingleRate(prereg, c, gates.laya[c.metric].x, gates.laya[c.metric].n) })) : null;
  const refutedState = prereg.thresholdRule.states.refuted;

  const record = {
    schemaVersion: 1, kind: 'results', experiment: prereg.experiment.id,
    fixture: stamp.fixture, ...(stamp.fixture ? { banner: FIXTURE_BANNER } : {}),
    ...(Object.values(runs).some(r => r?.rehearsal) ? { rehearsal: true } : {}),
    parentSha256: stamp.parentSha256, amendmentSha256: stamp.amendmentSha256, notBefore: stamp.notBefore, code: stamp.code,
    partial: partial ? partialRuns : null,
    gatesRun: Object.fromEntries(['jev', 'laya', 'reviewer'].map(g => [g, Boolean(runs[g])])),
    primary: { items: pop.ids.length, red: pop.red.length, green: pop.green.length, gates },
    sensitivity: { items: sensitivity.pop.ids.length, gates: sensitivity.gates },
    latency: Object.fromEntries(['jev', 'laya', 'reviewer'].filter(g => runs[g]).map(g => [g, latency(runs[g].calls)])),
    costPer1000: {
      jev: runs.jev ? costPer1000(runs.jev.calls, prereg.cost.jev.basis) : null,
      reviewer: runs.reviewer ? (() => { const per = costPer1000(runs.reviewer.calls, prereg.cost.reviewer.basis); return { ...per, usd: per.usd === null ? null : per.usd * k, note: 'per decision = k runs' }; })() : null,
      laya: runs.laya ? { usd: null, basis: prereg.cost.laya.basis } : null,
      cascade: costs.cascade === null ? null : { usd: costs.cascade * 1000, basis: costs.basis },
    },
    meanCostPerChange: costs,
    criteria, layaCriteria,
    claim: partial ? { refuted: null, note: 'a partial run decides nothing about the claim' } : { refuted: criteria.some(c => c.state === refutedState) },
    spotlight: runs.reviewer ? spotlightVerdict(prereg, amendment, pop, reviewer, runs.reviewer, partial) : { verdict: 'FAIL', reasons: ['the reviewer was not run'] },
  };
  assertNoUndefined(record);
  return record;
}

function assertNoUndefined(value, path = 'results') {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`${path} is ${value}; a missing value must be null`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
}

/** The FIXTURE banner blocks publication: a fixture record, or anything carrying the banner, is refused. */
export function assertPublishable(record) {
  const text = JSON.stringify(record);
  if (record?.rehearsal) throw new Error('refusing to publish: this results record is a rehearsal (a stubbed dry check, not a measurement)');
  if (record?.fixture !== false || text.includes(FIXTURE_BANNER) || /\bFIXTURE\b/.test(text)) throw new Error('refusing to publish: this results record is a FIXTURE');
  return record;
}

/** The two records through the guard (both shas, pinned files, clock), plus labels and baselines. */
export function loadRecords({ pins, amendmentFile } = {}) {
  const { prereg, amendment, stamp } = checkRecords({ pins, amendmentFile });
  const labels = JSON.parse(readFileSync(join(DIR, 'labels.json'), 'utf8'));
  const baselines = JSON.parse(readFileSync(join(DIR, 'baselines.json'), 'utf8'));
  return { prereg, amendment, stamp, labels, baselines };
}
