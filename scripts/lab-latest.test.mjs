import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestRunPages, latestRuns, placeHomeLatestRuns, placeUpdatesLatestRuns, renderLatestRuns } from './lab-latest.mjs';
import { readLabRuns, runAnchor } from './lab-runs.mjs';

const labs = readLabRuns('site', { now: new Date('2026-11-06T00:00:00Z') });
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

test('both pages carry exact run links, record links, printed verdicts and the interpretation boundary', () => {
  const selected = latestRuns(labs);
  const builtHome = placeHomeLatestRuns(home, labs);
  const builtUpdates = placeUpdatesLatestRuns(updates, labs);
  assert.equal((builtHome.match(/id="latest-runs-title"/g) ?? []).length, 1);
  assert.equal((builtUpdates.match(/id="latest-runs-title"/g) ?? []).length, 1);
  assert.match(builtHome, /<section class="latest-runs" aria-labelledby="latest-runs-title">/);
  assert.match(builtUpdates, /<section class="latest-runs" aria-labelledby="latest-runs-title">/);
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
