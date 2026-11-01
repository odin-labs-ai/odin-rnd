// Section index pages (scripts/site-sections.mjs, mission rnd-site-ux-nav-1101 wave 3): journal/ and projects/ rendered
// from the site index items, and the All experiments section on a copy of the real experiments page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { ALL_EXPERIMENTS_ID, EXPERIMENTS_PAGE, JOURNAL_PAGE, PROJECTS_PAGE, addAllExperiments, experimentKind, noteKind, renderJournalIndex, renderProjectsIndex, renderSectionPages } from './site-sections.mjs';
import { navSpan, normaliseHeader } from './site-header.mjs';
import { addBreadcrumbs, addChromeStylesheet, addFindLink, addRelated, pageClass, NUMBER_PROVENANCE_DIRS } from './site-chrome.mjs';
import { PAGES } from './number-provenance.mjs';

// Items in the site index contract, one note per committed field note (site/journal/*.html), dated a day apart so the
// month grouping spans several months; experiments and tools as the index has them.
const NOTE_SLUGS = readdirSync('site/journal').filter(n => n.endsWith('.html')).map(n => n.replace(/\.html$/, '')).sort();
const dayOf = i => new Date(Date.UTC(2026, 8, 1) + i * 3 * 86400000).toISOString().slice(0, 10);
const notes = NOTE_SLUGS.map((slug, i) => ({ type: 'note', id: `note-${slug}`, title: `Note ${slug} & <co>`, date: dayOf(i), stage: 'note', topics: ['t'], summary: `About ${slug}.`, href: `journal/${slug}.html` }));
const experiments = [
  { type: 'experiment', id: 'exp-005', title: 'Jev as a fast gate', date: '2026-09-29', stage: 'results', outcome: 'refuted', topics: ['t'], summary: 'Measured.', href: `journal/${NOTE_SLUGS[0]}.html` },
  { type: 'experiment', id: 'exp-006', title: 'Second', date: '2026-10-01', stage: 'pre-registered', topics: ['t'], summary: 'Planned.', href: `journal/${NOTE_SLUGS[0]}.html#plan` },
  { type: 'experiment', id: 'exp-010', title: 'From the repository', date: '2026-10-05', stage: 'recorded', topics: ['t'], summary: 'Recorded.', href: 'index.html#all-experiments' },
  { type: 'experiment', id: 'exp-001', title: 'Bench one', date: '2026-09-07', stage: 'recorded', topics: ['t'], summary: 'Recorded.', href: 'experiments/' },
];
const tools = readdirSync('site/projects', { withFileTypes: true }).filter(e => e.isDirectory()).map((e, i) => ({ type: 'tool', id: `tool-${e.name}`, title: `Tool ${e.name}`, date: dayOf(i), stage: 'tool', topics: ['t'], summary: 'A tool.', href: `projects/${e.name}/` }));
const ITEMS = [...notes, ...experiments, ...tools, { type: 'update', id: 'update-x', title: 'U', date: '2026-10-02', stage: 'note', topics: ['t'], summary: 'U.', href: `journal/${NOTE_SLUGS[1]}.html` }];

const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const rowHrefs = html => [...html.matchAll(/<li class="update-item" data-reveal><a href="([^"]+)">/g)].map(m => m[1]);
// A built page's local links resolve against the committed site (the section pages themselves are rendered here).
const resolves = (page, href) => {
  const path = href.split('#')[0];
  if (!path || /^https?:/.test(path)) return true;
  let target = posix.normalize(posix.join(posix.dirname(page), path));
  if (path.endsWith('/') || target === '.') target = posix.join(target, 'index.html');
  return [JOURNAL_PAGE, PROJECTS_PAGE].includes(target) || existsSync(join('site', target));
};

test('the journal index lists every field note exactly once, newest first, grouped by month', () => {
  const html = renderJournalIndex(ITEMS);
  const hrefs = rowHrefs(html);
  assert.deepEqual([...hrefs].sort(), NOTE_SLUGS.map(s => `../journal/${s}.html`).sort(), 'every note, nothing else');
  assert.equal(new Set(hrefs).size, hrefs.length, 'no note twice');
  const dates = [...html.matchAll(/<time datetime="([^"]+)">/g)].map(m => m[1]);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  const months = [...html.matchAll(/<section class="update-month" aria-label="([^"]+)">/g)].map(m => m[1]);
  assert.ok(months.length >= 3, 'several months');
  assert.equal(new Set(months).size, months.length, 'one heading per month');
  for (const m of html.matchAll(/<section class="update-month" aria-label="(\w+) (\d{4})">([\s\S]*?)<\/section>/g)) {
    const month = String(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(m[1]) + 1).padStart(2, '0');
    for (const [, d] of m[3].matchAll(/datetime="([^"]+)"/g)) assert.ok(d.startsWith(`${m[2]}-${month}-`), `${d} under ${m[1]} ${m[2]}`);
  }
});

test('a note\'s kind names the experiments whose ledger entry links it, from the items only', () => {
  assert.equal(noteKind(notes[0], ITEMS), 'Field note · EXP 005, EXP 006');
  assert.equal(noteKind(notes[2], ITEMS), 'Field note');
  assert.match(renderJournalIndex(ITEMS), /<span class="update-kind technical">FIELD NOTE · EXP 005, EXP 006<\/span>/);
  assert.equal(experimentKind(experiments[0]), 'EXP 005 · Results · Refuted');
  assert.equal(experimentKind(experiments[1]), 'EXP 006 · Pre-registered');
  assert.throws(() => experimentKind({ ...experiments[0], stage: 'guessed' }), /no label/);
});

test('the section pages are well formed: one header and nav, the right section current, unique ids, links that resolve', () => {
  for (const [page, html, current] of [[JOURNAL_PAGE, renderJournalIndex(ITEMS), 'Field notes'], [PROJECTS_PAGE, renderProjectsIndex(ITEMS), null]]) {
    assert.equal((html.match(/<header class="site-header[ "]/g) || []).length, 1, page);
    const { start, end } = navSpan(html, page);
    const nav = html.slice(start, end);
    assert.deepEqual([...nav.matchAll(/aria-current="page">([^<]*)</g)].map(m => m[1]), current ? [current] : [], page);
    assert.equal(normaliseHeader(html, { relPrefix: '../', current: current ? 'notes' : null }), html, `${page}: already canonical`);
    const all = ids(html);
    assert.equal(all.length, new Set(all).size, `${page}: unique ids`);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(resolves(page, href), `${page}: ${href} resolves`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://odin-labs-ai\\.github\\.io/odin-rnd/${page.replace('index.html', '')}">`));
    assert.match(html, /<title>[^<]+ — Odin R&amp;D<\/title>/);
    assert.match(html, /&amp; &lt;co&gt;|Tool /, `${page}: item text escaped`);
    assert.doesNotMatch(html, /<co>/, `${page}: no raw markup from an item`);
  }
  assert.deepEqual([...rowHrefs(renderProjectsIndex(ITEMS))].sort(), tools.map(t => `../${t.href}`).sort(), 'every tool once');
});

test('the site chrome leaves the section pages\' own trail alone and adds its Find link once, last', () => {
  for (const [page, html] of [[JOURNAL_PAGE, renderJournalIndex(ITEMS)], [PROJECTS_PAGE, renderProjectsIndex(ITEMS)]]) {
    const chromed = addRelated(addBreadcrumbs(addFindLink(addChromeStylesheet(html, '../', page), '../', page), [{ label: 'Home', href: '../' }, { label: 'X' }], page), [], page);
    assert.equal((chromed.match(/<nav class="crumbs"/g) || []).length, 1, `${page}: one trail`);
    const { start, end } = navSpan(chromed, page);
    const labels = [...chromed.slice(start, end).matchAll(/>([^<]+)<\/a>/g)].map(m => m[1]);
    assert.equal(labels.filter(l => l === 'Find').length, 1);
    assert.equal(labels.at(-1), 'Find');
  }
  // site-chrome exempts both by name (SECTION_INDEX_PAGES): a list of notes or tools is not a note or a tool, so it gets
  // no trail from the chrome (its own is the one), no related aside, and needs no index item of its own.
  assert.equal(pageClass(JOURNAL_PAGE), null);
  assert.equal(pageClass(PROJECTS_PAGE), null);
});

test('neither section page is under number provenance; their chrome carries no digit outside a <time>', () => {
  for (const page of [JOURNAL_PAGE, PROJECTS_PAGE]) {
    assert.ok(!PAGES.includes(page), `${page} is not a number-provenance page`);
    assert.ok(!NUMBER_PROVENANCE_DIRS.some(dir => page.startsWith(dir)), `${page} is not under a provenance dir`);
  }
  for (const html of [renderJournalIndex(ITEMS), renderProjectsIndex(ITEMS)]) {
    // Everything but the item rows and the month headings: head, header, trail, hero, footer.
    const chrome = html.replace(/<head>[\s\S]*<\/head>/, '').replace(/<section class="company-section[\s\S]*?<\/section>\s*<\/main>/, '</main>').replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(chrome, /\d/);
  }
  // Dates read as on the updates page ("6 Nov 2026"), each in a <time> with its ISO day.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const [, datetime, text] of renderJournalIndex(ITEMS).matchAll(/<time datetime="([^"]+)">([^<]*)<\/time>/g)) {
    const [y, m, d] = datetime.split('-');
    assert.equal(text, `${Number(d)} ${MON[Number(m) - 1]} ${y}`);
  }
});

test('the real experiments page gains one All experiments section, last in <main>, the rest byte for byte', () => {
  const page = readFileSync(join('site', EXPERIMENTS_PAGE), 'utf8');
  assert.ok(!page.includes(`id="${ALL_EXPERIMENTS_ID}`), 'the id is free on the page');
  const out = addAllExperiments(page, ITEMS, '../');
  assert.equal(addAllExperiments(out, ITEMS, '../'), out, 'idempotent');
  const at = out.indexOf(`<section class="company-section company-width updates-all" id="${ALL_EXPERIMENTS_ID}"`);
  const section = out.slice(at, out.indexOf('</main>'));
  assert.equal(out.slice(0, at), page.slice(0, page.indexOf('</main>')), 'before: unchanged');
  assert.equal(out.slice(out.indexOf('</main>')), page.slice(page.indexOf('</main>')), 'after: unchanged');
  assert.ok(out.indexOf('</main>') < out.indexOf('<footer class="site-footer'), 'before the footer');
  const hrefs = rowHrefs(section);
  assert.deepEqual(hrefs, ['../index.html#all-experiments', `../journal/${NOTE_SLUGS[0]}.html#plan`, `../journal/${NOTE_SLUGS[0]}.html`, '../experiments/'], 'every experiment once, newest number first');
  const kinds = [...section.matchAll(/update-kind technical">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(kinds, ['EXP 010 · RECORDED', 'EXP 006 · PRE-REGISTERED', 'EXP 005 · RESULTS · REFUTED', 'EXP 001 · RECORDED']);
  const all = ids(out);
  assert.equal(all.length, new Set(all).size, 'unique ids');
  for (const href of hrefs) assert.ok(resolves(EXPERIMENTS_PAGE, href), href);
  assert.throws(() => addAllExperiments('<main></main><main></main>', ITEMS, '../'), /exactly one <\/main>/);
  assert.throws(() => addAllExperiments(page, ITEMS, './'), /prefix/);
  assert.throws(() => addAllExperiments(page, notes, '../'), /no experiments/);
});

test('renderSectionPages writes both pages and the section into a built copy, and refuses to overwrite a page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-sections-'));
  try {
    mkdirSync(join(dir, 'experiments'), { recursive: true });
    cpSync(join('site', EXPERIMENTS_PAGE), join(dir, EXPERIMENTS_PAGE));
    assert.deepEqual(renderSectionPages({ distDir: dir, items: ITEMS }), [JOURNAL_PAGE, PROJECTS_PAGE, EXPERIMENTS_PAGE]);
    assert.equal(readFileSync(join(dir, JOURNAL_PAGE), 'utf8'), renderJournalIndex(ITEMS));
    assert.equal(readFileSync(join(dir, PROJECTS_PAGE), 'utf8'), renderProjectsIndex(ITEMS));
    assert.equal((readFileSync(join(dir, EXPERIMENTS_PAGE), 'utf8').match(new RegExp(`id="${ALL_EXPERIMENTS_ID}"`, 'g')) || []).length, 1);
    assert.throws(() => renderSectionPages({ distDir: dir, items: ITEMS }), /already exists/);
    assert.ok(!existsSync(join('site', JOURNAL_PAGE)) && !existsSync(join('site', PROJECTS_PAGE)), 'nothing committed under those paths');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an item without a date, or no items of a kind, stops the render', () => {
  assert.throws(() => renderJournalIndex([{ ...notes[0], date: 'soon' }]), /no date/);
  assert.throws(() => renderJournalIndex(tools), /no field notes/);
  assert.throws(() => renderProjectsIndex(notes), /no tools/);
  assert.throws(() => renderJournalIndex(undefined), /items/);
});
