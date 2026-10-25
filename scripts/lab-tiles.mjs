// Tiles on the Labs index for labs that are an experiment rather than a running space (mission rnd-labs-human-first-1024).
// Lab 03 (failover, EXP 021) is the first: site/data/labs/failover.json holds its words and links; scripts/labs.mjs
// renders the tile after Lab 01's. The build fails, and nothing is rendered, when:
//   - a tile listed in TILE_FILES is missing, or misses scripts/schemas/odin-lab-tile.schema.json;
//   - its words fail the publisher's screen, or its question, how or status carry a number (a tile states no result);
//   - a link is not an existing page or record of this site (site-relative, no dot segments);
//   - its status says "not yet run" while the experiment's results record (data/<experiment>/results.json) exists, or
//     the experiment has no published pre-registration (data/<experiment>/preregistration.json).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenTree } from './lab-dispatch-publish.mjs';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const TILE_FILES = ['data/labs/failover.json'];
const schema = JSON.parse(readFileSync(join(here, 'schemas/odin-lab-tile.schema.json'), 'utf8'));
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const isFile = path => existsSync(path) && statSync(path).isFile();

/** Every reason one tile may not be published (empty when it may). */
export function tileProblems(tile, root = 'site', where = 'tile') {
  const problems = validate(schema, tile).map(p => `${where}#${p} (does not match odin-lab-tile v1)`);
  if (problems.length) return problems;
  const { links, ...words } = tile;
  problems.push(...screenTree({ ...words, links: links.map(l => l.label) }, where));
  for (const key of ['question', 'how', 'status']) if (/\p{Nd}/u.test(tile[key])) problems.push(`${where}#/${key}: a tile carries no number`);
  for (const [i, { href }] of links.entries()) {
    if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)*\.(html|json)$/.test(href) || /(^|\/)\.\.?(\/|$)/.test(href)) problems.push(`${where}#/links/${i}/href: not a page or record path of this site`);
    else if (!isFile(join(root, href))) problems.push(`${where}#/links/${i}/href: ${href} is not on this site`);
  }
  if (!isFile(join(root, `data/${tile.experiment}/preregistration.json`))) problems.push(`${where}#/experiment: data/${tile.experiment}/preregistration.json is not published`);
  if (/not yet run/i.test(tile.status) && isFile(join(root, `data/${tile.experiment}/results.json`))) problems.push(`${where}#/status: says not yet run, but data/${tile.experiment}/results.json is published`);
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
