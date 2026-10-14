import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FEED_PATH, HOME_LATEST, buildFeed, candidates, firstSentence, renderHome, renderPage, replaceBlock, sortUpdates, stale, titleSentence } from './updates.mjs';
import { builtCopy } from './test-build.mjs';

const entry = (key, date, kind = 'Results', extra = {}) => ({ key, date, kind, experiment: 'EXP 005', title: 'T', text: 'X.', href: 'journal/x.html', source: 'data/x/results.json', ...extra });

test('firstSentence keeps decimals and abbreviations inside the first sentence', () => {
  assert.equal(firstSentence('P1 refuted: 1 of 400 diverged (95% bound 1.40%). P2 supported.'), 'P1 refuted: 1 of 400 diverged (95% bound 1.40%).');
  assert.equal(firstSentence('Pre-registered; measured 29 Sep 2026: the claim is refuted.'), 'Pre-registered; measured 29 Sep 2026: the claim is refuted.');
  assert.equal(firstSentence('No full stop at all'), 'No full stop at all');
});

test('titleSentence keeps the record title unedited, so a lower-case name stays lower case', () => {
  assert.equal(titleSentence('Amendment 01: nina 0.34.0 and a pre-registered spotlight bar'), 'Amendment 01: nina 0.34.0 and a pre-registered spotlight bar.');
  assert.equal(titleSentence('Erratum 01: done.'), 'Erratum 01: done.');
});

test('a written date is frozen; a new entry takes its own date, then its first commit, then today with a warning', () => {
  const warnings = [];
  const item = (key, file, extra = {}) => ({ key, kind: 'Tool', experiment: null, title: key, text: `${key}.`, href: 'x', source: 's', file, ...extra });
  const list = [
    item('a', 'site/a', { ownDate: '2026-01-05' }),
    item('b', 'site/b', { ownDate: '2026-01-06' }),
    item('c', 'site/c'),
    item('d', 'site/d'),
  ];
  const feed = buildFeed(list, { updates: [{ key: 'a', date: '2025-12-31' }] }, {
    today: '2026-02-01', commitDay: file => (file === 'site/c' ? '2026-01-10' : null), warn: message => warnings.push(message),
  });
  assert.deepEqual(Object.fromEntries(feed.updates.map(e => [e.key, e.date])), { a: '2025-12-31', b: '2026-01-06', c: '2026-01-10', d: '2026-02-01' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /site\/d is not committed yet/);
  assert.deepEqual(feed.updates.map(e => e.key), ['d', 'c', 'b', 'a'], 'newest first');
  assert.ok(feed.updates.every(e => !('file' in e) && !('ownDate' in e)), 'working fields are not published');
});

test('the same day orders results before errata, amendments and plans, then the higher experiment first', () => {
  const sorted = sortUpdates([
    entry('p', '2026-01-01', 'Pre-registered'), entry('r6', '2026-01-01', 'Results', { experiment: 'EXP 006' }),
    entry('r5', '2026-01-01', 'Results'), entry('e', '2026-01-01', 'Erratum'), entry('later', '2026-01-02', 'Tool', { experiment: null }),
  ]);
  assert.deepEqual(sorted.map(e => e.key), ['later', 'r6', 'r5', 'e', 'p']);
});

test('renderers escape every value and the home block shows only the latest entries', () => {
  const feed = { updates: Array.from({ length: 6 }, (_, i) => entry(`k${i}`, `2026-01-0${6 - i}`, 'Results', { title: '<b>x</b> & "y"', href: 'journal/x.html?a="1"' })) };
  const home = renderHome(feed);
  assert.equal((home.match(/class="update-item"/g) || []).length, HOME_LATEST);
  assert.ok(!home.includes('<b>x</b>') && home.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;'));
  assert.ok(home.includes('href="./journal/x.html?a=&quot;1&quot;"'), 'home links carry ./ so they never equal a field-note row href');
  const page = renderPage(feed);
  assert.equal((page.match(/class="update-item"/g) || []).length, 6);
  assert.ok(page.includes('href="../journal/x.html'), 'the updates page links one level up');
  assert.ok(page.includes('<time datetime="2026-01-06">6 Jan 2026</time>'));
});

test('replaceBlock refuses a page without both markers in order', () => {
  assert.throws(() => replaceBlock('<p>no markers</p>', '<!-- a -->', '<!-- /a -->', 'x'), /not found/);
  assert.equal(replaceBlock('1<!-- a -->old<!-- /a -->2', '<!-- a -->', '<!-- /a -->', 'new'), '1new2');
});

test('the committed feed and both rendered blocks are exactly a fresh render of the built site', () => {
  const root = builtCopy();
  assert.deepEqual(stale(root, { commitDay: () => null, warn: message => assert.fail(`an entry has no committed date: ${message}`) }), [],
    'run: pnpm build && node scripts/updates.mjs --write');
});

test('every record the site publishes has exactly one dated update, linked to a page that exists', () => {
  const root = builtCopy();
  const feed = JSON.parse(readFileSync(join(root, FEED_PATH), 'utf8'));
  const sources = new Set(feed.updates.map(e => e.source));
  for (const slug of readdirSync(join(root, 'dist/data'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    const dir = join(root, 'dist/data', slug);
    if (!existsSync(join(dir, 'preregistration.json'))) continue;
    for (const file of readdirSync(dir).filter(name => /^(preregistration|results|(amendment|erratum)-\d{2})\.json$/.test(name))) {
      assert.ok(sources.has(`data/${slug}/${file}`), `data/${slug}/${file} has an update`);
    }
  }
  assert.equal(feed.updates.length, candidates(root).length);
  for (const update of feed.updates) {
    assert.match(update.date, /^\d{4}-\d{2}-\d{2}$/);
    if (update.href.startsWith('#')) continue;
    const [path] = update.href.split('#');
    assert.ok(existsSync(join(root, 'dist', path.endsWith('/') ? `${path}index.html` : path)), `${update.key} links to ${update.href}`);
  }
  const home = readFileSync(join(root, 'dist/index.html'), 'utf8');
  for (const update of feed.updates.slice(0, HOME_LATEST)) assert.ok(home.includes(`<time datetime="${update.date}">`), `${update.key} is on the home page`);
});
