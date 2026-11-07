import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestRunPages, latestRuns, placeHomeLatestRuns, placeUpdatesLatestRuns, renderLatestRuns } from './lab-latest.mjs';
import { readLabRuns, runAnchor } from './lab-runs.mjs';

const labs = readLabRuns('site');
const home = '<head></head><section class="updates-feed content-section" id="updates" aria-labelledby="updates-title"><h2 id="updates-title">Updates</h2><ol class="update-list" aria-labelledby="updates-title"><li>Editorial update</li></ol></section>';
const updates = '<main><section class="company-section company-width updates-all" aria-label="All updates"><!-- updates-list: rendered by scripts/updates.mjs --write from site/data/updates.json; do not edit by hand --><p>Editorial archive</p></section></main>';

test('adding and removing a lab changes the latest window; repeated runs of one lab yield one card', () => {
  assert.ok(labs.length >= 2, 'the published fixture has two labs with pinned runs');
  const one = labs.slice(0, 1);
  const two = labs.slice(0, 2);
  const added = renderLatestRuns(two);
  const removed = renderLatestRuns(one);
  assert.equal(latestRuns(two).length, 2);
  assert.equal((added.match(/class="latest-run"/g) ?? []).length, 2);
  assert.equal((removed.match(/class="latest-run"/g) ?? []).length, 1);
  assert.ok(added.includes(`${two[1].tile.label}:`));
  assert.ok(!removed.includes(`${two[1].tile.label}:`));
  const repeat = { ...one[0], runs: [...one[0].runs, one[0].runs.at(-1)] };
  assert.equal(latestRuns([repeat]).length, 1, 'the same lab cannot fill the window with repeated checks');
  assert.equal(renderLatestRuns([]), '', 'an empty record set does not invent activity');
});

test('four interleaved labs show the three newest distinct labs, not three runs of one lab', () => {
  const fixture = [
    ['alpha', ['2026-10-01T09:00:00Z', '2026-10-06T10:00:00Z']],
    ['beta', ['2026-10-03T09:00:00Z', '2026-10-05T10:00:00Z']],
    ['gamma', ['2026-10-04T09:00:00Z', '2026-10-07T10:00:00Z']],
    ['delta', ['2026-10-06T09:00:00Z']],
  ].map(([experiment, times]) => ({
    tile: { experiment }, href: `data/labs/${experiment}/record.json`,
    runs: times.map(ranAt => ({ ranAt, machineClass: 'org-ci-heavy', recordHash: 'a'.repeat(64) })),
  }));
  const selected = limit => latestRuns(fixture, limit).map(({ tile, run }) => [tile.experiment, run.ranAt]);
  assert.deepEqual(selected(3), [
    ['gamma', '2026-10-07T10:00:00Z'],
    ['alpha', '2026-10-06T10:00:00Z'],
    ['delta', '2026-10-06T09:00:00Z'],
  ]);
  assert.deepEqual(selected(4).map(([lab]) => lab), ['gamma', 'alpha', 'delta', 'beta']);
});

test('the page reader refuses a committed run after an injected validation time', () => {
  const newest = latestRuns(labs)[0].run.ranAt;
  assert.throws(() => latestRunPages(home, updates, 'site', { now: new Date(Date.parse(newest) - 1000) }), /after the check/);
});

test('direct rendering refuses offsets and impossible UTC dates before formatting the summary', () => {
  const run = latestRuns(labs.slice(0, 1))[0].run;
  for (const ranAt of ['2026-10-06T10:00:00+01:00', '2026-02-30T10:00:00Z']) {
    const malformed = [{ ...labs[0], runs: [{ ...run, ranAt }] }];
    assert.throws(() => renderLatestRuns(malformed, { collapsed: true }), /Latest lab runs refused:[\s\S]*ranAt/);
  }
});

test('both pages carry exact run links, record links, printed verdicts and the interpretation boundary', () => {
  const selected = latestRuns(labs);
  const builtHome = placeHomeLatestRuns(home, labs);
  const builtUpdates = placeUpdatesLatestRuns(updates, labs);
  assert.equal((builtHome.match(/id="latest-runs-title"/g) ?? []).length, 1);
  assert.equal((builtUpdates.match(/id="latest-runs-title"/g) ?? []).length, 1);
  assert.match(builtHome, /<section class="latest-runs" aria-labelledby="latest-runs-title">/);
  assert.match(builtUpdates, /<section class="latest-runs" aria-labelledby="latest-runs-title">/);
  assert.match(builtHome, /<details class="latest-runs-disclosure"><summary><strong><time datetime="[^"]+">[^<]+<\/time>: Lab \d+, [A-Z]+<\/strong>/);
  assert.ok(!builtHome.includes('<details class="latest-runs-disclosure" open'), 'home cards start folded');
  assert.ok(!builtUpdates.includes('latest-runs-disclosure'), 'Updates renders its cards without a disclosure');
  assert.equal((builtUpdates.match(/class="latest-run"/g) ?? []).length, selected.length);
  assert.ok(builtHome.indexOf('Editorial update') < builtHome.indexOf('Latest lab runs'));
  assert.ok(builtUpdates.indexOf('Latest lab runs') < builtUpdates.indexOf('Editorial archive'));
  for (const { href, run } of selected) {
    for (const [page, prefix] of [[builtHome, ''], [builtUpdates, '../']]) {
      assert.ok(page.includes(`href="${prefix}labs/runs/#${runAnchor(run)}"`));
      assert.ok(page.includes(`href="${prefix}${href}"`));
      assert.ok(page.includes(`datetime="${run.ranAt}"`));
      assert.ok(page.includes(`>${run.result.verdict}</strong>`));
      assert.ok(page.includes('does not establish a new experiment or independent validation'));
    }
  }
  assert.throws(() => placeHomeLatestRuns(builtHome, labs), /already filled/);
  assert.throws(() => placeUpdatesLatestRuns(builtUpdates, labs), /already filled/);
});

test('the real pinned records place the same newest run in both source page shells', () => {
  const [first] = latestRuns(labs);
  const pages = latestRunPages(readFileSync('site/index.html', 'utf8'), readFileSync('site/updates/index.html', 'utf8'));
  for (const [path, html] of Object.entries(pages)) {
    assert.ok(html.includes(`labs/runs/#${runAnchor(first.run)}`), `${path} links the newest validated run`);
    assert.equal((html.match(/id="latest-runs-title"/g) ?? []).length, 1);
  }
});
