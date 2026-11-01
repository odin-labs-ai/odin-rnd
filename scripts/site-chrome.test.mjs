// Site chrome (scripts/site-chrome.mjs, mission rnd-site-ux-nav-1101 WP3): the Find link, breadcrumbs and related aside
// added to the finished pages. Runs on copies of real committed pages in a temp dir; never touches site/ or dist/.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { addBreadcrumbs, addChromeStylesheet, addFindLink, addRelated, injectChrome, pageClass, pageKey, pickRelated, relativeHref } from './site-chrome.mjs';
import { journalRows } from './experiment-ledger.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const NOTE = 'journal/a-passing-pipeline.html';
const PAGES = ['index.html', NOTE, 'projects/ci-witness/index.html', 'labs/index.html', 'labs/runs/index.html', 'partners/index.html', 'updates/index.html', '404.html'];

const items = [
  { type: 'note', id: 'exp-pipeline', title: 'A passing pipeline', date: '2026-09-01', stage: 'results', topics: ['ci', 'release'], summary: 's', href: NOTE },
  { type: 'experiment', id: 'exp-pipeline', title: 'The pipeline experiment', date: '2026-08-01', stage: 'results', topics: ['other'], summary: 's', href: 'projects/ci-witness/' },
  { type: 'lab', id: 'lab-runs', title: 'Every lab run', date: '2026-10-20', stage: 'results', topics: ['release'], summary: 's', href: 'labs/runs/' },
  { type: 'update', id: 'u-x', title: 'An update', date: '2026-10-25', stage: 'results', topics: ['ci'], summary: 's', href: 'updates/' },
  { type: 'tool', id: 't-none', title: 'Unrelated', date: '2026-10-30', stage: 'results', topics: ['nothing'], summary: 's', href: 'labs/' },
];

/** A temp dist with real page copies and a stub Find page; returns its root. */
function tempDist() {
  const dir = mkdtempSync(join(tmpdir(), 'site-chrome-'));
  dirs.push(dir);
  for (const page of PAGES) { mkdirSync(dirname(join(dir, page)), { recursive: true }); cpSync(join('site', page), join(dir, page)); }
  mkdirSync(join(dir, 'find'), { recursive: true });
  writeFileSync(join(dir, 'find/index.html'), '<!doctype html><head><title>Find</title></head><header class="site-header"><nav aria-label="Main navigation"><a href="../">Home</a></nav></header><main id="main"></main>');
  return dir;
}

const findLinks = html => (html.match(/<a href="(?:\.\.\/)*find\/">Find<\/a>/g) || []).length;
const headerNav = html => html.match(/<header class="site-header[\s\S]*?<\/header>/)[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];

test('every page with a header navigation gets exactly one Find link, last in that navigation, pointing at the real page', () => {
  const dist = tempDist();
  const counts = injectChrome({ distDir: dist, items });
  assert.equal(counts.pages, PAGES.length + 1);
  for (const page of [...PAGES.filter(p => p !== '404.html'), 'find/index.html']) {
    const html = readFileSync(join(dist, page), 'utf8');
    assert.equal(findLinks(html), 1, page);
    const nav = headerNav(html);
    assert.match(nav, /<a href="(?:\.\.\/)*find\/">Find<\/a><\/nav>$/, `${page}: Find is the last link`);
    const href = nav.match(/<a href="([^"]*find\/)">Find<\/a>/)[1];
    assert.ok(existsSync(resolve(dirname(join(dist, page)), href, 'index.html')), `${page}: ${href} resolves`);
    assert.doesNotMatch(href + 'Find', /\d/, 'no digit in the inserted link');
  }
  assert.equal(findLinks(readFileSync(join(dist, '404.html'), 'utf8')), 0, 'the 404 page is exempt (served at any path)');
});

test('injecting twice changes nothing the second time', () => {
  const dist = tempDist();
  injectChrome({ distDir: dist, items });
  const once = Object.fromEntries(PAGES.map(p => [p, readFileSync(join(dist, p), 'utf8')]));
  injectChrome({ distDir: dist, items });
  for (const page of PAGES) assert.equal(readFileSync(join(dist, page), 'utf8'), once[page], page);
  const home = once['index.html'];
  assert.equal(addFindLink(home, ''), home);
  const crumbed = once[NOTE];
  assert.equal(addBreadcrumbs(crumbed, [{ label: 'Home', href: '../' }, { label: 'X' }]), crumbed);
  assert.equal(addRelated(crumbed, [{ type: 'note', title: 'T', href: 'x.html' }]), crumbed);
});

test('a page without exactly one site header, or a header without exactly one navigation, throws', () => {
  assert.throws(() => addFindLink('<html><body><main></main></body></html>', ''), /exactly one site header/);
  const header = '<header class="site-header dark-surface"><nav aria-label="Main navigation"><a href="./">Home</a></nav></header>';
  assert.throws(() => addFindLink(header + header, ''), /exactly one site header/);
  assert.throws(() => addFindLink('<header class="site-header"><a href="./">Home</a></header>', ''), /exactly one navigation/);
  assert.throws(() => addFindLink('<header class="site-header"><nav></nav><nav></nav></header>', ''), /exactly one navigation/);
  assert.throws(() => addFindLink(header, 'x/'), /prefix/);
  // The 404 page is exempt: its header carries its own absolute Find link, once.
  assert.equal((headerNav(readFileSync('site/404.html', 'utf8')).match(/<a href="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/">Find<\/a>/g) || []).length, 1, 'the 404 header links Find itself');
  assert.throws(() => addBreadcrumbs('<main></main><main></main>', [{ label: 'Home', href: './' }, { label: 'X' }]), /exactly one <main>/);
  assert.throws(() => addRelated('<main></main>', [{ type: 'note', title: 'T', href: 'x' }]), /exactly one site footer/);
});

test('breadcrumbs and the related aside go on notes, labs and tools only, with links that resolve', () => {
  const dist = tempDist();
  injectChrome({ distDir: dist, items });
  const read = page => readFileSync(join(dist, page), 'utf8');
  const note = read(NOTE);
  assert.match(note, /<main id="main" class="article-shell"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="\.\.\/">Home<\/a><\/li><li><a href="\.\.\/#journal">Field notes<\/a><\/li><li aria-current="page">A passing pipeline<\/li><\/ol><\/nav>/);
  assert.match(read('labs/runs/index.html'), /<li><a href="\.\.\/\.\.\/labs\/">Labs<\/a><\/li><li aria-current="page">Every lab run<\/li>/);
  assert.match(read('projects/ci-witness/index.html'), /<li><a href="\.\.\/\.\.\/#projects">Tools<\/a><\/li>/);
  for (const page of ['index.html', 'labs/index.html', 'updates/index.html', '404.html']) {
    assert.doesNotMatch(read(page), /class="crumbs"|class="related"/, `${page} gets no crumbs or related`);
  }
  // Every href in the inserted chrome resolves in the temp dist, anchors included (what check.mjs asserts).
  for (const page of [NOTE, 'labs/runs/index.html', 'projects/ci-witness/index.html']) {
    const html = read(page);
    const chrome = (html.match(/<nav class="crumbs"[\s\S]*?<\/nav>/)?.[0] ?? '') + (html.match(/<aside class="related"[\s\S]*?<\/aside>/)?.[0] ?? '');
    for (const [, link] of chrome.matchAll(/href="([^"]+)"/g)) {
      const [path, anchor] = link.split('#');
      const target = resolve(dirname(join(dist, page)), path || '.');
      const file = path.endsWith('/') || !path ? join(target, 'index.html') : target;
      assert.ok(existsSync(file), `${page}: ${link}`);
      if (anchor) assert.ok(readFileSync(file, 'utf8').includes(`id="${anchor}"`), `${page}: anchor ${link}`);
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${page}: no duplicate ids`);
    const rows = text => (text.match(/journal-row/g) || []).length;
    assert.equal(rows(html), rows(readFileSync(join('site', page), 'utf8')), `${page}: no journal-row added`);
  }
  // The note's aside: same id first (the experiment), then shared topics newest first; never itself, never unrelated.
  const aside = note.match(/<aside class="related"[\s\S]*?<\/aside>/)[0];
  assert.deepEqual([...aside.matchAll(/<a href="([^"]+)">/g)].map(m => m[1]), ['../projects/ci-witness/', '../updates/', '../labs/runs/']);
  assert.ok(note.indexOf('<aside class="related"') < note.indexOf('<footer class="site-footer'));
  assert.equal((note.match(/<aside class="related"/g) || []).length, 1);
});

test('nothing but the Find link and the chrome stylesheet is added to a number-provenance page', () => {
  const dist = tempDist();
  const before = readFileSync(join(dist, 'partners/index.html'), 'utf8');
  // Even an item that names the page itself, with a digit in its title, adds nothing there.
  injectChrome({ distDir: dist, items: [...items, { type: 'tool', id: 'exp-pipeline', title: 'Partners 2026', date: '2026-11-01', stage: 'results', topics: ['ci'], summary: 's', href: 'partners/' }] });
  const after = readFileSync(join(dist, 'partners/index.html'), 'utf8');
  assert.equal(after, addChromeStylesheet(addFindLink(before, '../'), '../'));
  assert.equal(after.replace('<a href="../find/">Find</a>', '').replace('<link rel="stylesheet" href="../assets/chrome.css">\n', ''), before);
  for (const page of ['provider-economics/index.html', 'evidence/index.html', 'providers/index.html', 'provider-brief/index.html', 'partners/index.html', 'one-pager/index.html']) {
    assert.equal(pageClass(page), null, page);
  }
  assert.equal(pageClass('journal/x.html'), 'note');
  assert.equal(pageClass('labs/rogue/index.html'), 'lab');
  assert.equal(pageClass('labs/agent-space/story/index.html'), null, 'one level under labs/ only');
  assert.equal(pageClass('projects/ci-witness/index.html'), 'tool');
});

test('pickRelated: same id first, then shared topic, newest first; never self; at most four', () => {
  const self = { id: 'e1', href: 'journal/self.html', topics: ['a', 'b'], date: '2026-01-01' };
  const pool = [
    self,
    { id: 'x', href: 'journal/self.html#results', topics: ['a'], date: '2026-12-01' }, // the same page: excluded
    { id: 'e1', href: 'updates/#old', topics: [], date: '2026-02-01' },
    { id: 'e1', href: 'labs/new/', topics: [], date: '2026-03-01' },
    { id: 'y', href: 'journal/t1.html', topics: ['b'], date: '2026-05-01' },
    { id: 'z', href: 'journal/t2.html', topics: ['a'], date: '2026-09-01' },
    { id: 'w', href: 'journal/t3.html', topics: ['c'], date: '2026-10-01' }, // unrelated
    { id: 'v', href: 'journal/t0.html', topics: ['a'], date: '2025-01-01' },
  ];
  assert.deepEqual(pickRelated(pool, self).map(i => i.href), ['labs/new/', 'updates/#old', 'journal/t2.html', 'journal/t1.html']);
  assert.deepEqual(pickRelated(pool, { ...self }).map(i => i.href), ['labs/new/', 'updates/#old', 'journal/t2.html', 'journal/t1.html'], 'a copy of self is excluded by its page');
  assert.deepEqual(pickRelated(pool, undefined), []);
  assert.deepEqual(pickRelated([{ id: '', href: 'a.html', topics: [] }, { id: '', href: 'b.html', topics: [] }], { id: '', href: 'a.html', topics: [] }), [], 'an empty id relates nothing');
});

test('page keys and relative hrefs', () => {
  assert.equal(pageKey('labs/rogue/index.html'), pageKey('labs/rogue/'));
  assert.equal(pageKey('index.html'), pageKey(''));
  assert.equal(pageKey('journal/a.html#x'), 'journal/a.html');
  assert.equal(relativeHref('journal/a.html', 'labs/rogue/'), '../labs/rogue/');
  assert.equal(relativeHref('journal/a.html', 'journal/b.html'), 'b.html');
  assert.equal(relativeHref('labs/rogue/index.html', 'updates/#2026-10-01'), '../../updates/#2026-10-01');
  assert.equal(relativeHref('labs/rogue/index.html', 'labs/rogue/'), './');
});

test('the home field-note rows read the same after the chrome is added', () => {
  const dist = tempDist();
  const before = readFileSync(join(dist, 'index.html'), 'utf8');
  injectChrome({ distDir: dist, items });
  const after = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.notEqual(after, before);
  assert.deepEqual(journalRows(after), journalRows(before));
  assert.ok(journalRows(before).length > 0);
  assert.doesNotMatch(after, /class="crumbs"|class="related"/);
});

test('every page links the chrome stylesheet exactly once, last in its head, by a path that resolves', () => {
  const dist = tempDist();
  injectChrome({ distDir: dist, items });
  injectChrome({ distDir: dist, items });
  for (const page of [...PAGES, 'find/index.html']) {
    const html = readFileSync(join(dist, page), 'utf8');
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]*chrome\.css)">/g)].map(m => m[1]);
    assert.equal(links.length, 1, `${page} links chrome.css once`);
    assert.equal(resolve(dirname(join(dist, page)), links[0]), resolve(dist, 'assets/chrome.css'), `${page}: ${links[0]} is the site's chrome.css`);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.lastIndexOf('<link rel="stylesheet"') === head.indexOf(`href="${links[0]}"`) - '<link rel="stylesheet" '.length, `${page}: chrome.css follows the page's own stylesheets`);
  }
  assert.ok(existsSync(resolve('site/assets/chrome.css')), 'the stylesheet it links is committed');
  assert.throws(() => addChromeStylesheet('<p>no head</p>', ''), /exactly one <\/head>/);
  assert.throws(() => addChromeStylesheet('<head></head>', 'x/'), /run of \.\.\/ segments/);
});
