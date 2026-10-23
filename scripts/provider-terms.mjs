// Provider terms before naming (vp-grow-odin-r-d bundle-2 WO-05). A built page may name a broker next to a measured
// number only when site/data/provider-terms.json says that broker's terms allow it. scripts/build.mjs runs this over
// every finished HTML page and refuses the build (scripts/check.mjs is pinned by EXP 006 and EXP 007 and stays
// unchanged); scripts/provider-terms.test.mjs pins the behaviour.
//
// "Names a broker next to a measured number": the page's visible text is cut into segments at every block-level
// tag (any tag except the inline ones listed in INLINE and the table cells td/th, so a whole table row is one
// segment, and so is text inside a div or a bare text node). A segment that names a broker AND holds a measured
// figure is a named measurement. Figures: a money amount ($ € £, or USD/EUR/GBP before or after a number), a
// percentage, a duration (ms, s, sec, seconds, min), a multiplier (2x, 2×), a rate or count of tokens (tok/s,
// tokens, rps, req/s), cents (¢) or a latency percentile (p50, p90, p95, p99). A broker in one segment and a number
// in another is not caught. JSON records under data/ are not pages and are not scanned.
import { readFileSync } from 'node:fs';

export const TERMS_FILE = 'site/data/provider-terms.json';

/** Broker id → how its name is matched in page text (case-insensitive). */
export const BROKER_PATTERNS = {
  openrouter: /\bopen\s?router\b/i,
  eurouter: /\beu\s?router\b/i,
  requesty: /\brequesty\b/i,
  orq: /\borq(?:\.ai)?\b/i,
  doubleword: /\bdouble\s?word\b/i,
};

const N = String.raw`\d[\d,]*(?:\.\d+)?`;
export const MEASURED = new RegExp([
  String.raw`[$€£]\s?\d`, String.raw`\b(?:USD|EUR|GBP)\s?\d`, String.raw`${N}\s?(?:USD|EUR|GBP)\b`,
  String.raw`${N}\s?%`, String.raw`${N}\s?(?:ms|s|sec|secs|seconds?|min|minutes?)\b`, String.raw`${N}\s?[x×](?![a-z0-9])`,
  String.raw`${N}\s?[km]?\s?(?:tok\/s|tokens?|rps|req\/s)\b`, String.raw`${N}\s?¢`, String.raw`\bp(?:50|90|95|99)\b`,
].join('|'), 'i');

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'td', 'th']);
const ALLOWED_NAME_USE = new Set(['plain-text', 'plain-text-only']);
const ACCEPTED_READS = new Set(['human', 'agent-browser-verbatim']);

const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The visible text of `html`, cut at block-level tags. */
export function segments(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const cut = body.replace(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi, (tag, name) => (INLINE.has(name.toLowerCase()) ? ' ' : '\u0000'));
  return cut.split('\u0000').map(part => decode(part).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Every (broker, segment) pair where a segment names that broker next to a measured figure. */
export function namedMeasurements(html) {
  const hits = [];
  for (const text of segments(html)) {
    if (!MEASURED.test(text)) continue;
    for (const [id, pattern] of Object.entries(BROKER_PATTERNS)) if (pattern.test(text)) hits.push({ broker: id, text });
  }
  return hits;
}

/** Why `entry` does not allow naming its broker next to a number, or null when it does. Allowlists only. */
export function refusal(entry) {
  if (!entry) return 'no terms record';
  if (entry.benchmarking !== 'allowed') return `benchmarking is '${entry.benchmarking}'`;
  if (!ALLOWED_NAME_USE.has(entry.nameUse)) return `name use is '${entry.nameUse}'`;
  if (entry.founderReview?.required !== false) return `the terms are waiting on the lab owner's review (${entry.founderReview?.reason ?? 'no cleared review recorded'})`;
  if (!ACCEPTED_READS.has(entry.readBy)) return `read by '${entry.readBy}', which is not an accepted read`;
  if (entry.readBy !== 'human' && !/^[0-9a-f]{64}$/.test(entry.textSha256 ?? '')) return 'an agent read without the sha256 of the text it read';
  return null;
}

/** Shape errors in a terms record: unknown enum values, missing fields, unparseable dates. */
export function validateTerms(terms) {
  const errors = [];
  const enums = terms.enums ?? {};
  for (const [id, e] of Object.entries(terms.providers ?? {})) {
    for (const field of ['url', 'lastUpdated', 'readOn', 'readBy', 'benchmarking', 'nameUse', 'logoUse', 'quote']) if (typeof e[field] !== 'string' || !e[field]) errors.push(`${id}: ${field} is missing`);
    for (const [field, allowed] of Object.entries(enums)) if (!allowed.includes(e[field])) errors.push(`${id}: ${field} '${e[field]}' is not one of ${allowed.join(', ')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.readOn ?? '') || Number.isNaN(Date.parse(e.readOn))) errors.push(`${id}: readOn '${e.readOn}' is not a date`);
    if (typeof e.founderReview?.required !== 'boolean') errors.push(`${id}: founderReview.required must be true or false`);
  }
  if (!Object.keys(enums).length) errors.push('the record names no enums');
  return errors;
}

/** Entries whose read is older than staleAfterDays on `today` (YYYY-MM-DD), or whose read date is unparseable. */
export function staleEntries(terms, today = new Date().toISOString().slice(0, 10)) {
  const limit = Number(terms.staleAfterDays ?? 90);
  const day = 86400000;
  return Object.entries(terms.providers).filter(([, e]) => {
    const age = (Date.parse(today) - Date.parse(e.readOn)) / day;
    return Number.isNaN(age) || age > limit;
  }).map(([id, e]) => ({ id, readOn: e.readOn }));
}

/** Problems for every page in `pages` ({file, html}): one string per broker named next to a number without leave. */
export function checkPages(pages, terms) {
  const problems = [];
  for (const { file, html } of pages) {
    for (const { broker, text } of namedMeasurements(html)) {
      const why = refusal(terms.providers[broker]);
      if (why) problems.push(`${file} names ${broker} next to a measured number, but ${why}: "${text.slice(0, 160)}"`);
    }
  }
  return problems;
}

/** The record, refused when its shape is wrong (an unknown value never passes as an allowed one). */
export function loadTerms(file = TERMS_FILE) {
  const terms = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateTerms(terms);
  if (errors.length) throw new Error(`${file} is malformed:\n${errors.join('\n')}`);
  return terms;
}
