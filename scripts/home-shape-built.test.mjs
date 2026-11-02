// The shaped home on a disposable build (scripts/home-shape.mjs, run by scripts/build.mjs after foldJournal): links
// into the home land on something a visitor can see, the visible page is short, and the proof strip still passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { stripBlocks, stripTags } from './test-html-text.mjs';
import { checkSite } from './number-provenance.mjs';
import { FOLDS, FURTHER, HOME_CSS, HOME_JS, OPEN_ORDER } from './home-shape.mjs';
import { jargonIn, readable } from './home-plain-language.test.mjs';
import { idOf, openAround } from '../site/assets/home-fold.mjs';

// The targets a link may reach inside a fold, each opened by site/assets/home-fold.mjs: the home's experiment list, which
// the site index still links for an experiment whose record lives in another repository (scripts/site-index.mjs), and
// nina's tools entry, linked from EXP 006's generated field note. Any other target inside a fold is a link the fold has
// hidden, and is refused here until it is named.
const OPENED_BY_SCRIPT = ['all-experiments', 'project-nina'];
// Words a visitor sees on the home without opening anything (main, outside every <details> and every hidden station).
// Measured 1,158 on 2 November 2026; the bound leaves room for an update or two, not for an unfolded section.
const VISIBLE_WORDS = 1250;

const htmlFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);

/** The end of the element opening at `at`, matched to its own close tag. */
function elementEnd(html, at) {
  const name = /^<([a-z][a-z0-9]*)/i.exec(html.slice(at))[1];
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  tags.lastIndex = at;
  let depth = 0;
  for (let m; (m = tags.exec(html));) { depth += m[1] ? -1 : 1; if (depth === 0) return m.index + m[0].length; }
  throw new Error(`unclosed <${name}>`);
}

/** Offset ranges of every <details> element, nested ones included. */
const detailsRanges = html => [...html.matchAll(/<details\b/g)].map(m => [m.index, elementEnd(html, m.index)]);

/** `html` without every element whose start tag matches `open` (each matched to its own close tag). */
function without(html, open) {
  let out = html;
  for (let m = open.exec(out); m; m = open.exec(out)) out = out.slice(0, m.index) + ' ' + out.slice(elementEnd(out, m.index));
  return out;
}

const root = builtCopy();
const dist = join(root, 'dist');
const home = readFileSync(join(dist, 'index.html'), 'utf8');

test('the built home is shaped: four open sections, Go further, eight closed folds, its stylesheet and opener', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  const order = OPEN_ORDER.map(id => main.indexOf(`id="${id}"`));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), 'floor, updates, lab, work with us, in that order');
  assert.ok(main.indexOf('<nav class="home-further') > order.at(-1), 'Go further follows the offer');
  assert.equal((main.match(/<details class="home-fold">/g) || []).length, FOLDS.length);
  for (const { summary } of FOLDS) assert.ok(main.includes(`<summary>${summary}<span aria-hidden="true">+</span></summary>`), summary);
  for (const { href } of FURTHER) assert.ok(main.includes(`<a href="${href}">`), href);
  // Only the home links them.
  for (const file of htmlFiles(dist)) {
    if (file === join(dist, 'index.html')) continue;
    const page = readFileSync(file, 'utf8');
    assert.ok(!page.includes(HOME_CSS) && !page.includes(HOME_JS), relative(dist, file));
  }
  assert.equal(home.split(`href="${HOME_CSS}"`).length, 2);
  assert.equal(home.split(`src="${HOME_JS}"`).length, 2);
});

test('every in-site link into the home targets an id that exists and is not hidden in a fold', () => {
  const ids = new Map([...home.matchAll(/\sid="([^"]*)"/g)].map(m => [m[1], m.index]));
  const folds = detailsRanges(home);
  const insideFold = id => folds.some(([a, b]) => ids.get(id) > a && ids.get(id) < b);
  const missing = [], hidden = new Set();
  let links = 0;
  for (const file of htmlFiles(dist)) {
    const page = readFileSync(file, 'utf8');
    const from = posix.dirname(relative(dist, file).split('\\').join('/'));
    for (const [, href] of page.matchAll(/\shref="([^"]*)"/g)) {
      if (/^[a-z]+:|^\/\//i.test(href) || !href.includes('#')) continue;
      const [path, fragment] = href.split('#');
      let target = posix.normalize(posix.join(from, path || posix.basename(relative(dist, file))));
      if (target === '.' || target.endsWith('/')) target = posix.join(target, 'index.html');
      if (target !== 'index.html' || !fragment) continue;
      links++;
      const id = decodeURIComponent(fragment);
      if (!ids.has(id)) missing.push(`${relative(dist, file)}: ${href}`);
      else if (insideFold(id)) hidden.add(id);
    }
  }
  assert.ok(links > 100, `links into the home were found (${links})`);
  assert.deepEqual(missing, []);
  assert.deepEqual([...hidden].sort(), OPENED_BY_SCRIPT, 'only the named targets are reached inside a fold (the opener is run on each in the next test)');
  for (const id of ['floor', 'updates', 'lab', 'work-with-us', 'partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'projects', 'journal']) {
    assert.ok(ids.has(id) && !insideFold(id), `#${id} is a visible section`);
    const fold = home.indexOf('<details class="home-fold">', ids.get(id));
    assert.match(home.slice(ids.get(id), fold < 0 ? undefined : fold), /<h[12] id="[^"]+">/, `#${id} shows its heading before any fold`);
  }
});

test('the home a visitor sees without opening anything is short: under the word bound and under a quarter of its words', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>') + '</main>'.length);
  let visible = stripBlocks(main, ['script', 'style', 'svg']);
  for (let at = visible.search(/<details\b/); at >= 0; at = visible.search(/<details\b/)) visible = visible.slice(0, at) + ' ' + visible.slice(elementEnd(visible, at));
  visible = without(visible, /<article class="station-exhibit"[^>]*\shidden>/);
  const words = stripTags(visible).split(/\s+/).filter(Boolean).length;
  const all = stripTags(stripBlocks(main, ['script', 'style', 'svg'])).split(/\s+/).filter(Boolean).length;
  assert.ok(words < VISIBLE_WORDS, `${words} visible words on the home (bound ${VISIBLE_WORDS})`);
  assert.ok(all > words * 4, `under a quarter of the home's words show unopened (${words} of ${all})`);
});

test('the proof strip still passes the number-provenance check, and the new words are plain', () => {
  assert.deepEqual(checkSite(dist, [], root), [], 'HOME_PROOF');
  const nav = home.slice(home.indexOf('<nav class="home-further'), home.indexOf('</nav>', home.indexOf('<nav class="home-further')));
  const summaries = [...home.matchAll(/<details class="home-fold"><summary>([^<]*)</g)].map(m => m[1]);
  const words = `${stripTags(nav)} ${summaries.join(' ')}`;
  assert.doesNotMatch(words, /\p{Nd}/u, 'no digit in the new words');
  assert.doesNotMatch(words, /\bevery\b/i);
  assert.deepEqual(jargonIn(readable(nav + summaries.join(' '))), []);
});

/** A minimal stand-in for the built home's DOM around `id`: the target and every <details> around it, outermost first,
 *  each read from the real built HTML, with the tag and class the opener and this test look at. */
function domAround(html, id) {
  const at = html.indexOf(` id="${id}"`);
  const chain = detailsRanges(html).filter(([a, b]) => a < at && at < b).sort((x, y) => x[0] - y[0])
    .map(([a]) => ({ tag: 'details', cls: /^<details\b[^>]*\sclass="([^"]*)"/.exec(html.slice(a))?.[1] ?? '', open: /^<details\b[^>]*\sopen\b/.test(html.slice(a)) }));
  let parent = null;
  const nodes = [...chain, { tag: 'target' }].map(n => (parent = { ...n, parentElement: parent }));
  for (const n of nodes) n.closest = function (sel) { for (let x = this; x; x = x.parentElement) if (x.tag === sel) return x; return null; };
  const target = nodes.at(-1);
  return { target, folds: nodes.slice(0, -1), document: { getElementById: want => (want === id && at >= 0 ? target : null) } };
}

test('the opener, run on the built home, opens every fold around each named target, and nothing around a visible one', () => {
  for (const id of OPENED_BY_SCRIPT) {
    const { target, folds, document } = domAround(home, id);
    assert.ok(folds.length >= 1 && folds.every(f => !f.open), `#${id} starts inside closed folds`);
    assert.ok(folds.some(f => f.cls === 'home-fold'), `#${id} is inside a home fold`);
    assert.equal(openAround(document, idOf(`#${id}`)), target, `#${id} is found`);
    assert.ok(folds.every(f => f.open), `#${id}: every fold around it is open`);
  }
  for (const id of ['journal', 'experiments', 'lab']) {
    const { folds, document } = domAround(home, id);
    assert.equal(folds.length, 0, `#${id} is outside every fold`);
    assert.ok(openAround(document, id), `#${id} is found and needs nothing opened`);
  }
});

test('the methods page: every fragment link resolves in the built site, and its experiment-list links land on a list', () => {
  const page = readFileSync(join(dist, 'methods', 'index.html'), 'utf8');
  const unresolved = [];
  for (const [href, path, fragment] of [...page.matchAll(/\shref="([^"#]*)#([^"]+)"/g)].map(m => [`${m[1]}#${m[2]}`, m[1], m[2]])) {
    if (/^[a-z]+:|^\/\//i.test(path)) continue;
    let file = posix.normalize(posix.join('methods', path || 'index.html'));
    if (file === '.' || file.endsWith('/') || !/\.[a-z]+$/.test(file)) file = posix.join(file, 'index.html');
    const target = readFileSync(join(dist, file), 'utf8');
    if (!target.includes(` id="${decodeURIComponent(fragment)}"`)) unresolved.push(href);
  }
  assert.deepEqual(unresolved, []);
  // The button leads to the experiments page's list; the in-text link to the home's list, which the opener unfolds.
  assert.ok(page.includes('<a class="button button-primary" href="../experiments/#every-experiment">Every experiment and its status</a>'));
  assert.ok(readFileSync(join(dist, 'experiments', 'index.html'), 'utf8').includes('id="every-experiment"'));
  assert.ok(page.includes('<a href="../#all-experiments">the experiment list</a>'));
  assert.ok(OPENED_BY_SCRIPT.includes('all-experiments'));
});

test('a height proxy measurable without a browser: four sections, Go further and the closing line open, the other eight folded', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  const tops = [];
  let depth = 0;
  for (const m of main.matchAll(/<(\/?)(section|nav)\b[^>]*>/g)) {
    if (m[1]) { depth--; if (depth === 0) tops.at(-1).end = m.index; continue; }
    if (depth === 0) tops.push({ key: /\sid="([^"]*)"/.exec(m[0])?.[1] ?? /\sclass="([^"\s]*)/.exec(m[0])[1], start: m.index });
    depth++;
  }
  const folded = tops.filter(t => main.slice(t.start, t.end).includes('<details class="home-fold">')).map(t => t.key);
  const open = tops.filter(t => !folded.includes(t.key)).map(t => t.key);
  assert.deepEqual(open, [...OPEN_ORDER, 'home-further', 'closing']);
  assert.deepEqual(folded, FOLDS.map(f => f.key));
});
