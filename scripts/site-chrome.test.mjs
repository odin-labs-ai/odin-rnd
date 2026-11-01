// Site chrome (scripts/site-chrome.mjs, mission rnd-site-ux-nav-1101 WP3): the Find link, breadcrumbs and related aside
// added to the finished pages. Runs on copies of real committed pages in a temp dir; never touches site/ or dist/.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { addBreadcrumbs, addChromeStylesheet, addFindLink, addRelated, CHROME_WITHOUT_ITEM, FIND_PAGE, SECTION_INDEX_PAGES, escapeHtml, fragmentText, injectChrome, pageClass, pageKey, pageTitle, pickRelated, relativeHref, trailFor } from './site-chrome.mjs';
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
  // The section index pages (scripts/site-sections.mjs renders them in the build): no item of their own, a trail of
  // their own. The breadcrumbs on notes and tools lead to them.
  for (const [page, label] of [['journal/index.html', 'Field notes'], ['projects/index.html', 'Tools']]) {
    mkdirSync(join(dir, dirname(page)), { recursive: true });
    writeFileSync(join(dir, page), `<!doctype html><head><title>${label}</title></head><header class="site-header"><nav aria-label="Main navigation"><a href="../">Home</a></nav></header><main id="main"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li aria-current="page">${label}</li></ol></nav><h1>${label}</h1></main><footer class="site-footer"></footer>`);
  }
  return dir;
}

const findLinks = html => (html.match(/<a href="(?:\.\.\/)*find\/"[^>]*>Find<\/a>/g) || []).length;
const SECTION_PAGES = ['journal/index.html', 'projects/index.html'];
const headerNav = html => html.match(/<header class="site-header[\s\S]*?<\/header>/)[0].match(/<nav\b[\s\S]*?<\/nav>/)[0];

test('every page with a header navigation gets exactly one Find link, last in that navigation, pointing at the real page', () => {
  const dist = tempDist();
  const counts = injectChrome({ distDir: dist, items });
  assert.equal(counts.pages, PAGES.length + 1 + SECTION_PAGES.length);
  for (const page of [...PAGES.filter(p => p !== '404.html'), 'find/index.html', ...SECTION_PAGES]) {
    const html = readFileSync(join(dist, page), 'utf8');
    assert.equal(findLinks(html), 1, page);
    const nav = headerNav(html);
    const mark = page === FIND_PAGE ? ' aria-current="page"' : '';
    assert.match(nav, new RegExp(`<a href="(?:\\.\\./)*find/"${mark}>Find</a></nav>$`), `${page}: Find is the last link, marked current only on the Find page`);
    assert.equal(/<a href="[^"]*find\/" aria-current="page">Find<\/a>/.test(nav), page === FIND_PAGE, `${page}: Find is current there or not`);
    const href = nav.match(/<a href="([^"]*find\/)"[^>]*>Find<\/a>/)[1];
    assert.ok(existsSync(resolve(dirname(join(dist, page)), href, 'index.html')), `${page}: ${href} resolves`);
    assert.doesNotMatch(href + 'Find', /\d/, 'no digit in the inserted link');
  }
  assert.equal(findLinks(readFileSync(join(dist, '404.html'), 'utf8')), 0, 'the 404 page is exempt (served at any path)');
});

test('injecting twice changes nothing the second time', () => {
  const dist = tempDist();
  injectChrome({ distDir: dist, items });
  const all = [...PAGES, FIND_PAGE, ...SECTION_PAGES];
  const once = Object.fromEntries(all.map(p => [p, readFileSync(join(dist, p), 'utf8')]));
  injectChrome({ distDir: dist, items });
  for (const page of all) assert.equal(readFileSync(join(dist, page), 'utf8'), once[page], page);
  const home = once['index.html'];
  assert.equal(addFindLink(home, ''), home);
  assert.equal(addFindLink(once[FIND_PAGE], '../', FIND_PAGE, { current: true }), once[FIND_PAGE], 'the marked Find link is kept as it is');
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
  assert.match(note, /<main id="main" class="article-shell"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="\.\.\/">Home<\/a><\/li><li><a href="\.\.\/journal\/">Field notes<\/a><\/li><li aria-current="page">A passing pipeline was not yet a verified release\.<\/li><\/ol><\/nav>/, 'the trail names the note by its heading');
  assert.match(read('labs/runs/index.html'), /<li><a href="\.\.\/\.\.\/labs\/">Labs<\/a><\/li><li aria-current="page">Every lab run\.<\/li>/);
  assert.match(read('projects/ci-witness/index.html'), /<li><a href="\.\.\/\.\.\/projects\/">Tools<\/a><\/li>/);
  for (const page of ['index.html', 'labs/index.html', 'updates/index.html', '404.html']) {
    assert.doesNotMatch(read(page), /class="crumbs"|class="related"/, `${page} gets no crumbs or related`);
  }
  // The section index pages keep their own single trail and get no related aside, with no item of their own.
  for (const page of SECTION_PAGES) {
    assert.equal((read(page).match(/<nav class="crumbs"/g) || []).length, 1, `${page}: its own trail, once`);
    assert.doesNotMatch(read(page), /class="related"/, `${page}: no related aside`);
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

test('the journal/ and projects/ index pages are exempt by name, with a reason: lists of notes and tools, not one', () => {
  assert.deepEqual([...SECTION_INDEX_PAGES.keys()].sort(), ['journal/index.html', 'projects/index.html']);
  for (const [page, reason] of SECTION_INDEX_PAGES) assert.ok(reason.length > 20, `${page} has a reason`);
  // By its path journal/index.html is a note page: only the exemption keeps it from being refused as an unlisted note.
  assert.equal(pageClass('journal/index.html'), 'note');
  // With no item for either index page, injectChrome does not refuse them, and adds them no trail or aside.
  const dist = tempDist();
  assert.doesNotThrow(() => injectChrome({ distDir: dist, items }));
  // Without the exemption the same build is refused: the map is what lets the page through.
  const reason = SECTION_INDEX_PAGES.get('journal/index.html');
  SECTION_INDEX_PAGES.delete('journal/index.html');
  try {
    assert.throws(() => injectChrome({ distDir: tempDist(), items }), /journal\/index\.html is a note page with no item in the site index/);
  } finally { SECTION_INDEX_PAGES.set('journal/index.html', reason); }
});

test('a note\'s trail and related links come from its own note item, not from an experiment or update that links the note', () => {
  const dist = tempDist();
  // Newest first, as the index is sorted: an experiment and an update that point at the note come before the note.
  const shadowed = [
    { type: 'experiment', id: 'exp-shadow', title: 'Slug-like experiment name', date: '2026-10-31', stage: 'results', topics: ['nothing-shared'], summary: 's', href: NOTE },
    { type: 'update', id: 'u-shadow', title: 'An update about it', date: '2026-10-30', stage: 'results', topics: ['nothing-shared'], summary: 's', href: `${NOTE}#plan` },
    ...items,
  ];
  injectChrome({ distDir: dist, items: shadowed });
  const note = readFileSync(join(dist, NOTE), 'utf8');
  assert.match(note, /<li aria-current="page">A passing pipeline was not yet a verified release\.<\/li>/, 'the heading, not another item\'s title');
  const aside = note.match(/<aside class="related"[\s\S]*?<\/aside>/)[0];
  assert.deepEqual([...aside.matchAll(/<a href="([^"]+)">/g)].map(m => m[1]).slice(0, 1), ['../projects/ci-witness/'], 'related by the note item (its id and topics)');
});

test('Find is marked as the current page on /find/ only; the mark is added to an existing link once', () => {
  const nav = '<header class="site-header"><nav aria-label="Main navigation"><a href="../">Home</a><a href="../find/">Find</a></nav></header>';
  const marked = addFindLink(nav, '../', FIND_PAGE, { current: true });
  assert.match(marked, /<a href="\.\.\/find\/" aria-current="page">Find<\/a><\/nav>/);
  assert.equal(addFindLink(marked, '../', FIND_PAGE, { current: true }), marked, 'idempotent');
  assert.equal(addFindLink(marked, '../', FIND_PAGE), marked, 'an existing link with attributes is recognised: no second Find');
  assert.equal(addFindLink(nav, '../'), nav, 'elsewhere an existing link is left alone');
  const fresh = addFindLink('<header class="site-header"><nav aria-label="Main navigation"><a href="../">Home</a></nav></header>', '../', FIND_PAGE, { current: true });
  assert.equal((fresh.match(/>Find<\/a>/g) || []).length, 1);
  assert.match(fresh, /<a href="\.\.\/find\/" aria-current="page">Find<\/a>/);
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

test('a page title is read as plain text and escaped whole: "<scr<script>ipt>" never comes out as markup', () => {
  assert.equal(escapeHtml(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;', 'nothing is treated as already escaped');
  const payload = '<h1>A <scr<script>ipt>alert(1)</script> B</h1>';
  const title = pageTitle(payload);
  assert.ok(!/<\s*script/i.test(title) || !title.includes('<'), `plain text: ${title}`);
  const crumbs = addBreadcrumbs('<main id="main"></main>', trailFor('note', 'journal/x.html', title));
  assert.doesNotMatch(crumbs, /<script|<scr/i, 'no script element, whole or rebuilt from pieces');
  const current = crumbs.match(/<li aria-current="page">([\s\S]*?)<\/li>/)[1];
  assert.doesNotMatch(current, /[<>"']/, `the title is escaped: ${current}`);
  for (const nested of ['<<script>script>alert(1)<</script>/script>', '<scr<script>ipt>', '<img src=x onerror=alert(1)>', 'a <b>bold</b> &lt;script&gt; title']) {
    const out = addBreadcrumbs('<main id="main"></main>', trailFor('note', 'journal/x.html', pageTitle(`<h1>${nested}</h1>`)));
    assert.doesNotMatch(out, /<(script|img|scr)/i, nested);
  }
  // A reference is decoded once and escaped once: "R&amp;D" shows as "R&D", written as "R&amp;D", never "&amp;amp;".
  assert.equal(pageTitle('<h1>Odin R&amp;D &#x27;lab&#39; &nbsp;x<br>y</h1>'), "Odin R&D 'lab' x y");
  assert.match(addBreadcrumbs('<main id="main"></main>', trailFor('lab', 'labs/x/index.html', pageTitle('<h1>R&amp;D</h1>'))), /<li aria-current="page">R&amp;D<\/li>/);
  assert.equal(pageTitle('<title>Every lab run — Odin R&amp;D</title>'), 'Every lab run');
  assert.equal(pageTitle('<h1>We&rsquo;re here &mdash; now&hellip;</h1>'), 'We\u2019re here \u2014 now\u2026', 'the common typographic references decode');
  assert.equal(fragmentText('a < b and c > d'), 'a < b and c > d', 'a "<" that opens no tag is text');
});

test('a note, lab or tool page with no index item stops the build, except a named exemption (labs/runs/)', () => {
  const withoutRuns = items.filter(item => item.href !== 'labs/runs/');
  const dist = tempDist();
  injectChrome({ distDir: dist, items: withoutRuns });
  const runs = readFileSync(join(dist, 'labs/runs/index.html'), 'utf8');
  assert.ok(CHROME_WITHOUT_ITEM.has('labs/runs/index.html'));
  assert.match(runs, /<li><a href="\.\.\/\.\.\/labs\/">Labs<\/a><\/li><li aria-current="page">Every lab run\.<\/li>/, 'the exempt page keeps its breadcrumbs');
  assert.doesNotMatch(runs, /class="related"/, 'and has nothing to relate');
  const rogue = tempDist();
  mkdirSync(join(rogue, 'labs/rogue'), { recursive: true });
  cpSync(join('site', 'labs/runs/index.html'), join(rogue, 'labs/rogue/index.html'));
  assert.throws(() => injectChrome({ distDir: rogue, items }), /labs\/rogue\/index\.html is a lab page with no item in the site index/);
});

test('the missing page (404.html) links the chrome stylesheet through its <base href>, so the long-header rules apply there', () => {
  const dist = tempDist();
  injectChrome({ distDir: dist, items });
  const html = readFileSync(join(dist, '404.html'), 'utf8');
  const base = html.match(/<base href="([^"]+)">/)?.[1];
  assert.equal(base, 'https://odin-labs-ai.github.io/odin-rnd/', 'the page names the site root as its base');
  const href = html.match(/<link rel="stylesheet" href="([^"]*chrome\.css)">/)?.[1];
  assert.equal(new URL(href, base).href, 'https://odin-labs-ai.github.io/odin-rnd/assets/chrome.css', 'chrome.css resolves to the site root, at any missing path');
  assert.ok(html.indexOf(href) > html.indexOf('<base href='), 'linked after the base, so the base applies');
  assert.equal((headerNav(html).match(/<a /g) || []).length, 8, 'its header has the eight-link navigation chrome.css lays out');
});
