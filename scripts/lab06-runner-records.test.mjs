import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDays, dayProblems } from './append-rogue-runs.mjs';
import { PINNED_LABS, recordHash, recordProblems, RECORD_SCHEMA } from './lab-record.mjs';
import { kitRecord, runKit } from './lab-rerun.mjs';
import { readReview } from './lab-review.mjs';
import { renderLabRunsSection, RUNS_PAGE, withLabRuns } from './lab-runs.mjs';
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

test('Lab 06 runs at a pinned commit: its org record names the real main head, identical or ahead, never behind or diverged', () => {
  assert.deepEqual(PINNED_LABS, ['review'], 'only Lab 06 is pinned');
  const head = 'e'.repeat(40);
  const ahead = kitRecord('review', results, { record: review, ...where, ranAt: '2026-10-28T05:33:00Z', mainHead: head });
  assert.deepEqual(ahead.commit, { sha: where.commit, mainHead: head, compare: 'ahead', onMain: true });
  assert.deepEqual(recordProblems(ahead), []);
  assert.equal(ahead.recordHash, ok.recordHash, 'the main head is not in the recordHash');
  assert.deepEqual(ok.commit, { sha: where.commit, mainHead: where.commit, compare: 'identical', onMain: true }, 'no main head given: the commit is the main head');
  const rehash = x => ({ ...x, recordHash: recordHash(x) });
  for (const runner of ['org-hosted', 'github-hosted']) {
    const org = { ...ahead, runner, machineClass: runner === 'org-hosted' ? 'org-ci-heavy' : 'ubuntu-latest' };
    assert.deepEqual(recordProblems(rehash(org)), [], runner);
    for (const compare of ['behind', 'diverged']) {
      const bad = rehash({ ...org, commit: { ...org.commit, compare, onMain: false } });
      assert.ok(recordProblems(bad).some(p => /\/commit\/compare: the .* runner runs lab review at a pinned commit of main/.test(p)), `${runner} ${compare}`);
    }
    // "ahead" of itself is not a main check; nor is "identical" of another head.
    assert.ok(recordProblems(rehash({ ...org, commit: { ...org.commit, mainHead: where.commit } })).some(p => /does not agree/.test(p)));
    assert.ok(recordProblems(rehash({ ...org, commit: { ...org.commit, compare: 'identical' } })).some(p => /does not agree/.test(p)));
  }
});

test("Lab 06's runs section says its org runs are at the pinned, reviewed commit and that a divergent day is red, unpublished", () => {
  const note = /The org machines' runs re-run this lab's kit at the pinned, reviewed commit of this repository, not at its moving main/;
  const html = renderLabRunsSection({ runs: day(hosted, org) });
  assert.match(html, note);
  assert.match(html, /is not published here: it is a red day, recorded in the runner's own run/);
  // A laptop run names its own commit: a laptop-only history carries no pin statement; a mixed one scopes it to org runs.
  const laptop = { ...hosted, runner: 'laptop', machineClass: 'mac', ranAt: '2026-10-28T09:00:00Z' };
  assert.doesNotMatch(renderLabRunsSection({ runs: [laptop] }), /pinned, reviewed commit/, 'laptop only');
  assert.match(renderLabRunsSection({ runs: [laptop, org] }), note, 'mixed: the statement names the org machines\' runs');
  assert.doesNotMatch(renderLabRunsSection({ runs: [{ ...hosted, lab: 'rogue' }] }), /pinned, reviewed commit/, 'Lab 05 is not pinned');
});

test('the CLI writes --main-head into the record (compare ahead) and leaves the recordHash as it is', () => {
  const run = extra => JSON.parse(execFileSync('node', ['scripts/lab-rerun.mjs', 'review', '--record', '--runner', 'github-hosted', '--machine-class', 'ubuntu-latest',
    '--image', `node:22-bookworm@sha256:${'a'.repeat(64)}`, '--ran-at', '2026-10-28T05:33:00Z', '--commit', 'c'.repeat(40), ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const plain = run([]), ahead = run(['--main-head', 'e'.repeat(40)]);
  assert.deepEqual(plain.commit, { sha: 'c'.repeat(40), mainHead: 'c'.repeat(40), compare: 'identical', onMain: true });
  assert.deepEqual(ahead.commit, { sha: 'c'.repeat(40), mainHead: 'e'.repeat(40), compare: 'ahead', onMain: true });
  assert.equal(ahead.recordHash, plain.recordHash);
  assert.deepEqual(recordProblems(ahead), []);
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
    assert.equal(rec.runs.length, (review.runs ?? []).length + 2);
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
