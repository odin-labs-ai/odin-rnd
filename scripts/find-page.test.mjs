import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  filter, paramsFromSearch, searchFromParams, cleanParams, isEmpty, normalize, numberLabel, safeHref, facetValues, monthLabel, KEYS, topicLabels, resultPage, remainingItems, RESULT_PAGE_SIZE,
} from '../site/assets/find.mjs';
import { hrefOnSite } from './site-index.mjs';

const moduleUrl = new URL('../site/assets/find.mjs', import.meta.url);
const html = readFileSync(new URL('../site/find/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../site/assets/find.css', import.meta.url), 'utf8');
const source = readFileSync(moduleUrl, 'utf8');

const items = [
  { type: 'experiment', id: 'exp-005', title: 'Does a gate catch drift?', date: '2026-09-14', stage: 'results', outcome: 'refuted', topics: ['blueprints', 'ci'], summary: 'The claim did not hold.', href: 'journal/jev-gate.html' },
  { type: 'experiment', id: 'exp-012', title: 'Self verification', date: '2026-10-02', stage: 'pre-registered', topics: ['verification'], summary: 'Can a model check itself?', href: 'experiments/self-verify/' },
  { type: 'note', id: 'note-cafe', title: 'Notes from the Café', date: '2026-10-20', stage: 'published', topics: ['factory'], summary: 'A résumé of the week.', href: 'journal/cafe.html' },
  { type: 'lab', id: 'lab-06', title: 'Lab 06', date: '2026-10-29', stage: 'results', outcome: 'mixed', topics: ['ci', 'factory'], summary: 'Runs on org machines.', href: 'labs/06/' },
  { type: 'tool', id: 'bce', title: 'Blueprint conformance engine', date: '2026-09-23', stage: 'released', outcome: 'supported', topics: ['blueprints'], summary: 'Checks code against a blueprint.', href: 'projects/bce/' },
];
const ids = list => list.map(item => item.id);

test('empty parameters return every item in input order', () => {
  assert.deepEqual(ids(filter(items, {})), ids(items));
  assert.deepEqual(ids(filter(items, paramsFromSearch(''))), ids(items));
  assert.deepEqual(ids(filter(items, { q: '   ' })), ids(items));
  assert.ok(isEmpty({}));
});

test('within one facet values are OR-ed', () => {
  assert.deepEqual(ids(filter(items, { type: ['note', 'tool'] })), ['note-cafe', 'bce']);
  assert.deepEqual(ids(filter(items, { topic: ['verification', 'factory'] })), ['exp-012', 'note-cafe', 'lab-06']);
  assert.deepEqual(ids(filter(items, { outcome: ['refuted', 'mixed'] })), ['exp-005', 'lab-06']);
});

test('across facets every condition must hold (AND)', () => {
  assert.deepEqual(ids(filter(items, { type: ['experiment', 'lab'], topic: ['ci'] })), ['exp-005', 'lab-06']);
  assert.deepEqual(ids(filter(items, { type: ['experiment', 'lab'], topic: ['ci'], stage: ['results'], outcome: ['mixed'] })), ['lab-06']);
  assert.deepEqual(ids(filter(items, { type: ['experiment'], date: '2026-10' })), ['exp-012']);
  assert.deepEqual(ids(filter(items, { type: ['tool'], outcome: ['refuted'] })), []);
});

test('an item without an outcome never matches an outcome filter', () => {
  assert.ok(!ids(filter(items, { outcome: ['supported', 'refuted', 'mixed'] })).includes('exp-012'));
});

test('text search covers title, summary and topics, ignoring case and accents', () => {
  assert.deepEqual(ids(filter(items, { q: 'GATE' })), ['exp-005']);
  assert.deepEqual(ids(filter(items, { q: 'cafe' })), ['note-cafe']);
  assert.deepEqual(ids(filter(items, { q: 'Résumé' })), ['note-cafe']);
  assert.deepEqual(ids(filter(items, { q: 'resume' })), ['note-cafe']);
  assert.deepEqual(ids(filter(items, { q: 'org machines' })), ['lab-06']);
  assert.deepEqual(ids(filter(items, { q: 'verification' })), ['exp-012']);
  assert.deepEqual(ids(filter(items, { q: 'blueprints' })), ['exp-005', 'bce']);
  assert.deepEqual(ids(filter(items, { q: 'self check' })), ['exp-012'], 'every word must match, in any field');
  assert.deepEqual(ids(filter(items, { q: 'drift zebra' })), []);
  assert.deepEqual(ids(filter(items, { q: 'exp-005' })), [], 'ids and hrefs are not searched');
  assert.equal(normalize('  Ångström  Café '), 'angstrom cafe');
});

test('text search combines with facets', () => {
  assert.deepEqual(ids(filter(items, { q: 'blueprint', type: ['tool'] })), ['bce']);
});

test('number labels from experiment and lab ids are searchable and visible in result metadata', () => {
  const numbered = [
    { ...items[0], id: 'exp-007', title: 'A neutral title', summary: 'A neutral summary.', topics: [] },
    { ...items[3], id: 'lab-05', title: 'Another neutral title', summary: 'Another summary.', topics: [] },
  ];
  assert.equal(numberLabel(numbered[0]), 'EXP 007');
  assert.equal(numberLabel(numbered[1]), 'Lab 05');
  assert.equal(numberLabel(items[2]), '');
  assert.deepEqual(ids(filter(numbered, { q: 'exp 7' })), ['exp-007']);
  assert.deepEqual(ids(filter(numbered, { q: 'exp 007' })), ['exp-007']);
  assert.deepEqual(ids(filter(numbered, { q: 'lab 05' })), ['lab-05']);
  const amendment = { type: 'update', id: 'update-exp-020-amendment-04', title: 'Same title', summary: 's', topics: [] };
  assert.equal(numberLabel(amendment), 'EXP 020 · Amendment 04', 'numbered updates are told apart by a label, not a changed title');
  assert.equal(numberLabel({ type: 'update', id: 'update-exp-005-erratum-01' }), 'EXP 005 · Erratum 01');
  assert.equal(numberLabel({ type: 'update', id: 'update-exp-005-results' }), '');
  assert.deepEqual(ids(filter([amendment], { q: 'amendment 04' })), ['update-exp-020-amendment-04']);
  assert.match(source, /if \(label\) meta\.append\(element\(doc, 'span', \{\}, label\)\)/, 'the same label is rendered in the visible meta line');
});

test('the stage options omit Kind duplicates while saved stage links still filter', () => {
  const sameAsKind = [
    { ...items[2], stage: 'note' },
    { ...items[4], stage: 'tool' },
  ];
  assert.deepEqual(facetValues([...items, ...sameAsKind], 'stage'), ['pre-registered', 'published', 'released', 'results']);
  assert.deepEqual(ids(filter(sameAsKind, paramsFromSearch('?stage=note'))), ['note-cafe']);
  assert.deepEqual(ids(filter(sameAsKind, paramsFromSearch('?stage=tool'))), ['bce']);
});

test('interactive results show 30 first and name the full remainder', () => {
  const many = Array.from({ length: 65 }, (_, index) => ({ id: `item-${index}` }));
  assert.deepEqual(resultPage(many.slice(0, 30)), { visible: many.slice(0, 30), remaining: 0 });
  assert.deepEqual(resultPage(many), { visible: many.slice(0, 30), remaining: 35 });
  assert.match(source, /`Show \$\{remaining\} more`/, 'the reveal control names the remainder');
  assert.match(source, /const \{ visible, remaining \} = resultPage\(found\)/, 'every render resets the cap');
});

test('Show more reveals only the current matching remainder', () => {
  const many = Array.from({ length: RESULT_PAGE_SIZE + 6 }, (_, index) =>
    ({ id: `item-${index}`, type: index < 4 ? 'note' : 'experiment' }));
  assert.deepEqual(ids(remainingItems(many, {})), ids(many.slice(RESULT_PAGE_SIZE)));
  assert.deepEqual(remainingItems(many, { type: ['note'] }), []);
  assert.match(source, /const rest = remainingItems\(items, read\(\)\)\.map\(row\)/, 'the reveal handler reads the live form state');
  assert.doesNotMatch(source, /const rest = filter\(items, params\)/, 'the reveal handler does not use closure state');
});

test('unknown parameters and malformed values are ignored', () => {
  assert.deepEqual(ids(filter(items, { foo: 'bar', sort: 'x' })), ids(items));
  assert.deepEqual(ids(filter(items, paramsFromSearch('?utm_source=x&page=2'))), ids(items));
  assert.deepEqual(cleanParams({ date: '2026-13', q: 7, extra: 1 }), { q: '7', type: [], stage: [], outcome: [], topic: [], date: '' });
  assert.deepEqual(paramsFromSearch('?date=October'), cleanParams({}));
  assert.deepEqual(filter(null, {}), []);
  assert.deepEqual(filter([null, 3, 'x'], {}), []);
});

test('URL state round-trips with a fixed key order', () => {
  const params = { q: 'gate drift', type: ['experiment', 'lab'], stage: ['results'], outcome: ['refuted'], topic: ['ci', 'factory'], date: '2026-10' };
  const search = searchFromParams(params);
  assert.equal(search, '?q=gate+drift&type=experiment&type=lab&stage=results&outcome=refuted&topic=ci&topic=factory&date=2026-10');
  assert.deepEqual(paramsFromSearch(search), cleanParams(params));
  assert.equal(searchFromParams(paramsFromSearch(search)), search);
  assert.deepEqual([...new URLSearchParams(search).keys()].filter((k, i, a) => a.indexOf(k) === i), KEYS);
});

test('URL parsing tolerates order, commas, duplicates and an empty query', () => {
  assert.equal(searchFromParams({}), '');
  assert.equal(searchFromParams(paramsFromSearch('')), '');
  assert.deepEqual(paramsFromSearch('date=2026-09&topic=ci,factory&topic=ci&q=&type=note'),
    { q: '', type: ['note'], stage: [], outcome: [], topic: ['ci', 'factory'], date: '2026-09' });
  assert.deepEqual(paramsFromSearch('?q=caf%C3%A9'), { ...cleanParams({}), q: 'café' });
  assert.equal(searchFromParams(paramsFromSearch('?q=caf%C3%A9')), '?q=caf%C3%A9');
});

test('helpers: safe links, facet values, month labels', () => {
  assert.equal(safeHref('journal/a.html'), 'journal/a.html');
  assert.equal(safeHref('/labs/06/'), null, 'a leading slash is refused, not repaired');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://example.com/'), null);
  assert.equal(safeHref('//example.com/'), null);
  assert.deepEqual(facetValues(items, 'topics'), ['blueprints', 'ci', 'factory', 'verification']);
  assert.deepEqual(facetValues(items, 'stage'), ['pre-registered', 'published', 'released', 'results']);
  assert.equal(monthLabel('2026-10'), 'October 2026');
});

test('safeHref on the page agrees with the site index\'s on-site gate (hrefOnSite) for every shape of link', () => {
  const pages = new Set(['index.html', 'experiments/index.html', 'journal/a.html', 'labs/x/index.html', 'projects/t/index.html']);
  const good = ['index.html#all-experiments', 'experiments/#bench', 'experiments/', 'journal/a.html', 'labs/x/index.html', 'projects/t/'];
  const bad = ['../journal/a.html', 'journal/../journal/a.html', './journal/a.html', 'journal/./a.html', '..', '/journal/a.html', '//example.com/x',
    '\\\\host\\x', 'https://example.com/', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '#top', '', 'journal/a b.html', 'journal/"a".html', ' journal/a.html'];
  for (const href of good) { assert.equal(safeHref(href), href, href); assert.ok(hrefOnSite(href, pages), `index: ${href}`); }
  for (const href of bad) { assert.equal(safeHref(href), null, JSON.stringify(href)); assert.ok(!hrefOnSite(href, pages), `index: ${JSON.stringify(href)}`); }
});

test('the template has one site header, a canonical link and one list marker', () => {
  assert.equal(html.match(/<header\b[^>]*class="site-header\b/g)?.length, 1);
  assert.equal(html.match(/<header\b/g)?.length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/find\/">/);
  assert.equal(html.split('<!--FIND_LIST-->').length - 1, 1);
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate id');
});

test('the template carries the search UI the module expects', () => {
  for (const id of ['find-form', 'find-search', 'find-filters', 'find-stage-options', 'find-topic-options', 'find-date', 'find-count', 'find-clear', 'find-results', 'find-static']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<input id="find-search" name="q" type="search"/);
  assert.match(html, /id="find-count"[^>]*aria-live="polite"/);
  for (const name of ['type', 'outcome']) assert.match(html, new RegExp(`<fieldset[\\s\\S]*name="${name}"`));
  assert.equal(html.match(/<fieldset\b/g)?.length, 4);
  assert.match(html, /<form id="find-form"[^>]*\shidden>/, 'the form stays hidden until the index loads');
  assert.doesNotMatch(html.match(/<div id="find-static"[\s\S]*?<\/div>/)[0], /\shidden/, 'the static list is visible without JavaScript');
});

test('the template loads nothing from elsewhere and holds no numbers or index link', () => {
  for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) assert.doesNotMatch(src, /^(https?:)?\/\//, src);
  assert.equal(html.match(/<script\b/g)?.length, 1);
  assert.match(html, /<script type="module" src="\.\.\/assets\/find\.mjs"><\/script>/);
  for (const [, href] of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) {
    if (!href.startsWith('https://odin-labs-ai.github.io/odin-rnd/')) assert.doesNotMatch(href, /^(https?:)?\/\//, href);
  }
  assert.doesNotMatch(html, /index\.json/);
  const main = html.match(/<main[\s\S]*<\/main>/)[0].replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(main, /\d/, 'no counts or numbers in the page text');
});

test('the module has no imports and fetches only the site index', () => {
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.deepEqual([...source.matchAll(/\bfetch\((.*?), \{/g)].map(m => m[1].trim()), ["new URL('../data/index.json', doc.baseURI)"]);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write|eval\(/);
});

test('the stylesheet uses existing tokens, keeps tap targets and has no motion', () => {
  assert.match(css, /var\(--rule\)/);
  assert.match(css, /var\(--brand\)/);
  assert.doesNotMatch(css, /@keyframes|transition:\s*(?!none)[a-z]|animation:\s*(?!none)[a-z]/);
  for (const selector of ['.find-check', '.find-clear', '.find-chip', '.find-more']) {
    assert.match(css, new RegExp(`\\${selector}\\{[^}]*min-height:4[4-9]px`), selector);
  }
});

test('coarse pointers hide the keyboard slash hint', () => {
  assert.match(css, /@media\s*\(pointer:coarse\)\s*\{\s*\.find-hint\s*\{\s*display:none\s*\}\s*\}/);
});

test('importing the module without a find page does nothing and does not throw', () => {
  // The stub matches the sitewide activity loader: a document with only addEventListener/getElementById.
  const script = `
    globalThis.document = { addEventListener() { throw new Error('listener'); }, getElementById() { return null; } };
    globalThis.window = { location: { pathname: '/odin-rnd/find/' }, fetch() { throw new Error('fetched'); } };
    globalThis.fetch = () => { throw new Error('fetched'); };
    await import(process.argv[1]);
    console.log('ok');`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, fileURLToPath(moduleUrl)], { encoding: 'utf8' });
  assert.equal(out.trim(), 'ok');
});

test('topic labels come from the index\'s label map, and a bare array or a missing map gives none', () => {
  assert.deepEqual(topicLabels({ items: [], topics: { ci: 'CI', gates: ' Gates ', bad: 3 } }), { ci: 'CI', gates: 'Gates' });
  assert.deepEqual(topicLabels([]), {});
  assert.deepEqual(topicLabels({ items: [] }), {});
  assert.deepEqual(topicLabels(null), {});
});
