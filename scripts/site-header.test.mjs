// One header navigation (scripts/site-header.mjs, mission rnd-site-ux-nav-1101 wave 3): run on copies of the real
// committed pages (every site/**/*.html), never on the files themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { parse } from './html-source-tree.mjs';
import { DESTINATIONS, FOOTER_LINKS, KNOWN_LABELS, RETIRED_LABELS, SITE_ORIGIN, addFooterLinks, canonicalHeader, navSpan, normaliseHeader, normaliseHeaders, retiredTargets, sectionFor } from './site-header.mjs';
import { addFindLink, FIND_EXEMPT } from './site-chrome.mjs';
import { checkPage, NUMBER_WORDS, PAGES } from './number-provenance.mjs';

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);
const PAGE_FILES = walk('site').map(f => relative('site', f).split(sep).join('/')).sort();
const read = rel => readFileSync(join('site', rel), 'utf8');
const prefixOf = rel => (rel === '404.html' ? SITE_ORIGIN : '../'.repeat(rel.split('/').length - 1));
const normalise = (html, rel) => normaliseHeader(html, { relPrefix: prefixOf(rel), current: sectionFor(rel), label: rel });
const navOf = html => { const { start, end } = navSpan(html); return html.slice(start, end); };
// The link texts as a reader sees them (& is written &amp;).
const labels = nav => [...nav.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(m => m[1].replaceAll('&amp;', '&'));
const CANONICAL = DESTINATIONS.map(d => d.label);
const BACK = '<a class="parent-site-link" href="https://odin-labs.ai/"><span aria-hidden="true">←</span> Back to odin-labs.ai</a>';
const actualElements = (node, name) => node.tagName === 'template' ? [] : [...(node.tagName === name ? [node] : []), ...(node.childNodes ?? []).flatMap(child => actualElements(child, name))];
const actualText = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(actualText).join('');
const actualAttr = (node, name) => node.attrs?.find(attr => attr.name === name)?.value;

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

test('aria-current marks only exact pages; parent sections keep a visual marker', () => {
  const cases = { 'index.html': null, 'labs/index.html': 'Labs', 'labs/agent-space/story/index.html': null, 'updates/index.html': null, 'work-with-us/index.html': 'Work with us', 'partners/index.html': null, 'experiments/index.html': 'All results', 'journal/a-passing-pipeline.html': null, 'one-pager/index.html': 'Start here', 'methods/index.html': 'How we test', 'projects/ci-witness/index.html': null, 'evidence/index.html': null, 'find/index.html': null };
  for (const [rel, want] of Object.entries(cases)) {
    const nav = navOf(normalise(read(rel), rel));
    const marked = [...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(m => m[1]);
    assert.deepEqual(marked, want ? [want] : [], rel);
  }
  for (const rel of PAGE_FILES) assert.ok((navOf(normalise(read(rel), rel)).match(/aria-current/g) || []).length <= 1, rel);
  assert.match(navOf(normalise(read('labs/agent-space/story/index.html'), 'labs/agent-space/story/index.html')), /<a href="\.\.\/\.\.\/\.\.\/labs\/" data-current-section>Labs<\/a>/, 'a lab story highlights its parent without calling it the current page');
  assert.match(navOf(normalise(read('journal/a-passing-pipeline.html'), 'journal/a-passing-pipeline.html')), /<a href="\.\.\/journal\/" data-current-section>Notes &amp; updates<\/a>/, 'a note highlights its parent without calling it the current page');
});

test('links lead to the section pages, relative to the page; Work with us keeps its contact marker', () => {
  const nav = navOf(normalise(read('journal/a-passing-pipeline.html'), 'journal/a-passing-pipeline.html'));
  assert.equal(nav, '<nav aria-label="Main navigation"><a href="../one-pager/">Start here</a><a href="../#findings">Findings</a><a href="../labs/">Labs</a><a href="../experiments/">All results</a><a href="../journal/" data-current-section>Notes &amp; updates</a><a href="../methods/">How we test</a><a href="../work-with-us/" data-contact-opened>Work with us</a></nav>');
  assert.match(navOf(normalise(read('index.html'), 'index.html')), /^<nav aria-label="Main navigation"><a href="one-pager\/">Start here<\/a><a href="#findings">Findings<\/a>/);
  assert.match(navOf(normalise(read('labs/agent-space/story/index.html'), 'labs/agent-space/story/index.html')), /<a href="\.\.\/\.\.\/\.\.\/journal\/">Notes &amp; updates<\/a>/);
  assert.doesNotMatch(nav, /partners\//, 'Partners is not in the header');
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

test('every retired label is named with its destination and fate; nothing leaves a header unnamed', () => {
  assert.deepEqual([...RETIRED_LABELS.keys()].sort(), ['Experiments', 'Factory', 'Field notes', 'Open source', 'Partners', 'The floor', 'Updates']);
  // Every label on every committed page is canonical, retired (named here) or Find.
  const seen = new Set(PAGE_FILES.flatMap(rel => labels(navOf(read(rel)))));
  for (const text of seen) assert.ok(KNOWN_LABELS.has(text), text);
  for (const [text, retired] of RETIRED_LABELS) {
    const { to, reason } = retired;
    const targets = retiredTargets(retired);
    assert.ok(reason.length > 20, `${text} has a reason`);
    const pages = PAGE_FILES.filter(rel => labels(navOf(read(rel))).includes(text));
    assert.ok(pages.length > 0, `${text} is still on a committed page (else drop it from the table)`);
    for (const rel of pages) {
      const before = navOf(read(rel)).match(new RegExp(`<a href="([^"]*)"[^>]*>${text}</a>`))[1];
      const actual = new URL(before, rel === 'index.html' ? SITE_ORIGIN : new URL(rel, SITE_ORIGIN)).href;
      assert.ok(targets.some(target => actual === new URL(target, SITE_ORIGIN).href), `${rel}: "${text}" led to ${targets.join(' or ')}`);
      const after = navOf(normalise(read(rel), rel));
      assert.ok(!labels(after).includes(text), `${rel}: "${text}" is replaced`);
      if (to) {
        const dest = DESTINATIONS.find(d => d.key === to);
        assert.ok(dest, `${text} -> ${to} is a canonical destination`);
        // Updates changed its header destination; its old feed remains linked from the notes page and home.
        assert.ok(targets.some(target => dest.path.endsWith(target)) || (text === 'Updates' && dest.path === 'journal/' && reason.includes('updates/ stays live')), `${text} -> ${dest.label} leads to the same place, or Updates names its surviving feed`);
        assert.ok(after.includes(`href="${prefixOf(rel)}${dest.path}"`) && labels(after).includes(dest.label), `${rel}: "${text}" became "${dest.label}"`);
      } else {
        for (const target of targets) assert.equal(DESTINATIONS.some(d => d.path.endsWith(target)), false, `${text}: no canonical link leads to ${target}`);
        if (text === 'Partners') assert.match(reason, /site footer.*partners\//i, `${text}: the reason names its new footer location`);
        else assert.match(reason, /\b(?:projects|methods)\/|#findings/, `${text}: the reason names where its destination is reached now`);
      }
    }
  }
  // A retired label leading somewhere else is a destination the table does not account for: the build stops.
  const oldRel = PAGE_FILES.find(rel => labels(navOf(read(rel))).includes('Open source'));
  const old = read(oldRel);
  assert.throws(() => normaliseHeader(old.replace(/href="[^"]*#projects">Open source/, 'href="../somewhere/">Open source'), { relPrefix: prefixOf(oldRel) }), /does not account for/);
  assert.throws(() => normaliseHeader(old.replace(/href="[^"]*#floor">The floor/, 'href="../other/">The floor'), { relPrefix: prefixOf(oldRel) }), /does not account for/);
});

test('fails closed on a page it cannot place', () => {
  const page = read('updates/index.html');
  const atUpdates = { relPrefix: '../', label: 'updates/index.html' };
  assert.throws(() => normaliseHeader('<html><body></body></html>', { relPrefix: '' }), /exactly one site header/);
  assert.throws(() => normaliseHeader(page.replace('</header>', '</header><header class="site-header"></header>'), { relPrefix: '../' }), /exactly one site header/);
  assert.throws(() => normaliseHeader(page.replace('</nav>', '</nav><nav aria-label="x"></nav>'), { relPrefix: '../' }), /exactly one navigation/);
  assert.throws(() => normaliseHeader(page.replace('>Updates</a>', '>Updates</a><a href="../x/">Something new</a>'), atUpdates), /does not know/);
  assert.throws(() => normaliseHeader(page.replace(/<a href="[^"]*"([^>]*)>Updates<\/a>/, '<a href="../elsewhere/"$1>Updates</a>'), atUpdates), /does not account for/);
  const canonicalHome = normalise(read('index.html'), 'index.html');
  assert.throws(() => normaliseHeader(canonicalHome.replace('href="methods/">How we test', 'href="evidence/">How we test'), { relPrefix: '', label: 'index.html' }), /does not account for/, 'a canonical label cannot hide an unaccounted destination');
  const nested = canonicalHome.replace('<a href="methods/">How we test</a>', '<a href="methods/"><a href="evidence/">How we test</a></a>');
  assert.notEqual(nested, canonicalHome, 'the recognized navigation anchor gained a second destination');
  assert.throws(() => normaliseHeader(nested, { relPrefix: '', label: 'index.html' }), /nested anchor/, 'a descendant anchor cannot be erased with its parent');
  const anchored = canonicalHome.replace('<a href="methods/">How we test</a>', '<a id="methods-entry" href="methods/">How we test</a>');
  assert.notEqual(anchored, canonicalHome, 'the recognized navigation anchor gained a fragment target');
  assert.throws(() => normaliseHeader(anchored, { relPrefix: '', label: 'index.html' }), /anchor attribute/, 'an anchor ID cannot be erased by replacement');
  const wrongFind = canonicalHome.replace('</nav>', '<a href="journal/find/">Find</a></nav>');
  assert.throws(() => normaliseHeader(wrongFind, { relPrefix: '', label: 'index.html' }), /site Find page/, 'a nested find/ suffix is not the root Find destination');
  assert.throws(() => normaliseHeader(page, { relPrefix: '../', label: 'journal/elsewhere.html' }), /does not account for/, 'a retired self-link is accepted only on its own page');
  assert.throws(() => normaliseHeader(page, { relPrefix: '../', label: 'updates/other.html' }), /does not account for/, 'another page in the same section is not the self-link target');
  const lab = read('labs/rogue/index.html');
  assert.match(lab, /href="[^"]*partners\/">Partners<\/a>/);
  assert.throws(() => normaliseHeader(lab.replace(/href="[^"]*partners\/">Partners<\/a>/, 'href="partners/">Partners</a>'), { relPrefix: '../../', label: 'labs/rogue/index.html' }), /does not account for/, 'a nested partners/ link is not the root Partners page');
  assert.throws(() => normaliseHeader(lab.replace(/href="[^"]*partners\/">Partners<\/a>/, 'data-href="../../partners/" href="partners/">Partners</a>'), { relPrefix: '../../', label: 'labs/rogue/index.html' }), /does not account for/, 'data-href cannot mask the real retired destination');
  assert.throws(() => normaliseHeader(lab.replace(/href="[^"]*partners\/">Partners<\/a>/, 'title=\'old href="../../partners/"\' href="partners/">Partners</a>'), { relPrefix: '../../', label: 'labs/rogue/index.html' }), /does not account for/, 'quoted title content cannot mask the real href');
  assert.throws(() => normaliseHeader(page.replace('</nav>', '<span>x</span></nav>'), atUpdates), /more than links/);
  assert.throws(() => normaliseHeader(page.replace('</nav>', '<a class="x" href="../find/">Find</a></nav>'), atUpdates), /not of the form/);
  assert.throws(() => normaliseHeader(page, { relPrefix: './' }), /prefix/);
  assert.throws(() => normaliseHeader(page, { relPrefix: 'https://example.com/' }), /prefix/);
  assert.throws(() => normaliseHeader(page, { ...atUpdates, current: 'tools' }), /Unknown header section/);
});

test('no digit or number word enters a number-provenance page through the header or the footer links', () => {
  for (const d of [...DESTINATIONS, ...FOOTER_LINKS]) { assert.doesNotMatch(d.label + d.path, /\d/, d.label); assert.doesNotMatch(d.label, NUMBER_WORDS, d.label); }
  for (const rel of PAGES.filter(p => PAGE_FILES.includes(p))) {
    const header = normalise(read(rel), rel).match(/<header class="site-header[\s\S]*?<\/header>/)[0];
    assert.deepEqual(checkPage(rel, `<body>${header}</body>`, { readData: () => null, exists: () => true }), [], rel);
  }
  assert.ok(PAGES.some(p => PAGE_FILES.includes(p)), 'at least one provenance page is committed and checked here');
});

test('canonicalHeader is the header a rendered page gets: one header, one nav, normalising it changes nothing', () => {
  const page = `<body>${canonicalHeader('../', 'notes')}<main></main></body>`;
  assert.equal(normaliseHeader(page, { relPrefix: '../', current: 'notes', label: 'journal/index.html' }), page);
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

test('the build checks original bytes before navigation normalization discards unsupported attributes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-preflight-'));
  try {
    const source = read('index.html');
    for (const [attribute, expected] of [['title="<![CDATA["', /Unsupported HTML CDATA section/], ['title="</textarea/ x=y>"', /Unsupported raw HTML end tag/]]) {
      const poisoned = source.replace('<a href="#floor">Factory</a>', `<a ${attribute} href="#floor">Factory</a>`);
      assert.notEqual(poisoned, source, 'the recognized navigation anchor was altered');
      writeFileSync(join(dir, 'index.html'), poisoned);
      assert.throws(() => normaliseHeaders({ distDir: dir }), expected, 'the original attribute is refused before it could be discarded');
      assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), poisoned, 'the refused page was not rewritten');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a document base inside a recognized nav link is refused before normalization can discard it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-base-'));
  try {
    const canonicalHome = normalise(read('index.html'), 'index.html');
    const poisoned = canonicalHome.replace('<a href="methods/">How we test</a>', '<a href="methods/"><base href="journal/">How we test</a>');
    assert.notEqual(poisoned, canonicalHome, 'the recognized How we test link was altered');
    assert.throws(() => normaliseHeader(poisoned, { relPrefix: '', label: 'index.html' }), /Unexpected document base/, 'direct normalization refuses the original parsed base');
    writeFileSync(join(dir, 'index.html'), poisoned);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /Unexpected document base/, 'the named-page build path refuses the original parsed base');
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), poisoned, 'the rejected page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a named page keeps an inbound fragment target from being discarded with navigation markup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-fragment-preflight-'));
  try {
    const source = read('index.html');
    const poisoned = source.replace('<a href="#floor">Factory</a>', '<a href="#floor"><span id="methods-entry">Factory</span></a>')
      .replace('</main>', '<a href="#methods-entry">Jump to methods</a></main>');
    assert.notEqual(poisoned, source, 'the recognized Factory link gained a fragment target');
    assert.match(poisoned, /href="#methods-entry">Jump to methods/, 'a surviving link points at that target');
    assert.throws(() => normaliseHeader(poisoned, { relPrefix: '', label: 'index.html' }), /child markup/, 'direct normalization refuses to erase the fragment target');
    writeFileSync(join(dir, 'index.html'), poisoned);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /child markup/, 'the named-page build path refuses the target removal');
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), poisoned, 'the refused page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the named-page build refuses a second parsed footer before navigation can erase it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-footer-preflight-'));
  try {
    const source = read('index.html');
    const poisoned = source.replace('<a href="#floor">Factory</a>', '<a href="#floor"><footer class="site-footer"><div></div></footer>Factory</a>');
    assert.notEqual(poisoned, source, 'the recognized Factory link gained a second parsed footer');
    writeFileSync(join(dir, 'index.html'), poisoned);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /exactly one original site footer/, 'the original parsed page has two site footers');
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), poisoned, 'the refused page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('footer insertion keeps an existing link with a div and trailing text intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-footer-link-'));
  try {
    const source = read('index.html');
    const start = source.indexOf('<footer class="site-footer">');
    const end = source.indexOf('</footer>', start) + '</footer>'.length;
    assert.ok(start >= 0 && end > start, 'the named source has one footer to replace');
    const original = '<footer class="site-footer"><a href="journal/"><div>Read</div> all notes</a></footer>';
    writeFileSync(join(dir, 'index.html'), source.slice(0, start) + original + source.slice(end));
    assert.deepEqual(normaliseHeaders({ distDir: dir }), { pages: 1, changed: 1, exempt: 0 });
    const output = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.match(output, /<a href="journal\/">\<div\>Read\<\/div\> all notes<\/a><a href="partners\/">Partners<\/a>/, 'Partners is inserted after the complete original link');
    const footer = actualElements(parse(output), 'footer').find(node => actualAttr(node, 'class') === 'site-footer');
    const journal = actualElements(footer, 'a').find(node => actualAttr(node, 'href') === 'journal/');
    assert.equal(actualText(journal), 'Read all notes', 'the original link retains its full label');
    assert.equal(actualElements(journal, 'a').length, 1, 'Partners is a separate anchor');
    assert.equal(actualElements(footer, 'a').filter(node => actualAttr(node, 'href') === 'partners/').length, 1, 'one Partners link remains');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the permitted 404 base cannot be discarded with its recognized navigation link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-404-base-'));
  try {
    const source = read('404.html');
    const base = `<base href="${SITE_ORIGIN}">`;
    const originalLink = `<a href="${SITE_ORIGIN}#floor">Factory</a>`;
    const moved = source.replace(base, '').replace(originalLink, `<a href="${SITE_ORIGIN}#floor">${base}Factory</a>`);
    assert.notEqual(moved, source, 'the original permitted base moved into a recognized nav link');
    assert.equal((moved.match(/<base\b/g) ?? []).length, 1, 'one permitted base remains');
    assert.throws(() => normaliseHeader(moved, { relPrefix: SITE_ORIGIN, label: '404.html' }), /Unexpected document base/, 'direct normalization refuses a base moved out of the document head');
    writeFileSync(join(dir, '404.html'), moved);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /Unexpected document base/, 'the named 404 build path refuses a base moved out of the document head');
    assert.equal(readFileSync(join(dir, '404.html'), 'utf8'), moved, 'the rejected 404 page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a permitted 404 base resolves a Findings fragment against the site home', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-404-findings-'));
  try {
    const source = normalise(read('404.html'), '404.html');
    const changed = source.replace(`href="${SITE_ORIGIN}#findings">Findings`, 'href="#findings">Findings');
    assert.notEqual(changed, source, 'the recognized Findings link now relies on the permitted base');
    assert.doesNotThrow(() => normaliseHeader(changed, { relPrefix: SITE_ORIGIN, label: '404.html' }), 'direct normalization honors the base');
    writeFileSync(join(dir, '404.html'), changed);
    assert.deepEqual(normaliseHeaders({ distDir: dir }), { pages: 1, changed: 1, exempt: 0 });
    assert.ok(readFileSync(join(dir, '404.html'), 'utf8').includes(`href="${SITE_ORIGIN}#findings">Findings`), 'the named-page output keeps the correct home target');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without the 404 base, a Findings fragment cannot be mistaken for the site home', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-404-no-base-'));
  try {
    const source = normalise(read('404.html'), '404.html');
    const changed = source.replace(`<base href="${SITE_ORIGIN}">`, '').replace(`href="${SITE_ORIGIN}#findings">Findings`, 'href="#findings">Findings');
    assert.notEqual(changed, source, 'the base is removed and the recognized Findings link is relative to the error page');
    assert.ok(!changed.includes(`<base href="${SITE_ORIGIN}">`) && changed.includes('href="#findings">Findings'), 'both the base removal and relative fragment are present');
    assert.throws(() => normaliseHeader(changed, { relPrefix: SITE_ORIGIN, label: '404.html' }), /relative "Findings" link without its permitted base/, 'direct normalization refuses the wrong fragment target');
    writeFileSync(join(dir, '404.html'), changed);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /relative "Findings" link without its permitted base/, 'the named-page build refuses the wrong fragment target');
    assert.equal(readFileSync(join(dir, '404.html'), 'utf8'), changed, 'the refused page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a nested missing URL cannot redirect a no-base 404 Find link into that folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-404-nested-find-'));
  try {
    const source = normalise(read('404.html'), '404.html');
    const withoutBase = source.replace(`<base href="${SITE_ORIGIN}">`, '');
    assert.notEqual(withoutBase, source, 'the permitted base was removed');
    assert.doesNotThrow(() => normaliseHeader(withoutBase, { relPrefix: SITE_ORIGIN, label: '404.html' }), 'absolute links remain valid without a base');
    const relativeFind = withoutBase.replace(`href="${SITE_ORIGIN}find/">Find`, 'href="find/">Find');
    assert.notEqual(relativeFind, withoutBase, 'Find now has a relative path');
    assert.notEqual(new URL('find/', `${SITE_ORIGIN}labs/missing`).href, `${SITE_ORIGIN}find/`, 'the nested error URL would misroute a relative Find link');
    assert.throws(() => normaliseHeader(relativeFind, { relPrefix: SITE_ORIGIN, label: '404.html' }), /relative "Find" link without its permitted base/, 'direct normalization refuses the nested-URL hazard');
    writeFileSync(join(dir, '404.html'), relativeFind);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /relative "Find" link without its permitted base/, 'the named-page build refuses the nested-URL hazard');
    assert.equal(readFileSync(join(dir, '404.html'), 'utf8'), relativeFind, 'the refused page was not rewritten');
    const withBase = source.replace(`href="${SITE_ORIGIN}find/">Find`, 'href="find/">Find');
    assert.ok(normaliseHeader(withBase, { relPrefix: SITE_ORIGIN, label: '404.html' }).includes(`href="${SITE_ORIGIN}find/">Find`), 'the permitted-base relative Find link is validated and emitted absolute');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an SVG base cannot stand in for the HTML head base on 404', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-404-svg-base-'));
  try {
    const source = normalise(read('404.html'), '404.html');
    const fake = source.replace(`<base href="${SITE_ORIGIN}">`, '').replace('<header class="site-header', `<svg><base href="${SITE_ORIGIN}"></base></svg><header class="site-header`).replace(`href="${SITE_ORIGIN}find/">Find`, 'href="find/">Find');
    assert.notEqual(fake, source, 'the only base is now inside SVG and Find is relative');
    assert.throws(() => normaliseHeader(fake, { relPrefix: SITE_ORIGIN, label: '404.html' }), /Unexpected document base/, 'an SVG element named base is not the document base');
    writeFileSync(join(dir, '404.html'), fake);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /Unexpected document base/, 'the named-page build refuses the fake base');
    assert.equal(readFileSync(join(dir, '404.html'), 'utf8'), fake, 'the refused page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the named 404 build refuses a Find link with a misleading suffix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-header-find-url-'));
  try {
    const source = read('404.html');
    const poisoned = source.replace(`href="${SITE_ORIGIN}find/">Find`, 'href="journal/find/">Find');
    assert.notEqual(poisoned, source, 'the recognized Find link now points to a nested page');
    writeFileSync(join(dir, '404.html'), poisoned);
    assert.throws(() => normaliseHeaders({ distDir: dir }), /site Find page/, 'the named-page build refuses the wrong resolved destination');
    assert.equal(readFileSync(join(dir, '404.html'), 'utf8'), poisoned, 'the refused page was not rewritten');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Partners moved to the footer: once in the site footer of every committed page, relative to the page, idempotent', () => {
  for (const rel of PAGE_FILES) {
    const src = read(rel);
    const out = addFooterLinks(normalise(src, rel), { relPrefix: prefixOf(rel), label: rel });
    const footers = actualElements(parse(out), 'footer').filter(node => actualAttr(node, 'class')?.split(/\s+/).includes('site-footer'));
    assert.equal(footers.length, 1, rel);
    for (const { label, path } of FOOTER_LINKS) {
      const links = actualElements(footers[0], 'a').filter(node => actualText(node).trim() === label);
      assert.equal(links.length, 1, `${rel}: ${label} once in the rendered footer`);
      assert.equal(actualAttr(links[0], 'href'), `${prefixOf(rel)}${path}`, `${rel}: real ${label} href`);
    }
    assert.equal(addFooterLinks(out, { relPrefix: prefixOf(rel), label: rel }), out, `${rel}: idempotent`);
    // Only the footer changes.
    const before = normalise(src, rel);
    const at = out.indexOf('<footer class="site-footer');
    assert.equal(out.slice(0, at), before.slice(0, at), `${rel}: nothing before the footer changes`);
    const close = '</footer>';
    assert.equal(out.slice(out.indexOf(close, at) + close.length), before.slice(before.indexOf(close, at) + close.length), `${rel}: nothing after the footer changes`);
  }
  const dataTrailer = '<!doctype html><html><body><footer class="site-footer"><div></div></footer><script type="application/json" id="station-data">{"rows":[{"value":"kept"}]}</script></body></html>';
  const withLink = addFooterLinks(dataTrailer, { relPrefix: '', label: 'index.html' });
  assert.equal(withLink.slice(withLink.indexOf('</footer>') + '</footer>'.length), dataTrailer.slice(dataTrailer.indexOf('</footer>') + '</footer>'.length), 'a nonempty data script after the footer is unchanged');
  assert.throws(() => addFooterLinks('<footer class="site-footer"></footer><footer class="site-footer"></footer>', { relPrefix: '' }), /exactly one site footer/);
  assert.throws(() => addFooterLinks('<header class="site-header"><nav></nav></header>', { relPrefix: '' }), /exactly one site footer/);
  assert.throws(() => addFooterLinks('<!-- <footer class="site-footer"><a href="partners/">Partners</a></footer> -->', { relPrefix: '' }), /exactly one site footer/, 'a commented footer is absent');
  assert.throws(() => addFooterLinks('<template><footer class="site-footer"><a href="partners/">Partners</a></footer></template>', { relPrefix: '' }), /exactly one site footer/, 'a template footer is inert');
  assert.throws(() => addFooterLinks('<template data-name=x/><footer class="site-footer"><a href="partners/">Partners</a></footer></template>', { relPrefix: '' }), /exactly one site footer/, 'a slash in an unquoted template attribute does not close the template');
  assert.throws(() => addFooterLinks('<textarea><footer class="site-footer"><a href="partners/">Partners</a></footer></textarea>', { relPrefix: '' }), /exactly one site footer/, 'markup inside textarea is text');
  assert.throws(() => addFooterLinks('<svg><![CDATA[a > b </svg><footer class="site-footer"><a href="partners/">Partners</a></footer>]]></svg>', { relPrefix: '' }), /Unsupported HTML CDATA section/, 'a footer inside SVG CDATA cannot satisfy the build guard');
  const fakeFooter = '<footer class="site-footer"><div><a href="partners/">Partners</a></div></footer>';
  assert.throws(() => addFooterLinks(`<!doctype html><html><body>${fakeFooter}<script type="application/json" id="station-data">{}</script><p>Unexpected visible trailer</p><script type="application/json" id="station-data">{}</script></body></html>`, { relPrefix: '', label: 'index.html' }), /Unexpected site footer shape/, 'only the first parsed data-script end may precede the document close');
  assert.throws(() => addFooterLinks(`<!doctype html><html><body><svg><style><![CDATA[a > b </style></svg>${fakeFooter}]]></style></svg></body></html>`, { relPrefix: '', label: 'index.html' }), /Unsupported HTML CDATA section/, 'a footer example inside SVG style CDATA is refused');
  assert.throws(() => addFooterLinks(`<!doctype html><html><body><svg><style><![CDATA[a > b </style></svg>${fakeFooter}<script type="application/json" id="station-data">]]></style></svg></script></body></html>`, { relPrefix: '', label: 'index.html' }), /Unsupported HTML CDATA section/, 'CDATA remains unsupported even when its terminator is inside a permitted data trailer');
  assert.throws(() => addFooterLinks(`<!doctype html><html><body><textarea>hidden</textarea data-x="> ${fakeFooter}">still hidden</textarea></body></html>`, { relPrefix: '', label: 'index.html' }), /Unsupported raw HTML end tag/, 'a footer example inside a quoted raw-text end tag is refused');
  assert.throws(() => addFooterLinks(`<!doctype html><html><body><textarea>hidden</textarea data-x='> ${fakeFooter}<script type="application/json" id="station-data">' ></script></textarea></body></html>`, { relPrefix: '', label: 'index.html' }), /Unsupported raw HTML end tag/, 'a raw-text end tag with an attribute cannot span a footer into the data trailer');
  assert.throws(() => addFooterLinks('<script type="application/json"><!--<script></script><footer class="site-footer"><a href="partners/">Partners</a></footer></script>', { relPrefix: '' }), /Unsupported double-escaped script text/, 'a footer inside double-escaped script text cannot satisfy the build guard');
  assert.throws(() => addFooterLinks('<details><footer class="site-footer"><a href="partners/">Partners</a></footer></details>', { relPrefix: '' }), /exactly one site footer/, 'a closed details footer is not visible');
  assert.throws(() => addFooterLinks('<dialog><footer class="site-footer"><a href="partners/">Partners</a></footer></dialog>', { relPrefix: '' }), /exactly one site footer/, 'a closed dialog footer is not visible');
  assert.equal(addFooterLinks('<dialog open><footer class="site-footer"><a href="partners/">Partners</a></footer></dialog>', { relPrefix: '' }), '<dialog open><footer class="site-footer"><a href="partners/">Partners</a></footer></dialog>', 'an open dialog footer is visible');
  assert.throws(() => addFooterLinks('<base href="journal/"><footer class="site-footer"><a href="partners/">Partners</a></footer>', { relPrefix: '', label: 'index.html' }), /Unexpected document base/, 'a conflicting base changes the real destination');
  assert.throws(() => addFooterLinks('<!-- first --!><base href="journal/"><!-- second --><footer class="site-footer"><a href="partners/">Partners</a></footer>', { relPrefix: '', label: 'index.html' }), /Unexpected document base/, 'an abrupt comment end cannot hide a live base');
  const real404 = read('404.html');
  assert.doesNotThrow(() => addFooterLinks(real404, { relPrefix: SITE_ORIGIN, label: '404.html' }), 'the real 404 HTML-head base is accepted');
  const targeted404 = real404.replace(`<base href="${SITE_ORIGIN}">`, `<base href="${SITE_ORIGIN}" target="hidden-frame">`);
  assert.notEqual(targeted404, real404, 'only the real HTML-head base gained a target');
  assert.throws(() => addFooterLinks(targeted404, { relPrefix: SITE_ORIGIN, label: '404.html' }), /Unexpected document base/, 'a target on the otherwise valid base is refused');
  assert.throws(() => addFooterLinks('<footer class="site-footer" style="display: none /* temporarily hidden */;"><a href="partners/">Partners</a></footer>', { relPrefix: '' }), /exactly one site footer/, 'an inline CSS comment cannot mask a hidden footer');
  assert.equal(addFooterLinks('<!-- <footer class="site-footer"><a href="partners/">Partners</a></footer> --><footer class="site-footer"><div></div></footer>', { relPrefix: '' }), '<!-- <footer class="site-footer"><a href="partners/">Partners</a></footer> --><footer class="site-footer"><div><a href="partners/">Partners</a></div></footer>', 'a commented link cannot suppress insertion into the rendered footer');
  assert.equal(addFooterLinks('<footer class="site-footer"><div><!-- <a href="partners/">Partners</a> --></div></footer>', { relPrefix: '' }), '<footer class="site-footer"><div><!-- <a href="partners/">Partners</a> --><a href="partners/">Partners</a></div></footer>', 'a commented link inside the real footer cannot suppress insertion');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a data-href="partners/">Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'data-href is not a usable link');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/"><script type="text/plain">Partners</script></a></footer>', { relPrefix: '' }), /invalid Partners link/, 'a script cannot supply the visible Partners label');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/"><datalist><option>Partners</option></datalist></a></footer>', { relPrefix: '' }), /invalid Partners link/, 'a datalist cannot supply the visible Partners label');
  assert.throws(() => addFooterLinks('<!doctype html><html><body><footer class="site-footer"><div><datalist><a href="partners/">Partners</a></datalist></div></footer></body></html>', { relPrefix: '', label: 'index.html' }), /invalid Partners link/, 'an existing Partners anchor inside a datalist is not usable on a built page');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a data-href="partners/" href="elsewhere/">Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'the actual href must lead to Partners');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/" download>Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'Partners must navigate, not download the page');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/" onclick="return false">Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'an existing Partners link cannot cancel its own navigation');
  const nestedPartners = '<footer class="site-footer"><a href="partners/"><span>Partners</span></a></footer>';
  assert.equal(addFooterLinks(nestedPartners, { relPrefix: '' }), nestedPartners, 'a nested visible label without a handler remains a valid existing link');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/"><span onclick="event.preventDefault()">Partners</span></a></footer>', { relPrefix: '' }), /invalid Partners link/, 'a child carrying the visible Partners label cannot cancel navigation');
  assert.throws(() => addFooterLinks('<iframe name="hidden-frame" hidden></iframe><footer class="site-footer"><a href="partners/" target="hidden-frame">Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'Partners must navigate this page, not a named frame');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a hidden href="partners/">Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'a hidden Partners link is not usable');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><details><a href="partners/">Partners</a></details></footer>', { relPrefix: '' }), /invalid Partners link/, 'a Partners link inside closed details is not usable');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/"><span hidden>Partners</span></a></footer>', { relPrefix: '' }), /invalid Partners link/, 'a hidden descendant cannot supply the visible label');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/">Partners</a><a href="elsewhere/">Partners<span hidden> archive</span></a></footer>', { relPrefix: '' }), /invalid Partners link/, 'a hidden suffix cannot mask a duplicate visible Partners label');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/">Partners</a><a href="partners/"><span>Partners</span></a></footer>', { relPrefix: '' }), /invalid Partners link/, 'nested text still counts as a duplicate label');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><a href="partners/">Partners</a><a href="partners/">Partners</a></footer>', { relPrefix: '' }), /invalid Partners link/, 'duplicate Partners links are refused');
  assert.throws(() => addFooterLinks('<footer class="site-footer"><div></div></footer>', { relPrefix: './' }), /prefix/);
  assert.equal(addFooterLinks('<footer class="site-footer"><div><a href="x">X</a></div><span>v</span></footer>', { relPrefix: '../' }), '<footer class="site-footer"><div><a href="x">X</a><a href="../partners/">Partners</a></div><span>v</span></footer>');
  const hiddenFirst = '<footer class="site-footer"><div hidden></div><div><a href="x">X</a></div></footer>';
  const visibleSecond = '<footer class="site-footer"><div hidden></div><div><a href="x">X</a><a href="partners/">Partners</a></div></footer>';
  assert.equal(addFooterLinks(hiddenFirst, { relPrefix: '' }), visibleSecond, 'insert into the visible div');
  assert.equal(addFooterLinks(visibleSecond, { relPrefix: '' }), visibleSecond, 'visible insertion stays idempotent');
  const hiddenPopover = '<footer class="site-footer"><div popover></div></footer>';
  const visibleFooter = '<footer class="site-footer"><div popover></div><a href="partners/">Partners</a></footer>';
  assert.equal(addFooterLinks(hiddenPopover, { relPrefix: '' }), visibleFooter, 'a closed popover is not an insertion group');
  assert.equal(addFooterLinks(visibleFooter, { relPrefix: '' }), visibleFooter, 'fallback insertion stays idempotent');
});
