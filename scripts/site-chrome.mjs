// Site chrome (mission rnd-site-ux-nav-1101, WP3): navigation added to the finished pages in dist/ at build time, so
// no committed page, frozen record or pinned render changes. Three pieces, styled by assets/chrome.css, which this
// pass links in every page's <head>:
//   - a Find link, last in the header's main navigation, on every page (its text and href carry no digit, so it may
//     go on the number-provenance pages too);
//   - a breadcrumb trail on field notes (journal/*.html), lab pages (labs/<slug>/) and tool pages (projects/<slug>/);
//   - a related aside of at most four links before the site footer on those same pages.
// Breadcrumbs and the related aside never go on the number-provenance pages (scripts/number-provenance.mjs PAGES):
// any digit there that is not a link to its record fails the build.
//
// Like the "Back to odin-labs.ai" pass in scripts/build.mjs, this fails closed: a page without exactly one site header,
// or a header without exactly one navigation, stops the build. Every function below is string in, string out, and
// idempotent; injectChrome is the only one that touches files. Links are relative to each file, so check.mjs's
// local-link validation sees the same targets the visitor follows.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Pages under dist/ where every visible number must link to its record: no breadcrumbs, no related aside there. */
export const NUMBER_PROVENANCE_DIRS = ['provider-economics/', 'evidence/', 'providers/', 'provider-brief/', 'partners/', 'one-pager/'];

/** Pages that keep the header without a Find link, each with its reason. */
export const FIND_EXEMPT = new Map([
  // GitHub Pages serves the missing-page file at whatever path was asked for, so every link on it is absolute: its own
  // header already carries an absolute Find link (site/404.html), and a relative one added here would repeat it.
  ['404.html', 'served at any path; its header carries its own absolute Find link'],
]);

/**
 * Note, lab and tool pages that have no item of their own in the site index, each with its reason. They get the
 * breadcrumb trail but no related aside (there is nothing to relate them by). Any other such page without an item
 * stops the build, so a new lab or tool page cannot silently go unindexed.
 */
export const CHROME_WITHOUT_ITEM = new Map([
  ['labs/runs/index.html', 'the list of every run of every lab: a page about the labs, not a lab, so it is not an index item'],
  ['labs/how-we-decide/index.html', 'the list of every frozen plan, veto, change and admitted gap across the labs: a page about the labs, not a lab'],
]);

/**
 * Index pages under journal/ and projects/, rendered at build time by scripts/site-sections.mjs, each with its reason.
 * They list notes and tools; they are not a note or a tool, so they get no item, no breadcrumbs from this pass (they
 * carry their own trail) and no related aside, and the completeness check in scripts/site-index.mjs passes them over.
 */
export const SECTION_INDEX_PAGES = new Map([
  ['journal/index.html', 'the list of every field note (scripts/site-sections.mjs): a page about the notes, not a note'],
  ['projects/index.html', 'the list of every tool page (scripts/site-sections.mjs): a page about the tools, not a tool'],
]);

/** The page the Find link leads to: on it, the link is marked as the current page. */
export const FIND_PAGE = 'find/index.html';

const TYPE_LABELS = { experiment: 'Experiment', lab: 'Lab', note: 'Field note', update: 'Update', tool: 'Tool' };

// Escapes plain text for HTML: all five of & < > " ', always. Every title this pass writes is plain text (the site
// index holds plain text; pageTitle decodes what it reads), so nothing here is ever already escaped.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ESCAPES[ch]);
const escape = escapeHtml;
const toPosix = path => path.split(sep).join('/');

/** The single site header of `html`: its start and end offsets. Throws unless there is exactly one. */
function siteHeader(html, label = 'page') {
  const opens = html.match(/<header class="site-header[ "]/g) || [];
  if (opens.length !== 1) throw new Error(`Expected exactly one site header in ${label}, found ${opens.length}`);
  const start = html.search(/<header class="site-header[ "]/);
  const end = html.indexOf('</header>', start);
  if (end < 0) throw new Error(`Unclosed site header in ${label}`);
  return { start, end };
}

/**
 * Appends `<a href="{relPrefix}find/">Find</a>` as the last link of the header's main navigation. `relPrefix` is the
 * way from the page's folder to the site root ('' at the root, '../' one level down). Idempotent.
 */
export function addFindLink(html, relPrefix, label = 'page', { current = false } = {}) {
  if (/\d/.test(relPrefix) || !/^(?:\.\.\/)*$/.test(relPrefix)) throw new Error(`Find link prefix must be a run of ../ segments, got "${relPrefix}"`);
  const { start, end } = siteHeader(html, label);
  const header = html.slice(start, end);
  const navs = header.match(/<nav\b/g) || [];
  if (navs.length !== 1) throw new Error(`Expected exactly one navigation in the site header of ${label}, found ${navs.length}`);
  const navEnd = header.indexOf('</nav>');
  if (navEnd < 0) throw new Error(`Unclosed header navigation in ${label}`);
  const navStart = header.search(/<nav\b/);
  const nav = header.slice(navStart, navEnd);
  const mark = current ? ' aria-current="page"' : '';
  // A Find link already there (this pass ran before, or scripts/site-header.mjs kept it) may carry attributes; on the
  // Find page itself it gains aria-current if it lacks it, and is otherwise left exactly as it is.
  const existing = nav.match(/<a href="(?:\.\.\/)*find\/"([^>]*)>Find<\/a>/);
  if (existing) {
    if (!current || /\baria-current=/.test(existing[1])) return html;
    const at = start + navStart + existing.index;
    const marked = existing[0].replace('>Find</a>', `${mark}>Find</a>`);
    return html.slice(0, at) + marked + html.slice(at + existing[0].length);
  }
  const link = `<a href="${relPrefix}find/"${mark}>Find</a>`;
  return html.slice(0, start) + header.slice(0, navEnd) + link + header.slice(navEnd) + html.slice(end);
}

/**
 * Links the chrome's stylesheet (assets/chrome.css) as the last thing in <head>, so it follows the page's own
 * stylesheets. `relPrefix` is the way from the page's folder to the site root, as for addFindLink. Idempotent.
 */
export function addChromeStylesheet(html, relPrefix, label = 'page') {
  if (!/^(?:\.\.\/)*$/.test(relPrefix)) throw new Error(`Chrome stylesheet prefix must be a run of ../ segments, got "${relPrefix}"`);
  if (/<link rel="stylesheet" href="(?:\.\.\/)*assets\/chrome\.css">/.test(html)) return html;
  const heads = html.match(/<\/head>/g) || [];
  if (heads.length !== 1) throw new Error(`Expected exactly one </head> in ${label}, found ${heads.length}`);
  return html.replace('</head>', `<link rel="stylesheet" href="${relPrefix}assets/chrome.css">\n</head>`);
}

/**
 * Inserts a breadcrumb trail at the top of <main>. `trail` is [{label, href?}, ...]; the last step is the page itself
 * (no href, marked aria-current). Idempotent: a page that already has a trail is returned unchanged.
 */
export function addBreadcrumbs(html, trail, label = 'page') {
  if (!Array.isArray(trail) || trail.length < 2) throw new Error(`A breadcrumb trail needs at least two steps (${label})`);
  if (html.includes('<nav class="crumbs"')) return html;
  const mains = html.match(/<main\b[^>]*>/g) || [];
  if (mains.length !== 1) throw new Error(`Expected exactly one <main> in ${label}, found ${mains.length}`);
  const steps = trail.map((step, i) => {
    const last = i === trail.length - 1;
    if (!last && !step.href) throw new Error(`Breadcrumb step "${step.label}" needs an href (${label})`);
    return last ? `<li aria-current="page">${escape(step.label)}</li>` : `<li><a href="${escape(step.href)}">${escape(step.label)}</a></li>`;
  }).join('');
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><ol>${steps}</ol></nav>`;
  const at = html.indexOf(mains[0]) + mains[0].length;
  return html.slice(0, at) + crumbs + html.slice(at);
}

/**
 * Inserts `<aside class="related">` with at most four links before the site footer. `related` is
 * [{type, title, href}, ...] with hrefs already relative to the page. Nothing is added for an empty list. Idempotent.
 */
export function addRelated(html, related, label = 'page') {
  if (!related.length || html.includes('<aside class="related"')) return html;
  const footers = html.match(/<footer class="site-footer/g) || [];
  if (footers.length !== 1) throw new Error(`Expected exactly one site footer in ${label}, found ${footers.length}`);
  const links = related.slice(0, 4).map(item =>
    `<li><a href="${escape(item.href)}"><span class="related-type">${escape(TYPE_LABELS[item.type] ?? item.type)}</span> <span class="related-title">${escape(item.title)}</span></a></li>`).join('');
  const aside = `<aside class="related" aria-label="Related"><h2 class="related-heading">Related</h2><ul class="related-list">${links}</ul></aside>\n`;
  const at = html.indexOf('<footer class="site-footer');
  return html.slice(0, at) + aside + html.slice(at);
}

/** An item href or page path as one comparable key: no fragment, no index.html, no trailing slash. */
export function pageKey(path) {
  return String(path).split('#')[0].replace(/(^|\/)index\.html$/, '$1').replace(/\/$/, '');
}

/**
 * Up to four items related to `self`: first those with the same id (another record of the same experiment), then
 * those sharing a topic; newest first within each group. Never `self` (by object or by page), never an item twice,
 * never an unrelated item.
 */
export function pickRelated(items, self, limit = 4) {
  if (!self) return [];
  const selfKey = pageKey(self.href);
  const selfTopics = new Set(self.topics ?? []);
  const tiered = [];
  for (const item of items) {
    if (item === self || pageKey(item.href) === selfKey) continue;
    const sameId = Boolean(self.id) && item.id === self.id;
    const sharedTopic = (item.topics ?? []).some(topic => selfTopics.has(topic));
    if (sameId || sharedTopic) tiered.push({ item, tier: sameId ? 0 : 1 });
  }
  tiered.sort((a, b) => a.tier - b.tier || String(b.item.date).localeCompare(String(a.item.date)));
  // One link per target: the best-placed item for an href wins.
  const seen = new Set();
  return tiered.map(({ item }) => item).filter(item => !seen.has(item.href) && seen.add(item.href)).slice(0, limit);
}

/** Which chrome a page (path relative to dist/, posix) gets beyond the Find link: 'note', 'lab', 'tool' or null. */
export function pageClass(rel) {
  if (NUMBER_PROVENANCE_DIRS.some(dir => rel.startsWith(dir)) || SECTION_INDEX_PAGES.has(rel)) return null;
  if (/^journal\/[^/]+\.html$/.test(rel)) return 'note';
  if (/^labs\/[^/]+\/index\.html$/.test(rel)) return 'lab';
  if (/^projects\/[^/]+\/index\.html$/.test(rel)) return 'tool';
  return null;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };

/**
 * The text of an HTML fragment: markup dropped in one forward pass (a "<" that opens a tag runs to the next ">"; any
 * other "<" is text), then character references decoded once. The result is plain text, to be escaped on output; it is
 * never treated as markup, so a fragment such as "<scr<script>ipt>" can only ever come out as visible text.
 */
export function fragmentText(fragment) {
  const source = String(fragment);
  let text = '';
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '<' && /[A-Za-z/!?]/.test(source[i + 1] ?? '')) {
      const close = source.indexOf('>', i + 1);
      if (close < 0) break; // an unclosed tag: nothing after it is text
      text += /^<br\b/i.test(source.slice(i, close + 1)) ? ' ' : '';
      i = close;
    } else text += source[i];
  }
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (ref, hex, dec, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? ref;
    const code = parseInt(hex ?? dec, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ref;
  }).replace(/\s+/g, ' ').trim();
}

/** The visible text of the page's first <h1>, else its <title> without the site suffix, as plain text. */
export function pageTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
  if (h1) return fragmentText(h1[1]);
  return fragmentText(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s+—\s+Odin R&D\s*$/, '');
}

/** The breadcrumb trail for a page of class `kind` at `rel`, its links relative to the page. */
export function trailFor(kind, rel, title) {
  const up = '../'.repeat(rel.split('/').length - 1);
  const home = { label: 'Home', href: up || './' };
  if (kind === 'note') return [home, { label: 'Field notes', href: `${up}journal/` }, { label: title }];
  if (kind === 'lab') return [home, { label: 'Labs', href: `${up}labs/` }, { label: title }];
  if (kind === 'tool') return [home, { label: 'Tools', href: `${up}projects/` }, { label: title }];
  throw new Error(`No breadcrumb trail for ${rel}`);
}

/** `href` (relative to the site root) as seen from the page `rel`, keeping a trailing slash and a fragment. */
export function relativeHref(rel, href) {
  const [path, fragment] = String(href).split('#');
  let out = path ? toPosix(relative(dirname(rel), path)) : '';
  if (path && !out) out = './';
  if (path.endsWith('/') && out && !out.endsWith('/')) out += '/';
  return fragment === undefined ? out : `${out}#${fragment}`;
}

const htmlFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? htmlFiles(join(directory, entry.name)) : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []);

/**
 * Adds the chrome to every page under `distDir`. `items` follows the site index contract
 * ({type, id, title, date, stage, outcome?, topics[], summary, href}, href relative to the site root). Returns counts.
 */
export function injectChrome({ distDir, items }) {
  if (!Array.isArray(items)) throw new Error('injectChrome needs the site index items');
  const byKey = new Map();
  for (const item of items) if (!byKey.has(pageKey(item.href))) byKey.set(pageKey(item.href), item);
  const counts = { pages: 0, stylesheet: 0, find: 0, crumbs: 0, related: 0 };
  for (const file of htmlFiles(distDir).sort()) {
    const rel = toPosix(relative(distDir, file));
    const source = readFileSync(file, 'utf8');
    let html = source;
    counts.pages++;
    const up = '../'.repeat(rel.split('/').length - 1);
    html = addChromeStylesheet(html, up, rel);
    counts.stylesheet++;
    if (!FIND_EXEMPT.has(rel)) {
      html = addFindLink(html, up, rel, { current: rel === FIND_PAGE });
      counts.find++;
    }
    const kind = pageClass(rel);
    if (kind) {
      // The page's own item: the one of its own kind (a note's page is also the href of the experiments and updates
      // that point at it, and those come first in the newest-first list), else any item at that page.
      const self = items.find(item => item.type === kind && pageKey(item.href) === pageKey(rel)) ?? byKey.get(pageKey(rel));
      if (!self && !CHROME_WITHOUT_ITEM.has(rel)) throw new Error(`Site chrome: ${rel} is a ${kind} page with no item in the site index (add it to the index, or to CHROME_WITHOUT_ITEM with a reason)`);
      // The last step names the page as the visitor sees it: its <h1> (else its <title>), else its item's title.
      html = addBreadcrumbs(html, trailFor(kind, rel, pageTitle(html) || self?.title), rel);
      counts.crumbs++;
      const related = (self ? pickRelated(items, self) : []).map(item => ({ type: item.type, title: item.title, href: relativeHref(rel, item.href) }));
      if (related.length) { html = addRelated(html, related, rel); counts.related++; }
    }
    if (html !== source) writeFileSync(file, html);
  }
  return counts;
}
