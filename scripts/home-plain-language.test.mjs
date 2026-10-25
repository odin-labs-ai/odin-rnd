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

const decode = text => text.replace(/&#39;|&quot;|&lt;|&gt;|&nbsp;/g, m => ({ '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[m]).replaceAll('&amp;', '&');

/** What a visitor reads on a page: text outside script, style and svg, plus aria-label, alt and title values. The Tools
 *  row 001 heading is the one place the engine's product name may stand, so it is read without its heading. */
export function readable(html) {
  const tool = /(<div class="project-number">001<span>ENGINE<\/span><\/div><div class="project-description"><h3>)[\s\S]*?(<\/h3>)/;
  const body = stripBlocks(html.replace(tool, '$1$2'), ['script', 'style', 'svg']);
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
  const tools = '<div class="project-number">001<span>ENGINE</span></div><div class="project-description"><h3><a href="x">BCE</a></h3><p>The BCE way.</p>';
  assert.equal(jargonIn(readable(tools)).length, 1, 'the abbreviation may stand only in the Tools row 001 heading');
});

test('the built home page carries none of the lab\'s working words', { timeout: 600_000 }, () => {
  const home = readFileSync(join(builtCopy(), 'dist', 'index.html'), 'utf8');
  assert.deepEqual(jargonIn(readable(home)), [], 'the home page names lab jargon a visitor would read; move it to a detail page or say it plainly');
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
