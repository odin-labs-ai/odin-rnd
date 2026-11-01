// One header navigation for every built page (mission rnd-site-ux-nav-1101, wave 3; audit 2026-11-01 findings 1, 2, 3).
// The live site had eleven header variants: the field notes and tool pages still carried the first edition's nav ("The
// floor", "Open source", no Labs, Updates or Partners), and "Experiments" and "Field notes" led to sections of the home.
// This pass rewrites the header's main navigation on the finished pages in dist/ to one canonical list, so no committed
// page, frozen record or pinned render changes (site/journal/*.html stay byte for byte their generators' output).
//
// Only the <nav ...>...</nav> span inside the site header is replaced. The brand link, the "View source" link and the
// "Back to odin-labs.ai" link around it are left byte for byte. A Find link already in the nav (added by
// scripts/site-chrome.mjs, or the 404 page's own) is kept verbatim and moved last, so this pass and addFindLink can run
// in either order and each stays idempotent on the other's output.
//
// Fails closed, like the other header passes in scripts/build.mjs: a page without exactly one site header, a header
// without exactly one navigation, or a nav link whose label is not a known destination (so a destination added to one
// page later is never silently dropped) stops the build. No label or href here holds a digit or a number word, so the
// pass may run on the number-provenance pages (scripts/number-provenance.mjs PAGES) too.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The site's own origin: the only prefix besides a run of ../ that a header may use (the 404 page's absolute links). */
export const SITE_ORIGIN = 'https://odin-labs-ai.github.io/odin-rnd/';

/**
 * The canonical destinations, in the order of the newest header (labs/, the home): Factory, Experiments, Labs, Updates,
 * Field notes, Work with us, Partners. Find is not here: scripts/site-chrome.mjs appends it last. `path` is relative to
 * the site root. "Experiments" and "Field notes" lead to their own index pages (experiments/ with every experiment,
 * journal/ with every note), no longer to sections of the home.
 */
export const DESTINATIONS = Object.freeze([
  { key: 'factory', label: 'Factory', path: '#floor' },
  { key: 'experiments', label: 'Experiments', path: 'experiments/' },
  { key: 'labs', label: 'Labs', path: 'labs/' },
  { key: 'updates', label: 'Updates', path: 'updates/' },
  { key: 'notes', label: 'Field notes', path: 'journal/' },
  // data-contact-opened: site/assets/activity.mjs counts a click on it as contact_opened.
  { key: 'work', label: 'Work with us', path: 'work-with-us/', attrs: ' data-contact-opened' },
  { key: 'partners', label: 'Partners', path: 'partners/' },
]);

/** Labels a nav may carry before this pass: the canonical ones, the retired ones, and Find. Anything else stops the build. */
export const KNOWN_LABELS = new Set([...DESTINATIONS.map(d => d.label), 'The floor', 'Open source', 'Find']);

/** Pages left as they are, each with its reason. */
export const HEADER_EXEMPT = new Map();

const NAV_OPEN = '<nav aria-label="Main navigation">';
const FIND = /<a href="[^"]*find\/">Find<\/a>/;

/** The section a built page (path relative to dist/, posix) belongs to: a DESTINATIONS key, or null (home, others). */
export function sectionFor(rel) {
  const path = String(rel).replace(/^\/+/, '');
  if (/^experiments\//.test(path)) return 'experiments';
  if (/^labs\//.test(path)) return 'labs';
  if (/^updates\//.test(path)) return 'updates';
  if (/^journal\//.test(path)) return 'notes';
  if (/^work-with-us\//.test(path)) return 'work';
  if (/^partners\//.test(path)) return 'partners';
  return null;
}

function checkPrefix(relPrefix) {
  if (relPrefix === SITE_ORIGIN) return;
  if (typeof relPrefix !== 'string' || !/^(?:\.\.\/)*$/.test(relPrefix)) throw new Error(`Header prefix must be a run of ../ segments or ${SITE_ORIGIN}, got "${relPrefix}"`);
}

/** The canonical <nav> for a page whose way to the site root is `relPrefix`, `current` marked aria-current="page". */
export function canonicalNav(relPrefix, current = null) {
  checkPrefix(relPrefix);
  if (current !== null && !DESTINATIONS.some(d => d.key === current)) throw new Error(`Unknown header section "${current}"`);
  const links = DESTINATIONS.map(d => `<a href="${relPrefix}${d.path}"${d.attrs ?? ''}${d.key === current ? ' aria-current="page"' : ''}>${d.label}</a>`).join('');
  return `${NAV_OPEN}${links}</nav>`;
}

/** The whole site header for a page rendered from code (the section index pages), with the canonical nav. */
export function canonicalHeader(relPrefix, current = null) {
  return `<header class="site-header dark-surface">
    <a href="${relPrefix || './'}" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="${relPrefix}assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a>
    ${canonicalNav(relPrefix, current)}
    <a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source <span aria-hidden="true">↗</span></a>
  </header>`;
}

/** The nav span of the single site header: its offsets in `html`. Throws unless there is exactly one of each. */
export function navSpan(html, label = 'page') {
  const opens = html.match(/<header class="site-header[ "]/g) || [];
  if (opens.length !== 1) throw new Error(`Expected exactly one site header in ${label}, found ${opens.length}`);
  const start = html.search(/<header class="site-header[ "]/);
  const end = html.indexOf('</header>', start);
  if (end < 0) throw new Error(`Unclosed site header in ${label}`);
  const header = html.slice(start, end);
  const navs = header.match(/<nav\b/g) || [];
  if (navs.length !== 1) throw new Error(`Expected exactly one navigation in the site header of ${label}, found ${navs.length}`);
  const navStart = start + header.search(/<nav\b/);
  const close = html.indexOf('</nav>', navStart);
  if (close < 0 || close > end) throw new Error(`Unclosed header navigation in ${label}`);
  return { start: navStart, end: close + '</nav>'.length };
}

/**
 * Replaces the site header's main navigation with the canonical list. `relPrefix` is the way from the page's folder to
 * the site root ('' at the root, '../' one level down, or SITE_ORIGIN for the 404 page); `current` is the DESTINATIONS
 * key to mark aria-current="page", or null. A Find link already in the nav is kept, verbatim, last. Idempotent.
 */
export function normaliseHeader(html, { relPrefix, current = null, label = 'page' } = {}) {
  checkPrefix(relPrefix);
  const { start, end } = navSpan(html, label);
  const nav = html.slice(start, end);
  if (!nav.startsWith(NAV_OPEN)) throw new Error(`The header navigation of ${label} is not "${NAV_OPEN}"`);
  const links = [...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)];
  const rest = nav.slice(NAV_OPEN.length, -'</nav>'.length).replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '');
  if (rest.trim()) throw new Error(`The header navigation of ${label} holds more than links: "${rest.trim().slice(0, 60)}"`);
  for (const [, text] of links) if (!KNOWN_LABELS.has(text)) throw new Error(`The header navigation of ${label} has a link "${text}" this pass does not know; add it to DESTINATIONS or KNOWN_LABELS`);
  const finds = links.filter(([whole]) => FIND.test(whole)).map(([whole]) => whole);
  if (links.some(([, text]) => text === 'Find') && finds.length !== links.filter(([, text]) => text === 'Find').length) throw new Error(`A Find link in ${label} is not of the form <a href="...find/">Find</a>`);
  if (finds.length > 1) throw new Error(`The header navigation of ${label} has ${finds.length} Find links`);
  const canonical = canonicalNav(relPrefix, current);
  const next = finds.length ? canonical.replace('</nav>', `${finds[0]}</nav>`) : canonical;
  if (/\d/.test(next)) throw new Error(`The header navigation of ${label} would carry a digit`);
  return html.slice(0, start) + next + html.slice(end);
}

const toPosix = path => path.split(sep).join('/');
const htmlFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? htmlFiles(join(directory, entry.name)) : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []);

/**
 * Normalises the header of every page under `distDir`. The 404 page (GitHub Pages serves it at any path) uses the
 * absolute SITE_ORIGIN prefix, as its own links do. Returns counts.
 */
export function normaliseHeaders({ distDir }) {
  const counts = { pages: 0, changed: 0, exempt: 0 };
  for (const file of htmlFiles(distDir).sort()) {
    const rel = toPosix(relative(distDir, file));
    counts.pages++;
    if (HEADER_EXEMPT.has(rel)) { counts.exempt++; continue; }
    const relPrefix = rel === '404.html' ? SITE_ORIGIN : '../'.repeat(rel.split('/').length - 1);
    const source = readFileSync(file, 'utf8');
    const html = normaliseHeader(source, { relPrefix, current: sectionFor(rel), label: rel });
    if (html !== source) { writeFileSync(file, html); counts.changed++; }
  }
  return counts;
}
