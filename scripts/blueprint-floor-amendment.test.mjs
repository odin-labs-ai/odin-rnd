import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { AMENDMENT01_NOT_BEFORE, AMENDMENT01_SHA256, NOT_BEFORE, PREREG_SHA256, SERVED_URL } from '../experiments/blueprint-floor/freeze.mjs';
import { checkAmendment01, checkCensusRun, gitIn, readPins, REPO_ROOT } from '../experiments/blueprint-floor/census-guard.mjs';
import { CensusLedger, validLine } from '../experiments/blueprint-floor/census-spend.mjs';
import { isEligibleForRecall, loadAmendment } from '../experiments/blueprint-floor/amendment01.mjs';
import { paidPreflight, runCensus } from '../experiments/blueprint-floor/census-run.mjs';
import { computeCensusResults, gateFromData, readRecords, recordFilesUnder } from '../experiments/blueprint-floor/census-gate.mjs';
import { loadCensusRules } from '../experiments/blueprint-floor/scorer.mjs';
import { amendNote, checkAmendment, MESSAGE, publishedPath, recordPath, renderSection, validateAmendment } from './blueprint-floor-amendment.mjs';
import { resultWords } from './blueprint-floor-note.mjs';
import { claudeFree7, withFake } from './blueprint-floor-census-free.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 007 amendment 01 ($0, no model): the record, the eligibility rule, the guards of --mode recall, the ledger lines,
// and a rehearsal of the re-call with the committed fake client through the real runner, records, scorer and gate.

const sha = b => createHash('sha256').update(b).digest('hex');
const amendment = loadAmendment(REPO_ROOT);
const amendmentBytes = readFileSync(join(REPO_ROOT, recordPath));
const AMENDMENT_SHA = sha(amendmentBytes);
const prereg = JSON.parse(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.json'), 'utf8'));
const LONG = { timeout: 1_800_000 };
/** A frozen state for the amendment, in a test only (freeze.mjs keeps both null until the amendment is published). */
const A_NB = '2026-10-04T00:00:00Z'; // after the pre-registration's not-before, and past (each metered call also checks the real clock)
const FROZEN = { PREREG_SHA256, NOT_BEFORE, AMENDMENT01_SHA256: AMENDMENT_SHA, AMENDMENT01_NOT_BEFORE: A_NB };

test('amendment 01: pinned, its parent the published pre-registration, the decision and the message verbatim, its site copy byte for byte, no result', () => {
  const { record, sha256 } = checkAmendment(REPO_ROOT, { verifyHistory: true }); // attempt1Code == runners.sha256 at ee88bf7, from git
  assert.equal(sha256, readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/amendment-01.sha256'), 'utf8').split(/\s/)[0]);
  assert.equal(record.parent.sha256, 'ee56929ab38de831d618a41b9a2f359d814fc01849d273060e590669e94c9edb');
  assert.equal(record.decision.verbatim, 'Amend, then re-call once (Recommended)');
  assert.equal(record.incident.message, MESSAGE);
  assert.ok(MESSAGE.startsWith("You've hit your monthly spend limit"));
  assert.equal(readFileSync(join(REPO_ROOT, publishedPath), 'utf8'), amendmentBytes.toString());
  assert.equal(record.incident.attempt1Commit, 'ee88bf763bc25d4642fb3de4bf9fe951297ca7a8');
  assert.equal(Object.keys(record.attempt1Code).length, 34);
  assert.ok(record.unchanged.includes('the scorer (scorer.mjs, byte for byte)'));
  assert.equal(prereg.files['experiments/blueprint-floor/scorer.mjs'], sha(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/scorer.mjs'))), 'the scorer bytes are the pre-registered ones');
  assert.equal(AMENDMENT01_SHA256, null, 'freeze.mjs waits for the published amendment');
  assert.equal(AMENDMENT01_NOT_BEFORE, null);
  const section = renderSection(record, sha256);
  assert.ok(!resultWords.test(section));
  assert.equal(section.split('the pinned client').length - 1, 1, 'refute A1 N5: "the pinned client" once');
  assert.match(section, /the pinned client \(Claude Code 2\.1\.280\) answered/);
  assert.equal(record.eligibility.eligibleCallIds.length, 37, 'refute A1 N2: the eligible set is pinned');
  assert.equal(record.disclosures.length, 5, 'refute A1 N4 and N6 are disclosed');
  const note = readFileSync(join(REPO_ROOT, 'site/journal/which-rules-need-a-model.html'), 'utf8');
  const built = amendNote(note, record, sha256);
  assert.ok(built.indexOf('id="amendment-01"') < built.indexOf('<h2>Provenance</h2>'), 'the section sits before Provenance');
  assert.throws(() => amendNote(built, record, sha256), /already carries amendment 01/);
});

test('refute A1-B1: the amendment checks without git history (a copy with no .git, and a depth-1 clone)', () => {
  const copy = scratchDir('bf-a01-nogit');
  try {
    for (const rel of [recordPath, 'experiments/blueprint-floor/amendment-01.sha256', publishedPath, 'experiments/blueprint-floor/preregistration.json']) { mkdirSync(join(copy, rel, '..'), { recursive: true }); cpSync(join(REPO_ROOT, rel), join(copy, rel)); }
    const { sha256 } = checkAmendment(copy, { verifyHistory: true }); // no commit object here: only the git confirmation is skipped
    assert.equal(sha256, AMENDMENT_SHA);
    const tampered = JSON.parse(amendmentBytes);
    tampered.attempt1Code['experiments/blueprint-floor/scorer.mjs'] = 'f'.repeat(64);
    assert.throws(() => validateAmendment(tampered, { parentSha256: PREREG_SHA256, root: copy }), /attempt1Code is the runners\.sha256 whose sha256 the amendment pins/);
  } finally { removeScratch(copy); }
  // A depth-1 clone of the committed branch head: no history, and the checker passes there.
  const clone = scratchDir('bf-a01-clone');
  try {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
    const r = spawnSync('git', ['clone', '-q', '--depth', '1', '--no-local', `file://${REPO_ROOT}`, join(clone, 'r')], { encoding: 'utf8' });
    if (r.status !== 0) return; // a worktree without a committed branch head to clone (the copy check above still ran)
    spawnSync('git', ['-C', join(clone, 'r'), 'checkout', '-q', head], { encoding: 'utf8' });
    assert.equal(spawnSync('git', ['-C', join(clone, 'r'), 'cat-file', '-e', 'ee88bf763bc25d4642fb3de4bf9fe951297ca7a8^{commit}']).status === 0, false, 'the clone has no history');
    const run = spawnSync(process.execPath, ['scripts/blueprint-floor-amendment.mjs', '--check'], { cwd: join(clone, 'r'), encoding: 'utf8' });
    if (existsSync(join(clone, 'r', recordPath)) && readFileSync(join(clone, 'r', recordPath)).equals(amendmentBytes)) assert.equal(run.status, 0, run.stderr);
  } finally { removeScratch(clone); }
});

test('eligibility is exact: the spend-limit message on a nonzero exit, byte for byte, and nothing else', () => {
  const rec = (over = {}) => ({ translator: { called: true, harnessFailure: 'nonzero-exit', raw: MESSAGE, rawSha256: sha(MESSAGE), classAfterMechanical: 'error', ...over } });
  assert.equal(isEligibleForRecall(rec(), amendment), true);
  const other = "You've hit your session limit · try again later";
  assert.equal(isEligibleForRecall(rec({ raw: other, rawSha256: sha(other) }), amendment), false, 'another nonzero-exit message');
  assert.equal(isEligibleForRecall(rec({ raw: `${MESSAGE} `, rawSha256: sha(`${MESSAGE} `) }), amendment), false, 'one byte more');
  assert.equal(isEligibleForRecall(rec({ harnessFailure: 'timeout' }), amendment), false, 'a timeout, even with the message');
  assert.equal(isEligibleForRecall(rec({ harnessFailure: 'client-error' }), amendment), false);
  assert.equal(isEligibleForRecall(rec({ rawSha256: 'a'.repeat(64) }), amendment), false, 'the recorded sha must be the text\'s');
  assert.equal(isEligibleForRecall(rec({ lost: true }), amendment), false, 'a lost record');
  assert.equal(isEligibleForRecall(rec({ classAfterMechanical: 'not' }), amendment), false);
  assert.equal(isEligibleForRecall({ translator: null }, amendment), false);
  assert.equal(isEligibleForRecall(rec(), { ...amendment, eligibility: { ...amendment.eligibility, messageSha256: 'b'.repeat(64) } }), false, 'a tampered amendment matches nothing');
});

test('recall refuses: without the amendment freeze, before its not-before, on another amendment, when not served, under the test runner, with a billing variable', async () => {
  const served = async url => (url === SERVED_URL ? readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.json')) : amendmentBytes);
  const state = scratchDir('bf-a01-state');
  try {
    const args = over => ({ mode: 'recall', now: new Date('2026-10-04T01:00:00Z'), fetch: served, git: gitIn(REPO_ROOT), stateDir: state, ...over });
    await assert.rejects(checkCensusRun(args({ freeze: { PREREG_SHA256, NOT_BEFORE, AMENDMENT01_SHA256: null, AMENDMENT01_NOT_BEFORE: null } })), /waits for the amendment 01 freeze/);
    await assert.rejects(checkCensusRun(args({})), /waits for the amendment 01 freeze/, 'the committed freeze.mjs (null)');
    const stamp = await checkCensusRun(args({ freeze: FROZEN }));
    assert.deepEqual([stamp.amendmentSha256, stamp.amendmentNotBefore, stamp.servedAmendment.sha256], [AMENDMENT_SHA, A_NB, AMENDMENT_SHA]);
    await assert.rejects(checkCensusRun(args({ freeze: FROZEN, now: new Date(A_NB) })), /not after the amendment 01 not-before/);
    await assert.rejects(checkCensusRun(args({ freeze: { ...FROZEN, AMENDMENT01_SHA256: 'c'.repeat(64) } })), /amendment-01\.json hashes to/);
    await assert.rejects(checkCensusRun(args({ freeze: FROZEN, fetch: async url => (url === SERVED_URL ? served(url) : Buffer.from('x')) })), /site serves an amendment 01 hashing to/);
    await assert.rejects(checkCensusRun(args({ freeze: { ...FROZEN, AMENDMENT01_NOT_BEFORE: '2026-10-01T00:00:00Z' } })), /amendment not-before is not after the pre-registration not-before/);
    assert.ok(!(await checkCensusRun(args({ mode: 'counted', freeze: FROZEN }))).amendmentSha256, 'a counted run does not need the amendment');
  } finally { removeScratch(state); }
  assert.throws(() => paidPreflight({ NODE_TEST_CONTEXT: 'child' }), /refused under the Node test runner/);
  assert.throws(() => paidPreflight({ ANTHROPIC_API_KEY: 'k' }), /API-billing variables are set \(ANTHROPIC_API_KEY\)/);
  assert.doesNotThrow(() => paidPreflight({}));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'recall', log: () => {}, ...free }), /waits for the amendment 01 freeze/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'recall', freeze: FROZEN, log: () => {}, ...free }), /cannot take an injected/));
  await assert.rejects(checkAmendment01({ freeze: FROZEN, now: new Date('2026-10-04T01:00:00Z'), rehearsal: true, root: scratchDir('bf-a01-empty') }), /amendment-01\.json is missing/);
});

test('re-call ledger lines: attempt 2 with the call they amend; attempt-aware lookups', () => {
  const dir = scratchDir('bf-a01-ledger');
  try {
    const L = new CensusLedger(join(dir, 'l.jsonl'), { mirror: false });
    const base = { ts: '2026-10-06T15:00:00Z', kind: 'counted', ruleId: 'r', role: 'translator', model: 'm', reportedCostUsd: 0, callId: 'c1' };
    const a1 = L.record(base);
    assert.equal(a1.costBasis, 'upper-bound');
    const a2 = L.record({ ...base, reportedCostUsd: 0.1, callId: 'c2', attempt: 2, amends: 'c1' });
    assert.deepEqual([a2.attempt, a2.amends], [2, 'c1']);
    assert.ok(L.entries().every(validLine));
    assert.equal(L.called('counted', 'r', 'translator').callId, 'c1');
    assert.equal(L.called('counted', 'r', 'translator', { attempt: 2 }).callId, 'c2');
    assert.equal(validLine({ ...a2, attempt: 3 }), false);
    assert.equal(validLine({ ...a2, amends: '' }), false);
    assert.equal(validLine({ ...a2, kind: 'practice' }), false);
    const { attempt: _a, ...noAttempt } = a2;
    assert.equal(validLine(noAttempt), false, 'amends without attempt');
    assert.throws(() => L.record({ ...base, callId: 'c3', attempt: 3 }), /attempt 1 or an amendment-01 re-call/);
  } finally { removeScratch(dir); }
});

test('rehearsal: the fake client refuses with the limit message on attempt 1; the recall re-calls exactly the eligible rule once; the gate scores attempt 2', LONG, async () => {
  // Practice: calls 1-4. Counted: c08 T (5) limit; c09 T (6), A (7); c10 T (8) other-limit (not eligible).
  const ids = ['control/08', 'control/09', 'control/10'];
  await withFake({ 5: 'limit', 8: 'other-limit' }, async ({ dir, paths, ledger, log }) => {
    const outDir2 = join(dir, 'attempt-2');
    await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    const run1 = await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    assert.deepEqual([run1.partial.reason, run1.partial.ruleId], ['client-limit', 'control/08'], 'refute A1 N1: the circuit breaker stops at the first limit refusal');
    const run2 = await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    assert.equal(run2.partial.reason, 'client-limit', 'control/10\'s refusal (another limit message) stops it too');
    assert.deepEqual([run2.skipped, run2.completed], [1, 2]);
    // The attempt-1 records stand in for the counted run's, made by the code the amendment pins.
    for (const id of ids) { const f = join(paths.outDir, `${id}.json`); const r = JSON.parse(readFileSync(f, 'utf8')); r.code = amendment.attempt1Code; writeFileSync(f, `${JSON.stringify(r, null, 2)}\n`); }
    const r08 = JSON.parse(readFileSync(join(paths.outDir, 'control/08.json'), 'utf8'));
    assert.deepEqual([r08.translator.harnessFailure, r08.translator.raw, r08.translator.costBasis, isEligibleForRecall(r08, amendment)], ['nonzero-exit', MESSAGE, 'upper-bound', true]);
    assert.equal(isEligibleForRecall(JSON.parse(readFileSync(join(paths.outDir, 'control/10.json'), 'utf8')), amendment), false);
    const before = log().length;
    const now = new Date(Date.parse(A_NB) + 1000);
    const recall = await runCensus({ ...paths, outDir2, mode: 'rehearsal', rehearsalOf: 'recall', freeze: FROZEN, now, only: ids, rehearsalEligible: [r08.translator.callId], log: () => {} });
    assert.equal(recall.partial, null);
    assert.equal(recall.eligibleSetPinned, true);
    assert.deepEqual([recall.eligible, recall.completed, recall.called], [1, 1, 2]);
    assert.deepEqual(log().slice(before).map(c => c.role), ['translator', 'adjudicator'], 'one re-call of the translator, then its adjudicator');
    assert.deepEqual(recordFilesUnder(outDir2), ['control/08.json'], 'only the eligible rule has an attempt-2 record');
    const a2 = JSON.parse(readFileSync(join(outDir2, 'control/08.json'), 'utf8'));
    assert.deepEqual([a2.attempt, a2.amends, a2.amendmentSha256, a2.attempt1Sha256], [2, r08.translator.callId, AMENDMENT_SHA, sha(readFileSync(join(paths.outDir, 'control/08.json')))]);
    assert.notEqual(a2.final.final, 'error', 'the re-call answered');
    const lines = ledger.entries().filter(l => l.attempt === 2);
    assert.deepEqual(lines.map(l => [l.ruleId, l.role, l.amends]), [['control/08', 'translator', r08.translator.callId], ['control/08', 'adjudicator', r08.translator.callId]]);
    assert.equal(ledger.entries().filter(l => l.ruleId === 'control/08' && l.role === 'translator').length, 2, 'the original line stays');
    // A second recall calls nothing: every eligible pair has its attempt-2 record (and line).
    const again = await runCensus({ ...paths, outDir2, mode: 'rehearsal', rehearsalOf: 'recall', freeze: FROZEN, now, only: ids, rehearsalEligible: [r08.translator.callId], log: () => {} });
    assert.deepEqual([again.called, again.skipped], [0, 1]);
    await assert.rejects(runCensus({ ...paths, outDir2, mode: 'rehearsal', rehearsalOf: 'recall', freeze: FROZEN, now, only: ids, rehearsalEligible: ['counted:other:translator:1:1'], log: () => {} }), /eligible set \(1\) is not the 1 attempt-1 calls the amendment pins/, 'refute A1 N2: another pinned set refuses');
    assert.equal(log().length - before, 2, 'no second re-call');

    // The gate: with the rehearsal markers flipped in memory, it opens, and control/08 is scored from attempt 2.
    const { rules, plugins } = loadCensusRules(REPO_ROOT);
    const sub = rules.filter(r => ids.includes(r.ruleId));
    const flip = rec => ({ ...rec, rehearsal: false, served: { url: SERVED_URL, sha256: PREREG_SHA256, fetchedAt: rec.startedAt }, ...(rec.attempt === 2 ? { servedAmendment: { url: 'served', sha256: AMENDMENT_SHA, fetchedAt: rec.startedAt } } : {}) });
    // The rehearsal's eligible set (one rule) stands in for the 37 the published amendment pins.
    const pinnedOne = [r08.translator.callId];
    const amendmentT = { ...amendment, eligibility: { ...amendment.eligibility, eligibleCallIds: pinnedOne, eligibleCallIdsSha256: sha(JSON.stringify(pinnedOne)) } };
    const files1 = recordFilesUnder(paths.outDir);
    const recs1 = Object.fromEntries(Object.entries(readRecords(paths.outDir, files1)).map(([k, v]) => [k, flip(v)]));
    const recs2 = Object.fromEntries(Object.entries(readRecords(outDir2, recordFilesUnder(outDir2))).map(([k, v]) => [k, flip(v)]));
    const allLines = ledger.entries().map(l => ({ ...l, rehearsal: false }));
    const practiceRec = { ...JSON.parse(readFileSync(paths.practicePath, 'utf8')), rehearsal: false, code: amendment.attempt1Code };
    const scorerPin = prereg.files['experiments/blueprint-floor/scorer.mjs'];
    const shas1 = Object.fromEntries(files1.map(f => [f.replace(/\.json$/, ''), sha(Buffer.from(`${JSON.stringify(recs1[f.replace(/\.json$/, '')], null, 2)}\n`))]));
    for (const id of Object.keys(recs2)) recs2[id] = { ...recs2[id], attempt1Sha256: shas1[id] };
    const results = computeCensusResults({ rules: sub, plugins, records: recs1, ledgerLines: allLines, denominator: 3, scorerSha256: scorerPin, attempt2Records: recs2, amendment: amendmentT, amendmentSha256: AMENDMENT_SHA });
    const inputs = over => ({ resultsBytes: JSON.stringify(results), records: recs1, recordFiles: files1, ledgerText: `${allLines.map(l => JSON.stringify(l)).join('\n')}\n`, practiceRecords: [practiceRec], models: { translator: 'claude-opus-5-5', adjudicator: 'claude-sonnet-5' }, rules: sub, plugins, pins: readPins(), freeze: FROZEN, preregDiskSha256: PREREG_SHA256, denominator: 3, scorerDiskSha256: scorerPin, scorerPin, attempt2Records: recs2, attempt2Files: Object.keys(recs2).map(k => `${k}.json`), attempt1Shas: shas1, amendment: amendmentT, amendmentDiskSha256: AMENDMENT_SHA, ...over });
    const g = gateFromData(inputs({}));
    assert.deepEqual(g.failures, []);
    assert.equal(g.publishable, true);
    assert.ok(!g.facts.errors.some(e => e.ruleId === 'control/08'), 'control/08 is scored from its attempt-2 record');
    assert.ok(g.facts.errors.some(e => e.ruleId === 'control/10'), 'the ineligible failure stays error');
    assert.deepEqual([g.facts.amendment.eligible, g.facts.amendment.recalled], [1, 1]);
    assert.equal(g.facts.disclosures.length, 8 + 5);
    const closed = (over, re, label) => { const x = gateFromData(inputs(over)); assert.equal(x.publishable, false, label); assert.ok(x.failures.some(f => re.test(f)), `${label}: ${JSON.stringify(x.failures.slice(0, 3))}`); };
    closed({ attempt2Records: {}, attempt2Files: [] }, /eligible rules without their attempt-2 record: control\/08/, 'the eligible rule was not re-called');
    closed({ attempt2Records: { ...recs2, 'control/10': { ...recs2['control/08'], ruleId: 'control/10' } }, attempt2Files: ['control/08.json', 'control/10.json'] }, /not eligible under amendment 01 \(an ineligible re-call\): control\/10/, 'an ineligible re-call');
    closed({ freeze: { PREREG_SHA256, NOT_BEFORE, AMENDMENT01_SHA256: null, AMENDMENT01_NOT_BEFORE: null } }, /attempt-2 records without amendment 01 in force/, 'attempt 2 without the amendment');
    closed({ amendmentDiskSha256: 'd'.repeat(64) }, /amendment 01 on disk is not the frozen one/, 'another amendment on disk');
    const extraLine = { ...allLines.find(l => l.attempt === 2), ruleId: 'control/09', callId: 'x' };
    closed({ ledgerText: `${[...allLines, extraLine].map(l => JSON.stringify(l)).join('\n')}\n` }, /attempt 2 \(a re-call the gate does not accept\)/, 'a re-call line for a rule with no attempt 2');
    const noA2Line = allLines.filter(l => !(l.attempt === 2 && l.role === 'adjudicator'));
    closed({ ledgerText: `${noA2Line.map(l => JSON.stringify(l)).join('\n')}\n` }, /control\/08 adjudicator attempt 2: a call with no ledger line/, 'a re-call call with no ledger line');
    closed({ attempt2Records: { 'control/08': { ...recs2['control/08'], amends: 'other' } } }, /does not amend its attempt-1 translator call/, 'amends another call');
    closed({ attempt2Records: { 'control/08': { ...recs2['control/08'], startedAt: A_NB } } }, /attempt-2 call started at or before the amendment 01 not-before/, 'a re-call before the not-before');
    closed({ attempt1Shas: { ...shas1, 'control/08': 'e'.repeat(64) } }, /names another attempt-1 record/, 'the attempt-1 record changed after the re-call');
    closed({ amendment }, /the eligible set \(1\) is not the 37 attempt-1 calls the amendment pins/, 'refute A1 N2: the published amendment pins 37');
    closed({ attempt2Records: { 'control/08': { ...recs2['control/08'], amendmentNotBefore: '2026-10-05T00:00:00Z' } } }, /another not-before or amendment not-before/, 'refute A1 N3: amendmentNotBefore');
    closed({ attempt2Records: { 'control/08': { ...recs2['control/08'], notBefore: '2026-10-03T12:09:43Z' } } }, /another not-before or amendment not-before/, 'refute A1 N3: notBefore');
    closed({ attempt2Records: { 'control/08': { ...recs2['control/08'], servedAmendment: null } } }, /the served amendment was not the frozen one/, 'refute A1 N3: servedAmendment');
    // Results scored from the attempt-1 records (the refusal) instead of attempt 2: closed.
    const fromAttempt1 = computeCensusResults({ rules: sub, plugins, records: recs1, ledgerLines: allLines, denominator: 3, scorerSha256: scorerPin });
    const forged = { ...fromAttempt1, amendment: results.amendment, code: results.code, attempt1Code: results.attempt1Code };
    assert.notEqual(JSON.stringify(fromAttempt1.score), JSON.stringify(results.score), 'attempt 2 changes the score');
    closed({ resultsBytes: JSON.stringify(forged) }, /not the scorer's recompute \(tampered\)/, 'results scored from attempt 1');
  });
});

test('a re-call that fails again stays error, and there is no third attempt', LONG, async () => {
  // Practice 1-4; counted c08 T (5) limit; recall c08 T (6) limit again.
  await withFake({ 5: 'limit', 6: 'limit' }, async ({ dir, paths, ledger, log }) => {
    const outDir2 = join(dir, 'attempt-2');
    await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    await runCensus({ ...paths, mode: 'rehearsal', only: ['control/08'], log: () => {} });
    const f = join(paths.outDir, 'control/08.json'); const r = JSON.parse(readFileSync(f, 'utf8')); r.code = amendment.attempt1Code; writeFileSync(f, `${JSON.stringify(r, null, 2)}\n`);
    const now = new Date(Date.parse(A_NB) + 1000);
    const first = JSON.parse(readFileSync(f, 'utf8')).translator.callId;
    const stopped = await runCensus({ ...paths, outDir2, mode: 'rehearsal', rehearsalOf: 'recall', freeze: FROZEN, now, only: ['control/08'], rehearsalEligible: [first], log: () => {} });
    assert.equal(stopped.partial.reason, 'client-limit', 'the re-call was refused again: the breaker stops the invocation');
    const a2 = JSON.parse(readFileSync(join(outDir2, 'control/08.json'), 'utf8'));
    assert.deepEqual([a2.final.final, a2.translator.harnessFailure, a2.adjudicator.called], ['error', 'nonzero-exit', false]);
    const n = log().length;
    const again = await runCensus({ ...paths, outDir2, mode: 'rehearsal', rehearsalOf: 'recall', freeze: FROZEN, now, only: ['control/08'], rehearsalEligible: [first], log: () => {} });
    assert.deepEqual([again.called, log().length - n], [0, 0], 'no third attempt');
    assert.equal(ledger.entries().filter(l => l.ruleId === 'control/08').length, 2, 'one attempt-1 line, one attempt-2 line');
  });
});

test('refute A1 N1: the circuit breaker stops a recall at the first limit refusal; the rest stay uncalled and resumable. --dry-run calls nothing', LONG, async () => {
  // Practice 1-4. Counted: c08 T (5) limit -> stop; c09 T (6) limit -> stop; c10 T (7), A (8).
  // Recall: c08 T (9) limit -> stop, c09 untouched; next recall: c09 T (10), A (11).
  const ids = ['control/08', 'control/09', 'control/10'];
  await withFake({ 5: 'limit', 6: 'limit', 9: 'limit' }, async ({ dir, paths, ledger, log }) => {
    const outDir2 = join(dir, 'attempt-2');
    await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    for (let i = 0; i < 3; i += 1) await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    for (const id of ids) { const f = join(paths.outDir, `${id}.json`); const r = JSON.parse(readFileSync(f, 'utf8')); r.code = amendment.attempt1Code; writeFileSync(f, `${JSON.stringify(r, null, 2)}\n`); }
    const eligibleIds = ['control/08', 'control/09'].map(id => JSON.parse(readFileSync(join(paths.outDir, `${id}.json`), 'utf8')).translator.callId);
    const now = new Date(Date.parse(A_NB) + 1000);
    const opts = { ...paths, outDir2, rehearsalOf: 'recall', freeze: FROZEN, now, only: ids, rehearsalEligible: eligibleIds, log: () => {} };
    const n0 = log().length, lines0 = ledger.entries().length;
    const plan = await runCensus({ ...opts, mode: 'rehearsal', dryRun: true });
    assert.deepEqual([plan.dryRun, plan.eligible, plan.remaining, plan.eligibleSetPinned], [true, ['control/08', 'control/09'], ['control/08', 'control/09'], true]);
    assert.ok(plan.projectedUsd > plan.spentUsd && plan.formula.includes('1.5'));
    assert.deepEqual([log().length - n0, ledger.entries().length - lines0, existsSync(outDir2)], [0, 0, false], 'a dry run makes no call, no line, no record');
    const r1 = await runCensus({ ...opts, mode: 'rehearsal' });
    assert.deepEqual([r1.partial.reason, r1.partial.ruleId, r1.called], ['client-limit', 'control/08', 1]);
    assert.equal(existsSync(join(outDir2, 'control/09.json')), false, 'the next eligible rule stays uncalled');
    const r2 = await runCensus({ ...opts, mode: 'rehearsal' });
    assert.deepEqual([r2.partial, r2.called, r2.skipped], [null, 2, 1], 'a later invocation calls the remaining rule');
    assert.notEqual(JSON.parse(readFileSync(join(outDir2, 'control/09.json'), 'utf8')).final.final, 'error');
    assert.equal(JSON.parse(readFileSync(join(outDir2, 'control/08.json'), 'utf8')).final.final, 'error', 'the refused re-call stays error');
  });
});
