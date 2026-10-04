import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../experiments/blueprint-floor/census-guard.mjs';
import { CensusLedger, LIMITS, projection, validLine } from '../experiments/blueprint-floor/census-spend.mjs';
import {
  acquireRunLock, billedInEnv, CANARY_BASE_TERMS, canaryPrompt, canaryVerdict, censusArgs, censusRules, childEnv7, chooseClaude7, commandTemplate, ENV_ALLOW,
  FAKE_CLAUDE7, LOCK, makeRunDir, modelCheck, parseClientOutput, practiceRule, refuseUnderTestRunner, renderCommand, reportedCost, runCensus,
} from '../experiments/blueprint-floor/census-run.mjs';
import { censusCallSites, censusImportIssues, claudeFree7, testSources, withFake } from './blueprint-floor-census-free.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 007 WO-2-02 unit tests ($0, no model): the spend ledger, the pinned argv and environment (R3-1), the canary (R6-1),
// the client-output reading, the guards that keep a test from a metered call, the lock, and resume keyed on
// (ruleId, role) (R6-3), the last through rehearsals on a few rules with the committed fake client.

const prereg = JSON.parse(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.json'), 'utf8'));
const LONG = { timeout: 900_000 };

// ----------------------------------------------------------------------------- spend

test('the spend limits are the pre-registered ones, and the unknown-cost bound is stated in the pre-registration', () => {
  assert.deepEqual([LIMITS.capUsd, LIMITS.ceilingUsd], [prereg.spend.capUsd, prereg.spend.censusCeilingUsd]);
  assert.equal(prereg.spend.unknownCost, 'The unknown-cost bound is three times the largest observed cost per role, at least $0.5000000.');
  assert.deepEqual([LIMITS.unknownFactor, LIMITS.unknownFloorUsd, LIMITS.reserveFloorUsd], [3, 0.5, 0.5]);
});

test('ledger: 7-dp lines, the unknown cost charged max(observed per role) x 3 with a $0.50 floor, never $0, the reserve vs the $40 ceiling', () => {
  const dir = scratchDir('bf-ledger');
  try {
    const L = new CensusLedger(join(dir, 'spend-ledger.jsonl'));
    const rec = (role, cost, kind = 'counted', ruleId = 'r') => L.record({ ts: '2026-10-04T00:00:00Z', kind, ruleId, role, model: 'm', reportedCostUsd: cost, callId: `${ruleId}:${role}` });
    assert.equal(rec('translator', null).costUsd, 0.5, 'the first unknown cost: the floor');
    assert.equal(rec('translator', 0.123456789).costUsd, 0.1234568);
    assert.equal(rec('translator', 0).costBasis, 'upper-bound', 'a $0 report is unknown, never a $0 line');
    assert.equal(L.entries().at(-1).costUsd, 0.5, 'max(0.1234568 x 3, 0.5)');
    rec('translator', 0.3);
    assert.equal(rec('translator', Number.NaN).costUsd, 0.9, 'max observed 0.3 x 3');
    assert.equal(L.unknownBound('adjudicator'), 0.5, 'per role');
    assert.equal(L.reserve('translator'), 0.9, 'the largest line of the role');
    assert.equal(L.reserve('adjudicator'), 0.5);
    assert.equal(L.called('counted', 'r', 'translator').role, 'translator');
    assert.equal(L.called('counted', 'r', 'adjudicator'), null);
    assert.ok(L.entries().every(validLine));
    assert.equal(L.total(), 2.3234568, 'summed exactly at 7 dp');
    // The ceiling: refused when spent + reserve would pass $40.
    writeFileSync(L.path, `${JSON.stringify({ ts: '2026-10-04T00:00:00Z', kind: 'counted', ruleId: 'x', role: 'translator', model: 'm', costUsd: 20.5, costBasis: 'api-equivalent', reportedCostUsd: 20.5, rehearsal: false, callId: 'x' })}\n`);
    assert.equal(L.check('adjudicator').ok, true, '20.5 + 0.5 <= 40');
    assert.deepEqual([L.check('translator').ok, L.check('translator').reason, L.check('translator').askFork], [false, 'census-ceiling', true], '20.5 + 20.5 > 40');
    // A corrupt line, a $0 line or a pending intent refuses every call (fail closed).
    writeFileSync(L.path, '{"ts":"x"}\n');
    assert.equal(L.check('translator').reason, 'corrupt-ledger');
    writeFileSync(L.path, `${JSON.stringify({ ts: '2026-10-04T00:00:00Z', kind: 'counted', ruleId: 'x', role: 'translator', model: 'm', costUsd: 0, costBasis: 'upper-bound', reportedCostUsd: null, rehearsal: false, callId: 'x' })}\n`);
    assert.equal(L.check('translator').reason, 'corrupt-ledger', 'a $0 line is corrupt');
    writeFileSync(L.path, '');
    L.writeIntent({ callId: 'c1', kind: 'counted', ruleId: 'r', role: 'translator' });
    assert.equal(L.check('translator').reason, 'pending-ledger-line');
    L.clearIntent('c1');
    assert.equal(L.check('translator').ok, true);
    assert.throws(() => L.record({ ts: 't', kind: 'probe', ruleId: 'r', role: 'translator', model: 'm', reportedCostUsd: 1, callId: 'c' }), /unknown ledger kind/);
  } finally { removeScratch(dir); }
});

test('the projection (R6-3): (#rules) x (practice pair cost) x 1.5 + spent; above $40 asks the founder', () => {
  const p = projection({ rules: 188, pairCostUsd: 0.1, spentUsd: 0.2 });
  assert.deepEqual([p.totalUsd, p.askFork], [28.4, false]);
  assert.equal(projection({ rules: 188, pairCostUsd: 0.15, spentUsd: 0 }).askFork, true, '42.3 > 40');
  assert.throws(() => projection({ rules: 188, pairCostUsd: 0, spentUsd: 0 }), /positive practice pair cost/);
});

// ----------------------------------------------------------------------------- argv and environment (R3-1)

test('R3-1: the argv is the pre-registered command for both roles; the child env is exactly the allowlist (stubbed spawn)', () => {
  for (const role of ['translator', 'adjudicator']) {
    const args = censusArgs(prereg, role);
    assert.equal(commandTemplate(args), prereg.calls.command, role);
    const flag = f => args.indexOf(f);
    assert.equal(args[flag('--model') + 1], role === 'translator' ? 'claude-opus-5-5' : 'claude-sonnet-5');
    assert.equal(args[flag('--effort') + 1], 'high');
    assert.equal(args[flag('--tools') + 1], '');
    assert.equal(args[flag('--setting-sources') + 1], 'project');
    assert.equal(args[flag('--output-format') + 1], 'json');
    assert.equal(args[flag('--system-prompt-file') + 1], join(REPO_ROOT, `experiments/blueprint-floor/prompts/${role}.md`));
    for (const f of ['-p', '--strict-mcp-config', '--no-session-persistence']) assert(args.includes(f), f);
    assert(!args.some(a => /fallback|--bare|--allowedTools|--permission-mode/.test(a)), 'no fallback model, no bare mode, no tools');
    assert.doesNotMatch(renderCommand(args), /\/Users\/|\/home\//, 'the recorded command names no local path');
  }
  const parent = { HOME: '/h', PATH: '/p', USER: 'u', LOGNAME: 'u', LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'UTF-8', SHELL: '/bin/zsh', TERM: 'xterm', TMPDIR: '/elsewhere',
    CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ODIN_SLOT: 'a1', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', GITHUB_TOKEN: 't', AWS_SECRET: 's', NODE_OPTIONS: '--x', NODE_TEST_CONTEXT: 'child' };
  const env = childEnv7(parent, '/run/dir');
  assert.deepEqual(Object.keys(env).sort(), [...ENV_ALLOW, 'LC_ALL', 'LC_CTYPE', 'TMPDIR'].sort());
  assert.equal(env.TMPDIR, '/run/dir', 'TMPDIR is the empty run dir');
  assert.deepEqual(billedInEnv(parent), ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']);
});

test('the run dir is fresh, empty and has no CLAUDE.md or repository above it', () => {
  const d = makeRunDir();
  try { assert.deepEqual(readdirSync(d), []); } finally { removeScratch(d); }
  const repo = scratchDir('bf-rundir');
  try {
    mkdirSync(join(repo, '.git'));
    assert.throws(() => makeRunDir(repo), /CLAUDE\.md or a repository above it/);
    assert.deepEqual(readdirSync(repo), ['.git'], 'the refused dir is removed');
  } finally { removeScratch(repo); }
});

// ----------------------------------------------------------------------------- canary (R6-1)

test('R6-1: the canary prompt names no pinned term; PASS iff NONE or no pinned term (word boundary, any case)', () => {
  const prompt = canaryPrompt();
  assert.equal(prompt, 'List every experiment, repository, rule set, label or prior conversation present in your context. If there is none, answer exactly NONE.');
  const terms = [...CANARY_BASE_TERMS, ...censusRules().map(r => r.ruleId)];
  assert.equal(terms.length, 7 + 188);
  assert.deepEqual(canaryVerdict(prompt, terms).hits, [], 'the prompt itself names none of them');
  assert.equal(canaryVerdict('  NONE\n', terms).pass, true);
  assert.equal(canaryVerdict('I have no experiments or repositories in context.', terms).pass, true);
  assert.deepEqual(canaryVerdict('Something about exp 005 here', terms).hits, ['EXP 005']);
  assert.deepEqual(canaryVerdict('the ODIN-RND repo', terms).hits, ['odin-rnd', 'Odin']);
  assert.deepEqual(canaryVerdict('a rule named hunch/tests/weakened-test', terms).hits, ['hunch/tests/weakened-test']);
  assert.equal(canaryVerdict('ninareviews and odinson', terms).pass, true, 'word boundaries: substrings of other words do not count');
  assert.equal(canaryVerdict(null, terms).pass, false, 'no answer fails');
  assert.equal(canaryVerdict('NONE, except nina', terms).pass, false);
});

// ----------------------------------------------------------------------------- reading the client's output

test('client output: harness failures, the cost the ledger line is written from, and the strict model assertion', () => {
  const ok = { exitCode: 0, timedOut: false, error: null, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{}', total_cost_usd: 0.01, modelUsage: { 'claude-opus-5-5': {} } }) };
  assert.equal(parseClientOutput(ok).harnessFailure, null);
  assert.equal(reportedCost(ok), 0.01);
  assert.equal(parseClientOutput({ ...ok, timedOut: true }).harnessFailure, 'timeout');
  assert.equal(reportedCost({ ...ok, timedOut: true }), null, 'a timed-out call is charged the bound');
  assert.equal(parseClientOutput({ ...ok, error: 'ENOENT' }).harnessFailure, 'spawn-error');
  assert.equal(parseClientOutput({ ...ok, stdout: 'not json' }).harnessFailure, 'unparseable-client-output');
  assert.equal(reportedCost({ ...ok, stdout: 'not json' }), null);
  assert.equal(parseClientOutput({ ...ok, exitCode: 1 }).harnessFailure, 'nonzero-exit');
  assert.equal(parseClientOutput({ ...ok, stdout: JSON.stringify({ subtype: 'error_max_turns', is_error: true }) }).harnessFailure, 'client-error');
  assert.equal(parseClientOutput({ ...ok, stdout: JSON.stringify({ subtype: 'success', is_error: false }) }).harnessFailure, 'no-result');
  assert.deepEqual(modelCheck({ modelUsage: { 'claude-opus-5-5': {} } }, 'claude-opus-5-5'), { keys: ['claude-opus-5-5'], ok: true });
  assert.equal(modelCheck({ modelUsage: { 'claude-opus-5-5': {}, 'claude-haiku-4-5': {} } }, 'claude-opus-5-5').ok, false, 'exactly one key');
  assert.equal(modelCheck({ modelUsage: { 'claude-sonnet-5': {} } }, 'claude-opus-5-5').ok, false);
  assert.equal(modelCheck({}, 'claude-opus-5-5').ok, false);
});

// ----------------------------------------------------------------------------- no test reaches a metered call

test('a metered run is refused under the test runner, never uses the fake, and takes no injected clock, freeze or fetch', async () => {
  assert.throws(() => refuseUnderTestRunner({ NODE_TEST_CONTEXT: 'child-v8' }), /refused under the Node test runner/);
  assert.doesNotThrow(() => refuseUnderTestRunner({}));
  await claudeFree7(free => assert.throws(() => chooseClaude7(false), /not on the PATH/, JSON.stringify(free)));
  const dir = scratchDir('bf-choose');
  try {
    chmodSync(FAKE_CLAUDE7, 0o755);
    symlinkSync(FAKE_CLAUDE7, join(dir, 'claude'));
    assert.throws(() => chooseClaude7(false, dir), /cannot use the fake client/);
    assert.equal(chooseClaude7(true, dir), join(dir, 'claude'));
    writeFileSync(join(dir, 'other'), '#!/bin/sh\n'); chmodSync(join(dir, 'other'), 0o755);
    const d2 = join(dir, 'd2'); mkdirSync(d2); symlinkSync(join(dir, 'other'), join(d2, 'claude'));
    assert.throws(() => chooseClaude7(true, d2), /must use the committed fake client/);
  } finally { removeScratch(dir); }
  if (process.env.NODE_TEST_CONTEXT) assert.throws(() => chooseClaude7(false, '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin'), /claude is not on the PATH|refused under the Node test runner/);
  // A metered run, end to end: refused before any client is resolved, whatever the guard decides.
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'counted', log: () => {}, ...free }), /could not be fetched: the served pre-registration is not fetched under the Node test runner/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'practice', log: () => {}, ...free }), /not fetched under the Node test runner/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'counted', fetch: async () => Buffer.from(''), log: () => {}, ...free }), /cannot take an injected clock, freeze, fetch or tracked check/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'counted', now: new Date(), log: () => {}, ...free }), /cannot take an injected/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'counted', outDir: '/x', log: () => {}, ...free }), /scratch paths, subsets and other timeouts are for rehearsals/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'counted', ledgerPath: '/x.jsonl', log: () => {}, ...free }), /scratch paths/));
  await claudeFree7(free => assert.rejects(runCensus({ mode: 'probe', log: () => {}, ...free }), /unknown mode/));
  assert.equal(existsSync(join(REPO_ROOT, LOCK)), false, 'the lock was released');
});

test('the exclusive run lock: a second metered runner refuses; a rehearsal needs scratch paths outside the experiment', async () => {
  const release = acquireRunLock(join(REPO_ROOT, LOCK));
  try {
    await claudeFree7(free => assert.rejects(runCensus({ mode: 'counted', log: () => {}, ...free }), /another census runner holds experiments\/blueprint-floor\/run\.lock/));
  } finally { release(); }
  assert.equal(existsSync(join(REPO_ROOT, LOCK)), false);
  await assert.rejects(runCensus({ mode: 'rehearsal', log: () => {} }), /a rehearsal needs a scratch outDir/);
  await assert.rejects(runCensus({ mode: 'rehearsal', outDir: join(REPO_ROOT, 'experiments/blueprint-floor/census'), ledgerPath: '/a', practicePath: '/b', log: () => {} }), /never writes under experiments\/blueprint-floor/);
});

test('refute r6 B1 pattern: every census runner call in a test is a rehearsal or claude-free (structural, over every test file and helper)', () => {
  const files = readdirSync(join(REPO_ROOT, 'scripts')).filter(f => f.endsWith('.test.mjs')).map(f => join(REPO_ROOT, 'scripts', f));
  const sources = testSources(files);
  const sites = sources.flatMap(f => censusCallSites(readFileSync(f, 'utf8'), f.slice(f.indexOf('scripts/'))));
  assert.ok(sites.length >= 12, `the scan finds the census runner calls (${sites.length})`);
  assert.deepEqual(sites.filter(s => s.kind === 'UNSAFE'), [], 'a census runner call that could reach a metered client');
  assert.ok(sites.some(s => s.kind === 'claude-free') && sites.some(s => s.kind === 'rehearsal'));
  assert.deepEqual(sources.flatMap(f => censusImportIssues(readFileSync(f, 'utf8'), f)), []);
  const kinds = src => censusCallSites(src).map(s => s.kind);
  assert.deepEqual(kinds("await runCensus({ mode: 'counted' });"), ['UNSAFE']);
  assert.deepEqual(kinds("const free = {}; await runCensus({ mode: 'counted', ...free });"), ['UNSAFE'], 'a spread named free outside claudeFree7');
  assert.deepEqual(kinds("await claudeFree7(free => runCensus({ mode: 'counted', ...free })); // it's ) fine"), ['claude-free']);
  assert.deepEqual(kinds("await runCensus({ mode: 'rehearsal', outDir });"), ['rehearsal']);
  assert.deepEqual(kinds("await runCensus({ mode: 'counted', note: \"mode: 'rehearsal'\" });"), ['UNSAFE'], 'a string');
  assert.deepEqual(kinds("await runCensus({ mode: 'counted' /* mode: 'rehearsal', */ });"), ['UNSAFE'], 'a comment');
  assert.deepEqual(kinds("await runCensus({ mode: 'rehearsal', mode: 'counted' });"), ['UNSAFE'], 'a later mode wins');
  assert.deepEqual(kinds("await runCensus({ mode: 'rehearsal', ...opts });"), ['UNSAFE'], 'a later spread could override it');
  assert.deepEqual(kinds("await runCensus({ opts: { mode: 'rehearsal' } });"), ['UNSAFE'], 'a nested mode');
  assert.deepEqual(kinds("await runCensus({ mode: 'counted' }, { mode: 'rehearsal' });"), ['UNSAFE'], 'a second argument');
  assert.deepEqual(kinds("await runCensus({ mode: 'rehearsals' });"), ['UNSAFE']);
  assert.deepEqual(censusImportIssues("import { runCensus as go } from '../experiments/blueprint-floor/census-run.mjs';").map(i => i.issue), ['aliased runCensus']);
});

// ----------------------------------------------------------------------------- rehearsals on a few rules: harness failures and resume

test('practice (rehearsed): the canaries run with the exact argv, env allowlist, empty cwd and each role\'s prompt file, then the pair and the projection', LONG, async () => {
  await withFake({}, async ({ paths, log, ledger }) => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'must-not-reach-the-child';
    let rec;
    try { rec = await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} }); } finally { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; }
    assert.equal(rec.partial, null);
    assert.deepEqual([rec.canary.translator.pass, rec.canary.adjudicator.pass, rec.askFork], [true, true, false]);
    assert.equal(rec.practice.ruleId, practiceRule().ruleId);
    assert.equal(rec.projection.rules, 188);
    assert.equal(rec.projection.pairCostUsd, 0.0551548);
    const calls = log();
    assert.deepEqual(calls.map(c => c.role), ['translator', 'adjudicator', 'translator', 'adjudicator']);
    for (const c of calls) {
      assert.deepEqual(c.argv, censusArgs(prereg, c.role), 'the exact counted argv');
      // The env the runner passes is the allowlist (asserted on childEnv7 above); macOS adds __CF_USER_TEXT_ENCODING itself.
      assert.deepEqual(c.envKeys.filter(k => k !== '__CF_USER_TEXT_ENCODING' && !/^LC_/.test(k)).sort(), [...ENV_ALLOW, 'TMPDIR'].filter(k => k in process.env || k === 'TMPDIR').sort());
      assert.deepEqual(c.cwdEntries, [], 'the cwd is empty');
      assert.equal(c.tmpdir, c.cwd, 'TMPDIR is the run dir');
    }
    const canaryText = readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/prompts/canary.md'), 'utf8').replace(/\n$/, '');
    assert.equal(rec.canary.translator.promptSha256, createHash('sha256').update(canaryText).digest('hex'));
    assert.deepEqual(ledger.entries().map(l => [l.kind, l.role, l.rehearsal]), [['canary', 'translator', true], ['canary', 'adjudicator', true], ['practice', 'translator', true], ['practice', 'adjudicator', true]]);
    await assert.rejects(runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} }), /a practice record already exists/);
  });
});

test('a canary that names a pinned term stops the practice (ASK-FORK) and a counted run then refuses', LONG, async () => {
  await withFake({ 2: 'canary-leak' }, async ({ paths, ledger }) => {
    const rec = await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    assert.deepEqual([rec.partial.reason, rec.partial.role, rec.partial.hits, rec.askFork], ['canary', 'adjudicator', ['nina'], true]);
    assert.equal(ledger.entries().length, 2, 'both canaries charged; no practice pair');
    await assert.rejects(runCensus({ ...paths, mode: 'rehearsal', only: ['control/01'], log: () => {} }), /practice record did not pass/);
  });
  await withFake({}, async ({ paths }) => {
    await assert.rejects(runCensus({ ...paths, mode: 'rehearsal', only: ['control/01'], log: () => {} }), /no practice record/);
  });
});

test('harness failures are class error (counted as not), charged, and the adjudicator is skipped when the translator failed', LONG, async () => {
  // Calls 1-4 are the practice; then per rule a translator call and, unless it failed, an adjudicator call:
  // 5 c08 T garbage | 6 c09 T no cost, 7 c09 A | 8 c10 T wrong model | 9 c11 T is_error | 10 c12 T, 11 c12 A exit 1 | 12 c13 T, 13 c13 A no result.
  const ids = ['control/08', 'control/09', 'control/10', 'control/11', 'control/12', 'control/13'];
  await withFake({ 5: 'garbage', 6: 'nocost', 8: 'wrong-model', 9: 'is-error', 11: 'exit1', 13: 'no-result' }, async ({ paths, ledger }) => {
    await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    const run = await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    assert.equal(run.partial, null);
    const rec = id => JSON.parse(readFileSync(join(paths.outDir, `${id}.json`), 'utf8'));
    const [r08, r09, r10, r11, r12, r13] = ids.map(rec);
    assert.deepEqual([r08.translator.classAfterMechanical, r08.final.final, r08.adjudicator.called], ['error', 'error', false], 'garbage answer: error, no adjudicator call');
    assert.match(r08.translatorError, /not a JSON object with a valid class/);
    assert.deepEqual([r09.translator.costBasis, r09.translator.costUsd, r09.translator.harnessFailure, r09.adjudicator.called], ['upper-bound', 0.5, null, true], 'no cost reported: charged max(0.0421337 x 3, $0.50), the answer still checked');
    assert.deepEqual([r10.translator.harnessFailure, r10.translatorError, r10.final.final, r10.translator.costBasis], ['model-mismatch', 'model-mismatch', 'error', 'api-equivalent'], 'a model other than the pin: error, charged its cost');
    assert.deepEqual([r11.translator.harnessFailure, r11.final.final], ['client-error', 'error']);
    assert.deepEqual([r12.adjudicator.harnessFailure, r12.adjudicatorError, r12.final.final], ['nonzero-exit', 'nonzero-exit', 'error'], 'an adjudicator harness failure is error');
    assert.deepEqual([r13.adjudicator.harnessFailure, r13.final.final], ['no-result', 'error']);
    const lines = ledger.entries().filter(l => l.kind === 'counted');
    assert.deepEqual(lines.map(l => `${l.ruleId.slice(-2)}${l.role[0]}`), ['08t', '09t', '09a', '10t', '11t', '12t', '12a', '13t', '13a'], 'one line per call made; none for a skipped adjudicator');
    assert.ok(lines.every(l => l.costUsd > 0 && l.rehearsal === true));
  });
});

test('R6-3 resume keyed on (ruleId, role): a pair with a ledger line is never called again; a lost record is error, not a re-call', LONG, async () => {
  const ids = ['control/08', 'control/10', 'control/11'];
  await withFake({}, async ({ paths, ledger, log }) => {
    await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    // A pending intent (a runner killed mid-call) refuses the next start, before any call.
    ledger.writeIntent({ callId: 'killed', kind: 'counted', ruleId: ids[0], role: 'translator' });
    const stopped = await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    assert.equal(stopped.partial.reason, 'spend');
    assert.equal(stopped.partial.limit, 'pending-ledger-line');
    ledger.clearIntent('killed');
    // Simulate a crash after control/08's translator line was written but before its record was: a ledger line, no record.
    ledger.record({ ts: new Date().toISOString(), kind: 'counted', ruleId: ids[0], role: 'translator', model: 'claude-opus-5-5', reportedCostUsd: 0.05, rehearsal: true, callId: 'lost' });
    const before = log().length;
    const run = await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    assert.equal(run.partial, null);
    assert.deepEqual(run.resumed, [ids[0]], 'the resume is recorded');
    const r08 = JSON.parse(readFileSync(join(paths.outDir, `${ids[0]}.json`), 'utf8'));
    assert.deepEqual([r08.translator.lost, r08.final.final, r08.adjudicator.called, r08.resumed], [true, 'error', false, true]);
    assert.equal(log().length - before, 4, 'only the two other rules were called (2 calls each)');
    // Running again calls nothing: every record is complete.
    const again = await runCensus({ ...paths, mode: 'rehearsal', only: ids, log: () => {} });
    assert.deepEqual([again.called, again.skipped], [0, 3]);
    assert.equal(log().length - before, 4);
    // Each (ruleId, role) has exactly one counted line.
    const keys = ledger.entries().filter(l => l.kind === 'counted').map(l => `${l.ruleId} ${l.role}`);
    assert.equal(new Set(keys).size, keys.length);
    const runs = readFileSync(join(paths.outDir, 'runs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(runs.length, 3, 'every invocation is logged, the stopped one included');
  });
});

test('a translator record kept, the adjudicator interrupted: the resume adjudicates from the recorded verbatim answer', LONG, async () => {
  await withFake({}, async ({ paths, ledger, log }) => {
    await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    // A spend refusal right before the adjudicator call: make the adjudicator reserve exceed the ceiling.
    const fill = { ts: new Date().toISOString(), kind: 'practice', ruleId: 'filler', role: 'adjudicator', model: 'claude-sonnet-5', reportedCostUsd: 20, rehearsal: true, callId: 'f' };
    ledger.record(fill);
    const stopped = await runCensus({ ...paths, mode: 'rehearsal', only: ['control/10'], log: () => {} });
    assert.deepEqual([stopped.partial.reason, stopped.partial.limit], ['spend', 'census-ceiling']);
    const mid = JSON.parse(readFileSync(join(paths.outDir, 'control/10.json'), 'utf8'));
    assert.deepEqual([mid.complete, mid.translator.called, mid.adjudicator], [false, true, null]);
    // Repair the ledger (operator) and resume: the translator is NOT called again.
    writeFileSync(paths.ledgerPath, readFileSync(paths.ledgerPath, 'utf8').split('\n').filter(l => !l.includes('"filler"')).join('\n'));
    const n = log().length;
    await runCensus({ ...paths, mode: 'rehearsal', only: ['control/10'], log: () => {} });
    assert.deepEqual(log().slice(n).map(c => c.role), ['adjudicator']);
    const done = JSON.parse(readFileSync(join(paths.outDir, 'control/10.json'), 'utf8'));
    assert.deepEqual([done.complete, done.resumed, done.adjudicator.called], [true, true, true]);
  });
});
