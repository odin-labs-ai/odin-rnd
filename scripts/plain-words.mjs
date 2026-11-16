// The plain-language word lists and the reader that applies them, shared by the home page's tests
// (scripts/home-plain-language.test.mjs) and the How we test page's (scripts/methods-glossary.test.mjs). Moved here
// unchanged from home-plain-language.test.mjs (mission rnd-site-human PR 2, 2026-11-16) so a second test file can use
// them without importing, and so re-running, the home's built-page tests.
import { stripBlocks, stripTags } from './test-html-text.mjs';

export const jargon = [
  ['fixture', /\bfixtures?\b/i],
  ['specimen', /\bspecimens?\b/i],
  ['conforming', /\bconforming\b/i],
  ['drifted', /\bdrifted\b/i],
  ['discrimination', /\bdiscrimination\b/i],
  ['recipe', /\brecipes?\b/i],
  ['authored', /\bauthored\b/i],
  // Case-sensitive: the abbreviation, not the bce-engine package name a reader copies.
  ['BCE', /\bBCE\b/],
];

/**
 * The plain-language home (2026-11-16; founder: "too technical / jargon", "hard to navigate"; mission rnd-site-human
 * PLAN B3). Words and marks banned from the part of the home a visitor reads first: the header navigation, the hero's
 * premise and its dated correction summary, what we've found (#findings), the plain heading and sentence over the
 * drawing and its toolbar, the "Go further" list and the fold summaries. The lab's
 * working words stay on the detail pages, in "How we checked" folds and in the records. The station drawing, the
 * latest updates and the folded sections are rewritten in later PRs of the same plan (PR 5, PR 6), so they are not
 * read here yet; their old wording is listed in the plan.
 */
export const plainBanned = [
  ['Open a station', /\bopen a station\b/i],
  ['workbench', /\bworkbench(?:es)?\b/i],
  ['station evidence is unavailable', /\bstation evidence is unavailable\b/i],
  ['frontier', /\bfrontier\b/i],
  ['arm', /\barms?\b/i],
  ['seat', /\bseats?\b/i],
  ['census', /\bcensus\b/i],
  ['strict-ack', /\bstrict-ack\b/i],
  ['frozen analysis', /\bfrozen analysis\b/i],
  ['validity gates', /\bvalidity gates?\b/i],
  ['informative', /\b(?:un)?informative\b/i],
  // A bare "pre-registered" with no gloss: say "we wrote down the question and the pass mark before running it".
  ['pre-registered', /\bpre-?regist(?:ered|ration)\b/i],
  ['sha256', /\bsha-?256\b/i],
  // A commit id or record hash: seven or more hex characters with a digit and a letter among them.
  ['commit or hash', /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/],
  ['results.json', /\bresults\.json\b/i],
  ['Record <hex>', /\bRecord [0-9a-f]{6,}\b/],
  ['runner or host name', /\b(?:org-ci-heavy|ubuntu-latest|macos-latest|windows-latest)\b/i],
  ['pipeline decoration', /\bINTENT\s*(?:→|->)\s*EVIDENCE\b|\bBLUEPRINT\s*(?:→|->)\s*WORKCELL\b/i],
];

/** Every banned word in `text`, with a little context either side. */
export function bannedIn(text, list = plainBanned) {
  const found = [];
  for (const [word, re] of list) for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
    found.push(`${word}: …${text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30)}…`);
  }
  return found;
}

const decode = text => text.replace(/&#39;|&quot;|&lt;|&gt;|&nbsp;/g, m => ({ '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[m]).replaceAll('&amp;', '&');

/** What a visitor reads on a page: text outside script, style and svg, plus aria-label, alt and title values. Inside the
 *  Tools row 001 heading only the product name itself is set aside (its full name, or link text that is exactly "BCE");
 *  every other word in that heading is read like the rest of the page. */
export const productName = 'Blueprint Conformance Engine';
export function readable(html) {
  const tool = /(<div class="project-number">001<span>ENGINE<\/span><\/div><div class="project-description"><h3>)([\s\S]*?)(<\/h3>)/;
  const named = html.replace(tool, (_, open, heading, close) => open + heading.replaceAll(productName, ' ').replace(/>BCE</g, '> <') + close);
  const body = stripBlocks(named, ['script', 'style', 'svg']);
  const attributes = [...body.matchAll(/\b(?:aria-label|alt|title)="([^"]*)"/g)].map(m => m[1]);
  return decode(`${stripTags(body)} ${attributes.join(' ')}`).replace(/\s+/g, ' ');
}

/** Every listed word in `text`, with a little context either side. */
export function jargonIn(text) {
  const found = [];
  for (const [word, re] of jargon) for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
    found.push(`${word}: …${text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30)}…`);
  }
  return found;
}

