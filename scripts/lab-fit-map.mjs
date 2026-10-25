// "Where each store fits" on the Labs page (mission rnd-labs-human-first-1024). The agent space's lab keeps a fit map
// (odin-fit-map v1) in its private repository: per scenario, which store fits Odin, filled only from an experiment's
// committed result, beside the predictions frozen before the run. scripts/vendor-fit-map.mjs turns it into
// site/data/labs/fit-map.json; this module checks that file and renders it; scripts/labs.mjs fills <!--LABS_FIT_MAP-->.
// The build fails, and nothing is rendered, on:
//   - a file that misses scripts/schemas/odin-fit-map-public.schema.json;
//   - a record whose digest is not the one taken when it was vendored (a hand edit anywhere: a cell, a prediction, the
//     provenance commit or sha256, the transform), or a transform that is not the labs' own names, titles and pages;
//   - a verdict word outside the five the fit map defines, or a verdict list that is not exactly those five;
//   - a filled cell without a result link, or a pending cell with one; a result or page link that is not a page of
//     this site (or a link into this lab's repository);
//   - free text that fails the publisher's screen (names, places, paths, links, personal data); commits and digests are
//     held to their shape instead and still screened for restricted names and places.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLabLink, screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FIT_MAP_FILE = 'data/labs/fit-map.json';
export const FIT_MAP_SCHEMA_FILE = join(here, 'schemas/odin-fit-map-public.schema.json');
export const VERDICT_WORDS = ['mongodb-fits', 'postgres-fits', 'both-fit', 'neither', 'invalid'];
const VERDICT_TEXT = { 'mongodb-fits': 'MongoDB fits', 'postgres-fits': 'PostgreSQL fits', 'both-fit': 'Both fit', neither: 'Neither fits', invalid: 'Invalid run' };
export const PREDICTORS = [['lab', 'The lab'], ['mongodbAdvocate', 'MongoDB’s advocate'], ['postgresAdvocate', 'PostgreSQL’s advocate']];

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const canonicalJson = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
/** The digest of the whole public record except the digest itself, taken when it is vendored and again at every build. */
export function recordDigest(record) {
  const { vendored: { recordSha256, ...vendored }, ...rest } = record;
  return createHash('sha256').update(canonicalJson({ ...rest, vendored })).digest('hex');
}

const nameOrPlace = (text, where) => screenHits(text).filter(hit => /^a (restricted|place) name/.test(hit.reason)).map(hit => `${where}: ${hit.reason}`);

/** A link the matrix may show: a page of this site (site-relative, no dot segments) that exists, or this lab's repository. */
function linkProblem(href, root) {
  if (/^https:/.test(href)) return isLabLink(href) ? null : 'a link outside this lab';
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)*\/?$/.test(href) || /(^|\/)\.\.?(\/|$)/.test(href)) return 'not a page path of this site';
  const target = join(root, href.endsWith('/') ? `${href}index.html` : href);
  return existsSync(target) ? null : `${href} is not a page of this site`;
}

/** Every reason the vendored fit map may not be published (empty when it may). */
export function fitMapProblems(record, root = 'site', where = FIT_MAP_FILE) {
  const problems = validate(JSON.parse(readFileSync(FIT_MAP_SCHEMA_FILE, 'utf8')), record).map(p => `${where}#${p} (does not match odin-fit-map public)`);
  if (problems.length) return problems;
  if (canonicalJson(record.verdictWords) !== canonicalJson(VERDICT_WORDS)) problems.push(`${where}#/verdictWords: not exactly ${VERDICT_WORDS.join(', ')}`);
  const digest = recordDigest(record);
  if (digest !== record.vendored.recordSha256) problems.push(`${where}: not the record that was vendored (sha256 ${digest}, vendored ${record.vendored.recordSha256}); re-vendor with scripts/vendor-fit-map.mjs`);
  if (record.vendored.transform.length !== record.labs.length) problems.push(`${where}#/vendored/transform: not one entry per lab`);
  for (const [i, t] of record.vendored.transform.entries()) {
    const lab = record.labs[i];
    if (lab && (t.as !== lab.lab || t.title !== lab.title || t.page !== lab.page)) problems.push(`${where}#/vendored/transform/${i}: not the name, title and page lab ${i} shows`);
  }
  const names = new Set();
  for (const [i, lab] of record.labs.entries()) {
    const at = `${where}#/labs/${i}`;
    if (names.has(lab.lab)) problems.push(`${at}/lab: ${lab.lab} twice`);
    names.add(lab.lab);
    if (lab.page !== null) { const why = linkProblem(lab.page, root); if (why) problems.push(`${at}/page: ${why}`); }
    for (const [j, cell] of lab.cells.entries()) {
      const c = `${at}/cells/${j}`;
      if (cell.verdict !== null && !VERDICT_WORDS.includes(cell.verdict)) problems.push(`${c}/verdict: ${JSON.stringify(cell.verdict)} is not a verdict word`);
      if (cell.verdict !== null && cell.result === null) problems.push(`${c}: a filled cell without a result link`);
      if (cell.verdict === null && cell.result !== null) problems.push(`${c}: a pending cell with a result link`);
      if (cell.result !== null) { const why = linkProblem(cell.result, root); if (why) problems.push(`${c}/result: ${why}`); }
    }
  }
  // Words are screened as page text; commits, digests and page paths are held to their shape above and below.
  const { vendored: { commit, sourceSha256, builtAtCommit, recordSha256, transform, reworded, ...vendoredWords }, labs, ...words } = record;
  problems.push(...screenTree({ ...words, vendored: vendoredWords }, where));
  // The transform names the source labs and this site's pages: names screened as text, each page as a page link.
  for (const [i, { page, ...names }] of transform.entries()) {
    problems.push(...screenTree(names, where, {}, `/vendored/transform/${i}`));
  }
  // A rewording records what it replaced by sha256 only; the replacement is page text and must be in its field.
  for (const [i, { fromSha256, ...rest }] of reworded.entries()) {
    problems.push(...screenTree(rest, where, {}, `/vendored/reworded/${i}`));
    if (!record[rest.field].includes(rest.to)) problems.push(`${where}#/vendored/reworded/${i}: ${rest.field} does not say ${rest.to}`);
  }
  for (const [i, { page, published, record: rec, cells, ...labWords }] of labs.entries()) {
    problems.push(...screenTree({ ...labWords, cells: cells.map(({ result, ...cell }) => cell) }, where, {}, `/labs/${i}`));
    for (const [k, v] of [['page', page], ['published', published && published.commit], ['record', rec.commit], ['record/sha256', rec.sha256]]) {
      if (typeof v === 'string') problems.push(...nameOrPlace(v, `${where}#/labs/${i}/${k}`));
    }
  }
  return problems;
}

/** The committed fit map, checked; the build throws on any problem. Null when no fit map is published yet. */
export function readFitMap(root = 'site') {
  if (!existsSync(join(root, FIT_MAP_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, FIT_MAP_FILE), 'utf8'));
  const problems = fitMapProblems(record, root);
  if (problems.length) throw new Error(`Fit map refused:\n  ${problems.join('\n  ')}`);
  return record;
}

/** The matrix: one table per lab, each scenario's verdict (or "Pending") beside its frozen predictions. `up` is the way to the site root. */
export function renderFitMap(record, up = '../') {
  if (!record) return '';
  const href = path => /^https:/.test(path) ? escape(path) : `${up}${escape(path)}`;
  const short = sha => `<code title="${escape(sha)}">${escape(sha.slice(0, 8))}</code>`;
  const tables = record.labs.map((lab, i) => {
    const title = lab.page ? `<a href="${href(lab.page)}">${escape(lab.lab)}: ${escape(lab.title)}</a>` : `${escape(lab.lab)}: ${escape(lab.title)}`;
    const recordLine = `${lab.record.kind === 'design' ? 'Design' : 'Pre-registration'} at commit ${short(lab.record.commit)}${lab.record.sha256 ? `, sha256 ${short(lab.record.sha256)}` : ''}${lab.published ? `; published here in pull request #${escape(lab.published.pr)}` : '; not yet published here'}.`;
    const rows = lab.cells.map(cell => {
      const verdict = cell.verdict === null ? '<span class="fit-pending">Pending</span>'
        : `<a class="fit-verdict" href="${href(cell.result)}">${escape(VERDICT_TEXT[cell.verdict])}</a>`;
      const said = PREDICTORS.filter(([key]) => cell.predictions[key]).map(([key, label]) => `<li><span>${escape(label)}:</span> ${escape(cell.predictions[key])}</li>`);
      const predictions = said.length ? `<ul class="fit-predictions">${said.join('')}</ul>` : '<span class="fit-none">None frozen yet</span>';
      return `<tr><th scope="row"><span class="technical">${escape(cell.scenario)}</span> ${escape(cell.what)}</th><td>${verdict}</td><td>${predictions}</td></tr>`;
    }).join('');
    return `<div class="fit-lab"><h3 id="fit-${i}">${title}</h3><p class="fit-stage">${lab.stage === 'design' || lab.stage === 'pre-registered' ? '' : `${escape(lab.stage.charAt(0).toUpperCase() + lab.stage.slice(1))}. `}${recordLine}</p><div class="fit-table-wrap"><table class="fit-table" aria-labelledby="fit-${i}"><thead><tr><th scope="col">Scenario</th><th scope="col">Verdict</th><th scope="col">Predictions, frozen before the run</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
  const filled = record.labs.flatMap(lab => lab.cells).filter(cell => cell.verdict !== null).length;
  const total = record.labs.flatMap(lab => lab.cells).length;
  return `<section class="company-section company-width" id="fit-map" aria-labelledby="fit-map-title"><div class="company-section-heading"><h2 id="fit-map-title">Where each store fits.</h2><p>Per scenario, not overall: there is no single winner. A verdict appears only when an experiment’s committed result says so; until then a cell says pending, and the predictions beside it are predictions, frozen before anything ran.</p></div><p class="fit-summary">${filled} of ${total} cells have a verdict.</p>${tables}<p class="fit-source">Vendored from the lab’s own fit map at commit ${short(record.vendored.commit)} (sha256 ${short(record.vendored.sourceSha256)}). ${escape(record.vendored.leftOut)}.</p></section>`;
}
