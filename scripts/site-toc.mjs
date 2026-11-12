// "On this page" (mission rnd-site-ux-nav-1101, wave 4; audit 2026-11-01 findings 7 and 8). The longest pages on the
// site, /labs/agent-space/ and the long field notes (EXP 005's and EXP 006's run past 12,000 words), had no way to see
// or reach their sections. This pass adds, to the built page only, a table of contents listing the page's <h2>s:
//   - on a field note (journal/<slug>.html) or a lab page (labs/<slug>/index.html), as scripts/site-chrome.mjs pageClass
//     names them, never on a number-provenance page (pageClass names none there, so no digit is ever added to one);
//   - only when the page's main text runs past TOC_MIN_WORDS words and it has at least TOC_MIN_HEADINGS such headings.
//     The main text leaves out the site's own chrome inside <main>: the breadcrumbs, this table of contents and the
//     publication boundary note that scripts/build.mjs puts before </main> on every page AFTER this pass. Counting that
//     note would let a page just under the line at build time meet the criteria on the finished page without a table
//     of contents (odin-rnd #216: Lab 06's page, one record row longer, landed in that gap).
// It goes right after the page's own header: a note's <header class="article-header">, a lab's hero section. Each entry
// links the heading's own id; else, for a heading that opens a <section> with an id, that section's id (the heading
// itself is left byte for byte as its generator rendered it); else the heading gets an id from its text (slugified,
// unique on the page). An id already there is never changed. A heading inside a <details> is not listed (a link to it
// would land inside a closed fold).
//
// The nav holds the list twice: a <details> fold, closed, for narrow screens (its summary in the site's own disclosure
// style, style.css: the label, then an orange + that turns when open), and a plain list for wide ones; assets/
// chrome.css shows one of them. On a field note from 1100px wide the plain list sits in the right margin and stays in
// view while the note scrolls. Every function is string in, string out and idempotent; addTocs is the only one that
// touches files.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SECTION_INDEX_PAGES, escapeHtml, fragmentText, pageClass } from './site-chrome.mjs';

export const TOC_MIN_WORDS = 2000;
export const TOC_MIN_HEADINGS = 4;
export const TOC_LABEL = 'On this page';
const TOC_OPEN = '<nav class="toc';

const toPosix = path => path.split(sep).join('/');

/** The single <main>…</main> of a page: its offsets (start of the open tag, end of the close tag). Throws otherwise. */
function mainSpan(html, label) {
  const opens = html.match(/<main\b[^>]*>/g) || [];
  const closes = html.match(/<\/main>/g) || [];
  if (opens.length !== 1 || closes.length !== 1) throw new Error(`Table of contents: expected exactly one <main> in ${label}, found ${opens.length}`);
  const start = html.search(/<main\b/);
  return { start, end: html.indexOf('</main>') + '</main>'.length };
}

/** The words of the main text: no breadcrumb trail, no table of contents, no publication boundary note, no script, style or drawing. */
export function mainWords(html, label = 'page') {
  const { start, end } = mainSpan(html, label);
  const main = html.slice(start, end)
    .replace(/<nav class="(?:crumbs|toc)[^"]*"[\s\S]*?<\/nav>/g, ' ')
    .replace(/<aside id="publication-boundary"[^>]*>[\s\S]*?<\/aside>/g, ' ')
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, ' ');
  return fragmentText(main).split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Plain text → an id: lower case, letters and digits joined by single hyphens, accents dropped. */
export function slugify(text) {
  const slug = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return slug || 'section';
}

/**
 * Every <h2> inside <main> that is not inside a <details> or the table of contents, in order:
 * [{ start, end, open, attrs, inner, id, text }] with offsets into `html`. `id` is the heading's own id; else, when the
 * heading is the first element child of a <section> that has an id, that section's id (read from the tag structure:
 * text and comments between the two do not count, any other element does); else null.
 */
export function mainHeadings(html, label = 'page') {
  const { start, end } = mainSpan(html, label);
  const out = [];
  let depth = 0;
  let inToc = false;
  // The innermost <section id> whose first element child has not been seen yet.
  let openSection = null;
  const tags = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  tags.lastIndex = start;
  for (let m; (m = tags.exec(html)) && m.index < end;) {
    const [tag, close, rawName, attrs] = m;
    if (!rawName) continue; // a comment
    const name = rawName.toLowerCase();
    if (close) {
      if (name === 'details') depth -= 1;
      else if (name === 'nav') inToc = false;
      else if (name === 'section') openSection = null;
      continue;
    }
    const firstChildOf = openSection;
    openSection = name === 'section' ? (/\bid="([^"]+)"/.exec(attrs)?.[1] ?? null) : null;
    if (name === 'details') { depth += 1; continue; }
    if (name === 'nav') { if (/^\s+class="toc[ "]/.test(attrs)) inToc = true; continue; }
    if (name !== 'h2') continue;
    const closeAt = html.indexOf('</h2>', m.index);
    if (closeAt < 0 || closeAt > end) throw new Error(`Table of contents: unclosed <h2> in ${label}`);
    const inner = html.slice(m.index + tag.length, closeAt);
    tags.lastIndex = closeAt + '</h2>'.length;
    if (depth > 0 || inToc) continue;
    // A heading that opens a section with an id of its own (a generator's results or amendment section) is reached by
    // that id, so the heading's bytes stay exactly as rendered (tests elsewhere hold those sections byte for byte).
    out.push({ start: m.index, end: closeAt + '</h2>'.length, open: tag, attrs, inner, id: /\bid="([^"]*)"/.exec(attrs)?.[1] ?? firstChildOf, text: fragmentText(inner) });
  }
  return out;
}

/** Whether a page at `rel` (posix, relative to dist/) may carry a table of contents at all. */
export function tocCandidate(rel) {
  if (SECTION_INDEX_PAGES.has(rel)) return false;
  const kind = pageClass(rel);
  return kind === 'note' || kind === 'lab';
}

/** Where the table of contents goes: the offset right after the page's own header. Throws when there is none. */
function insertionPoint(html, kind, label) {
  if (kind === 'note') {
    const open = html.indexOf('<header class="article-header"');
    const close = open < 0 ? -1 : html.indexOf('</header>', open);
    if (close < 0) throw new Error(`Table of contents: no article header in ${label}`);
    return close + '</header>'.length;
  }
  const hero = /<section\b[^>]*\bclass="company-hero[ "]/.exec(html);
  const close = hero ? html.indexOf('</section>', hero.index) : -1;
  if (close < 0) throw new Error(`Table of contents: no hero section in ${label}`);
  return close + '</section>'.length;
}

/** The table of contents for `entries` ([{id, text}]): the fold for narrow screens, the plain list for wide ones. */
export function tocHtml(entries, kind) {
  const list = `<ol class="toc-list">${entries.map(e => `<li><a href="#${escapeHtml(e.id)}">${escapeHtml(e.text)}</a></li>`).join('')}</ol>`;
  const where = kind === 'lab' ? ' toc-lab company-width' : ' toc-note';
  return `<nav class="toc${where}" aria-label="${TOC_LABEL}"><details class="toc-fold"><summary>${TOC_LABEL}<span aria-hidden="true">+</span></summary>${list}</details><div class="toc-rail"><p class="toc-title">${TOC_LABEL}</p>${list}</div></nav>`;
}

/**
 * Adds the table of contents to one page when the criteria hold, else returns it unchanged. `rel` is the page's path
 * relative to dist/ (posix). Idempotent: a page that already has one is returned unchanged.
 */
export function addToc(html, rel, { minWords = TOC_MIN_WORDS, minHeadings = TOC_MIN_HEADINGS } = {}) {
  if (!tocCandidate(rel) || html.includes(TOC_OPEN)) return html;
  const headings = mainHeadings(html, rel);
  if (headings.length < minHeadings || mainWords(html, rel) <= minWords) return html;
  // Ids already on the page, read as scripts/check.mjs reads them (any id="…" anywhere), so a new one never repeats one.
  const taken = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const entries = headings.map(h => {
    if (!h.text) throw new Error(`Table of contents: an <h2> without text in ${rel}`);
    if (h.id) return { ...h, newId: null };
    const base = slugify(h.text);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return { ...h, id, newId: id };
  });
  // Ids first, from the last heading back, so earlier offsets stay valid; then the nav, which comes before them all.
  let out = html;
  for (const h of [...entries].reverse()) {
    if (!h.newId) continue;
    const open = h.open.replace(/^<h2\b/, `<h2 id="${h.newId}"`);
    out = out.slice(0, h.start) + open + out.slice(h.start + h.open.length);
  }
  const kind = pageClass(rel);
  const at = insertionPoint(out, kind, rel);
  if (at > entries[0].start) throw new Error(`Table of contents: the first listed heading of ${rel} comes before the page's header`);
  return out.slice(0, at) + tocHtml(entries, kind) + out.slice(at);
}

const htmlFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? htmlFiles(join(directory, entry.name)) : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []);

/** Adds a table of contents to every page under `distDir` that meets the criteria. Returns the pages it changed. */
export function addTocs({ distDir }) {
  const changed = [];
  for (const file of htmlFiles(distDir).sort()) {
    const rel = toPosix(relative(distDir, file));
    if (!tocCandidate(rel)) continue;
    const source = readFileSync(file, 'utf8');
    const html = addToc(source, rel);
    if (html !== source) { writeFileSync(file, html); changed.push(rel); }
  }
  return changed;
}
