import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NOT_BEFORE, PREREG_SHA256, SERVED_URL } from '../experiments/blueprint-floor/freeze.mjs';
import { BASE_DIR, censusStateDir, checkBaseTree, checkCensusRun, diskTreeHex, GIT_GUARD_ARGS, gitBaseChecks, guardGitEnv, codeShas, fetchServed, gitIn, PINS, readPins, recheckServed, REPO_ROOT, RUNNER_FILES, sha256 } from '../experiments/blueprint-floor/census-guard.mjs';
import { LEDGER } from '../experiments/blueprint-floor/census-spend.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 007 WO-2-01: the freeze and the census guard, in the frozen state (the committed freeze.mjs) and the unfrozen one
// (an injected null freeze), with the served-record fetch stubbed (the real fetch refuses under the test runner).

const PREREG = 'experiments/blueprint-floor/preregistration.json';
const preregBytes = readFileSync(join(REPO_ROOT, PREREG));
const served = async () => preregBytes;
const realGit = gitIn(REPO_ROOT);
const STATE = scratchDir('bf-freeze-state');
const AFTER = new Date(Date.parse(NOT_BEFORE) + 1000);
const frozenArgs = over => ({ mode: 'counted', now: AFTER, fetch: served, git: realGit, stateDir: STATE, ...over });
/** The real git, with some answers replaced (B1 / B3 cases). */
const gitWith = answers => (args, input) => { const k = args.join(' '); for (const [re, out] of answers) if (re.test(k)) return out; return realGit(args, input); };

test('the freeze holds the published record: its sha256, and the odin-rnd #25 mergedAt as the not-before', () => {
  assert.equal(PREREG_SHA256, 'ee56929ab38de831d618a41b9a2f359d814fc01849d273060e590669e94c9edb');
  assert.equal(sha256(preregBytes), PREREG_SHA256, 'the pre-registration on disk is the frozen one');
  assert.equal(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.sha256'), 'utf8').split(/\s/)[0], PREREG_SHA256);
  assert.equal(NOT_BEFORE, '2026-10-03T12:09:42Z');
  assert.match(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/freeze.mjs'), 'utf8'), /gh pr view 25 -R odin-labs-ai\/odin-rnd --json mergedAt/, 'the command that read the not-before is recorded');
  assert.equal(SERVED_URL, 'https://odin-labs-ai.github.io/odin-rnd/data/blueprint-floor/preregistration.json');
});

test('runners.sha256 pins every file on the counted path, and matches the files on disk', () => {
  const pins = readPins();
  assert.deepEqual(Object.keys(pins), RUNNER_FILES, 'the pins file lists exactly the counted-path files, in order');
  assert.deepEqual(pins, codeShas(), 'a counted-path file changed: rerun node experiments/blueprint-floor/census-guard.mjs --write-pins');
  for (const f of ['census-run.mjs', 'census-gate.mjs', 'census-guard.mjs', 'census-spend.mjs', 'freeze.mjs', 'adapter.mjs', 'whitelist.mjs', 'whitelist.json', 'scorer.mjs', 'protocol.mjs', 'contract.md', 'contract-module-graph.md', 'prompts/translator.md', 'prompts/adjudicator.md', 'prompts/canary.md', 'rules/selection.json', 'controls/positive.json', 'controls/negative.json', 'controls/practice.json']) assert(RUNNER_FILES.includes(`experiments/blueprint-floor/${f}`), f);
  assert.equal(RUNNER_FILES.filter(f => /\/rules\/[^/]+\.json$/.test(f) && !f.endsWith('selection.json')).length, 8, 'every plugin rule file');
});

test('frozen: the guard passes after the not-before with the served copy byte-identical, and records the fetch', async () => {
  const stamp = await checkCensusRun(frozenArgs());
  assert.equal(stamp.preregSha256, PREREG_SHA256);
  assert.equal(stamp.notBefore, NOT_BEFORE);
  assert.equal(stamp.codeMatchesPins, true);
  assert.deepEqual([stamp.served.url, stamp.served.sha256], [SERVED_URL, PREREG_SHA256]);
  assert.ok(Number.isFinite(Date.parse(stamp.served.fetchedAt)));
  const practice = await checkCensusRun(frozenArgs({ mode: 'practice' }));
  assert.equal(practice.served.sha256, PREREG_SHA256, 'a practice (canary) call passes the same guard');
});

test('unfrozen: a null freeze refuses every mode', async () => {
  for (const mode of ['practice', 'counted', 'rehearsal']) {
    for (const freeze of [{ PREREG_SHA256: null, NOT_BEFORE }, { PREREG_SHA256, NOT_BEFORE: null }, { PREREG_SHA256: null, NOT_BEFORE: null }]) {
      await assert.rejects(checkCensusRun(frozenArgs({ mode, freeze })), /waits for the freeze/, `${mode} ${JSON.stringify(freeze)}`);
    }
  }
});

test('frozen, but each condition broken in turn: the guard refuses', async () => {
  await assert.rejects(checkCensusRun(frozenArgs({ now: new Date(NOT_BEFORE) })), /not after the not-before/, 'exactly at the not-before');
  await assert.rejects(checkCensusRun(frozenArgs({ now: new Date('2026-10-03T12:00:00Z') })), /not after the not-before/);
  await assert.rejects(checkCensusRun(frozenArgs({ freeze: { PREREG_SHA256: 'a'.repeat(64), NOT_BEFORE } })), /hashes to ee56929a/, 'another frozen sha');
  await assert.rejects(checkCensusRun(frozenArgs({ freeze: { PREREG_SHA256, NOT_BEFORE: '2026-10-03 12:09:42' } })), /not an ISO 8601 UTC time/);
  await assert.rejects(checkCensusRun(frozenArgs({ fetch: async () => Buffer.concat([preregBytes, Buffer.from(' ')]) })), /site serves a pre-registration hashing to/, 'the served copy differs');
  await assert.rejects(checkCensusRun(frozenArgs({ fetch: async () => { throw new Error('HTTP 404'); } })), /could not be fetched: HTTP 404/);
  await assert.rejects(checkCensusRun(frozenArgs({ git: gitWith([[/^show HEAD:/, { status: 128, stdout: '' }]]) })), /spend-ledger\.jsonl is not committed at HEAD/);
  await assert.rejects(checkCensusRun(frozenArgs({ ledgerPath: join(REPO_ROOT, 'experiments/blueprint-floor/other-ledger.jsonl') })), /appends to the committed ledger/);
  await assert.rejects(checkCensusRun(frozenArgs({ mode: 'probe' })), /unknown mode/);
  // The default fetch never reaches the network under the test runner.
  await assert.rejects(fetchServed(SERVED_URL), /not fetched under the Node test runner/);
  await assert.rejects(checkCensusRun({ mode: 'counted', now: AFTER, git: realGit, stateDir: STATE }), /could not be fetched: the served pre-registration is not fetched under the Node test runner/);
  await assert.rejects(recheckServed({ expected: PREREG_SHA256, fetch: async () => Buffer.from('x') }), /site serves a pre-registration hashing to/, 'the per-rule re-check (N4)');
  assert.equal((await recheckServed({ expected: PREREG_SHA256, fetch: served })).sha256, PREREG_SHA256);
});

test('a rehearsal checks the same freeze and pins, fetches nothing and takes a scratch ledger', async () => {
  let fetched = false;
  const stamp = await checkCensusRun({ mode: 'rehearsal', now: AFTER, fetch: async () => { fetched = true; return preregBytes; }, ledgerPath: '/nonexistent/ledger.jsonl', git: realGit, stateDir: STATE });
  assert.deepEqual([stamp.rehearsal, stamp.served, fetched], [true, null, false]);
});

test('a counted-path file or a pre-registration pin that drifts refuses the guard (on a copy of the tree)', async () => {
  const root = scratchDir('bf-freeze');
  try {
    // The committed ledger too: the guard (git from the real repo) requires the copy's ledger to start with HEAD's bytes.
    for (const rel of [...new Set([...RUNNER_FILES, PINS, PREREG, LEDGER, ...Object.keys(JSON.parse(preregBytes).files)])]) { mkdirSync(join(root, rel, '..'), { recursive: true }); cpSync(join(REPO_ROOT, rel), join(root, rel)); }
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
    const args = over => frozenArgs({ root, baseRoot: REPO_ROOT, ledgerPath: join(root, LEDGER), ...over }); // git and the base tree from the real repo
    await checkCensusRun(args());
    writeFileSync(join(root, 'experiments/blueprint-floor/census-run.mjs'), `${readFileSync(join(root, 'experiments/blueprint-floor/census-run.mjs'), 'utf8')}\n// drift\n`);
    await assert.rejects(checkCensusRun(args()), /counted-path code differs from experiments\/blueprint-floor\/runners\.sha256 \(experiments\/blueprint-floor\/census-run\.mjs\)/);
    await assert.rejects(checkCensusRun(args({ mode: 'rehearsal' })), /counted-path code differs/, 'a rehearsal runs the pinned code too');
    cpSync(join(REPO_ROOT, 'experiments/blueprint-floor/census-run.mjs'), join(root, 'experiments/blueprint-floor/census-run.mjs'));
    writeFileSync(join(root, 'experiments/blueprint-floor/scorer.mjs'), `${readFileSync(join(root, 'experiments/blueprint-floor/scorer.mjs'), 'utf8')} `);
    await assert.rejects(checkCensusRun(args()), /the pre-registration pins experiments\/blueprint-floor\/scorer\.mjs/);
  } finally { removeScratch(root); }
});

test('the committed ledger exists, is committed at HEAD, and holds no line from before the not-before (none at all in bundle 1)', () => {
  assert.equal(realGit(['show', `HEAD:${LEDGER}`]).status, 0);
  const lines = readFileSync(join(REPO_ROOT, LEDGER), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const l of lines) assert(Date.parse(l.ts) > Date.parse(NOT_BEFORE), `a ledger line at ${l.ts}`);
});

test('B1: the base tree is the pinned one at run time; a mismatched tree or an untracked or ignored file under it refuses (frozen and unfrozen)', async () => {
  const prereg = JSON.parse(preregBytes);
  const stamp = await checkCensusRun(frozenArgs());
  assert.deepEqual(stamp.base, { tree: prereg.adapter.baseTree, clean: true }, 'recorded in the stamp every header carries');
  assert.equal(realGit(['rev-parse', `HEAD:${BASE_DIR}`]).stdout.trim(), '957b5e10c099ef2c86bb4543a8560aba59290d62');
  const wrongTree = gitWith([[/^rev-parse HEAD:experiments\/jev-gate\/base$/, { status: 0, stdout: `${'e'.repeat(40)}\n` }]]);
  const untracked = gitWith([[/^status --porcelain --ignored -- experiments\/jev-gate\/base$/, { status: 0, stdout: '?? experiments/jev-gate/base/src/app/extra.ts\n' }]]);
  const ignored = gitWith([[/^status --porcelain --ignored/, { status: 0, stdout: '!! experiments/jev-gate/base/.DS_Store\n' }]]);
  for (const mode of ['counted', 'practice', 'rehearsal']) {
    await assert.rejects(checkCensusRun(frozenArgs({ mode, git: wrongTree })), /HEAD:experiments\/jev-gate\/base is e{40}, not the pinned base tree 957b5e10/, `${mode}: a mismatched tree`);
    await assert.rejects(checkCensusRun(frozenArgs({ mode, git: untracked })), /has changed, untracked or ignored files: \?\? experiments\/jev-gate\/base\/src\/app\/extra\.ts/, `${mode}: an untracked file`);
    await assert.rejects(checkCensusRun(frozenArgs({ mode, git: ignored })), /untracked or ignored files: !! /, `${mode}: an ignored file`);
    // Unfrozen: the freeze refusal comes first, whatever the base tree.
    await assert.rejects(checkCensusRun(frozenArgs({ mode, git: untracked, freeze: { PREREG_SHA256: null, NOT_BEFORE } })), /waits for the freeze/);
  }
});

test('B3: the guard refuses a ledger that does not start with HEAD\'s bytes or lacks the shared mirror; the state dir is the git common dir\'s', async () => {
  const dir = scratchDir('bf-ledger-guard');
  try {
    const line = l => `${JSON.stringify({ ts: '2026-10-04T00:00:00Z', kind: 'counted', ruleId: l, role: 'translator', model: 'm', costUsd: 0.1, costBasis: 'api-equivalent', reportedCostUsd: 0.1, rehearsal: false, callId: l })}\n`;
    const committed = line('a') + line('b');
    const head = gitWith([[/^show HEAD:experiments\/blueprint-floor\/spend-ledger\.jsonl$/, { status: 0, stdout: committed }]]);
    const state = join(dir, 'state'); mkdirSync(state);
    const root = scratchDir('bf-ledger-root');
    try {
      for (const rel of [...new Set([...RUNNER_FILES, PINS, PREREG, ...Object.keys(JSON.parse(preregBytes).files)])]) { mkdirSync(join(root, rel, '..'), { recursive: true }); cpSync(join(REPO_ROOT, rel), join(root, rel)); }
      symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
      const L = join(root, LEDGER);
      const args = over => frozenArgs({ root, baseRoot: REPO_ROOT, ledgerPath: L, git: head, stateDir: state, ...over });
      writeFileSync(L, committed);
      await checkCensusRun(args()); // ledger == HEAD, no mirror yet: allowed (the ledger initialises the mirror)
      writeFileSync(L, line('a'));
      await assert.rejects(checkCensusRun(args()), /integrity check \(ledger-not-head-prefix\)/, 'a truncated ledger');
      writeFileSync(L, committed + line('c'));
      await assert.rejects(checkCensusRun(args()), /integrity check \(mirror-missing\)/, 'an uncommitted line and no mirror');
      writeFileSync(join(state, 'spend-ledger.mirror.jsonl'), committed + line('c'));
      await checkCensusRun(args());
      writeFileSync(L, committed);
      await assert.rejects(checkCensusRun(args()), /integrity check \(ledger-lacks-mirror\)/, 'a ledger reset to HEAD (or another worktree\'s ledger)');
    } finally { removeScratch(root); }
  } finally { removeScratch(dir); }
  assert.equal(censusStateDir(REPO_ROOT), join(resolve(REPO_ROOT, realGit(['rev-parse', '--git-common-dir']).stdout.trim()), 'exp007-census'), 'one state dir per repository, shared by every worktree');
});

/**
 * Refute r4: every base-tree attack refuses through the full guard (the Node byte hash comes first and is authoritative),
 * and the git defence-in-depth layer alone still refuses it with its own reason.
 */
function refusesBoth(prereg, git, repo, re, label) {
  assert.throws(() => checkBaseTree(prereg, git, repo), /EXP 007 census guard refused/, label);
  assert.throws(() => gitBaseChecks(prereg, git, repo), re, label);
}

/** A scratch repository holding a byte-identical copy of the base tree at the same path (its tree id is the pinned one). */
function baseRepo() {
  const repo = scratchDir('bf-base-repo');
  const git = gitIn(repo);
  for (const a of [['init', '-q'], ['config', 'user.email', 'b@example.invalid'], ['config', 'user.name', 'b'], ['config', 'commit.gpgsign', 'false']]) git(a);
  cpSync(join(REPO_ROOT, BASE_DIR), join(repo, BASE_DIR), { recursive: true });
  git(['add', '--', BASE_DIR]); git(['commit', '-q', '-m', 'base']);
  return { repo, git };
}

test('refute r2 B2: the base tree is checked by its bytes: assume-unchanged or skip-worktree edits, extra files and symlinks refuse', () => {
  const prereg = JSON.parse(preregBytes);
  const { repo, git } = baseRepo();
  try {
    assert.deepEqual(checkBaseTree(prereg, git, repo), { tree: prereg.adapter.baseTree, clean: true }, 'a byte-identical copy passes');
    const f = `${BASE_DIR}/src/domain/money.ts`, abs = join(repo, f), orig = readFileSync(abs);
    // assume-unchanged hides the edit from git status: the ls-files tag refuses it.
    git(['update-index', '--assume-unchanged', f]); writeFileSync(abs, `${orig}// edited\n`);
    assert.equal(git(['status', '--porcelain', '--', BASE_DIR]).stdout, '', 'git status is blind to it');
    refusesBoth(prereg, git, repo, /assume-unchanged or skip-worktree.*h experiments\/jev-gate\/base\/src\/domain\/money\.ts/);
    // Even if the tag were reported H, the blob comparison catches the bytes.
    const lying = (args, input) => { const r = git(args, input); return args[0] === 'ls-files' ? { ...r, stdout: r.stdout.replace(/^h /gm, 'H ') } : r; };
    refusesBoth(prereg, lying, repo, /differ from HEAD by their bytes: src\/domain\/money\.ts/);
    git(['update-index', '--no-assume-unchanged', f]); writeFileSync(abs, orig);
    git(['update-index', '--skip-worktree', f]); writeFileSync(abs, `${orig}// edited\n`);
    refusesBoth(prereg, git, repo, /assume-unchanged or skip-worktree.*S experiments\/jev-gate\/base\/src\/domain\/money\.ts/);
    git(['update-index', '--no-skip-worktree', f]); writeFileSync(abs, orig);
    checkBaseTree(prereg, git, repo);
    // An ignored extra file (git status --ignored sees it) and a symlink both refuse.
    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'extra.ts\n');
    writeFileSync(join(repo, BASE_DIR, 'src', 'extra.ts'), 'x\n');
    refusesBoth(prereg, git, repo, /untracked or ignored files: !! /);
    rmSync(join(repo, BASE_DIR, 'src', 'extra.ts'));
    const hidden = (args, input) => (args[0] === 'status' ? { status: 0, stdout: '' } : git(args, input));
    symlinkSync(join(repo, BASE_DIR, 'package.json'), join(repo, BASE_DIR, 'src', 'link.ts'));
    refusesBoth(prereg, hidden, repo, /src\/link\.ts is a symlink/, 'a symlink refuses even when git status says nothing');
    rmSync(join(repo, BASE_DIR, 'src', 'link.ts'));
    writeFileSync(join(repo, BASE_DIR, 'src', 'extra2.ts'), 'x\n');
    refusesBoth(prereg, hidden, repo, /not the tree's \(extra: src\/extra2\.ts/, 'an extra file refuses even when git status says nothing');
  } finally { removeScratch(repo); }
});

test('refute r3 B1, B2, N13: clean filters, autocrlf, replace objects and the exec bit cannot hide a changed base tree', () => {
  const prereg = JSON.parse(preregBytes);
  const f = `${BASE_DIR}/src/domain/money.ts`;
  const hidden = git => (args, input) => (args[0] === 'status' ? { status: 0, stdout: '' } : git(args, input));
  const REFUSED = /differ from HEAD by their bytes|has changed, untracked or ignored files|not the pinned base tree|is executable/;
  // B1: a clean filter that strips the edit makes the edited file hash like the pinned blob; --no-filters hashes the bytes.
  {
    const { repo, git } = baseRepo();
    try {
      writeFileSync(join(repo, '.git', 'info', 'attributes'), '*.ts filter=evil\n');
      git(['config', 'filter.evil.clean', "sed '/edited/d'"]);
      const abs = join(repo, f);
      writeFileSync(abs, `${readFileSync(abs, 'utf8')}// edited\n`);
      refusesBoth(prereg, git, repo, REFUSED);
      refusesBoth(prereg, hidden(git), repo, /differ from HEAD by their bytes: src\/domain\/money\.ts/, 'the bytes, not the cleaned content');
    } finally { removeScratch(repo); }
  }
  // B1: core.autocrlf=true and a CRLF copy of an LF blob.
  {
    const { repo, git } = baseRepo();
    try {
      git(['config', 'core.autocrlf', 'true']);
      const abs = join(repo, f);
      writeFileSync(abs, readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'));
      refusesBoth(prereg, git, repo, REFUSED);
      refusesBoth(prereg, hidden(git), repo, /differ from HEAD by their bytes: src\/domain\/money\.ts/);
    } finally { removeScratch(repo); }
  }
  // B2: git replace <pinned tree> <edited tree>, with the index and the disk made to match the replacement.
  {
    const { repo, git } = baseRepo();
    try {
      const pinned = git(['rev-parse', `HEAD:${BASE_DIR}`]).stdout.trim();
      assert.equal(pinned, prereg.adapter.baseTree);
      const abs = join(repo, f);
      writeFileSync(abs, `${readFileSync(abs, 'utf8')}// edited\n`);
      git(['add', '--', f]);
      const other = git(['write-tree', `--prefix=${BASE_DIR}/`]).stdout.trim();
      assert.notEqual(other, pinned);
      const raw = gitIn(repo);
      assert.equal(raw(['replace', pinned, other]).status, 0);
      refusesBoth(prereg, git, repo, REFUSED, 'the replacement is not seen');
      refusesBoth(prereg, hidden(git), repo, /differ from HEAD by their bytes: src\/domain\/money\.ts/);
    } finally { removeScratch(repo); }
  }
  // N13: core.fileMode=false hides an exec bit from git; the lstat check does not.
  {
    const { repo, git } = baseRepo();
    try {
      git(['config', 'core.fileMode', 'false']);
      chmodSync(join(repo, f), 0o755);
      refusesBoth(prereg, hidden(git), repo, /src\/domain\/money\.ts is executable \(mode 755\)/);
      refusesBoth(prereg, git, repo, REFUSED);
    } finally { removeScratch(repo); }
  }
  // Every guard git call carries the neutralising arguments and the environment.
  assert.deepEqual(GIT_GUARD_ARGS.slice(0, 1), ['--no-replace-objects']);
  for (const c of ['core.autocrlf=false', 'core.fileMode=true', 'core.ignorecase=false']) assert(GIT_GUARD_ARGS.includes(c), c);
});

// ----------------------------------------------------------------------------- refute r4: no git is trusted for the bytes

/** Raw git, unscrubbed, for building the forgeries (never what the guard runs). */
const rawGit = (repo, args, input, env = process.env) => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env, ...(input !== undefined ? { input } : {}) }); return r.stdout.trim(); };
/** The loose-object file of `id` in an objects dir. */
const looseOf = (objects, id) => join(objects, id.slice(0, 2), id.slice(2));
/** Overwrite the loose object `id` with the bytes of loose object `from` (git never re-hashes a loose object it reads). */
function forge(objects, id, fromObjects, from) { chmodSync(looseOf(objects, id), 0o644); writeFileSync(looseOf(objects, id), readFileSync(looseOf(fromObjects, from))); }

test('refute r4 (3): the Node tree hash of the committed base is the pinned id; a one-byte edit is not', () => {
  const prereg = JSON.parse(preregBytes);
  assert.equal(diskTreeHex(join(REPO_ROOT, BASE_DIR)), prereg.adapter.baseTree);
  assert.equal(prereg.adapter.baseTree, '957b5e10c099ef2c86bb4543a8560aba59290d62');
  const { repo } = baseRepo();
  try {
    const f = join(repo, BASE_DIR, 'src', 'domain', 'money.ts');
    const b = readFileSync(f); b[0] ^= 1; writeFileSync(f, b);
    assert.notEqual(diskTreeHex(join(repo, BASE_DIR)), prereg.adapter.baseTree);
    mkdirSync(join(repo, BASE_DIR, 'src', 'empty'));
    assert.throws(() => diskTreeHex(join(repo, BASE_DIR)), /is an empty directory/, 'an empty directory refuses');
  } finally { removeScratch(repo); }
});

test('refute r4 repro 1: a forged src/domain subtree object in .git/objects plus an edited file: git alone is fooled, the guard refuses', () => {
  const prereg = JSON.parse(preregBytes);
  const { repo } = baseRepo();
  try {
    const rel = `${BASE_DIR}/src/domain/money.ts`, abs = join(repo, rel), objects = join(repo, '.git', 'objects');
    const sub = rawGit(repo, ['rev-parse', `HEAD:${BASE_DIR}/src/domain`]);
    writeFileSync(abs, `${readFileSync(abs, 'utf8')}// edited\n`);
    const blob = rawGit(repo, ['hash-object', '-w', '--no-filters', rel]);
    const listing = rawGit(repo, ['ls-tree', sub]).split('\n').map(l => (l.endsWith('\tmoney.ts') ? l.replace(/blob [0-9a-f]{40}/, `blob ${blob}`) : l)).join('\n') + '\n';
    const forgedTree = rawGit(repo, ['mktree'], listing);
    forge(objects, sub, objects, forgedTree);
    rawGit(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
    // git, through the guard's own scrubbed runner, now reports the pinned tree with the edited bytes: the old check passed.
    assert.deepEqual(gitBaseChecks(prereg, gitIn(repo), repo), { tree: prereg.adapter.baseTree, clean: true }, 'the forgery fools every git check');
    assert.throws(() => checkBaseTree(prereg, gitIn(repo), repo), /bytes under experiments\/jev-gate\/base hash to tree [0-9a-f]{40}, not the pinned base tree 957b5e10/);
  } finally { removeScratch(repo); }
});

test('refute r4 repro 2: GIT_OBJECT_DIRECTORY in the census process env pointing at a forged store: scrubbed from every guard git call, and the guard refuses', () => {
  const prereg = JSON.parse(preregBytes);
  const { repo } = baseRepo();
  const store = scratchDir('bf-forged-store');
  const saved = process.env.GIT_OBJECT_DIRECTORY;
  try {
    const rel = `${BASE_DIR}/src/domain/money.ts`, abs = join(repo, rel);
    cpSync(join(repo, '.git', 'objects'), store, { recursive: true });
    const sub = rawGit(repo, ['rev-parse', `HEAD:${BASE_DIR}/src/domain`]);
    writeFileSync(abs, `${readFileSync(abs, 'utf8')}// edited\n`);
    const env = { ...process.env, GIT_OBJECT_DIRECTORY: store };
    const blob = rawGit(repo, ['hash-object', '-w', '--no-filters', rel], undefined, env);
    const listing = rawGit(repo, ['ls-tree', sub]).split('\n').map(l => (l.endsWith('\tmoney.ts') ? l.replace(/blob [0-9a-f]{40}/, `blob ${blob}`) : l)).join('\n') + '\n';
    const forgedTree = rawGit(repo, ['mktree'], listing, env);
    forge(store, sub, store, forgedTree);
    process.env.GIT_OBJECT_DIRECTORY = store;
    assert.equal(guardGitEnv().GIT_OBJECT_DIRECTORY, undefined, 'every GIT_* variable is dropped');
    assert.deepEqual([guardGitEnv().GIT_CONFIG_NOSYSTEM, guardGitEnv().GIT_CONFIG_GLOBAL, guardGitEnv().GIT_NO_REPLACE_OBJECTS], ['1', '/dev/null', '1']);
    assert.match(gitIn(repo)(['rev-parse', '--git-path', 'objects']).stdout.trim(), /^\.git\/objects$/, 'the guard\'s git reads the repository\'s own objects');
    assert.throws(() => checkBaseTree(prereg, gitIn(repo), repo), /hash to tree [0-9a-f]{40}, not the pinned base tree/);
  } finally {
    if (saved === undefined) delete process.env.GIT_OBJECT_DIRECTORY; else process.env.GIT_OBJECT_DIRECTORY = saved;
    removeScratch(store); removeScratch(repo);
  }
});
