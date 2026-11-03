// The shaped home (scripts/home-shape.mjs), on synthetic pages: the order, the folds, what is kept and every refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { journalRows } from './experiment-ledger.mjs';
import { assertKept, FOLDS, FURTHER, FURTHER_ID, HOME_CSS, HOME_JS, idsOf, ledgerOf, OPEN_ORDER, shapeHome } from './home-shape.mjs';
import { idOf, openAround } from '../site/assets/home-fold.mjs';

const LEDGER = '<div class="experiment-ledger" id="all-experiments"><h3 id="all-experiments-title">List.</h3><ol aria-labelledby="all-experiments-title"><li><a href="journal/a.html">EXP 004</a></li></ol></div>';
const row = n => `<a class="journal-row" href="journal/${n}.html"><div><h3>Note ${n}</h3><p>Text ${n}.</p></div></a>`;
const heading = (id, title) => `<div class="section-heading"><h2 id="${id}">${title}</h2><p>Intro.</p></div>`;
const SECTIONS = {
  floor: '<section class="hero cutaway dark-surface" id="floor" aria-labelledby="hero-title"><h1 id="hero-title">Factory</h1><section class="nested"><p>Station.</p></section></section>',
  lab: `<section class="lab-launch content-section" id="lab" aria-labelledby="lab-title">${heading('lab-title', 'Measured')}<ol class="proof-strip"><li data-source="x">One</li></ol></section>`,
  'work-with-us': `<section class="offer content-section" id="work-with-us" aria-labelledby="offer-title">${heading('offer-title', 'Work with us')}<p>Offer.</p></section>`,
  'partner-tracks': `<section class="partner-tracks content-section" id="partner-tracks" aria-labelledby="tracks-title">${heading('tracks-title', 'Tracks')}<ol class="track-cards"><li>Track.</li></ol></section>`,
  'agent-space': '<section class="agent-space dark-surface" id="agent-space" aria-labelledby="agent-space-title"><div class="agent-space-copy"><h2 id="agent-space-title">Agent space</h2><div><p>Nested div.</p></div></div><figure class="agent-space-media"><video controls></video></figure></section>',
  updates: `<!-- updates: rendered by scripts/updates.mjs --write from site/data/updates.json; do not edit by hand -->\n    <section class="updates-feed content-section" id="updates" aria-labelledby="updates-title">${heading('updates-title', 'Latest')}<ol class="update-list"><li>Update.</li></ol></section>\n    <!-- /updates -->`,
  'how-it-works': `<section class="floor-story content-section" id="how-it-works" aria-labelledby="story-title" data-story>${heading('story-title', 'How')}<ol><li class="story-step">Step.</li></ol></section>`,
  experiments: `<section class="experiments content-section" id="experiments" aria-labelledby="experiments-title">${heading('experiments-title', 'Experiments')}${LEDGER}<div class="experiment-index"><a href="projects/x/"><h3>X</h3></a></div></section>`,
  'research-note': '<section class="research-note content-section" aria-labelledby="research-note-title"><div><h2 id="research-note-title">Limits</h2><p>What it does not show.</p></div><article><h3><a href="journal/p.html">Note</a></h3></article></section>',
  projects: `<section class="projects content-section" id="projects" aria-labelledby="projects-title">${heading('projects-title', 'Tools')}<article class="project-row">Tool.</article></section>`,
  'drawing-board': '<section class="drawing-board content-section dark-surface" aria-labelledby="next-title"><div class="drawing-board-header"><h2 id="next-title">Products</h2><p>Private.</p></div><div class="research-directions"><article>One.</article></div></section>',
  journal: `<section class="journal content-section" id="journal" aria-labelledby="journal-title">${heading('journal-title', 'Notes')}\n      ${row(1)}\n      ${row(2)}\n      <details class="journal-more"><summary>Show the earlier note</summary>${row(3)}</details>\n    </section>`,
  closing: '<section class="closing"><p>The next good question.</p></section>',
};
const SOURCE_ORDER = ['floor', 'lab', 'work-with-us', 'partner-tracks', 'agent-space', 'updates', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal', 'closing'];
const page = (order = SOURCE_ORDER, sections = SECTIONS) => `<!doctype html><html><head>\n  <link rel="stylesheet" href="assets/launch.css">\n  <script type="module" src="assets/motion.mjs"></script>\n</head><body><header><nav aria-label="Main navigation"><a href="./#floor">Factory</a></nav></header>\n  <main id="main">\n    ${order.map(k => sections[k]).join('\n    ')}\n  </main>\n</body></html>`;
const HOME = page();
const keyOf = open => /\sid="([^"]*)"/.exec(open)?.[1] ?? /\sclass="([^"\s]*)/.exec(open)[1];
const topOrder = html => {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const out = [];
  let depth = 0;
  for (const m of main.matchAll(/<\/?(section|nav)\b[^>]*>/g)) {
    if (m[0][1] === '/') depth--;
    else { if (depth === 0) out.push(m[1] === 'nav' ? 'nav' : keyOf(m[0])); depth++; }
  }
  return out;
};

test('the shaped home opens with the factory, the updates, the lab and the offer, then Go further, then the rest in source order', () => {
  const out = shapeHome(HOME);
  assert.deepEqual(topOrder(out), [...OPEN_ORDER, 'nav', 'partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal', 'closing']);
  assert.deepEqual(FOLDS.map(f => f.key), ['partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal']);
  // The updates feed moves with its two markers, which stay around it.
  assert.match(out, /<!-- updates:[^>]*-->\n {4}<section class="updates-feed[^]*?<\/section>\n {4}<!-- \/updates -->\n {4}<section class="lab-launch/);
  assert.equal(out.split('<!-- /updates -->').length, 2);
  // The open sections are byte for byte as they were.
  for (const key of ['floor', 'lab', 'work-with-us', 'closing']) assert.ok(out.includes(SECTIONS[key]), key);
  // Go further, after the offer, links the five section pages.
  const nav = out.slice(out.indexOf('<nav class="home-further'), out.indexOf('</nav>', out.indexOf('<nav class="home-further')));
  assert.deepEqual([...nav.matchAll(/href="([^"]*)"/g)].map(m => m[1]), ['find/', 'experiments/', 'labs/', 'journal/', 'projects/']);
  assert.match(nav, new RegExp(`aria-labelledby="${FURTHER_ID}"><h2 id="${FURTHER_ID}">Go further</h2>`));
  assert.ok(out.indexOf('<nav class="home-further') > out.indexOf('id="work-with-us"') && out.indexOf('<nav class="home-further') < out.indexOf('id="partner-tracks"'));
  // Only the home links its stylesheet and opener, once each, after the home's own.
  assert.ok(out.includes(`<link rel="stylesheet" href="assets/launch.css">\n  <link rel="stylesheet" href="${HOME_CSS}">`));
  assert.ok(out.includes(`<script type="module" src="assets/motion.mjs"></script>\n  <script type="module" src="${HOME_JS}"></script>`));
});

test('each folded section keeps its section, id and heading block visible, and its whole body in one closed fold', () => {
  const out = shapeHome(HOME);
  for (const { key, summary } of FOLDS) {
    const source = SECTIONS[key];
    const open = source.slice(0, source.indexOf('>') + 1);
    const at = out.indexOf(open);
    assert.ok(at >= 0, `${key}: the section and its attributes are kept`);
    const shaped = out.slice(at, out.indexOf('<details class="home-fold">', at));
    assert.ok(source.startsWith(shaped), `${key}: the heading block is shown as it was, before the fold`);
    assert.match(shaped, /<h2 id="[^"]+">/, `${key}: its heading stays outside the fold`);
    const body = source.slice(shaped.length, source.lastIndexOf('</section>'));
    assert.ok(out.includes(`${shaped}<details class="home-fold"><summary>${summary}<span aria-hidden="true">+</span></summary>${body}</details></section>`), `${key}: the rest is folded byte for byte`);
  }
  assert.ok(!/<details class="home-fold" open/.test(out), 'every fold starts closed');
  // The tags still balance in every section: a fold never splits an element.
  const main = out.slice(out.indexOf('<main'), out.indexOf('</main>'));
  for (const tag of ['div', 'details', 'section', 'article', 'nav']) assert.equal((main.match(new RegExp(`<${tag}\\b`, 'g')) || []).length, (main.match(new RegExp(`</${tag}>`, 'g')) || []).length, tag);
});

test('everything a reader of the built home relies on is kept: field-note rows, ledger bytes and ids', () => {
  const out = shapeHome(HOME);
  assert.deepEqual(journalRows(out), journalRows(HOME));
  assert.equal(journalRows(out).length, 3);
  assert.equal(ledgerOf(out), LEDGER);
  assert.deepEqual(idsOf(out).filter(id => id !== FURTHER_ID).sort(), idsOf(HOME).sort());
  assert.ok(out.includes('<details class="journal-more"><summary>Show the earlier note</summary>'), 'the journal fold nests inside its section fold');
});

test('the shaped home refuses a page it does not expect', () => {
  const without = key => page(SOURCE_ORDER.filter(k => k !== key));
  const cases = [
    [shapeHome(HOME), /already shaped/],
    [without('lab'), /no section "lab" \(the proof strip\)/],
    [without('journal'), /no section "journal"/],
    [without('closing'), /no section "closing"/],
    [page([...SOURCE_ORDER, 'projects']), /section "projects" appears twice/],
    [page([...SOURCE_ORDER, 'extra'], { ...SECTIONS, extra: '<section class="new-thing" id="new-thing"><p>New.</p></section>' }), /unknown top-level section "new-thing"/],
    [page(SOURCE_ORDER, { ...SECTIONS, projects: SECTIONS.projects.replace('<div class="section-heading">', '<div class="intro">') }), /section projects does not open with its heading block/],
    [page(SOURCE_ORDER, { ...SECTIONS, 'research-note': SECTIONS['research-note'].replace('<div><h2', '<div class="x"><h2') }), /section research-note does not open with its heading block \(a bare <div>\)/],
    [page(SOURCE_ORDER, { ...SECTIONS, closing: SECTIONS.closing.replace('</section>', '') }), /unclosed <section>/],
    [page(SOURCE_ORDER, { ...SECTIONS, updates: SECTIONS.updates.replace('<!-- /updates -->', '') }), /not between its <!-- updates: --> and <!-- \/updates --> markers/],
    [page(SOURCE_ORDER, { ...SECTIONS, projects: `<p>Loose.</p>${SECTIONS.projects}` }), /content between sections research-note and projects/],
    [page(SOURCE_ORDER, { ...SECTIONS, 'partner-tracks': `<section class="partner-tracks content-section" id="partner-tracks">${heading('tracks-title', 'Tracks')}</section>` }), /partner-tracks has nothing to fold/],
    [HOME.replace('<main id="main">', '<main id="main"></main><main>'), /exactly one <main>/],
    [HOME.replace('<link rel="stylesheet" href="assets/launch.css">', ''), /assets\/launch\.css exactly once/],
    [HOME.replace('<script type="module" src="assets/motion.mjs"></script>', ''), /assets\/motion\.mjs exactly once/],
  ];
  for (const [html, expected] of cases) assert.throws(() => shapeHome(html), expected, String(expected));
});

test('the kept-check refuses changed field-note rows, ledger bytes or ids', () => {
  const out = shapeHome(HOME);
  assert.doesNotThrow(() => assertKept(HOME, out));
  assert.throws(() => assertKept(HOME, out.replace(row(3), '')), /field-note rows changed/);
  assert.throws(() => assertKept(HOME, out.replace(row(2), row(4))), /field-note rows changed/);
  assert.throws(() => assertKept(HOME, out.replace('<li><a href="journal/a.html">EXP 004</a></li>', '<li>EXP 004</li>')), /ledger is missing or its bytes changed/);
  assert.throws(() => assertKept(HOME.replace(LEDGER, ''), out.replace(LEDGER, '')), /ledger is missing/);
  assert.throws(() => assertKept(HOME, out.replace(' id="tracks-title"', '')), /page ids changed/);
  assert.throws(() => assertKept(HOME, out.replace('<p>Offer.</p>', '<p id="new">Offer.</p>')), /page ids changed/);
  assert.throws(() => assertKept(HOME, out.replace(` id="${FURTHER_ID}"`, '')), /page ids changed/);
});

// The lab's working words (scripts/home-plain-language.test.mjs) are checked on the whole built home, these words included.
test('the new words are plain: no digit, no "every", one line each', () => {
  const words = [...FOLDS.map(f => f.summary), 'Go further', ...FURTHER.flatMap(f => [f.label, f.text])];
  for (const text of words) {
    assert.doesNotMatch(text, /\p{Nd}/u, text);
    assert.doesNotMatch(text, /\bevery\b/i, text);
  }
  assert.equal(new Set(FOLDS.map(f => f.summary)).size, FOLDS.length, 'each fold says what it holds');
});

test('the fold opener opens every fold around a linked target and reads the hash safely', () => {
  // A minimal tree: a target inside a fold inside another fold.
  const node = (tag, parent = null) => ({ tag, parentElement: parent, open: false, closest(sel) { for (let n = this; n; n = n.parentElement) if (n.tag === sel) return n; return null; } });
  const outer = node('details'), inner = node('details', node('div', outer)), target = node('div', inner);
  const document = { getElementById: id => (id === 'all-experiments' ? target : null) };
  assert.equal(openAround(document, 'all-experiments'), target);
  assert.ok(inner.open && outer.open, 'both folds are open');
  assert.equal(openAround(document, 'missing'), null);
  assert.equal(openAround(document, ''), null);
  assert.equal(idOf('#all-experiments'), 'all-experiments');
  assert.equal(idOf('#caf%C3%A9'), 'café');
  assert.equal(idOf('#%E0%A4%A'), '', 'a hash that cannot be decoded names nothing');
  assert.equal(idOf(''), '');
});

// The hero's dated correction (compactCorrection, wave 6), on the committed home's own block.
test('the home correction shows one dated line, opens to the whole correction, and keeps every word', async () => {
  const { readFileSync } = await import('node:fs');
  const { compactCorrection, CORRECTION_OPEN, CORRECTION_CLOSED } = await import('./home-shape.mjs');
  const source = readFileSync('site/index.html', 'utf8');
  const at = source.indexOf(CORRECTION_OPEN);
  const block = source.slice(at, source.indexOf('</details>', at) + '</details>'.length);
  assert.ok(at > source.indexOf('<p class="factory-boundary">'), 'the committed block sits in the hero, after its boundary line');
  const label = /^<details class="factory-correction" open><summary>([^]*?)<\/summary>/.exec(block)[1];
  const paragraphs = block.match(/<p>[^]*?<\/p>/g);
  assert.ok(paragraphs.length >= 2, 'the block carries its paragraphs');
  const out = compactCorrection(source);
  assert.ok(!out.includes(CORRECTION_OPEN), 'closed: one line until opened');
  assert.equal(out.split(CORRECTION_CLOSED).length, 2, 'exactly one correction');
  const start = out.indexOf(CORRECTION_CLOSED), shown = out.slice(start, out.indexOf('</details>', start) + '</details>'.length);
  // Outside the block nothing changed.
  assert.equal(out.slice(0, start), source.slice(0, at));
  assert.equal(out.slice(start + shown.length), source.slice(at + block.length));
  // The line: the block's own dates as written, oldest first, and what opening it gives.
  assert.ok(shown.startsWith(`${CORRECTION_CLOSED}<summary><span class="correction-summary">We corrected this page on <time datetime="2026-11-01">1 November 2026</time> and <time datetime="2026-11-02">2 November 2026</time>. What changed</span><span aria-hidden="true">+</span></summary>`));
  // Opened: the earlier label first, then every paragraph byte for byte, in order.
  assert.equal(shown, `${CORRECTION_CLOSED}${shown.slice(CORRECTION_CLOSED.length, shown.indexOf('</summary>') + '</summary>'.length)}<p class="correction-label">${label}</p>${paragraphs.join('')}</details>`);
  assert.equal(block, `${CORRECTION_OPEN}<summary>${label}</summary>${paragraphs.join('')}</details>`, 'the committed block is exactly label and paragraphs');
  // It stops on a page it does not expect.
  assert.throws(() => compactCorrection(out), /exactly one/);
  assert.throws(() => compactCorrection(source.replace(block, block + block)), /found 2/);
  assert.throws(() => compactCorrection(source.replace(block, block.replace(/<time datetime="[^"]+">([^<]*)<\/time>/g, '$1'))), /no dated <time>/);
  assert.throws(() => compactCorrection(source.replace(block, `${CORRECTION_OPEN}<summary>${label}</summary></details>`)), /no paragraph/);
});
