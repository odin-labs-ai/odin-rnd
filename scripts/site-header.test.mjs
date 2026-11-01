// One header navigation (scripts/site-header.mjs, mission rnd-site-ux-nav-1101 wave 3): run on copies of the real
// committed pages (every site/**/*.html), never on the files themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { DESTINATIONS, SITE_ORIGIN, canonicalHeader, navSpan, normaliseHeader, normaliseHeaders, sectionFor } from './site-header.mjs';
import { addFindLink, FIND_EXEMPT } from './site-chrome.mjs';
import { checkPage, NUMBER_WORDS, PAGES } from './number-provenance.mjs';

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);
const PAGE_FILES = walk('site').map(f => relative('site', f).split(sep).join('/')).sort();
const read = rel => readFileSync(join('site', rel), 'utf8');
const prefixOf = rel => (rel === '404.html' ? SITE_ORIGIN : '../'.repeat(rel.split('/').length - 1));
const normalise = (html, rel) => normaliseHeader(html, { relPrefix: prefixOf(rel), current: sectionFor(rel), label: rel });
const navOf = html => { const { start, end } = navSpan(html); return html.slice(start, end); };
const labels = nav => [...nav.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(m => m[1]);
const CANONICAL = DESTINATIONS.map(d => d.label);
const BACK = '<a class="parent-site-link" href="https://odin-labs.ai/"><span aria-hidden="true">←</span> Back to odin-labs.ai</a>';

test('the real pages cover the old and new header variants', () => {
  assert.ok(PAGE_FILES.length >= 50, `${PAGE_FILES.length} committed pages`);
  const navs = new Set(PAGE_FILES.map(rel => labels(navOf(read(rel))).join('|')));
  assert.ok(navs.size >= 5, 'several distinct variants before the pass');
  assert.ok([...navs].some(n => n.includes('The floor') && n.includes('Open source')), 'the first edition nav is among them');
});

test('every page gets one nav with the canonical destinations in order, the old labels retired', () => {
  for (const rel of PAGE_FILES) {
    const out = normalise(read(rel), rel);
    const header = out.match(/<header class="site-header[\s\S]*?<\/header>/g);
    assert.equal(header.length, 1, `${rel}: one header`);
    assert.equal((header[0].match(/<nav\b/g) || []).length, 1, `${rel}: one nav`);
    const got = labels(navOf(out));
    const want = rel === '404.html' ? [...CANONICAL, 'Find'] : CANONICAL;
    assert.deepEqual(got, want, `${rel}: canonical order`);
    assert.doesNotMatch(navOf(out), /The floor|Open source/, `${rel}: old labels retired in the nav`);
  }
});

test('only the nav changes: brand, View source and Back to odin-labs.ai stay byte for byte', () => {
  for (const rel of PAGE_FILES) {
    // As the build has it by then: the back link appended inside the header.
    const before = read(rel).replace(/(<header class="site-header[^"]*"[^>]*>[\s\S]*?)<\/header>/, `$1${BACK}</header>`);
    const after = normalise(before, rel);
    const a = navSpan(before), b = navSpan(after);
    assert.equal(after.slice(0, b.start), before.slice(0, a.start), `${rel}: everything before the nav`);
    assert.equal(after.slice(b.end), before.slice(a.end), `${rel}: everything after the nav`);
    const header = after.match(/<header class="site-header[\s\S]*?<\/header>/)[0];
    assert.match(header, /class="wordmark" aria-label="Odin Labs R&amp;D home"/, `${rel}: brand`);
    assert.match(header, /<a class="source-link" href="https:\/\/github\.com\/odin-labs-ai\/odin-rnd">View source/, `${rel}: source link`);
    assert.ok(header.includes(BACK), `${rel}: back link`);
  }
});

test('aria-current marks the page\'s own section, and only that', () => {
  const cases = { 'index.html': null, 'labs/index.html': 'Labs', 'labs/agent-space/story/index.html': 'Labs', 'updates/index.html': 'Updates', 'work-with-us/index.html': 'Work with us', 'partners/index.html': 'Partners', 'experiments/index.html': 'Experiments', 'journal/a-passing-pipeline.html': 'Field notes', 'projects/ci-witness/index.html': null, 'evidence/index.html': null, 'find/index.html': null };
  for (const [rel, want] of Object.entries(cases)) {
    const nav = navOf(normalise(read(rel), rel));
    const marked = [...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(m => m[1]);
    assert.deepEqual(marked, want ? [want] : [], rel);
  }
  for (const rel of PAGE_FILES) assert.ok((navOf(normalise(read(rel), rel)).match(/aria-current/g) || []).length <= 1, rel);
});

test('links lead to the section pages, relative to the page; Work with us keeps its contact marker', () => {
  const nav = navOf(normalise(read('journal/a-passing-pipeline.html'), 'journal/a-passing-pipeline.html'));
  assert.equal(nav, '<nav aria-label="Main navigation"><a href="../#floor">Factory</a><a href="../experiments/">Experiments</a><a href="../labs/">Labs</a><a href="../updates/">Updates</a><a href="../journal/" aria-current="page">Field notes</a><a href="../work-with-us/" data-contact-opened>Work with us</a><a href="../partners/">Partners</a></nav>');
  assert.match(navOf(normalise(read('index.html'), 'index.html')), /^<nav aria-label="Main navigation"><a href="#floor">Factory<\/a><a href="experiments\/">Experiments<\/a>/);
  assert.match(navOf(normalise(read('labs/agent-space/story/index.html'), 'labs/agent-space/story/index.html')), /<a href="\.\.\/\.\.\/\.\.\/journal\/">Field notes<\/a>/);
});

test('idempotent, alone and with the Find link of scripts/site-chrome.mjs in either order: one Find, last', () => {
  for (const rel of PAGE_FILES) {
    const src = read(rel);
    const once = normalise(src, rel);
    assert.equal(normalise(once, rel), once, `${rel}: normalise twice`);
    if (FIND_EXEMPT.has(rel)) continue;
    const up = '../'.repeat(rel.split('/').length - 1);
    const thenFind = addFindLink(once, up, rel);
    const findFirst = normalise(addFindLink(src, up, rel), rel);
    assert.equal(findFirst, thenFind, `${rel}: same result in either order`);
    for (const html of [thenFind, addFindLink(thenFind, up, rel), normalise(thenFind, rel)]) {
      assert.equal(html, thenFind, `${rel}: stable`);
      const got = labels(navOf(html));
      assert.equal(got.filter(l => l === 'Find').length, 1, `${rel}: one Find`);
      assert.equal(got.at(-1), 'Find', `${rel}: Find last`);
    }
  }
});

test('the Find page\'s own Find link, marked aria-current by scripts/site-chrome.mjs, is kept marked in either order', () => {
  const src = read('find/index.html');
  const marked = addFindLink(normalise(src, 'find/index.html'), '../', 'find/index.html', { current: true });
  assert.match(navOf(marked), /<a href="\.\.\/find\/" aria-current="page">Find<\/a><\/nav>$/);
  assert.equal(normalise(marked, 'find/index.html'), marked, 'normalising keeps the marked link verbatim, last');
  assert.equal(normalise(addFindLink(src, '../', 'find/index.html', { current: true }), 'find/index.html'), marked, 'same result in either order');
  assert.equal((navOf(marked).match(/aria-current/g) || []).length, 1, 'only Find is current there');
  assert.throws(() => normalise(marked.replace(' aria-current="page">Find', ' class="x">Find'), 'find/index.html'), /not of the form/);
});

test('the 404 page keeps its absolute links and its own Find, moved last', () => {
  const nav = navOf(normalise(read('404.html'), '404.html'));
  assert.ok([...nav.matchAll(/href="([^"]+)"/g)].every(([, href]) => href.startsWith(SITE_ORIGIN)), 'absolute links only');
  assert.match(nav, /<a href="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/">Find<\/a><\/nav>$/);
});

test('fails closed on a page it cannot place', () => {
  const page = read('updates/index.html');
  assert.throws(() => normaliseHeader('<html><body></body></html>', { relPrefix: '' }), /exactly one site header/);
  assert.throws(() => normaliseHeader(page.replace('</header>', '</header><header class="site-header"></header>'), { relPrefix: '../' }), /exactly one site header/);
  assert.throws(() => normaliseHeader(page.replace('</nav>', '</nav><nav aria-label="x"></nav>'), { relPrefix: '../' }), /exactly one navigation/);
  assert.throws(() => normaliseHeader(page.replace('>Updates</a>', '>Updates</a><a href="../x/">Something new</a>'), { relPrefix: '../' }), /does not know/);
  assert.throws(() => normaliseHeader(page.replace('</nav>', '<span>x</span></nav>'), { relPrefix: '../' }), /more than links/);
  assert.throws(() => normaliseHeader(page.replace('</nav>', '<a class="x" href="../find/">Find</a></nav>'), { relPrefix: '../' }), /not of the form/);
  assert.throws(() => normaliseHeader(page, { relPrefix: './' }), /prefix/);
  assert.throws(() => normaliseHeader(page, { relPrefix: 'https://example.com/' }), /prefix/);
  assert.throws(() => normaliseHeader(page, { relPrefix: '../', current: 'tools' }), /Unknown header section/);
});

test('no digit or number word enters a number-provenance page through the header', () => {
  for (const d of DESTINATIONS) { assert.doesNotMatch(d.label + d.path, /\d/, d.label); assert.doesNotMatch(d.label, NUMBER_WORDS, d.label); }
  for (const rel of PAGES.filter(p => PAGE_FILES.includes(p))) {
    const header = normalise(read(rel), rel).match(/<header class="site-header[\s\S]*?<\/header>/)[0];
    assert.deepEqual(checkPage(rel, `<body>${header}</body>`, { readData: () => null, exists: () => true }), [], rel);
  }
  assert.ok(PAGES.some(p => PAGE_FILES.includes(p)), 'at least one provenance page is committed and checked here');
});

test('canonicalHeader is the header a rendered page gets: one header, one nav, normalising it changes nothing', () => {
  const page = `<body>${canonicalHeader('../', 'notes')}<main></main></body>`;
  assert.equal(normaliseHeader(page, { relPrefix: '../', current: 'notes' }), page);
  assert.equal(labels(navOf(page)).join('|'), CANONICAL.join('|'));
});

test('normaliseHeaders rewrites a built copy only, and leaves the committed field notes alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-'));
  try {
    const notes = PAGE_FILES.filter(rel => rel.startsWith('journal/'));
    const before = notes.map(read);
    for (const rel of ['index.html', '404.html', ...notes.slice(0, 3)]) cpSync(join('site', rel), join(dir, rel), { recursive: true });
    const counts = normaliseHeaders({ distDir: dir });
    assert.deepEqual(counts, { pages: 5, changed: 5, exempt: 0 });
    assert.deepEqual(normaliseHeaders({ distDir: dir }), { pages: 5, changed: 0, exempt: 0 }, 'idempotent on files');
    assert.deepEqual(notes.map(read), before, 'site/journal/*.html unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
