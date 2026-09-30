import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRecords, FIXTURE_BANNER } from '../experiments/jev-gate/runner-guard.mjs';
import { callHitsFingerprint, classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { loadFingerprints } from '../experiments/nina-changes/fingerprints.mjs';
import { baseOnlyCalls, seenCalls } from '../experiments/nina-changes/fixtures/synthetic6.mjs';
import { assertPublishable6, computeResults6, runState, translateHarnessFailure } from '../experiments/nina-changes/results6.mjs';
import { recordToolCalls } from '../experiments/nina-changes/stream6.mjs';

// EXP 006 WO-1-08: the frozen scorer on synthetic FIXTURE records (no model). EXP 005's bar, verbatim, with the one
// run-state mapping: BLIND (harness failures included) is an error in missed drift / false reject and a disagreement
// in self-agreement; the manipulation check allows at most the pre-registered number of BLIND runs.

const { prereg, amendment } = checkRecords({ mode: 'practice' });
const labels = JSON.parse(readFileSync('experiments/jev-gate/labels.json', 'utf8'));
const fingerprints = loadFingerprints();
const FP_SHA = 'f'.repeat(64);
const truth = Object.fromEntries(labels.items.map(i => [i.id, i.label]));
const ids = Object.keys(truth).sort();
const red = ids.filter(id => truth[id] === 'RED'), green = ids.filter(id => truth[id] === 'GREEN');
const patch = id => readFileSync(`experiments/jev-gate/corpus/${id}.patch`, 'utf8');
const hf = amendment.changes.spotlight.criteria.find(c => c.id === 'zero-patches').harnessFailure;
// The bar the EXP 006 pre-registration will carry: EXP 005's criteria unchanged; the manipulation maximum per the plan.
const bar6 = { criteria: amendment.changes.spotlight.criteria, harnessFailure: translateHarnessFailure(hf), manipulation: { maxBlindRuns: 18, countedRuns: 180 } };
const exp005 = { prereg, amendment };
const stamp = { fixture: true, parentSha256: '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a', amendmentSha256: '5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb' };
const blindCalls = recordToolCalls([{ tool: 'Bash', input: { command: 'git status --short > "$TMPDIR/st.txt"' }, isError: true, output: 'denied' }, ...baseOnlyCalls({ 'rules.txt': readFileSync('experiments/jev-gate/rules.txt', 'utf8') })]);
const seenCache = {};
const seen = id => (seenCache[id] ??= recordToolCalls(seenCalls(patch(id)), c => callHitsFingerprint(c, fingerprints.items[id])));

/** A full 60 × 3 fixture run. `plan(id, k)` may return {blind, decision, harnessFailure, hookError}. */
function makeRun(plan = () => ({})) {
  const calls = [];
  for (const id of ids) for (let k = 1; k <= 3; k += 1) {
    const p = plan(id, k) ?? {};
    const correct = truth[id] === 'RED' ? 'REJECT' : 'ACCEPT';
    const harnessFailure = p.harnessFailure ?? null;
    const decision = harnessFailure ? null : p.decision === undefined ? correct : p.decision;
    const toolCalls = p.blind ? blindCalls : seen(id);
    const d = classifyDiffSeen({ calls: toolCalls, fp: fingerprints.items[id], harnessFailure });
    calls.push({
      id, run: k, gate: 'reviewer', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:01:00Z', latencyMs: 60000, status: harnessFailure ?? 'ok', harnessFailure,
      decision, verdictLine: decision ? `VERDICT: ${decision === 'REJECT' ? 'REJECTED' : 'APPROVED'}` : null, abstention: harnessFailure ? 'failure' : decision ? null : 'model',
      costUsd: 0.2 + (k / 100), costBasis: 'api-equivalent', toolCalls, diffSeen: { seen: d.seen, rule: d.rule, evidence: d.evidence },
      stream: { finalResultLine: !harnessFailure }, hook: { ran: true, error: Boolean(p.hookError) },
    });
  }
  return {
    schemaVersion: 1, kind: 'gate-run', gate: 'reviewer', experiment: 'EXP 006', mode: 'counted', fixture: true, banner: FIXTURE_BANNER,
    parentSha256: stamp.parentSha256, amendmentSha256: stamp.amendmentSha256, notBefore: '2026-09-30T00:00:00Z', code: {},
    pins: { patches: [], fingerprintsSha256: FP_SHA }, items: ids, partial: null, calls,
  };
}
const score = run => computeResults6({ exp005, bar6, labels, run, fingerprints, fingerprintsSha256: FP_SHA, stamp });
const crit = (r, id) => r.spotlight.criteria.find(c => c.id === id);

test('all runs diff-seen and correct: bar PASS, manipulation PASS (0 of 180 blind), eligible for the spotlight', () => {
  const r = score(makeRun());
  assert.deepEqual(r.runStates, { 'SEEN-DECIDED': 180, 'SEEN-ABSTAIN': 0, BLIND: 0, 'HARNESS-FAIL': 0 });
  assert.equal(r.spotlight.verdict, 'PASS');
  assert.equal(r.manipulation.state, 'PASS');
  assert.equal(r.spotlightEligible, true);
  assert.deepEqual(r.failedConditions, []);
  // The fixed denominators: 90 / 90 / 60 / 180.
  assert.deepEqual([crit(r, 'missed-drift').runLevel.n, crit(r, 'false-reject').runLevel.n, crit(r, 'self-agreement').n, crit(r, 'zero-patches').harnessFailures.n], [90, 90, 60, 180]);
  assert.equal(r.cost.p90Method, 'results.mjs percentile (numpy linear interpolation)');
});

test('a BLIND run is an error even when its verdict was right: missed drift, the item majority, self-agreement', () => {
  const target = red[0];
  const r = score(makeRun((id, k) => (id === target && k === 1 ? { blind: true } : {})));
  assert.equal(r.perRun.find(p => p.id === target && p.run === 1).state, 'BLIND');
  assert.equal(r.perRun.find(p => p.id === target && p.run === 1).decision, 'REJECT', 'the verdict itself was right');
  assert.equal(crit(r, 'missed-drift').runLevel.x, 1, 'counted as a miss');
  assert.equal(crit(r, 'self-agreement').x, 59, 'the item disagrees');
  // Two blind runs on one RED item: the majority is wrong (BLIND is the wrong answer in the item majority).
  const two = score(makeRun((id, k) => (id === target && k <= 2 ? { blind: true } : {})));
  assert.equal(crit(two, 'missed-drift').itemLevel.interval.x, 1);
  // A blind GREEN run is a false reject.
  const g = score(makeRun((id, k) => (id === green[0] && k === 3 ? { blind: true } : {})));
  assert.equal(crit(g, 'false-reject').runLevel.x, 1);
  assert.equal(crit(g, 'missed-drift').runLevel.x, 0);
});

test('the manipulation check: 18 of 180 blind passes, 19 fails; harness failures count as blind', () => {
  const blindRuns = n => (id, k) => (ids.indexOf(id) * 3 + (k - 1) < n ? { blind: true } : {});
  assert.equal(score(makeRun(blindRuns(18))).manipulation.state, 'PASS');
  const f = score(makeRun(blindRuns(19)));
  assert.equal(f.manipulation.state, 'FAIL');
  assert.equal(f.spotlightEligible, false);
  assert.ok(f.failedConditions.some(c => /manipulation check: 19 of 180/.test(c)));
  const hf19 = score(makeRun((id, k) => (ids.indexOf(id) * 3 + (k - 1) < 19 ? { harnessFailure: 'timeout' } : {})));
  assert.equal(hf19.runStates['HARNESS-FAIL'], 19);
  assert.equal(hf19.manipulation.blind, 19);
  assert.equal(hf19.manipulation.state, 'FAIL');
  assert.equal(crit(hf19, 'zero-patches').harnessFailures.x, 19);
});

test('SEEN-ABSTAIN is an error; hook errors are published beside the bar, not a criterion', () => {
  const r = score(makeRun((id, k) => (id === green[1] && k === 2 ? { decision: null } : id === green[2] ? { hookError: true } : {})));
  assert.equal(r.perRun.find(p => p.id === green[1] && p.run === 2).state, 'SEEN-ABSTAIN');
  assert.equal(crit(r, 'false-reject').runLevel.x, 1);
  assert.equal(crit(r, 'zero-patches').hookErrors.x, 3);
  assert.equal(crit(r, 'zero-patches').holds, true, 'hook errors do not fail zero-patches');
});

test('the hold rule (EXP 005 verbatim): run level within threshold but the item-level label refuted does not hold', () => {
  // 4 RED items with 2 BLIND runs each: 8 of 90 runs (8.9%, within 10%) but 4 of 30 items wrong (13%, refuted).
  const r = score(makeRun((id, k) => (red.slice(0, 4).includes(id) && k <= 2 ? { blind: true } : {})));
  const md = crit(r, 'missed-drift');
  assert.equal(md.runLevel.x, 8);
  assert.ok(!(md.runLevel.estimate > md.threshold), 'run level within threshold');
  assert.equal(md.itemLevel.state, 'refuted');
  assert.equal(md.holds, false);
  assert.equal(r.spotlight.verdict, 'FAIL');
  assert.equal(r.manipulation.state, 'PASS', '8 blind runs pass the manipulation check');
});

test('diff-seen-only figures are reported beside the primary, never replacing it', () => {
  const r = score(makeRun((id, k) => (id === red[0] && k === 1 ? { blind: true, decision: 'ACCEPT' } : {})));
  assert.equal(crit(r, 'missed-drift').runLevel.x, 1, 'the primary counts the blind run');
  assert.equal(r.diffSeenOnly.missedDrift.x, 0);
  assert.equal(r.diffSeenOnly.missedDrift.n, 89);
  assert.match(r.diffSeenOnly.note, /beside/);
});

test('a partial run decides nothing: no manipulation state, no spotlight, whatever its figures', () => {
  const stopped = makeRun(); stopped.partial = { reason: 'spend' };
  const p = score(stopped);
  assert.equal(p.manipulation.state, null);
  assert.equal(p.spotlight.verdict, 'FAIL');
  assert.equal(p.spotlightEligible, false);
  assert.deepEqual(p.failedConditions, ['a partial run decides nothing']);
  const short = makeRun(); short.calls.pop();
  const s = score(short);
  assert.equal(s.partial[0].reason, 'incomplete-coverage');
  assert.equal(s.spotlightEligible, false);
});

test('the scorer recomputes diff-visibility and refuses a record whose stamped class differs', () => {
  const run = makeRun();
  run.calls[0].diffSeen = { seen: false, rule: null, evidence: [] };
  assert.throws(() => score(run), /recorded diff-visibility differs/);
  assert.equal(runState({ harnessFailure: 'timeout', decision: null }, true), 'HARNESS-FAIL');
});

test('the bar is EXP 005 amendment 01\'s, unchanged, and its harness-failure definition translated once', () => {
  const changed = structuredClone(bar6); changed.criteria[0].threshold = 0.2;
  assert.throws(() => computeResults6({ exp005, bar6: changed, labels, run: makeRun(), fingerprints, fingerprintsSha256: FP_SHA, stamp }), /amendment 01's four criteria/);
  const reworded = { ...bar6, harnessFailure: hf };
  assert.throws(() => computeResults6({ exp005, bar6: reworded, labels, run: makeRun(), fingerprints, fingerprintsSha256: FP_SHA, stamp }), /stream-json translation/);
  assert.throws(() => computeResults6({ exp005, bar6, labels, run: makeRun(), fingerprints, fingerprintsSha256: 'e'.repeat(64), stamp }), /other fingerprints/);
});

test('no threshold is written in results6.mjs; a fixture result is never publishable', () => {
  const values = amendment.changes.spotlight.criteria.flatMap(c => [c.threshold, c.harnessFailureMax]).filter(v => typeof v === 'number');
  const src = readFileSync('experiments/nina-changes/results6.mjs', 'utf8');
  for (const v of [...values, 18, 180]) assert.doesNotMatch(src, new RegExp(`(?<![\\w.])${String(v).replace('.', '\\.')}(?![\\w.])`), `results6.mjs states ${v}`);
  assert.throws(() => assertPublishable6(score(makeRun())), /FIXTURE/);
});
