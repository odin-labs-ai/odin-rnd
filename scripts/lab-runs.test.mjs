import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { recordHash } from './lab-record.mjs';
import { BADGES, readLabRuns, renderProvenance, runState, runsProblems, withLabRuns } from './lab-runs.mjs';
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
  assert.match(html, new RegExp(`<code>org-ci-heavy</code> printed record <code>${org.recordHash.slice(0, 12)}</code>`));
  assert.match(html, new RegExp(`<code>ubuntu-latest</code> printed record <code>${other.recordHash.slice(0, 12)}</code>`));
  assert.doesNotMatch(html, /same hash/);
  screened(html, runs);
  // A laptop run that disagrees with an org run of the same commit is a different hash too.
  assert.equal(runState([laptop, on('org-hosted', 'org-ci-heavy', '2026-10-27T20:00:00Z', otherInputs)]).state, 'different');
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
  assert.deepEqual(badge(card), ['laptop', `${BADGES.laptop}.`]);
  assert.equal(page.split('class="lab-provenance ').length, 2, 'only the lab with runs has a provenance');
  assert.match(page, /<link rel="stylesheet" href="\.\.\/assets\/lab-runs\.css">\n<\/head>/);
  assert.doesNotMatch(page, /org machine|daily/i);
});

test('a card that is not there exactly once refuses the build', () => {
  const pages = renderLabs();
  assert.throws(() => withLabRuns({ ...pages, 'labs/index.html': pages['labs/index.html'].replace('aria-labelledby="lab-tile-rogue">', '>') }), /the card of rogue is not there exactly once/);
});
