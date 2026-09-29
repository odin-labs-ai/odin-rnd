import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  AMENDMENT_02_SHA256, AMENDMENT_SHA256, NOT_BEFORE_02, answerKeyCopies, answerKeyPreflight, checkPreflightForScoring, checkPreflightRecord, checkRecords, defaultScanRoots, effectiveSpendCap, NOT_BEFORE, PARENT_SHA256, readRunnerPins, renderRunnerPins, RUNNER_FILES, RUNNER_PINS, runnerCodeShas, scrubTempPath, sha256, UNSCANNABLE_REASON,
} from '../experiments/jev-gate/runner-guard.mjs';
import { execFileSync } from 'node:child_process';
import {
  BILLED, chooseClaude, childEnv, classifyRun, DEFAULT_TARBALL, FAKE_CLAUDE, hangStop, parseVerdict, patchPaths, renderCommand,
  FENCE5_SETTINGS, ISOLATION, ISOLATION_VARIANTS, SANDBOX_DENY_READ, scrubPaths, scrubRecord, reviewerArgs, runReviewer, SpendLedger, stageWorkspace,
} from '../experiments/jev-gate/run_reviewer.mjs';
import { validateGateRun } from '../experiments/jev-gate/results.mjs';
import { scratchDir, removeScratch } from './jev-gate-scratch.mjs';
import { check as checkScrubbed, RECORDS as SCRUBBED_RECORDS } from '../experiments/jev-gate/rescrub-records.mjs';

// EXP 005 WO-01/02 mechanics for $0: the guard, the reviewer's command, parse rule, failure classes, spend
// guard and hang-stop, and an end-to-end run against a fake `claude` on PATH. No model is called.
const pinsFile = 'experiments/jev-gate/fixtures/pins.fixture.json';
const pins = JSON.parse(readFileSync(pinsFile, 'utf8'));
const amendmentFile = resolve('experiments/jev-gate/fixtures', pins.amendmentFile);
const { prereg } = checkRecords({ pins, amendmentFile });
// The answer-key pre-flight is no longer part of the guard --check (it is a slow machine scan): the runners run
// answerKeyPreflight before their paid loop. So no checkRecords call here scans, and the pre-flight tests below
// drive answerKeyPreflight/answerKeyCopies directly with roots they control.

test('the guard holds the published parent and the frozen amendment, and passes on the committed records', () => {
  assert.equal(PARENT_SHA256, '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a');
  assert.equal(sha256(readFileSync('experiments/jev-gate/preregistration.json')), PARENT_SHA256);
  // Frozen after odin-rnd #13 merged: the committed amendment and its sha file carry exactly this sha.
  assert.equal(AMENDMENT_SHA256, '5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb');
  assert.equal(sha256(readFileSync('experiments/jev-gate/amendment-01.json')), AMENDMENT_SHA256);
  assert.equal(readFileSync('experiments/jev-gate/amendment-01.sha256', 'utf8').slice(0, 64), AMENDMENT_SHA256);
  // Not-before: #13's merge time, after the parent's (#12, 02:16:26Z) and on the amendment's own date.
  assert.equal(NOT_BEFORE, '2026-09-28T12:01:15Z');
  const amendment = JSON.parse(readFileSync('experiments/jev-gate/amendment-01.json', 'utf8'));
  assert.ok(NOT_BEFORE.startsWith(amendment.date) && Date.parse(NOT_BEFORE) > Date.parse('2026-09-28T02:16:26Z'));
  const { stamp } = checkRecords({ mode: 'probe' });
  assert.equal(stamp.fixture, false);
  assert.equal(stamp.notBefore, NOT_BEFORE);
  assert.throws(() => checkRecords({ mode: 'probe', now: new Date(NOT_BEFORE) }), /not after the not-before/);
  // Amendment 02 is frozen (odin-rnd #14): its sha and not-before are set, and a counted gate waits for its
  // merge time. The committed amendment-02.json hashes to the frozen sha, and its not-before is #14's mergedAt,
  // after amendment 01's (#13, 12:01:15Z).
  assert.equal(AMENDMENT_02_SHA256, '75d231c255d70fa537cb3f4fc90e780be053b42aa5fc8997f003009297d8cb9b');
  assert.equal(sha256(readFileSync('experiments/jev-gate/amendment-02.json')), AMENDMENT_02_SHA256);
  assert.equal(NOT_BEFORE_02, '2026-09-28T18:36:49Z');
  assert.ok(Date.parse(NOT_BEFORE_02) > Date.parse(NOT_BEFORE));
  // A counted run now passes the guard (--check does no machine scan): the stamp is counted, its clock is
  // amendment 02's, and it names the frozen amendment-02 sha.
  const counted = checkRecords({ mode: 'counted' }).stamp;
  assert.equal(counted.mode, 'counted');
  assert.equal(counted.notBefore, NOT_BEFORE_02);
  assert.equal(counted.amendment02Sha256, AMENDMENT_02_SHA256);
  assert.throws(() => checkRecords({ mode: 'counted', now: new Date(NOT_BEFORE_02) }), /not after amendment 02's not-before/);
  assert.doesNotThrow(() => checkRecords({ mode: 'practice' }));
  assert.throws(() => checkRecords({ mode: 'measured' }), /unknown run mode/);
  assert.throws(() => checkRecords({ amendmentFile }), /needs fixture pins/, 'another amendment file needs fixture pins');
});

test('runners.sha256 pins the runner and results code, and a counted run refuses if it drifts', () => {
  assert.deepEqual(readRunnerPins(), runnerCodeShas(), `${RUNNER_PINS} is stale: run node experiments/jev-gate/runner-guard.mjs --write-runner-pins`);
  assert.equal(readFileSync(RUNNER_PINS, 'utf8'), renderRunnerPins(runnerCodeShas()));
  const dir = scratchDir('freeze');
  try {
    const amendment = JSON.parse(readFileSync('experiments/jev-gate/amendment-01.json', 'utf8'));
    const files = [...Object.keys(prereg.files), ...Object.keys(amendment.files ?? {}), ...RUNNER_FILES, RUNNER_PINS,
      'experiments/jev-gate/preregistration.json', 'experiments/jev-gate/preregistration.sha256', 'experiments/jev-gate/amendment-01.json', 'experiments/jev-gate/amendment-01.sha256'];
    for (const rel of new Set(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); cpSync(rel, join(dir, rel)); }
    assert.doesNotThrow(() => checkRecords({ root: dir, mode: 'probe' }));
    writeFileSync(join(dir, 'experiments/jev-gate/results.mjs'), `${readFileSync('experiments/jev-gate/results.mjs', 'utf8')}\n`);
    assert.throws(() => checkRecords({ root: dir, mode: 'probe' }), /runner code differs .*results\.mjs/);
    assert.doesNotThrow(() => checkRecords({ root: dir, pins, amendmentFile }), 'a fixture run records its code without refusing');
  } finally { removeScratch(dir); }
});

test('the guard refuses a wrong amendment sha, a wrong parent, an early clock and a missing not-before', () => {
  assert.throws(() => checkRecords({ pins: { ...pins, amendmentSha256: '0'.repeat(64) }, amendmentFile }), /not the frozen/);
  assert.throws(() => checkRecords({ pins: { ...pins, parentSha256: '0'.repeat(64) }, amendmentFile }), /not the published/);
  assert.throws(() => checkRecords({ pins, amendmentFile, now: new Date(Date.parse(pins.notBefore) - 1000) }), /not after the not-before/);
  assert.throws(() => checkRecords({ pins, amendmentFile, now: new Date(pins.notBefore) }), /not after the not-before/, 'equal is not after');
  assert.throws(() => checkRecords({ pins: { ...pins, notBefore: null }, amendmentFile }), /not-before time is not frozen/);
  assert.equal(checkRecords({ pins, amendmentFile }).stamp.fixture, true);
});

test('the guard refuses an amendment that names another parent or lacks a field the runners read, and any drifted pinned file', () => {
  const dir = scratchDir('guard');
  try {
    const write = mutate => {
      const a = JSON.parse(readFileSync(amendmentFile, 'utf8')); mutate(a);
      const text = `${JSON.stringify(a, null, 2)}\n`, file = join(dir, 'amendment-01.json');
      writeFileSync(file, text); writeFileSync(join(dir, 'amendment-01.sha256'), `${sha256(text)}  amendment-01.json\n`);
      return () => checkRecords({ pins: { ...pins, amendmentSha256: sha256(text) }, amendmentFile: file });
    };
    assert.doesNotThrow(write(() => {}));
    assert.throws(write(a => { a.parent.sha256 = 'f'.repeat(64); }), /does not name the published parent/);
    assert.throws(write(a => { delete a.changes.reviewer.nina.tarball; }), /tarball/);
    assert.throws(write(a => { a.changes.reviewer.workspace.fragments = { '../x': 'y' }; }), /outside \.nina/);
    assert.throws(write(a => { a.changes.spotlight.criteria.pop(); }), /four spotlight criteria/);
    assert.throws(write(a => { a.files = { 'experiments/jev-gate/rules.txt': '0'.repeat(64) }; }), /pins experiments\/jev-gate\/rules\.txt/);
    // A pinned file of the parent that drifts: a copy of the repo's pinned files with one byte changed.
    const root = join(dir, 'root');
    for (const rel of new Set([...Object.keys(prereg.files), ...RUNNER_FILES, 'experiments/jev-gate/preregistration.json', 'experiments/jev-gate/preregistration.sha256'])) {
      mkdirSync(dirname(join(root, rel)), { recursive: true }); cpSync(rel, join(root, rel));
    }
    assert.doesNotThrow(() => checkRecords({ root, pins, amendmentFile }));
    writeFileSync(join(root, 'experiments/jev-gate/inputs.json'), `${readFileSync('experiments/jev-gate/inputs.json', 'utf8')} `);
    assert.throws(() => checkRecords({ root, pins, amendmentFile }), /pins experiments\/jev-gate\/inputs\.json/);
  } finally { removeScratch(dir); }
});

test('the reviewer argv is exactly the pre-registered command, built from the record', () => {
  const args = reviewerArgs(prereg);
  assert.equal(renderCommand(args), prereg.gates.reviewer.command);
  assert.equal(args[1], prereg.gates.reviewer.prompt);
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git show:*)', 'Bash(git log:*)']);
  assert(!args.includes('WebFetch') && !args.includes('Bash'), 'no web tool and no unrestricted Bash');
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'dontAsk']);
  assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2), ['--setting-sources', 'project']);
});

test('the strict parse rule: first matching line anywhere, case-sensitive, at the start of a line', () => {
  const p = t => parseVerdict(prereg, t).decision;
  assert.equal(p('VERDICT: APPROVED\nreasons'), 'ACCEPT', 'first line');
  assert.equal(p('reasons\n\nmore\nVERDICT: REJECTED\ntrailer'), 'REJECT', 'buried');
  assert.equal(p('VERDICT: REJECTED\nlater\nVERDICT: APPROVED'), 'REJECT', 'the first match wins');
  assert.equal(p('no decision here'), null, 'missing');
  assert.equal(p('verdict: rejected'), null, 'lower case is not a verdict');
  assert.equal(p('  VERDICT: REJECTED'), null, 'indented is not a verdict');
  assert.equal(p('The VERDICT: APPROVED line'), null, 'mid-line is not a verdict');
  assert.equal(p('**VERDICT: APPROVED**'), null, 'markdown-wrapped is not a verdict');
  assert.equal(p(null), null);
});

test('harness failures are exactly the pre-registered classes; a result without a verdict is a model abstention', () => {
  const ok = JSON.stringify({ result: 'x', is_error: false });
  assert.equal(classifyRun({ timedOut: true, exitCode: null, stdout: '' }).harnessFailure, 'timeout');
  assert.equal(classifyRun({ timedOut: false, exitCode: 1, stdout: ok }).harnessFailure, 'exit-1');
  assert.equal(classifyRun({ timedOut: false, exitCode: 0, stdout: '' }).harnessFailure, 'missing-json');
  assert.equal(classifyRun({ timedOut: false, exitCode: 0, stdout: 'not json {' }).harnessFailure, 'unparseable-json');
  assert.equal(classifyRun({ timedOut: false, exitCode: 0, stdout: JSON.stringify({ result: 'x', is_error: true }) }).harnessFailure, 'is-error');
  assert.equal(classifyRun({ timedOut: false, exitCode: 0, stdout: JSON.stringify({ result: '  ' }) }).harnessFailure, 'empty-result');
  assert.equal(classifyRun({ timedOut: false, exitCode: 0, stdout: ok }).harnessFailure, null);
});

test('the spend guard stops before a call that could pass the cap, and the hang-stop waits for minRuns', () => {
  const dir = scratchDir('ledger');
  try {
    const cap = prereg.spendCap, ledger = new SpendLedger(join(dir, 'spend.jsonl'), cap);
    assert.equal(ledger.check('reviewer').ok, true);
    assert.equal(ledger.largest('reviewer'), cap.alreadySpentUsd, 'before any run the reviewer reserves at least alreadySpentUsd');
    ledger.append({ gate: 'reviewer', costUsd: 2 });
    ledger.append({ gate: 'jev', costUsd: null });
    assert.equal(ledger.spent(), cap.alreadySpentUsd + 2);
    // A fake cost that brings the ledger to within one largest call of the cap stops the next call.
    ledger.append({ gate: 'reviewer', costUsd: cap.usd - cap.alreadySpentUsd - 2 - 1 });
    assert.equal(ledger.check('reviewer').ok, false);
    assert.equal(ledger.check('jev').ok, true, 'Jev has recorded no cost yet');
    const hs = prereg.gates.reviewer.hangStop;
    assert.equal(hangStop(hs, hs.minRuns - 1, hs.minRuns - 1), false, 'before minRuns a timeout never stops the run');
    assert.equal(hangStop(hs, hs.minRuns, Math.floor(hs.minRuns * hs.fraction)), false, 'at the fraction is not above it');
    assert.equal(hangStop(hs, hs.minRuns, Math.floor(hs.minRuns * hs.fraction) + 1), true);
  } finally { removeScratch(dir); }
});

test('billing keys are stripped as nina eval strips them, and recorded by name only', () => {
  const { env, stripped } = childEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_USE_BEDROCK: '1', GIT_CONFIG_GLOBAL: '/home/x/.gitconfig' }, '/tmp/nd');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null', "the operator's global git config never reaches the reviewer");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.deepEqual(stripped, ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK']);
  for (const k of BILLED) assert(!(k in env));
  assert.equal(env.NINA_DATA, '/tmp/nd');
  assert.deepEqual(patchPaths('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n'), ['src/a.ts']);
});

test('a fixture run can only reach the fake claude, and a counted run never can', () => {
  const dir = scratchDir('bin');
  try {
    const fake = join(dir, 'fake'), other = join(dir, 'other');
    mkdirSync(fake); mkdirSync(other);
    symlinkSync(FAKE_CLAUDE, join(fake, 'claude'));
    writeFileSync(join(other, 'claude'), '#!/bin/sh\nexit 0\n'); chmodSync(join(other, 'claude'), 0o755);
    assert.throws(() => chooseClaude(true, other), /must use the fake claude/);
    assert.throws(() => chooseClaude(false, fake), /cannot use the fake/);
    assert.equal(chooseClaude(true, `${fake}:${other}`), join(fake, 'claude'));
    // A fake that is not executable is skipped by PATH lookup; the fixture run then refuses instead of
    // falling through to whatever claude comes next (the 2026-09-28 incident).
    const copy = join(dir, 'copy'); mkdirSync(copy); cpSync(FAKE_CLAUDE, join(copy, 'claude')); chmodSync(join(copy, 'claude'), 0o644);
    assert.throws(() => chooseClaude(true, `${copy}:${other}`), /must use the fake claude/);
  } finally { removeScratch(dir); }
});

// End to end against the fake claude. Needs the pinned nina tarball, which CI does not have.
const haveTarball = existsSync(DEFAULT_TARBALL);
const e2e = { skip: haveTarball ? false : `no pinned nina tarball at ${DEFAULT_TARBALL} (local only)`, timeout: 600_000 };

async function withFake(modes, fn) {
  const dir = scratchDir('e2e');
  const bin = join(dir, 'bin'); mkdirSync(bin);
  chmodSync(FAKE_CLAUDE, 0o755);
  symlinkSync(FAKE_CLAUDE, join(bin, 'claude'));
  const saved = { ...process.env };
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_MODES: modes, FAKE_CLAUDE_STATE: join(dir, 'state'), FAKE_CLAUDE_LOG: join(dir, 'fake.jsonl'), ANTHROPIC_API_KEY: 'must-be-stripped' });
  try {
    return await fn({ dir, log: () => (existsSync(join(dir, 'fake.jsonl')) ? readFileSync(join(dir, 'fake.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []) });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    removeScratch(dir);
  }
}

const item = id => ({ id, patch: readFileSync(`experiments/jev-gate/corpus/${id}.patch`, 'utf8') });

test('a fixture run stages the pinned workspace, runs k times and records verdicts, failures and cost', e2e, async () => {
  await withFake('buried,missing,iserror', async ({ dir, log }) => {
    const out = join(dir, 'run.json'), ledgerPath = join(dir, 'spend.jsonl');
    const record = await runReviewer({ out, ledgerPath, items: [item('c004')], pins, amendmentFile, log: () => {} });
    validateGateRun(record);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), record);
    assert.equal(record.fixture, true); assert.equal(record.partial, null);
    assert.equal(record.calls.length, prereg.gates.reviewer.k);
    assert.deepEqual(record.calls.map(c => [c.decision, c.abstention, c.harnessFailure]), [['REJECT', null, null], [null, 'model', null], [null, 'failure', 'is-error']]);
    assert.equal(new Set(record.calls.map(c => c.baseSha)).size, 1, 'the base sha is identical across runs');
    assert.deepEqual(record.calls[0].statusBefore, patchPaths(item('c004').patch));
    assert.deepEqual(record.pins.patches, []);
    assert(record.calls.every(c => c.billingKeysStripped.includes('ANTHROPIC_API_KEY') && !c.treeChangedByRun));
    assert.doesNotMatch(JSON.stringify(record), /must-be-stripped|\/Users\//);
    const seen = log();
    assert.equal(seen.length, 3);
    for (const s of seen) {
      assert.deepEqual(s.argv, reviewerArgs(prereg, undefined, ISOLATION));
      assert.deepEqual(s.billedKeys, [], 'no billing key reaches the child');
      assert.deepEqual([s.gitConfigGlobal, s.gitConfigNoSystem], ['/dev/null', '1'], 'no operator git config reaches the child');
      assert.equal(s.log.trim(), 'base|base|base@example.invalid|2026-01-01T00:00:00Z', 'one base commit under the pinned identity');
      assert(s.hasRules && s.hasReviewer, 'rules.txt and the composed reviewer are in the base commit');
      assert.deepEqual(s.status.split('\n').filter(Boolean).map(l => l.slice(3)), patchPaths(item('c004').patch), 'git status shows exactly the change');
      assert(s.ninaData && !s.ninaData.includes('.nina'), 'NINA_DATA is a per-run temp dir');
      assert.equal(s.parentHasCanary, false);
    }
    const ledger = readFileSync(ledgerPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(ledger.map(e => [e.gate, e.id, e.run, e.fixture]), [['reviewer', 'c004', 1, true], ['reviewer', 'c004', 2, true], ['reviewer', 'c004', 3, true]]);
  });
});

test('the spend guard stops a fixture run before its first call when the ledger is at the cap', e2e, async () => {
  await withFake('decide', async ({ dir, log }) => {
    const ledgerPath = join(dir, 'spend.jsonl');
    writeFileSync(ledgerPath, `${JSON.stringify({ gate: 'reviewer', costUsd: prereg.spendCap.usd - prereg.spendCap.alreadySpentUsd - 0.01 })}\n`);
    const record = await runReviewer({ out: join(dir, 'run.json'), ledgerPath, items: [item('c004')], pins, amendmentFile, log: () => {} });
    assert.equal(record.partial.reason, 'spend-cap');
    assert.equal(record.calls.length, 0);
    assert.equal(log().length, 0, 'no call was made');
  });
});

test('the isolation probe: the canary sits outside the repository, and web and non-git Bash are denied', e2e, async () => {
  await withFake('decide', async ({ dir, log }) => {
    const record = await runReviewer({ out: join(dir, 'probe.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [], probe: true, pins, amendmentFile, log: () => {} });
    const call = record.calls[0];
    assert.equal(record.mode, 'isolation-probe');
    assert.equal(call.probePassed, true); assert.equal(call.canaryLeaked, false);
    assert.deepEqual(call.permissionDenials.map(d => d.tool).sort(), ['Bash', 'Bash', 'Bash', 'Read', 'WebFetch']);
    const [seen] = log();
    assert.equal(seen.parentHasCanary, true, 'the canary is in the parent directory');
    assert(seen.attempts.find(a => a.tool === 'Bash' && a.input.command === 'git diff').ok, 'git diff is allowed');
  });
  await withFake('leak', async ({ dir }) => {
    const record = await runReviewer({ out: join(dir, 'probe.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [], probe: true, pins, amendmentFile, log: () => {} });
    assert.equal(record.calls[0].canaryLeaked, true);
    assert.equal(record.calls[0].probePassed, false);
  });
});

test('a real (non-fixture) run refuses before any call when claude on PATH is the fake', e2e, async () => {
  await withFake('decide', async ({ dir, log }) => {
    await assert.rejects(runReviewer({ out: join(dir, 'run.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [item('c004')], practice: true, log: () => {} }), /cannot use the fake/);
    assert.equal(log().length, 0);
    assert.equal(existsSync(join(dir, 'spend.jsonl')), false);
  });
});

test('the base commit must be the sha the amendment pins', e2e, () => {
  const { amendment } = checkRecords({ pins, amendmentFile });
  const dir = scratchDir('stage');
  try {
    mkdirSync(join(dir, 'a')); mkdirSync(join(dir, 'b'));
    const staged = stageWorkspace({ prereg, amendment, patch: item('c004').patch, tarball: DEFAULT_TARBALL, parent: join(dir, 'a') });
    assert.equal(staged.baseSha, amendment.changes.reviewer.workspace.baseCommit.sha);
    const wrong = structuredClone(amendment); wrong.changes.reviewer.workspace.baseCommit.sha = '0'.repeat(40);
    assert.throws(() => stageWorkspace({ prereg, amendment: wrong, patch: null, tarball: DEFAULT_TARBALL, parent: join(dir, 'b') }), /not the pinned/);
  } finally { removeScratch(dir); }
});

test('the spend ledger starts from the amendment\'s alreadySpentUsd when it states one', () => {
  const { amendment, stamp } = checkRecords({ pins, amendmentFile });
  assert.equal(stamp.spendCap.alreadySpentUsd, amendment.spend.alreadySpentUsd);
  assert.equal(stamp.spendCap.alreadySpentFrom, 'amendment-01');
  assert.equal(stamp.spendCap.usd, prereg.spendCap.usd, 'the cap itself is the parent\'s');
  const { spend: _, ...without } = amendment;
  assert.deepEqual(effectiveSpendCap(prereg, without), { ...prereg.spendCap, alreadySpentFrom: 'preregistration', countFrom: null });
  assert.throws(() => effectiveSpendCap(prereg, { spend: { alreadySpentUsd: prereg.spendCap.alreadySpentUsd / 2 } }), /no lower/);
  assert.throws(() => effectiveSpendCap(prereg, { spend: { alreadySpentUsd: '1' } }), /no lower/);
  const dir = scratchDir('ledger2');
  try {
    const ledger = new SpendLedger(join(dir, 'spend.jsonl'), stamp.spendCap);
    assert.equal(ledger.spent(), amendment.spend.alreadySpentUsd);
    assert.equal(ledger.largest('reviewer'), amendment.spend.alreadySpentUsd);
  } finally { removeScratch(dir); }
});

test('the isolation fix: exact flags, and what differs from the pre-registered command', () => {
  // Round 5 (refute r4 of amendment 02): defence in depth, both layers. Layer 1 denies every git command whose
  // text could differ from git's argv (quotes, backslash, braces, backtick, --output, --no-index, <, >). Layer 2
  // is the Bash sandbox: writes only to the workspace and its own temp, and now denyRead over the shared temp
  // roots so answer-key copies there are unreadable to the sandboxed reviewer.
  assert.equal(ISOLATION, 'fence5');
  assert.deepEqual(ISOLATION_VARIANTS.narrow, { fileTools: ['Read(./**)', 'Grep(./**)', 'Glob(./**)'], settings: { permissions: { blockReadsOutsideWorkingDirectories: true } } });
  const args = reviewerArgs(prereg, 'P', ISOLATION);
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  // The exact flags, built from the runner's own exported constants (renderCommand serialises this settings back).
  assert.deepEqual(settings, FENCE5_SETTINGS);
  assert.deepEqual(settings.sandbox, { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false, filesystem: { denyRead: SANDBOX_DENY_READ } });
  assert.deepEqual(SANDBOX_DENY_READ, ['/private/tmp', '/tmp', '/private/var/folders', '/var/folders']);
  assert.deepEqual(settings.permissions.deny, ['Bash(git *--output*)', 'Bash(git *--no-index*)', 'Bash(git *<*)', 'Bash(git *>*)', "Bash(git *'*)", 'Bash(git *"*)', 'Bash(git *\\*)', 'Bash(git *{*)', 'Bash(git *}*)', 'Bash(git *`*)']);
  assert.equal(settings.permissions.blockReadsOutsideWorkingDirectories, true);
  assert.equal(renderCommand(args), `claude -p <prompt> --agent reviewer --model claude-opus-5-5 --effort high --output-format json --no-session-persistence --setting-sources project --permission-mode dontAsk --settings ${JSON.stringify(JSON.stringify(FENCE5_SETTINGS))} --allowedTools "Read(./**)" "Grep(./**)" "Glob(./**)" "Bash(git diff:*)" "Bash(git status:*)" "Bash(git show:*)" "Bash(git log:*)"`);
  assert.ok(args.indexOf('--settings') < args.indexOf('--allowedTools'), '--settings comes before the variadic --allowedTools');
  const tools = args.slice(args.indexOf('--allowedTools') + 1);
  assert.deepEqual(tools.slice(3), prereg.gates.reviewer.allowedTools.slice(3), 'the git allow rules are the pre-registered ones');
  // Layer 2 alone, for the probe that shows it stands on its own: the sandbox, no text deny rules.
  assert.deepEqual(JSON.parse(reviewerArgs(prereg, 'P', 'sandbox-only')[reviewerArgs(prereg, 'P', 'sandbox-only').indexOf('--settings') + 1]), { permissions: { blockReadsOutsideWorkingDirectories: true }, sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false } });
  assert.equal(renderCommand(reviewerArgs(prereg)), prereg.gates.reviewer.command);
  const head = a => a.slice(0, a.indexOf('--permission-mode') + 2);
  assert.deepEqual(head(args), head(reviewerArgs(prereg, 'P')));
  assert.equal(AMENDMENT_02_SHA256, '75d231c255d70fa537cb3f4fc90e780be053b42aa5fc8997f003009297d8cb9b', 'amendment 02 is frozen');
});

test('with amendment 02 frozen, a counted run passes the guard and then refuses the fake claude', e2e, async () => {
  await withFake('decide', async ({ dir, log }) => {
    // Amendment 02 is frozen, so the guard no longer refuses a counted run for that reason. It passes the guard
    // (the module points the pre-flight at a non-existent root) and then refuses because the resolved client is
    // the committed fake, so no call is made.
    await assert.rejects(runReviewer({ out: join(dir, 'run.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [item('c004')], log: () => {} }), /cannot use the fake/);
    assert.equal(log().length, 0, 'no call was made');
    assert.equal(existsSync(join(dir, 'spend.jsonl')), false);
  });
});

test('the isolation matrix against the fake: fenced rows, working controls, and a leak when unfenced', e2e, async () => {
  await withFake('decide', async ({ dir }) => {
    // Round 1's flags (the file-tool fence alone): the v2 rows catch git's own ways out.
    const record = await runReviewer({ out: join(dir, 'm.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [], probe: 'matrix', variant: 'narrow', pins, amendmentFile, log: () => {} });
    const m = record.calls[0].matrix;
    // As live (isolation-probe-v2-round1.json): the fence refuses git diff's outside paths, but --output writes out.
    assert.deepEqual(Object.entries(m.rows).filter(([, r]) => r.leaked).map(([k]) => k).sort(), ['r11', 'r12', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r31'], JSON.stringify(m.rows));
    assert.equal(m.rows.r11.wroteOutside, true);
    assert.equal(record.calls[0].probePassed, false);
  });
  await withFake('decide', async ({ dir }) => {
    // fence3's text rules match text, and the shell removes quotes, backslashes and braces before git sees them
    // (refute r3): exactly the v4 quoting rows escape; fence4's text layer closes them.
    const record = await runReviewer({ out: join(dir, 'm.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [], probe: 'matrix', variant: 'fence3', pins, amendmentFile, log: () => {} });
    const m = record.calls[0].matrix;
    assert.deepEqual(Object.entries(m.rows).filter(([, r]) => r.leaked).map(([k]) => k).sort(), ['r20', 'r21', 'r22', 'r23', 'r24', 'r25'], JSON.stringify(m.rows));
  });
  await withFake('decide', async ({ dir }) => {
    const record = await runReviewer({ out: join(dir, 'm.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [], probe: 'matrix', pins, amendmentFile, log: () => {} });
    const m = record.calls[0].matrix;
    assert.equal(record.mode, 'isolation-matrix');
    assert.deepEqual(Object.keys(m.rows).sort(), ['r1', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r19b', 'r2', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r29', 'r3', 'r30', 'r31', 'r4', 'r5', 'r6', 'r7', 'r8', 'r8b', 'r8c', 'r9']);
    assert.deepEqual(Object.keys(m.controls), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
    assert.deepEqual(m.info, { r28: { refusedByClient: false, modelSays: 'ALLOWED' } }, 'the client strips redirections before matching, so the > rule does not fire on 2>/dev/null (refute r4, R4-B1)');
    // No operator-specific path survives. The bare denyRead config roots (/var/folders, /private/var/folders with
    // nothing after) are public config, not paths; a real temp path carries a user bucket (two segments after
    // var/folders), a /private/tmp/claude session dir, a home path, or a run-dir id.
    assert.doesNotMatch(readFileSync(join(dir, 'm.json'), 'utf8'), /\/(?:private\/)?var\/folders\/[^/"\\]+\/|\/private\/tmp\/claude|\/Users\/|jev-gate-reviewer-[A-Za-z0-9]{6}/, 'the written record has no operator path');
    // Judged by leaks, not labels: git show of an outside path is permitted by `git show:*` and refused by git itself.
    assert(Object.values(m.rows).every(r => !r.leaked), JSON.stringify(m.rows));
    assert(Object.values(m.controls).every(c => c.worked), JSON.stringify(m.controls));
    assert.equal(m.clientVersion, '2.1.280');
    assert.equal(record.calls[0].probePassed, true);
    assert.equal(record.calls[0].treeChangedByRun, false, 'the probe symlink is in statusBefore');
  });
  await withFake('decide', async ({ dir }) => {
    // The pre-registered bare tools with no fence: the fake, like the live client, lets Read out.
    const record = await runReviewer({ out: join(dir, 'm.json'), ledgerPath: join(dir, 'spend.jsonl'), items: [], probe: 'matrix', variant: 'preregistered', pins, amendmentFile, log: () => {} });
    const m = record.calls[0].matrix;
    assert.equal(m.fenced, false);
    assert.equal(m.rows.r1.leaked, true);
    assert.equal(record.calls[0].probePassed, false);
  });
});

test('the ledger never counts a paid call twice: lines at or before countFrom are inside alreadySpentUsd', () => {
  const dir = scratchDir('count');
  try {
    // Amendment 02 will carry alreadySpentUsd = everything up to its merge; lines up to then must be skipped.
    const cap = effectiveSpendCap(prereg, { id: 'amendment-02', spend: { alreadySpentUsd: 2.5 } }, '2026-09-28T13:00:00Z');
    assert.equal(cap.countFrom, '2026-09-28T13:00:00Z');
    const path = join(dir, 'spend.jsonl');
    writeFileSync(path, [
      { ts: '2026-09-28T12:13:00.000Z', gate: 'reviewer', costUsd: 0.2 },
      { ts: '2026-09-28T13:00:00.000Z', gate: 'reviewer', costUsd: 0.3 },
      { ts: '2026-09-28T13:00:00.001Z', gate: 'jev', costUsd: 0.0002 },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');
    const ledger = new SpendLedger(path, cap);
    assert.equal(ledger.entries().length, 1);
    assert.equal(ledger.spent(), 2.5 + 0.0002);
  } finally { removeScratch(dir); }
});

test('local paths are scrubbed deterministically, and nothing else is touched', () => {
  const t = 'Read /private/var/folders/ab/cd/T/jev-gate-reviewer-3c8AEu/canary.txt is outside /var/folders/ab/cd/T/jev-gate-reviewer-3c8AEu/repo; /tmp/jev-gate-reviewer-Ab12Cd/x; /private/tmp/y; /var/folders/ab/cd/T/other; /opt/homebrew/bin/claude; /opt/homebrew/opt/node';
  assert.equal(scrubPaths(t), 'Read <ws>/canary.txt is outside <ws>/repo; <ws>/x; <tmp>/y; <tmp>/other; claude; <homebrew>/opt/node');
  for (const keep of ['git diff src/app/x.ts', 'CANARY-R1-0123456789abcdef', 'attempt/tmpfile', '<ws>/home/probe-user/canary.txt', '2026-09-28T12:01:15Z']) assert.equal(scrubPaths(keep), keep);
  // The session-scratch root's uid is dropped (a sandbox cwd error the reviewer may quote, v5). Derive the uid
  // rather than hard-coding the operator's (refute N8).
  const uid = process.getuid();
  assert.equal(scrubPaths(`<tmp>/claude-${uid}/cwd-a`), '<tmp>/claude-session/cwd-a');
  assert.equal(scrubPaths(`/private/tmp/claude-${uid}/scratchpad/x`), '<tmp>/claude-session/scratchpad/x');
  assert.deepEqual(scrubRecord({ a: ['/tmp/q'], b: { c: '/opt/homebrew/bin/claude' } }), { a: ['<tmp>/q'], b: { c: 'claude' } });
});

test('the evidence records written before write-time scrubbing are scrubbed, and their original shas are disclosed', () => {
  const manifest = checkScrubbed();
  assert.deepEqual(manifest.files.map(f => f.path), SCRUBBED_RECORDS);
  for (const f of manifest.files) assert.match(f.originalSha256, /^[0-9a-f]{64}$/);
  // The shas amendment 02's drafts pinned are the originals.
  assert.equal(manifest.files.find(f => f.path === 'isolation-probe-narrow-3.json').originalSha256, '1580ef083d3d84cdf0d06bd616b78eef5f2a0b01155874d9ce91bf4d4b4b3584');
  assert.equal(manifest.files.find(f => f.path === 'dry-run/isolation-probe.json').originalSha256, 'a5a4bc79295c6a474b2c8754dda40ce661a7b933770408d693eb6b8863fb627f');
});

test('the pre-flight scans only readable temp roots and records the root-owned ones it skips (refute B2)', () => {
  const { scannable, skipped } = defaultScanRoots();
  assert.ok(scannable.length > 0 && scannable.every(r => typeof r === 'string'), 'some readable temp root is scanned');
  assert.ok(scannable.some(r => /\/tmp$/.test(r)), `no tmp root scanned: ${scannable.join(', ')}`);
  // Root-owned /var/folders buckets the operator cannot read are recorded, not scanned. The reason names the roots
  // WITHOUT a trailing slash, so the corpus lint does not flag a runner's own recorded pre-flight.
  for (const s of skipped) { assert.equal(s.reason, UNSCANNABLE_REASON); assert.match(s.base, /\/var\/folders$/); assert.ok(Number.isInteger(s.unreadableBuckets)); }
  assert.doesNotMatch(UNSCANNABLE_REASON, /\/var\/folders\/|\/private\/var\/folders\//, 'the skip reason has no trailing-slash path the lint would flag');
  // An unreadable root is skipped, not a scan failure (it is covered by the sandbox denyRead).
  const dir = scratchDir('unreadable');
  try { chmodSync(dir, 0o000); assert.deepEqual(answerKeyCopies({ roots: [dir] }).copies, []); }
  finally { chmodSync(dir, 0o755); removeScratch(dir); }
});

test('the pre-flight counts an unreadable subtree and still finds a copy beside it, without failing closed (refute r2 B2)', () => {
  // A permission-denied (or vanished, ENOENT) entry inside a readable root is benign: `find` reports it on stderr,
  // and answerKeyCopies counts it (permissionSkipped / vanished) rather than treating it as a real scan failure.
  // A byte-for-byte copy in the same readable root is still found. This is the class of churn that used to refuse
  // every counted run under fleet load.
  const dir = scratchDir('subtree');
  const locked = join(dir, 'locked');
  try {
    mkdirSync(locked);
    writeFileSync(join(locked, 'x.txt'), 'x');
    chmodSync(locked, 0o000);
    cpSync('experiments/jev-gate/corpus.sha256', join(dir, 'corpus.sha256'));
    const res = answerKeyCopies({ roots: [dir] });
    assert.deepEqual(res.copies, [{ path: join(dir, 'corpus.sha256'), copyOf: 'experiments/jev-gate/corpus.sha256' }], 'the copy beside the locked subtree is still found');
    assert.ok(res.permissionSkipped >= 1, `the locked subtree is counted, not fatal: ${JSON.stringify(res)}`);
    assert.equal(typeof res.vanished, 'number');
  } finally { chmodSync(locked, 0o755); removeScratch(dir); }
});

test('a scan that did not finish never passes the answer-key pre-flight (refute r3 B1, stub find on PATH)', () => {
  const fakeDir = scratchDir('fakefind');
  const root = scratchDir('scanroot');
  const copy = join(root, 'labels.json');
  cpSync('experiments/jev-gate/labels.json', copy);
  writeFileSync(join(fakeDir, 'find'), [
    '#!/bin/sh',
    'case "$FAKE_FIND_CASE" in',
    '  signal) kill -TERM $$ ;;',
    '  exit137) exit 137 ;;',
    '  exit1_nostderr) exit 1 ;;',
    '  fts_read) printf "find: fts_read: No such file or directory\\n" >&2; exit 1 ;;',
    '  fts_open) printf "find: fts_open: Permission denied\\n" >&2; exit 1 ;;',
    '  root_error) printf "find: %s: No such file or directory\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    '  vanished_inner) printf "find: %s/gone/x.txt: No such file or directory\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    '  copy_benign) printf "%s\\0" "$FAKE_COPY"; printf "find: %s/gone: Permission denied\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    // GNU find (odin-rnd Linux CI) quotes the path. UTF-8 locale uses ‘ … ’; the C locale opens with a backtick
    // and closes with an apostrophe; the shell style uses ' … '. Benign inner skips must stay benign under each.
    '  gnu_vanished) printf "find: ‘%s/gone/x.txt’: No such file or directory\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    '  gnu_perm) printf "find: ‘%s/locked’: Permission denied\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    "  clocale_perm) printf \"find: \\`%s/locked': Permission denied\\n\" \"$FAKE_ROOT\" >&2; exit 1 ;;",
    "  shell_perm) printf \"find: '%s/locked': Permission denied\\n\" \"$FAKE_ROOT\" >&2; exit 1 ;;",
    '  gnu_copy) printf "%s\\0" "$FAKE_COPY"; printf "find: ‘%s/locked’: Permission denied\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    // Quoted forms of the refusals: an error about a scanned root itself, an fts_* traversal abort, and a
    // non-ENOENT/permission message must all still REFUSE even though the path is quoted.
    '  gnu_root_error) printf "find: ‘%s’: Permission denied\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    '  gnu_fts) printf "find: ‘fts_read’: No such file or directory\\n" >&2; exit 1 ;;',
    '  gnu_io) printf "find: ‘%s/x’: Input/output error\\n" "$FAKE_ROOT" >&2; exit 1 ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(join(fakeDir, 'find'), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeDir}:${savedPath}`;
  process.env.FAKE_ROOT = root;
  process.env.FAKE_COPY = copy;
  const run = c => { process.env.FAKE_FIND_CASE = c; return answerKeyCopies({ roots: [root] }); };
  try {
    // Did-not-finish: killed by a signal, or a non-zero exit with no benign line to explain it, must REFUSE.
    assert.throws(() => run('signal'), /killed by/);
    assert.throws(() => run('exit137'), /no benign explanation/);
    assert.throws(() => run('exit1_nostderr'), /no benign explanation/);
    // A traversal abort (fts_*) and an error about a root itself are REAL errors, not benign per-entry skips.
    assert.throws(() => run('fts_read'), /real scan error/);
    assert.throws(() => run('fts_open'), /real scan error/);
    assert.throws(() => run('root_error'), /real scan error/);
    // A genuine inner entry that vanished mid-walk is benign: counted, not fatal.
    const v = run('vanished_inner');
    assert.deepEqual([v.copies, v.vanished], [[], 1]);
    // A real copy alongside a benign inner skip: the copy is found and the skip counted.
    const c = run('copy_benign');
    assert.deepEqual(c.copies, [{ path: copy, copyOf: 'experiments/jev-gate/labels.json' }]);
    assert.equal(c.permissionSkipped, 1);
    // GNU find quoting (odin-rnd Linux CI, refute r6 linux-find): a benign inner ENOENT/permission skip is still
    // benign whether the path is quoted ‘…’ (UTF-8), `…' (C locale) or '…' (shell); a real copy beside a quoted
    // skip is still found; and the quoted refusals (root itself, fts_*, a non-ENOENT/permission message) still refuse.
    const gv = run('gnu_vanished'); assert.deepEqual([gv.copies, gv.vanished], [[], 1]);
    const gp = run('gnu_perm'); assert.deepEqual([gp.copies, gp.permissionSkipped], [[], 1]);
    assert.equal(run('clocale_perm').permissionSkipped, 1);
    assert.equal(run('shell_perm').permissionSkipped, 1);
    const gc = run('gnu_copy');
    assert.deepEqual(gc.copies, [{ path: copy, copyOf: 'experiments/jev-gate/labels.json' }]);
    assert.equal(gc.permissionSkipped, 1);
    assert.throws(() => run('gnu_root_error'), /real scan error/);
    assert.throws(() => run('gnu_fts'), /real scan error/);
    assert.throws(() => run('gnu_io'), /real scan error/);
  } finally {
    process.env.PATH = savedPath;
    delete process.env.FAKE_FIND_CASE; delete process.env.FAKE_ROOT; delete process.env.FAKE_COPY;
    removeScratch(fakeDir); removeScratch(root);
  }
});

test('the counted pre-flight RECORD is validated: a valid record passes, and every stale/forged/wrong-code case refuses (bundle-4)', () => {
  // A counted run no longer scans; it requires the pre-flight record. checkPreflightRecord is what the reviewer
  // calls, run_gates.py calls via --check-preflight, and computeResults re-checks. Build a synthetic record with
  // the current head, runners.sha256 and default roots, then mutate each field.
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runnersSha = sha256(readFileSync('experiments/jev-gate/runners.sha256'));
  const scanned = defaultScanRoots().scannable.map(scrubTempPath); // the record stores scrubbed roots (r5)
  const selfSha = rec => sha256(JSON.stringify({ ...rec, sha256: null }));
  const base = () => {
    const r = { kind: 'answer-key-preflight', mode: 'counted', ok: true, scanned, skipped: [], copies: [], vanished: 3, permissionSkipped: 41, durationMs: 1234, override: null, startedAt: new Date(Date.now() - 3600e3).toISOString(), endedAt: new Date(Date.now() - 1800e3).toISOString(), runnersSha256: runnersSha, head, sha256: null };
    r.sha256 = selfSha(r);
    return r;
  };
  const dir = scratchDir('pfrec');
  const write = rec => { const p = join(dir, 'pf.json'); writeFileSync(p, JSON.stringify(rec, null, 2)); return p; };
  try {
    // A valid, recent record passes and returns {sha256, endedAt, head, scanned} for the runner to stamp.
    const good = base();
    const ok = checkPreflightRecord({ path: write(good) });
    assert.deepEqual([ok.sha256, ok.endedAt, ok.head], [good.sha256, good.endedAt, good.head]);
    assert.deepEqual(ok.scanned, good.scanned);
    // Each bad case refuses. The mutate re-signs (r.sha256 = selfSha(r)) except the deliberate "altered" case.
    const bad = (mutate, re) => { const r = base(); mutate(r); assert.throws(() => checkPreflightRecord({ path: write(r) }), re); };
    bad(r => { r.ok = false; r.copies = [{ path: '<tmp>/x', copyOf: 'y' }]; r.sha256 = selfSha(r); }, /not ok/);
    // ok:true but a non-empty copies list is refused too (r5): ok must mean no copies were found.
    bad(r => { r.copies = [{ path: '<tmp>/x', copyOf: 'y' }]; r.sha256 = selfSha(r); }, /answer-key copies/);
    bad(r => { r.head = '0'.repeat(40); r.sha256 = selfSha(r); }, /git HEAD differs/);
    bad(r => { r.runnersSha256 = '0'.repeat(64); r.sha256 = selfSha(r); }, /runners\.sha256 differs/);
    bad(r => { r.override = '/tmp'; r.sha256 = selfSha(r); }, /override/);
    bad(r => { r.endedAt = new Date(Date.now() - 7 * 3600e3).toISOString(); r.sha256 = selfSha(r); }, /within 2 h/);
    bad(r => { r.endedAt = new Date('2026-09-28T18:36:48Z').toISOString(); r.sha256 = selfSha(r); }, /not-before|within 2 h/);
    bad(r => { r.scanned = [...scanned, '/tmp/extra']; r.sha256 = selfSha(r); }, /different roots/);
    bad(r => { r.vanished = 999; /* not re-signed: altered */ }, /altered/);
    assert.throws(() => checkPreflightRecord({ path: join(dir, 'missing.json') }), /missing/);
    assert.throws(() => checkPreflightRecord({ path: undefined }), /needs a pre-flight record/);
    assert.throws(() => checkPreflightRecord({ path: write(base()), mode: 'practice' }), /only.*counted/);
  } finally { removeScratch(dir); }
});

test('the pre-flight record scrub agrees with the runners scrub on the scan roots (r5-B1 round-trip)', () => {
  // The pre-flight record's scanned roots (scrubbed by runner-guard scrubTempPath) are stamped into each run record
  // and then re-scrubbed when the run record is written (run_reviewer scrubPaths, run_gates.py scrub). If the two
  // scrubs disagreed, the run's stamped roots would not equal the record's roots and scoring would refuse. So
  // scrubTempPath's output on the default scan roots must be a FIXED POINT of scrubPaths (a stronger scrubber).
  const roots = defaultScanRoots().scannable.map(scrubTempPath);
  assert.deepEqual(roots.map(scrubPaths), roots, 'scrubTempPath output is not a fixed point of run_reviewer scrubPaths');
  // And scrubTempPath is idempotent on its own output.
  assert.deepEqual(roots.map(scrubTempPath), roots, 'scrubTempPath is not idempotent on the scan roots');
  // No scrubbed root carries an operator id (no home path or per-user var/folders bucket).
  for (const r of roots) assert.doesNotMatch(r, /\/Users\/|\/(?:private\/)?var\/folders\/[^/]+\//, `${r} leaks an operator path`);
});

test('scoring binds a counted run to what it recorded, not the scorer environment (refute r5-B1)', () => {
  // checkPreflightForScoring re-checks the committed record against the RUN's stamps, with no live git HEAD, temp
  // root or on-disk path. So a committed run scores after more commits, in a fresh checkout and under any TMPDIR;
  // only a mismatch between the record and what the run stamped, or a tampered record, refuses.
  const runCode = runnerCodeShas();
  const runnersSha = sha256(renderRunnerPins(runCode));
  const selfSha = rec => sha256(JSON.stringify({ ...rec, sha256: null }));
  const roots = ['<tmp>', '/private/tmp', '/private/var/tmp']; // arbitrary; deliberately NOT the scorer's live roots
  const HEAD = 'b'.repeat(40); // deliberately NOT the scorer's live git HEAD
  const endedAt = new Date(Date.now() - 60e3).toISOString();
  const firstCallStartedAt = new Date(Date.now() - 59e3).toISOString();
  const mkRecord = (over = {}) => {
    const r = { kind: 'answer-key-preflight', mode: 'counted', ok: true, scanned: roots, skipped: [], copies: [], vanished: 0, permissionSkipped: 0, durationMs: 1, override: null, startedAt: endedAt, endedAt, runnersSha256: runnersSha, head: HEAD, sha256: null, ...over };
    r.sha256 = selfSha(r);
    return r;
  };
  const mkRun = record => ({ gate: 'reviewer', code: runCode, head: record.head, pins: { preflightRoots: record.scanned, preflight: { sha256: record.sha256, endedAt: record.endedAt } } });

  // The happy path scores, though HEAD and roots are NOT the scorer's live ones and no record file is on disk: it
  // depends only on the run's own stamps (this is what lets a committed run re-score anywhere).
  const good = mkRecord();
  assert.doesNotThrow(() => checkPreflightForScoring({ record: good, run: mkRun(good), firstCallStartedAt }));

  // A record that is the wrong shape, not ok, forged clean, or stale refuses.
  const refusesRecord = (over, re) => { const rec = mkRecord(over); assert.throws(() => checkPreflightForScoring({ record: rec, run: mkRun(rec), firstCallStartedAt }), re); };
  refusesRecord({ kind: 'x' }, /answer-key-preflight/);
  refusesRecord({ mode: 'practice' }, /not a counted run/);
  refusesRecord({ ok: false }, /not ok/);
  refusesRecord({ override: '/x' }, /override/);
  refusesRecord({ copies: [{ path: '<tmp>/x', copyOf: 'y' }] }, /answer-key copies/);
  refusesRecord({ runnersSha256: '0'.repeat(64) }, /own code pins/);
  refusesRecord({ startedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), endedAt: new Date(Date.now() - 3 * 3600e3).toISOString() }, /within 2 h/);
  refusesRecord({ startedAt: '2026-09-28T18:36:48Z', endedAt: '2026-09-28T18:36:48Z' }, /not-before|within 2 h/);

  // A record altered after it was self-hashed refuses.
  const altered = mkRecord(); altered.vanished = 999; // not re-hashed
  assert.throws(() => checkPreflightForScoring({ record: altered, run: mkRun(altered), firstCallStartedAt }), /altered/);

  // The run and the committed record must agree: a run stamped to a different sha, head or roots refuses, as does no record.
  const rec = mkRecord();
  const run = mkRun(rec);
  assert.throws(() => checkPreflightForScoring({ record: rec, run: { ...run, pins: { ...run.pins, preflight: { sha256: '0'.repeat(64), endedAt } } }, firstCallStartedAt }), /did not commit/);
  assert.throws(() => checkPreflightForScoring({ record: rec, run: { ...run, head: 'c'.repeat(40) }, firstCallStartedAt }), /head differs/);
  assert.throws(() => checkPreflightForScoring({ record: rec, run: { ...run, pins: { ...run.pins, preflightRoots: [...roots, '/extra'] } }, firstCallStartedAt }), /roots differ/);
  assert.throws(() => checkPreflightForScoring({ record: undefined, run, firstCallStartedAt }), /no committed pre-flight record/);
});

test('the tasks prune is scoped to Claude tool-output dirs, not every dir named tasks (refute r3 N-r3-2)', () => {
  const dir = scratchDir('taskscope');
  try {
    const claudeTasks = join(dir, 'claude-99', 'proj', 'sess', 'tasks');
    const repoTasks = join(dir, 'proj', 'tasks');
    mkdirSync(claudeTasks, { recursive: true });
    mkdirSync(repoTasks, { recursive: true });
    cpSync('experiments/jev-gate/labels.json', join(claudeTasks, 'labels.json'));
    cpSync('experiments/jev-gate/labels.json', join(repoTasks, 'labels.json'));
    // The Claude tool-output tasks dir (<claude-temp>/<project>/<session>/tasks) is pruned; a repo's tasks/ is scanned.
    assert.deepEqual(answerKeyCopies({ roots: [dir] }).copies, [{ path: join(repoTasks, 'labels.json'), copyOf: 'experiments/jev-gate/labels.json' }]);
  } finally { removeScratch(dir); }
});

test('the answer-key pre-flight finds a copy and a practice run refuses; the override is recorded and refused when counted (refute r4/B2)', () => {
  const dir = scratchDir('preflight');
  const saved = process.env.JEV_GATE_PREFLIGHT_ROOTS;
  try {
    // A clean root has no copies; a byte-for-byte copy of an answer file is found and named; a different size is not.
    assert.deepEqual(answerKeyCopies({ roots: [dir] }).copies, []);
    cpSync('experiments/jev-gate/labels.json', join(dir, 'labels.json'));
    assert.deepEqual(answerKeyCopies({ roots: [dir] }).copies, [{ path: join(dir, 'labels.json'), copyOf: 'experiments/jev-gate/labels.json' }]);
    writeFileSync(join(dir, 'other.json'), 'x'.repeat(500));
    assert.equal(answerKeyCopies({ roots: [dir] }).copies.length, 1);
    // Through the pre-flight, a practice override scans that dir, records it, and reports the copy (the runner refuses).
    process.env.JEV_GATE_PREFLIGHT_ROOTS = dir;
    const withCopy = answerKeyPreflight({ mode: 'practice' });
    assert.equal(withCopy.ok, false);
    assert.deepEqual(withCopy.scanned, [dir]);
    assert.equal(withCopy.override, dir);
    assert.equal(withCopy.copies.length, 1);
    // The override is refused outright in a counted run: a counted run scans the real temp roots.
    assert.throws(() => answerKeyPreflight({ mode: 'counted' }), /refused in a counted run/);
    // A clean dir passes; a practice override that names a missing dir refuses.
    rmSync(join(dir, 'labels.json'));
    assert.equal(answerKeyPreflight({ mode: 'practice' }).ok, true);
    process.env.JEV_GATE_PREFLIGHT_ROOTS = join(dir, 'does-not-exist');
    assert.throws(() => answerKeyPreflight({ mode: 'practice' }), /do not exist/);
  } finally {
    if (saved === undefined) delete process.env.JEV_GATE_PREFLIGHT_ROOTS; else process.env.JEV_GATE_PREFLIGHT_ROOTS = saved;
    removeScratch(dir);
  }
});
