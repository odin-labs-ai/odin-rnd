// Section index pages (mission rnd-site-ux-nav-1101, wave 3; audit 2026-11-01 findings 1, 3, 15). The live site had no
// /journal/ or /projects/ page (both 404), and /experiments/ showed only the first four experiments. This module renders,
// from the site index items (scripts/site-index.mjs; the same items /find/ lists):
//   - journal/index.html: every field note, newest first, grouped by month;
//   - projects/index.html: every tool page, newest first;
//   - an "All experiments" section added to the built experiments/index.html, before the end of its <main> (the
//     page's workbenches, app.js and committed source stay as they are).
// The two pages are rendered wholly from code into dist/ (no template under site/, which build.mjs copies to dist/ as
// is), and site/journal/ gains no file, so every committed note stays exactly its generator's output.
//
// Nothing is authored per item: titles, summaries, dates, stages and curated outcomes all come from the index items. A
// note's kind label names the experiment(s) whose ledger entry links that note, else just "Field note". Every function is
// string in, string out; renderSectionPages is the only one that touches files. Neither page is a number-provenance page
// (scripts/number-provenance.mjs PAGES), so their dates read as on the updates page ("6 Nov 2026", in a <time> with
// the ISO day); were either page ever added to PAGES, its digits would have to follow that rule instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_ORIGIN, canonicalHeader } from './site-header.mjs';
import { escapeHtml } from './site-chrome.mjs';

export const JOURNAL_PAGE = 'journal/index.html';
export const PROJECTS_PAGE = 'projects/index.html';
export const EXPERIMENTS_PAGE = 'experiments/index.html';
/** The id of the section addAllExperiments adds (unused anywhere on the experiments page before it). */
export const ALL_EXPERIMENTS_ID = 'every-experiment';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAGE_WORDS = { 'pre-registered': 'Pre-registered', results: 'Results', recorded: 'Recorded', measured: 'Measured', amendment: 'Amendment', erratum: 'Erratum', running: 'Running', note: 'Field note', tool: 'Tool' };
const OUTCOME_WORDS = { supported: 'Supported', refuted: 'Refuted', mixed: 'Mixed' };

/** True only for a URL on this site: it starts with the literal SITE_ORIGIN (compared as a string, never as a pattern). */
export const isSiteUrl = url => typeof url === 'string' && url.startsWith(SITE_ORIGIN);

/** The canonical URL of a section page ('journal/index.html' -> SITE_ORIGIN + 'journal/'). */
export function canonicalUrl(page) {
  if (!/^[a-z-]+\/index\.html$/.test(page)) throw new Error(`Section pages: "${page}" is not a section index page`);
  const url = `${SITE_ORIGIN}${page.slice(0, -'index.html'.length)}`;
  if (!isSiteUrl(url)) throw new Error(`Section pages: ${url} is not on ${SITE_ORIGIN}`);
  return url;
}

/** Full HTML escape (all five of & < > " ', scripts/site-chrome.mjs): the index holds plain text, so every & is literal. */
export const escape = escapeHtml;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function day(date, where) {
  const m = DAY.exec(date ?? '');
  if (!m) throw new Error(`Section pages: ${where} has no date (${date})`);
  return { year: m[1], month: Number(m[2]) - 1, day: Number(m[3]) };
}
const timeTag = (date, where) => { const d = day(date, where); return `<time datetime="${date}">${d.day} ${SHORT[d.month]} ${d.year}</time>`; };
const newestFirst = (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
const pageKey = href => String(href).split('#')[0].replace(/(^|\/)index\.html$/, '$1').replace(/\/$/, '');

function ofType(items, type) {
  if (!Array.isArray(items)) throw new Error('Section pages need the site index items');
  return items.filter(i => i.type === type);
}

/** "EXP 007" from an experiment item's id "exp-007". */
export const experimentLabel = id => { const n = /^exp-(\d{3})$/.exec(id ?? '')?.[1]; if (!n) throw new Error(`Section pages: "${id}" is not an experiment id`); return `EXP ${n}`; };

/** The kind label of a note: "Field note", plus the experiment(s) whose ledger entry links it ("Field note · EXP 005"). */
export function noteKind(note, items) {
  const key = pageKey(note.href);
  const ids = ofType(items, 'experiment').filter(e => pageKey(e.href) === key).map(e => experimentLabel(e.id)).sort();
  return ids.length ? `Field note · ${ids.join(', ')}` : 'Field note';
}

/** One row in the updates-list style (site/assets/motion.css): date, kind, title, summary, the whole row a link. */
function row({ href, date, kind, title, summary, where }) {
  return `<li class="update-item" data-reveal><a href="${escape(href)}">${timeTag(date, where)}<span class="update-kind technical">${escape(kind.toUpperCase())}</span><span class="update-title">${escape(title)}</span><span class="update-text">${escape(summary)}</span></a></li>`;
}

/** Rows grouped under one heading per month, newest month first, as on the updates page. */
function byMonth(rows) {
  const groups = new Map();
  for (const r of rows) {
    const d = day(r.date, r.where);
    const key = `${d.year}-${String(d.month + 1).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, { name: `${MONTHS[d.month]} ${d.year}`, rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([, g]) =>
    `<section class="update-month" aria-label="${g.name}"><h2 class="technical">${g.name.toUpperCase()}</h2><ol class="update-list">${g.rows.map(row).join('')}</ol></section>`).join('');
}

const footer = up => `<footer class="site-footer"><a class="footer-brand" href="${up}" aria-label="Odin Labs R&amp;D home"><img src="${up}assets/odin-logo.svg" width="29" height="32" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><div><a href="https://odin-labs.ai/contact/">Contact Odin</a><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a></div></footer>`;

/**
 * A whole section page, in the updates page's shell: its head (title, description, canonical), the canonical header,
 * a breadcrumb trail (so scripts/site-chrome.mjs, whose addBreadcrumbs is idempotent on a trail, adds none of its own),
 * a hero and the list.
 */
function sectionPage({ path, current, crumb, title, heading, description, lead, actions, listLabel, list }) {
  const up = '../';
  const canonical = canonicalUrl(path);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#102b22">
  <title>${escape(title)} — Odin R&amp;D</title>
  <meta name="description" content="${escape(description)}">
  <meta property="og:title" content="${escape(title)} — Odin R&amp;D">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="${up}assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="${up}assets/fonts/SpaceGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${up}assets/style.css">
  <link rel="stylesheet" href="${up}assets/company.css">
  <link rel="stylesheet" href="${up}assets/motion.css">
  <script type="module" src="${up}assets/motion.mjs"></script>
</head>
<body class="company-page">
  <a class="skip" href="#main">Skip to content</a>
  ${canonicalHeader(up, current)}
  <main id="main"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${up}">Home</a></li><li aria-current="page">${escape(crumb)}</li></ol></nav>
    <section class="company-hero company-width updates-hero" aria-labelledby="section-page-title">
      <div>
        <h1 id="section-page-title">${heading}</h1>
        <p class="company-lead">${escape(lead)}</p>
        <div class="company-actions">${actions}</div>
      </div>
    </section>
    <section class="company-section company-width updates-all" aria-label="${escape(listLabel)}">
      ${list}
    </section>
  </main>
  ${footer(up)}
</body>
</html>
`;
}

/** journal/index.html: every field note, newest first, grouped by month, each with its kind label. */
export function renderJournalIndex(items) {
  const notes = ofType(items, 'note').sort(newestFirst);
  if (!notes.length) throw new Error('Section pages: the site index has no field notes');
  const rows = notes.map(n => ({ href: `../${n.href}`, date: n.date, kind: noteKind(n, items), title: n.title, summary: n.summary, where: n.id }));
  return sectionPage({
    path: JOURNAL_PAGE, current: 'notes', crumb: 'Field notes', title: 'Field notes', heading: 'Field notes.',
    description: 'Odin R&D field notes: what we set out to test, what happened, and what is still open.',
    lead: 'A field note records one experiment or change: what we set out to test, what actually happened and what is still open. The latest is at the top.',
    actions: '<a class="button button-primary" href="../find/">Search everything</a><a href="../updates/">All updates</a><a href="../projects/">The tools</a>',
    listLabel: 'All field notes', list: byMonth(rows),
  });
}

/** projects/index.html: every tool page, newest first. */
export function renderProjectsIndex(items) {
  const tools = ofType(items, 'tool').sort(newestFirst);
  if (!tools.length) throw new Error('Section pages: the site index has no tools');
  const rows = tools.map(t => ({ href: `../${t.href}`, date: t.date, kind: 'Tool', title: t.title, summary: t.summary, where: t.id }));
  return sectionPage({
    path: PROJECTS_PAGE, current: null, crumb: 'Tools', title: 'Tools', heading: 'Tools you <br>can use.',
    description: 'The Odin R&D tools with a page of their own, each with what it does and how it was checked.',
    lead: 'The tools with a page of their own on this site, the latest at the top. More, including the engine itself, are in the tools list on the home page.',
    actions: '<a class="button button-primary" href="../find/">Search everything</a><a href="../#projects">The tools list on the home page</a><a href="../journal/">Field notes</a>',
    listLabel: 'All tools', list: `<ol class="update-list">${rows.map(row).join('')}</ol>`,
  });
}

/** The kind label of an experiment row: "EXP 007 · Results · Supported" (the outcome only where the index has one). */
export function experimentKind(item) {
  const stage = STAGE_WORDS[item.stage];
  if (!stage) throw new Error(`Section pages: ${item.id} has stage "${item.stage}", which has no label`);
  const outcome = item.outcome ? OUTCOME_WORDS[item.outcome] : null;
  if (item.outcome && !outcome) throw new Error(`Section pages: ${item.id} has outcome "${item.outcome}", which has no label`);
  return [experimentLabel(item.id), stage, outcome].filter(Boolean).join(' · ');
}

/**
 * Adds an "All experiments" section, every experiment newest number first, as the last thing in the page's single
 * <main> (before the site footer). `relPrefix` is the way from the page to the site root ('../' for experiments/).
 * Idempotent: a page that already has the section is returned unchanged.
 */
export function addAllExperiments(html, items, relPrefix, label = EXPERIMENTS_PAGE) {
  if (!/^(?:\.\.\/)*$/.test(relPrefix)) throw new Error(`All-experiments prefix must be a run of ../ segments, got "${relPrefix}"`);
  if (html.includes(`id="${ALL_EXPERIMENTS_ID}"`)) return html;
  const closes = html.match(/<\/main>/g) || [];
  if (closes.length !== 1) throw new Error(`Expected exactly one </main> in ${label}, found ${closes.length}`);
  const experiments = ofType(items, 'experiment').sort((a, b) => b.id.localeCompare(a.id));
  if (!experiments.length) throw new Error('Section pages: the site index has no experiments');
  const rows = experiments.map(e => row({ href: `${relPrefix}${e.href}`, date: e.date, kind: experimentKind(e), title: e.title, summary: e.summary, where: e.id })).join('');
  const section = `<section class="company-section company-width updates-all" id="${ALL_EXPERIMENTS_ID}" aria-labelledby="${ALL_EXPERIMENTS_ID}-title"><h2 id="${ALL_EXPERIMENTS_ID}-title">All experiments</h2><p class="company-lead">The experiments on this site by number, the latest at the top, each with its question, where it stands and the page that records it.</p><ol class="update-list">${rows}</ol></section>\n  `;
  return html.replace('</main>', `${section}</main>`);
}

/**
 * Writes journal/index.html and projects/index.html under `distDir` and adds the All experiments section to its
 * experiments page. Fails if either page already exists (a committed site/journal/index.html or site/projects/index.html
 * would be overwritten silently otherwise). Returns the paths it wrote.
 */
export function renderSectionPages({ distDir, items }) {
  const written = [];
  for (const [page, render] of [[JOURNAL_PAGE, renderJournalIndex], [PROJECTS_PAGE, renderProjectsIndex]]) {
    const file = join(distDir, page);
    let exists = false;
    try { readFileSync(file); exists = true; } catch { /* absent, as it should be */ }
    if (exists) throw new Error(`Section pages: ${page} already exists in ${distDir}; it is rendered here, not committed`);
    mkdirSync(join(distDir, page, '..'), { recursive: true });
    writeFileSync(file, render(items));
    written.push(page);
  }
  const experiments = join(distDir, EXPERIMENTS_PAGE);
  writeFileSync(experiments, addAllExperiments(readFileSync(experiments, 'utf8'), items, '../'));
  written.push(EXPERIMENTS_PAGE);
  return written;
}
