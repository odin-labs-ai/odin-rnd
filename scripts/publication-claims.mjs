// A bounded publication tripwire, not an automated scientific review. Source identity, replay and
// passing checks must not become assurances of correctness in page copy or sharing surfaces.
// This deliberately does not ban the word "proof", alter records, or assign evidence grades.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { decode, shownText } from './lab-kit.mjs';
import { parseAttributes } from './number-provenance.mjs';
import { candidates } from './updates.mjs';
import { parseXml, updateEntryId, updateSummary } from './lab-feeds.mjs';

const OVERCLAIMS = [
  [/\bevery model and vendor,?\s+tested\b/gi, 'name the selected models and vendors; the lab has not tested every provider'],
  [/\b(?:review,\s*fix and ship real software|reviews?,\s*fixes? and research(?: it does)?) every day\b/gi, 'published records do not establish a daily delivery rate'],
  [/\bsame (?:pre-registered )?rules as (?:everyone else|every other provider)\b/gi, 'compare providers under the decision rules of a named experiment'],
  [/\b(?:verified|proven) answers?\b/gi, 'source cards do not establish answer correctness'],
  [/\banswers? with proof\b/gi, 'name the source record or citation instead of promising proof'],
  [/\bindependently (?:verified|validated|reproduced|replicated)\b/gi, 'independent verification needs its own reviewed evidence; an org replay is not independent'],
  [/\b(?:hash|sha256|digest)\s+(?:proves?|verifies?|guarantees?)\s+(?:(?:that|the|an?|our|this|its)\s+){0,2}(?:answers?|results?|claims?|correctness|accuracy|truth|reliability)\b/gi, 'a digest binds bytes, not the truth of their claims'],
];

// A deliberately small denial grammar, not general negation detection. The whole statement
// prefix must be a clear negative frame, and the phrase must close before any new assertion.
// Nested negations ("it is false that ... not"), "not only", "without", and suffix modifiers
// ("not verified answers in name only") must not silently exempt an affirmative claim.
const DENIAL_PREFIX = /^(?:not(?: yet)?(?: an?)?|(?:this|these|it|they) (?:is|are|was|were) not(?: yet)?(?: an?)?|a source card, not an?)\s*["'“‘]?\s*$/i;
const DENIAL_END = /^\s*["'”’]?\s*(?:[.!?;:]|$)/;
function isExplicitDenial(text, match) {
  const before = text.slice(0, match.index);
  const prefix = before.slice(Math.max(...['.', '!', '?', ';'].map(mark => before.lastIndexOf(mark))) + 1).trimStart();
  const after = text.slice(match.index + match[0].length);
  if (DENIAL_PREFIX.test(prefix)) return DENIAL_END.test(after);
  // "No verified answers are claimed" is a denial; "no verified answers are wrong" is not.
  if (/^no\s*["'“‘]?\s*$/i.test(prefix)) return /^\s*["'”’]?\s*(?:(?:is|are) claimed\s*)?(?:[.!?;:]|$)/i.test(after);
  return false;
}
export function claimTextProblems(text, where = 'text') {
  const normalized = String(text).normalize('NFKC').replace(/\s+/g, ' ');
  const problems = [];
  for (const [pattern, reason] of OVERCLAIMS) {
    for (const match of normalized.matchAll(pattern)) {
      if (isExplicitDenial(normalized, match)) continue;
      problems.push(`${where}: ${JSON.stringify(match[0])}: ${reason}`);
    }
  }
  return problems;
}

/** All reader-visible blocks, plus text that link previews and assistive technology can show. */
export function pageClaimProblems(html, where) {
  const problems = [];
  const visible = decode(shownText(html, { breaks: true }));
  for (const [i, block] of visible.split('\n').entries()) problems.push(...claimTextProblems(block, `${where}: text block ${i + 1}`));
  // No tag-name assumption: single/unquoted attributes and case variants count too.
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const attrs = parseAttributes(match[2]);
    for (const attr of ['alt', 'title', 'aria-label', 'aria-description']) {
      if (attrs.has(attr)) problems.push(...claimTextProblems(decode(attrs.get(attr)), `${where}: ${attr}`));
    }
    if (match[1].toLowerCase() === 'meta') {
      const key = (attrs.get('name') ?? attrs.get('property') ?? '').toLowerCase();
      if (/^(?:description|(?:og|twitter):(?:title|description|image:alt))$/.test(key)) {
        problems.push(...claimTextProblems(decode(attrs.get('content') ?? ''), `${where}: ${key}`));
      }
    }
  }
  return problems;
}

/** Exported update copy retains the full source status, including caveats and its original kind. */
export function updateClaimProblems(feed, expected) {
  if (feed?.schemaVersion !== 1 || !Array.isArray(feed.updates)) return ['data/updates.json: expected updates schemaVersion 1'];
  const problems = [];
  const byKey = new Map(expected.map(u => [u.key, u]));
  const seen = new Set();
  for (const update of feed.updates) {
    const where = `data/updates.json: ${update.key}`;
    if (seen.has(update.key)) problems.push(`${where}: duplicate update`);
    seen.add(update.key);
    const source = byKey.get(update.key);
    if (!source) problems.push(`${where}: no source candidate`);
    else for (const field of ['title', 'kind', 'text', 'href', 'source', 'experiment']) {
      if (update[field] !== source[field]) problems.push(`${where}: ${field} differs from the full source candidate; do not truncate or upgrade its evidence`);
    }
    for (const field of ['title', 'text']) problems.push(...claimTextProblems(update[field] ?? '', `${where}: ${field}`));
  }
  for (const key of byKey.keys()) if (!seen.has(key)) problems.push(`data/updates.json: missing source update ${key}`);
  return problems;
}

/** Atom copies an update's full caveated summary, never just the headline of an experiment. */
export function atomClaimProblems(xml, updates, where) {
  const { tree, problems: parse } = parseXml(xml);
  if (parse.length) return parse.map(p => `${where}: ${p}`);
  const problems = [];
  const byId = new Map(updates.map(u => [updateEntryId(u), u]));
  const texts = node => {
    if (['title', 'subtitle', 'summary', 'content'].includes(node.name)) problems.push(...claimTextProblems(node.text, `${where}: ${node.name}`));
    node.children.forEach(texts);
  };
  texts(tree);
  for (const entry of tree.children.filter(e => e.name === 'entry')) {
    const field = name => entry.children.filter(e => e.name === name);
    const id = field('id')[0]?.text;
    const update = byId.get(id);
    if (!update) continue; // Lab runs and dispatches have their own record validators.
    const expectedTitle = `${update.kind}${update.experiment ? ` · ${update.experiment}` : ''}: ${update.title}`;
    if (field('title').length !== 1 || field('title')[0].text !== expectedTitle) problems.push(`${where}: ${update.key} loses or changes its source kind/title`);
    if (field('summary').length !== 1 || field('summary')[0].text !== updateSummary(update)) problems.push(`${where}: ${update.key} must retain its full source summary and caveats or the explicit link-only notice`);
  }
  return problems;
}

/** A built page carries one visible boundary, whose own link reaches the publication standard. */
export function publicationBoundaryProblems(html, file) {
  const tags = [...html.matchAll(/<([a-z][a-z0-9-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)];
  const boundaries = tags.filter(m => parseAttributes(m[2]).get('id') === 'publication-boundary');
  if (boundaries.length !== 1) return [`${file}: expected exactly one publication-boundary, found ${boundaries.length}`];
  const open = boundaries[0];
  if (open[1].toLowerCase() !== 'aside') return [`${file}: publication-boundary must be a visible aside`];
  const close = html.toLowerCase().indexOf('</aside>', open.index + open[0].length);
  if (close < 0) return [`${file}: publication-boundary aside is not closed`];
  const body = html.slice(open.index + open[0].length, close);
  const links = [...body.matchAll(/<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)].map(m => parseAttributes(m[1]).get('href'));
  const correct = links.some(href => {
    if (typeof href !== 'string' || /^[a-z]+:|^\/\//i.test(href)) return false;
    const [path, fragment] = href.split('#');
    if (fragment !== 'publication-standard') return false;
    let target = path ? posix.normalize(posix.join(posix.dirname(file), path)) : file;
    if (path.endsWith('/')) target = posix.join(target, 'index.html');
    return target === 'methods/index.html';
  });
  return correct ? [] : [`${file}: publication-boundary must itself link to methods/#publication-standard`];
}

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

/** Every built HTML page, Atom .xml/.atom feed and update entry is checked; raw research records are untouched. */
export function checkPublicationClaims({ dist = 'dist', root = '.', expectedUpdates } = {}) {
  if (!existsSync(dist)) return [`${dist}: build the site before checking publication claims`];
  const problems = [];
  const feedPath = join(dist, 'data/updates.json');
  if (!existsSync(feedPath)) return [`${feedPath}: missing progress feed`];
  let feed;
  try { feed = JSON.parse(readFileSync(feedPath, 'utf8')); }
  catch { return [`${feedPath}: malformed progress feed`]; }
  let expected;
  try { expected = expectedUpdates ?? candidates(root); }
  catch (error) { return [`${feedPath}: cannot derive source candidates: ${error.message}`]; }
  problems.push(...updateClaimProblems(feed, expected));
  for (const file of walk(dist)) {
    const where = file.slice(dist.length + 1);
    if (file.endsWith('.html')) {
      const html = readFileSync(file, 'utf8');
      problems.push(...pageClaimProblems(html, where), ...publicationBoundaryProblems(html, where));
    }
    if (/\.(?:xml|atom)$/i.test(file)) {
      const xml = readFileSync(file, 'utf8');
      // A feed may be named updates.xml or progress.atom. Preserve strict checks for conventional
      // feed paths and .atom even when malformed; recognize other XML by its Atom content. A
      // sitemap's urlset has no Atom content and is not an Atom feed.
      if (/\.atom$|(?:^|\/)feed\.xml$/i.test(file) || /<(?:[\w.-]+:)?(?:feed|entry)\b|http:\/\/www\.w3\.org\/2005\/Atom/.test(xml)) {
        problems.push(...atomClaimProblems(xml, feed.updates ?? [], where));
      }
    }
  }
  return problems;
}
