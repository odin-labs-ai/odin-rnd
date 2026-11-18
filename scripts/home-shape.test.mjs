// The shaped home (scripts/home-shape.mjs), on synthetic pages: the order, the folds, what is kept and every refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { journalRows } from './experiment-ledger.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ADDED_IDS, assertCorrectionKept, assertKept, CHECK_HEADING, CHECK_ID, CHECK_INTRO, CHECK_TITLE_ID, CORRECTION_BLOCK, CORRECTION_LEAD, CORRECTION_OPEN, CORRECTION_PARAGRAPHS_SHA256, CORRECTION_SOURCE, FOLDS, FURTHER, FURTHER_ID, HOME_CSS, HOME_JS, idsOf, labelCorrection, ledgerOf, OPEN_ORDER, shapeHome } from './home-shape.mjs';
import { idOf, openAround } from '../site/assets/home-fold.mjs';

const LEDGER = '<div class="experiment-ledger" id="all-experiments"><h3 id="all-experiments-title">List.</h3><ol aria-labelledby="all-experiments-title"><li><a href="journal/a.html">EXP 004</a></li></ol></div>';
const row = n => `<a class="journal-row" href="journal/${n}.html"><div><h3>Note ${n}</h3><p>Text ${n}.</p></div></a>`;
const heading = (id, title) => `<div class="section-heading"><h2 id="${id}">${title}</h2><p>Intro.</p></div>`;
// The committed #floor's five parts, in order (scripts/home-shape.mjs splitFloor).
const FLOOR = {
  open: '<section class="hero cutaway dark-surface" id="floor" aria-labelledby="hero-title">',
  premise: '<div class="factory-premise"><h1 id="hero-title">Who we are</h1><div><p>We test.</p><a class="button button-primary premise-primary" href="#findings">See what we found</a></div></div>',
  drawing: '<div class="factory-drawing" data-view="floor"><div class="drawing-toolbar"><p>Open a step</p></div><div class="floor-art"></div></div>',
  stations: '<div class="station-compartment" aria-label="Selected experiment"><section class="nested"><p>Station.</p></section><p id="station-status"></p></div>',
  boundary: '<p class="factory-boundary">Four ways to check a result.</p>',
  correction: '<details class="factory-correction" open><summary>Wording clarification · <time datetime="2026-11-01">1 November 2026</time></summary><p>Earlier wording.</p></details>',
};
const floorOf = (parts = FLOOR) => `${parts.open}\n      ${parts.premise}\n      ${parts.drawing}\n      ${parts.stations}\n      ${parts.boundary}\n      ${parts.correction}\n    </section>`;
const SECTIONS = {
  floor: floorOf(),
  findings: `<section class="lab-launch content-section" id="findings" aria-labelledby="findings-title">${heading('findings-title', 'What we found')}<ol class="proof-strip"><li data-source="x">One</li></ol></section>`,
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
const SOURCE_ORDER = ['floor', 'findings', 'work-with-us', 'partner-tracks', 'agent-space', 'updates', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal', 'closing'];
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

test('the shaped home opens with the hero, what we found, how we check, the updates and the offer, then Go further, then the rest in source order', () => {
  const out = shapeHome(HOME);
  assert.deepEqual(OPEN_ORDER, ['floor', 'findings', CHECK_ID, 'updates', 'work-with-us']);
  assert.deepEqual(topOrder(out), [...OPEN_ORDER.slice(0, 2), 'nav', ...OPEN_ORDER.slice(2), 'partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal', 'closing']);
  assert.deepEqual(FOLDS.map(f => f.key), ['partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal']);
  // The updates feed moves with its two markers, which stay around it, right after the drawing's section.
  assert.match(out, /<p class="factory-boundary">[^<]*<\/p>\n {4}<\/section>\n {4}<!-- updates:[^>]*-->\n {4}<section class="updates-feed[^]*?<\/section>\n {4}<!-- \/updates -->\n {4}<section class="offer/);
  assert.ok(out.indexOf(`id="${CHECK_ID}"`) > out.indexOf('id="findings"') && out.indexOf(`id="${CHECK_ID}"`) < out.indexOf('<!-- updates:'), 'how we check sits between what we found and the updates');
  assert.equal(out.split('<!-- /updates -->').length, 2);
  // The open sections are byte for byte as they were.
  for (const key of ['findings', 'work-with-us', 'closing']) assert.ok(out.includes(SECTIONS[key]), key);
  // Go further, after the offer, links the lab on a page and the section pages, with the header's labels.
  const nav = out.slice(out.indexOf('<nav class="home-further'), out.indexOf('</nav>', out.indexOf('<nav class="home-further')));
  assert.deepEqual([...nav.matchAll(/href="([^"]*)"/g)].map(m => m[1]), ['labs/agent-space/#film-agent-space-30s', 'methods/', 'partners/']);
  assert.deepEqual([...nav.matchAll(/<span class="home-further-label">([^<]*)<\/span>/g)].map(m => m[1]), ['Watch the Agent Space', 'How we test', 'Work with the lab']);
  assert.match(nav, new RegExp(`aria-labelledby="${FURTHER_ID}"><h2 id="${FURTHER_ID}">Inside the lab</h2>`));
  assert.ok(out.indexOf('<nav class="home-further') > out.indexOf('id="findings"') && out.indexOf('<nav class="home-further') < out.indexOf('<details class="home-archive">'));
  // Only the home links its stylesheet and opener, once each, after the home's own.
  assert.ok(out.includes(`<link rel="stylesheet" href="assets/launch.css">\n  <link rel="stylesheet" href="${HOME_CSS}">`));
  assert.ok(out.includes(`<script type="module" src="assets/motion.mjs"></script>\n  <script type="module" src="${HOME_JS}"></script>`));
});

test('the hero keeps who we are, See what we found and the correction; the drawing moves under what we found, byte for byte', () => {
  const out = shapeHome(HOME);
  const i = '\n      ';
  // The hero: its own open tag, the premise, the correction (folded later by labelCorrection), nothing else.
  assert.ok(out.includes(`${FLOOR.open}${i}${FLOOR.premise}${i}${FLOOR.correction}\n    </section>\n    ${SECTIONS.findings}`), 'hero, then what we found');
  // The drawing's section: a plain heading and sentence, then the drawing, the stations and the boundary line as they were.
  const intro = `<div class="home-check-intro"><h2 id="${CHECK_TITLE_ID}">${CHECK_HEADING}</h2><p>${CHECK_INTRO}</p></div>`;
  assert.ok(out.includes(`<details class="home-archive"><summary>Explore the factory and earlier work</summary>\n    <section class="hero cutaway dark-surface home-check" id="${CHECK_ID}" aria-labelledby="${CHECK_TITLE_ID}">${i}${intro}${i}${FLOOR.drawing}${i}${FLOOR.stations}${i}${FLOOR.boundary}\n    </section>`), 'how we check, after what we found');
  assert.match(CHECK_INTRO, /^[A-Z][^.!?]*\.$/, 'one plain sentence');
  // Each part of the committed #floor appears exactly once.
  for (const [name, part] of Object.entries(FLOOR)) assert.equal(out.split(part).length, 2, name);
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
  assert.deepEqual(idsOf(out).filter(id => !ADDED_IDS.includes(id)).sort(), idsOf(HOME).sort());
  assert.deepEqual(idsOf(out).filter(id => !idsOf(HOME).includes(id)), ADDED_IDS);
  assert.ok(out.includes('<details class="journal-more"><summary>Show the earlier note</summary>'), 'the journal fold nests inside its section fold');
});

test('the shaped home refuses a page it does not expect', () => {
  const without = key => page(SOURCE_ORDER.filter(k => k !== key));
  const cases = [
    [shapeHome(HOME), /already shaped/],
    [without('findings'), /no section "findings" \(the proof strip\)/],
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
    [page(SOURCE_ORDER, { ...SECTIONS, floor: floorOf({ ...FLOOR, boundary: '<p class="other">Boundary.</p>' }) }), /#floor does not hold its boundary where expected/],
    [page(SOURCE_ORDER, { ...SECTIONS, floor: floorOf({ ...FLOOR, premise: FLOOR.drawing, drawing: FLOOR.premise }) }), /#floor does not hold its premise where expected/],
    [page(SOURCE_ORDER, { ...SECTIONS, floor: floorOf({ ...FLOOR, correction: `${FLOOR.correction}<p>Loose.</p>` }) }), /#floor holds more than/],
    [HOME.replace('<section class="closing">', `<section class="closing" id="${CHECK_ID}">`), /already shaped/],
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
  assert.throws(() => assertKept(HOME, out.replace(` id="${CHECK_TITLE_ID}"`, '')), /page ids changed/);
});

// The lab's working words (scripts/home-plain-language.test.mjs) are checked on the whole built home, these words included.
test('the new words are plain: no digit, no "every", one line each', () => {
  const words = [...FOLDS.map(f => f.summary), 'Inside the lab', ...FURTHER.flatMap(f => [f.label, f.text]), CHECK_HEADING, CHECK_INTRO, CORRECTION_LEAD, CORRECTION_OPEN];
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

// The hero's dated correction (labelCorrection: wave 6, folded on the plain-language home 2026-11-16), on the committed
// home's own block: one closed fold in place, its summary dating the correction in plain words, every word kept inside.
// The committed block, label and paragraphs, as #168 published it (213e1f1): a reword fails here.
const HOME_CORRECTION_SHA256 = '40aedf437370f2d7f8baf931867b62fb7dfd42046e69a46d66c9f08564db61be';

test('the home correction folds under a plain dated summary, in place, every word kept and in the HTML', () => {
  const source = readFileSync('site/index.html', 'utf8');
  const at = source.indexOf(CORRECTION_SOURCE);
  const block = source.slice(at, source.indexOf('</details>', at) + '</details>'.length);
  assert.ok(at > source.indexOf('<p class="factory-boundary">'), 'the committed block sits in the hero, after its boundary line');
  const label = /^<details class="factory-correction" open><summary>([^]*?)<\/summary>/.exec(block)[1];
  const paragraphs = block.match(/<p>[^]*?<\/p>/g);
  assert.ok(paragraphs.length >= 2, 'the block carries its paragraphs');
  assert.equal(block, `${CORRECTION_SOURCE}<summary>${label}</summary>${paragraphs.join('')}</details>`, 'the committed block is exactly label and paragraphs');
  assert.equal(createHash('sha256').update(block).digest('hex'), HOME_CORRECTION_SHA256, 'the committed correction is byte for byte what #168 published');
  assert.equal(createHash('sha256').update(paragraphs.join('')).digest('hex'), CORRECTION_PARAGRAPHS_SHA256, 'the build pins the same paragraphs');
  const out = labelCorrection(source);
  assert.ok(!out.includes(CORRECTION_SOURCE), 'no longer open by default');
  assert.equal(out.split('class="factory-correction').length, 2, 'exactly one correction');
  const start = out.indexOf(CORRECTION_BLOCK);
  const shown = out.slice(start, out.indexOf('</details>', start) + '</details>'.length);
  // In place: nothing outside the block changed.
  assert.equal(start, at);
  assert.equal(out.slice(start + shown.length), source.slice(at + block.length));
  // One closed fold: the summary says in plain words what was corrected and when, then "Read the correction"; inside,
  // #168's label line, then every paragraph byte for byte, in order.
  const summary = `<summary><span class="correction-when">${CORRECTION_LEAD}<time datetime="2026-11-01">1 November 2026</time> and <time datetime="2026-11-02">2 November 2026</time>.</span><span class="correction-open">${CORRECTION_OPEN}<span aria-hidden="true">+</span></span></summary>`;
  assert.equal(shown, `${CORRECTION_BLOCK}${summary}<p class="correction-label">${label}</p>${paragraphs.join('')}</details>`);
  assert.equal(CORRECTION_BLOCK, '<details class="factory-correction correction-fold">', 'closed, no open attribute');
  assert.equal(CORRECTION_LEAD, 'We corrected our earlier headline and wording on ');
  // It stops on a page it does not expect, a closed block included.
  assert.throws(() => labelCorrection(out), /expected exactly one open/);
  assert.throws(() => labelCorrection(source.replace(CORRECTION_SOURCE, '<details class="factory-correction">')), /expected exactly one open/);
  assert.throws(() => labelCorrection(source.replace(block, block + block)), /found 2/);
  assert.throws(() => labelCorrection(source.replace(block, block + block.replace(CORRECTION_SOURCE, '<details class="factory-correction">'))), /second, closed/);
  assert.throws(() => labelCorrection(source.replace(block, block.replace(/<time datetime="[^"]+">([^<]*)<\/time>/g, '$1'))), /no dated <time>/);
  assert.throws(() => labelCorrection(source.replace(block, `${CORRECTION_SOURCE}<summary>${label}</summary></details>`)), /anything but its paragraphs/);
  assert.throws(() => labelCorrection(source.replace(paragraphs[0], paragraphs[0].replace('</p>', ' More.</p>'))), /differ from the text #168 published/, 'a reword of the committed text stops the build');
  // The kept-check: only the block may change, in place, inside the hero, one fold with its dated summary.
  assert.doesNotThrow(() => assertCorrectionKept(source, out));
  assert.throws(() => assertCorrectionKept(source, out.replace(paragraphs[0], paragraphs[0].replace('</p>', ' More.</p>'))), /earlier label or its body changed/);
  assert.throws(() => assertCorrectionKept(source, out.replace(`<p class="correction-label">${label}</p>`, '<p class="correction-label"></p>')), /earlier label or its body changed/);
  assert.throws(() => assertCorrectionKept(source, out.replace(CORRECTION_LEAD, 'Updated on ')), /dated summary/);
  assert.throws(() => assertCorrectionKept(source, out.replace(' and <time datetime="2026-11-02">', ' and <b datetime="2026-11-02">')), /dated summary|outside the correction/);
  assert.throws(() => assertCorrectionKept(source, out.replace('Four ways to check a result', 'Five ways to check a result')), /outside the correction/);
  assert.throws(() => assertCorrectionKept(source, out.replace(CORRECTION_BLOCK, '<details class="factory-correction" open>')), /not where the correction was/);
  assert.throws(() => assertCorrectionKept(source, out.replace('<p class="correction-label">', '<details open><summary>x</summary></details><p class="correction-label">')), /one fold with one summary/);
  const moved = source.replace(block, '').replace('</main>', `<section class="moved">${block}</section></main>`);
  assert.throws(() => labelCorrection(moved), /inside the factory hero/);
});
