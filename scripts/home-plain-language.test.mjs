// The home page reads human-first (mission rnd-labs-human-first-1024, founder 2026-10-24: "what we put should
// resonate with humans first agents second"). The lab's working words stay on the detail pages, the experiments page
// and the records; the built home carries none of them in what a visitor reads: its text and its aria-label, alt and
// title values. Links, ids and class names are not read (a source link may point into a fixtures/ folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';
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
 * premise and drawing, what we've found (#findings), the plain heading and dated correction notice after it,
 * the "Go further" list and the fold summaries. The lab's
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

/** The end of the element opening at `at`, matched to its own close tag (same name, nesting counted). */
function elementEnd(html, at) {
  const name = /^<([a-z][a-z0-9]*)/i.exec(html.slice(at))[1];
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  tags.lastIndex = at;
  let depth = 0;
  for (let m; (m = tags.exec(html));) { depth += m[1] ? -1 : 1; if (depth === 0) return m.index + m[0].length; }
  throw new Error(`unclosed <${name}>`);
}

/** The first element whose start tag matches `open`, whole, or '' when there is none. */
const elementAt = (html, open) => { const m = open.exec(html); return m ? html.slice(m.index, elementEnd(html, m.index)) : ''; };

/** What the plain-language rule reads on the built home (see plainBanned): each part, by name, as HTML. */
export function homeFirstRead(home) {
  return {
    'header nav': elementAt(elementAt(home, /<header class="site-header[ "]/), /<nav\b/),
    'hero premise': elementAt(home, /<div class="factory-premise"/),
    'drawing toolbar': elementAt(home, /<div class="drawing-toolbar"/),
    'how we check intro': elementAt(home, /<div class="home-check-intro"/),
    'correction notice': elementAt(home, /<div class="factory-correction correction-note"/),
    'what we found': elementAt(home, /<section\b[^>]*\sid="findings"/),
    'go further': elementAt(home, /<nav class="home-further/),
    'fold summaries': [...home.matchAll(/<details class="home-fold"><summary>([^<]*)</g)].map(m => `<p>${m[1]}</p>`).join(''),
  };
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

test('the reader catches every listed word in text and in what assistive technology reads, and skips links and markup', () => {
  for (const [word] of jargon) {
    const sample = word === 'BCE' ? 'the BCE engine' : `one ${word} here`;
    assert.equal(jargonIn(readable(`<p>${sample}</p>`)).length, 1, `${word} in text`);
    assert.equal(jargonIn(readable(`<button aria-label="${sample}">x</button>`)).length, 1, `${word} in an aria-label`);
  }
  assert.equal(jargonIn(readable('<img alt="Specimens">')).length, 1, 'plural and capitalised');
  assert.deepEqual(jargonIn(readable('<a class="specimen-pair" href="https://example.invalid/fixtures/x" id="recipe">A rule</a>')), [], 'links, ids and class names are not read');
  assert.deepEqual(jargonIn(readable('<script>const recipe = 1;</script><p>npm exec --package=bce-engine@0.3.1</p>')), [], 'scripts and the lowercase package name are not read');
  assert.deepEqual(jargonIn(readable('<p>Blueprint Conformance Engine</p>')), [], '"Conformance" is not "conforming"');
  const heading = inner => `<div class="project-number">001<span>ENGINE</span></div><div class="project-description"><h3>${inner}</h3><p>Rules.</p>`;
  assert.deepEqual(jargonIn(readable(heading(`<a href="x">${productName} <span aria-hidden="true">↗</span></a>`))), [], 'the product name stands in its heading');
  assert.deepEqual(jargonIn(readable(heading('<a href="x">BCE</a>'))), [], 'link text that is exactly the product abbreviation stands');
  assert.equal(jargonIn(readable(heading(`<a href="x">${productName}</a> runs recipes`))).length, 1, 'a listed word inside the same heading is caught');
  assert.equal(jargonIn(readable(heading('<a href="x">The BCE engine</a>'))).length, 1, 'the abbreviation inside a longer heading text is caught');
  assert.equal(jargonIn(readable(`${heading(`<a href="x">${productName}</a>`)}<p>The BCE way.</p>`)).length, 1, 'outside that heading the abbreviation is caught');
});

test('the built home page carries none of the lab\'s working words', { timeout: 600_000 }, () => {
  const home = readFileSync(join(builtCopy(), 'dist', 'index.html'), 'utf8');
  assert.deepEqual(jargonIn(readable(home)), [], 'the home page names lab jargon a visitor would read; move it to a detail page or say it plainly');
});

test('the plain-language reader catches each banned word and mark, and leaves plain words alone', () => {
  const samples = {
    'Open a station': 'Open a station to see it.', workbench: 'Rerun our workbenches.', 'station evidence is unavailable': 'Station evidence is unavailable.',
    frontier: 'On the frontier.', arm: 'The arms agree.', seat: 'A seat each.', census: 'A census of repos.', 'strict-ack': 'The strict-ack gap.',
    'frozen analysis': 'The frozen analysis scores it.', 'validity gates': 'It passed its validity gates.', informative: 'Reported as uninformative.',
    'pre-registered': 'A pre-registered rule.', sha256: 'Its sha256 matches.', 'commit or hash': 'At commit b7c8ad5.', 'results.json': 'See results.json.',
    'Record <hex>': 'Record 3f2a9c1.', 'runner or host name': 'Ran on org-ci-heavy.', 'pipeline decoration': 'BLUEPRINT → WORKCELL → GATE',
  };
  assert.deepEqual(Object.keys(samples).sort(), plainBanned.map(([word]) => word).sort(), 'one sample per banned word');
  for (const [word, sample] of Object.entries(samples)) assert.equal(bannedIn(readable(`<p>${sample}</p>`)).filter(f => f.startsWith(`${word}:`)).length, 1, word);
  const plain = 'We wrote down the question and the pass mark before running it. Measured 2026-10-23: 29 of 60, $0.000631 per review. Charmed, armour, seated, deadbeef.';
  assert.deepEqual(bannedIn(readable(`<p>${plain}</p>`)), [], 'plain words, dates, counts and prices pass');
});

test('the built home reads plain where a visitor starts, plain first: header, hero, what we found, how we check, Go further and the folds', { timeout: 600_000 }, () => {
  const home = readFileSync(join(builtCopy(), 'dist', 'index.html'), 'utf8');
  const parts = homeFirstRead(home);
  for (const [name, html] of Object.entries(parts)) {
    assert.ok(stripTags(html).trim(), `${name}: found on the built home`);
    assert.deepEqual(bannedIn(readable(html)), [], `${name}: say it plainly (PLAN B2/B3), or move the term to a detail page`);
  }
  const order = [parts['hero premise'], parts['drawing toolbar'], parts['what we found'], parts['how we check intro'], parts['correction notice']].map(part => home.indexOf(part));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `hero, drawing, what we found, how we check, correction: ${order.join(', ')}`);
  // Labels in words, not lab terms; the old header labels are retired (scripts/site-header.mjs RETIRED_LABELS).
  const labels = [...parts['header nav'].matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(m => m[1].replaceAll('&amp;', '&'));
  assert.deepEqual(labels, ['Start here', 'Findings', 'Labs', 'All results', 'Notes & updates', 'How we test', 'Work with us', 'Find']);
  // The hero says who we are in at most two sentences, then leads to the findings.
  const premise = readable(parts['hero premise'].match(/<p>[\s\S]*?<\/p>/)[0]).trim();
  assert.ok(premise.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, `two sentences at most: ${premise}`);
  assert.match(parts['hero premise'], /<a class="button button-primary[^"]*" href="#findings">See what we found<\/a>/);
  // Every finding has its limit in words and a dated line, and links its result and its record.
  const findings = [...parts['what we found'].matchAll(/<li id="proof-[^"]+">[\s\S]*?<\/li>/g)].map(m => m[0]);
  assert.ok(findings.length >= 3 && findings.length <= 5, `three to five findings, found ${findings.length}`);
  for (const f of findings) {
    assert.match(f, /<p class="lab-limit"><strong>Limit:<\/strong> [^<]{20,}<\/p>/, 'a limit in words');
    assert.match(f, /Measured <time datetime="\d{4}-\d{2}-\d{2}/, 'a dated line');
    assert.match(f, /href="journal\/[^"]+">Read the result<\/a>/, 'the result');
    assert.match(f, /href="data\/[^"]+\/results\.json">the record<\/a>/, 'the record');
  }
  // At least one finding did not hold up, and stays on the home saying so in words.
  assert.ok(findings.some(f => /\bnegative result\b|\bdid not hold up\b|<strong>(?:no|refuted)<\/strong>/i.test(f)), 'a result that did not hold up stays on the home');
});

test('both workbenches moved to the experiments page, and the home links to each', { timeout: 600_000 }, () => {
  const root = builtCopy();
  const home = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const benches = readFileSync(join(root, 'dist', 'experiments', 'index.html'), 'utf8');
  for (const id of ['bench', 'laya-bench', 'experiment-data', 'reproduce-command', 'laya-reproduce-command', 'transcript']) {
    assert(benches.includes(`id="${id}"`), `the experiments page holds #${id}`);
    assert(!home.includes(`id="${id}"`), `the home no longer holds #${id}`);
  }
  for (const href of ['experiments/#bench', 'experiments/#laya-bench']) assert(home.includes(`href="${href}"`), `the home links ${href}`);
  assert(readFileSync(join(root, 'site', 'sitemap.xml'), 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/experiments/</loc>'), 'sitemap entry');
});
