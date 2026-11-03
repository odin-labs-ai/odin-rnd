import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDays, dayProblems } from './append-rogue-runs.mjs';
import { canonical, recordHash, recordProblems, RECORD_SCHEMA } from './lab-record.mjs';
import { recountRecord } from './lab-recount.mjs';
import { committedCountsOf, readRedBuild, redBuildProblems } from './lab-red-build.mjs';
import { renderLabRunsSection, RUNS_PAGE, withLabRuns } from './lab-runs.mjs';
import { renderLabs } from './labs.mjs';
import { CLASSES, DIAGNOSES, PATCHES, keepLiveRuns, redBuildCounts, redBuildRecordCounts } from './vendor-red-build.mjs';

// Lab 08 on the org runners as a RECOUNT (vision-plan bundle 3, WO-03): the runner reads the CI doctor's evidence at the
// private main head, names each file by its role, and scripts/lab-recount.mjs counts it with the vendor's own counting.
// The private files are not in this repository, so the test writes synthetic ones in their format from the counts the
// committed record states, and checks the recount agrees with that record, and refuses to agree once a file changes.
const record = readRedBuild('site');
const stated = redBuildRecordCounts(record);
const tallyList = tally => Object.entries(tally).flatMap(([k, n]) => Array(n).fill(k));
function syntheticFiles(c = stated) {
  const verdicts = r => Object.fromEntries(tallyList(r.diagnosis).map((d, i) => [`case-${i}`, { diagnosis: d, patch: tallyList(r.patch)[i] }]));
  const e = c.earlier;
  const diag = tallyList(e.diagnosis), patch = tallyList(e.patch);
  const files = {
    score: {
      total: { cases: c.score.cases, ruled: c.score.ruled, reproduced: c.score.reproduced, passes: c.score.passes, judged_fix: c.score.judgedFix, judged_not: c.score.judgedNot, missed: c.score.missed },
      diagnosis: c.score.diagnosis, patch_verdicts: c.score.patch,
      by_class: CLASSES.map(cls => ({ cls, cases: c.score.byClass[cls] })), rows: [],
    },
    'verdicts-a': verdicts(c.rounds.a),
    'verdicts-b': verdicts(c.rounds.b),
    earlier: {
      by_arm: Object.fromEntries(e.byRun.map(r => [`arm-${r.run}`, { diagnosis: r.diagnosis, patch: r.patch }])),
      rows: diag.map((d, i) => ({ run: `build-${i % e.builds}`, diagnosis: d, patch: patch[i] })),
    },
  };
  return Object.fromEntries(Object.entries(files).map(([role, v]) => [role, Buffer.from(`${JSON.stringify(v, null, 1)}\n`)]));
}
const files = syntheticFiles();
const read = (f = files) => role => { if (!(role in f)) throw new Error(`no ${role}`); return f[role]; };
const where = { runner: 'github-hosted', machineClass: 'ubuntu-latest', image: `node:22-bookworm@sha256:${'a'.repeat(64)}`, commit: 'c'.repeat(40), mainHead: 'c'.repeat(40) };
const hosted = recountRecord('red-build', read(), record, { ...where, ranAt: '2026-11-02T06:05:00Z' });
const org = recountRecord('red-build', read(), record, { ...where, runner: 'org-hosted', machineClass: 'org-ci-heavy', ranAt: '2026-11-02T06:05:40Z' });

test('the synthetic files are in the vendor format: they count to exactly what the record states', () => {
  assert.equal(canonical(redBuildCounts(role => JSON.parse(files[role]))), canonical(stated));
  assert.deepEqual(Object.keys(stated), ['rounds', 'score', 'earlier']);
  for (const k of DIAGNOSES) assert.ok(k in stated.score.diagnosis);
  for (const k of PATCHES) assert.ok(k in stated.score.patch);
});

test('a recount that agrees is a valid record v1: SAME, 0 breaches, its inputs the four counted roles, no name in it', () => {
  assert.deepEqual(recordProblems(hosted), []);
  assert.equal(hosted.result.verdict, 'SAME');
  assert.equal(hosted.result.breaches, 0);
  assert.equal(hosted.command, "the lab's own recount");
  assert.deepEqual(hosted.inputs.map(i => i.role), ['earlier', 'score', 'verdicts-a', 'verdicts-b']);
  for (const i of hosted.inputs) assert.equal(i.sha256, createHash('sha256').update(files[i.role]).digest('hex'));
  assert.deepEqual(hosted.commit, { sha: where.commit, mainHead: where.mainHead, compare: 'identical', onMain: true }, 'this repository\'s own commit, measured against its own main head');
  assert.equal(hosted.result.committed, createHash('sha256').update(canonical(stated)).digest('hex'));
  assert.equal(org.recordHash, hosted.recordHash, 'where and when are not in the hash');
  assert.doesNotMatch(JSON.stringify(hosted), /case-|build-|arm-/, 'no case, build or arm id reaches the record');
});

test('a changed verdict, a lost row or a changed score is DIFFERENT, its differing count groups counted', () => {
  const edit = (role, fn) => { const f = { ...files }; const v = JSON.parse(f[role]); fn(v); f[role] = Buffer.from(JSON.stringify(v)); return f; };
  const one = recountRecord('red-build', read(edit('verdicts-a', v => { v['case-0'].diagnosis = 'wrong'; })), record, { ...where, ranAt: '2026-11-02T06:05:00Z' });
  assert.equal(one.result.verdict, 'DIFFERENT');
  assert.equal(one.result.breaches, 1);
  assert.deepEqual(recordProblems(one), []);
  const two = recountRecord('red-build', read(edit('earlier', v => { v.rows.pop(); })), record, { ...where, ranAt: '2026-11-02T06:05:00Z' });
  assert.equal(two.result.breaches, 1);
  const three = recountRecord('red-build', read(edit('score', v => { v.total.missed += 1; })), record, { ...where, ranAt: '2026-11-02T06:05:00Z' });
  assert.equal(three.result.verdict, 'DIFFERENT');
  assert.equal(three.result.breaches, 1, 'a breach-counting bug in the score group (e.g. ?? null hiding a missing key) must not pass as 0');
  // The published record's counts changing (and not the files) is DIFFERENT too.
  const moved = JSON.parse(JSON.stringify(record));
  moved.heldOut.score.ruled += 1;
  const movedRecount = recountRecord('red-build', read(), moved, { ...where, ranAt: '2026-11-02T06:05:00Z' });
  assert.equal(movedRecount.result.verdict, 'DIFFERENT');
  assert.equal(movedRecount.result.breaches, 1, 'a moved published count must count as a breach, not merely flip the verdict');
});

test('a lab carries only its own command and roles', () => {
  const rehash = x => ({ ...x, recordHash: recordHash(x) });
  assert.ok(recordProblems(rehash({ ...hosted, command: "the lab's own re-run kit" })).some(p => /not the command of lab red-build/.test(p)));
  assert.ok(recordProblems(rehash({ ...hosted, inputs: [{ role: 'frontier', sha256: 'a'.repeat(64) }, { role: 'nina', sha256: 'b'.repeat(64) }] })).some(p => /not the input roles of lab red-build/.test(p)));
  assert.ok(recordProblems(rehash({ ...hosted, lab: 'review' })).some(p => /not the command of lab review/.test(p)));
  // Lab 08 reads the private repository AT main: not a pinned lab, so "ahead" is refused for its org records.
  assert.ok(recordProblems(rehash({ ...hosted, commit: { sha: where.commit, mainHead: 'e'.repeat(40), compare: 'ahead', onMain: true } })).some(p => /reads main, so its commit must be the main head/.test(p)));
});

test('commit.compare/onMain are measured against an independently supplied --main-head, never asserted by construction', () => {
  const stale = recountRecord('red-build', read(), record, { ...where, mainHead: 'd'.repeat(40), ranAt: '2026-11-02T06:05:00Z' });
  assert.deepEqual(stale.commit, { sha: where.commit, mainHead: 'd'.repeat(40), compare: 'diverged', onMain: false });
  // A non-pinned non-laptop runner's record must say identical; a genuinely-measured mismatch is refused, not laundered.
  assert.ok(recordProblems(stale).some(p => /reads main, so its commit must be the main head/.test(p)));
});

// row 15fd283c#1: a run's committed hash is the one property that makes carrying it forward (a re-vendor, or
// appending a fresh org day) mean anything. A planted negative for both carry-forward paths: a prior run computed
// against OLD counts must not be mistaken for a recount of the NEW counts, whichever path carries it.
test('keepLiveRuns (the re-vendor carry-forward check) drops a run whose committed hash belongs to different counts', () => {
  const oldCounts = { rounds: stated.rounds, score: stated.score, earlier: stated.earlier };
  const newCounts = { ...oldCounts, score: { ...oldCounts.score, ruled: oldCounts.score.ruled + 1 } };
  const staleRun = { ...hosted, result: { ...hosted.result, committed: createHash('sha256').update(canonical(oldCounts)).digest('hex') } };
  assert.deepEqual(keepLiveRuns([staleRun], newCounts), [], 'a run committed against the old counts must not be carried forward once the counts moved');
  assert.deepEqual(keepLiveRuns([staleRun], oldCounts), [staleRun], 'a run genuinely committed against the current counts is kept');
});

test('dayProblems (the append-time check) refuses a day whose committed hash belongs to different counts', () => {
  // hosted.result.committed is already sha256(canonical({rounds, score, earlier})) of the REAL published record
  // (recountRecord built it from `record`/`stated` at the top of this file) -- the live case needs no modification.
  const liveHash = hosted.result.committed;
  const staleHash = createHash('sha256').update(canonical({ rounds: stated.rounds, score: { ...stated.score, ruled: stated.score.ruled + 1 }, earlier: stated.earlier })).digest('hex');
  const staleDay = [{ ...hosted, result: { ...hosted.result, committed: staleHash } }];
  assert.ok(dayProblems([], staleDay, { lab: 'red-build', committedCounts: liveHash }).some(p => /result\.committed does not match the currently published counts/.test(p)));
  assert.deepEqual(dayProblems([], [hosted], { lab: 'red-build', committedCounts: liveHash }), [], 'a genuinely live day is not refused');
  // row 67aa267e#1: the binding is not opt-in. A red-build day with no committedCounts is refused outright (exported
  // dayProblems/appendDays included), for a live day as for a stale one; rogue/review never need it.
  for (const d of [staleDay, [hosted]]) assert.deepEqual(dayProblems([], d, { lab: 'red-build' }), ['a red-build day is a recount: it needs committedCounts (the sha256 of the currently published counts), and none was given']);
  assert.throws(() => appendDays({ ...record, runs: [] }, [hosted], { lab: 'red-build' }), /needs committedCounts/);
});

test('the CLI reads the role files and the published record and prints the record; unreadable input is exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab08-'));
  try {
    mkdirSync(join(dir, 'files'));
    for (const [role, b] of Object.entries(files)) writeFileSync(join(dir, 'files', role), b);
    const args = ['scripts/lab-recount.mjs', 'red-build', '--files', join(dir, 'files'), '--main-record', 'site/data/labs/red-build/record.json', '--record',
      '--runner', 'org-hosted', '--machine-class', 'org-ci-heavy', '--image', where.image, '--ran-at', '2026-11-02T06:05:40Z', '--commit', where.commit, '--main-head', where.mainHead];
    const out = JSON.parse(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    assert.equal(out.recordHash, org.recordHash);
    rmSync(join(dir, 'files', 'score'));
    assert.equal(spawnSync('node', args, { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync('node', ['scripts/lab-recount.mjs', 'review', '--files', dir], { encoding: 'utf8' }).status, 2, 'not a recount lab');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI fails closed on a missing --commit: the record would fail its own schema, never exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab08-'));
  try {
    mkdirSync(join(dir, 'files'));
    for (const [role, b] of Object.entries(files)) writeFileSync(join(dir, 'files', role), b);
    const missingCommit = ['scripts/lab-recount.mjs', 'red-build', '--files', join(dir, 'files'), '--main-record', 'site/data/labs/red-build/record.json', '--record',
      '--runner', 'org-hosted', '--machine-class', 'org-ci-heavy', '--image', where.image, '--ran-at', '2026-11-02T06:05:40Z', '--main-head', where.mainHead];
    const missing = spawnSync('node', missingCommit, { encoding: 'utf8' });
    assert.equal(missing.status, 2, 'a missing --commit must fail closed, not print a schema-failing record at exit 0');
    assert.doesNotMatch(missing.stdout, /recordHash/, 'no record text on stdout when the record itself is refused');
    const missingMainHead = ['scripts/lab-recount.mjs', 'red-build', '--files', join(dir, 'files'), '--main-record', 'site/data/labs/red-build/record.json', '--record',
      '--runner', 'org-hosted', '--machine-class', 'org-ci-heavy', '--image', where.image, '--ran-at', '2026-11-02T06:05:40Z', '--commit', where.commit];
    assert.equal(spawnSync('node', missingMainHead, { encoding: 'utf8' }).status, 2, 'a missing --main-head must also fail closed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Lab 08's schema embeds record v1 by the same schema, word for word", () => {
  const { $schema, $id, title, ...v1 } = JSON.parse(readFileSync(RECORD_SCHEMA, 'utf8'));
  assert.deepEqual(JSON.parse(readFileSync('scripts/schemas/odin-lab-red-build.schema.json', 'utf8')).properties.runs.items, v1);
});

const day = (a, b) => {
  const list = a.recordHash === b.recordHash ? 'replicatedOn' : 'differedOn';
  return [{ ...a, [list]: [{ machineClass: b.machineClass, recordHash: b.recordHash }] }, { ...b, [list]: [{ machineClass: a.machineClass, recordHash: a.recordHash }] }];
};
const FILES = ['data/labs/red-build-tile.json', 'data/labs/red-build/record.json', 'data/labs/red-build/record.sha256', 'labs/red-build/index.html',
  'data/labs/rogue-tile.json', 'data/labs/rogue/record.json', 'data/labs/rogue/record.sha256', 'labs/rogue/index.html', RUNS_PAGE];

test('a Lab 08 day appends through the record PR path, re-pins, its card reads "reproduced" and its page says it is a recount', () => {
  assert.deepEqual(dayProblems([], day(hosted, org), { lab: 'red-build', committedCounts: hosted.result.committed }), []);
  const root = mkdtempSync(join(tmpdir(), 'lab08-site-'));
  try {
    for (const f of FILES) { mkdirSync(join(root, f, '..'), { recursive: true }); cpSync(join('site', f), join(root, f)); }
    const paths = day(hosted, org).map((r, i) => { const f = join(root, `l${i}.json`); writeFileSync(f, JSON.stringify(r)); return f; });
    assert.match(execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, '--lab', 'red-build', ...paths], { encoding: 'utf8' }),
      new RegExp(`appended 2 run\\(s\\) on 1 day\\(s\\) to data/labs/red-build/record\\.json \\(sha256 [0-9a-f]{64}\\)`));
    const bytes = readFileSync(join(root, 'data/labs/red-build/record.json'));
    assert.equal(readFileSync(join(root, 'data/labs/red-build/record.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  record.json\n`);
    const rec = readRedBuild(root); // the pinned Lab 08 record, its schema and every Lab 08 check, the recount included
    assert.equal(rec.runs.length, (record.runs ?? []).length + 2);
    const pages = { 'labs/index.html': renderLabs()['labs/index.html'].replace(/<div class="lab-provenance [^]*?<\/div>(?=<ul class="lab-tile-links">)/g, '') };
    const card = withLabRuns(pages, root)['labs/index.html'];
    assert.match(card.slice(card.indexOf('aria-labelledby="lab-tile-red-build">')), /data-state="reproduced"/);
    const section = renderLabRunsSection({ runs: rec.runs });
    assert.match(section, /The org machines' runs are a recount/);
    assert.match(section, /flat by construction/);
    assert.match(section, /It re-counts; it does not re-score or re-judge\./);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('appending to the Lab 08 record starts its runs; a forged day is refused', () => {
  const rec = JSON.parse(JSON.stringify(record));
  delete rec.runs;
  const live = { lab: 'red-build', committedCounts: hosted.result.committed };
  assert.equal(appendDays(rec, day(hosted, org), live).runs.length, 2);
  assert.throws(() => appendDays(rec, [{ ...hosted, recordHash: 'e'.repeat(64) }], live), /recordHash/);
});

// row 15fd283c#1 recheck (parentRowId 15fd283c…), finding 1 (NOT-FIXED): dayProblems() took committedCounts, but
// nothing proved the CLI/appendDays path actually HANDS it through -- a planted negative that calls dayProblems
// directly doesn't show that. This drives a stale-hash day through the REAL CLI binary end to end: appendDays()
// (untouched, already forwards its whole `options` object to dayProblems()) called from append-rogue-runs.mjs's
// own main(), against a real copy of the published site record, must refuse it exactly as dayProblems() alone does.
test('the append CLI refuses a day whose committed hash belongs to different counts (end to end, not just dayProblems())', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab08-site-stale-'));
  try {
    for (const f of FILES) { mkdirSync(join(root, f, '..'), { recursive: true }); cpSync(join('site', f), join(root, f)); }
    const staleHash = createHash('sha256').update(canonical({ rounds: stated.rounds, score: { ...stated.score, ruled: stated.score.ruled + 1 }, earlier: stated.earlier })).digest('hex');
    const staleDay = day({ ...hosted, result: { ...hosted.result, committed: staleHash } }, { ...org, result: { ...org.result, committed: staleHash } });
    const paths = staleDay.map((r, i) => { const f = join(root, `s${i}.json`); writeFileSync(f, JSON.stringify(r)); return f; });
    const out = spawnSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, '--lab', 'red-build', ...paths], { encoding: 'utf8' });
    assert.equal(out.status, 1, 'a stale-hash day appended through the real CLI must be refused, not silently accepted');
    assert.match(out.stderr, /result\.committed does not match the currently published counts/);
    // The record on disk is untouched: a refused append writes nothing.
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'data/labs/red-build/record.json'), 'utf8')), JSON.parse(readFileSync(join('site', 'data/labs/red-build/record.json'), 'utf8')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// row 67aa267e#1: the binding is also checked at READ time. A published record whose runs recount different counts
// (here: runs whose committed hash is not this record's counts) is refused by readRedBuild's checks, so the page
// can never show a run beside counts it did not recount.
test('a published Lab 08 record is refused when a run recounted different counts (read time, not only at append)', () => {
  const withRuns = { ...JSON.parse(JSON.stringify(record)), runs: day(hosted, org) };
  assert.deepEqual(redBuildProblems(withRuns).filter(p => /result\/committed/.test(p)), [], 'runs of these counts are accepted');
  assert.equal(committedCountsOf(withRuns), hosted.result.committed);
  const stale = { ...withRuns, runs: withRuns.runs.map(r => ({ ...r, result: { ...r.result, committed: 'f'.repeat(64) } })) };
  const found = redBuildProblems(stale).filter(p => /result\/committed/.test(p));
  assert.equal(found.length, 2, JSON.stringify(found));
  assert.match(found[0], /#\/runs\/0\/result\/committed: not the sha256 of the counts this record states/);
});
