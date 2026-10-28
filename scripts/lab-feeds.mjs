// Atom feeds for the labs (vision-plan vp-living-labs-off-the-laptop, bundle 2, WO-03), generated at build from the
// committed records only, into dist/ (nothing rendered is committed):
//   feed.xml               the site feed: every update (site/data/updates.json) and every lab run, newest first
//   labs/<lab>/feed.xml    a lab's feed, for each lab whose record carries runs: its runs and the updates of its
//                          experiment (an update whose source is under data/<experiment>/), newest first
// Lab 01 keeps its own feed of dispatches (labs/agent-space/feed.xml, scripts/labs.mjs); it is checked here too.
//
// An entry's id never changes once published: an update by its frozen key, a run by its lab, machine class, ranAt and
// full recordHash (a tag URI). A feed's <updated> is its newest entry's, so a rebuild with nothing new writes the same
// bytes; no wall clock is read. An update's entry carries its kind, experiment, title and link, not its text: the
// text stays on the updates page, and the feed passes the kit's leak screen like a lab page.
//
// feedProblems() is the check, run on every feed the build writes (the build fails on a problem) and in pnpm test: the
// XML is well-formed (a strict reader for the subset these feeds use: elements, attributes in double quotes, text,
// the five XML entities and numeric references), the root is an Atom <feed>, the feed and every entry have exactly
// one id, title and updated (an RFC 3339 UTC time), ids are unique tag: or https: URIs, the feed's self link is its
// own URL, every entry has an alternate link, entries are newest first, and the feed's updated is its newest entry's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escape, LEAKS, pageLeaks, realInstant, recordHashes } from './lab-kit.mjs';

export const SITE_URL = 'https://odin-labs-ai.github.io/odin-rnd/';
export const SITE_FEED = 'feed.xml';
export const UPDATES_FILE = 'data/updates.json';
const TAG = 'tag:odin-labs-ai.github.io,2026:odin-rnd/';
const xml = v => escape(v).replaceAll("'", '&apos;');

export const runEntryId = run => `${TAG}labs/${run.lab}/runs/${run.machineClass}/${run.ranAt}/${run.recordHash}`;
export const updateEntryId = update => `${TAG}updates/${update.key}`;

/** The committed updates, as the updates page lists them; [] when there are none. */
export function readUpdates(root = 'site') {
  const feed = JSON.parse(readFileSync(join(root, UPDATES_FILE), 'utf8'));
  if (feed.schemaVersion !== 1 || !Array.isArray(feed.updates)) throw new Error(`${UPDATES_FILE}: not the updates feed v1`);
  const problems = [];
  feed.updates.forEach((u, i) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(u.key ?? '')) problems.push(`${UPDATES_FILE}#/updates/${i}/key: not a plain key`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date ?? '') || !realInstant(`${u.date}T00:00:00Z`)) problems.push(`${UPDATES_FILE}#/updates/${i}/date: not a real date`);
    for (const k of ['title', 'kind', 'href']) if (typeof u[k] !== 'string' || !u[k]) problems.push(`${UPDATES_FILE}#/updates/${i}/${k}: missing`);
    if (typeof u.href === 'string' && (/^[a-z]+:/i.test(u.href) || /(^|\/)\.\.?(\/|$)/.test(u.href))) problems.push(`${UPDATES_FILE}#/updates/${i}/href: not a path of this site`);
  });
  if (new Set(feed.updates.map(u => u.key)).size !== feed.updates.length) problems.push(`${UPDATES_FILE}: a key appears twice`);
  if (problems.length) throw new Error(`Updates refused:\n  ${problems.join('\n  ')}`);
  return feed.updates;
}

function runEntry(tile, run, anchor) {
  const title = `${tile.label}: a run on ${run.machineClass}, record ${run.recordHash.slice(0, 12)}, ${run.result.verdict}`;
  const summary = `${tile.title} The ${run.runner} runner, machine class ${run.machineClass}, ran commit ${run.commit.sha.slice(0, 8)}; record hash ${run.recordHash}; the check printed ${run.result.verdict} with ${run.result.breaches} breaches.`;
  return { id: runEntryId(run), updated: run.ranAt, title, href: `${SITE_URL}labs/runs/#${anchor(run)}`, summary };
}

function updateEntry(u) {
  const title = `${u.kind}${u.experiment ? ` · ${u.experiment}` : ''}: ${u.title}`;
  return { id: updateEntryId(u), updated: `${u.date}T00:00:00Z`, title, href: `${SITE_URL}${u.href}` };
}

const newestFirst = (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id);

/** One Atom feed. `entries` are { id, updated, title, href, summary? }; the feed's updated is the newest entry's. */
export function renderFeed({ id, title, subtitle, self, alternate, entries }) {
  const sorted = [...entries].sort(newestFirst);
  if (!sorted.length) throw new Error(`${self}: a feed with no entry has no date of its own; it is not written`);
  const body = sorted.map(e => `<entry><id>${xml(e.id)}</id><title>${xml(e.title)}</title><updated>${e.updated}</updated><link rel="alternate" type="text/html" href="${xml(e.href)}"/>${e.summary ? `<summary>${xml(e.summary)}</summary>` : ''}</entry>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><id>${xml(id)}</id><title>${xml(title)}</title><subtitle>${xml(subtitle)}</subtitle><updated>${sorted[0].updated}</updated><link rel="self" type="application/atom+xml" href="${xml(self)}"/><link rel="alternate" type="text/html" href="${xml(alternate)}"/><author><name>Odin Labs R&amp;D</name></author>${body}</feed>\n`;
}

/** The feeds, keyed by their dist/ path: the site feed and one per lab with runs. `labs` from readLabRuns. */
export function renderFeeds(labs, updates, { anchor }) {
  const runs = labs.flatMap(({ tile, runs }) => runs.map(run => runEntry(tile, run, anchor)));
  // With no update and no run there is nothing to follow, and no date to give the feed: nothing is written.
  if (!updates.length && !runs.length) return {};
  const feeds = {
    [SITE_FEED]: renderFeed({ id: `${TAG}feed`, title: 'Odin Labs R&D: every update and every lab run', subtitle: 'Experiment plans, results, corrections, tools and every run of every lab\'s check, newest first, from the records this site publishes.', self: `${SITE_URL}${SITE_FEED}`, alternate: `${SITE_URL}updates/`, entries: [...updates.map(updateEntry), ...runs] }),
  };
  for (const { tile, runs: labRuns, page } of labs) {
    if (!page) continue;
    const dir = page.slice(0, -'index.html'.length);
    const own = updates.filter(u => typeof u.source === 'string' && u.source.startsWith(`data/${tile.experiment}/`));
    feeds[`${dir}feed.xml`] = renderFeed({ id: `${TAG}${dir}feed`, title: `Odin Labs R&D · ${tile.label}: ${tile.title}`, subtitle: tile.question, self: `${SITE_URL}${dir}feed.xml`, alternate: `${SITE_URL}${dir}`, entries: [...own.map(updateEntry), ...labRuns.map(run => runEntry(tile, run, anchor))] });
  }
  return feeds;
}

// The strict reader: the XML these feeds use, and nothing more.
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const REF = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g;
// XML 1.0's Char: tab, line feed, carriage return, U+0020-U+D7FF, U+E000-U+FFFD, U+10000-U+10FFFF; nothing else, as
// a character or as a numeric reference.
const xmlChar = c => c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
const refChar = ref => (ref.startsWith('&#x') ? parseInt(ref.slice(3, -1), 16) : ref.startsWith('&#') ? Number(ref.slice(2, -1)) : 0x20);
const textProblem = text => {
  if (text.replace(REF, '').includes('&')) return 'an & that is not an entity';
  if (text.includes('<')) return 'a raw <';
  for (const ch of text) if (!xmlChar(ch.codePointAt(0))) return 'a character XML does not allow';
  for (const [ref] of text.matchAll(REF)) if (!xmlChar(refChar(ref))) return `a reference to a character XML does not allow (${ref})`;
  return null;
};
const unescape = v => v.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d))).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');

/** The XML as a tree of { name, attrs, children, text }, or { problems } when it is not well-formed. */
export function parseXml(source) {
  const problems = [];
  const decl = '<?xml version="1.0" encoding="utf-8"?>\n';
  if (!source.startsWith(decl)) return { problems: ['does not start with the XML declaration'] };
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = decl.length;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const text = source.slice(i, lt < 0 ? source.length : lt);
    if (text) {
      const p = textProblem(text);
      if (p) problems.push(`${p} in text at ${i}`);
      if (stack.length === 1 && text.trim()) problems.push(`text outside the root element at ${i}`);
      stack.at(-1).text += unescape(text);
    }
    if (lt < 0) break;
    const gt = source.indexOf('>', lt);
    if (gt < 0) { problems.push(`a tag that never closes at ${lt}`); break; }
    const tag = source.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1);
      if (stack.length === 1 || stack.at(-1).name !== name) { problems.push(`</${name}> does not close the open element at ${lt}`); break; }
      stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const m = /^([^\s/]+)((?:\s+[^\s=]+="[^"]*")*)\s*\/?$/.exec(tag);
    if (!m || !NAME.test(m[1])) { problems.push(`not an element tag at ${lt}: <${tag.slice(0, 40)}>`); break; }
    const attrs = {};
    for (const [, k, v] of m[2].matchAll(/\s+([^\s=]+)="([^"]*)"/g)) {
      if (!NAME.test(k)) problems.push(`attribute name ${k} at ${lt}`);
      if (k in attrs) problems.push(`attribute ${k} twice at ${lt}`);
      const p = textProblem(v);
      if (p) problems.push(`${p} in attribute ${k} at ${lt}`);
      attrs[k] = unescape(v);
    }
    if (stack.length === 1 && root.children.length) { problems.push(`a second root element at ${lt}`); break; }
    // One namespace, declared once: only the root declares it, and no name is prefixed, so every element is Atom's.
    if (m[1].includes(':') || Object.keys(attrs).some(k => k.includes(':') || (k === 'xmlns' && stack.length > 1))) { problems.push(`a namespace other than the root's at ${lt}`); break; }
    const el = { name: m[1], attrs, children: [], text: '' };
    stack.at(-1).children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (!problems.length && stack.length !== 1) problems.push(`<${stack.at(-1).name}> is never closed`);
  if (!problems.length && root.children.length !== 1) problems.push('no root element');
  return problems.length ? { problems } : { tree: root.children[0], problems: [] };
}

// An RFC 3339 UTC time that is a real calendar instant (the kit's realInstant: 2026-02-30 or 24:00 is refused).
const utcTime = v => realInstant(v) !== null;
const URI = /^(tag:[a-z0-9.-]+,\d{4}(-\d{2}(-\d{2})?)?:|https:\/\/)[^\s<>"]+$/;

/** Every reason `source` is not a valid, stable Atom feed published at `self` (empty when it is one). */
export function feedProblems(source, { self, where = self } = {}) {
  const { tree, problems: parse } = parseXml(source);
  if (parse.length) return parse.map(p => `${where}: ${p}`);
  const problems = [];
  const at = p => problems.push(`${where}: ${p}`);
  if (tree.name !== 'feed' || tree.attrs.xmlns !== 'http://www.w3.org/2005/Atom') return [`${where}: the root is not an Atom <feed>`];
  const one = (el, name, label) => {
    const found = el.children.filter(c => c.name === name);
    if (found.length !== 1) at(`${label} has ${found.length} <${name}>, not one`);
    return found[0]?.text ?? '';
  };
  const ids = [];
  const fid = one(tree, 'id', 'the feed');
  one(tree, 'title', 'the feed');
  const fupdated = one(tree, 'updated', 'the feed');
  ids.push(fid);
  if (!utcTime(fupdated)) at(`the feed's updated ${fupdated} is not an RFC 3339 UTC time`);
  const selfLinks = tree.children.filter(c => c.name === 'link' && c.attrs.rel === 'self');
  if (selfLinks.length !== 1 || (self && selfLinks[0].attrs.href !== self)) at(`the self link is not this feed's own URL (${self})`);
  const entries = tree.children.filter(c => c.name === 'entry');
  const times = entries.map((e, n) => {
    const label = `entry ${n + 1}`;
    ids.push(one(e, 'id', label));
    if (!one(e, 'title', label).trim()) at(`${label} has an empty title`);
    const updated = one(e, 'updated', label);
    if (!utcTime(updated)) at(`${label}'s updated ${updated} is not an RFC 3339 UTC time`);
    if (!e.children.some(c => c.name === 'link' && c.attrs.rel === 'alternate' && /^https:\/\//.test(c.attrs.href ?? ''))) at(`${label} has no alternate link`);
    return updated;
  });
  for (const id of ids) if (!URI.test(id)) at(`the id ${JSON.stringify(id)} is not a tag: or https: URI`);
  if (new Set(ids).size !== ids.length) at('an id appears twice');
  for (let n = 1; n < times.length; n++) if (times[n] > times[n - 1]) at(`entry ${n + 1} is newer than the entry before it`);
  if (times.length && fupdated !== [...times].sort().at(-1)) at(`the feed's updated ${fupdated} is not its newest entry's (${[...times].sort().at(-1)})`);
  return problems;
}

/**
 * What a feed reader shows, for the leak screen: every element's text, each as its own block (attribute values are
 * markup, as on a page, and meet the LEAKS shapes with the rest of it). XML elements are not HTML blocks, so the feed read as a page would join one element's text to the next
 * ("...<hash></id><title>Lab 05" reads as "...<hash>Lab 05"): a hash glued to a word is no longer a whole token, is not
 * masked, and its digits read as a long id. Each piece on its own is how a reader sees it.
 */
export function feedText(source) {
  const { tree, problems } = parseXml(source);
  if (problems.length) return null;
  const pieces = [];
  (function walk(el) { pieces.push(el.text); el.children.forEach(walk); })(tree);
  return pieces.filter(p => p.trim()).map(p => `<p>${escape(p)}</p>`).join('');
}

/** Every feed checked and screened; the build throws on any problem. `known` are the hashes the runs hold. */
export function checkedFeeds(feeds, known) {
  const problems = [];
  for (const [path, source] of Object.entries(feeds)) {
    problems.push(...feedProblems(source, { self: `${SITE_URL}${path}`, where: path }));
    // The kit's screen over what a reader sees, piece by piece; the markup itself still meets the LEAKS shapes whole.
    const text = feedText(source);
    if (text !== null) problems.push(...pageLeaks(text, known).map(p => `${path}: ${p}`));
    for (const [pattern, reason] of LEAKS) if (pattern.test(source)) problems.push(`${path}: ${reason} (markup)`);
  }
  if (problems.length) throw new Error(`Atom feeds refused:\n  ${problems.join('\n  ')}`);
  return feeds;
}

export { recordHashes };
