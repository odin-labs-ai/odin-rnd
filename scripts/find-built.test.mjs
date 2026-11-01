// Find, as built (mission rnd-site-ux-nav-1101, WP4): scripts/build.mjs writes the site index to dist/data/index.json,
// lists it on dist/find/index.html without JavaScript, and adds the site chrome to every page. Checked on a build in a
// disposable copy (scripts/test-build.mjs), never in the checkout; the pure parts are tested in find-build.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { hrefOnSite, experimentIdsInData } from './site-index.mjs';
import { FIND_MARKER, GROUPS } from './find-build.mjs';
import { FIND_EXEMPT, escapeHtml, pageTitle } from './site-chrome.mjs';
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
  assert.ok(Array.isArray(index.items) && index.items.length > 0, 'the index lists everything the site publishes');
  // Exact per-kind counts, each from a source the index does not read through buildIndex: the experiment folders and
  // data in site/, the committed journal pages, updates.json, the frozen lab dates and the tool pages.
  const count = type => index.items.filter(item => item.type === type).length;
  assert.equal(count('experiment'), experimentIdsInData('site').length, 'one item per experiment on the site');
  assert.equal(count('note'), readdirSync('site/journal').filter(name => name.endsWith('.html')).length, 'one item per field note');
  assert.equal(count('update'), JSON.parse(readFileSync('site/data/updates.json', 'utf8')).updates.length, 'one item per update');
  assert.equal(count('lab'), Object.keys(JSON.parse(readFileSync('site/data/find-lab-dates.json', 'utf8')).labs).length, 'one item per lab');
  assert.equal(count('tool'), readdirSync('site/projects', { withFileTypes: true }).filter(e => e.isDirectory()).length, 'one item per tool page');
  assert.equal(index.items.length, ['experiment', 'note', 'update', 'lab', 'tool'].map(count).reduce((a, b) => a + b), 'no item of another kind');
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

test('each built page marks its own section current in the header, and only that one', () => {
  const { dist } = built();
  const currentOf = rel => {
    const nav = readFileSync(join(dist, rel), 'utf8').match(/<header class="site-header[\s\S]*?<\/header>/)[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];
    return [...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(m => m[1]);
  };
  const expected = {
    'index.html': [],
    'journal/a-passing-pipeline.html': ['Field notes'],
    'journal/index.html': ['Field notes'],
    'labs/rogue/index.html': ['Labs'],
    'labs/index.html': ['Labs'],
    'experiments/index.html': ['Experiments'],
    'updates/index.html': ['Updates'],
    'work-with-us/index.html': ['Work with us'],
    'partners/index.html': ['Partners'],
    'projects/index.html': [],
    'projects/ci-witness/index.html': [],
    'find/index.html': ['Find'],
  };
  for (const [rel, current] of Object.entries(expected)) assert.deepEqual(currentOf(rel), current, rel);
});

test('the sitemap lists /journal/ and /projects/ directly before /find/, which stays last', () => {
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/journal\/<\/loc><\/url><url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/projects\/<\/loc><\/url><url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/<\/loc><\/url><\/urlset>/);
});

test('wave 3, as built: one canonical nav on every page, journal/ and projects/ listing every note and tool, crumbs to them', () => {
  const { dist, files, index } = built();
  const CANONICAL = ['Factory', 'Experiments', 'Labs', 'Updates', 'Field notes', 'Work with us', 'Partners', 'Find'];
  for (const rel of files.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(dist, rel), 'utf8');
    const nav = html.match(/<header class="site-header[\s\S]*?<\/header>/)[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...nav.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(m => m[1]), CANONICAL, `${rel}: the canonical nav`);
    assert.equal(/<a href="[^"]*find\/" aria-current="page">Find<\/a>/.test(nav), rel === 'find/index.html', `${rel}: Find is current on /find/ only`);
  }
  const rows = page => [...readFileSync(join(dist, page), 'utf8').matchAll(/<li class="update-item" data-reveal><a href="\.\.\/([^"]+)">/g)].map(m => m[1]);
  const hrefsOf = type => index.items.filter(i => i.type === type).map(i => i.href).sort();
  assert.deepEqual(rows('journal/index.html').sort(), hrefsOf('note'), 'journal/ lists every note once');
  assert.deepEqual(rows('projects/index.html').sort(), hrefsOf('tool'), 'projects/ lists every tool once');
  const experiments = readFileSync(join(dist, 'experiments/index.html'), 'utf8');
  assert.equal((experiments.match(/id="every-experiment"/g) || []).length, 1, 'experiments/ ends with All experiments');
  // The All experiments list is exactly the experiments the site's own data publishes, read without the index: one row
  // each, newest number first, each row linking its index item's page.
  const block = experiments.match(/<section [^>]*id="every-experiment"[\s\S]*?<\/section>/)[0];
  const listed = [...block.matchAll(/<span class="update-kind technical">(EXP \d{3})\b/g)].map(m => m[1]);
  const published = experimentIdsInData('site');
  assert.equal(listed.length, published.length, 'one row per experiment the site publishes');
  assert.deepEqual([...listed].sort(), published, 'exactly the experiments the site publishes');
  assert.deepEqual(listed, [...published].reverse(), 'newest number first');
  const rowLinks = [...block.matchAll(/<li class="update-item" data-reveal><a href="\.\.\/([^"]+)">/g)].map(m => m[1]);
  const byId = new Map(index.items.filter(i => i.type === 'experiment').map(i => [i.id, i.href]));
  assert.deepEqual(rowLinks, listed.map(label => byId.get(`exp-${label.slice(4)}`)), 'each row links its experiment\'s page');
  for (const item of index.items.filter(i => i.type === 'note' || i.type === 'tool')) {
    const page = item.href.endsWith('/') ? `${item.href}index.html` : item.href;
    const crumbs = readFileSync(join(dist, page), 'utf8').match(/<nav class="crumbs"[\s\S]*?<\/nav>/)[0];
    const up = item.type === 'note' ? '../journal/' : '../../projects/';
    assert.ok(crumbs.includes(`<a href="${up}">${item.type === 'note' ? 'Field notes' : 'Tools'}</a>`), `${page}: the trail leads to its index page`);
    const label = crumbs.match(/<li aria-current="page">([\s\S]*?)<\/li>/)[1];
    const slug = page.split('/').at(-1) === 'index.html' ? page.split('/').at(-2) : page.split('/').at(-1).replace(/\.html$/, '');
    assert.notEqual(label, slug, `${page}: the trail names the page, not its slug`);
    const html = readFileSync(join(dist, page), 'utf8');
    assert.equal(label, escapeHtml(pageTitle(html)), `${page}: the label is the page's own heading`);
    assert.ok(label.length > slug.length / 2 && /\s/.test(label), `${page}: a title in words`);
  }
});
