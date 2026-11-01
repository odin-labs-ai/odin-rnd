// The Find page's build step (mission rnd-site-ux-nav-1101, WP4). scripts/build.mjs calls placeFind() once the site is
// built: it writes the site index to dist/data/index.json (built here, never committed) and puts the no-JavaScript
// list of everything into dist/find/index.html at its <!--FIND_LIST--> marker. site/assets/find.mjs reads the same
// index and, when it can, replaces that list with the search form and its results.
//
// The list shows each item's title as a link, its stage (and curated outcome, when it has one) and its date in a
// <time>; summaries stay out of it, so the list repeats no measured sentence (scripts/provider-terms.mjs screens it
// like every page). Pure string functions, except placeFind, which writes the two files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIND_MARKER = '<!--FIND_LIST-->';
export const FIND_PAGE = 'find/index.html';
export const INDEX_FILE = 'data/index.json';

/** The groups of the static list, in page order, with their headings and their one-item labels. */
export const GROUPS = Object.freeze([
  ['experiment', 'Experiments'], ['lab', 'Labs'], ['note', 'Field notes'], ['update', 'Updates'], ['tool', 'Tools'],
]);

const STAGE_LABELS = { 'pre-registered': 'Pre-registered', results: 'Results', amendment: 'Amendment', erratum: 'Erratum', recorded: 'Recorded', measured: 'Measured', running: 'Running', note: 'Field note', tool: 'Tool' };
const OUTCOME_LABELS = { supported: 'supported', refuted: 'refuted', mixed: 'mixed' };

// Escapes text for HTML; a character reference already in the text (a title read from a page) is kept as it is.
const escape = value => String(value).replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** {id: label} from site/data/find-topics.json's topic list. */
export function topicLabels(topics) {
  const labels = {};
  for (const { id, label } of topics?.topics ?? []) {
    if (typeof id !== 'string' || typeof label !== 'string' || !label) throw new Error(`Find: topic ${JSON.stringify(id)} needs a label`);
    labels[id] = label;
  }
  return labels;
}

/** The JSON the Find page reads: the items as the site index gives them, and the topic labels. */
export function indexJson(items, labels) {
  return JSON.stringify({ items, topics: labels }) + '\n';
}

/** The static list, grouped by type in GROUPS order (items keep their order inside a group). Links are from find/. */
export function renderFindList(items) {
  const known = new Set(GROUPS.map(([type]) => type));
  const stray = items.find(item => !known.has(item.type));
  if (stray) throw new Error(`Find: item ${stray.id} has type "${stray.type}", which the list has no group for`);
  return GROUPS.map(([type, heading]) => {
    const group = items.filter(item => item.type === type);
    if (!group.length) return '';
    const rows = group.map(item => {
      const stage = STAGE_LABELS[item.stage] ?? item.stage;
      const outcome = OUTCOME_LABELS[item.outcome];
      return `<li><a href="../${escape(item.href)}">${escape(item.title)}</a><span>${escape(stage)}${outcome ? `, ${outcome}` : ''} <time datetime="${escape(item.date)}">${escape(item.date)}</time></span></li>`;
    }).join('\n');
    return `<h2 id="find-${type}">${heading}</h2>\n<ul class="find-static-list">\n${rows}\n</ul>`;
  }).filter(Boolean).join('\n');
}

/** `html` with the marker replaced by the list. Throws unless the marker is there exactly once. */
export function placeFindList(html, items) {
  const count = html.split(FIND_MARKER).length - 1;
  if (count !== 1) throw new Error(`Find: expected the ${FIND_MARKER} marker exactly once in ${FIND_PAGE}, found ${count}`);
  return html.replace(FIND_MARKER, () => renderFindList(items));
}

/** Writes dist/data/index.json and the Find page's static list. Returns the number of items. */
export function placeFind({ distDir, items, topics }) {
  mkdirSync(join(distDir, 'data'), { recursive: true });
  writeFileSync(join(distDir, INDEX_FILE), indexJson(items, topicLabels(topics)));
  const page = join(distDir, FIND_PAGE);
  writeFileSync(page, placeFindList(readFileSync(page, 'utf8'), items));
  return items.length;
}
