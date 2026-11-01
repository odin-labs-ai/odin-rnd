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
// place (an item with no topic, an unknown topic word, an outcome whose phrase its status no longer states, an
// experiment with a published result and no outcome decision, an href that is not a file of the built site, a built
// note, lab or tool page no item lists, an item the schema refuses, a repeated id). loadIndex() reads the real sources
// from a built site and dates every item from committed data only: it never reads git history, so a shallow checkout
// builds the same index as a full one, or stops.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ledgerEntries, textOf } from './experiment-ledger.mjs';
import { LAB_FILE } from './labs.mjs';
import { TILE_FILES } from './lab-tiles.mjs';
import { validate } from './json-schema-lite.mjs';
import { isRecordHref, recordPageHref } from './site-records.mjs';
import { CHROME_WITHOUT_ITEM, SECTION_INDEX_PAGES, pageClass, pageKey } from './site-chrome.mjs';

/** The item schema; buildIndex checks every item against it, so its if/then (an outcome only on an experiment or its
 *  results update, at a published stage) holds in the build, not only in the tests. */
export const SCHEMA_PATH = 'scripts/schemas/site-index.schema.json';
export const ITEM_SCHEMA = JSON.parse(readFileSync(new URL('./schemas/site-index.schema.json', import.meta.url), 'utf8'));

export const TOPICS_PATH = 'site/data/find-topics.json';
export const OUTCOMES_PATH = 'site/data/find-outcomes.json';
// The day each lab started, frozen from the full history: the publish workflow's checkout is two commits deep and a
// build copy has one, so neither can date a lab by its first commit. A lab with neither a frozen day nor a since day
// of its own stops the build.
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
const REFERENCE = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

export function ledgerStage(stage) {
  const hit = LEDGER_STAGE.find(([re]) => re.test(stage ?? ''));
  if (!hit) throw new Error(`Site index: ledger stage "${stage}" maps to no index stage`);
  return hit[1];
}

/** Whether `phrase` appears in `text` as whole words: no letter or digit runs on at either end. */
export function hasPhrase(text, phrase) {
  if (typeof phrase !== 'string' || !phrase) return false;
  const word = ch => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
    if (!(word(phrase[0]) && word(text[at - 1])) && !(word(phrase.at(-1)) && word(text[at + phrase.length]))) return true;
  }
  return false;
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
 *   recordPages  Map of a raw record link (a ledger or update href ending in .json) → its readable page
 *                'records/<slug>/' (scripts/site-records.mjs); an item that links such a record links its page instead
 */
export function buildIndex({ ledger, updates, notes, labs, tools, topics, outcomes, pages, fallbackDay = () => null, recordPages = new Map() }) {
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
    if (!hasPhrase(entry.status, phrase)) throw new Error(`Site index: ${id}'s outcome phrase is not in its status sentence: "${phrase}"`);
    if (id in (outcomes.withheld ?? {})) throw new Error(`Site index: ${id} is both given an outcome and withheld`);
    outcomeOf.set(id, outcome);
  }

  // Every experiment with a published result has an outcome decision: an outcome, or a reason it is withheld.
  for (const e of ledger) {
    if (PUBLISHED.has(ledgerStage(e.stage)) && !outcomeOf.has(e.id) && !(e.id in (outcomes.withheld ?? {}))) {
      throw new Error(`Site index: ${e.id} has a published result but no outcome and no withheld reason in ${OUTCOMES_PATH}`);
    }
  }

  const items = [];
  for (const e of ledger) {
    const n = expNumber(e.id);
    if (!Number.isInteger(n)) throw new Error(`Site index: ledger id "${e.id}" is not of the form EXP 000`);
    // An on-site link: a ledger entry listed from the repository (EXP 010) links its row on the home's ledger instead.
    // A ledger entry that links a raw JSON record links that record's readable page when there is one (wave 4).
    const href = recordPages.get(e.href) ?? (/^https?:/.test(e.href) ? 'index.html#all-experiments' : e.href);
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
    items.push({ type: 'update', id: `update-${u.key}`, title: u.title, date: u.date, stage, ...(outcome ? { outcome } : {}), topics: list, summary: u.text, href: recordPages.get(u.href) ?? u.href });
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
    // Plain text only: the Find page and the chrome escape every value whole, so a reference here would show raw.
    for (const field of ['title', 'summary']) if (REFERENCE.test(item[field])) throw new Error(`Site index: ${item.id}'s ${field} holds a character reference that was not decoded; the index holds plain text (write the character itself in the page, e.g. ’ not &rsquo;)`);
    if (!hrefOnSite(item.href, pages)) throw new Error(`Site index: ${item.id} links ${item.href}, which is not a page of the built site`);
    // A visitor following an item lands on a page, never on a raw JSON file (wave 4, audit finding 13): such a link goes
    // through its record page (recordPages, from scripts/site-records.mjs).
    if (/\.json(?:#.*)?$/.test(item.href)) throw new Error(`Site index: ${item.id} links the raw record ${item.href}; link its record page instead (scripts/site-records.mjs)`);
    const problems = validate(ITEM_SCHEMA, item);
    if (problems.length) throw new Error(`Site index: ${item.id} does not match ${SCHEMA_PATH}: ${problems.join('; ')}`);
  }
  // The other direction: every note, lab and tool page of the built site is an item of its own kind, so a page added
  // without its source (a new lab page, a tool folder) cannot go unlisted. CHROME_WITHOUT_ITEM and SECTION_INDEX_PAGES
  // (scripts/site-chrome.mjs, the same maps injectChrome reads) name the exceptions.
  const KIND = { note: 'note', lab: 'lab', tool: 'tool' };
  const listed = new Set(items.map(item => `${item.type} ${pageKey(item.href)}`));
  for (const page of [...pages].sort()) {
    const kind = pageClass(page);
    if (!kind || CHROME_WITHOUT_ITEM.has(page) || SECTION_INDEX_PAGES.has(page)) continue;
    if (!listed.has(`${KIND[kind]} ${pageKey(page)}`)) throw new Error(`Site index: the built site has the ${kind} page ${page}, which no ${kind} item lists`);
  }
  const ids = items.map(i => i.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated) throw new Error(`Site index: ${repeated} appears twice`);
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

// textOf decodes the named references a page uses; a numeric one (&#x27; in a meta description) is decoded here, so the
// index holds plain text and the Find page, which sets it as text, never shows a raw reference.
const plain = text => text.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex ?? dec, hex ? 16 : 10)));

function metaDescription(html) {
  for (const [, name, content] of html.matchAll(/<meta name="([^"]+)" content="([^"]*)"/g)) if (name === 'description') return plain(textOf(content));
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

/** Every experiment id the site's own data publishes, read from site/ without the ledger: the recorded recipes (one per
 *  run of site/data/experiments.json), EXP 004 (the laptop measurement, site/data/laya-vs-jev/) and the id of every
 *  site/data/<slug>/preregistration.json and ledger-entry.json. */
export function experimentIdsInData(site) {
  const ids = json(join(site, 'data/experiments.json')).runs.map((_, i) => `EXP ${String(i + 1).padStart(3, '0')}`);
  if (existsSync(join(site, 'data/laya-vs-jev/manifest.json'))) ids.push('EXP 004');
  for (const slug of readdirSync(join(site, 'data'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    for (const file of ['preregistration.json', 'ledger-entry.json']) {
      const path = join(site, 'data', slug, file);
      if (existsSync(path)) ids.push(json(path).experiment.id);
    }
  }
  return [...new Set(ids)].sort();
}

/**
 * Reads the real sources and returns buildIndex()'s items. `root` holds site/ and the curated files; `dist` is the built
 * site (pnpm build first). Dates come from committed data only (the update feed, a note's own meta line, a lab's frozen
 * or own day, a record's authoredOn); an item none of them dates stops the build.
 */
export function loadIndex({ root = '.', dist = join(root, 'dist') } = {}) {
  const site = join(root, 'site');
  const home = read(join(dist, 'index.html'));
  const ledger = ledgerEntries(home, json(join(dist, 'data/experiments.json')), dist);
  // The ledger is read from the built home page; the site's data is read separately, and the two must list the same
  // experiments, so an experiment the home page drops (or one it lists without data) cannot pass unnoticed.
  const inData = experimentIdsInData(site);
  const onLedger = ledger.map(e => e.id).sort();
  if (JSON.stringify(inData) !== JSON.stringify(onLedger)) {
    throw new Error(`Site index: the home ledger lists ${onLedger.join(', ')} but the site's data publishes ${inData.join(', ')}`);
  }
  const updates = json(join(site, 'data/updates.json')).updates;
  const notes = readdirSync(join(site, 'journal')).filter(name => name.endsWith('.html')).sort().map(name => {
    const built = read(join(dist, 'journal', name));
    const title = plain(textOf(/<title>([\s\S]*?)<\/title>/.exec(built)?.[1] ?? '')).replace(/ — Odin R&D$/, '');
    const summary = metaDescription(built).replace(/^Field notes from Odin R&D\. /, '');
    const meta = /class="article-meta">([^<]*)</.exec(read(join(site, 'journal', name)))?.[1];
    return { slug: name.replace(/\.html$/, ''), title, summary, date: metaDay(meta) };
  });
  // A lab's day: the frozen one (site/data/find-lab-dates.json), else its own since day; never git history.
  const frozen = json(join(root, LAB_DATES_PATH)).labs ?? {};
  const labDay = (label, own) => {
    if (DAY.test(frozen[label] ?? '')) return frozen[label];
    if (DAY.test(own ?? '')) return own;
    throw new Error(`Site index: ${label} has no day in ${LAB_DATES_PATH} and no since day of its own (git history is not read: a CI checkout is shallow)`);
  };
  const lab01 = json(join(site, LAB_FILE));
  const labs = [{ label: lab01.label, title: lab01.title, summary: lab01.oneLine, stage: 'running', href: `labs/${lab01.slug}/index.html`, date: labDay(lab01.label, lab01.since) }];
  for (const file of TILE_FILES) {
    const tile = json(join(site, file));
    // A lab's own words file (<slug>.json beside <slug>-tile.json) may carry the day it started.
    const words = file.endsWith('-tile.json') ? join(site, file.replace(/-tile\.json$/, '.json')) : null;
    const since = words && existsSync(words) ? json(words).since : undefined;
    const page = tile.links.map(l => l.href).find(href => href.endsWith('.html'));
    labs.push({ label: tile.label, title: tile.title, summary: tile.question, stage: tile.kind === 'results' ? 'results' : 'pre-registered', href: page, date: labDay(tile.label, since) });
  }
  // A tool's day is the day of its Tool update in the committed feed; a tool with none stops the build.
  const toolDates = new Map(updates.filter(u => u.kind === 'Tool').map(u => [u.href, u.date]));
  const tools = readdirSync(join(site, 'projects'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().map(project => {
    const page = read(join(dist, 'projects', project, 'index.html'));
    const href = `projects/${project}/`;
    if (!toolDates.has(href)) throw new Error(`Site index: the tool ${href} has no Tool update in site/data/updates.json to date it (git history is not read)`);
    return { project, title: plain(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1] ?? '')), summary: metaDescription(page), href, date: toolDates.get(href) };
  });
  // EXP 010 is listed from the repository and has no update and no note: its record's own authoredOn day dates it.
  // Without one the experiment has no date, and buildIndex stops the build.
  const fallbackDay = entry => {
    const slug = readdirSync(join(dist, 'data'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      .find(name => existsSync(join(dist, 'data', name, 'ledger-entry.json')) && json(join(dist, 'data', name, 'ledger-entry.json')).experiment?.id === entry.id);
    if (!slug) return null;
    const record = json(join(dist, 'data', slug, 'ledger-entry.json')).record;
    const own = existsSync(join(root, record)) ? json(join(root, record)).experiment?.authoredOn : undefined;
    return DAY.test(own ?? '') ? own : null;
  };
  const pages = new Set(filesUnder(dist));
  // A raw record link (a ledger or update href ending in .json) leads to its record page, which scripts/site-records.mjs
  // rendered before this runs. A link whose page is missing stays raw, and buildIndex refuses it.
  const recordPages = new Map([...ledger.map(e => e.href), ...updates.map(u => u.href)].filter(isRecordHref)
    .map(href => [href, recordPageHref(href)]).filter(([, page]) => pages.has(`${page}index.html`)));
  return buildIndex({ ledger, updates, notes, labs, tools, topics: json(join(root, TOPICS_PATH)), outcomes: json(join(root, OUTCOMES_PATH)), pages, fallbackDay, recordPages });
}
