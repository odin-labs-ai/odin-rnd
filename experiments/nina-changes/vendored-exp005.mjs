// EXP 006 R3-1 / R4-1: BYTE-IDENTICAL copies of the module-private EXP 005 symbols EXP 006 needs, so the EXP 005
// files are not edited to export them. Each declaration below is exactly the text of the same declaration in
// experiments/jev-gate/run_reviewer.mjs or results.mjs at odin-rnd b2dbb1fd (committed as fixtures under
// fixtures/exp005-b2dbb1fd/ with their sha256, which equal EXP 005's runners.sha256 pins); a slice test per symbol
// asserts it. Nothing here may be edited: a change belongs in a new EXP 006 function, never in a copy.
//
// From run_reviewer.mjs: GIT_FLAGS (:38), GIT_ENV (:40), run (:249), gitgit (:270), spawnTimed (:368),
// hookContext (:402). The private symbols they reach are run, GIT_FLAGS and GIT_ENV (all here); BASE_IDENTITY and
// sha256 are EXP 005 exports and are imported. From results.mjs: coverageGap (:241), which reaches nothing private.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BASE_IDENTITY } from '../jev-gate/run_reviewer.mjs';
import { sha256 } from '../jev-gate/runner-guard.mjs';

const GIT_FLAGS = ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { cmd: [cmd, ...args].join(' '), exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error?.message };
};

function gitgit(repo) {
  return (...args) => run('git', [...GIT_FLAGS, ...args], { cwd: repo, env: { ...process.env, ...GIT_ENV, ...BASE_IDENTITY } });
}

function spawnTimed(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise(resolvePromise => {
    const startedAt = new Date();
    const t0 = performance.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    const done = (exitCode, error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, error, timedOut, stdout, stderr, startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), latencyMs: performance.now() - t0 });
    };
    child.on('error', e => done(null, e.message));
    child.on('close', code => done(code, null));
  });
}

function hookContext(repo, parent) {
  const hook = join(repo, 'scripts', 'harness-check.mjs');
  if (!existsSync(hook)) return { ran: false };
  // The hook's own timeout, as nina wrote it into the composed .claude/settings.json.
  const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
  const entry = (settings.hooks?.UserPromptSubmit ?? []).flatMap(h => h.hooks ?? []).find(h => /harness-check\.mjs.*--context/.test(h.command ?? ''));
  if (!entry?.timeout) return { ran: false, note: 'no harness-check --context hook with a timeout in .claude/settings.json' };
  const t0 = performance.now();
  const r = run(process.execPath, [hook, '--context'], { cwd: repo, env: { ...process.env, ...GIT_ENV, CLAUDE_PROJECT_DIR: repo, NINA_DATA: join(parent, 'nina-data-hook') }, timeout: entry.timeout * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
  let context = null;
  try { context = JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? null; } catch { /* recorded as text */ }
  const text = context ?? r.stdout;
  return { ran: true, timeoutSeconds: entry.timeout, exit: r.exit, durationMs: Math.round(performance.now() - t0), timedOut: r.exit === null, sha256: sha256(text), text, error: r.exit !== 0 || /could not start/.test(text) || /"error"/.test(r.stdout) };
}

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

export { GIT_FLAGS, GIT_ENV, run, gitgit, spawnTimed, hookContext, coverageGap };
