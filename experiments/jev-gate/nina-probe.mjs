// EXP 005 amendment 01, WO-2b-01: the zero-patch structural probe of nina 0.34.0. No model is called.
// It builds the reviewer's workspace exactly as the runner will (REVISION-5 §5.3 "Per-run workspace
// order", steps 1-10), from the unmodified published package, twice, and records every command, its
// exit code, every file nina wrote and the exact text each hook hands a run. Nothing it records may
// need a patch; the record says so or names the step.
//   node experiments/jev-gate/nina-probe.mjs            write experiments/jev-gate/nina-probe-0.34.0.json
//   NINA_TARBALL=<file> overrides the cached tarball (default ~/.cache/odin-rnd/nina/nina-0.34.0.tgz).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(repo, 'experiments/jev-gate');
export const outPath = 'experiments/jev-gate/nina-probe-0.34.0.json';
export const pin = {
  package: '@xhulz/nina', version: '0.34.0',
  tarball: 'https://registry.npmjs.org/@xhulz/nina/-/nina-0.34.0.tgz',
  integrity: 'sha512-M/Vtu9DGe931tYBA+jJ60LtSiFGnu0y7fNBUYZEIXbMbji70aBVRvleOTpq6N8MceW0lXbeIvkDA94QM91fUjg==',
  commit: 'be546e32ce30acb2a18ec9b55ff4a3b23a7b4890', repoTree: 'a3b25852cd8616947f5a66153b1a25b1fa8a566d', releaseTree: 'b11435f6064634ea00693b7bde844dc263b91327',
};
export const initArgs = ['init', '--project', '.', '--core', '0.34.0', '--surfaces', '', '--no-ask'];
export const composeArgs = ['compose', '--project', '.'];
export const gitignore = 'node_modules/\n';
export const baseIdentity = { GIT_AUTHOR_NAME: 'base', GIT_AUTHOR_EMAIL: 'base@example.invalid', GIT_COMMITTER_NAME: 'base', GIT_COMMITTER_EMAIL: 'base@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
export const gitBaseConfig = ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
// The parent's reviewer prompt, verbatim: the prompt hook receives it as the run's prompt.
const reviewerPrompt = JSON.parse(readFileSync(join(dir, 'preregistration.json'), 'utf8')).gates.reviewer.prompt;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tarball = process.env.NINA_TARBALL ?? join(homedir(), '.cache/odin-rnd/nina/nina-0.34.0.tgz');

// Private paths never reach the record: each is replaced by a stable name.
const names = [];
const scrub = text => names.reduce((t, [path, name]) => t.split(path).join(name), String(text));

function run(cwd, file, args, { env = {}, input, label, shell = false } = {}) {
  const started = Date.now();
  const result = spawnSync(file, args, { cwd, env: { ...process.env, NO_COLOR: '1', ...env }, input: input ?? '', encoding: 'utf8', shell, timeout: 120_000 });
  return { label, command: scrub(shell ? file : [file.startsWith('/') ? relative(cwd, file) : file, ...args.map(a => (a === '' ? "''" : a))].join(' ')), stdinIsTTY: false, exitCode: result.status, signal: result.signal, ms: Date.now() - started, stdout: scrub(result.stdout), stderr: scrub(result.stderr) };
}
const git = (cwd, args, env = {}) => run(cwd, 'git', [...gitBaseConfig, ...args], { env: { ...baseIdentity, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env } });

function tree(root, skip = new Set()) {
  const out = {};
  const walk = rel => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip.has(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isSymbolicLink()) out[path] = `symlink:${readlinkSync(join(root, path))}`;
      else out[path] = sha256(readFileSync(join(root, path)));
    }
  };
  walk('');
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
const delta = (before, after) => ({
  added: Object.keys(after).filter(f => !(f in before)),
  changed: Object.keys(after).filter(f => f in before && before[f] !== after[f]),
  removed: Object.keys(before).filter(f => !(f in after)),
});

// The tarball, verified against the pinned integrity before any use.
function verifyTarball() {
  assert(existsSync(tarball), `No cached tarball: curl -sSfL -o ${tarball} ${pin.tarball}`);
  const bytes = readFileSync(tarball);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrity, pin.integrity, 'The cached tarball does not match the pinned dist.integrity');
  return { url: pin.tarball, integrity, sha256: sha256(bytes), bytes: bytes.length, verifiedBeforeUse: true };
}

// The package's releases/0.34.0 hashed as a git tree, compared with the pinned release tree of the nina repository.
function releaseTreeOf(pkg) {
  const scratch = mkdtempSync(join(tmpdir(), 'nina-release-tree-'));
  try {
    cpSync(join(pkg, 'releases', pin.version), scratch, { recursive: true });
    for (const step of [['init', '-q'], ['add', '-A'], ['write-tree']]) {
      const r = spawnSync('git', step, { cwd: scratch, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
      assert.equal(r.status, 0, r.stderr);
      if (step[0] === 'write-tree') return r.stdout.trim();
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

// One workspace, REVISION-5 §5.3 steps 1-10. Returns what every step did.
export async function buildWorkspace(label) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `jev-gate-nina-probe-${label}-`)));
  const ws = join(root, 'ws'), ninaData = join(root, 'nina-data');
  mkdirSync(ninaData);
  names.push([ws, '<workspace>'], [ninaData, '<nina-data>'], [root, '<run-dir>'], [ws.replaceAll('/', '-'), '<workspace-key>']);
  const steps = [], patches = [], manualAnswers = [];
  // 1. The base app, copied into a fresh directory outside the repository.
  cpSync(join(dir, 'base'), ws, { recursive: true });
  const base = tree(ws);
  steps.push({ step: 1, what: 'copy experiments/jev-gate/base into a fresh temp dir outside the repository', files: Object.keys(base).length });
  // 2. nina installed by extraction; node_modules must hold nothing else.
  mkdirSync(join(ws, 'node_modules/@xhulz/nina'), { recursive: true });
  const extract = run(ws, 'tar', ['-xzf', '<tarball>', '-C', 'node_modules/@xhulz/nina', '--strip-components=1'].map(a => (a === '<tarball>' ? tarball : a)));
  extract.command = 'tar -xzf <tarball> -C node_modules/@xhulz/nina --strip-components=1';
  mkdirSync(join(ws, 'node_modules/.bin'));
  symlinkSync('../@xhulz/nina/bin/nina.mjs', join(ws, 'node_modules/.bin/nina'));
  const nodeModules = { top: readdirSync(join(ws, 'node_modules')).sort(), scope: readdirSync(join(ws, 'node_modules/@xhulz')).sort(), bin: readdirSync(join(ws, 'node_modules/.bin')).sort() };
  assert.deepEqual(nodeModules, { top: ['.bin', '@xhulz'], scope: ['nina'], bin: ['nina'] }, 'node_modules holds more than @xhulz/nina and .bin/nina');
  const pkg = join(ws, 'node_modules/@xhulz/nina');
  const installedVersion = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  assert.equal(installedVersion, pin.version);
  const wiring = await import(pathToFileURL(join(pkg, 'src/wiring.mjs')).href);
  const packageInstalled = wiring.packageInstalled(ws);
  assert.equal(packageInstalled, true, 'nina packageInstalled does not resolve the extracted package');
  const releaseTree = releaseTreeOf(pkg);
  steps.push({ step: 2, what: 'install nina by extraction of the verified tarball', commands: [extract, { command: 'mkdir -p node_modules/.bin && ln -s ../@xhulz/nina/bin/nina.mjs node_modules/.bin/nina', exitCode: 0 }], nodeModules, installedVersion, packageInstalled, releaseTree, releaseTreeMatchesPin: releaseTree === pin.releaseTree });
  const nina = join(ws, 'node_modules/.bin/nina');
  const env = { NINA_DATA: ninaData };
  const project = () => tree(ws, new Set(['node_modules']));
  // 3. init, exact pre-registered flags, stdin not a TTY.
  const beforeInit = project();
  const init = run(ws, nina, initArgs, { env });
  assert.equal(init.exitCode, 0, `nina init failed: ${init.stderr}`);
  const afterInit = project();
  const profile = JSON.parse(readFileSync(join(ws, '.nina/profile.json'), 'utf8'));
  assert.deepEqual(profile.surfaces, [], 'profile.surfaces must be []');
  steps.push({ step: 3, what: 'nina init with the pre-registered flags', commands: [init], written: delta(beforeInit, afterInit), profile, todoSha256: afterInit['.nina/TODO.md'], packageJsonDelta: JSON.parse(readFileSync(join(ws, 'package.json'), 'utf8')).scripts });
  // 4. Vocabulary, project slots and owed documents: left as init wrote them (pre-registered). Nothing is written.
  steps.push({ step: 4, what: 'vocabulary, project slots and owed documents left unfilled, as pre-registered', written: [] });
  // 5. compose (init already wired and composed); then check and wire, both read-only, to record what they say.
  const beforeCompose = project();
  const compose = run(ws, nina, composeArgs, { env });
  const afterCompose = project();
  const check = run(ws, nina, ['check', '--project', '.'], { env });
  const wire = run(ws, nina, ['wire', '--project', '.'], { env });
  assert.deepEqual(project(), afterCompose, 'nina check or wire (without --apply) wrote a file');
  steps.push({ step: 5, what: 'nina compose; then nina check and nina wire (no --apply), recorded only', commands: [compose, check, wire], written: delta(beforeCompose, afterCompose) });
  // 6-7. .gitignore and rules.txt.
  writeFileSync(join(ws, '.gitignore'), gitignore);
  cpSync(join(dir, 'rules.txt'), join(ws, 'rules.txt'));
  steps.push({ step: 6, what: 'write .gitignore', bytes: gitignore });
  steps.push({ step: 7, what: 'write rules.txt', sha256: sha256(readFileSync(join(ws, 'rules.txt'))) });
  // 8. The base commit, pinned identity and date.
  const commits = [git(ws, ['init', '-q']), git(ws, ['add', '-A']), git(ws, ['commit', '-q', '-m', 'base']), git(ws, ['rev-parse', 'HEAD'])];
  commits.forEach(c => assert.equal(c.exitCode, 0, `${c.command}: ${c.stderr}`));
  const baseSha = commits[3].stdout.trim();
  const baseFiles = git(ws, ['ls-files']).stdout.trim().split('\n');
  assert(!baseFiles.some(f => f.startsWith('node_modules/')), 'node_modules is in the base commit');
  steps.push({ step: 8, what: 'git init, add -A, commit -m base, pinned identity and date', commands: commits.map(c => ({ ...c, command: `${Object.entries(baseIdentity).map(([k, v]) => `${k}=${v}`).join(' ')} ${c.command}` })), baseSha, baseFiles });
  // 10 before 9: the hooks on the clean base, then 9: the change applied and left uncommitted, then the hooks again.
  const settings = JSON.parse(readFileSync(join(ws, '.claude/settings.json'), 'utf8'));
  const hooks = on => (settings.hooks[on] ?? []).flatMap(group => group.hooks.map(h => ({ event: on, matcher: group.matcher ?? null, command: h.command, timeout: h.timeout })));
  const fire = (event, payload, session) => hooks(event).filter(h => !payload.tool_name || !h.matcher || new RegExp(`^(${h.matcher})$`).test(payload.tool_name)).map(h => {
    const input = JSON.stringify({ session_id: session, transcript_path: join(root, `${session}.jsonl`), cwd: ws, permission_mode: 'dontAsk', hook_event_name: event, ...payload });
    const r = run(ws, h.command, [], { env: { ...env, CLAUDE_PROJECT_DIR: ws }, input, shell: true });
    let parsed = null; try { parsed = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { parsed = 'unparseable'; }
    return { event, matcher: h.matcher, timeoutSeconds: h.timeout, exitCode: r.exitCode, ms: r.ms, exceededTimeout: r.ms > h.timeout * 1000, stdout: r.stdout, stderr: r.stderr, additionalContext: parsed?.hookSpecificOutput?.additionalContext ?? null, systemMessage: parsed?.systemMessage ?? null, couldNotStart: /could not start/.test(r.stdout) };
  });
  const turn = session => ({
    userPromptSubmit: fire('UserPromptSubmit', { prompt: reviewerPrompt }, session),
    postToolUseRead: fire('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(ws, 'rules.txt') }, tool_response: {} }, session),
    stop: fire('Stop', { stop_hook_active: false }, session),
  });
  const cleanBase = turn('probe-clean-base');
  const statusAfterHooks = git(ws, ['status', '--porcelain', '--untracked-files=all']).stdout;
  const apply = git(ws, ['apply', join(dir, 'probe/practice-probe.patch')]);
  apply.command = 'git apply experiments/jev-gate/probe/practice-probe.patch';
  assert.equal(apply.exitCode, 0, apply.stderr);
  const practice = turn('probe-practice-diff');
  const status = git(ws, ['status', '--porcelain', '--untracked-files=all']).stdout;
  steps.push({ step: 9, what: 'git apply the probe practice diff and leave it uncommitted', commands: [apply], gitStatus: status });
  steps.push({ step: 10, what: 'NINA_DATA set to a per-run temp dir', ninaData: '<nina-data>', ninaDataWritten: Object.keys(tree(ninaData)).map(scrub) });
  return { root, ws, baseSha, baseFiles, steps, patches, manualAnswers, hooks: { declared: Object.keys(settings.hooks).flatMap(hooks), cleanBase, practice, workspaceWrittenByHooksOnCleanBase: statusAfterHooks } };
}

export async function probe() {
  const started = new Date().toISOString();
  names.push([tarball, '<tarball>'], [homedir(), '~']);
  const tar = verifyTarball();
  const a = await buildWorkspace('a');
  const b = await buildWorkspace('b');
  const sameBase = a.baseSha === b.baseSha;
  const context = r => r.hooks.cleanBase.userPromptSubmit.map(h => h.additionalContext);
  const record = {
    schemaVersion: 1,
    kind: 'nina-probe',
    what: 'WO-2b-01 zero-patch structural probe: nina 0.34.0 composed into a scratch copy of the jev-gate base app from the unmodified published package, exactly as the reviewer runner will build each workspace. No model was called; $0.',
    date: started.slice(0, 10), startedAt: started, finishedAt: new Date().toISOString(),
    node: process.version, platform: process.platform,
    pin, tarball: tar,
    order: 'REVISION-5 §5.3 per-run workspace order, steps 1-10; step 11 (claude -p) is not run by the probe. The whole workspace was built twice (a, b) to assert the base sha.',
    baseSha: a.baseSha, baseShaIdenticalAcrossWorkspaces: sameBase,
    patchesNeeded: [...a.patches, ...b.patches],
    manualAnswers: [...a.manualAnswers, ...b.manualAnswers],
    zeroPatch: a.patches.length + b.patches.length === 0,
    promptHookContextOnCleanBase: context(a),
    promptHookContextIdenticalAcrossWorkspaces: JSON.stringify(context(a)) === JSON.stringify(context(b)),
    promptHookContextOnPracticeDiff: a.hooks.practice.userPromptSubmit.map(h => h.additionalContext),
    hookLatency: {
      loadAverage: loadavg().map(n => Math.round(n * 10) / 10),
      note: 'Wall time of each hook command as the probe ran it, beside the timeout Claude Code applies to it. A hook that exceeds its timeout is stopped by Claude Code, so a run then does not receive its output.',
      runs: [a, b].flatMap((w, i) => ['cleanBase', 'practice'].flatMap(when => Object.values(w.hooks[when]).flat().map(h => ({ workspace: 'ab'[i], when, event: h.event, matcher: h.matcher, ms: h.ms, timeoutSeconds: h.timeoutSeconds, exceededTimeout: h.exceededTimeout })))),
    },
    practiceDiff: { file: 'experiments/jev-gate/probe/practice-probe.patch', sha256: sha256(readFileSync(join(dir, 'probe/practice-probe.patch'))), note: 'Authored for this probe only: not a corpus item and not one of the bundle-3 practice rows.' },
    workspaces: { a: { steps: a.steps, hooks: a.hooks }, b: { steps: b.steps, hooks: b.hooks } },
  };
  for (const w of [a, b]) rmSync(w.root, { recursive: true, force: true });
  assert(!/\/Users\/|\/private\/|\/home\//.test(JSON.stringify(record)), 'A private path reached the probe record');
  return record;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const record = await probe();
  writeFileSync(join(repo, outPath), JSON.stringify(record, null, 2) + '\n');
  console.log(`Wrote ${outPath}: base ${record.baseSha} (identical: ${record.baseShaIdenticalAcrossWorkspaces}), zero patch: ${record.zeroPatch}, release tree match: ${record.workspaces.a.steps[1].releaseTreeMatchesPin}`);
}
