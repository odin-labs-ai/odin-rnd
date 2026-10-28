import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { recordHash, recordProblems } from './lab-record.mjs';
import { daySeries, readLabRuns, renderDaySeries, runAnchor, runsProblems } from './lab-runs.mjs';
import { renderLabs } from './labs.mjs';

// A lab's org-machine days as a dated series (scripts/lab-runs.mjs daySeries, renderDaySeries): one point per day the
// record holds, taken from the runs alone, never estimated between days. Fixtures are Lab 05's Mac re-run moved to
// the org machines and re-hashed, so each is an honest record v1.
const mac = JSON.parse(readFileSync('site/data/labs/rogue/record.json', 'utf8')).runs[0];
const leg = (runner, machineClass, ranAt, change = {}) => {
  const r = { ...structuredClone(mac), runner, machineClass, image: null, ranAt, replicatedOn: [], differedOn: [], ...change };
  return { ...r, recordHash: recordHash(r) };
};
const pair = (day, b = {}) => {
  const x = leg('github-hosted', 'ubuntu-latest', `${day}T05:23:00Z`), y = leg('org-hosted', 'org-ci-heavy', `${day}T05:23:40Z`, b);
  const list = x.recordHash === y.recordHash ? 'replicatedOn' : 'differedOn';
  return [{ ...x, [list]: [{ machineClass: y.machineClass, recordHash: y.recordHash }] }, { ...y, [list]: [{ machineClass: x.machineClass, recordHash: x.recordHash }] }];
};
const red = { result: { ...mac.result, now: '0000000000000000', verdict: 'DIFFERENT' } };
const week = [mac, ...pair('2026-10-20'), ...pair('2026-10-21'), leg('org-hosted', 'org-ci-heavy', '2026-10-22T05:23:40Z'),
  ...pair('2026-10-23', red), ...pair('2026-10-24'), ...pair('2026-10-25'), ...pair('2026-10-26')];

test('one point per org day, oldest first; the laptop run is no point; a missing day is no point', () => {
  const s = daySeries([...week].reverse());
  assert.deepEqual(s.map(p => p.day), ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  assert.deepEqual(s.map(p => p.state), ['same', 'same', 'single', 'different', 'same', 'same', 'same']);
  assert.deepEqual(s.map(p => p.values.reproduced), [2, 2, 1, 1, 2, 2, 2]);
  assert.equal(s[3].hashes.length, 2, 'a different day keeps both hashes');
  assert.deepEqual(daySeries([mac]), [], 'a laptop re-run alone is no series');
});

test('a day with no run in the middle is no point and no entry; nothing is filled in', () => {
  const gap = [mac, ...pair('2026-10-20'), ...pair('2026-10-22')];
  assert.deepEqual(daySeries(gap).map(p => p.day), ['2026-10-20', '2026-10-22']);
  const html = renderDaySeries(gap);
  assert.equal([...html.matchAll(/<circle class="engine-dot"/g)].length, 2);
  assert.doesNotMatch(html, /2026-10-21/);
});

test('the day is the UTC day: a run whose time is not UTC (Z) never reaches the series', () => {
  const offset = { ...pair('2026-10-20')[0], ranAt: '2026-10-21T01:30:00+02:00' };
  assert.ok(recordProblems(offset).some(p => /\/ranAt/.test(p)), 'record v1 refuses a non-UTC time');
  assert.ok(runsProblems([mac, offset], { lab: 'rogue', where: 'fixture' }).length > 0, 'and so does the runs reader');
});

test('seven days render as a step chart and a dated list, each day linked to its runs, labelled, screened', () => {
  const html = renderDaySeries(week);
  assert.match(html, /<svg class="lab-chart engine-plot"/);
  assert.equal([...html.matchAll(/<circle class="engine-dot"/g)].length, 7, 'one dot per day, nothing between');
  assert.equal([...html.matchAll(/<li data-state="/g)].length, 7);
  assert.match(html, /<li data-state="different"><time datetime="2026-10-23">2026-10-23<\/time>: a different hash, 1 of 2 reproduced/);
  assert.match(html, /<li data-state="single"><time datetime="2026-10-22">2026-10-22<\/time>: one org machine, 1 of 1 reproduced/);
  for (const r of week.slice(1)) assert.ok(html.includes(`href="../runs/#${runAnchor(r)}"`), r.ranAt);
  assert.deepEqual(pageLeaks(`<div>${html}</div>`, week.flatMap(recordHashes)), []);
});

test('one day is stated, never drawn; no org day renders nothing', () => {
  const one = renderDaySeries([mac, ...pair('2026-10-20')]);
  assert.match(one, /Run on org machines on one day so far, 2026-10-20\./);
  assert.doesNotMatch(one, /<svg/);
  assert.equal(renderDaySeries([mac]), '');
});

test('the published Lab 05 page carries the series its committed runs give', () => {
  const page = renderLabs()['labs/rogue/index.html'];
  const runs = readLabRuns().find(l => l.tile.experiment === 'rogue').runs;
  const n = daySeries(runs).length;
  if (n === 0) assert.doesNotMatch(page, /lab-day-history/);
  else if (n === 1) assert.match(page, /Run on org machines on one day so far, \d{4}-\d{2}-\d{2}\./);
  else assert.equal([...page.matchAll(/<circle class="engine-dot"/g)].length >= n, true);
  assert.equal(page.split('class="lab-day-history"').length, n ? 2 : 1, 'once, inside "Its runs"');
});
