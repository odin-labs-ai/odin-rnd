import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_TARBALL, stageWorkspace } from '../experiments/jev-gate/run_reviewer.mjs';
import { checkRecords } from '../experiments/jev-gate/runner-guard.mjs';
import { gitgit } from '../experiments/nina-changes/vendored-exp005.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';
import { BASE_COMMIT, deriveBaseLines, lineHash, loadBaseLines, render as renderBaseLines } from '../experiments/nina-changes/base-lines.mjs';
import { classifyDiffSeen, diffLineHits, grepLinesFor, stripReadPrefix, untrackedEntries } from '../experiments/nina-changes/diff-seen.mjs';
import { fingerprintItem, fingerprints, loadFingerprints, MIN_CHARS, render as renderFingerprints } from '../experiments/nina-changes/fingerprints.mjs';
import { baseOnlyCalls, readOutput, seenCalls, workspaceView } from '../experiments/nina-changes/fixtures/synthetic6.mjs';

// EXP 006 WO-1-03: change fingerprints, the base line set, and the diff-seen classifier (R2-2 as replaced by R3-2 and
// R4-4). The live-fixture test (a real Read and Grep tool_result from the phase-B probe) is added in phase B.

const JEV = 'experiments/jev-gate';
const fp = loadFingerprints();
const baseLines = loadBaseLines();
const baseSet = new Set(baseLines.sha256s);
const ids = Object.keys(fp.items).sort();
const patch = id => readFileSync(`${JEV}/corpus/${id}.patch`, 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ADD_FILE_ITEMS = ['c007', 'c012', 'c013', 'c020', 'c023', 'c035', 'c036', 'c037', 'c038', 'c048', 'c052', 'c054', 'c059', 'c060'];
const AT_MINIMUM = ['c009', 'c019', 'c021', 'c025', 'c026', 'c031', 'c034', 'c041', 'c049', 'c057'];

test('change-fingerprints.json is exactly what fingerprints.mjs computes from the corpus and base-lines.json', () => {
  assert.equal(readFileSync('experiments/nina-changes/change-fingerprints.json', 'utf8'), renderFingerprints(fingerprints()));
  assert.equal(fp.corpusSha256, 'a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9');
  assert.equal(fp.baseLinesSha256, sha256(readFileSync('experiments/nina-changes/base-lines.json')));
  assert.equal(fp.baseCommit, BASE_COMMIT);
});

test('every one of the 60 items keeps at least one fingerprint; 14 add-file items, 9 add-only; the minimum is 1', () => {
  assert.equal(ids.length, 60);
  const count = id => fp.items[id].plus.length + fp.items[id].minus.length;
  for (const id of ids) assert.ok(count(id) >= 1, `${id} has no fingerprint`);
  assert.equal(fp.summary.minFingerprints, 1);
  assert.deepEqual(ids.filter(id => count(id) === 1), AT_MINIMUM);
  assert.equal(fp.summary.maxFingerprints, Math.max(...ids.map(count)));
  assert.deepEqual(ids.filter(id => fp.items[id].added.length), ADD_FILE_ITEMS);
  assert.equal(fp.summary.addOnlyItems, 9);
  // c018: the pure 100% rename has no hunk; its modify hunks carry the fingerprints (rule a).
  assert.deepEqual(fp.items.c018.renames, [{ from: 'src/domain/errors.ts', to: 'src/domain/domain-error.ts' }]);
  assert.ok(fp.items.c018.plus.length >= 1 && fp.items.c018.minus.length >= 1);
});

test('the base line set is the staged base commit\'s, and no + fingerprint is a base line (CI: from the committed hashes)', () => {
  assert.equal(baseLines.baseCommit, BASE_COMMIT);
  assert.equal(baseLines.count, baseLines.sha256s.length);
  assert.deepEqual(baseLines.sha256s, [...new Set(baseLines.sha256s)].sort());
  for (const id of ids) {
    for (const line of fp.items[id].plus) {
      assert.ok(!baseSet.has(lineHash(line)), `${id}: + fingerprint is a base line`);
      assert.ok(line.length >= MIN_CHARS && line === line.trim());
    }
    for (const line of fp.items[id].minus) assert.ok(line.length >= MIN_CHARS && line === line.trim());
  }
  // The committed base app and rules.txt are in the set (the nina-written files are, too: see the tarball test).
  for (const file of ['rules.txt', 'base/src/domain/money.ts', 'base/package.json']) {
    for (const line of readFileSync(join(JEV, file), 'utf8').split('\n')) {
      if (file === 'base/package.json') continue; // nina init rewrites package.json (scripts); its committed bytes differ
      assert.ok(baseSet.has(lineHash(line)), `${file}: ${line}`);
    }
  }
});

const haveTarball = existsSync(DEFAULT_TARBALL);
test('base-lines.json re-derives byte for byte from a fresh stage of the real base (tarball, local only)', { skip: haveTarball ? false : 'no pinned nina tarball (local only)', timeout: 120_000 }, () => {
  assert.equal(renderBaseLines(deriveBaseLines()), readFileSync('experiments/nina-changes/base-lines.json', 'utf8'));
});

test('a synthetic SEEN record for EACH of the 60 items classifies SEEN (Read prefixes N→ and N<TAB>)', () => {
  for (const prefix of ['arrow', 'tab']) {
    const got = ids.filter(id => classifyDiffSeen({ calls: seenCalls(patch(id), { prefix }), fp: fp.items[id] }).seen);
    assert.deepEqual(got, ids, `${prefix}: ${ids.filter(id => !got.includes(id)).join(', ')} not seen`);
  }
  // Add-only items can only be seen by rule (b): git diff shows nothing for untracked files.
  for (const id of ADD_FILE_ITEMS.filter(i => !fp.items[i].modified.length)) assert.equal(classifyDiffSeen({ calls: seenCalls(patch(id)), fp: fp.items[id] }).rule, 'b', id);
});

function baseFiles() {
  const out = {};
  const walk = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else out[relative(`${JEV}/base`, p)] = readFileSync(p, 'utf8'); } };
  walk(`${JEV}/base`);
  out['rules.txt'] = readFileSync(`${JEV}/rules.txt`, 'utf8');
  return out;
}

test('a base-only record (git show HEAD, git log -p, a Read of every base file, a refused diff) classifies BLIND for all 60', () => {
  const files = baseFiles();
  const calls = baseOnlyCalls(files);
  const seen = ids.filter(id => classifyDiffSeen({ calls, fp: fp.items[id] }).seen);
  assert.deepEqual(seen, []);
});

test('a base-only record of the REAL staged base (nina-written files included) classifies BLIND for all 60 (tarball, local only)', { skip: haveTarball ? false : 'no pinned nina tarball (local only)', timeout: 120_000 }, () => {
  const { prereg, amendment } = checkRecords({ mode: 'practice' });
  const parent = scratchDir('nc-base');
  try {
    const staged = stageWorkspace({ prereg, amendment, patch: null, tarball: DEFAULT_TARBALL, parent });
    const git = gitgit(staged.repo);
    const files = Object.fromEntries(git('ls-tree', '-r', '--name-only', '-z', 'HEAD').stdout.split('\0').filter(Boolean).map(f => [f, git('show', `HEAD:${f}`).stdout]));
    assert.ok(Object.keys(files).some(f => f.startsWith('.claude/')), 'the nina-written files are in the base commit');
    const calls = baseOnlyCalls(files);
    assert.deepEqual(ids.filter(id => classifyDiffSeen({ calls, fp: fp.items[id] }).seen), []);
  } finally { removeScratch(parent); }
});

// ------------------------------------------------------------------ the committed per-run table (synthetic records)

const bash = (command, output, isError = false) => ({ tool: 'Bash', input: { command }, isError, output });
const view = id => workspaceView(patch(id));
const readAdded = (id, path, prefix = 'arrow') => ({ tool: 'Read', input: { file_path: `<ws>/repo/${path}` }, isError: false, output: readOutput(view(id).added[path], prefix) });
const refused = bash('git status --short > "$TMPDIR/st.txt" 2>&1; git diff > "$TMPDIR/d.txt"', 'Claude requested permissions to use Bash, but you haven\'t granted it yet.', true);
const readRules = { tool: 'Read', input: { file_path: 'rules.txt' }, isError: false, output: readOutput(readFileSync(`${JEV}/rules.txt`, 'utf8').split('\n')) };

const CASES = {
  'seen: plain git diff (c004)': ['c004', () => [bash('git status --short', view('c004').status), bash('git diff', view('c004').diff)]],
  'seen: git -C <ws> --no-pager diff (c004)': ['c004', () => [bash('git -C <ws>/repo --no-pager diff', view('c004').diff)]],
  'blind: the diff refused, the base tree read (c004)': ['c004', () => [refused, readRules]],
  'blind-then-seen: refused first, then a fallback (c004)': ['c004', () => [refused, readRules, bash('git status --short && git --no-pager diff', `${view('c004').status}${view('c004').diff}`)]],
  'seen: the diff ran but the client set is_error (its cwd-tracking write under the sandbox, observed live) (c004)': ['c004', () => [bash('git diff', `Exit code 1\n${view('c004').diff}zsh:1: operation not permitted: <tmp>/claude-session/cwd-0000`, true)]],
  'blind: the diff call refused (listed in permission_denials) (c004)': ['c004', () => [{ ...bash('git diff', view('c004').diff, true), refused: true }]],
  'blind: a refusal text on an is_error call, no refused flag (c004)': ['c004', () => [bash('git -C <ws>/repo diff', 'Permission to use Bash with command git -C <ws>/repo diff has been denied.', true)]],
  'blind: harness failure despite a seen diff (c004)': ['c004', () => [bash('git diff', view('c004').diff)], 'timeout'],
  'blind: empty git diff on an add-only change, nothing read (c013)': ['c013', () => [bash('git diff', ''), bash('git status --short', '?? src/jobs/\n')]],
  'seen: dir-only status and a Read of the added file (c013)': ['c013', () => [bash('git status --short', '?? src/jobs/\n'), readAdded('c013', 'src/jobs/purge-orders.ts')]],
  'seen: dir-only status and a Read with the tab prefix (c013)': ['c013', () => [bash('git status --short', '?? src/jobs/\n'), readAdded('c013', 'src/jobs/purge-orders.ts', 'tab')]],
  'blind: the added file read, but no untracked status entry (c013)': ['c013', () => [readAdded('c013', 'src/jobs/purge-orders.ts')]],
  'seen: long-form status, the new directory under "Untracked files:", and a Read (c013)': ['c013', () => [bash('git status', 'On branch main\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tsrc/jobs/\n\nnothing added to commit but untracked files present (use "git add" to track)\n'), readAdded('c013', 'src/jobs/purge-orders.ts')]],
  'blind: long-form status naming the path only under "Changes not staged", and a Read (c013)': ['c013', () => [bash('git status', 'On branch main\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n\tmodified:   src/jobs/purge-orders.ts\n\tsrc/jobs/\n\nno changes added to commit\n'), readAdded('c013', 'src/jobs/purge-orders.ts')]],
  'blind: status names the path, the Read is of another file (c013)': ['c013', () => [bash('git status --short', '?? src/jobs/\n'), readRules]],
  'seen: status + Grep content lines path:N: (c013)': ['c013', () => [bash('git status --short', '?? src/jobs/\n'), { tool: 'Grep', input: { pattern: '.', path: 'src', output_mode: 'content' }, isError: false, output: view('c013').added['src/jobs/purge-orders.ts'].map((l, i) => `src/jobs/purge-orders.ts:${i + 1}:${l}`).join('\n') }]],
  'seen: status + GNU grep ./path-N- context lines (c013)': ['c013', () => [bash('git status --short', '?? src/jobs/\n'), { tool: 'Grep', input: { pattern: '.', path: '.', output_mode: 'content' }, isError: false, output: view('c013').added['src/jobs/purge-orders.ts'].map((l, i) => `./src/jobs/purge-orders.ts-${i + 1}-${l}`).join('\n') }]],
  'seen: rename item through its modify hunks (c018)': ['c018', () => [bash('git diff', view('c018').diff)]],
  'seen: mixed modify + add, by the diff alone (c012)': ['c012', () => [bash('git diff', view('c012').diff)]],
  'seen: two added files, status + one Read (c052)': ['c052', () => [bash('git status --short', view('c052').status), readAdded('c052', 'src/infra/files/csv.ts')]],
  'blind: sign mismatch, a - fingerprint printed with + (c004)': ['c004', () => [bash('git diff', fp.items.c004.minus.map(l => `+${l}`).join('\n'))]],
  'blind: a fingerprint as a substring of a longer line (c004)': ['c004', () => [bash('git diff', fp.items.c004.plus.map(l => `+${l} // extra`).join('\n'))]],
  'blind: the fingerprint in a non-git Bash output (c004)': ['c004', () => [bash('cat src/app/place-order.ts', fp.items.c004.plus.map(l => `+${l}`).join('\n'))]],
  'blind: base commit shown (c004)': ['c004', () => baseOnlyCalls(baseFiles()).slice(0, 2)],
};

export function table() {
  return Object.entries(CASES).map(([name, [id, calls, harnessFailure = null]]) => {
    const r = classifyDiffSeen({ calls: calls(), fp: fp.items[id], harnessFailure });
    return { case: name, id, seen: r.seen, rule: r.rule };
  });
}

test('the committed per-run table (seen, blind, blind-then-seen, is_error, empty diff, dir-only status, rename, mixed) holds', () => {
  const committed = JSON.parse(readFileSync('experiments/nina-changes/fixtures/diff-seen-table.json', 'utf8'));
  const got = table();
  assert.deepEqual(got, committed.runs);
  // Each case's name states the expected class; the table must agree with it.
  for (const r of got) assert.equal(r.seen, /^(seen|blind-then-seen):/.test(r.case), r.case);
});

test('prefix and entry parsers: Read N→ and N<TAB>, Grep path:N: / path-N- / path:, untracked ?? entries', () => {
  assert.equal(stripReadPrefix('     12→  const x = 1;'), '  const x = 1;');
  assert.equal(stripReadPrefix('    12\t  const x = 1;'), '  const x = 1;');
  assert.equal(stripReadPrefix('no prefix'), 'no prefix');
  const grep = output => ({ tool: 'Grep', input: { path: 'src' }, isError: false, output });
  assert.deepEqual(grepLinesFor(grep('src/a-1-b.ts:3:x = 1\nsrc/a-1-b.ts-4-y = 2\nsrc/other.ts:1:z'), 'src/a-1-b.ts'), ['x = 1', 'y = 2']);
  assert.deepEqual(grepLinesFor(grep('<ws>/repo/src/a.ts:7:q'), 'src/a.ts'), ['q']);
  assert.deepEqual(grepLinesFor({ tool: 'Grep', input: { path: 'src/a.ts' }, isError: false, output: '7:q\n8-r' }, 'src/a.ts'), ['q', 'r']);
  assert.deepEqual(untrackedEntries('?? src/jobs/\n M src/app/index.ts\n?? test/x.ts\n'), ['src/jobs/', 'test/x.ts']);
  assert.deepEqual(diffLineHits('+  const skipCreditCheck = process.env.SKIP_CREDIT_CHECK === \'1\';\n', fp.items.c004), ['+const skipCreditCheck = process.env.SKIP_CREDIT_CHECK === \'1\';']);
});

// ------------------------------------------------------------------ R4-4: the REAL Read and Grep tool_result formats

test('R4-4: the classifier strips the prefixes a REAL Read and a REAL Grep (content mode) carried (live fixtures)', () => {
  const live = JSON.parse(readFileSync('experiments/nina-changes/fixtures/live-read-grep.json', 'utf8'));
  assert.equal(live.source.sha256, sha256(readFileSync(live.source.file)), 'the fixture names its probe record by sha');
  const record = JSON.parse(readFileSync(live.source.file, 'utf8')).calls[0].toolCalls;
  for (const k of ['read', 'readRules', 'grep', 'statusLong']) assert.deepEqual(record[live[k].n].output, live[k].output, `${k} is the record's own output`);
  // Read: `N<TAB>text`, unpadded. Stripped, the lines are the file's (money.ts: the base file plus the probe's marker).
  const base = readFileSync(`${JEV}/base/src/domain/money.ts`, 'utf8').replace(/\n$/, '').split('\n');
  const got = live.read.output.split('\n').map(stripReadPrefix);
  assert.deepEqual(got.slice(0, base.length), base);
  assert.match(got[base.length], /^\/\/ PROBE-DIFF-[0-9a-f]{16}$/);
  assert.deepEqual(got.slice(base.length + 1), [''], 'the Read numbers the empty line after the final newline too');
  assert.deepEqual(live.readRules.output.split('\n').map(stripReadPrefix), readFileSync(`${JEV}/rules.txt`, 'utf8').split('\n'));
  // Grep content mode: `path:N:text`, path relative to the working directory.
  const settings = readFileSync(`${JEV}/base/src/config/settings.ts`, 'utf8').split('\n');
  assert.deepEqual(grepLinesFor(live.grep, 'src/config/settings.ts'), settings.filter(l => l.includes('INVOICE_PREFIX')));
  // The same formats decide rule (b) on an add-only change (c013): a ?? entry plus the added file read or grepped.
  const lines = view('c013').added['src/jobs/purge-orders.ts'];
  const status = bash('git status --short', '?? src/jobs/\n');
  const realRead = { tool: 'Read', input: { file_path: '<ws>/repo/src/jobs/purge-orders.ts' }, isError: false, refused: false, output: lines.map((l, i) => `${i + 1}\t${l}`).join('\n') };
  const realGrep = { tool: 'Grep', input: { pattern: '.', path: 'src', output_mode: 'content', '-n': true }, isError: false, refused: false, output: lines.map((l, i) => `src/jobs/purge-orders.ts:${i + 1}:${l}`).join('\n') };
  assert.equal(live.read.output.split('\n')[0].replace(/^1\t/, '').length > 0 && /^1\t/.test(live.read.output), true, 'the live format is the one mirrored here');
  assert.deepEqual(classifyDiffSeen({ calls: [status, realRead], fp: fp.items.c013 }).rule, 'b');
  assert.deepEqual(classifyDiffSeen({ calls: [status, realGrep], fp: fp.items.c013 }).rule, 'b');
  assert.equal(classifyDiffSeen({ calls: [status, { ...realRead, refused: true }], fp: fp.items.c013 }).seen, false);
});

test('D2: the LIVE long-form status (C11) yields exactly its "Untracked files:" entries, never the modified path; p04 via long form', () => {
  const live = JSON.parse(readFileSync('experiments/nina-changes/fixtures/live-read-grep.json', 'utf8'));
  assert.equal(live.statusLong.input.command, 'git status && git diff');
  assert.match(live.statusLong.output, /Changes not staged for commit:[\s\S]*modified:\s+src\/domain\/money\.ts[\s\S]*Untracked files:/);
  assert.deepEqual(untrackedEntries(live.statusLong.output), ['canary-link.txt', 'link-r43']);
  // p04 (an added file in a new directory) seen through a long-form status in the live format, then a real-format Read.
  const p04 = JSON.parse(readFileSync('experiments/nina-changes/practice/practice-rows.json', 'utf8')).items.find(i => i.id === 'p04');
  const pfp = fingerprintItem(p04.patch, baseSet);
  const longForm = live.statusLong.output.replace('\tcanary-link.txt\n\tlink-r43\n', '\tsrc/reports/\n');
  assert.deepEqual(untrackedEntries(longForm), ['src/reports/']);
  const lines = workspaceView(p04.patch).added['src/reports/revenue.ts'];
  const read = { tool: 'Read', input: { file_path: '<ws>/repo/src/reports/revenue.ts' }, isError: false, refused: false, output: lines.map((l, i) => `${i + 1}\t${l}`).join('\n') };
  assert.equal(classifyDiffSeen({ calls: [bash('git status && git diff', longForm), read], fp: pfp }).rule, 'b');
  assert.equal(classifyDiffSeen({ calls: [bash('git status && git diff', live.statusLong.output), read], fp: pfp }).seen, false, 'the live output names other untracked paths only');
});

test('N2: the known false-BLIND forms are pinned BLIND (documented behaviour, not a silent gap)', () => {
  const d = view('c004').diff, esc = String.fromCharCode(27);
  const forms = {
    'git diff --color=always': d.split('\n').map(l => (/^[+-]/.test(l) ? `${esc}[3${l[0] === '+' ? 2 : 1}m${l}${esc}[m` : l)).join('\n'),
    'git diff --word-diff': d.split('\n').map(l => (l.startsWith('+') && !l.startsWith('+++') ? `{+${l.slice(1)}+}` : l.startsWith('-') && !l.startsWith('---') ? `[-${l.slice(1)}-]` : l)).join('\n'),
    'git diff -R': d.split('\n').map(l => (l.startsWith('+') && !l.startsWith('+++') ? `-${l.slice(1)}` : l.startsWith('-') && !l.startsWith('---') ? `+${l.slice(1)}` : l)).join('\n'),
  };
  for (const [command, output] of Object.entries(forms)) assert.equal(classifyDiffSeen({ calls: [bash(command, output)], fp: fp.items.c004 }).seen, false, command);
  // Untracked entries in forms rule (b) does not read: porcelain v2, NUL-separated -z, long-form from a subdirectory.
  for (const [command, output] of [['git status --porcelain=v2', '? src/jobs/\n'], ['git status --short -z', '?? src/jobs/\0'], ['git status (from test/)', 'On branch main\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\t../src/jobs/\n\n']]) {
    assert.equal(classifyDiffSeen({ calls: [bash(command, output), readAdded('c013', 'src/jobs/purge-orders.ts')], fp: fp.items.c013 }).seen, false, command);
  }
});

test('N9: a git call is a Bash command whose first token is git; N10: only top-level calls count (sub-agent calls do not)', () => {
  const lines = fp.items.c004.plus.map(l => `+${l}`).join('\n');
  assert.equal(classifyDiffSeen({ calls: [bash('git diff', lines)], fp: fp.items.c004 }).seen, true);
  for (const command of ['echo git diff', 'cat x; git diff', 'digit diff', 'sh -c "git diff"']) assert.equal(classifyDiffSeen({ calls: [bash(command, lines)], fp: fp.items.c004 }).seen, false, command);
  assert.equal(classifyDiffSeen({ calls: [{ ...bash('git diff', lines), parentToolUseId: 'toolu_task_1' }], fp: fp.items.c004 }).seen, false, 'a sub-agent call never makes a run SEEN');
  assert.equal(classifyDiffSeen({ calls: [{ ...bash('git diff', lines), parentToolUseId: null }], fp: fp.items.c004 }).seen, true);
});

test('N11: a coloured git status is a known false-BLIND form (pinned BLIND)', () => {
  const esc = String.fromCharCode(27);
  const coloured = `${esc}[31m??${esc}[m src/jobs/\n`;
  assert.equal(classifyDiffSeen({ calls: [bash('git -c color.status=always status --short', coloured), readAdded('c013', 'src/jobs/purge-orders.ts')], fp: fp.items.c013 }).seen, false);
});
