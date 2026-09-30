// EXP 006 results (WO-1-08, R2-4 as replaced by R3-3, R4-2, R4-6, R4-7): the frozen scorer.
//
// The bar is EXP 005's, unchanged: the four spotlight criteria of EXP 005 amendment 01 (missed drift, false reject,
// self-agreement, zero patches), their thresholds, denominators, hold rule and three-state labels, computed by EXP
// 005's own spotlightVerdict (results.mjs) — nothing re-worded, no threshold written here. The ONLY change is the
// run-state mapping: every counted run is classified from its recorded tool calls (diff-seen.mjs, recomputed here and
// asserted equal to what the runner recorded) into
//   SEEN-DECIDED  diff-seen, with a verdict line          SEEN-ABSTAIN  diff-seen, no verdict line
//   BLIND         not diff-seen, whatever it decided      HARNESS-FAIL  a harness failure (also BLIND below)
// and a BLIND run (harness failures included) is scored as an error in missed drift and false reject (run level and in
// the item majority, where it counts as the wrong answer) and as a disagreement in self-agreement: its decision is
// mapped to "no decision" before EXP 005's formulas run. Hook errors are recorded and published beside the bar, not a
// criterion (as in EXP 005). The manipulation check: BLIND runs (harness failures included) at most the pre-registered
// maximum of the fixed denominator, else FAIL. Diff-seen-only figures are reported BESIDE the primary, never in its
// place. A partial run decides nothing. Thresholds come only from the records passed in (bar6 = the EXP 006
// pre-registration's bar, which must equal EXP 005 amendment 01's criteria).
import assert from 'node:assert/strict';
import { assertPublishable, percentile, population, spotlightVerdict, validateGateRun } from '../jev-gate/results.mjs';
import { wilson } from '../jev-gate/metrics.mjs';
import { checkPreflightForScoring } from '../jev-gate/runner-guard.mjs';
import { classifyDiffSeen } from './diff-seen.mjs';
import { NOT_BEFORE6, PREREG6_SHA256 } from './freeze.mjs';
import { HARNESS_FAILURE_DEFINITION } from './stream6.mjs';
import { coverageGap } from './vendored-exp005.mjs';

export const RUN_STATES = ['SEEN-DECIDED', 'SEEN-ABSTAIN', 'BLIND', 'HARNESS-FAIL'];
const DECISIONS = ['ACCEPT', 'REJECT'];

/** EXP 005 amendment 01's harnessFailure with R4-2's one translation; the runner's definition must equal it. */
export const translateHarnessFailure = text => text.replace('missing or unparseable JSON', 'no parseable final `type:"result"` line, or an unparseable NDJSON line');

export function runState(call, seen) {
  if (call.harnessFailure) return 'HARNESS-FAIL';
  if (!seen) return 'BLIND';
  return call.decision ? 'SEEN-DECIDED' : 'SEEN-ABSTAIN';
}
const isBlind = state => state === 'BLIND' || state === 'HARNESS-FAIL';

/** EXP 006's record shape on top of EXP 005's (validateGateRun): the stream-derived fields every counted call carries. */
export function validateRun6(run) {
  validateGateRun(run);
  assert.equal(run.experiment, 'EXP 006', 'an EXP 006 run record');
  assert.equal(run.gate, 'reviewer', 'EXP 006 runs the reviewer only');
  assert(run.pins && Array.isArray(run.pins.patches), 'pins.patches is recorded');
  assert.match(run.pins.fingerprintsSha256 ?? '', /^[0-9a-f]{64}$/, 'pins.fingerprintsSha256');
  for (const c of run.calls) {
    if (c.stageError) continue;
    const w = `${c.id} run ${c.run}`;
    assert(!c.lintRefused, `${w}: a call refused at write time is not scorable`);
    assert(Array.isArray(c.toolCalls), `${w}: toolCalls`);
    for (const t of c.toolCalls) assert(typeof t.tool === 'string' && 'isError' in t && 'outputSha256' in t && typeof t.fingerprintHit === 'boolean', `${w}: a recorded tool call has tool, isError, outputSha256, fingerprintHit`);
    assert(c.diffSeen && typeof c.diffSeen.seen === 'boolean', `${w}: diffSeen`);
    assert(c.stream && typeof c.stream.finalResultLine === 'boolean', `${w}: stream facts`);
  }
  return run;
}

const rate = (x, n, z) => ({ x, n, ...(wilson(x, n, z) ?? { estimate: null, lower: null, upper: null }) });

/**
 * exp005: {prereg, amendment} (EXP 005's records, as the guard loaded them). bar6: the EXP 006 bar {criteria,
 * harnessFailure, manipulation: {maxBlindRuns, countedRuns}}. stamp: what the run must have been made under
 * ({fixture, rehearsal, prereg6Sha256, notBefore, code, parentSha256, amendmentSha256}). fingerprints + its sha.
 */
export function computeResults6({ exp005, bar6, labels, run, fingerprints, fingerprintsSha256, stamp, preflight }) {
  const { prereg, amendment } = exp005;
  const z = prereg.statistics.z, k = prereg.gates.reviewer.k;
  // The same bar, verbatim: EXP 005 amendment 01's four criteria; the harness-failure definition translated once.
  assert.deepEqual(bar6.criteria, amendment.changes.spotlight.criteria, 'the EXP 006 bar must be EXP 005 amendment 01\'s four criteria, unchanged');
  const hfSource = amendment.changes.spotlight.criteria.find(c => c.id === 'zero-patches').harnessFailure;
  assert.equal(bar6.harnessFailure, translateHarnessFailure(hfSource), 'the harness-failure definition is EXP 005\'s with only the stream-json translation');
  assert.equal(HARNESS_FAILURE_DEFINITION, bar6.harnessFailure, 'the runner classifies harness failures by the pre-registered definition');
  const { maxBlindRuns, countedRuns } = bar6.manipulation ?? {};
  assert(Number.isInteger(maxBlindRuns) && Number.isInteger(countedRuns) && countedRuns > 0, 'bar6.manipulation {maxBlindRuns, countedRuns}');

  validateRun6(run);
  assert.equal(run.parentSha256, stamp.parentSha256, 'the run was made under another EXP 005 pre-registration');
  assert.equal(run.amendmentSha256, stamp.amendmentSha256, 'the run was made under another EXP 005 amendment 01');
  assert.equal(run.fixture, stamp.fixture, 'the run and the records disagree on fixture mode');
  assert.equal(run.pins.fingerprintsSha256, fingerprintsSha256, 'the run was classified with other fingerprints');
  if (!stamp.fixture) {
    // A counted scoring re-checks what the runner enforced: frozen code, counted mode, the EXP 006 pre-registration
    // and not-before, every call after it, and the committed pre-flight record against what the RUN stamped.
    if (!stamp.rehearsal) {
      assert(PREREG6_SHA256 && NOT_BEFORE6, 'counted scoring waits for the freeze (freeze.mjs)');
      assert.equal(stamp.prereg6Sha256, PREREG6_SHA256, 'scored against another EXP 006 pre-registration');
      assert.equal(stamp.notBefore, NOT_BEFORE6, 'scored against another not-before');
    }
    assert.match(run.prereg6Sha256 ?? '', /^[0-9a-f]{64}$/, 'the run names its EXP 006 pre-registration');
    assert.equal(run.prereg6Sha256, stamp.prereg6Sha256, 'the run was made under another EXP 006 pre-registration');
    assert.equal(run.notBefore, stamp.notBefore, 'the run has a different not-before time');
    assert.deepEqual(run.code, stamp.code, 'the run was made by other code than the frozen one');
    assert.equal(run.mode, 'counted', `the run is not a counted run (mode ${run.mode})`);
    assert.equal(Boolean(run.rehearsal), Boolean(stamp.rehearsal), 'rehearsal flag');
    const firstCall = run.calls.find(c => !c.stageError);
    for (const c of run.calls) if (!c.stageError) assert.ok(Date.parse(c.startedAt) > Date.parse(run.notBefore), `${c.id} run ${c.run} started at ${c.startedAt}, not after the not-before time`);
    checkPreflightForScoring({ record: preflight, run, firstCallStartedAt: firstCall?.startedAt, notBefore: stamp.notBefore });
  }

  // Recompute every run's diff-visibility from its committed tool outputs and the committed fingerprints.
  const counted = run.calls.filter(c => !c.stageError);
  const perRun = counted.map(c => {
    const again = classifyDiffSeen({ calls: c.toolCalls, fp: fingerprints.items[c.id], harnessFailure: c.harnessFailure });
    assert.deepEqual({ seen: again.seen, rule: again.rule, evidence: again.evidence }, { seen: c.diffSeen.seen, rule: c.diffSeen.rule, evidence: c.diffSeen.evidence }, `${c.id} run ${c.run}: the recorded diff-visibility differs from the recomputed one`);
    return { id: c.id, run: c.run, state: runState(c, again.seen), rule: again.rule, decision: c.decision, harnessFailure: c.harnessFailure, hookError: Boolean(c.hook?.error) };
  });
  const stateOf = new Map(perRun.map(p => [`${p.id}#${p.run}`, p.state]));

  const pop = population(labels, 'primary');
  const partialReasons = [];
  if (run.partial) partialReasons.push({ ...run.partial });
  const gap = coverageGap(run, pop.ids, k);
  if (gap) partialReasons.push({ reason: 'incomplete-coverage', detail: gap });
  if (!run.partial && !gap && counted.length !== countedRuns) partialReasons.push({ reason: 'denominator', detail: `${counted.length} counted runs, not ${countedRuns}` });
  const partial = partialReasons.length > 0;

  // The mapping: a BLIND (or HARNESS-FAIL) run has no decision for EXP 005's formulas; the item majority is EXP 005's
  // reviewerMajority (more than half of k runs), so a BLIND run counts as the wrong answer there too.
  const effective = c => (stateOf.get(`${c.id}#${c.run}`) === 'SEEN-DECIDED' ? c.decision : null);
  const reviewer = {};
  for (const c of counted) (reviewer[c.id] ??= { runs: [] }).runs.push({ ...c, decision: effective(c), excluded: undefined });
  for (const v of Object.values(reviewer)) {
    const decisions = v.runs.map(r => r.decision);
    v.decisions = decisions;
    v.decision = DECISIONS.find(d => decisions.filter(x => x === d).length > k / 2) ?? null;
  }
  const spotlight = spotlightVerdict(prereg, { changes: { spotlight: { criteria: bar6.criteria } } }, pop, reviewer, run, partial);

  const counts = Object.fromEntries(RUN_STATES.map(s => [s, perRun.filter(p => p.state === s).length]));
  const blind = perRun.filter(p => isBlind(p.state)).length;
  const manipulation = {
    rule: `BLIND runs, harness failures included, at most ${maxBlindRuns} of ${countedRuns} counted runs`,
    blind, harnessFailures: counts['HARNESS-FAIL'], countedRuns: counted.length, maxBlindRuns, denominator: countedRuns,
    state: partial ? null : counted.length === countedRuns && blind <= maxBlindRuns ? 'PASS' : 'FAIL',
  };

  // Beside the primary, never in its place: the same rates over the diff-seen runs only.
  const seenRuns = counted.filter(c => !isBlind(stateOf.get(`${c.id}#${c.run}`)));
  const seenOf = ids => seenRuns.filter(c => ids.includes(c.id));
  const allSeen = pop.ids.filter(id => { const rs = counted.filter(c => c.id === id); return rs.length === k && rs.every(c => !isBlind(stateOf.get(`${c.id}#${c.run}`))); });
  const diffSeenOnly = {
    note: 'Reported beside the primary figures, never replacing them: BLIND runs are left out here.',
    missedDrift: rate(seenOf(pop.red).filter(c => c.decision !== 'REJECT').length, seenOf(pop.red).length, z),
    falseReject: rate(seenOf(pop.green).filter(c => c.decision !== 'ACCEPT').length, seenOf(pop.green).length, z),
    selfAgreement: rate(allSeen.filter(id => { const d = counted.filter(c => c.id === id).map(c => c.decision); return d[0] !== null && d.every(x => x === d[0]); }).length, allSeen.length, z),
  };

  const costs = counted.map(c => c.costUsd).filter(v => typeof v === 'number');
  const cost = { calls: costs.length, callsWithoutCost: counted.length - costs.length, meanUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null, maxUsd: costs.length ? Math.max(...costs) : null, p90Usd: percentile(costs, 90), p90Method: 'results.mjs percentile (numpy linear interpolation)', basis: prereg.cost.reviewer.basis };

  const failed = [];
  if (partial) failed.push('a partial run decides nothing');
  else {
    if (spotlight.verdict !== 'PASS') failed.push(...spotlight.reasons);
    if (manipulation.state !== 'PASS') failed.push(`manipulation check: ${blind} of ${counted.length} runs were diff-blind (at most ${maxBlindRuns} of ${countedRuns} allowed)`);
  }
  const record = {
    schemaVersion: 1, kind: 'results', experiment: 'EXP 006',
    fixture: stamp.fixture, ...(stamp.fixture ? { banner: run.banner } : {}), ...(run.rehearsal ? { rehearsal: true } : {}),
    prereg6Sha256: run.prereg6Sha256 ?? null, parentSha256: run.parentSha256, amendmentSha256: run.amendmentSha256, notBefore: run.notBefore, code: run.code,
    partial: partial ? partialReasons : null,
    runStates: counts, manipulation, spotlight, diffSeenOnly, cost,
    // The spotlight decision record (held true/false) is written at results time by the pre-registered rule:
    // held:false iff the bar PASSES AND the manipulation check PASSES AND the results refute SHIPs.
    spotlightEligible: !partial && spotlight.verdict === 'PASS' && manipulation.state === 'PASS',
    failedConditions: failed,
    perRun,
  };
  assertNoUndefined(record);
  return record;
}

function assertNoUndefined(value, path = 'results') {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`${path} is ${value}; a missing value must be null`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
}

/** EXP 005's publication gate: a rehearsal or a FIXTURE record is refused. */
export const assertPublishable6 = record => assertPublishable(record);
