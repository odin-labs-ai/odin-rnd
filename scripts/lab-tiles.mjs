// Tiles on the Labs index for labs that are an experiment rather than a running space (mission rnd-labs-human-first-1024).
// Lab 03 (failover, EXP 021) is the first: site/data/labs/failover.json holds its words and links; scripts/labs.mjs
// renders the tile after Lab 01's. The build fails, and nothing is rendered, when:
//   - a tile listed in TILE_FILES is missing, or misses scripts/schemas/odin-lab-tile.schema.json;
//   - its words fail the publisher's screen, or its question, how or status carry a number (a tile states no result);
//   - a link is not an existing page or record of this site (site-relative, no dot segments);
//   - a pre-registered lab (kind absent or "preregistered"): its status says "not yet run" while the experiment's
//     results record (data/<experiment>/results.json) exists, or it has no published pre-registration
//     (data/<experiment>/preregistration.json);
//   - a results lab (kind "results", Lab 02 the first, its pre-registrations kept private and cited by commit and
//     sha256 in the record): its record or the record's sha256 pin is missing, the pin does not match the record's
//     bytes, or the tile does not link the record.
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// In index order: Lab 02 (a results lab; data/labs/brain-bench.json holds its page's words), then Lab 03, then Lab 05
// (a results lab; its record is data/labs/rogue/record.json, its page scripts/lab-rogue.mjs), then Lab 06 (a results
// lab; its record is data/labs/review/record.json, its page scripts/lab-review.mjs), then Lab 13 (a results lab; its
// record is data/labs/measured-blind/record.json, its page scripts/lab-measured-blind.mjs).
export const TILE_FILES = ['data/labs/brain-bench-tile.json', 'data/labs/failover.json', 'data/labs/rogue-tile.json', 'data/labs/review-tile.json', 'data/labs/measured-blind-tile.json'];
const schema = JSON.parse(readFileSync(join(here, 'schemas/odin-lab-tile.schema.json'), 'utf8'));
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const isFile = path => existsSync(path) && statSync(path).isFile();

/** Every reason one tile may not be published (empty when it may). */
export function tileProblems(tile, root = 'site', where = 'tile') {
  const problems = validate(schema, tile).map(p => `${where}#${p} (does not match odin-lab-tile v1)`);
  if (problems.length) return problems;
  // Links and the record are paths, checked as paths below; their labels and every other word are screened as text.
  const { links, record, ...words } = tile;
  problems.push(...screenTree({ ...words, links: links.map(l => l.label) }, where));
  for (const key of ['question', 'how', 'status']) if (/\p{Nd}/u.test(tile[key])) problems.push(`${where}#/${key}: a tile carries no number`);
  for (const [i, { href }] of links.entries()) {
    if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)*\.(html|json)$/.test(href) || /(^|\/)\.\.?(\/|$)/.test(href)) problems.push(`${where}#/links/${i}/href: not a page or record path of this site`);
    else if (!isFile(join(root, href))) problems.push(`${where}#/links/${i}/href: ${href} is not on this site`);
  }
  // The pairing kind "results" <-> record is enforced here, in plain code, not by a schema condition.
  if (tile.kind === 'results' && !tile.record) problems.push(`${where}#/record: a results lab (kind "results") must carry its record and pin`);
  if (tile.kind === 'results') return tile.record ? [...problems, ...resultsProblems(tile, root, where)] : problems;
  if (tile.record) problems.push(`${where}#/record: only a results lab (kind "results") carries a record`);
  if (!isFile(join(root, `data/${tile.experiment}/preregistration.json`))) problems.push(`${where}#/experiment: data/${tile.experiment}/preregistration.json is not published`);
  if (/not yet run/i.test(tile.status) && isFile(join(root, `data/${tile.experiment}/results.json`))) problems.push(`${where}#/status: says not yet run, but data/${tile.experiment}/results.json is published`);
  return problems;
}

// A results lab publishes its record and a one-line sha256 pin beside it ("<hex>  <record file name>\n"); the tile
// is refused unless both exist, the pin matches the record's bytes, and the tile links the record.
const PATH = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)*\.[a-z0-9]+$/;
// The record and its pin are read for their bytes, so neither they nor any folder on the way may be a symbolic link,
// and the real path must stay inside the real site root.
function insideSite(root, path) {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) if (lstatSync(join(root, ...parts.slice(0, i))).isSymbolicLink()) return false;
  const base = realpathSync(root);
  return realpathSync(join(root, path)).startsWith(base + sep);
}
function resultsProblems(tile, root, where) {
  const problems = [];
  const { href, pin } = tile.record;
  for (const [key, path, ext] of [['href', href, /\.json$/], ['pin', pin, /\.sha256$/]]) {
    if (!PATH.test(path) || /(^|\/)\.\.?(\/|$)/.test(path) || !ext.test(path)) problems.push(`${where}#/record/${key}: not a ${key === 'href' ? 'record (.json)' : 'pin (.sha256)'} path of this site`);
    else if (!isFile(join(root, path))) problems.push(`${where}#/record/${key}: ${path} is not on this site`);
    else if (!insideSite(root, path)) problems.push(`${where}#/record/${key}: ${path} is a link or resolves outside the site`);
    // A path is still screened for names and places, as the publisher screens an asset path.
    problems.push(...screenHits(path).filter(h => !h.reason.startsWith('a file path')).map(h => `${where}#/record/${key}: ${h.reason}`));
  }
  if (problems.length) return problems;
  const want = `${createHash('sha256').update(readFileSync(join(root, href))).digest('hex')}  ${href.split('/').at(-1)}\n`;
  if (readFileSync(join(root, pin), 'utf8') !== want) problems.push(`${where}#/record/pin: ${pin} does not pin the sha256 of ${href}`);
  if (!tile.links.some(l => l.href === href)) problems.push(`${where}#/links: the tile does not link its record ${href}`);
  if (/not yet run/i.test(tile.status)) problems.push(`${where}#/status: a results lab has run`);
  return problems;
}

/** The committed tiles, checked; the build throws on any problem. */
// The site this repository publishes. Its listed tiles are required; another site root (a test fixture) renders the
// tiles it carries unless the caller requires them too.
const REPO_SITE = resolve(here, '..', 'site');

export function readTiles(root = 'site', { required = resolve(root) === REPO_SITE } = {}) {
  const problems = [];
  // On the published site every listed tile is required: a missing file refuses the build, never a page without the lab.
  const tiles = TILE_FILES.map(file => {
    if (!isFile(join(root, file))) { if (required) problems.push(`${file}: missing (listed in TILE_FILES in scripts/lab-tiles.mjs)`); return null; }
    const tile = JSON.parse(readFileSync(join(root, file), 'utf8'));
    problems.push(...tileProblems(tile, root, file));
    return tile;
  }).filter(Boolean);
  if (problems.length) throw new Error(`Lab tiles refused:\n  ${problems.join('\n  ')}`);
  return tiles;
}

/** One tile: what the lab asks, its status, and links to its frozen records. `up` is the way from labs/ to the site root. */
export function renderTile(tile, up = '../') {
  const links = tile.links.map(l => `<li><a href="${up}${escape(l.href)}">${escape(l.label)}</a></li>`).join('');
  return `<article class="lab-tile lab-tile-static" aria-labelledby="lab-tile-${escape(tile.experiment)}"><span class="technical">${escape(tile.label.toUpperCase())}</span><h2 id="lab-tile-${escape(tile.experiment)}">${escape(tile.title)}</h2><p>${escape(tile.question)}</p><p>${escape(tile.how)}</p><p class="lab-tile-status">${escape(tile.status)}.</p><ul class="lab-tile-links">${links}</ul></article>`;
}
