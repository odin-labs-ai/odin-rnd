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
 * The canonical destinations, in plain words (plain-language home, 2026-11-16; the founder found the site "too
 * technical" and "hard to navigate"): Start here, Findings, Labs, All results, Notes & updates, How we test, Work with
 * us. Find is not here: scripts/site-chrome.mjs appends it last. `path` is relative to the site root. `label` is the
 * text a reader sees; it is written HTML-escaped (labelHtml). Partners left the header for the footer (FOOTER_LINKS).
 */
export const DESTINATIONS = Object.freeze([
  { key: 'start', label: 'Start here', path: 'one-pager/' },
  { key: 'findings', label: 'Findings', path: '#findings' },
  { key: 'labs', label: 'Labs', path: 'labs/' },
  { key: 'experiments', label: 'All results', path: 'experiments/' },
  { key: 'notes', label: 'Notes & updates', path: 'journal/' },
  { key: 'methods', label: 'How we test', path: 'methods/' },
  // data-contact-opened: site/assets/activity.mjs counts a click on it as contact_opened.
  { key: 'work', label: 'Work with us', path: 'work-with-us/', attrs: ' data-contact-opened' },
  { key: 'tools', label: 'Tools', path: '#projects', outsideMenu: true },
]);

/**
 * The first edition's nav labels, each with the destination it led to (`target`, relative to the site root, as its href
 * ends) and what becomes of it here, so no link leaves a header unnamed. `to` is the DESTINATIONS key that now leads to
 * the same place, or null when the destination keeps no header link; `reason` says which and why. A retired label whose
 * href leads anywhere else stops the build: that link would be a destination this table does not account for.
 */
export const RETIRED_LABELS = new Map([
  ['The floor', { target: '#floor', to: null, reason: '#floor is still the top of the home (its hero), which the brand link leads to, and the factory drawing sits under what we found (#how-we-check); the header now leads to what we found (#findings) and to how we test (methods/)' }],
  ['Open source', { target: '#projects', to: 'tools', reason: 'renamed Tools and kept as a direct link to the home tools list at #projects' }],
  // Plain-language home, 2026-11-16 (founder: "too technical / jargon", "hard to navigate").
  ['Factory', { target: '#floor', to: null, reason: '"Factory" hid what the lab found; #floor is still the top of the home (its hero), which the brand link leads to, the factory drawing sits under what we found (#how-we-check), and the header now leads to what we found (#findings) and to how we test (methods/)' }],
  // Older pages led "Experiments" to the home's list (#experiments); it has led to experiments/ since wave 3.
  ['Experiments', { target: ['experiments/', '#experiments'], to: 'experiments', reason: 'renamed "All results": the same experiments page, with every experiment and where it stands' }],
  // Older pages led "Field notes" to the home's notes (#journal); it has led to journal/ since wave 3.
  ['Field notes', { target: ['journal/', '#journal'], to: 'notes', reason: 'renamed "Notes & updates": the same notes page, which links the updates feed' }],
  ['Updates', { target: 'updates/', to: 'notes', reason: 'folded into "Notes & updates" (journal/), so two dated feeds no longer sit side by side in the header; updates/ stays live at the same address, linked from the notes page and the home\'s latest updates' }],
  ['Partners', { target: 'partners/', to: null, reason: 'moved to the site footer of every page (FOOTER_LINKS); partners/ stays at the same address and is still linked from Work with us and the home\'s offer' }],
]);

/** A retired label's old targets as a list: a label may have led to a home section on old pages and to a page later. */
export const retiredTargets = retired => [].concat(retired.target);

/** Labels a nav may carry before this pass: the canonical ones, the retired ones, and Find. Anything else stops the build. */
export const KNOWN_LABELS = new Set([...DESTINATIONS.map(d => d.label), ...RETIRED_LABELS.keys(), 'Find']);

/** Every header link a built page shows, in order, as a reader sees them: the canonical destinations, then Find (which
 *  scripts/site-chrome.mjs appends last). The one list the built-page tests pin the header against. */
export const HEADER_LABELS = Object.freeze([...DESTINATIONS.map(d => d.label), 'Find']);

/** A label as HTML: & is the only character the labels need escaped. */
export const labelHtml = label => label.replaceAll('&', '&amp;');
/** A link's text as a reader sees it: the named entities &amp; &quot; &lt; &gt; &#39; and numeric references (&#38;,
 *  &#x26;) decoded in one pass, so a decoded "&" never starts a second decode ("&amp;lt;" reads "&lt;", not "<"). Any
 *  other entity stays as written and so is not a known label: the build stops (normaliseHeader), it never drops a link. */
const NAMED = { amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'" };
export const labelText = html => html.replace(/&(amp|quot|lt|gt|#39|#(\d{1,7})|#x([0-9a-f]{1,6}));/gi, (whole, name, dec, hex) => {
  const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
  if (code !== null) return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  return NAMED[name.toLowerCase()] ?? whole;
});

/** Pages left as they are, each with its reason. */
export const HEADER_EXEMPT = new Map();

const NAV_OPEN = '<nav aria-label="Main navigation">';
const MENU_OPEN = '<details class="site-menu"><summary>Menu</summary><div class="site-menu-links">';
const MENU_CLOSE = '</div></details>';
// A Find link as scripts/site-chrome.mjs writes it; on the Find page itself it carries aria-current="page".
const FIND = /^<a href="[^"]*find\/"(?: aria-current="page")?>Find<\/a>$/;

/** The section a built page (path relative to dist/, posix) belongs to: a DESTINATIONS key, or null (home, others). */
export function sectionFor(rel) {
  const path = String(rel).replace(/^\/+/, '');
  if (/^one-pager\//.test(path)) return 'start';
  if (/^experiments\//.test(path)) return 'experiments';
  // A record page (scripts/site-records.mjs) shows an experiment's published record: it belongs to All results.
  if (/^records\//.test(path)) return 'experiments';
  if (/^labs\//.test(path)) return 'labs';
  // The updates feed is reached through Notes & updates.
  if (/^updates\//.test(path)) return 'notes';
  if (/^journal\//.test(path)) return 'notes';
  if (/^methods\//.test(path)) return 'methods';
  if (/^work-with-us\//.test(path)) return 'work';
  // partners/ has no header link since 2026-11-16 (it is in the footer), so no header link is marked there.
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
  const link = d => `<a href="${relPrefix}${d.path}"${d.attrs ?? ''}${d.key === current ? ' aria-current="page"' : ''}>${labelHtml(d.label)}</a>`;
  const menu = DESTINATIONS.filter(d => !d.outsideMenu).map(link).join('');
  const direct = DESTINATIONS.filter(d => d.outsideMenu).map(link).join('');
  return `${NAV_OPEN}${MENU_OPEN}${menu}${MENU_CLOSE}${direct}</nav>`;
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
  // Accept our own native menu when normalising an already-built page.
  const content = nav.slice(NAV_OPEN.length, -'</nav>'.length);
  // Only the first MENU_CLOSE is taken out: a second '</div></details>' (a nested or doubled menu) is left in `rest` and
  // refused just below ("holds more than links"), so a malformed menu stops the build rather than being flattened.
  const flat = content.startsWith(MENU_OPEN) ? content.slice(MENU_OPEN.length).replace(MENU_CLOSE, '') : content;
  const rest = flat.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '');
  if (rest.trim()) throw new Error(`The header navigation of ${label} holds more than links: "${rest.trim().slice(0, 60)}"`);
  for (const [whole, html] of links) {
    const text = labelText(html);
    if (!KNOWN_LABELS.has(text)) throw new Error(`The header navigation of ${label} has a link "${text}" this pass does not know; add it to DESTINATIONS or RETIRED_LABELS`);
    const retired = RETIRED_LABELS.get(text);
    const href = whole.match(/\bhref="([^"]*)"/)?.[1] ?? '';
    // A page's link to itself ("./", the updates and partners pages' own) leads to a page the table names, which stays.
    const self = href === './' && retiredTargets(retired ?? { target: [] }).some(target => target.endsWith('/'));
    if (retired && !self && !retiredTargets(retired).some(target => href.endsWith(target))) throw new Error(`The header navigation of ${label} has "${text}" leading to "${href}", not ${retiredTargets(retired).join(' or ')} as RETIRED_LABELS records; this pass would drop a destination it does not account for`);
  }
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
    const html = addFooterLinks(normaliseHeader(source, { relPrefix, current: sectionFor(rel), label: rel }), { relPrefix, label: rel });
    if (html !== source) { writeFileSync(file, html); counts.changed++; }
  }
  return counts;
}

/**
 * Links that left the header for the site footer (plain-language home, 2026-11-16): Partners. Each is added once to the
 * link group of the page's site footer (its first <div>, or before </footer> when it has none), relative to the page.
 * A page with no site footer is left alone; one with more than one stops the build. No label or path holds a digit, so
 * the number-provenance pages may carry it. Idempotent.
 */
export const FOOTER_LINKS = Object.freeze([{ label: 'Partners', path: 'partners/' }]);

export function addFooterLinks(html, { relPrefix, label = 'page' } = {}) {
  checkPrefix(relPrefix);
  const opens = html.match(/<footer class="site-footer[ "]/g) || [];
  if (opens.length === 0) return html;
  if (opens.length > 1) throw new Error(`Expected at most one site footer in ${label}, found ${opens.length}`);
  const start = html.search(/<footer class="site-footer[ "]/);
  const end = html.indexOf('</footer>', start);
  if (end < 0) throw new Error(`Unclosed site footer in ${label}`);
  const footer = html.slice(start, end);
  const missing = FOOTER_LINKS.filter(l => !footer.includes(`href="${relPrefix}${l.path}">${labelHtml(l.label)}</a>`));
  if (!missing.length) return html;
  const links = missing.map(l => `<a href="${relPrefix}${l.path}">${labelHtml(l.label)}</a>`).join('');
  const div = footer.search(/<div\b/);
  const at = div >= 0 && footer.indexOf('</div>', div) >= 0 ? start + footer.indexOf('</div>', div) : end;
  return html.slice(0, at) + links + html.slice(at);
}
