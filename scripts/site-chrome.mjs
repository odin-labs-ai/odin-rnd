// Site chrome (mission rnd-site-ux-nav-1101, WP3): navigation added to the finished pages in dist/ at build time, so
// no committed page, frozen record or pinned render changes. Three pieces:
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
  // GitHub Pages serves the missing-page file at whatever path was asked for, so a relative link on it would point
  // nowhere; its header carries the logo only (no navigation) and every link on it is absolute.
  ['404.html', 'served at any path; header has no navigation and only absolute links'],
]);

const TYPE_LABELS = { experiment: 'Experiment', lab: 'Lab', note: 'Field note', update: 'Update', tool: 'Tool' };

// Escapes text for HTML; a character reference already in the text (a title read from a page) is kept as it is.
const escape = value => String(value).replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
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
export function addFindLink(html, relPrefix, label = 'page') {
  if (/\d/.test(relPrefix) || !/^(?:\.\.\/)*$/.test(relPrefix)) throw new Error(`Find link prefix must be a run of ../ segments, got "${relPrefix}"`);
  const { start, end } = siteHeader(html, label);
  const header = html.slice(start, end);
  const navs = header.match(/<nav\b/g) || [];
  if (navs.length !== 1) throw new Error(`Expected exactly one navigation in the site header of ${label}, found ${navs.length}`);
  const navEnd = header.indexOf('</nav>');
  if (navEnd < 0) throw new Error(`Unclosed header navigation in ${label}`);
  const nav = header.slice(header.search(/<nav\b/), navEnd);
  if (/<a href="(?:\.\.\/)*find\/">Find<\/a>/.test(nav)) return html;
  const link = `<a href="${relPrefix}find/">Find</a>`;
  return html.slice(0, start) + header.slice(0, navEnd) + link + header.slice(navEnd) + html.slice(end);
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
  if (NUMBER_PROVENANCE_DIRS.some(dir => rel.startsWith(dir))) return null;
  if (/^journal\/[^/]+\.html$/.test(rel)) return 'note';
  if (/^labs\/[^/]+\/index\.html$/.test(rel)) return 'lab';
  if (/^projects\/[^/]+\/index\.html$/.test(rel)) return 'tool';
  return null;
}

/** The visible text of the page's first <h1>, else its <title> without the site suffix (character references kept). */
export function pageTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
  const raw = h1 ? h1[1] : (html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s+—\s+Odin R&amp;D\s*$/, '');
  return raw.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The breadcrumb trail for a page of class `kind` at `rel`, its links relative to the page. */
export function trailFor(kind, rel, title) {
  const up = '../'.repeat(rel.split('/').length - 1);
  const home = { label: 'Home', href: up || './' };
  if (kind === 'note') return [home, { label: 'Field notes', href: `${up}#journal` }, { label: title }];
  if (kind === 'lab') return [home, { label: 'Labs', href: `${up}labs/` }, { label: title }];
  if (kind === 'tool') return [home, { label: 'Tools', href: `${up}#projects` }, { label: title }];
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
  const counts = { pages: 0, find: 0, crumbs: 0, related: 0 };
  for (const file of htmlFiles(distDir).sort()) {
    const rel = toPosix(relative(distDir, file));
    const source = readFileSync(file, 'utf8');
    let html = source;
    counts.pages++;
    if (!FIND_EXEMPT.has(rel)) {
      html = addFindLink(html, '../'.repeat(rel.split('/').length - 1), rel);
      counts.find++;
    }
    const kind = pageClass(rel);
    if (kind) {
      const self = byKey.get(pageKey(rel));
      html = addBreadcrumbs(html, trailFor(kind, rel, self?.title || pageTitle(html)), rel);
      counts.crumbs++;
      const related = pickRelated(items, self).map(item => ({ type: item.type, title: item.title, href: relativeHref(rel, item.href) }));
      if (related.length) { html = addRelated(html, related, rel); counts.related++; }
    }
    if (html !== source) writeFileSync(file, html);
  }
  return counts;
}
