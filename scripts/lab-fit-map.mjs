// "Where each store fits" on the Labs page (mission rnd-labs-human-first-1024). The agent space's lab keeps a fit map
// (odin-fit-map v1) in its private repository: per scenario, which store fits Odin, filled only from an experiment's
// committed result, beside the predictions frozen before the run. scripts/vendor-fit-map.mjs turns it into
// site/data/labs/fit-map.json; this module checks that file and renders it; scripts/labs.mjs fills <!--LABS_FIT_MAP-->.
// The build fails, and nothing is rendered, on:
//   - a file that misses scripts/schemas/odin-fit-map-public.schema.json;
//   - a committed file whose bytes are not the ones pinned when it was vendored (scripts/fit-map.pin.json: the file's
//     sha256, the source commit and the source sha256). The pin is a second, separately reviewed file, so a hand edit of
//     the data has to change it too, in plain sight; what neither can prove is that the private source says what the
//     file says: only re-running the vendor on that source can;
//   - a transform that is not the labs' own names, titles and pages;
//   - a verdict word outside the five the fit map defines, or a verdict list that is not exactly those five;
//   - a filled cell without a result link, or a pending cell with one; a result link that is not the published results
//     record of the lab's own experiment; a page link that is not an HTML page of this site (or this lab's repository);
//   - a pin (scripts/fit-map.pin.json) whose data file is missing;
//   - free text that fails the publisher's screen (names, places, paths, links, personal data); commits and digests are
//     held to their shape instead and still screened for restricted names and places.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLabLink, screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { validate } from './json-schema-lite.mjs';
import { cite, readPinned, screenRecord, sidecarPinProblems, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FIT_MAP_FILE = 'data/labs/fit-map.json';
export const FIT_MAP_SCHEMA_FILE = join(here, 'schemas/odin-fit-map-public.schema.json');
export const VERDICT_WORDS = ['mongodb-fits', 'postgres-fits', 'both-fit', 'neither', 'invalid'];
const VERDICT_TEXT = { 'mongodb-fits': 'MongoDB fits', 'postgres-fits': 'PostgreSQL fits', 'both-fit': 'Both fit', neither: 'Neither fits', invalid: 'Invalid run' };
export const PREDICTORS = [['lab', 'The lab'], ['mongodbAdvocate', 'MongoDB’s advocate'], ['postgresAdvocate', 'PostgreSQL’s advocate']];

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const canonicalJson = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
export const FIT_MAP_PIN_FILE = join(here, 'fit-map.pin.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The pin the vendor writes beside the file: the file's own sha256 and the source it came from. */
export const pinFor = (fileBytes, record) => ({ format: 'odin-fit-map-pin', version: 1, file: `site/${FIT_MAP_FILE}`,
  fileSha256: sha256(fileBytes), commit: record.vendored.commit, sourceSha256: record.vendored.sourceSha256 });

/** Why the committed bytes are not the pinned ones (empty when they are). */
export function pinProblems(fileBytes, record, pin) {
  const want = pinFor(fileBytes, record);
  return Object.keys(want).filter(key => pin?.[key] !== want[key])
    .map(key => `${FIT_MAP_FILE}: ${key} is ${JSON.stringify(want[key])}, the pin in scripts/fit-map.pin.json says ${JSON.stringify(pin?.[key])}; re-vendor with scripts/vendor-fit-map.mjs --pin-out`);
}

const nameOrPlace = (text, where) => screenHits(text).filter(hit => /^a (restricted|place) name/.test(hit.reason)).map(hit => `${where}: ${hit.reason}`);

/**
 * A link the matrix may show: an HTML page of this site (site-relative, no dot segments; a directory path ending in "/"
 * whose index.html exists, or an existing .html file), or this lab's repository. A data file, a stylesheet or a bare
 * directory is not a page.
 */
function linkProblem(href, root) {
  if (/^https:/.test(href)) return isLabLink(href) ? null : 'a link outside this lab';
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)*\/?$/.test(href) || /(^|\/)\.\.?(\/|$)/.test(href)) return 'not a page path of this site';
  if (!href.endsWith('/') && !href.endsWith('.html')) return `${href} is not a page (a page ends in / or .html)`;
  const target = join(root, href.endsWith('/') ? `${href}index.html` : href);
  return existsSync(target) && statSync(target).isFile() ? null : `${href} is not a page of this site`;
}

/**
 * A verdict's link: the published results record of this lab's own experiment, data/<slug>/results.json, where the
 * lab's page is that experiment's pre-registration note, journal/<slug>-pre-registration.html. Any other page, even
 * one of this site, is not a result. The gate ties the verdict to that record; it does not read the verdict out of it.
 */
function resultProblem(href, lab, root) {
  const slug = /^data\/([a-z0-9-]+)\/results\.json$/.exec(href)?.[1];
  if (!slug) return `${href} is not an experiment's published results record (data/<slug>/results.json)`;
  if (lab.page !== `journal/${slug}-pre-registration.html`) return `${href} is not the results of this lab's own experiment (its page is ${lab.page ?? 'none'})`;
  return existsSync(join(root, href)) && statSync(join(root, href)).isFile() ? null : `${href} is not published on this site`;
}

/** Every reason the vendored fit map may not be published (empty when it may). */
export function fitMapProblems(record, root = 'site', where = FIT_MAP_FILE) {
  const problems = validate(JSON.parse(readFileSync(FIT_MAP_SCHEMA_FILE, 'utf8')), record).map(p => `${where}#${p} (does not match odin-fit-map public)`);
  if (problems.length) return problems;
  if (canonicalJson(record.verdictWords) !== canonicalJson(VERDICT_WORDS)) problems.push(`${where}#/verdictWords: not exactly ${VERDICT_WORDS.join(', ')}`);
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
      if (cell.result !== null) { const why = resultProblem(cell.result, lab, root); if (why) problems.push(`${c}/result: ${why}`); }
    }
  }
  // Words are screened as page text; commits, digests and page paths are held to their shape above and below.
  const { vendored: { commit, sourceSha256, builtAtCommit, transform, reworded, renamed, ...vendoredWords }, labs, ...words } = record;
  problems.push(...screenTree({ ...words, vendored: vendoredWords }, where));
  // The transform names the source labs and this site's pages: names screened as text, each page as a page link.
  for (const [i, { page, ...names }] of transform.entries()) {
    problems.push(...screenTree(names, where, {}, `/vendored/transform/${i}`));
  }
  for (const [i, r] of renamed.entries()) problems.push(...screenTree({ to: r.to }, where, {}, `/vendored/renamed/${i}`));
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
// The pin belongs to this repository's own site/; another site root (a test fixture) carries no pin unless given one.
const REPO_SITE = resolve(here, '..', 'site');

export function readFitMap(root = 'site', pinFile = resolve(root) === REPO_SITE ? FIT_MAP_PIN_FILE : null) {
  // No data and no pin: nothing is published yet. A pin without its data is a removal, and refuses like an edit.
  if (!existsSync(join(root, FIT_MAP_FILE))) {
    if (pinFile && existsSync(pinFile)) throw new Error(`Fit map refused:\n  ${FIT_MAP_FILE} is missing, but scripts/fit-map.pin.json pins it`);
    return null;
  }
  const bytes = readFileSync(join(root, FIT_MAP_FILE));
  const record = JSON.parse(bytes);
  const problems = [...fitMapProblems(record, root), ...pinProblems(bytes, record, pinFile && existsSync(pinFile) ? JSON.parse(readFileSync(pinFile, 'utf8')) : null)];
  if (problems.length) throw new Error(`Fit map refused:\n  ${problems.join('\n  ')}`);
  return record;
}

// One more line on a lab's row, from its own small record beside the fit map (the fit map itself is vendored from the
// lab's private fit map and pinned to it, so it is never edited by hand): Lab 04's frozen question set, by its counts
// and sha256s, with its pre-registration said to be not yet frozen. scripts/vendor-question-set.mjs writes the record;
// the build refuses it, every reason listed, when its bytes are not the pinned ones, it misses its schema or the kit's
// record contract, its categories do not add up to its questions, or a word fails the publisher's screen.
export const QUESTION_SET_RECORD = 'data/labs/company-store-questions/record.json';
export const QUESTION_SET_PIN = 'data/labs/company-store-questions/record.sha256';
const QUESTION_SET_SCHEMA = join(here, 'schemas/odin-lab-question-set.schema.json');

/** Every reason the question-set record may not be published (empty when it may). */
export function questionSetProblems(record, { now = new Date(), where = QUESTION_SET_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(QUESTION_SET_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-question-set v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where), ...vendoredProblems(record.vendored, { where, now }));
  const counts = Object.values(record.perCategory);
  if (counts.length !== record.categories) problems.push(`${where}#/categories: not the number of categories counted`);
  if (counts.reduce((a, b) => a + b, 0) !== record.questions) problems.push(`${where}#/questions: the categories do not add up to it`);
  for (const role of ['questions', 'gold', 'prereg']) if (!record.vendored.files.some(f => f.role === role)) problems.push(`${where}#/vendored/files: no ${role} file`);
  return problems;
}

/** The committed question-set record, pinned and checked; null when there is none. Throws with every reason. */
// On the published site the line is required, as the labs are: a missing record refuses the build.
export function readQuestionSet(root = 'site', { now = new Date(), required = resolve(root) === REPO_SITE } = {}) {
  if (required && !existsSync(join(root, QUESTION_SET_RECORD))) throw new Error(`Lab 04 question set refused:\n  ${QUESTION_SET_RECORD} is missing; Lab 04's row carries its frozen question set on the published site`);
  return readPinned({ root, file: QUESTION_SET_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: QUESTION_SET_PIN, file: QUESTION_SET_RECORD, vendor: 'scripts/vendor-question-set.mjs' }), check: record => questionSetProblems(record, { now }), refused: 'Lab 04 question set refused' });
}

/** The line on the lab's row: the frozen set by its counts and sha256s, cited the kit's way, and the draft said. */
export function questionSetLine(q) {
  const file = role => q.vendored.files.find(f => f.role === role).sha256;
  const [c] = q.vendored.cites;
  return `Its agent-query experiment has a frozen question set: ${escape(q.questions)} questions in ${escape(q.categories)} categories, sha256 ${short(file('questions'))}, with gold answers, sha256 ${short(file('gold'))}. ${cite(c, q.vendored.mainCheck)} Its pre-registration is ${escape(q.preregistration)}.`;
}
const short = sha => `<code title="${escape(sha)}">${escape(sha.slice(0, 8))}</code>`;

/** The matrix: one table per lab, each scenario's verdict (or "Pending") beside its frozen predictions. `up` is the way to the site root. */
export function renderFitMap(record, up = '../', { questions = null } = {}) {
  if (!record) return '';
  const href = path => /^https:/.test(path) ? escape(path) : `${up}${escape(path)}`;
  const tables = record.labs.map((lab, i) => {
    const title = lab.page ? `<a href="${href(lab.page)}">${escape(lab.lab)}: ${escape(lab.title)}</a>` : `${escape(lab.lab)}: ${escape(lab.title)}`;
    const recordLine = `${lab.record.kind === 'design' ? 'Design' : 'Pre-registration'} at commit ${short(lab.record.commit)}${lab.record.sha256 ? `, sha256 ${short(lab.record.sha256)}` : ''}${lab.published ? `; published here in pull request #${escape(lab.published.pr)}` : lab.page ? '' : '; not yet published here'}.`;
    const rows = lab.cells.map(cell => {
      const verdict = cell.verdict === null ? '<span class="fit-pending">Pending</span>'
        : `<a class="fit-verdict" href="${href(cell.result)}">${escape(VERDICT_TEXT[cell.verdict])}</a>`;
      const said = PREDICTORS.filter(([key]) => cell.predictions[key]).map(([key, label]) => `<li><span>${escape(label)}:</span> ${escape(cell.predictions[key])}</li>`);
      const predictions = said.length ? `<ul class="fit-predictions">${said.join('')}</ul>` : '<span class="fit-none">None frozen yet</span>';
      return `<tr><th scope="row"><span class="technical">${escape(cell.scenario)}</span> ${escape(cell.what)}</th><td>${verdict}</td><td>${predictions}</td></tr>`;
    }).join('');
    const extra = questions && questions.lab === lab.lab ? ` <span class="fit-questions">${questionSetLine(questions)}</span>` : '';
    return `<div class="fit-lab"><h3 id="fit-${i}">${title}</h3><p class="fit-stage">${lab.stage === 'design' || lab.stage === 'pre-registered' ? '' : `${escape(lab.stage.charAt(0).toUpperCase() + lab.stage.slice(1))}. `}${recordLine}${extra}</p><div class="fit-table-wrap"><table class="fit-table" aria-labelledby="fit-${i}"><thead><tr><th scope="col">Scenario</th><th scope="col">Verdict</th><th scope="col">Predictions, frozen before the run</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
  const filled = record.labs.flatMap(lab => lab.cells).filter(cell => cell.verdict !== null).length;
  const total = record.labs.flatMap(lab => lab.cells).length;
  return `<section class="company-section company-width" id="fit-map" aria-labelledby="fit-map-title"><div class="company-section-heading"><h2 id="fit-map-title">Where each store fits.</h2><p>Per scenario, not overall: there is no single winner. A verdict comes only from an experiment’s committed result in the lab’s own fit map, and shows here only with a link to that experiment’s results as published on this site; until then a cell says pending, and the predictions beside it are predictions, frozen before anything ran.</p></div><p class="fit-summary">${filled} of ${total} cells have a verdict.</p>${tables}<p class="fit-source">Vendored from the lab’s own fit map at commit ${short(record.vendored.commit)} (sha256 ${short(record.vendored.sourceSha256)}). ${escape(record.vendored.leftOut)}.</p></section>`;
}
