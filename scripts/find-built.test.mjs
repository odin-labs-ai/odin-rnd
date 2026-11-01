// Find, as built (mission rnd-site-ux-nav-1101, WP4): scripts/build.mjs writes the site index to dist/data/index.json,
// lists it on dist/find/index.html without JavaScript, and adds the site chrome to every page. Checked on a build in a
// disposable copy (scripts/test-build.mjs), never in the checkout; the pure parts are tested in find-build.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { hrefOnSite } from './site-index.mjs';
import { FIND_MARKER, GROUPS } from './find-build.mjs';
import { FIND_EXEMPT } from './site-chrome.mjs';
import { journalRows } from './experiment-ledger.mjs';
import { builtCopy } from './test-build.mjs';

const schema = JSON.parse(readFileSync('scripts/schemas/site-index.schema.json', 'utf8'));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const built = () => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  const files = walk(dist).map(file => relative(dist, file).split('\\').join('/'));
  const index = JSON.parse(readFileSync(join(dist, 'data/index.json'), 'utf8'));
  return { root, dist, files, index };
};

test('the build writes the site index with every item schema-valid and linking a file of the built site', () => {
  const { dist, files, index } = built();
  assert.ok(Array.isArray(index.items) && index.items.length > 100, 'the index lists everything the site publishes');
  const pages = new Set(files);
  for (const item of index.items) {
    assert.deepEqual(validate(schema, item), [], `${item.id} matches the schema`);
    assert.ok(hrefOnSite(item.href, pages), `${item.id} links ${item.href}, a file of the built site`);
    assert.ok(existsSync(join(dist, item.href.split('#')[0].replace(/\/$/, '/index.html'))), `${item.id}: ${item.href} resolves`);
  }
  const topics = JSON.parse(readFileSync('site/data/find-topics.json', 'utf8')).topics;
  assert.deepEqual(index.topics, Object.fromEntries(topics.map(t => [t.id, t.label])), 'every topic carries its label');
  for (const item of index.items) for (const topic of item.topics) assert.ok(topic in index.topics, `${item.id}: topic ${topic} has a label`);
  for (const item of index.items) for (const key of ['title', 'summary']) {
    assert.doesNotMatch(item[key], /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i, `${item.id}'s ${key} is plain text, which the Find page shows as it is`);
  }
  assert.ok(!existsSync('site/data/index.json'), 'the index is built, never committed');
});

test('the Find page lists every item without JavaScript, grouped by kind, each link resolving', () => {
  const { dist, index } = built();
  const html = readFileSync(join(dist, 'find/index.html'), 'utf8');
  assert.ok(!html.includes(FIND_MARKER), 'the marker is replaced');
  const staticBlock = html.match(/<div id="find-static" class="find-static">([\s\S]*?)<\/div>\s*<\/section>/)[1];
  const links = [...staticBlock.matchAll(/<li><a href="([^"]+)">/g)].map(m => m[1]);
  assert.equal(links.length, index.items.length, 'one row per item');
  for (const href of links) {
    assert.ok(href.startsWith('../'), `${href} is relative to find/`);
    const target = resolve(dist, 'find', href.split('#')[0]);
    assert.ok(existsSync(href.split('#')[0].endsWith('/') ? join(target, 'index.html') : target), `${href} resolves from /find/`);
  }
  const headings = [...staticBlock.matchAll(/<h2 id="find-([a-z]+)">/g)].map(m => m[1]);
  assert.deepEqual(headings, GROUPS.map(([type]) => type).filter(type => index.items.some(i => i.type === type)), 'groups in kind order');
  assert.equal((staticBlock.match(/<time datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time>/g) || []).length, index.items.length, 'every row has its date in a <time>');
});

test('every page carries the chrome: one Find link (bar the 404 page) and one chrome stylesheet that resolves', () => {
  const { dist, files } = built();
  for (const rel of files.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(dist, rel), 'utf8');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]*chrome\.css)">/g)].map(m => m[1]);
    assert.equal(sheets.length, 1, `${rel} links chrome.css once`);
    assert.equal(resolve(dirname(join(dist, rel)), sheets[0]), resolve(dist, 'assets/chrome.css'), `${rel}: chrome.css resolves`);
    const nav = html.match(/<header class="site-header[\s\S]*?<\/header>/)?.[0] ?? '';
    const finds = (nav.match(/>Find<\/a>/g) || []).length;
    assert.equal(finds, 1, `${rel} has one Find link in its header${FIND_EXEMPT.has(rel) ? ' (its own)' : ''}`);
  }
});

test('the home field-note rows are unchanged by the chrome: one row per note, five open', () => {
  const { dist, index } = built();
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const notes = index.items.filter(i => i.type === 'note').length;
  assert.equal((home.match(/<a class="journal-row" href="/g) || []).length, notes, 'one home row per field note');
  assert.equal(journalRows(home).length, notes);
  assert.match(home, new RegExp(`Show the ${notes - 5} earlier notes`), 'the home still opens five and folds the rest');
  assert.doesNotMatch(home, /class="crumbs"|class="related"/, 'no breadcrumbs or related links on the home');
});

test('the sitemap lists /find/', () => {
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/<\/loc><\/url><\/urlset>/);
});
