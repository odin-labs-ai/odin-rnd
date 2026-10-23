// Provider terms before naming (vp-grow-odin-r-d bundle-2 WO-05). A built page may name a broker next to a measured
// number only when site/data/provider-terms.json says that broker's terms allow it. scripts/build.mjs runs this over
// every finished HTML page and refuses the build (scripts/check.mjs is pinned by EXP 006 and EXP 007 and stays
// unchanged); scripts/provider-terms.test.mjs pins the behaviour.
//
// "Names a broker next to a measured number", narrowly: one block of the page (the text of a p, li, tr, td, th,
// h1-h6, dt, dd, caption, figcaption, blockquote or pre element, tags stripped) contains a broker's name AND a
// measured figure: a money amount ($ or €, then a digit), a percentage (a digit, then %), a duration in
// milliseconds (a digit, then ms), cents (a digit, then ¢) or a latency percentile (p50, p95, p99). A broker named
// in one block and a number in another block is not caught; a table row is one block, so a name and a number in
// the same row are. JSON records under data/ are not pages and are not scanned.
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

const MEASURED = /[$€]\s?\d|\d\s?%|\d\s?ms\b|\d\s?¢|\bp(?:50|95|99)\b/i;
const BLOCK = /<(p|li|tr|td|th|h[1-6]|dt|dd|caption|figcaption|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const ACCEPTED_READS = new Set(['human', 'agent-browser-verbatim']);
const BLOCKED_NAME_USE = new Set(['consent-required', 'unclear']);

const textOf = html => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Every (broker, block text) pair where a block names that broker next to a measured figure. */
export function namedMeasurements(html) {
  const hits = [];
  for (const [, , inner] of html.matchAll(BLOCK)) {
    const text = textOf(inner);
    if (!MEASURED.test(text)) continue;
    for (const [id, pattern] of Object.entries(BROKER_PATTERNS)) if (pattern.test(text)) hits.push({ broker: id, text });
  }
  return hits;
}

/** Why `entry` does not allow naming its broker next to a number, or null when it does. */
export function refusal(entry) {
  if (!entry) return 'no terms record';
  if (entry.benchmarking !== 'allowed') return `benchmarking is '${entry.benchmarking}'`;
  if (BLOCKED_NAME_USE.has(entry.nameUse)) return `name use is '${entry.nameUse}'`;
  if (entry.founderReview?.required) return `the terms are waiting on the lab owner's review (${entry.founderReview.reason ?? 'no reason given'})`;
  if (!ACCEPTED_READS.has(entry.readBy)) return `read by '${entry.readBy}', which is not an accepted read`;
  if (entry.readBy !== 'human' && !/^[0-9a-f]{64}$/.test(entry.textSha256 ?? '')) return 'an agent read without the sha256 of the text it read';
  return null;
}

/** Entries whose read is older than staleAfterDays on `today` (YYYY-MM-DD). A warning, never a failure. */
export function staleEntries(terms, today = new Date().toISOString().slice(0, 10)) {
  const limit = Number(terms.staleAfterDays ?? 90);
  const day = 86400000;
  return Object.entries(terms.providers).filter(([, e]) => (Date.parse(today) - Date.parse(e.readOn)) / day > limit).map(([id, e]) => ({ id, readOn: e.readOn }));
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

export const loadTerms = (file = TERMS_FILE) => JSON.parse(readFileSync(file, 'utf8'));
