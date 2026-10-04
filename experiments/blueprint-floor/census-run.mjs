// EXP 007 census runner (WO-2-02, PLAN-DETAIL REVISION 5 + 6). For every census rule, in the pinned order (controls,
// then the primary stratum in selection.json's plugin order and ruleId order, then the secondary sample): the blind
// translator (one fresh client process, no tools), the mechanical checks (protocol.mjs: schema, vocabulary, the engine's
// own validation, flags, teeth through the adapter and the real bce-engine 0.3.1), then the independent adjudicator.
// One attempt per call; a harness failure is class error (counted as not by the pinned scorer).
//
//   node experiments/blueprint-floor/census-run.mjs --mode practice   the two blinding canaries and the practice pair
//   node experiments/blueprint-floor/census-run.mjs --mode counted    the census (resumes after an interruption)
//
// Modes: practice (metered: one canary per model, then one translator + adjudicator pair on the pinned practice rule,
// then the projection), counted (metered: the census), rehearsal (the committed fake client, scratch outputs, never
// publishable). Every metered call: the census guard has passed (census-guard.mjs: freeze, pins, not-before, the served
// record), the spend guard allows it (census-spend.mjs), an intent line is in the pending sidecar BEFORE the spawn, and
// the ledger line is written FIRST from the spawn result. The client is called exactly as pre-registered:
//   claude -p --model <pin> --effort high --tools "" --strict-mcp-config --setting-sources project
//          --no-session-persistence --system-prompt-file <pinned prompt file> --output-format json
// with the user message on stdin, in a fresh empty temporary directory (also the child's TMPDIR) with no CLAUDE.md or
// .git above it, and an environment built from an allowlist. API-billing variables in the parent refuse a metered run.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { BILLED, resolveBin } from '../jev-gate/run_reviewer.mjs';
import { leakFields, lint6, scrubPaths6 } from '../nina-changes/scrub6.mjs';
import { assertOpaqueIdsDistinct, buildAdjudicatorPrompt, buildTranslatorPrompt, mechanicalChecks, parseAnswer, PROMPT_FILES, validateAdjudicatorOutput } from './protocol.mjs';
import { finalClass } from './scorer.mjs';
import { checkCensusRun, DIR, REPO_ROOT, sha256 } from './census-guard.mjs';
import { CensusLedger, LEDGER, projection, ROLES } from './census-spend.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKE_CLAUDE7 = join(HERE, 'fixtures', 'fake-claude-census.mjs');
export const RECORDS_DIR = `${DIR}/census`;
export const PRACTICE_RECORD = `${DIR}/practice/practice-run.json`;
export const LOCK = `${DIR}/run.lock`;
export const CANARY_FILE = `${DIR}/prompts/canary.md`;
export const PRACTICE_FILE = `${DIR}/controls/practice.json`;
/** Not pre-registered: the runner's per-call limit (EXP 005's reviewer limit). A call that reaches it is a timeout: class error. */
export const CALL_TIMEOUT_MS = 600_000;
export const RUN_PREFIX = 'exp007-census-';
export const ENV_ALLOW = Object.freeze(['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'SHELL', 'TERM']);
export const MODES = ['practice', 'counted', 'rehearsal'];
/** The terms whose appearance in a canary answer fails it (R3-3), plus every census ruleId. */
export const CANARY_BASE_TERMS = Object.freeze(['EXP 005', 'EXP 006', 'odin-rnd', 'nina', 'jev-gate', 'blueprint-floor', 'Odin']);

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
export const canaryPrompt = (root = REPO_ROOT) => read(root, CANARY_FILE).replace(/\n$/, '');
export const modelOf = (prereg, role) => (role === 'translator' ? prereg.calls.translatorModel : role === 'adjudicator' ? prereg.calls.adjudicatorModel : null);

// ----------------------------------------------------------------------------- the census population, in order

const byId = (a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0);
/** Every census rule as the prompt builders and mechanical checks need it, in the pinned order (WO-2-02). */
export function censusRules(root = REPO_ROOT) {
  const selection = JSON.parse(read(root, `${DIR}/rules/selection.json`));
  const files = selection.plugins.map(p => ({ plugin: p.plugin, rules: JSON.parse(read(root, `${DIR}/rules/${p.plugin}.json`)).rules }));
  const controls = ['positive', 'negative'].flatMap(f => JSON.parse(read(root, `${DIR}/controls/${f}.json`)).rules.map(r => ({ ...r, plugin: null })));
  const of = stratum => files.flatMap(f => f.rules.filter(r => r.stratum === stratum).map(r => ({ ...r, plugin: f.plugin })).sort(byId));
  return [...controls.sort(byId), ...of('primary'), ...of('secondary')];
}
export const practiceRule = (root = REPO_ROOT) => JSON.parse(read(root, PRACTICE_FILE)).rules[0];

// ----------------------------------------------------------------------------- the command and its environment

/** The pinned argv for one role (R2-4, R3-1); the user message goes on stdin. */
export function censusArgs(prereg, role, root = REPO_ROOT) {
  const model = modelOf(prereg, role);
  if (!model) throw new Error(`unknown role ${role}`);
  return ['-p', '--model', model, '--effort', prereg.calls.effort, '--tools', '', '--strict-mcp-config', '--setting-sources', 'project',
    '--no-session-persistence', '--system-prompt-file', join(root, PROMPT_FILES[role]), '--output-format', 'json'];
}
const quote = a => (a === '' ? '""' : a);
/** The template the pre-registration states (calls.command), rendered from the real argv. */
export const commandTemplate = args => ['claude', ...args.map((a, i) => (args[i - 1] === '--model' ? '<pin>' : args[i - 1] === '--system-prompt-file' ? '<pinned prompt file>' : quote(a)))].join(' ');
/** The command as a record shows it: the prompt file relative to the repository. */
export const renderCommand = (args, root = REPO_ROOT) => ['claude', ...args.map(a => quote(a.startsWith(`${root}/`) ? `<repo>/${a.slice(root.length + 1)}` : a))].join(' ');

/** The child's environment, built from scratch (R3-1): the allowlist, LC_*, and TMPDIR = the empty run dir. Nothing else. */
export function childEnv7(parent, runDir) {
  const env = {};
  for (const [k, v] of Object.entries(parent)) if (ENV_ALLOW.includes(k) || /^LC_[A-Z0-9_]+$/.test(k)) env[k] = v;
  env.TMPDIR = runDir;
  return env;
}
export const billedInEnv = (env = process.env) => BILLED.filter(k => k in env);

/** A fresh empty run directory under the system temp root, with no CLAUDE.md and no .git in it or above it. */
export function makeRunDir(base = tmpdir()) {
  const dir = mkdtempSync(join(realpathSync(base), RUN_PREFIX));
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, 'CLAUDE.md')) || existsSync(join(d, '.git'))) { rmSync(dir, { recursive: true, force: true }); throw new Error('the run directory has a CLAUDE.md or a repository above it'); }
    if (dirname(d) === d) break;
  }
  return dir;
}

/** Refuses a metered call under the Node test runner, which sets NODE_TEST_CONTEXT in every test process (EXP 006 r6 B1). */
export function refuseUnderTestRunner(env = process.env) {
  if (env.NODE_TEST_CONTEXT) throw new Error('a metered census call is refused under the Node test runner (NODE_TEST_CONTEXT is set): tests run rehearsals or claude-free only');
}

/** Which client a run executes, resolved once and called by absolute path: a rehearsal only the committed fake, a metered run never it. */
export function chooseClaude7(fake, pathVar = process.env.PATH ?? '') {
  const bin = resolveBin('claude', pathVar);
  if (!bin) throw new Error('claude is not on the PATH');
  const real = realpathSync(bin), fakeReal = realpathSync(FAKE_CLAUDE7);
  if (fake && real !== fakeReal) throw new Error('a rehearsal must use the committed fake client (fixtures/fake-claude-census.mjs); PATH resolves claude to another binary');
  if (!fake && real === fakeReal) throw new Error('a practice or counted run cannot use the fake client');
  if (!fake) refuseUnderTestRunner();
  return bin;
}
export const clientVersion = bin => (spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000 }).stdout ?? '').trim().split(/\s+/)[0];

/** One spawn with the user message on stdin; never throws. */
export function spawnClaude(bin, args, { cwd, env, input, timeoutMs }) {
  return new Promise(done => {
    const startedAt = new Date(), t0 = performance.now();
    let stdout = '', stderr = '', timedOut = false, settled = false, timer = null;
    const finish = (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ exitCode, error, timedOut, stdout, stderr, startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), latencyMs: performance.now() - t0 });
    };
    let child;
    try { child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true }); } catch (e) { finish(null, e.message); return; }
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.on('error', () => { /* a client that exits early */ });
    timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, timeoutMs);
    child.on('error', e => finish(null, e.message));
    child.on('close', code => finish(code, null));
    child.stdin.end(input);
  });
}

// ----------------------------------------------------------------------------- reading one client result

/** The client's JSON result object, or the harness failure that prevents reading it. */
export function parseClientOutput(s) {
  if (s.error) return { harnessFailure: 'spawn-error', out: null };
  if (s.timedOut) return { harnessFailure: 'timeout', out: null };
  let out = null;
  try { out = JSON.parse(s.stdout); } catch { /* below */ }
  if (!out || typeof out !== 'object' || Array.isArray(out)) return { harnessFailure: 'unparseable-client-output', out: null };
  if (s.exitCode !== 0) return { harnessFailure: 'nonzero-exit', out };
  if (out.is_error === true || out.subtype !== 'success') return { harnessFailure: 'client-error', out };
  if (typeof out.result !== 'string') return { harnessFailure: 'no-result', out };
  return { harnessFailure: null, out };
}
/** The cost the ledger line is written from: total_cost_usd, or null (charged the bound) after a timeout, a spawn error or unparseable output. */
export function reportedCost(s) {
  if (s.timedOut || s.error) return null;
  try { const o = JSON.parse(s.stdout); return typeof o?.total_cost_usd === 'number' ? o.total_cost_usd : null; } catch { return null; }
}
/** R3-3: modelUsage has exactly one key and it equals the pin. */
export function modelCheck(out, pin) {
  const keys = out?.modelUsage && typeof out.modelUsage === 'object' && !Array.isArray(out.modelUsage) ? Object.keys(out.modelUsage) : null;
  return { keys, ok: Array.isArray(keys) && keys.length === 1 && keys[0] === pin };
}

/** R6-1: PASS iff the trimmed answer is exactly NONE, or it names none of the pinned terms (word boundary, any case). */
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function canaryVerdict(text, terms) {
  if (typeof text !== 'string') return { pass: false, reason: 'no answer', hits: [] };
  if (text.trim() === 'NONE') return { pass: true, reason: 'answered NONE', hits: [] };
  const hits = terms.filter(t => new RegExp(`\\b${escapeRe(t)}\\b`, 'i').test(text));
  return { pass: hits.length === 0, reason: hits.length ? 'names a pinned term' : 'names no pinned term', hits };
}

// ----------------------------------------------------------------------------- the J7 scrub at write time

const DIGEST = /^[0-9a-f]{64}$/;
// Subtrees whose keys the MODEL or the engine chose (the answer as parsed, the mechanical results naming its constraint
// ids): a 64-hex value there is scanned like any other text. Everywhere else the record's keys are the runner's own.
const MODEL_SUBTREES = new Set(['raw', 'parsed', 'mechanical', 'errors', 'stderrTail', 'hits']);
/** The runner's own digests (keys ending in Sha256, and the code map) masked before the text lint (EXP 006 amendment 01 A1). */
function maskDigests(value) {
  const walk = (v, key, inCode) => {
    if (typeof v === 'string') return DIGEST.test(v) && (inCode || /Sha256$/.test(key) || key === 'sha256') ? '<sha256>' : v;
    if (Array.isArray(v)) return v.map(x => walk(x, '', false));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, MODEL_SUBTREES.has(k) ? x : walk(x, k, k === 'code')]));
    return v;
  };
  return walk(value, '', false);
}
const setAt = (o, path, value) => { const last = path.at(-1); const parent = path.slice(0, -1).reduce((v, k) => v?.[k], o); if (parent && typeof parent === 'object') parent[last] = value; };
/**
 * Scrub (EXP 006 scrubPaths6: run dirs, temp roots, home) and lint (paths, credentials, the session uid, restricted terms).
 * A field that still leaks is replaced by a marker and listed under j7Withheld (its raw sha256 stays); a record that
 * leaks after that is refused.
 */
export function publicCensusRecord(rec, name) {
  const scrubbed = JSON.parse(scrubPaths6(JSON.stringify(rec)));
  const masked = maskDigests(scrubbed);
  if (!lint6(JSON.stringify(masked, null, 2), name).length) return scrubbed;
  const leaks = leakFields(masked);
  for (const p of leaks) setAt(scrubbed, p.split('.'), '<withheld: J7>');
  scrubbed.j7Withheld = [...(scrubbed.j7Withheld ?? []), ...leaks];
  const findings = lint6(JSON.stringify(maskDigests(scrubbed), null, 2), name);
  if (findings.length) throw new Error(`${name}: refusing to write a record that leaks: ${[...new Set(findings)].slice(0, 5).join('; ')}`);
  return scrubbed;
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

// ----------------------------------------------------------------------------- the lock

/** Takes the exclusive run lock (O_EXCL) or throws; returns the release. */
export function acquireRunLock(path) {
  let fd;
  try { fd = openSync(path, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`another census runner holds ${LOCK} (${readFileSync(path, 'utf8').trim() || 'no content'}); if none is running, the operator checks and removes it`);
    throw error;
  }
  const token = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  try { writeFileSync(fd, `${token}\n`); } finally { closeSync(fd); }
  return () => { if (existsSync(path) && readFileSync(path, 'utf8').trim() === token) unlinkSync(path); };
}

// ----------------------------------------------------------------------------- one metered call

/**
 * One metered call: spend check, clock, intent line, spawn in a fresh run dir, the ledger line FIRST from the spawn
 * result, then the intent cleared. Returns {stop} or {spawn, line, parsed, model, command}.
 */
async function meteredCall(ctx, { kind, ruleId, role, user }) {
  const { ledger, claudeBin, prereg, root, rehearsal, timeoutMs, stamp } = ctx;
  const guard = ledger.check(role);
  if (!guard.ok) { const { reason, ok: _ok, ...rest } = guard; return { stop: ['spend', { limit: reason, ...rest }] }; }
  if (!(Date.now() > Date.parse(stamp.notBefore))) return { stop: ['clock', { now: new Date().toISOString() }] };
  const callId = `${kind}:${ruleId}:${role}:${Date.now()}:${process.pid}`;
  try { ledger.writeIntent({ callId, kind, ruleId, role }); } catch (error) { return { stop: ['intent-write', { error: String(error.message).slice(0, 200) }] }; }
  const pin = modelOf(prereg, role);
  const args = censusArgs(prereg, role, root);
  let runDir = null, s;
  try { runDir = makeRunDir(); } catch (error) { s = { exitCode: null, error: error.message, timedOut: false, stdout: '', stderr: '', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), latencyMs: 0 }; }
  if (!s) s = await spawnClaude(claudeBin, args, { cwd: runDir, env: childEnv7(process.env, runDir), input: user, timeoutMs });
  const reported = reportedCost(s);
  let line;
  try {
    line = ledger.record({ ts: s.endedAt, kind, ruleId, role, model: pin, reportedCostUsd: reported, rehearsal, callId });
    ledger.clearIntent(callId);
  } catch (error) {
    try { ledger.recordPending({ failedWrite: true, callId, kind, ruleId, role, reportedCostUsd: reported, ts: s.endedAt, error: String(error.message).slice(0, 200) }); } catch { /* the intent line stays pending */ }
    if (runDir) rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return { stop: ['ledger-write', { ruleId, role, error: String(error.message).slice(0, 200) }] };
  }
  let runDirNotRemoved = null;
  if (runDir) { try { rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (error) { runDirNotRemoved = error.code ?? 'error'; } }
  const parsed = parseClientOutput(s);
  return { spawn: s, line, parsed, model: modelCheck(parsed.out, pin), command: renderCommand(args, root), runDirNotRemoved };
}

/** The facts of one call a record keeps; `raw` is the model's text before the J7 scrub (rawSha256 is computed from it). */
function callFacts(call, pin) {
  const { spawn: s, line, parsed, model } = call;
  const raw = typeof parsed.out?.result === 'string' ? parsed.out.result : null;
  return {
    called: true, model: pin, modelUsage: model.keys, command: call.command,
    startedAt: s.startedAt, endedAt: s.endedAt, latencyMs: Math.round(s.latencyMs), exitCode: s.exitCode, timedOut: s.timedOut,
    harnessFailure: parsed.harnessFailure ?? (model.ok ? null : 'model-mismatch'),
    durationMs: parsed.out?.duration_ms ?? null, numTurns: parsed.out?.num_turns ?? null,
    costUsd: line.costUsd, costBasis: line.costBasis, reportedCostUsd: line.reportedCostUsd, callId: line.callId,
    stdoutSha256: sha256(s.stdout), raw, rawSha256: raw === null ? null : sha256(raw),
    stderrTail: s.stderr ? s.stderr.trim().split('\n').slice(-5).join('\n') : '',
    ...(call.runDirNotRemoved ? { runDirNotRemoved: call.runDirNotRemoved } : {}),
  };
}

const MECH_KEYS = ['translatorClass', 'classAfterMechanical', 'schemaOk', 'errors', 'fenced', 'vocabularyOk', 'validate', 'teeth', 'flags', 'failedCheck', 'engineLimit', 'maxClass', 'unverifiableFlags'];
/** The mechanical checks (pinned protocol.mjs), never throwing: an exception in them is a harness failure, class error. */
async function mechanical(rule, raw) {
  try {
    const m = await mechanicalChecks(rule, raw);
    const out = Object.fromEntries(MECH_KEYS.filter(k => k in m).map(k => [k, m[k]]));
    if (out.validate) out.validate = { ...out.validate, messageSha256: sha256(out.validate.message ?? '') };
    return out;
  } catch (error) {
    return { translatorClass: 'error', classAfterMechanical: 'error', schemaOk: false, errors: [`mechanical checks threw: ${String(error.message).slice(0, 200)}`], failedCheck: 'harness', engineLimit: false };
  }
}

/** The translator step: one call, then the mechanical checks. Returns {stop} or {translator, translatorError}. */
async function translatorStep(ctx, rule, kind) {
  const user = buildTranslatorPrompt(rule).user;
  const call = await meteredCall(ctx, { kind, ruleId: rule.ruleId, role: 'translator', user });
  if (call.stop) return call;
  const facts = callFacts(call, modelOf(ctx.prereg, 'translator'));
  facts.userSha256 = sha256(user);
  if (facts.harnessFailure) return { translator: { ...facts, translatorClass: 'error', classAfterMechanical: 'error', schemaOk: false, failedCheck: 'harness', engineLimit: false, mechanical: null }, translatorError: facts.harnessFailure };
  const m = await mechanical(rule, facts.raw);
  const translator = { ...facts, translatorClass: m.translatorClass, classAfterMechanical: m.classAfterMechanical, failedCheck: m.failedCheck ?? null, engineLimit: Boolean(m.engineLimit), schemaOk: m.schemaOk, mechanical: m };
  return { translator, translatorError: m.classAfterMechanical === 'error' ? `the translator's answer is not a JSON object with a valid class (${(m.errors ?? []).join('; ').slice(0, 200)})` : null };
}

/** The adjudicator step on a translator answer (verbatim raw text). Returns {stop} or {adjudicator, adjudicatorError}. */
async function adjudicatorStep(ctx, rule, kind, translator) {
  const user = buildAdjudicatorPrompt(rule, translator.raw, translator.mechanical).user;
  const call = await meteredCall(ctx, { kind, ruleId: rule.ruleId, role: 'adjudicator', user });
  if (call.stop) return call;
  const facts = callFacts(call, modelOf(ctx.prereg, 'adjudicator'));
  facts.userSha256 = sha256(user);
  if (facts.harnessFailure) return { adjudicator: { ...facts, parsed: null, schemaOk: false, errors: [facts.harnessFailure], verdict: null, proposedClass: null }, adjudicatorError: facts.harnessFailure };
  const p = parseAnswer(facts.raw);
  const v = p.ok ? validateAdjudicatorOutput(p.value, rule) : { ok: false, errors: [p.error] };
  const adjudicator = { ...facts, parsed: p.ok ? p.value : null, fenced: p.ok ? p.fenced : null, schemaOk: v.ok, errors: v.errors, verdict: v.ok ? p.value.verdict : null, proposedClass: v.ok ? p.value.proposedClass : null };
  return { adjudicator, adjudicatorError: v.ok ? null : `the adjudicator's answer does not fit its schema (${v.errors.join('; ').slice(0, 200)})` };
}

// ----------------------------------------------------------------------------- the invocation

/** One invocation. A metered one (practice, counted) holds the exclusive run lock throughout. */
export async function runCensus(opts) {
  if (opts?.mode === 'rehearsal') return runInvocation(opts);
  const release = acquireRunLock(join(opts?.root ?? REPO_ROOT, LOCK));
  try { return await runInvocation(opts); } finally { release(); }
}

const stampFields = stamp => ({ preregSha256: stamp.preregSha256, notBefore: stamp.notBefore, served: stamp.served, code: stamp.code, codeMatchesPins: stamp.codeMatchesPins });

async function runInvocation({ mode, rehearsalOf = 'counted', root = REPO_ROOT, outDir, ledgerPath, practicePath, only = null, now, freeze, fetch, tracked, timeoutMs, log = console.log } = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  const rehearsal = mode === 'rehearsal';
  if (rehearsal && !['practice', 'counted'].includes(rehearsalOf)) throw new Error('a rehearsal rehearses the practice or the counted path');
  if (!rehearsal && (outDir !== undefined || ledgerPath !== undefined || practicePath !== undefined || only !== null || timeoutMs !== undefined || rehearsalOf !== 'counted')) throw new Error('a practice or counted run writes the committed records and ledger with the pinned timeout over the whole census; scratch paths, subsets and other timeouts are for rehearsals');
  // A metered run takes the real clock, the committed freeze, the real served-record fetch and git's tracked check: an
  // injected stand-in for any of them is for a rehearsal only (it could otherwise bypass J1).
  if (!rehearsal && (now !== undefined || freeze !== undefined || fetch !== undefined || tracked !== undefined)) throw new Error('a practice or counted run cannot take an injected clock, freeze, fetch or tracked check');
  if (rehearsal) {
    for (const [name, p] of Object.entries({ outDir, ledgerPath, practicePath })) {
      if (!p) throw new Error(`a rehearsal needs a scratch ${name}`);
      if (resolve(p).startsWith(resolve(root, DIR))) throw new Error(`a rehearsal never writes under ${DIR} (${name})`);
    }
  }
  const out = outDir ?? join(root, RECORDS_DIR);
  const ledgerFile = ledgerPath ?? join(root, LEDGER);
  const practiceFile = practicePath ?? join(root, PRACTICE_RECORD);
  const path = rehearsal ? rehearsalOf : mode;

  // The guard first (tests see its refusals), then the defence in depth: no metered call under the test runner.
  const stamp = await checkCensusRun({ mode, root, ledgerPath: ledgerFile, ...(now ? { now } : {}), ...(freeze ? { freeze } : {}), ...(fetch ? { fetch } : {}), ...(tracked ? { tracked } : {}) });
  if (!rehearsal) refuseUnderTestRunner();
  const billed = billedInEnv();
  if (!rehearsal && billed.length) throw new Error(`API-billing variables are set (${billed.join(', ')}): the census runs under subscription auth only`);
  const prereg = stamp.prereg;
  const claudeBin = chooseClaude7(rehearsal, process.env.PATH);
  const version = clientVersion(claudeBin);
  if (version !== prereg.calls.clientVersion) throw new Error(`claude --version is ${version}, not the pinned ${prereg.calls.clientVersion}`);

  const all = censusRules(root);
  if (all.length !== prereg.census.rules) throw new Error(`the census has ${all.length} rules, not the pre-registered ${prereg.census.rules}`);
  const practice = practiceRule(root);
  assertOpaqueIdsDistinct([...all.map(r => r.ruleId), practice.ruleId]);
  const ledger = new CensusLedger(ledgerFile);
  const ctx = { ledger, claudeBin, prereg, root, rehearsal, timeoutMs: timeoutMs ?? CALL_TIMEOUT_MS, stamp };
  const header = { experiment: 'EXP 007', mode: path === 'practice' ? 'practice' : 'counted', rehearsal, fixture: false, ...(rehearsal ? { banner: 'REHEARSAL: the fake client stands in for the models; not a measurement and never publishable' } : {}), clientVersion: version, ...stampFields(stamp) };

  if (path === 'practice') return runPractice(ctx, { header, all, practice, practiceFile, log });
  return runCounted(ctx, { header, all, out, practiceFile, only, log });
}

/** The practice path (WO-2-03, R6-1, R6-3): the two canaries, then the practice pair, then the projection. */
async function runPractice(ctx, { header, all, practice, practiceFile, log }) {
  if (existsSync(practiceFile)) throw new Error('a practice record already exists; the ledger keeps every practice line, so the operator moves it aside after checking before another practice run');
  const rec = { schemaVersion: 1, kind: 'census-practice', ...header, startedAt: new Date().toISOString(), endedAt: null, canary: {}, practice: null, projection: null, askFork: null, partial: { reason: 'in-progress' } };
  const save = () => { rec.endedAt = new Date().toISOString(); writeJson(practiceFile, publicCensusRecord(rec, 'practice record')); };
  const stopFor = (reason, detail) => { rec.partial = { reason, ...detail }; rec.askFork = true; log(`STOP: ${reason}`); save(); return rec; };
  const terms = [...CANARY_BASE_TERMS, ...all.map(r => r.ruleId)];
  const prompt = canaryPrompt(ctx.root);
  for (const role of ROLES) {
    const call = await meteredCall(ctx, { kind: 'canary', ruleId: 'canary', role, user: prompt });
    if (call.stop) return stopFor(...call.stop);
    const facts = callFacts(call, modelOf(ctx.prereg, role));
    const verdict = facts.harnessFailure ? { pass: false, reason: `harness failure: ${facts.harnessFailure}`, hits: [] } : canaryVerdict(facts.raw, terms);
    rec.canary[role] = { ...facts, promptSha256: sha256(prompt), pass: verdict.pass, reason: verdict.reason, hits: verdict.hits };
    save();
    if (!verdict.pass) return stopFor('canary', { role, hits: verdict.hits });
  }
  const t = await translatorStep(ctx, practice, 'practice');
  if (t.stop) return stopFor(...t.stop);
  rec.practice = { ruleId: practice.ruleId, translator: t.translator, translatorError: t.translatorError, adjudicator: null, adjudicatorError: null };
  save();
  if (t.translatorError) return stopFor('practice-translator-error', { error: t.translatorError });
  const a = await adjudicatorStep(ctx, practice, 'practice', t.translator);
  if (a.stop) return stopFor(...a.stop);
  Object.assign(rec.practice, { adjudicator: a.adjudicator, adjudicatorError: a.adjudicatorError });
  rec.projection = projection({ rules: all.length, pairCostUsd: t.translator.costUsd + a.adjudicator.costUsd, spentUsd: ctx.ledger.total() });
  rec.askFork = rec.projection.askFork;
  rec.partial = null;
  save();
  log(`practice: canaries PASS; projection $${rec.projection.totalUsd.toFixed(7)} vs ceiling $${rec.projection.ceilingUsd}${rec.askFork ? ' -> ASK-FORK' : ''}`);
  return rec;
}

/** The counted census (or its rehearsal). Resumes per (ruleId, role): a pair with a ledger line is never called again. */
async function runCounted(ctx, { header, all, out, practiceFile, only, log }) {
  // The canaries and the pre-count come first (WO-2-03): a counted run needs the practice record, passed, on this code.
  if (!existsSync(practiceFile)) throw new Error('no practice record: run --mode practice (the canaries and the pre-count) first');
  const pr = JSON.parse(readFileSync(practiceFile, 'utf8'));
  if (pr.partial !== null || pr.askFork !== false || !ROLES.every(r => pr.canary?.[r]?.pass === true)) throw new Error('the practice record did not pass (canary, practice pair or projection): ASK-FORK before any counted call');
  if (pr.rehearsal !== ctx.rehearsal || pr.preregSha256 !== header.preregSha256 || JSON.stringify(pr.code) !== JSON.stringify(header.code)) throw new Error('the practice record was made under other code or another pre-registration');

  const rules = only ? all.filter(r => only.includes(r.ruleId)) : all;
  if (only && !ctx.rehearsal) throw new Error('a counted run covers the whole census');
  const invocation = { startedAt: new Date().toISOString(), endedAt: null, mode: header.mode, rehearsal: ctx.rehearsal, firstRuleId: null, called: 0, completed: 0, skipped: 0, resumed: [], partial: null };
  const runsLog = join(out, 'runs.jsonl');
  const finishInvocation = partial => { invocation.endedAt = new Date().toISOString(); invocation.partial = partial; mkdirSync(out, { recursive: true }); appendFileSync(runsLog, `${JSON.stringify(publicCensusRecord(invocation, 'run log line'))}\n`); return invocation; };
  const stopFor = (reason, detail) => { log(`STOP: ${reason}`); return finishInvocation({ reason, ...detail }); };
  const isCalled = (ruleId, role) => ctx.ledger.called('counted', ruleId, role, { rehearsal: ctx.rehearsal });

  for (const rule of rules) {
    const recPath = join(out, `${rule.ruleId}.json`);
    const prior = existsSync(recPath) ? JSON.parse(readFileSync(recPath, 'utf8')) : null;
    if (prior?.complete === true) { invocation.skipped += 1; continue; }
    if (prior && JSON.stringify(prior.code) !== JSON.stringify(header.code)) return stopFor('code-changed', { ruleId: rule.ruleId });
    const tLine = isCalled(rule.ruleId, 'translator'), aLine = isCalled(rule.ruleId, 'adjudicator');
    const resumed = Boolean(prior || tLine || aLine);
    if (resumed) invocation.resumed.push(rule.ruleId);
    invocation.firstRuleId ??= rule.ruleId;
    const rec = prior ?? { schemaVersion: 1, kind: 'census-record', ...header, ruleId: rule.ruleId, plugin: rule.plugin, stratum: rule.stratum, startedAt: null, endedAt: null, translator: null, adjudicator: null, translatorError: null, adjudicatorError: null, final: null, complete: false, resumed: false };
    rec.resumed = rec.resumed || resumed;
    const save = () => writeJson(recPath, publicCensusRecord(rec, `census record ${rule.ruleId}`));
    let raw = null; // the translator's verbatim text for the adjudicator, from this invocation or a scrub-free record

    if (!rec.translator) {
      if (tLine) {
        // The call was made and charged, but its record was lost (an interruption between the ledger line and the write).
        rec.translator = { called: true, lost: true, model: tLine.model, costUsd: tLine.costUsd, costBasis: tLine.costBasis, reportedCostUsd: tLine.reportedCostUsd, callId: tLine.callId, startedAt: tLine.ts, endedAt: tLine.ts, translatorClass: 'error', classAfterMechanical: 'error', failedCheck: 'harness', engineLimit: false };
        rec.translatorError = 'the record of a charged translator call was lost after an interruption (never re-called)';
      } else {
        const t = await translatorStep(ctx, rule, 'counted');
        if (t.stop) return stopFor(...t.stop);
        invocation.called += 1;
        rec.translator = t.translator;
        rec.translatorError = t.translatorError;
        raw = t.translator.raw;
      }
      rec.startedAt = rec.translator.startedAt;
      save();
    } else if (typeof rec.translator.raw === 'string' && rec.translator.rawSha256 === sha256(rec.translator.raw)) raw = rec.translator.raw;

    if (!rec.adjudicator) {
      if (rec.translatorError) rec.adjudicator = { called: false, reason: 'the translator call ended in error, so there is no answer to adjudicate' };
      else if (aLine) {
        rec.adjudicator = { called: true, lost: true, model: aLine.model, costUsd: aLine.costUsd, costBasis: aLine.costBasis, reportedCostUsd: aLine.reportedCostUsd, callId: aLine.callId, startedAt: aLine.ts, endedAt: aLine.ts, verdict: null, proposedClass: null };
        rec.adjudicatorError = 'the record of a charged adjudicator call was lost after an interruption (never re-called)';
      } else if (raw === null) {
        rec.adjudicator = { called: false, reason: 'the translator answer could not be recovered verbatim after an interruption' };
        rec.adjudicatorError = 'not adjudicated: the translator answer was not recoverable verbatim after an interruption';
      } else {
        const a = await adjudicatorStep(ctx, rule, 'counted', { ...rec.translator, raw });
        if (a.stop) { save(); return stopFor(...a.stop); }
        invocation.called += 1;
        rec.adjudicator = a.adjudicator;
        rec.adjudicatorError = a.adjudicatorError;
      }
    }
    rec.endedAt = rec.adjudicator.endedAt ?? rec.translator.endedAt;
    rec.final = finalClass(rec);
    rec.complete = true;
    save();
    invocation.completed += 1;
    log(`${rule.ruleId}: ${rec.final.final}${ctx.ledger ? ` (ledger $${ctx.ledger.total().toFixed(7)})` : ''}`);
  }
  return finishInvocation(null);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : null;
  if (!['practice', 'counted'].includes(mode)) { console.error('usage: census-run.mjs --mode practice|counted'); process.exit(2); }
  try {
    const result = await runCensus({ mode });
    console.log(JSON.stringify({ ok: !result.partial, partial: result.partial ?? null, askFork: result.askFork ?? null }));
    process.exit(result.partial ? 3 : result.askFork ? 4 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
