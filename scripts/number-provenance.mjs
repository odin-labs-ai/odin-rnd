// Number provenance (vp-grow-odin-r-d bundle-3 WO-04): on the lab's provider-economics, evidence and provider pages,
// every number a reader can see must come from a published experiment record, and must link to it. scripts/build.mjs
// runs this over the finished pages in dist/ and refuses the build (scripts/check.mjs is pinned by EXP 006 and EXP 007
// and stays unchanged); scripts/number-provenance.test.mjs pins the behaviour.
//
// The rule, for each page in PAGES:
//   - The page must exist in dist/. A listed page that is missing fails the build (fail closed).
//   - A sourced number is a leaf link (<a> with no child tags) whose href is its record and which carries
//     data-source="data/<file>#<JSON pointer>" and data-format="<kind>", so every number links to its run. Its file must be an experiment record (SOURCE_FILE: a results or pre-registration record,
//     or a weekly probe record) present in dist/, the pointer must resolve to a finite number, and the element's text
//     must equal format(value, kind) exactly. Page configuration files (evidence.json and the like) are never a source:
//     a number typed into them would otherwise pass.
//   - Every local href and src on the page resolves to a file in dist/ (a folder link to its index.html).
//   - Every other digit in the page's visible body text, and in its aria-label, alt and title attributes, fails, with
//     these exemptions only: an identifier in <code> (isIdentifier: model ids such as gpt-4o-mini, file paths); a date in
//     <time> whose text is the start of its datetime attribute (2026-10-23, 2026-W43); and the identifier tokens in
//     EXEMPT_TOKENS (EXP 017, sha256, p50, p95, 5xx).
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { MEASURED } from './provider-terms.mjs';

/** Pages under dist/ that the rule covers. A page added here must exist in every build. */
export const PAGES = ['provider-economics/index.html', 'evidence/index.html'];

/** The only files a number may come from: published experiment records. */
export const SOURCE_FILE = /^data\/(?:[a-z0-9-]+\/(?:results|preregistration)\.json|broker-probe\/\d{4}-W\d{2}\.json)$/;

/** Identifier tokens that contain digits but are not numbers. Enumerated; tested one by one. */
export const EXEMPT_TOKENS = [/\bEXP \d{3}\b/g, /\bsha256\b/gi, /\bp(?:50|95)\b/g, /\b5xx\b/g];

const DATE_TEXT = /^(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?|\d{4}-W\d{2})$/;

/** How a sourced value is shown. Pure: the renderer and this check call the same function. */
export function format(value, kind) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`not a finite number: ${JSON.stringify(value)}`);
  switch (kind) {
    case 'int': if (!Number.isInteger(value)) throw new Error(`not an integer: ${value}`); return String(value);
    case 'num': return String(value);
    case 'usd': return `$${String(value)}`;
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

const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const attr = (attrs, name) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];

/**
 * Problems on one page. `html` is the built page; `readData(path)` returns the text of a file under dist/ (path like
 * 'data/x/results.json') or null when it does not exist; `exists(path)` says whether a dist/-relative file exists.
 */
export function checkPage(file, html, readData, exists = path => readData(path) !== null) {
  const problems = [];
  const say = message => problems.push(`${file}: ${message}`);
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) { say('no <body>'); return problems; }
  let body = bodyMatch[1].replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ');

  // Local links: each must resolve to a built file.
  for (const [, link] of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue;
    const path = decodeURIComponent(link.split('#')[0].split('?')[0]);
    if (!path) continue;
    let target = posix.normalize(posix.join(posix.dirname(file), path));
    if (path.endsWith('/') || target === '.') target = posix.join(target, 'index.html');
    if (target.startsWith('..') || !exists(target)) say(`dead link '${link}'`);
  }

  // Attributes a reader (or a screen reader) is given as text.
  for (const [, name, value] of body.matchAll(/\b(aria-label|alt|title)="([^"]*)"/g)) {
    const rest = stripExempt(decode(value));
    if (/\d/.test(rest)) say(`digit in ${name}="${value.slice(0, 80)}"`);
  }

  // Sourced numbers: verified, then removed from the text.
  const cache = new Map();
  body = body.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-source="[^"]*"[^>]*)>([^<]*)<\/\1>/gi, (whole, tag, attrs, text) => {
    const source = attr(attrs, 'data-source');
    const kind = attr(attrs, 'data-format');
    const shown = decode(text).trim();
    const [path, pointer = ''] = source.split('#');
    const href = attr(attrs, 'href');
    if (tag.toLowerCase() !== 'a' || !href || posix.normalize(posix.join(posix.dirname(file), href.split('#')[0])) !== path) say(`data-source '${source}' is not a link to its record (<a href> to ${path} from ${file})`);
    if (!SOURCE_FILE.test(path)) { say(`data-source '${source}' is not an experiment record (only ${SOURCE_FILE})`); return ' '; }
    if (!cache.has(path)) { const raw = readData(path); cache.set(path, raw === null ? null : JSON.parse(raw)); }
    const doc = cache.get(path);
    if (doc === null) { say(`data-source '${source}': ${path} is not in the built site`); return ' '; }
    const value = resolvePointer(doc, decodeURIComponent(pointer));
    if (value === undefined) { say(`data-source '${source}': the pointer does not resolve`); return ' '; }
    let want;
    try { want = format(value, kind); } catch (error) { say(`data-source '${source}': ${error.message}`); return ' '; }
    if (shown !== want) say(`data-source '${source}' shows '${shown}' but the record holds ${JSON.stringify(value)} (renders '${want}')`);
    return ' ';
  });

  // A data-source on an element with child tags is not a leaf: its digits stay in the text and fail below.
  // Exempt elements: <code> without a measured figure, <time> whose text starts its datetime.
  body = body.replace(/<code\b[^>]*>([^<]*)<\/code>/gi, (whole, text) => (isIdentifier(decode(text).trim()) ? ' ' : whole));
  body = body.replace(/<time\b([^>]*)>([^<]*)<\/time>/gi, (whole, attrs, text) => {
    const shown = decode(text).trim();
    const datetime = attr(attrs, 'datetime') ?? '';
    return DATE_TEXT.test(shown) && datetime.startsWith(shown) ? ' ' : whole;
  });

  const text = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const rest = stripExempt(text);
  for (const match of rest.matchAll(/\d/g)) {
    const at = match.index;
    say(`unsourced digit: "…${rest.slice(Math.max(0, at - 50), at + 30).trim()}…"`);
    break; // one report per page is enough to fail; the context points at the first.
  }
  return problems;
}

/** An identifier in <code> (a model id, a file path): no spaces, two letters in a row, no measured figure. */
export function isIdentifier(text) {
  return /^[A-Za-z0-9._\/:@+~-]+$/.test(text) && /[A-Za-z]{2}/.test(text) && !MEASURED.test(text);
}

function stripExempt(text) {
  let out = text;
  for (const token of EXEMPT_TOKENS) out = out.replace(token, ' ');
  return out;
}

/** Problems for every page in PAGES under `dist`. A missing page is a problem. */
export function checkSite(dist = 'dist', pages = PAGES) {
  const readData = path => { const full = join(dist, path); return existsSync(full) ? readFileSync(full, 'utf8') : null; };
  const exists = path => existsSync(join(dist, path));
  const problems = [];
  for (const page of pages) {
    const full = join(dist, page);
    if (!existsSync(full)) { problems.push(`${page}: the page is listed in scripts/number-provenance.mjs PAGES but is not in the build`); continue; }
    problems.push(...checkPage(page, readFileSync(full, 'utf8'), readData, exists));
  }
  return problems;
}
