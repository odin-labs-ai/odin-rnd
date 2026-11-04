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
import { blindProblems, committedCountsOf, measuredBlindRecordCounts, readMeasuredBlind } from './lab-measured-blind.mjs';
import { renderLabRunsSection, RUNS_PAGE, withLabRuns } from './lab-runs.mjs';
import { renderLabs } from './labs.mjs';
import { measuredBlindCounts, SETS } from './vendor-measured-blind.mjs';

// Lab 13 on the org runners as a RECOUNT (vision-plan bundle 3, WO-03): the runner reads the blind evaluation's
// committed verdict labels at the private main head, names each file by its role, and scripts/lab-recount.mjs counts
// them with the vendor's own counting. The private files are not in this repository, so the test writes synthetic ones
// in their format from what the committed record states, and checks the recount agrees, and stops agreeing on a change.
const record = readMeasuredBlind('site');
const stated = measuredBlindRecordCounts(record);
const ROLES = ['heldout1-manifest', 'heldout1-verdicts', 'heldout2-manifest', 'heldout2-verdicts', 'summary', 'tuning-manifest', 'tuning-verdicts', 'write-up'];
function syntheticFiles(r = record) {
  const files = { summary: { sets: [] } };
  for (const [i, set] of SETS.entries()) {
    const s = r.sets[i];
    // Keys that sort into the record's label order (kind first, then key): k-<kind order>-<index>.
    const keyed = s.items.map((item, j) => ({ key: `item-${String(j).padStart(2, '0')}`, item }));
    files[set.manifest] = { items: keyed.map(({ key, item }) => ({ item: key, kind: item.kind })) };
    files[set.verdicts] = {
      verdicts: Object.fromEntries(keyed.map(({ key, item }) => [key, { before: item.before[0], 'before-r2': item.before[1], after: item.after[0], 'after-r2': item.after[1] }])),
      counts: s.counts,
    };
    files.summary.sets.push({ name: set.summary, before: s.counts.before, after: s.counts.after });
  }
  const l = r.live;
  const bytes = Object.fromEntries(Object.entries(files).map(([role, v]) => [role, Buffer.from(`${JSON.stringify(v, null, 1)}\n`)]));
  bytes['write-up'] = Buffer.from(`# the write-up\n\n| all ${l.answers} | **useful ${l.useful} · partly ${l.partly} · wrong ${l.wrong}** |\n`);
  return bytes;
}
const files = syntheticFiles();
const read = (f = files) => role => { if (!(role in f)) throw new Error(`no ${role}`); return f[role]; };
const where = { runner: 'github-hosted', machineClass: 'ubuntu-latest', image: `node:22-bookworm@sha256:${'a'.repeat(64)}`, commit: 'c'.repeat(40), mainHead: 'c'.repeat(40) };
const hosted = recountRecord('measured-blind', read(), record, { ...where, ranAt: '2026-11-03T06:05:00Z' });
const org = recountRecord('measured-blind', read(), record, { ...where, runner: 'org-hosted', machineClass: 'org-ci-heavy', ranAt: '2026-11-03T06:05:40Z' });
const edit = (role, fn) => { const f = { ...files }; const v = JSON.parse(f[role]); fn(v); f[role] = Buffer.from(JSON.stringify(v)); return f; };

test('the synthetic files are in the vendor format: they count to exactly what the record states, with no problem', () => {
  const c = measuredBlindCounts(role => JSON.parse(files[role]), role => files[role].toString('utf8'));
  assert.deepEqual(c.problems, []);
  assert.equal(canonical({ sets: c.sets, live: c.live }), canonical(stated));
});

test('a recount that agrees is a valid record v1: SAME, 0 breaches, its inputs the eight counted roles, no key in it', () => {
  assert.deepEqual(recordProblems(hosted), []);
  assert.equal(hosted.result.verdict, 'SAME');
  assert.equal(hosted.result.breaches, 0);
  assert.equal(hosted.command, "the lab's own recount");
  assert.deepEqual(hosted.inputs.map(i => i.role), ROLES);
  for (const i of hosted.inputs) assert.equal(i.sha256, createHash('sha256').update(files[i.role]).digest('hex'));
  assert.equal(hosted.result.committed, committedCountsOf(record));
  assert.equal(org.recordHash, hosted.recordHash);
  assert.doesNotMatch(JSON.stringify(hosted), /item-\d/, 'no item key reaches the record');
});

test('a changed label (with its counts kept consistent), or a changed live line, is DIFFERENT with its group counted', () => {
  // Flip one label and fix up the verdict file's and the summary's counts, so the evidence stays self-consistent.
  const v = JSON.parse(files['tuning-verdicts']);
  const k = Object.keys(v.verdicts)[0], from = v.verdicts[k].after, to = from === 'useful' ? 'wrong' : 'useful';
  v.verdicts[k].after = to; v.counts.after[from] -= 1; v.counts.after[to] += 1;
  const s = JSON.parse(files.summary); s.sets[0].after = v.counts.after;
  const moved = { ...files, 'tuning-verdicts': Buffer.from(JSON.stringify(v)), summary: Buffer.from(JSON.stringify(s)) };
  const one = recountRecord('measured-blind', read(moved), record, { ...where, ranAt: '2026-11-03T06:05:00Z' });
  assert.equal(one.result.verdict, 'DIFFERENT');
  assert.equal(one.result.breaches, 1, 'the sets group only');
  assert.deepEqual(recordProblems(one), []);
  const l = record.live;
  const live = { ...files, 'write-up': Buffer.from(`| all ${l.answers} | **useful ${l.useful - 1} · partly ${l.partly + 1} · wrong ${l.wrong}** |\n`) };
  const two = recountRecord('measured-blind', read(live), record, { ...where, ranAt: '2026-11-03T06:05:00Z' });
  assert.equal(two.result.breaches, 1, 'the live group only');
  const pub = JSON.parse(JSON.stringify(record)); pub.live.useful -= 1; pub.live.partly += 1;
  const three = recountRecord('measured-blind', read(), pub, { ...where, ranAt: '2026-11-03T06:05:00Z' });
  assert.equal(three.result.verdict, 'DIFFERENT');
  assert.equal(three.result.breaches, 1, 'a moved published count: the live group');
});

test('evidence that does not count (labels against their own counts, a missing live line) is an error, never a quiet DIFFERENT', () => {
  const bad = edit('tuning-verdicts', v => { v.counts.after.useful += 1; });
  assert.throws(() => recountRecord('measured-blind', read(bad), record, { ...where, ranAt: '2026-11-03T06:05:00Z' }), /the evidence does not count/);
  assert.throws(() => recountRecord('measured-blind', read({ ...files, 'write-up': Buffer.from('no line\n') }), record, { ...where, ranAt: '2026-11-03T06:05:00Z' }), /the evidence does not count: the write-up has no line/);
});

test('a lab carries only its own command and roles; it reads AT main, so "ahead" is refused', () => {
  const rehash = x => ({ ...x, recordHash: recordHash(x) });
  assert.ok(recordProblems(rehash({ ...hosted, inputs: hosted.inputs.slice(1) })).some(p => /not the input roles of lab measured-blind/.test(p)));
  assert.ok(recordProblems(rehash({ ...hosted, lab: 'red-build' })).some(p => /not the input roles of lab red-build/.test(p)));
  assert.ok(recordProblems(rehash({ ...hosted, commit: { sha: where.commit, mainHead: 'e'.repeat(40), compare: 'ahead', onMain: true } })).some(p => /reads main, so its commit must be the main head/.test(p)));
  assert.throws(() => recountRecord('measured-blind', read(), record, { ...where, mainHead: 'e'.repeat(40), ranAt: '2026-11-03T06:05:00Z' }), /is not the main head the runner read/);
});

test('the CLI reads the role files and the published record and prints the record; a missing role is exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab13-'));
  try {
    mkdirSync(join(dir, 'files'));
    for (const [role, b] of Object.entries(files)) writeFileSync(join(dir, 'files', role), b);
    const args = ['scripts/lab-recount.mjs', 'measured-blind', '--files', join(dir, 'files'), '--main-record', 'site/data/labs/measured-blind/record.json', '--record',
      '--runner', 'org-hosted', '--machine-class', 'org-ci-heavy', '--image', where.image, '--ran-at', '2026-11-03T06:05:40Z', '--commit', where.commit, '--main-head', where.commit];
    assert.equal(JSON.parse(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).recordHash, org.recordHash);
    rmSync(join(dir, 'files', 'summary'));
    const r = spawnSync('node', args, { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Lab 13's schema embeds record v1 by the same schema, word for word", () => {
  const { $schema, $id, title, ...v1 } = JSON.parse(readFileSync(RECORD_SCHEMA, 'utf8'));
  assert.deepEqual(JSON.parse(readFileSync('scripts/schemas/odin-lab-measured-blind.schema.json', 'utf8')).properties.runs.items, v1);
});

const day = (a, b) => {
  const list = a.recordHash === b.recordHash ? 'replicatedOn' : 'differedOn';
  return [{ ...a, [list]: [{ machineClass: b.machineClass, recordHash: b.recordHash }] }, { ...b, [list]: [{ machineClass: a.machineClass, recordHash: a.recordHash }] }];
};
const FILES = ['data/labs/measured-blind-tile.json', 'data/labs/measured-blind/record.json', 'data/labs/measured-blind/record.sha256', 'labs/measured-blind/index.html',
  'data/labs/rogue-tile.json', 'data/labs/rogue/record.json', 'data/labs/rogue/record.sha256', 'labs/rogue/index.html', RUNS_PAGE];

test('a Lab 13 day appends through the record PR path, re-pins, its card reads "reproduced" and its page says it is a recount', () => {
  assert.deepEqual(dayProblems([], day(hosted, org), { lab: 'measured-blind', committedCounts: committedCountsOf(record) }), []);
  assert.ok(dayProblems([], day(hosted, org), { lab: 'measured-blind' })[0].includes('needs committedCounts'), 'the binding is required');
  const root = mkdtempSync(join(tmpdir(), 'lab13-site-'));
  try {
    for (const f of FILES) { mkdirSync(join(root, f, '..'), { recursive: true }); cpSync(join('site', f), join(root, f)); }
    const paths = day(hosted, org).map((r, i) => { const f = join(root, `l${i}.json`); writeFileSync(f, JSON.stringify(r)); return f; });
    assert.match(execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, '--lab', 'measured-blind', ...paths], { encoding: 'utf8' }),
      /appended 2 run\(s\) on 1 day\(s\) to data\/labs\/measured-blind\/record\.json \(sha256 [0-9a-f]{64}\)/);
    const bytes = readFileSync(join(root, 'data/labs/measured-blind/record.json'));
    assert.equal(readFileSync(join(root, 'data/labs/measured-blind/record.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  record.json\n`);
    const rec = readMeasuredBlind(root);
    assert.equal(rec.runs.length, (record.runs ?? []).length + 2);
    const pages = { 'labs/index.html': renderLabs()['labs/index.html'].replace(/<div class="lab-provenance [^]*?<\/div>(?=<ul class="lab-tile-links">)/g, '') };
    const card = withLabRuns(pages, root)['labs/index.html'];
    assert.match(card.slice(card.indexOf('aria-labelledby="lab-tile-measured-blind">')), /data-state="reproduced"/);
    const section = renderLabRunsSection({ runs: rec.runs });
    assert.match(section, /The org machines' runs are a recount/);
    assert.match(section, /it does not re-run the agents or re-judge their answers/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a published record whose runs recounted other counts is refused at read time; a stale day is refused at append', () => {
  const withRuns = { ...JSON.parse(JSON.stringify(record)), runs: day(hosted, org) };
  assert.deepEqual(blindProblems(withRuns).filter(p => /result\/committed/.test(p)), []);
  const moved = JSON.parse(JSON.stringify(withRuns)); moved.live.useful -= 1; moved.live.partly += 1;
  assert.ok(blindProblems(moved).some(p => /\/runs\/0\/result\/committed: not the sha256 of the counts this record states/.test(p)));
  const rec = JSON.parse(JSON.stringify(record)); delete rec.runs;
  assert.throws(() => appendDays(rec, [{ ...hosted, result: { ...hosted.result, committed: 'f'.repeat(64) } }], { lab: 'measured-blind', committedCounts: committedCountsOf(record) }), /result\.committed does not match the currently published counts/);
});
