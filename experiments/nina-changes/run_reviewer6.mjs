// EXP 006 reviewer runner: nina 0.34.0's reviewer, run headless by Claude Code on one change at a time, k runs per
// change, exactly as EXP 005 ran it (same pre-registered prompt, model, effort, k, 600 s, hang-stop, sequential id
// order, fresh workspace staged by EXP 005's own stageWorkspace) with two declared differences: fence6 (fence6.mjs)
// and `--output-format stream-json --verbose`, so every tool call and its output is recorded and the manipulation
// check (diff-seen.mjs) can tell whether the run obtained the change.
//
//   node experiments/nina-changes/run_reviewer6.mjs --out <run.json> --mode counted|practice|probe
//        [--ledger <spend.jsonl>] [--items c001,… | --practice <practice.json>] [--probe matrix [--isolation fence6|sandbox6-only]]
//        [--tarball <nina-0.34.0.tgz>] [--preflight-record <file>]
//
// EXP 006 OWNS its reviewer call (argv), loop, stream parser, spend guard, counted-run guard and fixture guard. From
// EXP 005 it imports only pure exports (below) and carries byte-identical copies of the private helpers it needs
// (vendored-exp005.mjs). Imported from run_reviewer.mjs: BILLED-stripping childEnv, stageWorkspace, verifiedTarball,
// resolveBin, parseVerdict, renderCommand, hooksConfigured, hangStop, corpusItems, practiceItems, DEFAULT_TARBALL,
// CHILD_GIT_ENV, FAKE_CLAUDE (only to refuse it). From runner-guard.mjs: checkPreflightRecord, answerKeyPreflight,
// fixtureFields, REPO_ROOT, sha256.
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHILD_GIT_ENV, childEnv, corpusItems, DEFAULT_TARBALL, FAKE_CLAUDE, hangStop, hooksConfigured, parseVerdict, practiceItems, renderCommand,
  resolveBin, stageWorkspace, verifiedTarball,
} from '../jev-gate/run_reviewer.mjs';
import { answerKeyPreflight, checkPreflightRecord, fixtureFields, REPO_ROOT, sha256 } from '../jev-gate/runner-guard.mjs';
import { callHitsFingerprint, classifyDiffSeen, RULE as DIFF_SEEN_RULE } from './diff-seen.mjs';
import { fence6Tools, ISOLATION6, VARIANTS6, WS_REPO } from './fence6.mjs';
import { fingerprintItem, loadFingerprints, outFile as FINGERPRINTS_FILE } from './fingerprints.mjs';
import { loadBaseLines, outFile as BASE_LINES_FILE } from './base-lines.mjs';
import { NOT_BEFORE6, PREREG6_SHA256 } from './freeze.mjs';
import { checkRun6, PREREG6, RUNNER6_PINS } from './guard6.mjs';
import { judgeMatrix6, MATRIX_PROMPT6, matrixSetup6 } from './matrix6.mjs';
import { applyAttempts } from './matrix6-attempts.mjs';
import { leakFields, publicRecord6, scrubPaths6, scrubRecord6, RUN_PREFIX6 } from './scrub6.mjs';
import { LEDGER6, LIMITS6, PRERUN_KIND, SpendLedger6 } from './spend6.mjs';
import { classifyStreamRun, HARNESS_FAILURE_DEFINITION, parseStream, recordToolCalls } from './stream6.mjs';
import { gitgit, hookContext, run, spawnTimed } from './vendored-exp005.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKE_CLAUDE6 = join(HERE, 'fixtures', 'fake-claude-stream.mjs');
/** Run dirs live under home (the sandbox's home read block covers everything outside the workspace), outside any checkout. */
export const RUN_ROOT6 = join(homedir(), '.cache', 'odin-rnd', 'nina-changes-runs');
export const LEDGER_FILE = join(REPO_ROOT, LEDGER6);
// The exclusive run lock (refute r5 N2): the pending sidecar is per worktree, so two runners at once could each pass
// the spend check and overshoot the cap by a call. Every paid invocation holds this file, created O_EXCL, for its
// whole run; a second one refuses. A stale lock (a killed runner) is removed by the operator after checking.
export const LOCK6 = 'experiments/nina-changes/run.lock';

/** Takes the lock (O_EXCL) or throws; returns the release, which removes the file only if it is still this one. */
export function acquireRunLock6(path = join(REPO_ROOT, LOCK6)) {
  let fd;
  try { fd = openSync(path, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`another EXP 006 runner holds ${LOCK6} (${readFileSync(path, 'utf8').trim() || 'no content'}); if none is running, the operator checks and removes it`);
    throw error;
  }
  const token = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  try { writeFileSync(fd, `${token}\n`); } finally { closeSync(fd); }
  return () => { if (existsSync(path) && readFileSync(path, 'utf8').trim() === token) unlinkSync(path); };
}
export { PREREG6_SHA256, NOT_BEFORE6 };

// ----------------------------------------------------------------------------- the fixture guard

/**
 * Which claude a run executes, resolved once and called by absolute path. A fixture or rehearsal run must resolve to
 * EXP 006's committed stream-json fake and nothing else (a fake that is not executable would otherwise fall through
 * to the real client on PATH and make paid calls; EXP 005 ledger, 2026-09-28). Every other run refuses both fakes.
 */
export function chooseClaude6(fake, pathVar = process.env.PATH ?? '') {
  const bin = resolveBin('claude', pathVar);
  if (!bin) throw new Error('claude is not on the PATH');
  const real = realpathSync(bin);
  const fakes = [realpathSync(FAKE_CLAUDE6), realpathSync(FAKE_CLAUDE)];
  if (fake && real !== fakes[0]) throw new Error(`a fixture or rehearsal run must use the EXP 006 stream-json fake (${relative(REPO_ROOT, FAKE_CLAUDE6)}); PATH resolves claude to another binary`);
  if (!fake && fakes.includes(real)) throw new Error('a practice, probe or counted run cannot use a fake claude');
  return bin;
}

// ----------------------------------------------------------------------------- the command

/** The claude argv: EXP 005's pinned flags with stream-json + --verbose and the variant's settings and tools. */
export function reviewerArgs6(prereg, { prompt = prereg.gates.reviewer.prompt, repo, variant = ISOLATION6 } = {}) {
  const v = VARIANTS6[variant];
  if (!v) throw new Error(`unknown EXP 006 variant ${variant}`);
  const r = prereg.gates.reviewer;
  return ['-p', prompt, '--agent', r.agent, '--model', r.model, '--effort', r.effort, '--output-format', 'stream-json', '--verbose',
    '--no-session-persistence', '--setting-sources', 'project', '--permission-mode', 'dontAsk',
    '--settings', JSON.stringify(v.settings), '--allowedTools', ...v.tools(repo)];
}

/** The command as a record shows it (scrubbed): the per-run repository becomes <ws>/repo. */
export const renderCommand6 = args => scrubPaths6(renderCommand(args));
/** The pre-registerable template: the same render with the repository written as <ws>/repo (R3-6 compares this). */
export const commandTemplate = (prereg, variant = ISOLATION6) => renderCommand6(reviewerArgs6(prereg, { prompt: '', repo: WS_REPO, variant }));

// ----------------------------------------------------------------------------- the record builder

const statusOf = repo => gitgit(repo)('status', '--porcelain', '--untracked-files=all').stdout.split('\n').filter(Boolean).map(l => l.slice(3)).sort();

/**
 * One call's record from the spawn result and its context. Pure except for hashing: it never throws on what the
 * client printed. Returns {rec, rawCalls} (rawCalls: every tool call with its full output, for the matrix judge).
 */
export function buildCallRecord({ prereg, item, runIndex, spawn, variant, args, fp, staged, extra = {}, keepAllOutputs = false }) {
  const { harnessFailure, out, parsed } = spawn.error ? { harnessFailure: 'spawn-error', out: null, parsed: parseStream('') } : classifyStreamRun(spawn);
  const text = typeof out?.result === 'string' ? out.result : null;
  const verdict = harnessFailure ? { decision: null, verdictLine: null } : parseVerdict(prereg, text);
  const scrubbedCalls = JSON.parse(scrubPaths6(JSON.stringify(parsed.toolCalls)));
  const toolCalls = recordToolCalls(scrubbedCalls, c => callHitsFingerprint(c, fp), { keepAll: keepAllOutputs });
  const diffSeen = fp ? classifyDiffSeen({ calls: toolCalls, fp, harnessFailure }) : null;
  const rec = {
    id: item.id, run: runIndex, gate: 'reviewer',
    startedAt: spawn.startedAt, endedAt: spawn.endedAt, latencyMs: Math.round(spawn.latencyMs),
    status: harnessFailure ?? 'ok', harnessFailure, exitCode: spawn.exitCode,
    decision: verdict.decision, verdictLine: verdict.verdictLine,
    abstention: harnessFailure ? 'failure' : verdict.decision ? null : 'model',
    costUsd: typeof out?.total_cost_usd === 'number' ? out.total_cost_usd : null, costBasis: 'api-equivalent',
    subtype: out?.subtype ?? null, isError: out?.is_error ?? null, numTurns: out?.num_turns ?? null,
    durationMs: out?.duration_ms ?? null, modelUsage: out?.modelUsage ? Object.keys(out.modelUsage) : null,
    permissionDenials: Array.isArray(out?.permission_denials) ? out.permission_denials.map(d => ({ tool: d.tool_name, input: d.tool_input })) : null,
    result: text, resultSha256: text === null ? null : sha256(text),
    stderrTail: spawn.stderr ? spawn.stderr.trim().split('\n').slice(-5).join('\n') : '',
    stream: { lines: parsed.lineCount, events: parsed.events, malformedLines: parsed.malformed.length, finalResultLine: Boolean(parsed.finalResult), clientVersion: parsed.init?.claude_code_version ?? null, initModel: parsed.init?.model ?? null, initPermissionMode: parsed.init?.permissionMode ?? null },
    toolCalls, diffSeen,
    baseSha: staged.baseSha, isolation: variant, command: renderCommand6(args),
    stagingLog: staged.log, ninaDataIsolated: true, childGitEnv: CHILD_GIT_ENV,
    ...extra,
  };
  rec.gitToolDenials = (rec.permissionDenials ?? []).filter(d => d.tool === 'Bash' && /(^|\s)git(\s|$)/.test(String(d.input?.command ?? ''))).length;
  return { rec, rawCalls: parsed.toolCalls };
}

// ----------------------------------------------------------------------------- one headless run

/** One reviewer run in a fresh workspace (or, in a rehearsal, a bare dir holding the patch for the fake). */
/**
 * The cost a spawn result reports, for the ledger line written BEFORE anything else (refute r2 N1): the final result
 * line's total_cost_usd, or null (charged the upper bound) after a timeout, a spawn error or any malformed stream line
 * (conservative: a malformed stream charges the upper bound even if a final line reported a cost).
 */
export function reportedCost(spawn) {
  if (spawn.timedOut || spawn.error) return null;
  const p = parseStream(spawn.stdout);
  return p.malformed.length ? null : (typeof p.finalResult?.total_cost_usd === 'number' ? p.finalResult.total_cost_usd : null);
}
export const FAULT_STAGES = ['after', 'hook', 'build', 'judge'];

/**
 * Write a paid call's ledger line; if the write throws (a corrupt ledger, an append failure), keep the line in the
 * pending sidecar, say so on stderr and return {failed:true}: the spend guard then refuses every later call until the
 * pending line is reconciled by hand (fail closed).
 */
export function recordSpend(ledger, meta) {
  try { return { failed: false, line: ledger.record(meta) }; } catch (error) {
    ledger.recordPending({ ...meta, error: String(error.message).slice(0, 200) });
    process.stderr.write(`spend ledger write failed; line kept in ${ledger.pendingPath}: ${error.message}\n`);
    return { failed: true };
  }
}

export async function reviewerRun6({ prereg, amendment, item, runIndex, tarball, claudeBin, variant, timeoutMs, fp, rehearsal = false, matrix = false, beforeSpawn = null, onSpawn = null, faults = null }) {
  mkdirSync(RUN_ROOT6, { recursive: true });
  const parent = mkdtempSync(join(RUN_ROOT6, RUN_PREFIX6));
  const runTmp = join(parent, 'tmp');
  mkdirSync(runTmp);
  let setup = null, built = null;
  try {
    let staged;
    if (rehearsal) {
      staged = { repo: join(parent, 'repo'), baseSha: 'rehearsal', log: [], ninaData: join(parent, 'nina-data') };
      mkdirSync(staged.repo); mkdirSync(staged.ninaData);
      writeFileSync(join(staged.repo, 'rehearsal-change.patch'), item.patch ?? '');
    } else {
      try { staged = stageWorkspace({ prereg, amendment, patch: item.patch, tarball, parent }); } catch (error) { return { rec: { id: item.id, run: runIndex, gate: 'reviewer', stageError: scrubPaths6(error.message) }, rawCalls: [] }; }
    }
    if (matrix) setup = matrixSetup6(parent, staged.repo);
    const statusBefore = rehearsal ? [] : statusOf(staged.repo);
    const { env, stripped } = childEnv(process.env, staged.ninaData, runTmp);
    const args = reviewerArgs6(prereg, { prompt: matrix ? MATRIX_PROMPT6(setup) : prereg.gates.reviewer.prompt, repo: realpathSync(staged.repo), variant });
    // The intent line (refute r4 N1) is written before the paid call; if it cannot be written, there is no call.
    if (beforeSpawn) {
      try { beforeSpawn(); } catch (error) { const e = new Error(`the spend intent line could not be written, so no call was made: ${error.message}`); e.code = 'EINTENT'; throw e; }
    }
    const spawn = await spawnTimed(claudeBin, args, { cwd: staged.repo, env, timeoutMs });
    // The paid call has happened: its ledger line is written now, from the spawn result, before any step below
    // that could throw (the caller's onSpawn). Every later step is wrapped: a throw marks the record, never loses it.
    const cost = reportedCost(spawn);
    if (onSpawn) onSpawn({ spawn, reportedCostUsd: cost });
    const fault = stage => { if (faults?.includes(stage)) throw new Error(`injected fault at ${stage}`); };
    try {
      fault('after');
      const after = rehearsal ? [] : statusOf(staged.repo);
      fault('hook');
      const hook = rehearsal ? { ran: false, rehearsal: true, error: false } : hookContext(staged.repo, parent);
      const extra = {
        statusBefore, treeChangedByRun: JSON.stringify(after) !== JSON.stringify(statusBefore), billingKeysStripped: stripped, childTmpdir: env.TMPDIR,
        hook, hooksConfigured: rehearsal ? [] : hooksConfigured(staged.repo),
      };
      fault('build');
      built = buildCallRecord({ prereg, item, runIndex, spawn, variant, args, fp, staged, extra, keepAllOutputs: matrix });
      fault('judge');
      if (setup) built.rec.matrix = applyAttempts(judgeMatrix6(setup, { ...built.rec, allToolCalls: built.rawCalls }), built.rawCalls);
      return built;
    } catch (error) {
      built = { rec: { id: item.id, run: runIndex, gate: 'reviewer', startedAt: spawn.startedAt, endedAt: spawn.endedAt, costUsd: cost, postCallError: scrubPaths6(error.message).slice(0, 300) }, rawCalls: [] };
      return built;
    }
  } finally {
    // The matrix canaries and escape files outside the run dir are removed too (a temp-root repo is a dir).
    for (const p of [...(setup?.external ?? []), ...Object.values(setup?.writes ?? {})]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* gone */ } }
    // Removal must never throw away a finished call (its cost is recorded by the caller after this returns): a
    // process still writing into the run dir under heavy load made rmSync fail with ENOTEMPTY (phase C2 rerun). Retry,
    // and if the dir still cannot be removed, say so on the record instead of throwing.
    try { rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (error) {
      if (built) built.rec.runDirNotRemoved = scrubPaths6(error.code ?? error.message);
    }
  }
}

// ----------------------------------------------------------------------------- the whole invocation

const fileSha = path => sha256(readFileSync(path));

/** A practice row's fingerprints are made the same way from its patch (practice rows are never scored). */
function fingerprintsFor(items, corpus) {
  const baseSet = new Set(loadBaseLines().sha256s);
  return Object.fromEntries(items.map(i => [i.id, corpus.items[i.id] ?? (i.patch ? fingerprintItem(i.patch, baseSet) : null)]));
}

/** One invocation. A paid one (anything but a fixture or a rehearsal) holds the exclusive run lock throughout. */
export async function runReviewer6(opts) {
  if (opts.fixture || opts.mode === 'rehearsal') return runInvocation6(opts);
  const release = acquireRunLock6();
  try { return await runInvocation6(opts); } finally { release(); }
}

async function runInvocation6({ out, ledgerPath = LEDGER_FILE, items = [], mode, probe = null, prerun = false, variant, tarball = DEFAULT_TARBALL, fixture = false, rehearsalPins = null, preflightRecord, log = console.log, fixtureTimeoutMs, faults = null }) {
  const rehearsal = mode === 'rehearsal';
  if (faults && !fixture && !rehearsal) throw new Error('fault injection is for fixture and rehearsal runs only');
  // Every paid run (practice, probe, prerun, counted) appends to the committed ledger (refute r4 B2): a separate
  // --ledger would silently undercount the spend. Only fixture and rehearsal runs may point elsewhere.
  if (!fixture && !rehearsal && resolve(ledgerPath) !== LEDGER_FILE) throw new Error(`a practice, probe or counted run appends to the committed ledger ${LEDGER6} (given ${relative(REPO_ROOT, resolve(ledgerPath))})`);
  if (prerun && !probe) throw new Error('prerun is the measured run\'s pre-run matrix probe (--probe matrix --prerun)');
  // The pre-run probe runs on the FROZEN runner: it passes the counted guard (freeze set, the pre-registration and
  // every pin intact, after the not-before), and it is charged to the $60 cap only (spend6 PRERUN_KIND).
  const { prereg, amendment, stamp } = checkRun6({ mode: probe ? (prerun ? 'counted' : 'probe') : mode, fixture, rehearsalPins });
  if (probe && probe !== 'matrix') throw new Error('the EXP 006 probe is the isolation matrix (--probe matrix)');
  if (fixtureTimeoutMs !== undefined && !fixture && !rehearsal) throw new Error('a timeout other than the pre-registered one is for fixture runs only');
  const timeoutMs = fixtureTimeoutMs ?? prereg.gates.reviewer.timeoutSeconds * 1000;
  const r = prereg.gates.reviewer, nina = amendment.changes.reviewer.nina;
  if (!rehearsal) verifiedTarball(tarball, nina.tarball.integrity);
  const claudeBin = chooseClaude6(fixture || rehearsal, process.env.PATH);
  const version = spawnVersion(claudeBin);
  if (version !== r.clientVersion) throw new Error(`claude --version is ${version}, not the pinned ${r.clientVersion}`);
  if (variant !== undefined && !probe) throw new Error('only a probe may choose a variant');
  const iso = probe ? (variant ?? ISOLATION6) : ISOLATION6;
  const counted = stamp.mode === 'counted' && !probe;
  if (counted && !fixture && !rehearsal) {
    // The EXP 006 pre-registration (checked by sha in the guard) must pre-register exactly this command template.
    const prereg6 = JSON.parse(readFileSync(join(REPO_ROOT, PREREG6), 'utf8'));
    if (prereg6.reviewer?.command !== commandTemplate(prereg, iso)) throw new Error('the EXP 006 pre-registration does not pre-register the command this runner would run');
    const whole = corpusItems().map(i => i.id).sort(), got = items.map(i => i.id).sort();
    if (whole.length !== got.length || whole.some((id, i) => id !== got[i])) throw new Error('a counted run must cover the whole corpus in one invocation (the hang-stop counters are per process)');
  }
  if (mode === 'practice' && items.some(i => corpusItems().some(c => c.id === i.id))) throw new Error('a practice run takes practice rows, never a corpus item');
  const ledger = rehearsal ? null : new SpendLedger6(ledgerPath);
  const corpus = loadFingerprints();
  const fps = fingerprintsFor(items, corpus);
  const record = publicRecord6({
    schemaVersion: 1, kind: 'gate-run', gate: 'reviewer', experiment: 'EXP 006',
    mode: probe ? (prerun ? PRERUN_KIND : 'isolation-matrix') : stamp.mode, ...fixtureFields(fixture), ...(rehearsal ? { rehearsal: true } : {}),
    parentSha256: stamp.parentSha256, amendmentSha256: stamp.amendmentSha256, amendment02Sha256: stamp.amendment02Sha256,
    prereg6Sha256: stamp.prereg6Sha256, notBefore: stamp.notBefore ?? amendment.notBefore, code: stamp.code, codeMatchesPins: stamp.codeMatchesPins,
    corpusSha256: stamp.corpusSha256, baseCommit: stamp.baseCommit,
    startedAt: new Date().toISOString(), endedAt: null,
    pins: {
      client: 'Claude Code', clientVersion: version, clientBinary: fixture || rehearsal ? 'FIXTURE fake-claude-stream.mjs' : 'claude', clientBinaryRule: 'the claude that PATH resolves; its local path is never recorded',
      model: r.model, effort: r.effort, agent: r.agent, k: r.k, timeoutSeconds: r.timeoutSeconds, hangStop: r.hangStop, promptSha256: sha256(r.prompt),
      isolation: iso, settings: VARIANTS6[iso].settings, allowedTools: fence6Tools(WS_REPO), command: commandTemplate(prereg, iso), outputFormat: 'stream-json --verbose',
      harnessFailure: HARNESS_FAILURE_DEFINITION, nina: { release: nina.release, commit: nina.commit, integrity: nina.tarball.integrity }, patches: [],
      fingerprintsSha256: fileSha(FINGERPRINTS_FILE), baseLinesSha256: fileSha(BASE_LINES_FILE), diffSeenRule: DIFF_SEEN_RULE,
      spend: { ...LIMITS6, ledger: LEDGER6 }, runnerPins: RUNNER6_PINS,
      billing: { strippedKeysMirror: 'nina 0.34.0 src/commands/eval.mjs:44 (BILLED)', basis: prereg.cost.reviewer.basis },
    },
    items: items.map(i => i.id), partial: { reason: 'in-progress' }, calls: [],
  }, 'run record');
  const save = () => { record.endedAt = new Date().toISOString(); writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`); };
  const stopFor = (reason, detail) => { record.partial = { reason, ...detail }; log(`STOP: ${reason} ${JSON.stringify(detail)}`); save(); return record; };

  // The pre-flight: a counted run (and a rehearsal, through the same check) requires the pre-flight RECORD, bound to
  // EXP 006's pins file and not-before; a practice run scans inline; probes plant their own canaries.
  if ((counted && !fixture) || rehearsal) {
    const pf = checkPreflightRecord({ path: preflightRecord, mode: 'counted', pinsFile: RUNNER6_PINS, notBefore: stamp.notBefore });
    record.head = pf.head;
    record.pins.preflightRoots = pf.scanned;
    record.pins.preflight = { sha256: pf.sha256, endedAt: pf.endedAt };
    save();
  } else if (mode === 'practice' && !fixture) {
    const pf = answerKeyPreflight({ mode: 'practice' });
    if (!pf.ok) throw new Error(`answer-key pre-flight: ${pf.copies.length} answer-key copies sit outside home; remove them before a practice run`);
    record.pins.preflight = JSON.parse(scrubPaths6(JSON.stringify({ scanned: pf.scanned, skipped: pf.skipped, override: pf.override ?? null, copies: [], vanished: pf.vanished, permissionSkipped: pf.permissionSkipped, durationMs: pf.durationMs })));
    save();
  }

  const kind = probe ? (prerun ? PRERUN_KIND : 'isolation-matrix') : stamp.mode;
  const runOne = async (item, k) => {
    if (ledger) { const { reason, ...guard } = ledger.check(kind, { prereg6Sha256: stamp.prereg6Sha256 }); if (!guard.ok) return { stop: ['spend', { limit: reason, ...guard }] }; }
    // The spend line is written from the spawn result, the moment the call returns (refute r2 N1); if that write
    // fails it goes to the pending sidecar and the run stops (refute r3 N1).
    let ledgerFailed = false;
    const callId = `${kind}:${item.id}:${k}:${Date.now()}`;
    const beforeSpawn = ledger ? () => ledger.writeIntent({ callId, kind, id: item.id, run: k }) : null;
    const onSpawn = ledger ? ({ spawn, reportedCostUsd }) => {
      ledgerFailed = recordSpend(ledger, { ts: spawn.endedAt, kind, id: item.id, run: k, reportedCostUsd, fixture, prereg6Sha256: stamp.prereg6Sha256 }).failed;
      if (!ledgerFailed) ledger.clearIntent(callId); // a failed write leaves the intent (and the failed line) pending
    } : null;
    let rec;
    try {
      ({ rec } = await reviewerRun6({ prereg, amendment, item, runIndex: k, tarball, claudeBin, variant: iso, timeoutMs, fp: fps[item.id] ?? null, rehearsal, matrix: Boolean(probe), beforeSpawn, onSpawn, faults }));
    } catch (error) {
      if (error.code === 'EINTENT') return { stop: ['intent-write', { id: item.id, run: k, error: scrubPaths6(String(error.message)).slice(0, 200) }] };
      throw error;
    }
    if (rec.stageError) { record.calls.push(rec); return { stop: ['workspace', { id: item.id, run: k, error: rec.stageError }] }; }
    if (ledgerFailed) { rec.ledgerWriteFailed = true; record.calls.push({ id: item.id, run: k, gate: 'reviewer', ledgerWriteFailed: true, startedAt: rec.startedAt, endedAt: rec.endedAt, costUsd: rec.costUsd ?? null }); return { stop: ['ledger-write', { id: item.id, run: k, pending: ledger.pendingPath.split('/').pop() }] }; }
    if (rec.postCallError) { record.calls.push(rec); return { stop: ['post-call', { id: item.id, run: k, error: rec.postCallError }] }; }
    try { record.calls.push(publicRecord6(rec, `${item.id} run ${k}`)); } catch (error) {
      // The record is not written, but the facts that carry no text are (phase B: a refused paid probe lost its
      // verdict): which fields still leaked, the cost, the harness state, and the matrix verdict when it is clean.
      const scrubbed = scrubRecord6(rec);
      const matrix = rec.matrix && !leakFields(rec.matrix).length ? rec.matrix : null;
      record.calls.push({ id: item.id, run: k, gate: 'reviewer', lintRefused: true, leakFields: leakFields(scrubbed), startedAt: rec.startedAt, endedAt: rec.endedAt, costUsd: rec.costUsd, harnessFailure: rec.harnessFailure, matrix });
      return { stop: ['lint', { id: item.id, run: k, error: error.message.slice(0, 200) }] };
    }
    return { rec };
  };

  if (probe) {
    const done = await runOne({ id: 'isolation-matrix', patch: null }, 1);
    if (done.stop) return stopFor(...done.stop);
    const call = record.calls.at(-1);
    call.matrix.clientVersion = version;
    call.probePassed = call.matrix.passed && version === r.clientVersion;
    record.partial = null;
    save();
    return record;
  }

  const baseShas = new Set();
  let completed = 0, timeouts = 0;
  for (const item of items) {
    for (let k = 1; k <= r.k; k += 1) {
      // The clock binds every non-fixture counted call (and a rehearsal's): after the EXP 006 not-before.
      if (counted && !fixture && !(Date.now() > Date.parse(stamp.notBefore))) return stopFor('clock', { now: new Date().toISOString() });
      log(`reviewer ${item.id} run ${k}/${r.k}${ledger ? ` (ledger $${ledger.total().toFixed(2)})` : ''}`);
      const done = await runOne(item, k);
      if (done.stop) return stopFor(...done.stop);
      baseShas.add(done.rec.baseSha);
      if (baseShas.size !== 1) return stopFor('base-sha-drift', { shas: [...baseShas] });
      completed += 1;
      if (done.rec.harnessFailure === 'timeout') timeouts += 1;
      save();
      if (hangStop(r.hangStop, completed, timeouts)) return stopFor('hang-stop', { completed, timeouts });
    }
  }
  record.baseSha = [...baseShas][0] ?? null;
  record.partial = null;
  save();
  return record;
}

/** `claude --version`, first word (EXP 005's check, through its vendored `run`). */
const spawnVersion = bin => run(bin, ['--version'], {}).stdout.trim().split(/\s+/)[0];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const out = at('--out'), mode = at('--mode');
  if (!out || !mode || !['counted', 'practice', 'probe'].includes(mode)) { console.error('usage: run_reviewer6.mjs --out <run.json> --mode counted|practice|probe [--ledger f] [--items ids | --practice file] [--probe matrix [--isolation fence6|sandbox6-only]] [--tarball f] [--preflight-record f]'); process.exit(2); }
  try {
    const probe = mode === 'probe' ? 'matrix' : null;
    const prerun = argv.includes('--prerun');
    const items = probe ? [] : at('--practice') ? practiceItems(at('--practice')) : corpusItems(at('--items')?.split(','));
    const record = await runReviewer6({ out, ledgerPath: at('--ledger') ?? LEDGER_FILE, items, mode, probe, prerun, variant: at('--isolation'), tarball: at('--tarball') ?? DEFAULT_TARBALL, preflightRecord: at('--preflight-record') });
    console.log(`wrote ${relative(process.cwd(), out)}${record.partial ? ` (partial: ${record.partial.reason})` : ''}`);
    process.exit(record.partial ? 3 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
