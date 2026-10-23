import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// The methods page (site/methods/index.html) explains how the lab works by citing files in this repository. A cite
// that no longer exists is a claim the page can no longer back, so every repository path it names must exist, and
// the page must stay reachable (sitemap, home page link). vp-grow-odin-r-d bundle-1 WO-04.
const PAGE = 'site/methods/index.html';
const html = readFileSync(PAGE, 'utf8');

/** Every <code>…</code> that names a repository path: a top-level folder or file of this repository. */
export function citedPaths(source) {
  const roots = /^(experiments|scripts|docs|site|research|results|runs|harness|demos|\.github)\/|^(AGENTS|README|PRODUCT|DESIGN)\.md$|^package\.json$/;
  return [...source.matchAll(/<code>([^<\s]+)<\/code>/g)].map(m => m[1]).filter(p => roots.test(p));
}

test('every repository path the methods page cites exists in the tree', () => {
  const cited = citedPaths(html);
  assert.ok(cited.length >= 15, `the page cites its claims (found ${cited.length})`);
  const missing = cited.filter(p => !existsSync(p));
  assert.deepEqual(missing, [], 'dead cites on the methods page');
});

test('the dead-cite check fails closed on a path that does not exist', () => {
  const fake = citedPaths('<p><code>experiments/no-such/preregistration.json</code> and <code>pnpm test</code></p>');
  assert.deepEqual(fake, ['experiments/no-such/preregistration.json'], 'commands are not paths; paths are');
  assert.equal(fake.filter(p => !existsSync(p)).length, 1);
});

test('the methods page is in the sitemap and linked from the experiment list', () => {
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/methods\/<\/loc>/);
  assert.match(readFileSync('scripts/experiment-ledger.mjs', 'utf8'), /href="methods\/"/);
});

test('every section the page promises is present', () => {
  for (const id of ['pre-registration', 'freezing', 'spend', 'refutation', 'review', 'reproduce', 'limits']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const cmd of ['pnpm install --frozen-lockfile', 'pnpm experiment', 'pnpm build', 'pnpm check']) assert.ok(html.includes(cmd), cmd);
});
