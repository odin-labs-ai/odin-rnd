import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { recordHash } from './lab-record.mjs';
import { BADGES, readLabRuns, renderProvenance, renderRuns, runAnchor, runRows, runState, runsProblems, RUNS_PAGE, withLabRuns } from './lab-runs.mjs';
import { renderLabs } from './labs.mjs';

// A lab card's provenance and badge (scripts/lab-runs.mjs), from record v1 runs. Every fixture is Lab 05's golden Mac
// re-run moved to another machine (or changed in what it computed) and re-hashed, so each is an honest record v1.
const golden = JSON.parse(readFileSync('site/data/labs/rogue/record.json', 'utf8')).runs[0];
const rehash = r => ({ ...r, recordHash: recordHash(r) });
const on = (runner, machineClass, ranAt, change = {}) => rehash({ ...structuredClone(golden), runner, machineClass, image: null, ranAt, replicatedOn: [], differedOn: [], ...change });
const laptop = golden;
const org = on('org-hosted', 'org-ci-heavy', '2026-10-27T20:00:00Z');
const hosted = on('github-hosted', 'ubuntu-latest', '2026-10-27T20:05:00Z');
const otherInputs = { inputs: [{ role: 'runner', sha256: 'c'.repeat(64) }, golden.inputs[1]] };
const asLab = (run, lab) => rehash({ ...run, lab });
const pair = (a, b, list) => [{ ...a, [list]: [{ machineClass: b.machineClass, recordHash: b.recordHash }] }, { ...b, [list]: [{ machineClass: a.machineClass, recordHash: a.recordHash }] }];
const ok = (runs, lab = 'rogue') => assert.deepEqual(runsProblems(runs, { lab, where: 'fixture' }), []);
const badge = html => /<p class="lab-badge" data-state="([a-z]+)"><strong>([^<]+)<\/strong>/.exec(html).slice(1);
const screened = (html, runs) => assert.deepEqual(pageLeaks(`<div>${html}</div>`, runs.flatMap(recordHashes)), []);

test('today: Lab 05 holds only its laptop re-run, so its card says "Single machine, a laptop re-run" and never "org"', () => {
  ok([laptop]);
  const html = renderProvenance([laptop]);
  assert.deepEqual(badge(html), ['laptop', `${BADGES.laptop}.`]);
  assert.match(html, /LATEST RUN · <span>laptop<\/span> · <span>commit <code>aa35e6db<\/code><\/span> · <span>record <code>47c9ab93279d<\/code><\/span>/);
  assert.doesNotMatch(html, /\borg\b|daily/i);
  screened(html, [laptop]);
});

test('one org machine: "Single machine", naming its class', () => {
  ok([org]);
  const html = renderProvenance([org]);
  assert.deepEqual(badge(html), ['single', `${BADGES.single}.`]);
  assert.match(html, /<span>org-hosted<\/span>/);
  assert.match(html, /one org machine class, <code>org-ci-heavy<\/code>\. The record holds no run of this commit on a second org machine class\./);
  screened(html, [org]);
  // The laptop re-run of the same commit, with the same hash, is mentioned and still not counted as a second org machine.
  assert.equal(runState([laptop, org]).state, 'single');
  assert.match(renderProvenance([laptop, org]), /and re-run on a laptop with the same hash/);
});

test('two org machine classes with the same hash: "Reproduced on a second org machine, same hash"', () => {
  const runs = pair(org, hosted, 'replicatedOn');
  ok(runs);
  const html = renderProvenance(runs);
  assert.deepEqual(badge(html), ['reproduced', `${BADGES.reproduced}.`]);
  assert.match(html, /The same record hash on <code>org-ci-heavy<\/code>, <code>ubuntu-latest<\/code>\./);
  screened(html, runs);
  // A laptop and one org machine with the same hash is not a reproduction on a second org machine.
  assert.notEqual(runState([laptop, org]).state, 'reproduced');
});

test('two runs of one commit with different hashes: "Different hash", both shown, never folded into a match', () => {
  const other = on('github-hosted', 'ubuntu-latest', '2026-10-27T20:05:00Z', otherInputs);
  assert.notEqual(other.recordHash, org.recordHash);
  const runs = pair(org, other, 'differedOn');
  ok(runs);
  const html = renderProvenance(runs);
  assert.deepEqual(badge(html), ['different', `${BADGES.different}.`]);
  assert.ok(html.includes(`record <code>${org.recordHash.slice(0, 12)}</code> on <code>org-ci-heavy</code>, 27 Oct 2026`));
  assert.ok(html.includes(`record <code>${other.recordHash.slice(0, 12)}</code> on <code>ubuntu-latest</code>, 27 Oct 2026`));
  assert.doesNotMatch(html, /same hash/);
  screened(html, runs);
  // A laptop run that disagrees with an org run of the same commit is a different hash too.
  assert.equal(runState([laptop, on('org-hosted', 'org-ci-heavy', '2026-10-27T20:00:00Z', otherInputs)]).state, 'different');
});

test('a different hash is sticky for its commit: a later matching day still renders "Different hash", linking the differing runs', () => {
  // Day 1: the two org legs disagree. Day 2, the same commit: they agree, with the first leg's hash.
  const d1org = on('org-hosted', 'org-ci-heavy', '2026-10-26T20:00:00Z');
  const d1hosted = on('github-hosted', 'ubuntu-latest', '2026-10-26T20:05:00Z', otherInputs);
  const d2org = on('org-hosted', 'org-ci-heavy', '2026-10-27T20:00:00Z');
  const d2hosted = on('github-hosted', 'ubuntu-latest', '2026-10-27T20:05:00Z');
  const runs = [...pair(d1org, d1hosted, 'differedOn'), ...pair(d2org, d2hosted, 'replicatedOn')];
  ok(runs);
  assert.equal(runState(runs).state, 'different');
  assert.equal(runState(runs).latest.ranAt, '2026-10-27T20:05:00Z', 'the latest run is the matching day');
  const html = renderProvenance(runs, { runsPage: true });
  assert.deepEqual(badge(html), ['different', `${BADGES.different}.`]);
  assert.doesNotMatch(html, /same hash/i);
  // Each hash with the newest run of each class that printed it, linked to its row on the runs page.
  assert.ok(html.includes(`record <code>${d2org.recordHash.slice(0, 12)}</code> on <a href="runs/#${runAnchor(d2hosted)}"><code>ubuntu-latest</code>, 27 Oct 2026</a>, <a href="runs/#${runAnchor(d2org)}"><code>org-ci-heavy</code>, 27 Oct 2026</a>`));
  assert.ok(html.includes(`record <code>${d1hosted.recordHash.slice(0, 12)}</code> on <a href="runs/#${runAnchor(d1hosted)}"><code>ubuntu-latest</code>, 26 Oct 2026</a>`));
  assert.match(html, /A later run with a matching hash does not clear this; a new commit starts fresh\./);
  screened(html, runs);
  // On the lab page the links go one level up.
  assert.ok(renderProvenance(runs, { runsHref: '../runs/' }).includes(`<a href="../runs/#${runAnchor(d1hosted)}">`));
  // A new commit starts fresh.
  const fresh = { commit: { sha: 'd'.repeat(40), mainHead: 'd'.repeat(40), compare: 'identical', onMain: true } };
  const next = pair(on('org-hosted', 'org-ci-heavy', '2026-10-27T22:00:00Z', fresh), on('github-hosted', 'ubuntu-latest', '2026-10-27T22:05:00Z', fresh), 'replicatedOn');
  assert.equal(runState([...runs, ...next]).state, 'reproduced');
});

test('the badge is for the latest run\'s commit; older commits do not count toward it', () => {
  const newer = on('org-hosted', 'org-ci-heavy', '2026-10-27T22:00:00Z', { commit: { sha: 'd'.repeat(40), mainHead: 'd'.repeat(40), compare: 'identical', onMain: true } });
  const runs = [...pair(org, hosted, 'replicatedOn'), newer];
  ok(runs);
  const s = runState(runs);
  assert.equal(s.state, 'single');
  assert.equal(s.latest, newer);
  assert.match(renderProvenance(runs), /commit <code>dddddddd<\/code>/);
});

test('a replication or difference is shown only with the run behind it; a dishonest or foreign run refuses', () => {
  const claimed = { ...org, replicatedOn: [{ machineClass: 'ubuntu-latest', recordHash: org.recordHash }] };
  assert.match(runsProblems([claimed], { lab: 'rogue', where: 'f' }).join('\n'), /replicatedOn\/0: no run of commit aa35e6db on ubuntu-latest with that hash/);
  const other = on('github-hosted', 'ubuntu-latest', '2026-10-27T20:05:00Z', otherInputs);
  assert.match(runsProblems([{ ...org, differedOn: [{ machineClass: 'ubuntu-latest', recordHash: other.recordHash }] }], { lab: 'rogue', where: 'f' }).join('\n'), /differedOn\/0: no run/);
  assert.match(runsProblems([{ ...org, recordHash: 'e'.repeat(64) }], { lab: 'rogue', where: 'f' }).join('\n'), /recordHash/);
  assert.match(runsProblems([on('org-hosted', 'org-ci-heavy', '2999-01-01T00:00:00Z')], { lab: 'rogue', where: 'f' }).join('\n'), /after the check/);
  assert.match(runsProblems([org], { lab: 'brain-bench', where: 'f' }).join('\n'), /is not this tile's lab/);
  assert.match(runsProblems([], { lab: 'rogue', where: 'f' }).join('\n'), /at least one/);
  // Every reason at once: a forged run beside a foreign one with an unbacked claim reports all three.
  const mixed = runsProblems([{ ...org, recordHash: 'e'.repeat(64) }, { ...asLab(hosted, 'brain-bench'), replicatedOn: [{ machineClass: 'mac', recordHash: hosted.recordHash }] }], { lab: 'rogue', where: 'f' }).join('\n');
  for (const re of [/runs\[0\]#\/recordHash/, /runs\/1\/lab: "brain-bench"/, /runs\/1\/replicatedOn\/0: no run/]) assert.match(mixed, re);
});

test('the leak screen refuses a card that would show a hash no run holds', () => {
  const html = renderProvenance([org]);
  assert.ok(pageLeaks(`<div>${html}</div>`, recordHashes(laptop).filter(h => h !== org.recordHash)).some(p => /a hash the record does not hold/.test(p)));
});

test('the published Labs index: the Lab 05 card carries its provenance once, before its links, with the stylesheet', () => {
  const page = renderLabs()['labs/index.html'];
  assert.equal(readLabRuns().map(l => l.tile.experiment).join(), 'rogue');
  const start = page.indexOf('aria-labelledby="lab-tile-rogue">');
  const card = page.slice(start, page.indexOf('</article>', start));
  assert.equal(card.split('class="lab-provenance ').length, 2);
  assert.ok(card.indexOf('lab-provenance') < card.indexOf('<ul class="lab-tile-links">'));
  // The badge is whatever the committed runs say: a laptop re-run alone today, "reproduced" once org-runner days land.
  const { state } = runState(readLabRuns()[0].runs);
  assert.deepEqual(badge(card), [state, `${BADGES[state]}.`]);
  assert.equal(page.split('class="lab-provenance ').length, 2, 'only the lab with runs has a provenance');
  assert.equal(page.slice(0, page.indexOf('</head>')).split('<link rel="stylesheet" href="../assets/lab-runs.css">').length, 2);
  if (state === 'laptop') assert.doesNotMatch(page, /org machine|daily/i);
  assert.doesNotMatch(page, /daily/i);
});

test('a card that is not there exactly once refuses the build', () => {
  const pages = renderLabs();
  assert.throws(() => withLabRuns({ ...pages, 'labs/index.html': pages['labs/index.html'].replace('aria-labelledby="lab-tile-rogue">', '>') }), /the card of rogue is not there exactly once/);
});

// The runs page (WO-02): every run of every lab, newest first, each row linking its record.
const rogueTile = JSON.parse(readFileSync('site/data/labs/rogue-tile.json', 'utf8'));
const otherTile = { ...rogueTile, label: 'Lab 99', title: 'A second lab', experiment: 'second', links: [{ label: 'Its page', href: 'labs/second/index.html' }] };

test('no run in any record: the runs page says so, and has no table', () => {
  const html = renderRuns([]);
  assert.match(html, /<div class="lab-empty" id="no-runs"><p class="technical">NO RUN YET<\/p>/);
  assert.doesNotMatch(html, /<table/);
});

test('rows are newest first across labs; a tie is ordered by lab, then machine class, then hash; anchors never move', () => {
  const late = on('org-hosted', 'org-ci-heavy', '2026-10-27T22:00:00Z');
  const tieA = on('github-hosted', 'ubuntu-latest', '2026-10-27T20:00:00Z');
  const labs = [{ tile: rogueTile, href: 'data/labs/rogue/record.json', runs: [laptop, org, late, tieA] }, { tile: otherTile, href: 'data/labs/second/record.json', runs: [asLab(org, 'second')] }];
  const order = runRows(labs).map(r => `${r.run.lab} ${r.run.machineClass} ${r.run.ranAt}`);
  assert.deepEqual(order, ['rogue org-ci-heavy 2026-10-27T22:00:00Z', 'rogue org-ci-heavy 2026-10-27T20:00:00Z', 'rogue ubuntu-latest 2026-10-27T20:00:00Z', 'second org-ci-heavy 2026-10-27T20:00:00Z', 'rogue mac 2026-10-27T11:25:33Z']);
  const html = renderRuns(labs);
  const ids = [...html.matchAll(/<tr id="([^"]+)">/g)].map(m => m[1]);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5, 'one anchor per run');
  assert.equal(ids[0], runAnchor(late));
  assert.equal(runAnchor(laptop), 'run-rogue-mac-20261027112533-47c9ab93279d');
  // Adding a run does not move the anchors of the others.
  assert.deepEqual(new Set([...renderRuns([{ ...labs[0], runs: [laptop, org] }]).matchAll(/<tr id="([^"]+)">/g)].map(m => m[1])), new Set([runAnchor(laptop), runAnchor(org)]));
  assert.match(html, /<caption>5 runs, newest first\./);
});

test('each row says when, which lab, runner, machine class, commit, record hash and result, and links its record', () => {
  const html = renderRuns([{ tile: rogueTile, href: 'data/labs/rogue/record.json', runs: [laptop] }]);
  const row = /<tr id="run-rogue-mac-[^"]+">(.*?)<\/tr>/.exec(html)[1];
  const cells = [...row.matchAll(/<td>(.*?)<\/td>/g)].map(m => m[1]);
  assert.deepEqual(cells, ['<time datetime="2026-10-27T11:25:33Z">27 Oct 2026, 11:25 UTC</time>', '<a href="../../labs/rogue/index.html">Lab 05: Can an agent go rogue?</a>', 'laptop', '<code>mac</code>', '<code>aa35e6db</code>', '<code>47c9ab93279d</code>', 'SAME, 0 breaches', '<a href="../../data/labs/rogue/record.json">The record</a>']);
  assert.match(html, /<caption>One run, newest first\./);
});

test('the published runs page: Lab 05\'s laptop run, its record linked, linked from the index and the card, screened', () => {
  const pages = renderLabs();
  const page = pages[RUNS_PAGE];
  assert.ok(page, 'the runs page is rendered');
  assert.equal([...page.matchAll(/<tr id="/g)].length, readLabRuns().reduce((n, l) => n + l.runs.length, 0));
  assert.match(page, /<tr id="run-rogue-mac-20261027112533-47c9ab93279d">/);
  assert.match(page, /<a href="\.\.\/\.\.\/data\/labs\/rogue\/record\.json">The record<\/a>/);
  assert.doesNotMatch(page, /<!--[A-Z_]+-->/);
  assert.deepEqual(pageLeaks(page, readLabRuns().flatMap(l => l.runs.flatMap(recordHashes))), []);
  assert.doesNotMatch(page, /org machine|daily/i);
  const index = pages['labs/index.html'];
  const { latest } = runState(readLabRuns()[0].runs);
  assert.match(index, /<section class="company-section company-width" id="labs"[^>]*>.*<p class="lab-runs-link"><a href="runs\/">Every run of every lab, newest first<\/a><\/p>(<p class="lab-runs-link">[^]*?<\/p>)?<\/section>/s);
  // The card's link lands on the row of the run it shows, the lab's latest (the laptop re-run, until an org day lands).
  assert.match(index, new RegExp(`<p class="lab-provenance-more"><a href="runs/#${runAnchor(latest)}">This run, among every run</a></p>`));
  assert.match(page, new RegExp(`<tr id="${runAnchor(latest)}">`));
  assert.match(page, new RegExp(`<tr id="${runAnchor(laptop)}">`), 'the laptop re-run keeps its row');
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/labs\/runs\/<\/loc>/);
});

test('a runs page that would show a hash no record holds is refused', () => {
  const html = renderRuns([{ tile: rogueTile, href: 'data/labs/rogue/record.json', runs: [org] }]);
  assert.ok(pageLeaks(html, recordHashes(laptop).filter(h => h !== org.recordHash)).some(p => /a hash the record does not hold/.test(p)));
});

test('the build refuses a runs page that fails the screen, or whose template lost its marker', () => {
  // A fixture site with Lab 05's tile, its pinned record and the pages its links name, and the runs page template.
  const root = mkdtempSync(join(tmpdir(), 'lab-runs-'));
  try {
    for (const file of ['data/labs/rogue-tile.json', 'data/labs/rogue/record.json', 'data/labs/rogue/record.sha256', 'labs/rogue/index.html', RUNS_PAGE]) { mkdirSync(join(root, file, '..'), { recursive: true }); cpSync(join('site', file), join(root, file)); }
    const pages = { 'labs/index.html': renderLabs()['labs/index.html'].replace(/<div class="lab-provenance [^]*?<\/div>(?=<ul class="lab-tile-links">)/, '') };
    const template = readFileSync(join('site', RUNS_PAGE), 'utf8');
    assert.match(withLabRuns(pages, root)[RUNS_PAGE], /<tr id="run-rogue-mac-/, 'the fixture renders');
    writeFileSync(join(root, RUNS_PAGE), template.replace('</h1>', ' 0a1b2c3d4e5f6a7b</h1>'));
    assert.throws(() => withLabRuns(pages, root), /labs\/runs\/index\.html: the rendered page fails the screen:[^]*a hash the record does not hold \(0a1b2c3d4e5f\)/);
    writeFileSync(join(root, RUNS_PAGE), template.replace('<!--LAB_RUNS-->', ''));
    assert.throws(() => withLabRuns(pages, root), /<!--LAB_RUNS--> is missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
