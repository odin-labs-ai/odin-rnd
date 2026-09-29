// EXP 005 runner guard: every gate runner (Jev, Laya, the nina reviewer) and the metrics call this
// before anything else. It refuses unless the published parent pre-registration and the published
// amendment are the exact bytes named below, every file either record pins still hashes to its pin,
// and the amendment's not-before time has passed.
//
// The three constants are the published values: the parent (odin-rnd #12) and the amendment with its
// not-before time (odin-rnd #13, merged 2026-09-28T12:01:15Z), frozen after the amendment landed and
// before any counted gate call (REVISION-5.1, "Freeze"). The runner and results code is frozen with
// them in runners.sha256.
//
//   node experiments/jev-gate/runner-guard.mjs --check [--mode counted|practice|probe] [--pins <fixture pins.json>]
//
// --pins replaces the constants for tests and fake runs only. It turns on fixture mode: every record
// written under it carries fixture: true and the FIXTURE banner, and results.mjs refuses to publish it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARENT_SHA256 = '30bdcf07a6d3dc14383858bb8f9ef64d8419dc2c59f8c2f3725b09f7bdc8fb1a';
export const AMENDMENT_SHA256 = '5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb'; // amendment-01.json as merged in odin-rnd #13 (b9015cf8)
export const NOT_BEFORE = '2026-09-28T12:01:15Z'; // odin-rnd #13 mergedAt (GitHub); the merge commit's own date is 12:01:14Z
// Amendment 02 (the reviewer fence). Every COUNTED gate run (Jev, Laya, reviewer) waits for its merge time; probes
// and practice runs do not. Both stay null until the freeze commit after amendment 02 merges.
export const AMENDMENT_02_SHA256 = '75d231c255d70fa537cb3f4fc90e780be053b42aa5fc8997f003009297d8cb9b'; // amendment-02.json as merged in odin-rnd #14 (9e08d4c6)
export const NOT_BEFORE_02 = '2026-09-28T18:36:49Z'; // odin-rnd #14 mergedAt (GitHub)

export const FIXTURE_BANNER = 'FIXTURE — produced by fake gates or fixture pins; not a measurement and never publishable';
export const SPOTLIGHT_IDS = ['missed-drift', 'false-reject', 'self-agreement', 'zero-patches'];

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = 'experiments/jev-gate';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFileLine = text => /^([0-9a-f]{64}) {2}\S+\n?$/.exec(text)?.[1];

function refuse(message) {
  const error = new Error(`runner guard refused: ${message}`);
  error.code = 'EGUARD';
  throw error;
}

// Every file a record pins by sha256 must still hash to its pin.
function checkPinnedFiles(root, files, owner) {
  for (const [rel, want] of Object.entries(files ?? {})) {
    const path = join(root, rel);
    if (!existsSync(path)) refuse(`${owner} pins ${rel}, which is missing`);
    const got = sha256(readFileSync(path));
    if (got !== want) refuse(`${owner} pins ${rel} at ${want}; it hashes to ${got}`);
  }
}

// Structural checks on the amendment: the fields the runners and the metrics read (schema agreed across lanes).
export function checkAmendmentShape(amendment, parentSha) {
  const a = amendment;
  if (a?.kind !== 'amendment') refuse('amendment-01.json is not kind "amendment"');
  if (a.parent?.file !== 'preregistration.json' || a.parent?.sha256 !== parentSha) refuse('amendment-01.json does not name the published parent');
  const nina = a.changes?.reviewer?.nina;
  for (const k of ['release', 'commit', 'repoTree', 'releaseTree']) if (typeof nina?.[k] !== 'string' || !nina[k]) refuse(`amendment changes.reviewer.nina.${k} is missing`);
  if (typeof nina.tarball?.url !== 'string' || !/^sha512-[A-Za-z0-9+/=]+$/.test(nina.tarball?.integrity ?? '')) refuse('amendment changes.reviewer.nina.tarball {url, integrity} is missing');
  const ws = a.changes.reviewer.workspace;
  if (!Array.isArray(ws?.init) || ws.init[0] !== 'init' || !Array.isArray(ws?.compose) || ws.compose[0] !== 'compose') refuse('amendment changes.reviewer.workspace.init/compose argv is missing');
  if (!(ws.vocabulary === null || (ws.vocabulary && typeof ws.vocabulary === 'object'))) refuse('amendment workspace.vocabulary must be an object or null');
  if (!ws.fragments || typeof ws.fragments !== 'object') refuse('amendment workspace.fragments must be an object');
  for (const p of Object.keys(ws.fragments)) if (!p.startsWith('.nina/') || p.split('/').includes('..')) refuse(`amendment fragment path ${p} is outside .nina/`);
  if (typeof ws.gitignore !== 'string' || !ws.gitignore.includes('node_modules/')) refuse('amendment workspace.gitignore must ignore node_modules/');
  const ids = (a.changes.spotlight?.criteria ?? []).map(c => c.id);
  assert.deepEqual([...ids].sort(), [...SPOTLIGHT_IDS].sort(), 'amendment changes.spotlight.criteria must be exactly the four spotlight criteria');
}

/**
 * Verifies both records and the clock. Returns the parsed records and what the runners stamp on
 * every result. `pins` defaults to the published constants; anything else is fixture mode.
 */
export function checkRecords({ root = REPO_ROOT, pins, now = new Date(), amendmentFile, mode = 'counted' } = {}) {
  if (!['counted', 'practice', 'probe'].includes(mode)) refuse(`unknown run mode ${mode}`);
  const fixture = pins !== undefined;
  const { parentSha256, amendmentSha256, notBefore } = pins ?? { parentSha256: PARENT_SHA256, amendmentSha256: AMENDMENT_SHA256, notBefore: NOT_BEFORE };
  if (!fixture && amendmentFile) refuse('an amendment file other than the committed one needs fixture pins');

  const preregBytes = readFileSync(join(root, DIR, 'preregistration.json'));
  const parentGot = sha256(preregBytes);
  if (parentGot !== PARENT_SHA256 || parentSha256 !== PARENT_SHA256) refuse(`preregistration.json hashes to ${parentGot}, not the published ${PARENT_SHA256}`);
  if (shaFileLine(readFileSync(join(root, DIR, 'preregistration.sha256'), 'utf8')) !== parentGot) refuse('preregistration.sha256 does not match preregistration.json');
  const prereg = JSON.parse(preregBytes);
  checkPinnedFiles(root, prereg.files, 'preregistration.json');

  if (!amendmentSha256) refuse('the amendment sha is not frozen yet (AMENDMENT_SHA256 is null): no gate may run before the amendment is published');
  const amendPath = amendmentFile ?? join(root, DIR, 'amendment-01.json');
  if (!existsSync(amendPath)) refuse(`${amendPath} is missing`);
  const amendBytes = readFileSync(amendPath);
  const amendGot = sha256(amendBytes);
  if (amendGot !== amendmentSha256) refuse(`amendment-01.json hashes to ${amendGot}, not the frozen ${amendmentSha256}`);
  const amendShaPath = amendPath.replace(/\.json$/, '.sha256');
  if (!existsSync(amendShaPath) || shaFileLine(readFileSync(amendShaPath, 'utf8')) !== amendGot) refuse('amendment-01.sha256 does not match amendment-01.json');
  const amendment = JSON.parse(amendBytes);
  checkAmendmentShape(amendment, parentGot);
  checkPinnedFiles(root, amendment.files, 'amendment-01.json');

  if (!notBefore) refuse('the not-before time is not frozen yet (NOT_BEFORE is null): no gate may run before the amendment is merged');
  const nb = Date.parse(notBefore);
  if (!Number.isFinite(nb) || !/Z$/.test(notBefore)) refuse(`not-before ${notBefore} is not an ISO 8601 UTC time`);
  if (!(now.getTime() > nb)) refuse(`it is ${now.toISOString()}, not after the not-before time ${notBefore}`);

  // The runner and results code is frozen with the constants: a counted run refuses if any of it has
  // changed since runners.sha256 was written. A fixture run records what it ran without refusing.
  const code = runnerCodeShas(root);
  if (!fixture) {
    const pinned = readRunnerPins(root);
    if (JSON.stringify(pinned) !== JSON.stringify(code)) refuse(`the runner code differs from ${RUNNER_PINS} (${Object.keys(code).filter(k => pinned[k] !== code[k]).join(', ') || 'file list'})`);
  }

  // Every counted gate waits for amendment 02 (refute of amendment 02, N8): the site says "before any counted run".
  let amendment02 = null, amendment02Sha256 = null, countedNotBefore = notBefore;
  if (mode === 'counted' && !fixture) {
    if (!AMENDMENT_02_SHA256 || !NOT_BEFORE_02) refuse('counted runs wait for amendment 02: AMENDMENT_02_SHA256 and NOT_BEFORE_02 are not frozen yet');
    const a2Bytes = readFileSync(join(root, DIR, 'amendment-02.json'));
    amendment02Sha256 = sha256(a2Bytes);
    if (amendment02Sha256 !== AMENDMENT_02_SHA256) refuse(`amendment-02.json hashes to ${amendment02Sha256}, not the frozen ${AMENDMENT_02_SHA256}`);
    amendment02 = JSON.parse(a2Bytes);
    if (amendment02.parent?.sha256 !== amendGot || amendment02.preregistration?.sha256 !== parentGot) refuse('amendment-02.json does not name amendment 01 and the pre-registration');
    checkPinnedFiles(root, amendment02.files, 'amendment-02.json');
    if (!(now.getTime() > Date.parse(NOT_BEFORE_02))) refuse(`it is ${now.toISOString()}, not after amendment 02's not-before ${NOT_BEFORE_02}`);
    countedNotBefore = NOT_BEFORE_02;
  }
  const spendCap = effectiveSpendCap(prereg, amendment02 ?? amendment, amendment02 ? NOT_BEFORE_02 : notBefore);
  // The answer-key pre-flight is no longer part of the guard --check: it is a slow machine scan (bundle-3 refute
  // B2), so keeping it here would make every --check scan the whole machine. The runners run it
  // (answerKeyPreflight) right before their paid loop and record its result; --check stays fast and hermetic.

  return { prereg, amendment, stamp: { fixture, mode, parentSha256: parentGot, amendmentSha256: amendGot, amendment02Sha256, amendment02, notBefore: countedNotBefore, spendCap, code } };
}

/** The code that makes and scores a run, pinned in runners.sha256 by the freeze commit (REVISION-5.1, "Freeze"). */
export const RUNNER_FILES = [
  'experiments/jev-gate/runner-guard.mjs', 'experiments/jev-gate/run_gates.py', 'experiments/jev-gate/run_reviewer.mjs',
  'experiments/jev-gate/results.mjs', 'experiments/jev-gate/metrics.mjs', 'experiments/jev-gate/laya_count.py',
  'experiments/laya-vs-jev/run.py', 'experiments/laya-vs-jev/laya_mlx.py', 'experiments/laya-vs-jev/laya_inputs.py',
];
export const RUNNER_PINS = 'experiments/jev-gate/runners.sha256';

export const runnerCodeShas = (root = REPO_ROOT) => Object.fromEntries(RUNNER_FILES.map(rel => [rel, sha256(readFileSync(join(root, rel)))]));
export const renderRunnerPins = shas => Object.entries(shas).map(([rel, h]) => `${h}  ${rel}\n`).join('');

export function readRunnerPins(root = REPO_ROOT) {
  const path = join(root, RUNNER_PINS);
  if (!existsSync(path)) refuse(`${RUNNER_PINS} is missing`);
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { const [h, rel] = l.split('  '); return [rel, h]; }));
}

/**
 * The spend cap the runners enforce: the parent's cap and rule, starting from the amendment's
 * spend.alreadySpentUsd when it states one (it supersedes the parent's figure; it can only grow).
 */
export function effectiveSpendCap(prereg, amendment, countFrom = null) {
  const already = amendment?.spend?.alreadySpentUsd;
  if (already === undefined) return { ...prereg.spendCap, alreadySpentFrom: 'preregistration', countFrom: null };
  if (!(typeof already === 'number' && Number.isFinite(already) && already >= prereg.spendCap.alreadySpentUsd)) refuse('amendment spend.alreadySpentUsd must be a number no lower than the parent\'s');
  // countFrom: the not-before of the record whose alreadySpentUsd is used. Every paid call before it is already
  // inside that figure, so the ledger skips ledger lines at or before it (no double count, refute N9).
  return { ...prereg.spendCap, alreadySpentUsd: already, alreadySpentFrom: amendment.id ?? 'amendment-01', countFrom };
}

/**
 * Answer-key pre-flight (refute r4 of amendment 02, B2). The reviewer sandbox blocks reads of home directories
 * and, from fence5, of the shared temp roots; a copy of an answer file anywhere outside home would still sit
 * behind fewer layers than the original. Before any practice or counted run, every regular file under the temp
 * roots is compared with the answer files (size first, then sha256); the run refuses while any copy exists and
 * names each one.
 */
export const ANSWER_FILES = ['labels.json', 'manifest.json', 'corpus.sha256', 'inputs.json', 'baselines.json'].map(f => `experiments/jev-gate/${f}`);

// The root-owned per-user temp buckets under var/folders (for example another user's, or the system user's,
// zz bucket's T dir) cannot be read by the operator, so `find` would fail closed on every counted run (bundle-3
// refute B2). We do not scan them; we record them as skipped, because the reviewer sandbox's denyRead already
// covers /private/var/folders and /var/folders. The reason string names the roots WITHOUT a trailing slash so the
// corpus lint (which flags a private path) does not flag a runner's own recorded pre-flight.
export const UNSCANNABLE_REASON = 'unreadable (root-owned); covered by the reviewer sandbox denyRead of /private/var/folders and /var/folders';
const isReadable = p => { try { readdirSync(p); return true; } catch { return false; } };

/**
 * The temp roots the operator can read, and a per-base count of the root-owned buckets that were skipped.
 * scannable: the user's own macOS temp dir (tmpdir()), /private/tmp, /tmp and the var/tmp roots, plus any
 * /var/folders per-user T dir the operator can actually read. skipped: {base, unreadableBuckets, reason}.
 */
export function defaultScanRoots() {
  const home = realpathSync(homedir());
  const scannable = [], seen = new Set(), skippedCounts = {};
  const consider = real => {
    if (seen.has(real) || real === home || real.startsWith(home + '/')) return 'home-or-dup';
    seen.add(real);
    if (isReadable(real)) { scannable.push(real); return 'scannable'; }
    return 'unreadable';
  };
  for (const r of [tmpdir(), '/private/tmp', '/tmp', '/private/var/tmp', '/var/tmp']) { let real; try { real = realpathSync(r); } catch { continue; } consider(real); }
  for (const base of ['/private/var/folders', '/var/folders']) {
    let buckets = []; try { buckets = readdirSync(base); } catch { continue; }
    for (const x of buckets) {
      const bucket = join(base, x);
      let subs;
      try { subs = readdirSync(bucket); } catch { skippedCounts[base] = (skippedCounts[base] ?? 0) + 1; continue; }
      for (const y of subs) { let real; try { real = realpathSync(join(bucket, y, 'T')); } catch { continue; } if (consider(real) === 'unreadable') skippedCounts[base] = (skippedCounts[base] ?? 0) + 1; }
    }
  }
  const skipped = Object.entries(skippedCounts).map(([base, unreadableBuckets]) => ({ base, unreadableBuckets, reason: UNSCANNABLE_REASON }));
  return { scannable, skipped };
}

export function answerKeyCopies({ roots = defaultScanRoots().scannable, root = REPO_ROOT } = {}) {
  // base name -> [{size, sha, rel}]. find matches by name AND size, so it stats only the handful of name-matches,
  // not every file in the tree (refute r2 B2: fast and bounded). The few candidates are then confirmed by sha.
  const want = new Map();
  for (const rel of ANSWER_FILES) {
    const bytes = readFileSync(join(root, rel));
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (!want.has(base)) want.set(base, []);
    want.get(base).push({ size: bytes.length, sha: sha256(bytes), rel });
  }
  const dirs = roots.filter(r => existsSync(r) && isReadable(r));
  if (!dirs.length) return { copies: [], vanished: 0, permissionSkipped: 0 };
  // The name test comes FIRST, before -type f, so find stats (for -type/-size) only the handful of files whose
  // name matches an answer file — not the millions of files in a busy temp tree. Any name+size match is then
  // confirmed by sha in node (a labels.json of inputs.json's size is a false candidate the sha rejects).
  // Pruned trees: node_modules and .git (an answer file never lives there), and the Claude session-scratch
  // tool-output dirs — matched by the path shape `<claude-temp>/<project>/<session>/tasks`, not by the bare name
  // `tasks`, so a repository's own tasks/ is NOT pruned (refute r3 N-r3-2). Those dirs hold agent output, never a
  // curated answer-file copy, and are the bulk of the readdir walk under fleet load; pruning them bounds the walk.
  // Symlinks are not followed (no -L). This detects the answer files under their own names, sha-confirmed; a copy
  // saved under a different name is not detected here — the reviewer sandbox's denyRead of the temp roots is that
  // boundary (refute r3 N-r3-1).
  const nameExpr = [...want.keys()].flatMap((n, i) => (i ? ['-o'] : []).concat('-name', n));
  const sizes = [...new Set([...want.values()].flat().map(s => s.size))];
  const sizeExpr = sizes.flatMap((s, i) => (i ? ['-o'] : []).concat('-size', `${s}c`));
  const args = [...dirs, '(', '-name', 'node_modules', '-o', '-name', '.git', '-o', '-path', '*/claude-*/*/tasks', ')', '-prune', '-o', '(', ...nameExpr, ')', '-type', 'f', '(', ...sizeExpr, ')', '-print0'];
  const r = spawnSync('find', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) refuse(`answer-key pre-flight could not run find: ${r.error.message}`);
  // A scan that did not finish must never pass as clean (refute r3 B1, and r5 of amendment 02). Refuse if find was
  // killed (a signal, or no exit status), if any stderr line is not a benign per-entry skip, or if it exited
  // non-zero with no benign line to explain it. Benign = "find: <path>: <ENOENT|permission>" where <path> is a real
  // path strictly INSIDE a scanned root (an entry that vanished mid-walk, or an unreadable subtree covered by the
  // sandbox denyRead). fts_* traversal-abort lines and errors about a root itself are REAL errors and refuse.
  if (r.signal) refuse(`answer-key pre-flight: find was killed by ${r.signal}; a scan that did not finish is not clean`);
  if (r.status === null) refuse('answer-key pre-flight: find did not exit normally; a scan that did not finish is not clean');
  let vanished = 0, permissionSkipped = 0;
  const realErrors = [];
  for (const l of String(r.stderr ?? '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const m = /^find: (.+): (No such file or directory|Permission denied|Operation not permitted)$/.exec(l);
    // BSD/macOS prints the path bare ("find: /p: ..."); GNU find (odin-rnd Linux CI) quotes it in the locale's
    // style — C locale opens with a backtick and closes with an apostrophe, UTF-8 uses ‘ and ’, shell uses '' —
    // so strip one surrounding quote pair before the strict inside-a-scanned-root test, or a benign Linux skip
    // (ENOENT / permission) would read as a real error. The message is the C errno text in either build.
    const path = m?.[1]?.replace(/^[`'‘"]/, '').replace(/['’"]$/, '');
    const insideRoot = path !== undefined && !/(^|\/)fts_[a-z]+$/.test(path) && dirs.some(d => path.startsWith(d.endsWith('/') ? d : `${d}/`));
    if (!m || !insideRoot) realErrors.push(l);
    else if (/No such file or directory$/.test(l)) vanished += 1;
    else permissionSkipped += 1;
  }
  if (realErrors.length) refuse(`answer-key pre-flight: real scan error (not a benign inner skip): ${realErrors.slice(-2).join(' | ')}`);
  if (r.status !== 0 && vanished + permissionSkipped === 0) refuse(`answer-key pre-flight: find exited ${r.status} with no benign explanation (a truncated scan)`);
  const copies = [];
  for (const buf of (r.stdout ?? Buffer.alloc(0)).toString('utf8').split('\0').filter(Boolean)) {
    let bytes;
    try { bytes = readFileSync(buf); } catch { vanished += 1; continue; } // gone between find and read: not a copy
    const base = buf.slice(buf.lastIndexOf('/') + 1);
    const hit = (want.get(base) ?? []).find(w => w.size === bytes.length && w.sha === sha256(bytes));
    if (hit) copies.push({ path: buf, copyOf: hit.rel });
  }
  copies.sort((a, b) => a.path.localeCompare(b.path));
  return { copies, vanished, permissionSkipped };
}

/**
 * The answer-key pre-flight the runners run right before a paid loop (bundle-3 refute B2). It scans only the temp
 * roots the operator can read, records the root-owned ones it skipped, and refuses on any byte-for-byte answer-file
 * copy, on a real scan error, and when no root is scannable. JEV_GATE_PREFLIGHT_ROOTS overrides the roots (ops and
 * tests): it is refused outright in a counted run, and in a practice run every root it names must exist. Either way
 * the roots used and any skipped bases are returned so the runner records them (never a silent, unrecorded bypass).
 * `scan` is injected by tests.
 */
export function answerKeyPreflight({ mode = 'counted', root = REPO_ROOT, scan = answerKeyCopies } = {}) {
  const env = process.env.JEV_GATE_PREFLIGHT_ROOTS;
  let scanned, skipped = [], override = null;
  if (env) {
    const named = env.split(':').filter(Boolean);
    if (mode === 'counted') refuse('JEV_GATE_PREFLIGHT_ROOTS is refused in a counted run: it scans the real temp roots');
    const missing = named.filter(r => !existsSync(r));
    if (missing.length) refuse(`JEV_GATE_PREFLIGHT_ROOTS names dirs that do not exist: ${missing.join(', ')}`);
    scanned = named; override = env;
  } else {
    ({ scannable: scanned, skipped } = defaultScanRoots());
  }
  if (!scanned.length) refuse('the answer-key pre-flight found no scannable temp root');
  const t0 = Date.now();
  const { copies, vanished, permissionSkipped } = scan({ roots: scanned, root });
  const durationMs = Date.now() - t0;
  return { ok: copies.length === 0, mode, scanned, skipped, override, copies, vanished, permissionSkipped, durationMs };
}

// A counted pre-flight record is good for this long before a counted run starts (bundle-4, refute r5: cut from 6 h
// to 2 h). One scan under the fleet's temp load took over an hour, so run_gates.py's 3600 s per-runner scan could
// never start a counted run; instead the scan runs ONCE, with no timeout, into a self-hashed record that is
// committed with the results, and every counted runner requires it. A copy stranded between the scan and the run
// start is NOT caught (denyRead is the boundary for that), so the window is short.
export const PREFLIGHT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const gitHead = (root = REPO_ROOT) => {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const head = (r.stdout ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(head)) refuse('the pre-flight record check could not read git HEAD');
  return head;
};
const runnersPinsSha = (root = REPO_ROOT) => sha256(readFileSync(join(root, RUNNER_PINS)));
// The record's self-sha covers every field except sha256 itself.
const preflightRecordSha = rec => sha256(JSON.stringify({ ...rec, sha256: null }));
// The record is committed with the results, so its paths are scrubbed like every other record. This MUST agree
// with run_reviewer.mjs scrubPaths and run_gates.py scrub on the scan roots, so the roots a runner stamps into its
// run record (record.scanned, then re-scrubbed when the run record is written) still equal the pre-flight record's
// scanned at scoring time. The macOS per-user temp dir and /tmp (and /private/tmp) both collapse to <tmp> — the
// same rules as scrubPaths — and the home dir to ~. The var/tmp roots carry no operator id and are left as they
// are (no trailing slash), which is a fixed point of all three scrubbers. A test asserts this agreement.
const HOME_DIR = (() => { try { return realpathSync(homedir()); } catch { return homedir(); } })();
export const scrubTempPath = s => String(s)
  .replace(/(?:\/private)?\/var\/folders\/[^\s"'\\/]+\/[^\s"'\\/]+\/T(?![\w.-])/g, '<tmp>')
  .replace(/(?<![\w.~<>-])(?:\/private)?\/tmp(?=\/|["'\s]|$)/g, '<tmp>')
  .split(HOME_DIR).join('~');

/**
 * Write the counted answer-key pre-flight RECORD (bundle-4). The scan (answerKeyPreflight) runs once, with no
 * timeout, over the full default temp roots. The record is self-hashed (an integrity/freshness check against
 * mistakes, NOT a signature: the operator is trusted and the reviewer sandbox cannot write the temp roots) and
 * binds the result to the runner code (runners.sha256) and the commit (git HEAD). Its paths are scrubbed so it can
 * be committed with the results. Refuses to record ok:true with an override: a counted scan must be the real one.
 */
export function writePreflightRecord({ path, mode = 'counted', root = REPO_ROOT } = {}) {
  const startedAt = new Date().toISOString();
  const pf = answerKeyPreflight({ mode, root });
  const endedAt = new Date().toISOString();
  if (pf.ok && pf.override) refuse('a counted pre-flight record must not be written with JEV_GATE_PREFLIGHT_ROOTS set (the scan must be the real one)');
  const rec = {
    kind: 'answer-key-preflight', mode, ok: pf.ok, scanned: pf.scanned.map(scrubTempPath),
    skipped: pf.skipped, copies: pf.copies.map(c => ({ path: scrubTempPath(c.path), copyOf: c.copyOf })),
    vanished: pf.vanished, permissionSkipped: pf.permissionSkipped, durationMs: pf.durationMs, override: pf.override ?? null,
    startedAt, endedAt, runnersSha256: runnersPinsSha(root), head: gitHead(root), sha256: null,
  };
  rec.sha256 = preflightRecordSha(rec);
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
  return rec;
}

/**
 * RUN-TIME validation of the pre-flight record, against the LIVE environment (this is correct at run time). Refuses
 * unless it is a counted answer-key-preflight, ok, self-sha intact, no override, empty copies, its scrubbed roots
 * equal the current default scan roots, its runners.sha256 and git HEAD equal the current ones, and its endedAt is
 * after amendment 02's not-before and within the window of `now`. Returns {sha256, endedAt, head, scanned} for the
 * runner to stamp into its run record (scoring re-checks against those stamps, not the live environment).
 */
export function checkPreflightRecord({ path, mode = 'counted', root = REPO_ROOT, now = new Date() } = {}) {
  if (mode !== 'counted') refuse('a pre-flight record is required only for a counted run');
  if (!path) refuse('a counted run needs a pre-flight record (--preflight-record); run runner-guard.mjs --preflight --mode counted --write-record first');
  if (!existsSync(path)) refuse(`the pre-flight record ${path} is missing`);
  let rec;
  try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch { refuse(`the pre-flight record ${path} is not readable JSON`); }
  if (rec.kind !== 'answer-key-preflight') refuse('the pre-flight record is not an answer-key-preflight record');
  if (preflightRecordSha(rec) !== rec.sha256) refuse('the pre-flight record has been altered: its sha256 does not match its contents');
  if (rec.mode !== 'counted') refuse(`the pre-flight record is for ${rec.mode}, not a counted run`);
  if (rec.ok !== true) refuse(`the pre-flight record is not ok: ${(rec.copies ?? []).length} answer-key copies were found`);
  if ((rec.copies ?? []).length !== 0) refuse(`the pre-flight record lists ${rec.copies.length} answer-key copies (ok must mean none)`);
  if (rec.override) refuse('the pre-flight record was written with an override; a counted run needs the real scan');
  const ws = defaultScanRoots().scannable.map(scrubTempPath).sort(), gs = [...(rec.scanned ?? [])].sort();
  if (ws.length !== gs.length || ws.some((r, i) => r !== gs[i])) refuse('the pre-flight record scanned different roots than the current default scan set');
  if (rec.runnersSha256 !== runnersPinsSha(root)) refuse('the pre-flight record was written under other runner code (runners.sha256 differs)');
  if (rec.head !== gitHead(root)) refuse('the pre-flight record was written on another commit (git HEAD differs)');
  const ended = Date.parse(rec.endedAt);
  if (!Number.isFinite(ended)) refuse('the pre-flight record has no valid endedAt');
  if (!(ended > Date.parse(NOT_BEFORE_02))) refuse("the pre-flight record ended at or before amendment 02's not-before");
  const age = now.getTime() - ended;
  if (!(age >= 0 && age <= PREFLIGHT_MAX_AGE_MS)) refuse(`the pre-flight record ended ${Math.round(age / 60000)} min before the run; it must be within 2 h and not in the future`);
  return { sha256: rec.sha256, endedAt: rec.endedAt, head: rec.head, scanned: rec.scanned };
}

/**
 * SCORING-TIME check (bundle-4 refute r5): bind scoring to what the RUN recorded, not to the scorer's environment,
 * so a committed counted run can be re-scored after more commits, in a fresh checkout, and under any TMPDIR. Given
 * the committed pre-flight `record` and a `run` that stamped {head, pins.preflightRoots, pins.preflight:{sha256,
 * endedAt}}, refuses unless the record is a counted answer-key-preflight with a valid self-sha, ok, no override,
 * EMPTY copies, its runnersSha256 equals the sha of the run's OWN code pins, its head and roots equal what the run
 * stamped, the run committed to this record's sha and endedAt, and endedAt is after amendment 02's not-before and
 * within the window before the gate's first call. No live git HEAD, temp-root or original-path dependency.
 */
export function checkPreflightForScoring({ record, run, firstCallStartedAt }) {
  const g = run?.gate ?? '?';
  const stamped = run?.pins?.preflight ?? run?.preflight;
  const roots = run?.pins?.preflightRoots ?? run?.preflightRoots;
  if (!record || typeof record !== 'object') refuse(`${g}: no committed pre-flight record was supplied to scoring`);
  if (record.kind !== 'answer-key-preflight') refuse(`${g}: the committed pre-flight record is not an answer-key-preflight record`);
  if (preflightRecordSha(record) !== record.sha256) refuse(`${g}: the committed pre-flight record has been altered (sha256 does not match)`);
  if (record.mode !== 'counted') refuse(`${g}: the committed pre-flight record is for ${record.mode}, not a counted run`);
  if (record.ok !== true) refuse(`${g}: the committed pre-flight record is not ok`);
  if (record.override) refuse(`${g}: the committed pre-flight record used an override`);
  if ((record.copies ?? []).length !== 0) refuse(`${g}: the committed pre-flight record lists ${record.copies.length} answer-key copies`);
  if (record.runnersSha256 !== sha256(renderRunnerPins(run.code))) refuse(`${g}: the pre-flight record's runnersSha256 does not equal the run's own code pins`);
  if (!stamped || stamped.sha256 !== record.sha256) refuse(`${g}: the run did not commit to this pre-flight record (sha mismatch)`);
  if (stamped.endedAt !== record.endedAt) refuse(`${g}: the run's stamped pre-flight endedAt differs from the record`);
  if (record.head !== run.head) refuse(`${g}: the pre-flight record's head differs from the run's stamped head`);
  const rs = [...(record.scanned ?? [])].sort(), gs = [...(roots ?? [])].sort();
  if (rs.length !== gs.length || rs.some((r, i) => r !== gs[i])) refuse(`${g}: the pre-flight record's roots differ from the run's stamped roots`);
  const ended = Date.parse(record.endedAt), started = Date.parse(firstCallStartedAt);
  if (!(ended > Date.parse(NOT_BEFORE_02))) refuse(`${g}: the pre-flight record ended at or before amendment 02's not-before`);
  if (!Number.isFinite(started)) refuse(`${g}: the run has no first-call time to date the pre-flight against`);
  const age = started - ended;
  if (!(age >= 0 && age <= PREFLIGHT_MAX_AGE_MS)) refuse(`${g}: the pre-flight ended ${Math.round(age / 60000)} min before the first call; it must be within 2 h and not after it`);
}

export const fixtureFields = fixture => (fixture ? { fixture: true, banner: FIXTURE_BANNER } : { fixture: false });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  if (argv.includes('--write-runner-pins')) {
    writeFileSync(join(REPO_ROOT, RUNNER_PINS), renderRunnerPins(runnerCodeShas()));
    console.log(`wrote ${RUNNER_PINS}`);
    process.exit(0);
  }
  if (argv.includes('--preflight')) {
    try {
      const writeTo = at('--write-record');
      if (writeTo) { // the counted pre-flight scan, written once to a record every runner then requires
        const rec = writePreflightRecord({ path: writeTo, mode: at('--mode') ?? 'counted' });
        console.log(JSON.stringify({ ok: rec.ok, wrote: writeTo, copies: rec.copies.length, vanished: rec.vanished, permissionSkipped: rec.permissionSkipped, durationMs: rec.durationMs, sha256: rec.sha256, head: rec.head }));
        process.exit(rec.ok ? 0 : 1);
      }
      const pf = answerKeyPreflight({ mode: at('--mode') ?? 'counted' });
      console.log(JSON.stringify(pf));
      process.exit(pf.ok ? 0 : 1);
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: error.message }));
      process.exit(2);
    }
  }
  if (argv.includes('--check-preflight')) {
    try {
      const pf = checkPreflightRecord({ path: at('--check-preflight'), mode: at('--mode') ?? 'counted' });
      console.log(JSON.stringify({ ok: true, ...pf }));
      process.exit(0);
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    }
  }
  if (!argv.includes('--check')) { console.error('usage: runner-guard.mjs --check [--mode ...] [--pins <f>] | --preflight [--mode ...] [--write-record <path>] | --check-preflight <path> [--mode counted] | --write-runner-pins'); process.exit(2); }
  try {
    const pinsFile = at('--pins');
    const pins = pinsFile ? JSON.parse(readFileSync(pinsFile, 'utf8')) : undefined;
    const amendmentFile = pins?.amendmentFile ? resolve(dirname(pinsFile), pins.amendmentFile) : undefined;
    const { stamp } = checkRecords({ pins, amendmentFile, mode: at('--mode') ?? 'counted' });
    delete stamp.amendment02;
    console.log(JSON.stringify({ ok: true, ...stamp, amendmentFile: relative(REPO_ROOT, amendmentFile ?? join(REPO_ROOT, DIR, 'amendment-01.json')), checkedAt: new Date().toISOString() }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}
