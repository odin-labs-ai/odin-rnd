import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDays, dayProblems } from './append-rogue-runs.mjs';
import { recordHash, recordProblems, RECORD_SCHEMA } from './lab-record.mjs';
import { kitRecord, runKit } from './lab-rerun.mjs';
import { readReview } from './lab-review.mjs';
import { RUNS_PAGE, withLabRuns } from './lab-runs.mjs';
import { renderLabs } from './labs.mjs';

// Lab 06 on the org runners (vision-plan bundle 3, WO-03): each runner leg runs the lab's own re-run kit and writes one
// record v1 (scripts/lab-rerun.mjs --record); the record PR appends a day of them to Lab 06's record, runs[].
const review = readReview('site');
const where = { runner: 'github-hosted', machineClass: 'ubuntu-latest', image: null, commit: 'c'.repeat(40) };
const results = runKit('review', review);
const ok = kitRecord('review', results, { record: review, ...where, ranAt: '2026-10-28T05:33:00Z' });

test('a run of the kit, as record v1: valid, SAME when every step printed its line, its inputs the cited files', () => {
  assert.deepEqual(recordProblems(ok), []);
  assert.equal(ok.result.verdict, 'SAME');
  assert.equal(ok.result.breaches, 0);
  assert.deepEqual(ok.inputs.map(i => i.role), ['frontier', 'nina']);
  for (const i of ok.inputs) assert.equal(i.sha256, review.sources.find(s => s.role === i.role).sha256, i.role);
  // The same kit on another machine class holds the same recordHash (where and when are not in it).
  const other = kitRecord('review', results, { record: review, ...where, runner: 'org-hosted', machineClass: 'org-ci-heavy', ranAt: '2026-10-28T05:33:40Z' });
  assert.equal(other.recordHash, ok.recordHash);
});

test('a step that printed something else, or failed, is a DIFFERENT run with its breaches counted, never a SAME', () => {
  const bad = results.map((r, i) => (i === 1 ? { ...r, got: 'tampered', ok: false } : r));
  const r = kitRecord('review', bad, { record: review, ...where, ranAt: '2026-10-28T05:33:00Z' });
  assert.equal(r.result.verdict, 'DIFFERENT');
  assert.equal(r.result.breaches, 1);
  assert.notEqual(r.recordHash, ok.recordHash);
  assert.deepEqual(recordProblems(r), []);
  // A step that exited nonzero but printed its exact line is still not SAME.
  const exited = kitRecord('review', results.map((x, i) => (i === 0 ? { ...x, status: 1, ok: false } : x)), { record: review, ...where, ranAt: '2026-10-28T05:33:00Z' });
  assert.equal(exited.result.verdict, 'DIFFERENT');
  assert.equal(exited.result.breaches, 1);
});

test('a lab carries only its own command and roles', () => {
  const rehash = x => ({ ...x, recordHash: recordHash(x) });
  assert.ok(recordProblems(rehash({ ...ok, command: "the demo's own check command" })).some(p => /\/command: not the command of lab review/.test(p)));
  assert.ok(recordProblems(rehash({ ...ok, inputs: [{ role: 'runner', sha256: 'a'.repeat(64) }, { role: 'runs', sha256: 'b'.repeat(64) }] })).some(p => /not the input roles of lab review/.test(p)));
  assert.ok(recordProblems(rehash({ ...ok, lab: 'rogue' })).some(p => /not the command of lab rogue/.test(p)));
});

test("Lab 06's schema embeds record v1 by the same schema, word for word", () => {
  const { $schema, $id, title, ...record } = JSON.parse(readFileSync(RECORD_SCHEMA, 'utf8'));
  assert.deepEqual(JSON.parse(readFileSync('scripts/schemas/odin-lab-review.schema.json', 'utf8')).properties.runs.items, record);
});

const day = (a, b) => {
  const list = a.recordHash === b.recordHash ? 'replicatedOn' : 'differedOn';
  return [{ ...a, [list]: [{ machineClass: b.machineClass, recordHash: b.recordHash }] }, { ...b, [list]: [{ machineClass: a.machineClass, recordHash: a.recordHash }] }];
};
const hosted = ok;
const org = kitRecord('review', results, { record: review, ...where, runner: 'org-hosted', machineClass: 'org-ci-heavy', ranAt: '2026-10-28T05:33:40Z' });
const pages = { 'labs/index.html': renderLabs()['labs/index.html'].replace(/<div class="lab-provenance [^]*?<\/div>(?=<ul class="lab-tile-links">)/g, '') };
const FILES = ['data/labs/review-tile.json', 'data/labs/review/record.json', 'data/labs/review/record.sha256', 'labs/review/index.html',
  'data/labs/rogue-tile.json', 'data/labs/rogue/record.json', 'data/labs/rogue/record.sha256', 'labs/rogue/index.html', RUNS_PAGE];

test('a Lab 06 day appends through the record PR path, re-pins, and its card reads "reproduced"', () => {
  assert.deepEqual(dayProblems([], day(hosted, org), { lab: 'review' }), []);
  assert.ok(dayProblems([], day(hosted, org)).some(p => /is not rogue/.test(p)), 'the default lab stays rogue');
  const root = mkdtempSync(join(tmpdir(), 'lab06-'));
  try {
    for (const f of FILES) { mkdirSync(join(root, f, '..'), { recursive: true }); cpSync(join('site', f), join(root, f)); }
    const files = day(hosted, org).map((r, i) => { const f = join(root, `l${i}.json`); writeFileSync(f, JSON.stringify(r)); return f; });
    assert.match(execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, '--lab', 'review', ...files], { encoding: 'utf8' }), /appended 2 run\(s\) on 1 day\(s\) to data\/labs\/review\/record\.json/);
    const bytes = readFileSync(join(root, 'data/labs/review/record.json'));
    assert.equal(readFileSync(join(root, 'data/labs/review/record.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  record.json\n`);
    const rec = readReview(root); // the pinned Lab 06 record, its schema and every Lab 06 check
    assert.equal(rec.runs.length, 2);
    const html = withLabRuns(pages, root)['labs/index.html'];
    const card = html.slice(html.indexOf('aria-labelledby="lab-tile-review">'));
    assert.match(card, /data-state="reproduced"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('appending to a record without runs starts them; a forged day is refused and writes nothing', () => {
  const rec = { ...review };
  delete rec.runs;
  assert.equal(appendDays(rec, day(hosted, org), { lab: 'review' }).runs.length, 2);
  assert.throws(() => appendDays(rec, [{ ...hosted, recordHash: 'e'.repeat(64) }], { lab: 'review' }), /recordHash/);
  for (const bad of [null, {}, 'runs']) assert.throws(() => appendDays({ ...rec, runs: bad }, day(hosted, org), { lab: 'review' }), /runs that are not a list/, JSON.stringify(bad));
});
