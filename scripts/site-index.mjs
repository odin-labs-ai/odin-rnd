// The site index (mission rnd-site-ux-nav-1101, WP1): one item for every experiment, lab, field note, update and tool
// this site publishes, each with a date, a stage, its topics, a one-line summary and the page it links to. The Find page
// and the related-links aside read it as dist/data/index.json, written at build time and never committed.
//
// Nothing here is authored per item. Experiments come from the experiment ledger (scripts/experiment-ledger.mjs), labs
// from the Labs index's own lists (scripts/labs.mjs, scripts/lab-tiles.mjs), notes from site/journal/, updates from
// site/data/updates.json and tools from site/projects/. The only hand-curated words are the topic map
// (site/data/find-topics.json) and the outcomes (site/data/find-outcomes.json); an outcome is never inferred from text.
//
// buildIndex() is pure: it takes the already-read sources and returns the items, or throws on anything it cannot
// place (an item with no topic, an unknown topic word, an outcome whose phrase its status no longer states, an href
// that is not a file of the built site, a repeated id). loadIndex() reads the real sources from a built site.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ledgerEntries, textOf } from './experiment-ledger.mjs';
import { firstCommitDay } from './updates.mjs';
import { LAB_FILE } from './labs.mjs';
import { TILE_FILES } from './lab-tiles.mjs';

export const TOPICS_PATH = 'site/data/find-topics.json';
export const OUTCOMES_PATH = 'site/data/find-outcomes.json';
// The day each lab started, frozen from the full history: the publish workflow's checkout is two commits deep and a
// build copy has one, so neither can date a lab by its first commit.
export const LAB_DATES_PATH = 'site/data/find-lab-dates.json';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const expNumber = id => Number(/^EXP (\d{3})$/.exec(id ?? '')?.[1] ?? NaN);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The first "DD MON YYYY" in a note's article-meta line, as YYYY-MM-DD, or null. */
export function metaDay(meta) {
  const match = /\b(\d{1,2}) ([A-Z]{3}) (\d{4})\b/.exec(String(meta ?? '').toUpperCase());
  const month = match ? MONTHS.indexOf(match[2]) : -1;
  return month < 0 ? null : `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/** "EXP 001–003" → ['EXP 001', 'EXP 002', 'EXP 003']; "EXP 005" → ['EXP 005']; anything else → []. */
export function experimentIds(label) {
  const range = /^EXP (\d{3})[–-](\d{3})$/.exec(label ?? '');
  if (range) {
    const ids = [];
    for (let n = Number(range[1]); n <= Number(range[2]); n++) ids.push(`EXP ${String(n).padStart(3, '0')}`);
    return ids;
  }
  return Number.isInteger(expNumber(label)) ? [label] : [];
}

const LEDGER_STAGE = [[/^Recorded/, 'recorded'], [/^Measured/, 'measured'], [/^Results published/, 'results'], [/^Pre-registered/, 'pre-registered']];
const UPDATE_STAGE = { Results: 'results', Erratum: 'erratum', Amendment: 'amendment', 'Pre-registered': 'pre-registered', Measured: 'measured', Recorded: 'recorded', Tool: 'tool', 'Field note': 'note' };
const PUBLISHED = new Set(['results', 'recorded', 'measured']);

export function ledgerStage(stage) {
  const hit = LEDGER_STAGE.find(([re]) => re.test(stage ?? ''));
  if (!hit) throw new Error(`Site index: ledger stage "${stage}" maps to no index stage`);
  return hit[1];
}

/** The page part of an href (no anchor) and whether it names a file of the built site in `pages`. */
export function hrefOnSite(href, pages) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || /(^|\/)\.\.?(\/|#|$)/.test(href)) return false;
  const path = href.split('#')[0];
  if (path === '') return false;
  return path.endsWith('/') ? pages.has(`${path}index.html`) : pages.has(path);
}

const slugOfNote = href => /^journal\/([a-z0-9-]+)\.html(#.*)?$/.exec(href ?? '')?.[1] ?? null;

/**
 * Every index item, sorted newest first (then by id). Inputs, all already read:
 *   ledger   ledgerEntries() of the built home ({id, title, href, stage, status})
 *   updates  site/data/updates.json's updates ({key, experiment, title, kind, text, href, date})
 *   notes    [{slug, title, summary, date}] for every site/journal/<slug>.html
 *   labs     [{label, title, summary, stage, href, date}]
 *   tools    [{project, title, summary, href, date}]
 *   topics   site/data/find-topics.json
 *   outcomes site/data/find-outcomes.json
 *   pages    a Set of every file path in the built site, relative to its root
 *   fallbackDay(entry) → YYYY-MM-DD or null, for an experiment no update and no note dates (EXP 010)
 */
export function buildIndex({ ledger, updates, notes, labs, tools, topics, outcomes, pages, fallbackDay = () => null }) {
  const vocabulary = new Set(topics.topics.map(t => t.id));
  const topicsOf = (map, key, where) => {
    const list = map?.[key];
    if (!Array.isArray(list) || list.length === 0) throw new Error(`Site index: ${where} has no topics in ${TOPICS_PATH}`);
    for (const word of list) if (!vocabulary.has(word)) throw new Error(`Site index: ${where} names topic "${word}", which is not in the topic list`);
    return [...list];
  };
  const union = lists => [...new Set(lists.flat())];

  const noteBySlug = new Map(notes.map(n => [n.slug, n]));
  const datesByExperiment = new Map();
  for (const u of updates) for (const id of experimentIds(u.experiment)) {
    datesByExperiment.set(id, [...(datesByExperiment.get(id) ?? []), u.date]);
  }

  // Outcomes: curated, each phrase checked against the status it labels, only for an experiment with a published result.
  const byId = new Map(ledger.map(e => [e.id, e]));
  const outcomeOf = new Map();
  for (const [id, { outcome, phrase }] of Object.entries(outcomes.outcomes)) {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Site index: ${OUTCOMES_PATH} names ${id}, which is not on the experiment ledger`);
    if (!PUBLISHED.has(ledgerStage(entry.stage))) throw new Error(`Site index: ${id} has an outcome but no published result (stage "${entry.stage}")`);
    if (!/^(supported|refuted|mixed)$/.test(outcome)) throw new Error(`Site index: ${id}'s outcome "${outcome}" is not supported, refuted or mixed`);
    if (typeof phrase !== 'string' || !phrase || !entry.status.includes(phrase)) throw new Error(`Site index: ${id}'s outcome phrase is not in its status sentence: "${phrase}"`);
    if (id in (outcomes.withheld ?? {})) throw new Error(`Site index: ${id} is both given an outcome and withheld`);
    outcomeOf.set(id, outcome);
  }

  const items = [];
  for (const e of ledger) {
    const n = expNumber(e.id);
    if (!Number.isInteger(n)) throw new Error(`Site index: ledger id "${e.id}" is not of the form EXP 000`);
    // An on-site link: a ledger entry listed from the repository (EXP 010) links its row on the home's ledger instead.
    const href = /^https?:/.test(e.href) ? 'index.html#all-experiments' : e.href;
    const note = noteBySlug.get(slugOfNote(e.href));
    const dates = datesByExperiment.get(e.id) ?? [];
    const date = dates.length ? [...dates].sort().at(-1) : note?.date ?? fallbackDay(e);
    items.push({
      type: 'experiment', id: `exp-${String(n).padStart(3, '0')}`, title: e.title, date, stage: ledgerStage(e.stage),
      ...(outcomeOf.has(e.id) ? { outcome: outcomeOf.get(e.id) } : {}),
      topics: topicsOf(topics.experiments, e.id, e.id), summary: e.status, href,
    });
  }
  for (const lab of labs) {
    const n = /^Lab (\d{2})$/.exec(lab.label)?.[1];
    if (!n) throw new Error(`Site index: lab label "${lab.label}" is not of the form Lab 00`);
    items.push({ type: 'lab', id: `lab-${n}`, title: lab.title, date: lab.date, stage: lab.stage, topics: topicsOf(topics.labs, lab.label, lab.label), summary: lab.summary, href: lab.href });
  }
  for (const note of notes) {
    items.push({ type: 'note', id: `note-${note.slug}`, title: note.title, date: note.date, stage: 'note', topics: topicsOf(topics.notes, note.slug, `journal/${note.slug}.html`), summary: note.summary, href: `journal/${note.slug}.html` });
  }
  for (const u of updates) {
    // An update takes the topics of what it is about: its experiment(s), else the note or tool it links.
    const ids = experimentIds(u.experiment);
    const slug = slugOfNote(u.href);
    const project = /^projects\/([a-z0-9-]+)\/$/.exec(u.href)?.[1];
    const list = ids.length ? union(ids.map(id => topicsOf(topics.experiments, id, `update ${u.key} (${id})`)))
      : slug ? topicsOf(topics.notes, slug, `update ${u.key} (journal/${slug}.html)`)
      : project ? topicsOf(topics.tools, project, `update ${u.key} (projects/${project}/)`)
      : topicsOf({}, u.key, `update ${u.key}`);
    const stage = UPDATE_STAGE[u.kind];
    if (!stage) throw new Error(`Site index: update ${u.key} has kind "${u.kind}", which maps to no index stage`);
    // A results update carries its experiment's curated outcome; nothing else does.
    const outcome = stage === 'results' && ids.length === 1 ? outcomeOf.get(ids[0]) : undefined;
    items.push({ type: 'update', id: `update-${u.key}`, title: u.title, date: u.date, stage, ...(outcome ? { outcome } : {}), topics: list, summary: u.text, href: u.href });
  }
  for (const tool of tools) {
    items.push({ type: 'tool', id: `tool-${tool.project}`, title: tool.title, date: tool.date, stage: 'tool', topics: topicsOf(topics.tools, tool.project, `projects/${tool.project}/`), summary: tool.summary, href: tool.href });
  }

  // Every curated key belongs to something that exists, so a renamed or removed record cannot leave a stale mapping.
  const present = { experiments: new Set(ledger.map(e => e.id)), labs: new Set(labs.map(l => l.label)), notes: new Set(notes.map(n => n.slug)), tools: new Set(tools.map(t => t.project)) };
  for (const [group, keys] of Object.entries(present)) for (const key of Object.keys(topics[group] ?? {})) {
    if (!keys.has(key)) throw new Error(`Site index: ${TOPICS_PATH} maps ${group} "${key}", which the site does not publish`);
  }
  for (const id of Object.keys(outcomes.withheld ?? {})) if (!byId.has(id)) throw new Error(`Site index: ${OUTCOMES_PATH} withholds ${id}, which is not on the experiment ledger`);

  for (const item of items) {
    if (!DAY.test(item.date ?? '')) throw new Error(`Site index: ${item.id} has no date (${item.date})`);
    if (!item.title || !item.summary) throw new Error(`Site index: ${item.id} needs a title and a summary`);
    if (!hrefOnSite(item.href, pages)) throw new Error(`Site index: ${item.id} links ${item.href}, which is not a page of the built site`);
  }
  const ids = items.map(i => i.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated) throw new Error(`Site index: ${repeated} appears twice`);
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

function metaDescription(html) {
  for (const [, name, content] of html.matchAll(/<meta name="([^"]+)" content="([^"]*)"/g)) if (name === 'description') return textOf(content);
  return '';
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir) {
  const out = [];
  const walk = at => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

/**
 * Reads the real sources and returns buildIndex()'s items. `root` holds site/ and the curated files; `dist` is the built
 * site (pnpm build first); `gitRoot` is the checkout whose history dates a lab with no date of its own (a disposable
 * build copy has one fresh commit, so it must not be used for that).
 */
export function loadIndex({ root = '.', dist = join(root, 'dist'), gitRoot = root, commitDay = firstCommitDay } = {}) {
  const site = join(root, 'site');
  const home = read(join(dist, 'index.html'));
  const ledger = ledgerEntries(home, json(join(dist, 'data/experiments.json')), dist);
  const updates = json(join(site, 'data/updates.json')).updates;
  const notes = readdirSync(join(site, 'journal')).filter(name => name.endsWith('.html')).sort().map(name => {
    const built = read(join(dist, 'journal', name));
    const title = textOf(/<title>([\s\S]*?)<\/title>/.exec(built)?.[1] ?? '').replace(/ — Odin R&D$/, '');
    const summary = metaDescription(built).replace(/^Field notes from Odin R&D\. /, '');
    const meta = /class="article-meta">([^<]*)</.exec(read(join(site, 'journal', name)))?.[1];
    return { slug: name.replace(/\.html$/, ''), title, summary, date: metaDay(meta) };
  });
  // A lab's day: the frozen one (site/data/find-lab-dates.json), else its own since day, else its first commit.
  const frozen = existsSync(join(root, LAB_DATES_PATH)) ? json(join(root, LAB_DATES_PATH)).labs ?? {} : {};
  const labDay = (label, own, file) => (DAY.test(frozen[label] ?? '') ? frozen[label] : DAY.test(own ?? '') ? own : commitDay(file, gitRoot));
  const lab01 = json(join(site, LAB_FILE));
  const labs = [{ label: lab01.label, title: lab01.title, summary: lab01.oneLine, stage: 'running', href: `labs/${lab01.slug}/index.html`, date: labDay(lab01.label, lab01.since, `site/${LAB_FILE}`) }];
  for (const file of TILE_FILES) {
    const tile = json(join(site, file));
    // A lab's own words file (<slug>.json beside <slug>-tile.json) may carry the day it started.
    const words = file.endsWith('-tile.json') ? join(site, file.replace(/-tile\.json$/, '.json')) : null;
    const since = words && existsSync(words) ? json(words).since : undefined;
    const page = tile.links.map(l => l.href).find(href => href.endsWith('.html'));
    labs.push({ label: tile.label, title: tile.title, summary: tile.question, stage: tile.kind === 'results' ? 'results' : 'pre-registered', href: page, date: labDay(tile.label, since, `site/${file}`) });
  }
  const toolDates = new Map(updates.filter(u => u.kind === 'Tool').map(u => [u.href, u.date]));
  const tools = readdirSync(join(site, 'projects'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().map(project => {
    const page = read(join(dist, 'projects', project, 'index.html'));
    const href = `projects/${project}/`;
    return { project, title: textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1] ?? ''), summary: metaDescription(page), href, date: toolDates.get(href) ?? commitDay(`site/projects/${project}/index.html`, gitRoot) };
  });
  // EXP 010 is listed from the repository and has no update and no note: its record's own authoredOn day dates it.
  const fallbackDay = entry => {
    const slug = readdirSync(join(dist, 'data'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      .find(name => existsSync(join(dist, 'data', name, 'ledger-entry.json')) && json(join(dist, 'data', name, 'ledger-entry.json')).experiment?.id === entry.id);
    if (!slug) return null;
    const record = json(join(dist, 'data', slug, 'ledger-entry.json')).record;
    const own = existsSync(join(root, record)) ? json(join(root, record)).experiment?.authoredOn : undefined;
    return DAY.test(own ?? '') ? own : commitDay(record, gitRoot);
  };
  const pages = new Set(filesUnder(dist));
  return buildIndex({ ledger, updates, notes, labs, tools, topics: json(join(root, TOPICS_PATH)), outcomes: json(join(root, OUTCOMES_PATH)), pages, fallbackDay });
}
