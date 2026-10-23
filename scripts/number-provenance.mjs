// Number provenance (vp-grow-odin-r-d bundle-3 WO-04): on the lab's provider-economics, evidence and providers pages,
// every number a reader can see must come from a published experiment record, and must link to it. scripts/build.mjs
// runs this over the finished pages in dist/ and refuses the build (scripts/check.mjs is pinned by EXP 006 and EXP 007
// and stays unchanged); scripts/number-provenance.test.mjs pins the behaviour.
//
// The rule, for each page in PAGES:
//   - The page must exist in dist/. A listed page that is missing fails the build (fail closed).
//   - A sourced number is a leaf link (<a> with no child tags) whose href attribute is its record and which carries
//     data-source="data/<file>#<JSON pointer>" and data-format="<kind>", so every number links to its run. The pointer
//     must resolve to a finite number and the element's text must equal format(value, kind) exactly.
//   - The record must be a measured experiment record (recordProblem): data/<slug>/results.json that is byte for byte
//     experiments/<slug>/results.json, names experiments/<slug>/preregistration.json as its pre-registration, and that
//     pre-registration matches its committed preregistration.sha256; or a weekly probe record whose kind and week match
//     its file name. A pre-registration (planned values), page configuration (evidence.json and the like) or any other
//     file is never a source. Limit: a whole fabricated experiment folder would pass this check; review of the PR that
//     adds it is the guard against that, and the folder is public.
//   - Every local href and src on the page resolves to a file in dist/ (a folder link to its index.html).
//   - Every other digit (any Unicode decimal digit) and every number word (NUMBER_WORDS: one, two, first, dozen, ...) in
//     the visible body text, and in the text-bearing attributes (TEXT_ATTRIBUTES, any quoting), fails, with these
//     exemptions only: an identifier in <code> (isIdentifier: model ids such as gpt-4o-mini, file paths); a date in
//     <time> whose text is the start of its datetime attribute (2026-10-23, 2026-W43); and the identifier tokens in
//     EXEMPT_TOKENS (EXP 017, sha256, p50, p95, 5xx).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { MEASURED } from './provider-terms.mjs';

/** Pages under dist/ that the rule covers. A page added here must exist in every build. */
export const PAGES = ['provider-economics/index.html', 'evidence/index.html', 'providers/index.html'];

/** The only path shapes a number may come from: a results record or a weekly probe record. */
export const SOURCE_FILE = /^data\/(?:[a-z0-9-]+\/results\.json|broker-probe\/\d{4}-W\d{2}\.json)$/;

/** Identifier tokens that contain digits but are not numbers. Enumerated; tested one by one. */
export const EXEMPT_TOKENS = [/\bEXP \d{3}\b/g, /\bsha256\b/gi, /\bp(?:50|95)\b/g, /\b5xx\b/g];

/** Counts written as words are numbers too: a page may not state one that no record supplies. */
export const NUMBER_WORDS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundredfold|thousand|million|billion|dozens?|half|halves|twice|thrice|double|triple|single|both|first|second|third|fourth|fifth|tenth|once)\b/i;

/** Attributes whose values a reader or a screen reader is given as text. */
export const TEXT_ATTRIBUTES = new Set(['aria-label', 'aria-description', 'aria-valuetext', 'aria-roledescription', 'alt', 'title', 'placeholder', 'value', 'label', 'summary']);

const DIGIT = /\p{Nd}/u;
const DATE_TEXT = /^(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?|\d{4}-W\d{2})$/;

/** How a sourced value is shown. Pure: the renderer and this check call the same function. */
export function format(value, kind) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`not a finite number: ${JSON.stringify(value)}`);
  const plain = v => { const s = String(v); if (/e/i.test(s)) throw new Error(`${s} has no plain decimal form`); return s; };
  switch (kind) {
    case 'int': if (!Number.isInteger(value)) throw new Error(`not an integer: ${value}`); return plain(value);
    case 'num': return plain(value);
    case 'usd': return `$${plain(value)}`;
    case 'pct': return `${(value * 100).toFixed(0)}%`;
    default: throw new Error(`unknown data-format '${kind}'`);
  }
}

/** RFC 6901 JSON pointer ('' is the whole document). Returns undefined when any step is missing. */
export function resolvePointer(doc, pointer) {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) return undefined;
  let at = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (at === null || typeof at !== 'object' || !Object.prototype.hasOwnProperty.call(at, key)) return undefined;
    at = at[key];
  }
  return at;
}

/**
 * Why the file at `path` (site-relative, e.g. data/review-frontier/results.json) with published text `raw` is not a
 * measured experiment record, or null when it is. `root` is the repository checkout.
 */
export function recordProblem(path, raw, root = '.') {
  if (!SOURCE_FILE.test(path)) return `${path} is not a results record or a weekly probe record`;
  let doc;
  try { doc = JSON.parse(raw); } catch { return `${path} is not JSON`; }
  const probe = path.match(/^data\/broker-probe\/(\d{4}-W\d{2})\.json$/);
  if (probe) return doc.kind === 'odin-rnd.broker-probe' && doc.week === probe[1] ? null : `${path} is not the probe record of week ${probe[1]}`;
  const slug = path.split('/')[1];
  const dir = join(root, 'experiments', slug);
  const committed = join(dir, 'results.json');
  if (!existsSync(committed) || readFileSync(committed, 'utf8') !== raw) return `${path} is not byte for byte experiments/${slug}/results.json`;
  if (doc.kind !== 'odin-rnd.results' || doc.slug !== slug || doc.preregistration !== `experiments/${slug}/preregistration.json`) return `${path} does not name experiments/${slug}/preregistration.json as its pre-registration`;
  const prereg = join(dir, 'preregistration.json'), pin = join(dir, 'preregistration.sha256');
  if (!existsSync(prereg) || !existsSync(pin)) return `experiments/${slug} has no frozen pre-registration`;
  const want = readFileSync(pin, 'utf8').trim().split(/\s+/)[0];
  if (createHash('sha256').update(readFileSync(prereg)).digest('hex') !== want) return `experiments/${slug}/preregistration.json does not match its preregistration.sha256`;
  return null;
}

const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&amp;/g, '&');

/** The attributes of a start tag's attribute text, in any quoting, as a Map of lower-cased name → decoded value. */
export function parseAttributes(text) {
  const out = new Map();
  for (const m of text.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

const startTags = html => [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)].map(m => ({ tag: m[1].toLowerCase(), attrs: parseAttributes(m[2]) }));

/** Why `text` states a number no record supplies, or null. */
function unsourced(text) {
  let rest = text;
  for (const token of EXEMPT_TOKENS) rest = rest.replace(token, ' ');
  const digit = rest.match(DIGIT);
  if (digit) return `unsourced digit: "…${rest.slice(Math.max(0, digit.index - 50), digit.index + 30).trim()}…"`;
  const word = rest.match(NUMBER_WORDS);
  if (word) return `number word '${word[0]}' with no record behind it: "…${rest.slice(Math.max(0, word.index - 50), word.index + 30).trim()}…"`;
  return null;
}

/**
 * Problems on one page. `html` is the built page. `io.readData(path)` returns the text of a file under dist/ (path
 * like 'data/x/results.json') or null; `io.exists(path)` says whether a dist/-relative file exists;
 * `io.recordProblem(path, raw)` says why a source is not a measured experiment record (null when it is).
 */
export function checkPage(file, html, io) {
  const { readData, exists = path => readData(path) !== null, recordProblem: notRecord = (path, raw) => recordProblem(path, raw) } = io;
  const problems = [];
  const say = message => problems.push(`${file}: ${message}`);

  // Local links: each must resolve to a built file.
  for (const { attrs } of startTags(html)) for (const name of ['href', 'src']) {
    const link = attrs.get(name);
    if (link === undefined || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue;
    let path;
    try { path = decodeURIComponent(link.split('#')[0].split('?')[0]); } catch { say(`malformed link '${link}'`); continue; }
    if (!path) continue;
    let target = posix.normalize(posix.join(posix.dirname(file), path));
    if (path.endsWith('/') || target === '.') target = posix.join(target, 'index.html');
    if (target.startsWith('..') || !exists(target)) say(`dead link '${link}'`);
  }

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) { say('no <body>'); return problems; }
  let body = bodyMatch[1].replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ');

  // Text-bearing attributes, in any quoting.
  for (const { attrs } of startTags(body)) for (const [name, value] of attrs) {
    if (!TEXT_ATTRIBUTES.has(name)) continue;
    const why = unsourced(value);
    if (why) say(`${name}="${value.slice(0, 80)}": ${why}`);
  }

  // Sourced numbers: verified, then removed from the text.
  const cache = new Map();
  body = body.replace(/<([a-z][a-z0-9-]*)\b([^>]*)>([^<]*)<\/\1>/gi, (whole, tag, attrText, text) => {
    const attrs = parseAttributes(attrText);
    if (!attrs.has('data-source')) return whole;
    const source = attrs.get('data-source');
    const kind = attrs.get('data-format');
    const shown = decode(text).trim();
    const [path, pointer = ''] = source.split('#');
    const href = attrs.get('href');
    if (tag.toLowerCase() !== 'a' || !href || posix.normalize(posix.join(posix.dirname(file), href.split('#')[0])) !== path) say(`data-source '${source}' is not a link to its record (<a href> to ${path} from ${file})`);
    if (!cache.has(path)) {
      const raw = SOURCE_FILE.test(path) ? readData(path) : null;
      const why = !SOURCE_FILE.test(path) ? `not a measured experiment record (only ${SOURCE_FILE})` : raw === null ? `${path} is not in the built site` : notRecord(path, raw);
      cache.set(path, why ? { why } : { doc: JSON.parse(raw) });
    }
    const entry = cache.get(path);
    if (entry.why) { say(`data-source '${source}': ${entry.why}`); return ' '; }
    let value;
    try { value = resolvePointer(entry.doc, decodeURIComponent(pointer)); } catch { say(`data-source '${source}': malformed pointer`); return ' '; }
    if (value === undefined) { say(`data-source '${source}': the pointer does not resolve`); return ' '; }
    let want;
    try { want = format(value, kind); } catch (error) { say(`data-source '${source}': ${error.message}`); return ' '; }
    if (shown !== want) say(`data-source '${source}' shows '${shown}' but the record holds ${JSON.stringify(value)} (renders '${want}')`);
    return ' ';
  });

  // A data-source on an element with child tags is not a leaf: its digits stay in the text and fail below.
  // Exempt elements: an identifier in <code>, a <time> whose text starts its datetime.
  body = body.replace(/<code\b[^>]*>([^<]*)<\/code>/gi, (whole, text) => (isIdentifier(decode(text).trim()) ? ' ' : whole));
  body = body.replace(/<time\b([^>]*)>([^<]*)<\/time>/gi, (whole, attrText, text) => {
    const shown = decode(text).trim();
    const datetime = parseAttributes(attrText).get('datetime') ?? '';
    return DATE_TEXT.test(shown) && datetime.startsWith(shown) ? ' ' : whole;
  });

  const why = unsourced(decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '));
  if (why) say(why); // one report per page is enough to fail; the context points at the first.
  return problems;
}

/** An identifier in <code> (a model id, a file path): no spaces, two letters in a row, no measured figure. */
export function isIdentifier(text) {
  return /^[A-Za-z0-9._\/:@+~-]+$/.test(text) && /[A-Za-z]{2}/.test(text) && !MEASURED.test(text);
}

/** Problems for every page in PAGES under `dist`, with records bound to the checkout at `root`. A missing page fails. */
export function checkSite(dist = 'dist', pages = PAGES, root = '.') {
  const readData = path => { const full = join(dist, path); return existsSync(full) ? readFileSync(full, 'utf8') : null; };
  const exists = path => existsSync(join(dist, path));
  const io = { readData, exists, recordProblem: (path, raw) => recordProblem(path, raw, root) };
  const problems = [];
  for (const page of pages) {
    const full = join(dist, page);
    if (!existsSync(full)) { problems.push(`${page}: the page is listed in scripts/number-provenance.mjs PAGES but is not in the build`); continue; }
    problems.push(...checkPage(page, readFileSync(full, 'utf8'), io));
  }
  return problems;
}
