import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDay, dayProblems } from './append-rogue-runs.mjs';
import { recordHash } from './lab-record.mjs';
import { readRogue } from './lab-rogue.mjs';
import { runAnchor, RUNS_PAGE, withLabRuns } from './lab-runs.mjs';
import { renderLabs } from './labs.mjs';

// The lab runner's record PR (WO-04) appends one day of org-runner records to Lab 05's runs[]. The fixtures are the
// exact shape it writes: Lab 05's Mac re-run moved to the two org machine classes, re-hashed, each leg naming the other.
// Every fixture starts from Lab 05's record with only its laptop re-run, whatever org-runner days main already holds.
const committed = JSON.parse(readFileSync('site/data/labs/rogue/record.json', 'utf8'));
const record = { ...committed, runs: committed.runs.filter(r => r.runner === 'laptop') };
const raw = `${JSON.stringify(record, null, 1)}\n`;
const mac = record.runs[0];
const IMAGE = `python:3.12-bookworm@sha256:${'cb23ba7f04101d51ce157de82b98b34f9bbd3fa24f9aea5ac8a237a22512382c'}`;
const leg = (runner, machineClass, ranAt, change = {}) => {
  const r = { ...structuredClone(mac), runner, machineClass, image: IMAGE, ranAt, replicatedOn: [], differedOn: [], ...change };
  return { ...r, recordHash: recordHash(r) };
};
const day = (a, b) => {
  const list = a.recordHash === b.recordHash ? 'replicatedOn' : 'differedOn';
  return [{ ...a, [list]: [{ machineClass: b.machineClass, recordHash: b.recordHash }] }, { ...b, [list]: [{ machineClass: a.machineClass, recordHash: a.recordHash }] }];
};
const hosted = leg('github-hosted', 'ubuntu-latest', '2026-10-28T03:00:00Z');
const org = leg('org-hosted', 'org-ci-heavy', '2026-10-28T03:00:40Z');
const refused = (runs, d, re) => assert.ok(dayProblems(runs, d).some(p => re.test(p)), JSON.stringify(dayProblems(runs, d)));
const state = pages => /data-state="([a-z]+)"/.exec(pages['labs/index.html'])[1];
// The published Labs index without its runs (as scripts/lab-runs.test.mjs does); each test re-renders the runs on its
// own record.
const pages = { 'labs/index.html': renderLabs()['labs/index.html'].replace(/<div class="lab-provenance [^]*?<\/div>(?=<ul class="lab-tile-links">)/, '') };
// What the runs reader and Lab 05's pinned-record reader read, copied to a temporary root (as scripts/lab-runs.test.mjs does).
const FILES = ['data/labs/rogue-tile.json', 'data/labs/rogue/record.json', 'data/labs/rogue/record.sha256', 'labs/rogue/index.html', RUNS_PAGE];

function inSite(fn) {
  const root = mkdtempSync(join(tmpdir(), 'rogue-runs-'));
  try {
    for (const file of FILES) { mkdirSync(join(root, file, '..'), { recursive: true }); cpSync(join('site', file), join(root, file)); }
    writeFileSync(join(root, 'data/labs/rogue/record.json'), raw);
    writeFileSync(join(root, 'data/labs/rogue/record.sha256'), `${createHash('sha256').update(raw).digest('hex')}  record.json\n`);
    return fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
// The real readers on that root: the pinned Lab 05 record (pin, schema, Lab 05's checks) and the runs reader's card.
const build = root => { readRogue(root); return withLabRuns(pages, root); };

test('the first two-leg day appends after the Mac run, re-pins, and turns the Lab 05 card to "reproduced"', () => {
  inSite(root => {
    const files = day(hosted, org).map((r, i) => { const f = join(root, `leg${i}.json`); writeFileSync(f, `${JSON.stringify(r, null, 1)}\n`); return f; });
    assert.equal(state(build(root)), 'laptop');
    const out = execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, ...files], { encoding: 'utf8' });
    assert.match(out, /appended 2 run\(s\).*runs: 3/);
    const bytes = readFileSync(join(root, 'data/labs/rogue/record.json'));
    assert.equal(readFileSync(join(root, 'data/labs/rogue/record.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  record.json\n`);
    const runs = JSON.parse(bytes).runs;
    assert.deepEqual(runs[0], mac, 'the Mac run stays runs[0], unchanged');
    const after = build(root);
    assert.equal(state(after), 'reproduced');
    assert.match(after[RUNS_PAGE], /<tr id="run-rogue-org-ci-heavy-20261028030040-/);
    assert.match(after[RUNS_PAGE], /<tr id="run-rogue-ubuntu-latest-20261028030000-/);
  });
});

test('two legs that differ on the day are appended as such, each naming the other in differedOn, and the card says so', () => {
  const other = leg('org-hosted', 'org-ci-heavy', '2026-10-28T03:00:40Z', { result: { ...mac.result, now: '0000000000000000', verdict: 'DIFFERENT' } });
  const d = day(hosted, other);
  assert.deepEqual(dayProblems(record.runs, d), []);
  inSite(root => {
    writeFileSync(join(root, 'data/labs/rogue/record.json'), `${JSON.stringify(appendDay(record, d), null, 1)}\n`);
    const bytes = readFileSync(join(root, 'data/labs/rogue/record.json'));
    writeFileSync(join(root, 'data/labs/rogue/record.sha256'), `${createHash('sha256').update(bytes).digest('hex')}  record.json\n`);
    assert.equal(state(build(root)), 'different');
  });
});

// Lab 05's record with `days` appended one at a time, each through appendDay (the record PR's path), written and pinned
// on a temporary root; returns the rendered pages.
function afterDays(root, days) {
  let r = record;
  for (const d of days) r = appendDay(r, d);
  const bytes = `${JSON.stringify(r, null, 1)}\n`;
  writeFileSync(join(root, 'data/labs/rogue/record.json'), bytes);
  writeFileSync(join(root, 'data/labs/rogue/record.sha256'), `${createHash('sha256').update(bytes).digest('hex')}  record.json\n`);
  return build(root);
}

test('a different hash is sticky for its commit (#128): day 1 differ, day 2 agree on the same commit -> still "different"; a new commit agreeing -> "reproduced"', () => {
  const otherInputs = { inputs: [{ role: 'runner', sha256: 'c'.repeat(64) }, mac.inputs[1]] };
  const d1hosted = leg('github-hosted', 'ubuntu-latest', '2026-10-27T12:00:00Z', otherInputs);
  const d1org = leg('org-hosted', 'org-ci-heavy', '2026-10-27T12:00:40Z');
  const d2hosted = leg('github-hosted', 'ubuntu-latest', '2026-10-27T18:00:00Z');
  const d2org = leg('org-hosted', 'org-ci-heavy', '2026-10-27T18:00:40Z');
  const day1 = day(d1hosted, d1org), day2 = day(d2hosted, d2org);
  assert.ok(day1.every(r => r.differedOn.length === 1 && !r.replicatedOn.length) && day2.every(r => r.replicatedOn.length === 1 && !r.differedOn.length));
  assert.deepEqual(dayProblems([...record.runs, ...day1], day2), []);
  inSite(root => {
    const html = afterDays(root, [day1, day2])['labs/index.html'];
    assert.equal(/data-state="([a-z]+)"/.exec(html)[1], 'different', 'a later matching day never clears it');
    // Both hashes listed, each with its newest run per class, linked to its row on the runs page.
    assert.ok(html.includes(`record <code>${d2org.recordHash.slice(0, 12)}</code> on `));
    assert.ok(html.includes(`record <code>${d1hosted.recordHash.slice(0, 12)}</code> on <a href="runs/#${runAnchor(d1hosted)}">`));
    assert.ok(html.includes(`<a href="runs/#${runAnchor(d2org)}">`) && html.includes(`<a href="runs/#${runAnchor(d2hosted)}">`));
    assert.doesNotMatch(/<div class="lab-provenance [^]*?<\/div>/.exec(html)[0], /same hash/i);
  });
  // A new commit starts fresh. Its record hash, 237b291c..., is the case that once tripped the feeds' screen (#130).
  const fresh = { commit: { sha: 'd'.repeat(40), mainHead: 'd'.repeat(40), compare: 'identical', onMain: true } };
  const day3 = day(leg('github-hosted', 'ubuntu-latest', '2026-10-27T20:00:00Z', fresh), leg('org-hosted', 'org-ci-heavy', '2026-10-27T20:00:40Z', fresh));
  inSite(root => assert.equal(state(afterDays(root, [day1, day2, day3])), 'reproduced'));
});

test('refused: one record, a laptop run, a wrong lab, two commits, one class twice', () => {
  refused(record.runs, [hosted], /two or more records/);
  refused(record.runs, day(hosted, { ...org, runner: 'laptop', machineClass: 'mac' }), /laptop run is not an org runner's/);
  refused(record.runs, day(hosted, { ...org, lab: 'other' }), /is not rogue/);
  refused(record.runs, day(hosted, leg('org-hosted', 'org-ci-heavy', '2026-10-28T03:00:40Z', { commit: { ...mac.commit, sha: 'b'.repeat(40), mainHead: 'b'.repeat(40) } })), /not all of one commit/);
  refused(record.runs, day(hosted, leg('github-hosted', 'ubuntu-latest', '2026-10-28T03:01:00Z')), /two records of one machine class/);
  refused(record.runs, day(hosted, leg('org-hosted', 'org-ci-heavy', '2026-10-25T03:00:40Z')), /did not all run on one UTC day/);
});

test('refused: a leg that does not name exactly its same-day sibling (none, the Mac, itself, the wrong list)', () => {
  const [a, b] = day(hosted, org);
  refused(record.runs, [{ ...a, replicatedOn: [] }, b], /day\[0\]\/replicatedOn: does not name exactly/);
  refused(record.runs, [{ ...a, replicatedOn: [...a.replicatedOn, { machineClass: 'mac', recordHash: mac.recordHash }] }, b], /day\[0\]\/replicatedOn/);
  refused(record.runs, [{ ...a, replicatedOn: [{ machineClass: a.machineClass, recordHash: a.recordHash }] }, b], /day\[0\]\/replicatedOn/);
  refused(record.runs, [{ ...a, replicatedOn: [], differedOn: a.replicatedOn }, b], /day\[0\]\/(replicatedOn|differedOn)/);
});

test('refused: a class that already holds a run at that second, and a record the reader would refuse', () => {
  const once = appendDay(record, day(hosted, org)).runs;
  refused(once, day(hosted, org), /already holds a run at 2026-10-28T03:00:00Z/);
  const [a, b] = day(hosted, org);
  refused(record.runs, [{ ...a, recordHash: 'e'.repeat(64) }, b], /recordHash|replicatedOn/);
  refused(record.runs, day(leg('github-hosted', 'ubuntu-latest', '2999-01-01T00:00:00Z'), leg('org-hosted', 'org-ci-heavy', '2999-01-01T00:00:40Z')), /ranAt: after the check/);
});

test('the command line refuses a refused day with exit 1 and writes nothing, and refuses a number not written as an integer', () => {
  inSite(root => {
    const before = readFileSync(join(root, 'data/labs/rogue/record.json'), 'utf8');
    const f = join(root, 'one.json');
    writeFileSync(f, JSON.stringify(hosted));
    assert.throws(() => execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, f], { stdio: 'pipe' }), e => e.status === 1 && /two or more records/.test(e.stderr.toString()));
    const [a, b] = day(hosted, org);
    writeFileSync(f, JSON.stringify(a).replace('"breaches":0', '"breaches":0.0'));
    const g = join(root, 'two.json');
    writeFileSync(g, JSON.stringify(b));
    assert.throws(() => execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, f, g], { stdio: 'pipe' }), e => e.status === 1 && /not written as a plain integer/.test(e.stderr.toString()));
    // Two legs days apart that name each other: refused, both files unchanged.
    const pinBefore = readFileSync(join(root, 'data/labs/rogue/record.sha256'), 'utf8');
    const [x, y] = day(hosted, leg('org-hosted', 'org-ci-heavy', '2026-10-25T03:00:40Z'));
    writeFileSync(f, JSON.stringify(x));
    writeFileSync(g, JSON.stringify(y));
    assert.throws(() => execFileSync('node', ['scripts/append-rogue-runs.mjs', '--root', root, f, g], { stdio: 'pipe' }), e => e.status === 1 && /did not all run on one UTC day/.test(e.stderr.toString()));
    assert.equal(readFileSync(join(root, 'data/labs/rogue/record.json'), 'utf8'), before);
    assert.equal(readFileSync(join(root, 'data/labs/rogue/record.sha256'), 'utf8'), pinBefore);
  });
});

test('a re-vendor carries the org runs forward (vendor-rogue keeps every run after the laptop\'s)', () => {
  const src = readFileSync('scripts/vendor-rogue.mjs', 'utf8');
  assert.match(src, /runs: \[laptopRun\(source, hashes, reproduction\), \.\.\.orgRuns\(\)\]/);
  assert.match(src, /\.runs\.filter\(r => r\.runner !== 'laptop'\)/);
});
