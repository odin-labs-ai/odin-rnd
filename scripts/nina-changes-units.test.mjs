import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { percentile } from '../experiments/jev-gate/results.mjs';
import { FAKE_CLAUDE, renderCommand } from '../experiments/jev-gate/run_reviewer.mjs';
import { checkRecords, readRunnerPins } from '../experiments/jev-gate/runner-guard.mjs';
import { WS_REPO } from '../experiments/nina-changes/fence6.mjs';
import { NOT_BEFORE6, PREREG6_SHA256 } from '../experiments/nina-changes/freeze.mjs';
import { checkRun6, readPins6, renderPins6, RUNNER6_FILES, runner6CodeShas } from '../experiments/nina-changes/guard6.mjs';
import { chooseClaude6, commandTemplate, FAKE_CLAUDE6, renderCommand6, reviewerArgs6, RUN_ROOT6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { leakFields, lint6, publicRecord6, scrubPaths6 } from '../experiments/nina-changes/scrub6.mjs';
import { countedProjection, isPreCounted, LIMITS6, PRERUN_KIND, round7, SpendLedger6 } from '../experiments/nina-changes/spend6.mjs';
import { runReviewer6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { classifyStreamRun, HARNESS_FAILURE_DEFINITION, keepsOutput, parseStream, recordToolCalls } from '../experiments/nina-changes/stream6.mjs';
import { runState } from '../experiments/nina-changes/results6.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

const { prereg, amendment } = checkRecords({ mode: 'practice' });
const line = e => JSON.stringify(e);
const init = { type: 'system', subtype: 'init', claude_code_version: '2.1.280', model: 'claude-opus-5-5', permissionMode: 'dontAsk' };
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const res = (id, content, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const final = (over = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: 'ok\nVERDICT: APPROVED', total_cost_usd: 0.25, num_turns: 3, permission_denials: [], ...over });
const stream = events => `${events.map(line).join('\n')}\n`;

// ------------------------------------------------------------------ the stream

test('the harness-failure definition is EXP 005 amendment 01\'s, translated only for stream-json (R4-2)', () => {
  const source = amendment.changes.spotlight.criteria.find(c => c.id === 'zero-patches').harnessFailure;
  assert.ok(source.includes('missing or unparseable JSON'));
  assert.equal(HARNESS_FAILURE_DEFINITION, source.replace('missing or unparseable JSON', 'no parseable final `type:"result"` line, or an unparseable NDJSON line'));
});

test('parseStream pairs tool_use with tool_result, text blocks or a string, and finds the final result', () => {
  const p = parseStream(stream([init, use('a', 'Bash', { command: 'git diff' }), res('a', [{ type: 'text', text: '+x' }]), use('b', 'Read', { file_path: 'rules.txt' }), res('b', '     1→rule', false), use('c', 'Bash', { command: 'cat ../x' }), res('c', 'denied', true), final()]));
  assert.equal(p.init.claude_code_version, '2.1.280');
  assert.deepEqual(p.toolCalls.map(c => [c.tool, c.isError, c.output]), [['Bash', false, '+x'], ['Read', false, '     1→rule'], ['Bash', true, 'denied']]);
  assert.equal(p.finalResult.total_cost_usd, 0.25);
  assert.deepEqual(parseStream(stream([init, use('a', 'Bash', { command: 'x' })])).toolCalls[0].output, null, 'a tool_use with no result keeps output null');
});

test('classifyStreamRun: timeout, exit, malformed line, no final result line, is_error, empty result; abstention is not a failure', () => {
  const ok = { timedOut: false, exitCode: 0 };
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init, final()]) }).harnessFailure, null);
  assert.equal(classifyStreamRun({ timedOut: true, exitCode: null, stdout: stream([init, final()]) }).harnessFailure, 'timeout');
  assert.equal(classifyStreamRun({ timedOut: false, exitCode: 1, stdout: stream([init, final()]) }).harnessFailure, 'exit-1');
  assert.equal(classifyStreamRun({ ...ok, stdout: `${line(init)}\nnot json {\n${line(final())}\n` }).harnessFailure, 'unparseable-ndjson-line');
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init]) }).harnessFailure, 'no-final-result-line');
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init, final(), use('a', 'Bash', {})]) }).harnessFailure, 'no-final-result-line', 'the result line must be the last');
  assert.equal(classifyStreamRun({ ...ok, stdout: '' }).harnessFailure, 'no-final-result-line');
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init, final({ is_error: true })]) }).harnessFailure, 'is-error');
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init, final({ result: '  ' })]) }).harnessFailure, 'empty-result');
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init, final({ result: 'no verdict here' })]) }).harnessFailure, null, 'a completed result with no verdict line is an abstention');
  assert.equal(classifyStreamRun({ ...ok, stdout: stream([init, final()]).replace(/\n/g, '\r\n') }).harnessFailure, null, 'CRLF line ends parse');
});

test('recorded tool calls keep outputs for git Bash and Read/Grep/Glob only; sha and length for every call', () => {
  const calls = [{ tool: 'Bash', input: { command: 'git diff' }, isError: false, output: 'd' }, { tool: 'Bash', input: { command: 'wc -l x' }, isError: false, output: '1 x' }, { tool: 'Read', input: { file_path: 'a' }, isError: false, output: 'r' }, { tool: 'WebFetch', input: {}, isError: true, output: null }];
  const rec = recordToolCalls(calls, c => c.output === 'd');
  assert.deepEqual(rec.map(c => 'output' in c), [true, false, true, false]);
  assert.deepEqual(rec.map(c => c.fingerprintHit), [true, false, false, false]);
  assert.equal(rec[1].outputBytes, 3);
  assert.equal(rec[3].outputSha256, null);
  assert.ok(keepsOutput({ tool: 'Bash', input: { command: 'git status && git diff' } }) && !keepsOutput({ tool: 'Bash', input: { command: 'digit' } }));
});

// ------------------------------------------------------------------ the spend guard

test('spend: 7 dp lines, unknown cost charged the upper bound (never $0), cap and pre-counted ceiling refuse in code', () => {
  const dir = scratchDir('nc-spend');
  try {
    const L = new SpendLedger6(join(dir, 'ledger.jsonl'));
    assert.equal(L.check('isolation-matrix').ok, true);
    const a = L.record({ ts: 't1', kind: 'isolation-matrix', id: 'm', run: 1, reportedCostUsd: 0.123456789 });
    assert.equal(a.costUsd, 0.1234568); assert.equal(a.costBasis, 'api-equivalent');
    const b = L.record({ ts: 't2', kind: 'practice', id: 'p01', run: 1, reportedCostUsd: null });
    assert.equal(b.costUsd, LIMITS6.unknownCostFloorUsd, 'unknown cost: max(largest so far, $0.60)'); assert.equal(b.costBasis, 'upper-bound');
    const c = L.record({ ts: 't3', kind: 'practice', id: 'p01', run: 2, reportedCostUsd: 0 });
    assert.equal(c.costBasis, 'upper-bound', 'a reported $0 is not a cost: charged the upper bound'); assert.ok(c.costUsd > 0);
    L.record({ ts: 't4', kind: 'practice', id: 'p01', run: 3, reportedCostUsd: 2.5 });
    const d = L.record({ ts: 't5', kind: 'practice', id: 'p02', run: 1, reportedCostUsd: undefined });
    assert.equal(d.costUsd, 2.5, 'the upper bound grows with the largest call');
    assert.equal(L.total(), round7(0.1234568 + 0.6 + 0.6 + 2.5 + 2.5));
    // Pre-counted ceiling: 6.3234568 spent + reserve 2.5 = 8.82 ≤ 10 → ok; after a $1.20 call, 7.52 + 2.5 = 10.02 > 10 → ASK-FORK.
    assert.equal(L.check('practice').ok, true);
    L.record({ ts: 't6', kind: 'practice', id: 'p02', run: 2, reportedCostUsd: 1.2 });
    const stop = L.check('practice');
    assert.deepEqual([stop.ok, stop.reason, stop.askFork], [false, 'pre-counted-ceiling', true]);
    assert.equal(L.check('counted').ok, true, 'the pre-counted ceiling does not bind a counted call');
    // The $60 cap: 7.5234568 + 50 counted → 57.52 + 2.5 > 60 → refused.
    L.record({ ts: 't7', kind: 'counted', id: 'c001', run: 1, reportedCostUsd: 50 });
    assert.deepEqual([L.check('counted').ok, L.check('counted').reason], [false, 'cap']);
    for (const l of readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)) {
      assert.ok(l.costUsd > 0, 'never a $0 line');
      assert.equal(l.costUsd, Number(l.costUsd.toFixed(7)), '7 dp');
    }
  } finally { removeScratch(dir); }
});

test('spend: the pre-bundle-3 projection uses results.mjs percentile and asks at more than $60', () => {
  const costs = [0.2, 0.21, 0.25, 0.3, 0.19, 0.22, 0.28, 0.26, 0.24];
  const p = countedProjection({ spentUsd: 9, dryRunCosts: costs, probeUsd: 0.6 });
  assert.equal(p.p90, round7(percentile(costs, 90)));
  assert.equal(p.total, round7(9 + 180 * percentile(costs, 90) + 0.6 + 0.6));
  assert.equal(p.askFork, p.total > 60);
  assert.equal(countedProjection({ spentUsd: 9, dryRunCosts: [0.3], probeUsd: 0.6 }).askFork, true);
  assert.throws(() => countedProjection({ spentUsd: 0, dryRunCosts: [], probeUsd: 0 }), /no dry-run cost/);
});

// ------------------------------------------------------------------ the guard and the pins

test('runners.sha256 pins every EXP 006 file and every jev-gate module EXP 006 imports, and matches the code', () => {
  assert.equal(renderPins6(runner6CodeShas()), readFileSync('experiments/nina-changes/runners.sha256', 'utf8'));
  for (const m of ['run_reviewer.mjs', 'runner-guard.mjs', 'results.mjs', 'metrics.mjs', 'lint.mjs', 'bce-contract.mjs']) assert.ok(RUNNER6_FILES.includes(`experiments/jev-gate/${m}`), m);
  assert.ok(RUNNER6_FILES.includes('experiments/nina-changes/freeze.mjs'), 'freeze.mjs is pinned here (and only here)');
  // Every jev-gate module an EXP 006 module imports is pinned (a static scan of the imports).
  const own = RUNNER6_FILES.filter(f => f.startsWith('experiments/nina-changes/') && f.endsWith('.mjs'));
  for (const f of own) for (const m of readFileSync(f, 'utf8').matchAll(/from '\.\.\/jev-gate\/([\w.-]+)'/g)) assert.ok(RUNNER6_FILES.includes(`experiments/jev-gate/${m[1]}`), `${f} imports ${m[1]}`);
  // The EXP 005 pins agree with the live jev-gate code EXP 006 pins (runner-guard.mjs included).
  const p5 = readRunnerPins(), p6 = readPins6();
  for (const rel of Object.keys(p5)) if (rel in p6) assert.equal(p6[rel], p5[rel], rel);
});

test('the guard: every counted run refuses while freeze.mjs is null; a rehearsal needs pins; practice and probe pass', () => {
  assert.equal(PREREG6_SHA256, null); assert.equal(NOT_BEFORE6, null);
  assert.throws(() => checkRun6({ mode: 'counted' }), /wait for the freeze/);
  assert.throws(() => checkRun6({ mode: 'counted', freeze: { PREREG6_SHA256: 'a'.repeat(64), NOT_BEFORE6: '2026-01-01T00:00:00Z' } }), /hashes to [0-9a-f]{64}, not the frozen a{64}/);
  // With the committed record's own sha frozen: refused before the not-before, accepted after it (every pin re-checked).
  const real = createHash('sha256').update(readFileSync('experiments/nina-changes/preregistration.json')).digest('hex');
  assert.throws(() => checkRun6({ mode: 'counted', freeze: { PREREG6_SHA256: real, NOT_BEFORE6: new Date(Date.now() + 3600e3).toISOString().replace(/\.\d+Z$/, 'Z') } }), /not after the EXP 006 not-before/);
  const frozen = checkRun6({ mode: 'counted', freeze: { PREREG6_SHA256: real, NOT_BEFORE6: '2026-01-01T00:00:00Z' } });
  assert.deepEqual([frozen.stamp.mode, frozen.stamp.prereg6Sha256, frozen.stamp.notBefore], ['counted', real, '2026-01-01T00:00:00Z']);
  assert.throws(() => checkRun6({ mode: 'rehearsal' }), /rehearsalPins/);
  assert.throws(() => checkRun6({ mode: 'rehearsal', rehearsalPins: { prereg6Sha256: 'a'.repeat(64), notBefore: new Date(Date.now() + 3600e3).toISOString() } }), /not in the past/);
  assert.throws(() => checkRun6({ mode: 'practice', rehearsalPins: { prereg6Sha256: 'a'.repeat(64), notBefore: '2026-01-01T00:00:00Z' } }), /rehearsal only/);
  const ok = checkRun6({ mode: 'rehearsal', rehearsalPins: { prereg6Sha256: 'a'.repeat(64), notBefore: '2026-01-01T00:00:00Z' } });
  assert.deepEqual([ok.stamp.mode, ok.stamp.rehearsal, ok.stamp.fixture, ok.stamp.codeMatchesPins], ['counted', true, false, true]);
  assert.equal(ok.stamp.corpusSha256, 'a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9');
  assert.equal(ok.stamp.baseCommit, '3e35e4e274932a61bc0d92f378f8d506a9bb4ce0');
  assert.equal(checkRun6({ mode: 'practice' }).stamp.mode, 'practice');
  assert.equal(checkRun6({ mode: 'probe' }).stamp.prereg6Sha256, null);
});

test('the fixture guard: fixture/rehearsal runs use ONLY the EXP 006 stream-json fake; real runs refuse both fakes', () => {
  const dir = scratchDir('nc-claude');
  try {
    const bin = name => { const d = join(dir, name); mkdirSync(d); return d; };
    const fake6 = bin('f6'); symlinkSync(FAKE_CLAUDE6, join(fake6, 'claude'));
    const fake5 = bin('f5'); symlinkSync(FAKE_CLAUDE, join(fake5, 'claude'));
    chmodSync(FAKE_CLAUDE6, 0o755); chmodSync(FAKE_CLAUDE, 0o755);
    assert.equal(chooseClaude6(true, fake6), join(fake6, 'claude'));
    assert.throws(() => chooseClaude6(true, fake5), /EXP 006 stream-json fake/);
    assert.throws(() => chooseClaude6(false, fake6), /cannot use a fake/);
    assert.throws(() => chooseClaude6(false, fake5), /cannot use a fake/);
    // A non-executable copy of the fake is skipped by PATH lookup: the fixture run then refuses, never falls through.
    const copy = bin('copy'); cpSync(FAKE_CLAUDE6, join(copy, 'claude')); chmodSync(join(copy, 'claude'), 0o644);
    const other = bin('other'); writeFileSync(join(other, 'claude'), '#!/bin/sh\necho 2.1.280\n'); chmodSync(join(other, 'claude'), 0o755);
    assert.throws(() => chooseClaude6(true, `${copy}:${other}`), /EXP 006 stream-json fake/);
  } finally { removeScratch(dir); }
});

// ------------------------------------------------------------------ the command and the scrub

test('the argv: EXP 005\'s pinned flags plus stream-json --verbose and fence6; the scrubbed render equals the <ws> template', () => {
  const repo = join(RUN_ROOT6, 'nina-changes-reviewer-AbC123', 'repo');
  const args = reviewerArgs6(prereg, { repo });
  assert.equal(args[1], prereg.gates.reviewer.prompt, 'the EXP 005 prompt, byte for byte');
  for (const [flag, value] of [['--agent', 'reviewer'], ['--model', 'claude-opus-5-5'], ['--effort', 'high'], ['--output-format', 'stream-json'], ['--permission-mode', 'dontAsk'], ['--setting-sources', 'project']]) assert.equal(args[args.indexOf(flag) + 1], value, flag);
  assert.ok(args.includes('--verbose') && args.includes('--no-session-persistence'));
  assert.ok(args.includes(`Bash(git -C ${repo} diff:*)`));
  assert.equal(renderCommand6(reviewerArgs6(prereg, { prompt: '', repo })), commandTemplate(prereg));
  assert.ok(commandTemplate(prereg).includes(`Bash(git -C ${WS_REPO} --no-pager log:*)`));
  assert.doesNotMatch(commandTemplate(prereg), /nina-changes-reviewer-|\/Users\//);
  assert.equal(renderCommand(args).startsWith('claude -p <prompt> --agent reviewer'), true);
  assert.throws(() => reviewerArgs6(prereg, { repo, variant: 'fence5' }), /unknown EXP 006 variant/);
});

test('scrub6: the EXP 006 run-dir prefix collapses to <ws>, then EXP 005\'s rules; lint6 refuses a leak', () => {
  const home = homedir();
  assert.equal(scrubPaths6(`${home}/.cache/odin-rnd/nina-changes-runs/nina-changes-reviewer-Xy12Ab/repo/src/a.ts`), '<ws>/repo/src/a.ts');
  const sharedTmp = ['', 'private', 'tmp'].join('/'); // built, so the file itself carries no temp path
  assert.equal(scrubPaths6(`${sharedTmp}/nina-changes-reviewer-Xy12Ab/tmp`), '<ws>/tmp');
  assert.equal(scrubPaths6(`${home}/x`), '~/x');
  assert.deepEqual(lint6('clean <ws>/repo text'), []);
  assert.ok(lint6(`${'/'}Users/someone/x`).length > 0, 'a home path');
  assert.ok(lint6(`<tmp>/claude-${'5'.repeat(3)}/x`).some(f => /uid/.test(f)), 'a session uid');
  assert.throws(() => publicRecord6({ a: `session claude-${'5'.repeat(3)} x` }, 't'), /leaks/);
  assert.deepEqual(publicRecord6({ a: `${'/'}Users/x/y` }, 't'), { a: '~/y' }, 'any home prefix scrubs to ~');
  assert.deepEqual(publicRecord6({ a: `${home}/.cache/odin-rnd/nina-changes-runs/nina-changes-reviewer-Xy12Ab/repo` }, 't'), { a: '<ws>/repo' });
});

test('scrub6: a home path the client truncated collapses to ~ (phase B); a refused record names its leaking fields only', () => {
  const home = homedir();
  const truncated = `fatal: '${home.slice(0, home.length - 3)}`; // …/Users/<part of the name>, as a truncated output
  assert.doesNotMatch(scrubPaths6(truncated), /\/Users\//);
  assert.deepEqual(lint6(scrubPaths6(`${truncated}\n${home}/x`)), []);
  assert.equal(scrubPaths6('<ws>/home/probe-user/canary.txt'), '<ws>/home/probe-user/canary.txt', 'the probe canary home is left alone');
  const users = ['', 'Users', 'someone'].join('/');
  assert.deepEqual(leakFields({ a: 'clean', b: { c: [`${users}/x`, 'ok'] } }), ['b.c.0']);
});

test('D3: a harness failure\'s is_error is the FINAL result line\'s only, never a tool_result\'s (the cwd-tracking artifact)', () => {
  const artifact = res('a', 'Exit code 1\n M src/domain/money.ts\nzsh:1: operation not permitted: <tmp>/claude-session/cwd-0000', true);
  const r = classifyStreamRun({ timedOut: false, exitCode: 0, stdout: stream([init, use('a', 'Bash', { command: 'git status --short' }), artifact, final()]) });
  assert.equal(r.harnessFailure, null, 'a tool_result is_error is not a harness failure');
  assert.equal(r.parsed.toolCalls[0].isError, true);
  assert.equal(r.parsed.toolCalls[0].refused, false, 'and not a refusal: it is not in permission_denials');
  const refused = classifyStreamRun({ timedOut: false, exitCode: 0, stdout: stream([init, use('b', 'Bash', { command: 'cat ../x' }), res('b', 'denied', true), final({ permission_denials: [{ tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'cat ../x' } }] })]) });
  assert.deepEqual([refused.harnessFailure, refused.parsed.toolCalls[0].refused], [null, true]);
  assert.equal(classifyStreamRun({ timedOut: false, exitCode: 0, stdout: stream([init, final({ is_error: true })]) }).harnessFailure, 'is-error');
  assert.equal(runState({ harnessFailure: null, decision: 'ACCEPT', toolCalls: [{ isError: true }] }, true), 'SEEN-DECIDED');
});

test('B2 (D4): the post-freeze pre-run matrix probe is charged to the $60 cap only; pre-freeze probes and practice stay under $10', async () => {
  assert.deepEqual([isPreCounted('isolation-matrix'), isPreCounted('practice'), isPreCounted(PRERUN_KIND), isPreCounted('counted')], [true, true, false, false]);
  const dir = scratchDir('nc-prerun');
  try {
    const L = new SpendLedger6(join(dir, 'ledger.jsonl'));
    L.record({ ts: 't1', kind: 'isolation-matrix', id: 'm', run: 1, reportedCostUsd: 4.0821826 });
    L.record({ ts: 't2', kind: 'practice', id: 'p01', run: 1, reportedCostUsd: 5.3 });
    // 9.3821826 + reserve 5.3 > 10: a practice call and a pre-freeze probe are refused (STOP + ASK-FORK) ...
    assert.deepEqual([L.check('practice').reason, L.check('isolation-matrix').reason], ['pre-counted-ceiling', 'pre-counted-ceiling']);
    // ... the post-freeze pre-run probe is not, because it is charged to the $60 cap only ...
    assert.equal(L.check(PRERUN_KIND).ok, true);
    const line = L.record({ ts: 't3', kind: PRERUN_KIND, id: 'isolation-matrix', run: 1, reportedCostUsd: 0.6 });
    assert.equal(line.kind, PRERUN_KIND);
    assert.equal(L.preCountedTotal(), round7(4.0821826 + 5.3), 'the pre-run probe is not pre-counted');
    // ... and it is refused at the $60 cap like any counted call.
    L.record({ ts: 't4', kind: 'counted', id: 'c001', run: 1, reportedCostUsd: 48 });
    assert.equal(L.check(PRERUN_KIND).reason, 'cap');
  } finally { removeScratch(dir); }
  // A pre-run probe runs on the frozen runner: while freeze.mjs is null it refuses before any workspace or call.
  await assert.rejects(runReviewer6({ out: '/dev/null', mode: 'probe', probe: 'matrix', prerun: true, log: () => {} }), /wait for the freeze/);
  await assert.rejects(runReviewer6({ out: '/dev/null', mode: 'practice', prerun: true, log: () => {} }), /pre-run matrix probe/);
});
