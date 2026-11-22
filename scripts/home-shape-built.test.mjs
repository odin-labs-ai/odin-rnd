// The shaped home on a disposable build (scripts/home-shape.mjs, run by scripts/build.mjs after foldJournal): links
// into the home land on something a visitor can see, the visible page is short, and the proof strip still passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { stripBlocks, stripTags } from './test-html-text.mjs';
import { checkSite } from './number-provenance.mjs';
import { FOLDS, FURTHER, HOME_CSS, HOME_JS, OPEN_ORDER } from './home-shape.mjs';
import { jargonIn, readable } from './home-plain-language.test.mjs';
import { idOf, openAround } from '../site/assets/home-fold.mjs';

// The experiment ledger still lives in the archive. Published tool anchors live in the open tools section.
const OPENED_BY_SCRIPT = ['all-experiments'];
// Keep the first read short. Limits and correction text are required disclosures and counted separately below.
const VISIBLE_WORDS = 720; // The fully built page measured 689, including the six visible tool entries.
// Measured 74 on 3 November 2026: Lane B's /journal/ redirect (PR #173) removed 46 old #journal links,
// so the former >100 bound no longer describes links into the home.
const MIN_HOME_LINKS = 70;

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

test('the built homepage exposes the featured study, tool directory, factory and findings outside the archive', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  const order = OPEN_ORDER.map(id => main.indexOf(`id="${id}"`));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), 'entrance, tools, factory and findings, in that order');
  assert.ok(main.indexOf('<nav class="home-further') > order.at(-1) && main.indexOf('<nav class="home-further') < main.indexOf('<details class="home-archive">'), 'further reading follows the findings before the archive');
  const projects = main.slice(main.indexOf('id="projects"'), main.indexOf('id="how-we-check"'));
  const rows = [...projects.matchAll(/<article\b[^>]*class="project-row[^"]*"[^>]*>[\s\S]*?<\/article>/g)];
  assert.ok(rows.length > 0, 'the tools section contains tools');
  assert.match(projects, /href="#how-we-check"/, 'Tools links to the original factory');
  const factory = main.slice(main.indexOf('id="how-we-check"'), main.indexOf('id="findings"'));
  assert.match(factory, /class="factory-drawing" id="factory-model"/, 'the old preview URL now opens the one drawing');
  assert.equal((main.match(/class="factory-svg"/g) || []).length, 1);
  assert.doesNotMatch(main, /factory-studio\.webp|class="factory-scene"/, 'the retired illustrated exhibit is absent');
  const disclosures = detailsRanges(projects);
  for (const row of rows) {
    for (const marker of ['<h3', 'class="project-links"']) {
      const offset = row[0].indexOf(marker);
      assert.ok(offset >= 0, `each tool retains its ${marker}`);
      const position = row.index + offset;
      assert.ok(!disclosures.some(([start, end]) => start < position && position < end),
        `the tool’s ${marker} is available before opening its research notes`);
    }
  }
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
  assert.ok(links > MIN_HOME_LINKS, `links into the home were found (${links})`);
  assert.deepEqual(missing, []);
  for (const id of hidden) {
    const { target, folds, document } = domAround(home, id);
    assert.equal(openAround(document, id), target);
    assert.ok(folds.every(f => f.open), `#${id} opens through its enclosing disclosures`);
  }
  for (const id of ['floor', 'projects', 'project-nina', 'findings', 'how-we-check', 'home-further-title']) assert.ok(ids.has(id) && !insideFold(id), id);
  for (const id of ['updates', 'work-with-us', 'partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'journal']) {
    assert.ok(ids.has(id) && insideFold(id), `#${id} remains reachable in the archive`);
  }
});

test('the home a visitor sees without opening anything is short: under the word bound and under a quarter of its words', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>') + '</main>'.length);
  let visible = stripBlocks(main, ['script', 'style', 'svg']);
  for (let at = visible.search(/<details\b/); at >= 0; at = visible.search(/<details\b/)) visible = visible.slice(0, at) + ' ' + visible.slice(elementEnd(visible, at));
  // Only the initially selected station is visible.
  visible = without(visible, /<article\b[^>]*\shidden>/);
  // The hero's dated correction is a closed fold now (scripts/home-shape.mjs labelCorrection): like every <details>, it
  // is left out above, its dated summary included.
  // Each finding's limit is left out by name for the same reason: a limit is shortened, never removed (PLAN B4), so its
  // words are not copy the short home may trim (scripts/lab-pages.mjs renderLabProof requires one per finding).
  visible = without(visible, /<p class="lab-limit">/);
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
  for (const id of ['floor', 'projects', 'project-nina', 'findings', 'how-we-check', 'home-further-title']) {
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

test('the archive rests closed below the findings and the short list of next reads', () => {
  const at = home.indexOf('<details class="home-archive"><summary>Earlier work and project notes</summary>');
  const end = elementEnd(home, at);
  const archive = home.slice(at, end);
  for (const id of ['journal', 'work-with-us']) assert.ok(archive.includes(`id="${id}"`));
  assert.ok(!archive.includes('id="findings"'));
  assert.ok(home.indexOf('id="home-further-title"') < at);
});

test('the built home folds its dated correction in the hero under a plain dated summary, every word verbatim in the HTML', () => {
  const source = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  const at = source.indexOf('<details class="factory-correction" open>');
  const paragraphs = source.slice(at, source.indexOf('</details>', at)).match(/<p>[^]*?<\/p>/g);
  assert.ok(paragraphs.length >= 2);
  // The paragraphs as #168 published them (213e1f1): a reword fails here, in the source and on the built page.
  assert.equal(createHash('sha256').update(paragraphs.join('')).digest('hex'), '254ec433ef524686ad35e8963baaf879b2139eaefc87b4e549fa35f56dd4df29');
  assert.equal(home.split('class="factory-correction').length, 2, 'once');
  const start = home.indexOf('<details class="factory-correction correction-fold">');
  assert.ok(start >= 0, 'the fold, closed by default (no open attribute)');
  const block = home.slice(start, elementEnd(home, start));
  // In the hero, before what we found: a reader meets the dated summary next to the headline it corrects.
  assert.ok(start > home.indexOf('id="floor"') && start < home.indexOf('id="findings"'), 'in the hero, before what we found');
  assert.ok(!detailsRanges(home).some(([a, b]) => a < start && start < b), 'not inside another <details>');
  assert.match(block, /^<details class="factory-correction correction-fold"><summary><span class="correction-when">We corrected our earlier headline and wording on <time datetime="2026-11-01">1 November 2026<\/time> and <time datetime="2026-11-02">2 November 2026<\/time>\.<\/span><span class="correction-open">Read the correction<span aria-hidden="true">\+<\/span><\/span><\/summary><p class="correction-label">Wording clarification · <time datetime="2026-11-01">1 November 2026<\/time><\/p>/);
  assert.ok(block.endsWith(`${paragraphs.join('')}</details>`), 'every paragraph of the correction, verbatim, in the HTML');
});

test('the built home reads plain-first: the hero, tools, the factory, measured results, then the archive', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  const at = key => main.indexOf(key);
  const order = ['id="hero-title"', 'Run a closed-door study', 'id="projects"', 'id="how-we-check"', 'The software factory', 'class="factory-drawing"', 'class="station-compartment"', 'class="factory-boundary"', 'id="findings"', 'id="updates"'].map(at);
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `in order: ${order.join(', ')}`);
  // Nothing of the drawing or the station panel sits in the hero any more.
  const hero = main.slice(at('id="floor"'), elementEnd(main, main.lastIndexOf('<section', at('id="floor"'))));
  assert.doesNotMatch(hero, /factory-drawing|station-compartment|factory-boundary|domain-cannot-import-app/);
});

test('the entrance opens with the film, then the measured result and private study', () => {
  const hero = home.slice(home.indexOf('id="floor"'), home.indexOf('id="projects"'));
  assert.ok(!hero.includes('<form role="search"'), 'site navigation supplies the search path');
  assert.ok(hero.includes('src="assets/home-film/audit-chain.webp"'));
  assert.ok(hero.includes('class="play-film" href="assets/home-film/inside-odin.mp4"'));
  assert.ok(hero.includes('href="#featured-study"'));
  const order = ['class="film-entrance"', 'id="featured-study"', 'class="failover-figure"', 'class="private-study"'].map(token => hero.indexOf(token));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])));
  assert.ok(hero.includes('href="partners/#closed-door"'));
  assert.ok(hero.includes('href="experiments/"'));
  assert.ok(!hero.includes('<!--FAILOVER_FIGURE-->'), 'the result figure was rendered');
  assert.match(hero, /<video controls preload="none"[^>]*><\/video>/, 'the film only loads on request');
  assert.doesNotMatch(hero, /agent-space-30s-poster|\bautoplay\b/);
});
