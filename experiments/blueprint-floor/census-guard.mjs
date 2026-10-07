// EXP 007 census guard (WO-2-01). The census runner calls checkCensusRun before any metered call. It refuses unless:
//   - freeze.mjs is set (PREREG_SHA256 and NOT_BEFORE non-null) and the pre-registration on disk hashes to PREREG_SHA256;
//   - every file the pre-registration pins (files, and the engine files under node_modules/bce-engine) hashes to its pin;
//   - now is strictly after NOT_BEFORE (the odin-rnd mergedAt of the pull request that published the record);
//   - the site serves the record byte for byte: the served copy, fetched at run start, hashes to PREREG_SHA256 (the fetch
//     and its sha are recorded; tests stub the fetch, and the default fetch refuses under the Node test runner);
//   - every file on the counted path hashes to its pin in experiments/blueprint-floor/runners.sha256;
//   - EXP 005's base tree is the pinned one at run time (refute r1 B1): HEAD:experiments/jev-gate/base is the
//     pre-registration's adapter.baseTree, and git status (untracked and ignored files included) is empty under it;
//   - the ledger is exactly the committed experiments/blueprint-floor/spend-ledger.jsonl (that path, committed at HEAD),
//     it starts with the bytes committed at HEAD, and it contains the append-only mirror kept in the repository's shared
//     state dir (refute r1 B3: <git common dir>/exp007-census, shared by every worktree, which also holds the run lock and
//     the pending sidecar).
// A REHEARSAL (the fake client) checks the same frozen record, pins and base tree, but fetches nothing and appends to a
// scratch ledger with a scratch state dir; its records are marked rehearsal and never publishable.
//   node experiments/blueprint-floor/census-guard.mjs --write-pins     rewrite runners.sha256 from the files on disk
//   node experiments/blueprint-floor/census-guard.mjs [--mode practice|counted]   run the guard (fetches the served copy)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMENDMENT01_NOT_BEFORE, AMENDMENT01_SHA256, NOT_BEFORE, PREREG_SHA256, SERVED_AMENDMENT01_URL, SERVED_URL } from './freeze.mjs';
import { AMENDMENT_PATH } from './amendment01.mjs';
import { checkLedgerIntegrity, LEDGER } from './census-spend.mjs';

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const DIR = 'experiments/blueprint-floor';
export const PREREG = `${DIR}/preregistration.json`;
export const PINS = `${DIR}/runners.sha256`;
const PLUGINS = ['hunch', 'jev-pref', 'abide', 'limpet', 'jev-belay', 'jev-engineering', 'pi-verdict', 'jev-axi'];
/** Every file on the counted path: EXP 007's runner, guard, gate, ledger and freeze; the pinned protocol, adapter, scorer,
 * prompts, contracts, selection, rule files and controls; the canary prompt and the rehearsal fake (refused by a paid
 * run); and every module outside this directory they import (EXP 005's engine contract, scrub and lint; EXP 006's
 * scrub; check.mjs, which the scrub reads). */
export const RUNNER_FILES = [
  `${DIR}/census-run.mjs`, `${DIR}/census-guard.mjs`, `${DIR}/census-gate.mjs`, `${DIR}/census-spend.mjs`, `${DIR}/freeze.mjs`, `${DIR}/amendment01.mjs`, `${DIR}/amendment-01.json`,
  `${DIR}/protocol.mjs`, `${DIR}/adapter.mjs`, `${DIR}/whitelist.mjs`, `${DIR}/whitelist.json`, `${DIR}/scorer.mjs`,
  `${DIR}/contract.md`, `${DIR}/contract-module-graph.md`, `${DIR}/prompts/translator.md`, `${DIR}/prompts/adjudicator.md`, `${DIR}/prompts/canary.md`,
  `${DIR}/rules/selection.json`, ...PLUGINS.map(p => `${DIR}/rules/${p}.json`),
  `${DIR}/controls/positive.json`, `${DIR}/controls/negative.json`, `${DIR}/controls/practice.json`,
  `${DIR}/fixtures/fake-claude-census.mjs`,
  'experiments/jev-gate/bce-contract.mjs', 'experiments/jev-gate/run_reviewer.mjs', 'experiments/jev-gate/runner-guard.mjs', 'experiments/jev-gate/lint.mjs',
  'experiments/nina-changes/scrub6.mjs', 'scripts/check.mjs',
];

export const codeShas = (root = REPO_ROOT) => Object.fromEntries(RUNNER_FILES.map(rel => [rel, existsSync(join(root, rel)) ? sha256(readFileSync(join(root, rel))) : null]));
export const renderPins = shas => Object.entries(shas).map(([rel, h]) => `${h}  ${rel}\n`).join('');
export function readPins(root = REPO_ROOT) {
  const path = join(root, PINS);
  if (!existsSync(path)) refuse(`${PINS} is missing`);
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { const [h, rel] = l.split('  '); return [rel, h]; }));
}
const canonical = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));
export const sameShas = (a, b) => a !== null && b !== null && canonical(a) === canonical(b);

export class GuardError extends Error { constructor(message) { super(`EXP 007 census guard refused: ${message}`); this.name = 'GuardError'; this.code = 'EGUARD7'; } }
function refuse(message) { throw new GuardError(message); }

const utc = (name, value) => {
  const t = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(t) || !/Z$/.test(value)) refuse(`${name} ${value} is not an ISO 8601 UTC time`);
  return t;
};

/** The served copy's bytes, fetched once (10 s); refused under the Node test runner, where the fetch is always stubbed. */
export async function fetchServed(url = SERVED_URL, env = process.env) {
  if (env.NODE_TEST_CONTEXT) throw new Error('the served pre-registration is not fetched under the Node test runner: tests stub fetchServed');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// git as the PATH resolved it when this module loaded (a test may empty PATH afterwards to keep the client unreachable).
const GIT = (process.env.PATH ?? '').split(':').filter(Boolean).map(d => join(d, 'git')).find(p => existsSync(p)) ?? 'git';
/**
 * Refute r3 B2: what git reports about the base tree must not be changeable by repository state outside the tree. Every git
 * call the census makes runs with replace objects off (--no-replace-objects and GIT_NO_REPLACE_OBJECTS=1, so `git replace`
 * cannot swap the tree that ls-tree or status read while rev-parse still names the pinned id), and with the settings that
 * change how files on disk compare to blobs pinned: no line-ending conversion (core.autocrlf=false, core.safecrlf=false),
 * the exec bit honoured (core.fileMode=true), case-sensitive paths (core.ignorecase=false), no stat-only shortcut on
 * untracked files (core.untrackedCache=false) and no filesystem monitor (core.fsmonitor=false). Clean filters cannot be
 * disabled by -c, so checkBaseTree hashes with hash-object --no-filters (refute r3 B1).
 */
export const GIT_GUARD_ARGS = Object.freeze(['--no-replace-objects', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fileMode=true', '-c', 'core.ignorecase=false', '-c', 'core.untrackedCache=false', '-c', 'core.fsmonitor=false']);
/**
 * Refute r4: the environment every guard git call runs in. Every GIT_* variable of this process is dropped (so
 * GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_DIR, GIT_INDEX_FILE, GIT_CONFIG_* and the rest cannot point
 * git at forged state), system and global config are not read, and replace objects are off.
 */
export function guardGitEnv(env = process.env) {
  const out = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...out, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' };
}
/** A git runner bound to `root`: (args, input?) -> {status, stdout}, with GIT_GUARD_ARGS and guardGitEnv. Injectable in the guard's tests only. */
export const gitIn = root => (args, input) => {
  const r = spawnSync(GIT, [...GIT_GUARD_ARGS, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: guardGitEnv(), ...(input !== undefined ? { input } : {}) });
  return { status: r.status, stdout: r.stdout ?? '' };
};
/** A plain git runner (the user's identity and config) for the runner's own commits, never for a check. */
export const gitPlainIn = root => (args, input) => {
  const r = spawnSync(GIT, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }, ...(input !== undefined ? { input } : {}) });
  return { status: r.status, stdout: r.stdout ?? '' };
};

/**
 * Refute r4 B1: the git tree id of a directory computed IN NODE from the bytes on disk, trusting no git: a blob id is
 * sha1("blob <n>\0" + bytes), a tree entry is "100644 <name>\0" + the raw 20-byte id for a file and "40000 <name>\0" +
 * the raw id for a directory, entries in git's order (a directory sorts as "<name>/"), and a tree id is
 * sha1("tree <len>\0" + entries). Every entry is lstat-ed first: a symlink, an executable file, a FIFO or anything else
 * that is not a regular non-executable file or a directory refuses; an EMPTY directory refuses too (git cannot represent
 * it and the pinned tree has none).
 */
export function diskTreeId(dir, rel = '') {
  const sha1 = buf => createHash('sha1').update(buf).digest();
  const entries = [];
  const names = readdirSync(join(dir, rel));
  if (!names.length) refuse(`${BASE_DIR}/${rel} is an empty directory`);
  for (const name of names) {
    const r = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(dir, r));
    if (st.isSymbolicLink()) refuse(`${BASE_DIR}/${r} is a symlink`);
    if (st.isDirectory()) entries.push({ key: Buffer.from(`${name}/`), head: Buffer.from(`40000 ${name}\0`), id: diskTreeId(dir, r) });
    else if (st.isFile()) {
      if (st.mode & 0o111) refuse(`${BASE_DIR}/${r} is executable (mode ${(st.mode & 0o777).toString(8)}); the tree pins 100644`);
      const bytes = readFileSync(join(dir, r));
      entries.push({ key: Buffer.from(name), head: Buffer.from(`100644 ${name}\0`), id: sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])) });
    } else refuse(`${BASE_DIR}/${r} is not a regular file`);
  }
  entries.sort((a, b) => Buffer.compare(a.key, b.key));
  const body = Buffer.concat(entries.flatMap(e => [e.head, e.id]));
  return sha1(Buffer.concat([Buffer.from(`tree ${body.length}\0`), body]));
}
export const diskTreeHex = dir => diskTreeId(dir).toString('hex');
export const BASE_DIR = 'experiments/jev-gate/base';
export const STATE_SUBDIR = 'exp007-census';
/** The repository's shared census state dir: <git common dir>/exp007-census (one per repository, every worktree). */
export function censusStateDir(root = REPO_ROOT, git = gitIn(root)) {
  const r = git(['rev-parse', '--git-common-dir']);
  if (r.status !== 0 || !r.stdout.trim()) refuse('git rev-parse --git-common-dir failed');
  return join(resolve(root, r.stdout.trim()), STATE_SUBDIR);
}

/** Every path under `dir` (relative, '/'-separated), refusing a symlink, an executable file, or anything that is not a file or directory. */
function filesUnder(dir) {
  const out = [];
  const walk = rel => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = lstatSync(join(dir, r));
      if (st.isSymbolicLink()) refuse(`${BASE_DIR}/${r} is a symlink`);
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) {
        // Refute r3 N13: a 100644 blob means a non-executable file, whatever core.fileMode says.
        if (st.mode & 0o111) refuse(`${BASE_DIR}/${r} is executable (mode ${(st.mode & 0o777).toString(8)}); the tree pins 100644`);
        out.push(r);
      } else refuse(`${BASE_DIR}/${r} is not a regular file`);
    }
  };
  walk('');
  return out.sort();
}

/**
 * B1 + refute r2 B2: the base tree is the pinned one BY ITS BYTES. HEAD:experiments/jev-gate/base is the pre-registration's
 * adapter.baseTree; git status (untracked and ignored files included) is empty under it; every index entry under it is
 * tagged H by `git ls-files -v` (no assume-unchanged, no skip-worktree, which hide edits from git status); and the files
 * on disk are exactly the tree's: the same paths, every blob id equal to `git hash-object --no-filters` of the file's
 * bytes, every entry a 100644 blob and every file non-executable, no extra file and no symlink. All through gitIn's
 * GIT_GUARD_ARGS (no replace objects, no line-ending conversion). Returns {tree, clean}.
 */
export function checkBaseTree(prereg, git, root = REPO_ROOT) {
  const want = prereg.adapter?.baseTree;
  if (!want) refuse('the pre-registration pins no base tree');
  // The authoritative byte check (refute r4 B1): the tree id of the bytes on disk, computed without git.
  const disk = diskTreeHex(join(root, BASE_DIR));
  if (disk !== want) refuse(`the bytes under ${BASE_DIR} hash to tree ${disk}, not the pinned base tree ${want}`);
  return gitBaseChecks(prereg, git, root);
}

/** Defence in depth only (refute r4): what git reports about the base, through gitIn's scrubbed environment. */
export function gitBaseChecks(prereg, git, root = REPO_ROOT) {
  const want = prereg.adapter?.baseTree;
  const t = git(['rev-parse', `HEAD:${BASE_DIR}`]);
  const tree = t.status === 0 ? t.stdout.trim() : null;
  if (!want || tree !== want) refuse(`HEAD:${BASE_DIR} is ${tree ?? 'missing'}, not the pinned base tree ${want}`);
  const st = git(['status', '--porcelain', '--ignored', '--', BASE_DIR]);
  if (st.status !== 0) refuse(`git status failed under ${BASE_DIR}`);
  if (st.stdout.trim()) refuse(`${BASE_DIR} has changed, untracked or ignored files: ${st.stdout.trim().split('\n').slice(0, 5).join('; ')}`);
  const tags = git(['ls-files', '-v', '--', BASE_DIR]);
  if (tags.status !== 0) refuse(`git ls-files failed under ${BASE_DIR}`);
  const flagged = tags.stdout.split('\n').filter(Boolean).filter(l => !l.startsWith('H '));
  if (flagged.length) refuse(`${BASE_DIR} has index entries git status cannot see changes in (assume-unchanged or skip-worktree): ${flagged.slice(0, 5).join('; ')}`);
  const lt = git(['ls-tree', '-r', want]);
  if (lt.status !== 0) refuse(`git ls-tree failed for ${BASE_DIR}`);
  const entries = lt.stdout.split('\n').filter(Boolean).map(l => { const [meta, path] = l.split('\t'); const [mode, type, blob] = meta.split(' '); return { mode, type, blob, path }; });
  const bad = entries.filter(e => e.type !== 'blob' || e.mode !== '100644');
  if (bad.length) refuse(`${BASE_DIR} at HEAD has entries that are not regular files: ${bad.map(e => `${e.mode} ${e.path}`).join(', ')}`);
  const disk = filesUnder(join(root, BASE_DIR));
  const inTree = entries.map(e => e.path).sort();
  if (JSON.stringify(disk) !== JSON.stringify(inTree)) refuse(`the files under ${BASE_DIR} are not the tree's (extra: ${disk.filter(p => !inTree.includes(p)).join(', ') || 'none'}; missing: ${inTree.filter(p => !disk.includes(p)).join(', ') || 'none'})`);
  // --no-filters: the blob id of the bytes on disk, never of what a clean filter or line-ending conversion makes of them (refute r3 B1).
  const ho = git(['hash-object', '--no-filters', '--stdin-paths'], entries.map(e => `${BASE_DIR}/${e.path}`).join('\n') + '\n');
  const blobs = ho.stdout.split('\n').filter(Boolean);
  if (ho.status !== 0 || blobs.length !== entries.length) refuse(`git hash-object failed under ${BASE_DIR}`);
  const differ = entries.filter((e, i) => blobs[i] !== e.blob).map(e => e.path);
  if (differ.length) refuse(`files under ${BASE_DIR} differ from HEAD by their bytes: ${differ.join(', ')}`);
  return { tree, clean: true };
}

/** N4: the served pre-registration, re-fetched (before every rule); refuses unless it hashes to `expected`. */
export async function recheckServed({ expected, fetch: fetchBytes = fetchServed, url = SERVED_URL }) {
  let bytes;
  try { bytes = await fetchBytes(url); } catch (error) { refuse(`the served pre-registration could not be fetched: ${String(error.message).slice(0, 200)}`); }
  const got = sha256(bytes);
  if (got !== expected) refuse(`the site serves a pre-registration hashing to ${got}, not the frozen ${expected}`);
  return { url, sha256: got, fetchedAt: new Date().toISOString() };
}

/** Refuses unless every file `pins` names exists under `root` and hashes to its pin. */
export function checkPinned(pins, root, by) {
  for (const [rel, want] of Object.entries(pins ?? {})) {
    const path = join(root, rel);
    if (!existsSync(path)) refuse(`${by} pins ${rel}, which is missing`);
    const have = sha256(readFileSync(path));
    if (have !== want) refuse(`${by} pins ${rel} at ${want}; it hashes to ${have}`);
  }
}

export const MODES = ['practice', 'counted', 'recall', 'rehearsal'];

/**
 * The guard. Returns the stamp every record carries: {mode, rehearsal, preregSha256, notBefore, served, code,
 * codeMatchesPins, checkedAt}. `freeze`, `now`, `fetch`, `git`, `stateDir` and `root` are injectable for tests.
 */
/**
 * Amendment 01 (a recall, or its rehearsal): refuses unless the amendment is frozen (sha and not-before), the file on disk
 * hashes to the frozen sha and names the frozen pre-registration as its parent, now is after the amendment's not-before,
 * and (not in a rehearsal) the site serves it byte for byte. Returns {amendmentSha256, amendmentNotBefore, servedAmendment}.
 */
export async function checkAmendment01({ root = REPO_ROOT, now = new Date(), freeze, rehearsal, fetch: fetchBytes = fetchServed, url = SERVED_AMENDMENT01_URL }) {
  if (!freeze?.AMENDMENT01_SHA256 || !freeze?.AMENDMENT01_NOT_BEFORE) refuse('a re-call waits for the amendment 01 freeze: AMENDMENT01_SHA256 and AMENDMENT01_NOT_BEFORE in freeze.mjs are null');
  if (!/^[0-9a-f]{64}$/.test(freeze.AMENDMENT01_SHA256)) refuse('AMENDMENT01_SHA256 is not a sha256');
  const anb = utc('AMENDMENT01_NOT_BEFORE', freeze.AMENDMENT01_NOT_BEFORE);
  const path = join(root, AMENDMENT_PATH);
  if (!existsSync(path)) refuse(`${AMENDMENT_PATH} is missing`);
  const bytes = readFileSync(path), got = sha256(bytes);
  if (got !== freeze.AMENDMENT01_SHA256) refuse(`${AMENDMENT_PATH} hashes to ${got}, not the frozen ${freeze.AMENDMENT01_SHA256}`);
  const amendment = JSON.parse(bytes);
  if (amendment.parent?.sha256 !== freeze.PREREG_SHA256) refuse(`${AMENDMENT_PATH} does not name the frozen pre-registration as its parent`);
  if (!(anb > Date.parse(freeze.NOT_BEFORE))) refuse('the amendment not-before is not after the pre-registration not-before');
  if (!(now.getTime() > anb)) refuse(`it is ${now.toISOString()}, not after the amendment 01 not-before ${freeze.AMENDMENT01_NOT_BEFORE}`);
  let servedAmendment = null;
  if (!rehearsal) {
    let served;
    try { served = await fetchBytes(url); } catch (error) { refuse(`the served amendment 01 could not be fetched: ${String(error.message).slice(0, 200)}`); }
    const s = sha256(served);
    if (s !== got) refuse(`the site serves an amendment 01 hashing to ${s}, not the frozen ${got}`);
    servedAmendment = { url, sha256: s, fetchedAt: new Date().toISOString() };
  }
  return { amendment, amendmentSha256: got, amendmentNotBefore: freeze.AMENDMENT01_NOT_BEFORE, servedAmendment };
}

export async function checkCensusRun({ mode, root = REPO_ROOT, now = new Date(), freeze = { PREREG_SHA256, NOT_BEFORE, AMENDMENT01_SHA256, AMENDMENT01_NOT_BEFORE }, fetch: fetchBytes = fetchServed, ledgerPath = join(root, LEDGER), git = gitIn(root), baseRoot, stateDir, servedUrl = SERVED_URL, recall = false } = {}) {
  if (!MODES.includes(mode)) refuse(`unknown mode ${mode}`);
  const rehearsal = mode === 'rehearsal';
  if (!freeze?.PREREG_SHA256 || !freeze?.NOT_BEFORE) refuse('the census waits for the freeze: PREREG_SHA256 and NOT_BEFORE in freeze.mjs are null');
  if (!/^[0-9a-f]{64}$/.test(freeze.PREREG_SHA256)) refuse('PREREG_SHA256 is not a sha256');
  const nb = utc('NOT_BEFORE', freeze.NOT_BEFORE);
  const ppath = join(root, PREREG);
  if (!existsSync(ppath)) refuse(`${PREREG} is missing`);
  const bytes = readFileSync(ppath);
  const got = sha256(bytes);
  if (got !== freeze.PREREG_SHA256) refuse(`${PREREG} hashes to ${got}, not the frozen ${freeze.PREREG_SHA256}`);
  const prereg = JSON.parse(bytes);
  checkPinned(prereg.files, root, 'the pre-registration');
  checkPinned(Object.fromEntries(Object.entries(prereg.engine?.files ?? {}).map(([f, h]) => [`node_modules/bce-engine/${f}`, h])), root, 'the pre-registration (engine)');
  if (!(now.getTime() > nb)) refuse(`it is ${now.toISOString()}, not after the not-before ${freeze.NOT_BEFORE}`);
  const base = checkBaseTree(prereg, git, baseRoot ?? root);
  // Amendment 01: a recall (or a rehearsal of one) also needs the frozen, published amendment and its later not-before.
  const isRecall = mode === 'recall' || (rehearsal && recall);
  const a01 = isRecall ? await checkAmendment01({ root, now, freeze, rehearsal, fetch: fetchBytes }) : null;

  const code = codeShas(root);
  const missing = Object.keys(code).filter(k => code[k] === null);
  if (missing.length) refuse(`counted-path file(s) missing: ${missing.join(', ')}`);
  const pinned = readPins(root);
  const codeMatchesPins = sameShas(pinned, code);
  if (!codeMatchesPins) refuse(`the counted-path code differs from ${PINS} (${[...new Set([...Object.keys(code), ...Object.keys(pinned)])].filter(k => pinned[k] !== code[k]).join(', ') || 'file list'})`);

  let served = null, ledgerHeadText = '', state = stateDir ?? null;
  if (!rehearsal) {
    if (resolve(ledgerPath) !== resolve(join(root, LEDGER))) refuse(`a practice or counted run appends to the committed ledger ${LEDGER}`);
    const head = git(['show', `HEAD:${LEDGER}`]);
    if (head.status !== 0) refuse(`${LEDGER} is not committed at HEAD`);
    ledgerHeadText = head.stdout;
    state ??= censusStateDir(root, git);
    const mirrorPath = join(state, 'spend-ledger.mirror.jsonl');
    const integrity = checkLedgerIntegrity({ ledgerText: existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '', headText: ledgerHeadText, mirrorText: existsSync(mirrorPath) ? readFileSync(mirrorPath, 'utf8') : null });
    if (!integrity.ok) refuse(`the ledger fails its integrity check (${integrity.reason}): it must start with the bytes committed at HEAD and contain the shared mirror`);
    served = await recheckServed({ expected: freeze.PREREG_SHA256, fetch: fetchBytes, url: servedUrl });
  }
  return { mode, rehearsal, preregSha256: got, notBefore: freeze.NOT_BEFORE, served, base, code, codeMatchesPins, checkedAt: now.toISOString(), prereg, ledgerHeadText, ledgerHeadSha256: sha256(ledgerHeadText), stateDir: state, ...(a01 ? { amendment: a01.amendment, amendmentSha256: a01.amendmentSha256, amendmentNotBefore: a01.amendmentNotBefore, servedAmendment: a01.servedAmendment } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--write-pins')) {
    writeFileSync(join(REPO_ROOT, PINS), renderPins(codeShas()));
    console.log(`wrote ${PINS}`);
    process.exit(0);
  }
  try {
    const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'counted';
    const { prereg: _p, code: _c, ledgerHeadText: _l, stateDir: _s, ...stamp } = await checkCensusRun({ mode });
    console.log(JSON.stringify({ ok: true, ...stamp }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}
