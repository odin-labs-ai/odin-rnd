// The updates feed: one dated line for every record this site publishes, newest first. Nothing here is written per
// experiment. Entries come from the built site (pnpm build first): every pre-registration, amendment, erratum and results
// record under dist/data/<slug>/, the recorded BCE recipes, the measured Laya comparison, the tools under projects/ and
// the field notes that belong to no experiment. Each entry's text is the record's own words: an amendment's or
// erratum's title, a result's full status as the home page's experiment ledger states it.
//
// A date, once written to site/data/updates.json, is frozen: regenerating keeps it. A new entry takes the record's own
// `date` when it has one, otherwise the day the file was first committed to this repository, otherwise today (a record
// not yet committed; the line says so on stderr). So the committed feed is reproducible from a build and the dates
// never move when CI re-records an experiment.
//
//   pnpm build && node scripts/updates.mjs --write   write site/data/updates.json and the two rendered blocks
//   node scripts/updates.mjs --check                 exit 1 when the committed feed or blocks differ from a fresh render
//
// The rendered blocks are committed HTML (site/index.html between the updates markers, and site/updates/index.html),
// like the Laya bench: scripts/updates.test.mjs fails when they are stale.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journalRows, ledgerEntries, textOf } from './experiment-ledger.mjs';

export const FEED_PATH = 'site/data/updates.json';
export const HOME_PATH = 'site/index.html';
export const PAGE_PATH = 'site/updates/index.html';
export const HOME_LATEST = 4;
const HOME_START = '<!-- updates: rendered by scripts/updates.mjs --write from site/data/updates.json; do not edit by hand -->';
const HOME_END = '<!-- /updates -->';
const PAGE_START = '<!-- updates-list: rendered by scripts/updates.mjs --write from site/data/updates.json; do not edit by hand -->';
const PAGE_END = '<!-- /updates-list -->';
export const KIND_ORDER = ['Results', 'Erratum', 'Amendment', 'Pre-registered', 'Measured', 'Recorded', 'Tool', 'Field note'];

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const dayOf = stamp => (/^\d{4}-\d{2}-\d{2}/.exec(String(stamp ?? ''))?.[0]);
const expNumber = id => Number(/^EXP (\d{3})/.exec(id ?? '')?.[1] ?? -1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const humanDay = day => { const [y, m, d] = day.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const monthOf = day => { const [y, m] = day.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`; };

/** The first sentence of a status: up to the first full stop that ends a sentence. */
export function firstSentence(text) {
  const match = /^.*?[.!?](?=\s+[A-Z(]|$)/s.exec(String(text).trim());
  return (match ? match[0] : String(text).trim()).replace(/\s+/g, ' ');
}

/** An amendment's or erratum's own title as a sentence, unedited apart from the closing full stop. */
export function titleSentence(title) {
  const sentence = String(title).trim();
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The day `file` was first committed, or null when git has no record of it. */
export function firstCommitDay(file, cwd = process.cwd()) {
  try {
    const days = execFileSync('git', ['log', '--diff-filter=A', '--format=%cs', '--follow', '--', file], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    return days.length ? days[days.length - 1] : null;
  } catch { return null; }
}

/**
 * Every entry the built site supports, without dates: { key, experiment, title, kind, text, href, source, ownDate, file }.
 * `root` is the checkout (site/ and dist/ beneath it).
 */
export function candidates(root = '.') {
  const dist = join(root, 'dist');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const report = JSON.parse(readFileSync(join(dist, 'data/experiments.json'), 'utf8'));
  const ledger = ledgerEntries(html, report, dist);
  const byId = new Map(ledger.map(entry => [entry.id, entry]));
  const out = [];
  const add = entry => out.push(entry);

  // The three recorded BCE recipes, as one entry. CI re-records the report on every publish, so its run date is used only
  // when the entry is first written; the text names no date or score that a re-recording could change.
  add({ key: 'exp-001-003-recorded', experiment: 'EXP 001–003', title: 'Three blueprint recipes', kind: 'Recorded', text: 'Each recipe applies one unchanged architectural rule to a conforming tree and to a deliberately drifted tree; the engine scored every conforming tree GREEN and every drifted tree RED.', href: '#bench', source: 'data/experiments.json', file: 'site/data/experiments.json', ownDate: dayOf(report.completedAt) });

  const laya = byId.get('EXP 004');
  if (laya) add({ key: 'exp-004-measured', experiment: 'EXP 004', title: laya.title, kind: 'Measured', text: laya.status, href: laya.href, source: 'data/laya-vs-jev/manifest.json', file: 'site/data/laya-vs-jev/manifest.json', ownDate: dayOf(JSON.parse(readFileSync(join(dist, 'data/laya-vs-jev/manifest.json'), 'utf8')).copiedAt) });

  for (const slug of readdirSync(join(dist, 'data'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const dir = join(dist, 'data', slug);
    const preregFile = join(dir, 'preregistration.json');
    if (!existsSync(preregFile)) continue;
    const { id, title } = JSON.parse(readFileSync(preregFile, 'utf8')).experiment;
    const listed = byId.get(id);
    const href = listed && !listed.href.startsWith('data/') ? listed.href : `data/${slug}/preregistration.json`;
    const n = String(expNumber(id)).padStart(3, '0');
    add({ key: `exp-${n}-preregistration`, experiment: id, title, kind: 'Pre-registered', text: 'The question and how it will be scored were published before any counted run.', href, source: `data/${slug}/preregistration.json`, file: `site/data/${slug}/preregistration.json` });
    for (const file of readdirSync(dir).filter(name => /^(amendment|erratum)-\d{2}\.json$/.test(name)).sort()) {
      const record = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const kind = file.startsWith('amendment') ? 'Amendment' : 'Erratum';
      if (typeof record.title !== 'string' || !record.title) throw new Error(`Updates: data/${slug}/${file} has no title`);
      add({ key: `exp-${n}-${file.replace(/\.json$/, '')}`, experiment: id, title, kind, text: titleSentence(record.title), href, source: `data/${slug}/${file}`, file: `site/data/${slug}/${file}`, ownDate: /^\d{4}-\d{2}-\d{2}$/.test(record.date ?? '') ? record.date : undefined });
    }
    if (existsSync(join(dir, 'results.json'))) {
      if (!listed) throw new Error(`Updates: ${id} publishes results but is not in the experiment ledger`);
      add({ key: `exp-${n}-results`, experiment: id, title, kind: 'Results', text: listed.status, href, source: `data/${slug}/results.json`, file: `site/data/${slug}/results.json` });
    }
  }

  for (const project of readdirSync(join(root, 'site/projects'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const page = readFileSync(join(root, 'site/projects', project, 'index.html'), 'utf8');
    const name = textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1] ?? '');
    const description = /<meta name="description" content="([^"]*)"/.exec(page)?.[1];
    if (!name || !description) throw new Error(`Updates: projects/${project}/index.html needs an h1 and a meta description`);
    add({ key: `tool-${project}`, experiment: null, title: name, kind: 'Tool', text: firstSentence(textOf(description)), href: `projects/${project}/`, source: `projects/${project}/`, file: `site/projects/${project}/index.html` });
  }

  // Field notes that belong to no experiment: the build and research notes, dated by their own row.
  const source = readFileSync(join(root, HOME_PATH), 'utf8');
  for (const part of source.split('<a class="journal-row" href="').slice(1)) {
    const body = part.slice(0, part.indexOf('</a>'));
    const label = /<span class="technical">([^<]*)<\/span>/.exec(body)?.[1] ?? '';
    if (!/^(BUILD|RESEARCH) NOTE/.test(label)) continue;
    const href = part.slice(0, part.indexOf('"'));
    const row = journalRows(`<a class="journal-row" href="${part}`)[0];
    const datetime = /<time datetime="(\d{4}-\d{2}-\d{2})">/.exec(body)?.[1];
    add({ key: `note-${href.replace(/^journal\/|\.html$/g, '')}`, experiment: null, title: row.heading, kind: 'Field note', text: row.text, href, source: href, file: `site/${href}`, ownDate: datetime });
  }

  const keys = out.map(entry => entry.key);
  const repeated = keys.find((key, i) => keys.indexOf(key) !== i);
  if (repeated) throw new Error(`Updates: ${repeated} appears twice`);
  return out;
}

/** Newest first; on the same day results before errata, amendments and pre-registrations; then the higher number. */
export function sortUpdates(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || expNumber(b.experiment) - expNumber(a.experiment)
    || a.key.localeCompare(b.key));
}

/** The feed: frozen dates from `previous`, otherwise the record's own date, its first commit, or `today`. */
export function buildFeed(list, previous = null, { root = '.', today = new Date().toISOString().slice(0, 10), commitDay = firstCommitDay, warn = message => process.stderr.write(`${message}\n`) } = {}) {
  const frozen = new Map((previous?.updates ?? []).map(entry => [entry.key, entry.date]));
  const updates = list.map(({ ownDate, file, ...entry }) => {
    let date = frozen.get(entry.key) ?? ownDate ?? commitDay(file, root);
    if (!date) { warn(`Updates: ${file} is not committed yet; dated ${today}. Commit it, then run --write again to keep that date.`); date = today; }
    return { ...entry, date };
  });
  return {
    schemaVersion: 1,
    site: 'https://odin-labs-ai.github.io/odin-rnd/',
    about: 'Every record this site publishes, newest first. A date is the record\'s own date, or the day it was first published in this repository.',
    updates: sortUpdates(updates),
  };
}

const link = (href, prefix) => (/^https?:/.test(href) ? href : `${prefix}${href}`);
const item = (entry, prefix) => `<li class="update-item" data-reveal><a href="${escape(link(entry.href, prefix))}"><time datetime="${entry.date}">${humanDay(entry.date)}</time><span class="update-kind technical">${escape(entry.kind.toUpperCase())}${entry.experiment ? ` · ${escape(entry.experiment)}` : ''}</span><span class="update-title">${escape(entry.title)}</span><span class="update-text">${escape(entry.text)}</span></a></li>`;

/** The home page block: the latest few entries and a way to all of them. */
export function renderHome(feed) {
  // './' keeps these links textually distinct from the field-note rows' hrefs, which other generators anchor on.
  const latest = feed.updates.slice(0, HOME_LATEST).map(entry => item(entry, './')).join('');
  return `${HOME_START}
    <section class="updates-feed content-section" id="updates" aria-labelledby="updates-title">
      <div class="section-heading"><h2 id="updates-title">Latest from <br>the floor.</h2><p>Every record we publish, newest first: plans written down before a run, results, corrections and new tools. <a href="updates/">See all updates</a></p></div>
      <ol class="update-list" aria-labelledby="updates-title">${latest}</ol>
    </section>
    ${HOME_END}`;
}

/** The updates page's list: every entry, grouped by month. */
export function renderPage(feed) {
  const groups = [];
  for (const entry of feed.updates) {
    const month = monthOf(entry.date);
    if (groups.at(-1)?.month !== month) groups.push({ month, entries: [] });
    groups.at(-1).entries.push(entry);
  }
  const body = groups.map(group => `<section class="update-month" aria-label="${escape(group.month)}"><h2 class="technical">${escape(group.month.toUpperCase())}</h2><ol class="update-list">${group.entries.map(entry => item(entry, '../')).join('')}</ol></section>`).join('');
  return `${PAGE_START}${body}${PAGE_END}`;
}

/** `text` with the block between `start` and `end` (markers included) replaced by `block`. */
export function replaceBlock(text, start, end, block) {
  const a = text.indexOf(start), b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`Updates: markers ${start.slice(0, 30)}… not found in order`);
  return text.slice(0, a) + block + text.slice(b + end.length);
}

const feedText = feed => `${JSON.stringify(feed, null, 2)}\n`;

/** What --write would write, from the built site and the committed feed. */
export function render(root = '.', options = {}) {
  const previous = existsSync(join(root, FEED_PATH)) ? JSON.parse(readFileSync(join(root, FEED_PATH), 'utf8')) : null;
  const feed = buildFeed(candidates(root), previous, { root, ...options });
  const home = readFileSync(join(root, HOME_PATH), 'utf8');
  const page = readFileSync(join(root, PAGE_PATH), 'utf8');
  return {
    feed,
    files: {
      [FEED_PATH]: feedText(feed),
      [HOME_PATH]: replaceBlock(home, HOME_START, HOME_END, renderHome(feed)),
      [PAGE_PATH]: replaceBlock(page, PAGE_START, PAGE_END, renderPage(feed)),
    },
  };
}

/** The paths whose committed text differs from a fresh render. */
export function stale(root = '.', options = {}) {
  const { files } = render(root, options);
  return Object.entries(files).filter(([path, text]) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== text).map(([path]) => path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!existsSync('dist/index.html')) { console.error('Updates: build the site first (pnpm build).'); process.exit(1); }
  if (mode === '--write') {
    const { files, feed } = render('.');
    for (const [path, text] of Object.entries(files)) writeFileSync(path, text);
    console.log(`Wrote ${feed.updates.length} updates to ${FEED_PATH}, ${HOME_PATH} and ${PAGE_PATH}.`);
  } else if (mode === '--check') {
    const paths = stale('.');
    if (paths.length) { console.error(`Updates are stale in ${paths.join(', ')}. Run: pnpm build && node scripts/updates.mjs --write`); process.exit(1); }
    console.log('Updates feed and rendered blocks are current.');
  } else {
    console.error('Usage: node scripts/updates.mjs --write | --check');
    process.exit(2);
  }
}
