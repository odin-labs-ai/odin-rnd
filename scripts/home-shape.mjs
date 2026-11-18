// A shorter home page (mission rnd-site-ux-nav-1101, wave 5). The built home ran to about six thousand words in thirteen
// sections; a visitor met the factory, the latest updates, the lab's measured results and the offer only after scrolling
// past most of the rest. This pass reshapes the finished dist/index.html only, after foldJournal and every qualify step:
//   - the hero (#floor), what we've found (#findings, the lab's results), how we check a result (#how-we-check), the
//     latest updates (#updates) and the offer (#work-with-us) stay open, in that order (plain-language home,
//     2026-11-16: the findings moved up, under the hero's "See what we found" button; founder, on the PR 1 screenshot:
//     the drawing, the station panel and the long correction still came before the plain findings). The committed
//     #floor section is split in two: the hero keeps its premise, drawing, station panel and boundary line; the dated
//     correction moves, byte for byte, into a visible section under what we've found (splitFloor);
//   - a "Go further" navigation follows them, to the lab on a page, the experiments, the labs, the notes, Find and the
//     tools;
//   - every other section follows in its source order, its <section> (and id) and its heading block visible, the rest
//     of its content in a closed <details class="home-fold">. Nothing is removed: the folded content stays on the page
//     byte for byte, so the experiment ledger, the field-note rows and every reader of the built home find what they
//     found before. site/index.html is never edited.
// It stops the build on a page it does not expect: a missing, repeated or unknown top-level section, a heading block
// that is not where it should be, a page already shaped, or an outcome that changed the field-note rows, the ledger
// bytes or the page's ids (beyond the three this pass adds).
// A link into folded content (the experiment list, nina's tools entry) opens the folds around its target
// (site/assets/home-fold.mjs, linked from the home only).
// Honest limit: the fold shortens the page a visitor scrolls, not the words the page carries.
import { createHash } from 'node:crypto';
import { journalRows } from './experiment-ledger.mjs';

/** The stylesheet the shaped home links (and only the home). */
export const HOME_CSS = 'assets/home.css';
/** The script that opens the folds around a linked target (…/#all-experiments), on the shaped home only. */
export const HOME_JS = 'assets/home-fold.mjs';
/** The id of the "Go further" heading. */
export const FURTHER_ID = 'home-further-title';
/** The section for the correction under what we've found, and its heading's id. */
export const CHECK_ID = 'how-we-check';
export const CHECK_TITLE_ID = 'how-we-check-title';
/** The plain heading and one plain sentence connecting the drawing above to its dated correction. */
export const CHECK_HEADING = 'How to read the drawing';
export const CHECK_INTRO = 'The drawing above is a concept of separate checks we test; results do not pass through them in sequence.';
/** The ids this pass adds, in page order; no other id may appear or go. */
export const ADDED_IDS = [CHECK_ID, CHECK_TITLE_ID, FURTHER_ID];

/** The sections that stay open, in the order they are shown (CHECK_ID is split out of #floor, see splitFloor). */
export const OPEN_ORDER = ['floor', 'findings', CHECK_ID, 'updates', 'work-with-us'];

/** The folded sections, in source order: the class of the heading block that stays visible ('' for a bare <div>) and
 *  the words of the fold's summary. */
export const FOLDS = [
  { key: 'partner-tracks', head: 'section-heading', summary: 'Show the partner tracks' },
  { key: 'agent-space', head: 'agent-space-copy', summary: 'Watch the recorded session' },
  { key: 'how-it-works', head: 'section-heading', summary: 'Show how a change moves through the factory' },
  { key: 'experiments', head: 'section-heading', summary: 'Show the experiments and where each one stands' },
  { key: 'research-note', head: '', summary: 'Read the build note' },
  { key: 'projects', head: 'section-heading', summary: 'Show the tools' },
  { key: 'drawing-board', head: 'drawing-board-header', summary: 'Show the two products' },
  { key: 'journal', head: 'section-heading', summary: 'Show the latest field notes' },
];

/** The "Go further" destinations: site-relative href, link text and one plain line. The labels match the header's
 *  (scripts/site-header.mjs), so a link reads the same wherever it is. */
export const FURTHER = [
  { href: 'one-pager/', label: 'Start here', text: 'The lab on a page: what we do and what we found.' },
  { href: 'experiments/', label: 'All results', text: 'All our experiments, where each stands, and their data.' },
  { href: 'labs/', label: 'Labs', text: 'Our longer pieces of work, each with the record behind it.' },
  { href: 'journal/', label: 'Notes & updates', text: 'What we set out to test, what happened, what is still open.' },
  { href: 'find/', label: 'Find', text: 'Search the site by topic, by kind or by outcome.' },
  { href: 'projects/', label: 'Tools', text: 'Open-source tools you can take apart and build on.' },
];

/** Every top-level section the home is expected to carry, keyed by id or, without one, by its first class. */
const EXPECTED = ['floor', 'findings', 'work-with-us', 'partner-tracks', 'agent-space', 'updates', 'how-it-works', 'experiments', 'research-note', 'projects', 'drawing-board', 'journal', 'closing'];
const CLOSING = 'closing';
// Every expected section is shown exactly once: open, folded or the closing line.
if (JSON.stringify([...OPEN_ORDER.filter(key => key !== CHECK_ID), ...FOLDS.map(f => f.key), CLOSING].sort()) !== JSON.stringify([...EXPECTED].sort())) throw new Error('Home shape: OPEN_ORDER, FOLDS and the closing line do not cover the expected sections');
const UPDATES_OPEN = /<!-- updates:[^>]*-->\s*$/;
const UPDATES_CLOSE = /^\s*<!-- \/updates -->/;
const LEDGER_OPEN = '<div class="experiment-ledger" id="all-experiments">';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The "Go further" navigation. */
export function renderFurther() {
  const items = FURTHER.map(f => `<li><a href="${escape(f.href)}"><span class="home-further-label">${escape(f.label)}</span><span class="home-further-text">${escape(f.text)}</span></a></li>`).join('');
  return `<nav class="home-further content-section" aria-labelledby="${FURTHER_ID}"><h2 id="${FURTHER_ID}">Go further</h2><ul>${items}</ul></nav>`;
}

/** Every id="…" value in `html`, in page order. */
export const idsOf = html => [...html.matchAll(/\sid="([^"]*)"/g)].map(m => m[1]);

/** The experiment ledger's bytes, or null when the page has none. */
export function ledgerOf(html) {
  const at = html.indexOf(LEDGER_OPEN);
  if (at < 0) return null;
  const end = html.indexOf('</ol></div>', at);
  return end < 0 ? null : html.slice(at, end + '</ol></div>'.length);
}

/** Top-level <section> elements between `from` and `to`, each with its key and offsets, matched to its own close tag. */
function topSections(html, from, to) {
  const tags = /<\/?section\b[^>]*>/gi;
  tags.lastIndex = from;
  const found = [];
  let depth = 0, start = -1, open = '';
  for (let m; (m = tags.exec(html)) && m.index < to;) {
    if (m[0][1] === '/') {
      depth--;
      if (depth < 0) throw new Error('Home shape: a </section> without its <section> in <main>');
      if (depth === 0) found.push({ open, start, openEnd: start + open.length, closeAt: m.index, end: m.index + m[0].length });
    } else {
      if (depth === 0) { start = m.index; open = m[0]; }
      depth++;
    }
  }
  if (depth !== 0) throw new Error('Home shape: an unclosed <section> in <main>');
  return found.map(s => {
    const id = /\sid="([^"]*)"/.exec(s.open)?.[1];
    const cls = /\sclass="([^"]*)"/.exec(s.open)?.[1]?.split(/\s+/)[0];
    return { ...s, key: id ?? cls ?? '' };
  });
}

/** The end offset of the element that opens at `at`, matched to its own close tag (same tag name, nesting counted). */
function elementEnd(html, at) {
  const name = /^<([a-z][a-z0-9]*)/i.exec(html.slice(at))?.[1];
  if (!name) throw new Error('Home shape: no element where a heading block was expected');
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  tags.lastIndex = at;
  let depth = 0;
  for (let m; (m = tags.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`Home shape: the <${name}> heading block is never closed`);
}

/** One folded section: its open tag and heading block as they were, the rest in a closed <details>. */
function fold(html, section, { head, summary }) {
  const at = section.openEnd + (/^\s*/.exec(html.slice(section.openEnd))[0].length);
  const first = /^<div\b[^>]*>/.exec(html.slice(at))?.[0];
  const cls = first && (/\sclass="([^"]*)"/.exec(first)?.[1] ?? '');
  if (first === undefined || (head ? !cls.split(/\s+/).includes(head) : cls !== '')) {
    throw new Error(`Home shape: section ${section.key} does not open with its heading block (${head ? `<div class="${head}">` : 'a bare <div>'})`);
  }
  const headEnd = elementEnd(html, at);
  if (headEnd > section.closeAt) throw new Error(`Home shape: the heading block of ${section.key} runs past its section`);
  const body = html.slice(headEnd, section.closeAt);
  if (!body.trim()) throw new Error(`Home shape: section ${section.key} has nothing to fold`);
  return html.slice(section.start, headEnd) + `<details class="home-fold"><summary>${escape(summary)}<span aria-hidden="true">+</span></summary>` + body + '</details>' + html.slice(section.closeAt, section.end);
}

/** Throws unless `out` keeps what every reader of the built home `html` relies on: the same field-note rows, the
 *  experiment ledger byte for byte, and the same ids plus only the ones this pass adds (ADDED_IDS). */
export function assertKept(html, out) {
  if (JSON.stringify(journalRows(out)) !== JSON.stringify(journalRows(html))) throw new Error('Home shape: the field-note rows changed');
  const ledger = ledgerOf(html);
  if (ledger === null || ledgerOf(out) !== ledger) throw new Error('Home shape: the experiment ledger is missing or its bytes changed');
  const was = idsOf(html), now = idsOf(out);
  const added = now.filter(id => !was.includes(id));
  if (JSON.stringify([...was].sort()) !== JSON.stringify(now.filter(id => !ADDED_IDS.includes(id)).sort()) || JSON.stringify(added) !== JSON.stringify(ADDED_IDS)) {
    throw new Error('Home shape: the page ids changed (only the drawing section, its heading and the "Go further" heading ids may be added)');
  }
}

/** The children of the committed #floor, in order: the premise, the drawing, the station panel, the boundary line and
 *  the dated correction (each matched by its start tag). */
const FLOOR_PARTS = [
  ['premise', /^<div class="factory-premise">/],
  ['drawing', /^<div class="factory-drawing"[ >]/],
  ['stations', /^<div class="station-compartment"[ >]/],
  ['boundary', /^<p class="factory-boundary">/],
  ['correction', /^<details class="factory-correction"[ >]/],
];

/** The committed #floor split in two: the hero keeps its premise and drawing, while the correction moves to a
 *  visible section under the findings. Every source part is preserved byte for byte. */
export function splitFloor(html, section, indent) {
  const parts = {};
  let at = section.openEnd;
  for (const [name, open] of FLOOR_PARTS) {
    at += /^\s*/.exec(html.slice(at))[0].length;
    if (!open.test(html.slice(at, section.closeAt))) throw new Error(`Home shape: #floor does not hold its ${name} where expected`);
    const end = elementEnd(html, at);
    if (end > section.closeAt) throw new Error(`Home shape: the ${name} runs past #floor`);
    parts[name] = html.slice(at, end);
    at = end;
  }
  const tail = html.slice(at, section.closeAt);
  if (tail.trim()) throw new Error('Home shape: #floor holds more than its premise, drawing, stations, boundary line and correction');
  const inner = indent + '  ';
  const hero = html.slice(section.start, section.openEnd) + [parts.premise, parts.drawing, parts.stations, parts.boundary].map(p => inner + p).join('') + tail + '</section>';
  const intro = `<div class="home-check-intro"><h2 id="${CHECK_TITLE_ID}">${escape(CHECK_HEADING)}</h2><p>${escape(CHECK_INTRO)}</p></div>`;
  const check = `<section class="hero cutaway dark-surface home-check" id="${CHECK_ID}" aria-labelledby="${CHECK_TITLE_ID}">`
    + [intro, parts.correction].map(p => inner + p).join('') + tail + '</section>';
  return { hero, check };
}

/** The built home page, shaped (see the top of this file). Throws on any page it does not expect. */
export function shapeHome(html) {
  if (html.includes('class="home-fold"') || html.includes('class="home-further') || html.includes(` id="${CHECK_ID}"`) || html.includes(`href="${HOME_CSS}"`) || html.includes(`src="${HOME_JS}"`)) throw new Error('Home shape: the page is already shaped');
  const mainOpen = html.match(/<main\b[^>]*>/g) || [], mainClose = html.match(/<\/main>/g) || [];
  if (mainOpen.length !== 1 || mainClose.length !== 1) throw new Error(`Home shape: expected exactly one <main>, found ${mainOpen.length} open and ${mainClose.length} closing`);
  const from = html.indexOf(mainOpen[0]) + mainOpen[0].length, to = html.indexOf('</main>');
  const sections = topSections(html, from, to);
  const byKey = new Map();
  for (const s of sections) {
    if (!EXPECTED.includes(s.key)) throw new Error(`Home shape: unknown top-level section "${s.key}" in <main>; place it in scripts/home-shape.mjs`);
    if (byKey.has(s.key)) throw new Error(`Home shape: section "${s.key}" appears twice`);
    byKey.set(s.key, s);
  }
  for (const key of EXPECTED) if (!byKey.has(key)) throw new Error(`Home shape: the home has no section "${key}"${key === 'findings' ? ' (the proof strip)' : ''}`);
  // Only whitespace, and the updates feed's two markers around it, may sit between the sections.
  const first = sections[0], last = sections.at(-1);
  if (html.slice(from, first.start).trim() || html.slice(last.end, to).trim()) throw new Error('Home shape: content in <main> outside its sections');
  // The updates feed moves with the two comments scripts/updates.mjs writes around it.
  const updates = byKey.get('updates');
  const before = UPDATES_OPEN.exec(html.slice(0, updates.start)), after = UPDATES_CLOSE.exec(html.slice(updates.end));
  if (!before || !after) throw new Error('Home shape: the updates feed is not between its <!-- updates: --> and <!-- /updates --> markers');
  const updatesStart = updates.start - before[0].length, updatesEnd = updates.end + after[0].length;
  for (let i = 1; i < sections.length; i++) {
    let gap = html.slice(sections[i - 1].end, sections[i].start);
    if (sections[i].key === 'updates') gap = gap.replace(UPDATES_OPEN, '');
    if (sections[i - 1].key === 'updates') gap = gap.replace(UPDATES_CLOSE, '');
    if (gap.trim()) throw new Error(`Home shape: content between sections ${sections[i - 1].key} and ${sections[i].key}`);
  }
  const indent = /\n[ \t]*$/.exec(html.slice(from, first.start))?.[0] ?? '\n';
  const floor = splitFloor(html, byKey.get('floor'), indent);
  const piece = key => key === 'updates' ? html.slice(updatesStart, updatesEnd) : key === 'floor' ? floor.hero : key === CHECK_ID ? floor.check : html.slice(byKey.get(key).start, byKey.get(key).end);
  const parts = [...OPEN_ORDER.map(piece), renderFurther()];
  for (const f of FOLDS) parts.push(fold(html, byKey.get(f.key), f));
  parts.push(piece(CLOSING));
  let out = html.slice(0, first.start) + parts.join(indent) + html.slice(last.end);
  // The stylesheet after the home's own stylesheets, and the fold opener after its own scripts.
  const once = (needle, what) => { if (out.split(needle).length !== 2) throw new Error(`Home shape: the home does not carry ${what} exactly once`); };
  const launch = '<link rel="stylesheet" href="assets/launch.css">', motion = '<script type="module" src="assets/motion.mjs"></script>';
  once(launch, 'assets/launch.css'); once(motion, 'assets/motion.mjs');
  out = out.replace(launch, `${launch}\n  <link rel="stylesheet" href="${HOME_CSS}">`).replace(motion, `${motion}\n  <script type="module" src="${HOME_JS}"></script>`);
  assertKept(html, out);
  return out;
}

// #168's dated correction stays visible on the built home. The source is a frozen <details open> block; the build
// turns it into a noncollapsible notice in place, preserving the label and pinned paragraphs byte for byte.
/** The committed block's opening tag (site/index.html, frozen). */
export const CORRECTION_SOURCE = '<details class="factory-correction" open>';
/** The built block's opening tag: a visible, noncollapsible notice. */
export const CORRECTION_BLOCK = '<div class="factory-correction correction-note">';
/** The words of the notice heading around its dates. */
export const CORRECTION_LEAD = 'We corrected our earlier headline and wording on ';
/** sha256 of the correction's paragraphs as #168 published them (213e1f1). A reword stops the build; a new dated
 *  correction is a deliberate change of this pin. */
export const CORRECTION_PARAGRAPHS_SHA256 = '254ec433ef524686ad35e8963baaf879b2139eaefc87b4e549fa35f56dd4df29';

/** "a", "a and b", "a, b and c". */
const listed = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** True when `body` is one or more <p>…</p> back to back and nothing else (a plain scan, no backtracking). */
function onlyParagraphs(body) {
  let at = 0;
  while (at < body.length) {
    if (!body.startsWith('<p>', at)) return false;
    const end = body.indexOf('</p>', at);
    if (end < 0 || body.slice(at + 3, end).includes('<p')) return false;
    at = end + '</p>'.length;
  }
  return at > 0;
}

/** The committed correction at `at`: its label (the old summary's inner HTML) and its body (the paragraphs). */
function sourceParts(html, at) {
  const block = html.slice(at, elementEnd(html, at));
  const head = /^<details class="factory-correction" open><summary>([^]*?)<\/summary>/.exec(block);
  if (!head || !head[1].trim()) throw new Error('Home correction: the block does not open with its summary');
  const body = block.slice(head[0].length, -'</details>'.length);
  if (!onlyParagraphs(body)) throw new Error('Home correction: the block holds anything but its paragraphs');
  return { block, label: head[1], body };
}

/** The built home with its correction visible under a dated, plain heading (see above). Throws on a page it does not
 *  expect. */
export function labelCorrection(html) {
  const count = html.split(CORRECTION_SOURCE).length - 1;
  if (count !== 1) throw new Error(`Home correction: expected exactly one open ${CORRECTION_SOURCE}, found ${count}`);
  if (html.split('<details class="factory-correction"').length !== 2) throw new Error('Home correction: a second, closed correction block is on the page');
  if (html.includes(CORRECTION_BLOCK)) throw new Error('Home correction: the page already carries the built block');
  const at = html.indexOf(CORRECTION_SOURCE);
  const { block, label, body } = sourceParts(html, at);
  const seen = new Map();
  for (const m of block.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">[^<]+<\/time>/g)) if (!seen.has(m[1])) seen.set(m[1], m[0]);
  if (!seen.size) throw new Error('Home correction: the block carries no dated <time>');
  const when = listed([...seen.keys()].sort().map(day => seen.get(day)));
  const heading = `<p class="correction-when">${CORRECTION_LEAD}${when}.</p>`;
  const built = `${CORRECTION_BLOCK}${heading}<p class="correction-label">${label}</p>${body}</div>`;
  const out = html.slice(0, at) + built + html.slice(at + block.length);
  assertCorrectionKept(html, out);
  return out;
}

/** The factory hero's offsets in `html`: its <section … id="floor"> to its own close tag. */
function heroOf(html) {
  const open = /<section\b[^>]*\sid="floor"[^>]*>/.exec(html);
  if (!open) throw new Error('Home correction: the page has no factory hero (#floor)');
  return [open.index, elementEnd(html, open.index)];
}

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Throws unless `out` is `html` with only its correction rebuilt: the same bytes outside the block; one built block where
 *  the committed one was, inside the open check section on a shaped page, one noncollapsible notice that dates the correction in plain words;
 *  #168's label line and every byte of its paragraphs after it, which match the pinned hash. */
export function assertCorrectionKept(html, out) {
  const was = html.indexOf(CORRECTION_SOURCE), now = out.indexOf(CORRECTION_BLOCK);
  if (was < 0 || now !== was || out.split(CORRECTION_BLOCK).length !== 2) throw new Error('Home correction: the built block is not where the correction was');
  if (out.split('class="factory-correction').length !== 2) throw new Error('Home correction: a second correction block is on the page');
  const { block, label, body } = sourceParts(html, was);
  const nowEnd = elementEnd(out, now);
  if (out.slice(0, now) !== html.slice(0, was) || out.slice(nowEnd) !== html.slice(was + block.length)) throw new Error('Home correction: the page changed outside the correction');
  const [sectionStart, sectionEnd] = out.includes(` id="${CHECK_ID}"`) ? (() => {
    const open = new RegExp(`<section\\b[^>]*\\sid="${CHECK_ID}"[^>]*>`).exec(out);
    if (!open) throw new Error('Home correction: the page has no check section');
    return [open.index, elementEnd(out, open.index)];
  })() : heroOf(out);
  if (!(sectionStart < now && nowEnd < sectionEnd)) throw new Error('Home correction: the block is not inside the visible check section');
  const after = out.slice(now, nowEnd);
  if (/<details\b|<summary\b/.test(after)) throw new Error('Home correction: the notice can be closed');
  const dated = new RegExp(`^${escapeRe(CORRECTION_BLOCK)}<p class="correction-when">${escapeRe(CORRECTION_LEAD)}(?:<time datetime="\\d{4}-\\d{2}-\\d{2}">[^<]+</time>(?:, | and )?)+\\.</p><p class="correction-label">`).exec(after);
  if (!dated || after.slice(dated[0].length) !== `${label}</p>${body}</div>`) throw new Error('Home correction: its dated heading, its earlier label or its body changed');
  if (createHash('sha256').update(body).digest('hex') !== CORRECTION_PARAGRAPHS_SHA256) throw new Error('Home correction: its paragraphs differ from the text #168 published');
}
