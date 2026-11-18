// The shaped home on a disposable build (scripts/home-shape.mjs, run by scripts/build.mjs after foldJournal): links
// into the home land on something a visitor can see, the visible page is short, and the proof strip still passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { stripTags } from './test-html-text.mjs';
import { parse } from './html-source-tree.mjs';
import { checkSite } from './number-provenance.mjs';
import { inspectDom } from './chrome-dom-test.mjs';
import { chromeBinary } from './og-cards-render.mjs';
import { renderLabProof, siteReader } from './lab-pages.mjs';
import { FOLDS, FURTHER, HOME_CSS, HOME_JS, OPEN_ORDER } from './home-shape.mjs';
import { jargonIn, readable } from './home-plain-language.test.mjs';
import { idOf, openAround } from '../site/assets/home-fold.mjs';

// The targets a link may reach inside a fold, each opened by site/assets/home-fold.mjs: the home's experiment list, which
// the site index still links for an experiment whose record lives in another repository (scripts/site-index.mjs), and
// nina's tools entry, linked from EXP 006's generated field note. Any other target inside a fold is a link the fold has
// hidden, and is refused here until it is named.
const OPENED_BY_SCRIPT = ['all-experiments', 'project-nina'];
// Words a visitor sees on the home without opening anything (main, closed disclosures' summaries, open disclosures'
// bodies, and no hidden station exhibits).
// The 1,650 bound includes the full correction, every visible finding limit and closed disclosure summaries.
// It leaves room for a short update while keeping unopened content under a third of the total.
const VISIBLE_WORDS = 1650;
// Measured 74 on 3 November 2026: Lane B's /journal/ redirect (PR #173) removed 46 old #journal links,
// so the former >100 bound no longer describes links into the home.
const MIN_HOME_LINKS = 70;

const htmlFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);

const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const hasAttr = (node, name) => node.attrs?.some(item => item.name === name) ?? false;
const rendered = node => node.tagName === 'template' ? [] : [node, ...(node.childNodes ?? []).flatMap(rendered)];
/** Source-offset tree locations avoid mistaking a quoted `>` for the end of a tag. */
function elementEnd(html, at) {
  const node = rendered(parse(html)).find(item => item.sourceCodeLocation?.startOffset === at);
  if (!node?.sourceCodeLocation?.endTag) throw new Error(`unclosed element at ${at}`);
  return node.sourceCodeLocation.endOffset;
}

/** Offset ranges of every rendered <details> element, nested ones included. */
const detailsRanges = html => rendered(parse(html)).filter(node => node.tagName === 'details').map(node => [node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset, node]);

const root = builtCopy();
const dist = join(root, 'dist');
const home = readFileSync(join(dist, 'index.html'), 'utf8');

test('the built home is shaped: five open sections, Go further, eight closed folds, its stylesheet and opener', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  const order = OPEN_ORDER.map(id => main.indexOf(`id="${id}"`));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), 'hero, findings, how we check, updates, work with us, in that order');
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
  assert.ok(links > MIN_HOME_LINKS, `links into the home were found (${links})`);
  assert.deepEqual(missing, []);
  assert.deepEqual([...hidden].sort(), OPENED_BY_SCRIPT, 'only the named targets are reached inside a fold (the opener is run on each in the next test)');
  for (const id of ['floor', 'findings', 'how-we-check', 'updates', 'work-with-us', 'partner-tracks', 'agent-space', 'how-it-works', 'experiments', 'projects', 'journal']) {
    assert.ok(ids.has(id) && !insideFold(id), `#${id} is a visible section`);
    const fold = home.indexOf('<details class="home-fold">', ids.get(id));
    assert.match(home.slice(ids.get(id), fold < 0 ? undefined : fold), /<h[12] id="[^"]+">/, `#${id} shows its heading before any fold`);
  }
});

const chrome = chromeBinary();
const chromeRequired = process.env.GITHUB_ACTIONS === 'true';
const wordsDom = `(() => {
  const main = document.querySelector('main');
  const visibleText = main.innerText;
  const copy = main.cloneNode(true);
  copy.querySelectorAll('script,style,svg').forEach(element => element.remove());
  const correction = main.querySelector('.factory-correction.correction-note');
  const visible = el => {
    if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    return [...el.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).some(rect => {
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === el || el.contains(hit);
    });
  };
  const limits = [...main.querySelectorAll('#findings li[id^="proof-"]')].map(item => {
    const claim = item.querySelector('p:not(.lab-limit):not(.lab-source)');
    const limit = item.querySelector('p.lab-limit');
    return { id: item.id, claimVisible: visible(claim), claimText: claim?.innerText.replace(/\\s+/g, ' ').trim() ?? '', claimBeforeLimit: !!claim && !!limit && !!(claim.compareDocumentPosition(limit) & Node.DOCUMENT_POSITION_FOLLOWING),
      limitVisible: visible(limit), limitText: limit?.innerText.replace(/\\s+/g, ' ').trim() ?? '' };
  });
  return { text: visibleText.replace(/\\s+/g, ' ').trim(), visible: visibleText.split(/\\s+/).filter(Boolean).length, all: copy.textContent.split(/\\s+/).filter(Boolean).length,
    correctionVisible: visible(correction), correctionText: correction?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    correctionWhenVisible: visible(correction?.querySelector('.correction-when')), correctionLabelVisible: visible(correction?.querySelector('.correction-label')),
    correctionParagraphs: correction ? [...correction.querySelectorAll('p')].slice(2).map(p => p.innerText.replace(/\\s+/g, ' ').trim()) : [],
    correctionParagraphVisible: correction ? [...correction.querySelectorAll('p')].slice(2).map(visible) : [], limits };
})()`;

test('Chrome counts the unopened home below the word bound and one third of all words', { skip: !chrome && !chromeRequired ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 120000 }, async t => {
  assert.ok(chrome, 'Chrome is required in CI');
  const sample = '<main><details><summary>Closed label</summary><p>Hidden body</p></details><details open><summary>Open label</summary><p>Visible body</p><details><summary>Nested label</summary><p>Hidden nested body</p></details></details></main>';
  const quoted = `<main><details title="a>b" open><summary>Label</summary><p>${'visible&#32;'.repeat(VISIBLE_WORDS)}</p></details></main>`;
  const source = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  const at = source.indexOf('<details class="factory-correction" open>');
  const paragraphs = source.slice(at, source.indexOf('</details>', at)).match(/<p>[^]*?<\/p>/g);
  const correctionAt = home.indexOf('<div class="factory-correction correction-note">');
  const correctionBlock = home.slice(correctionAt, elementEnd(home, correctionAt));
  const faded = `<style>.correction-note > p { opacity: 0 }</style><main>${correctionBlock}</main>`;
  const clipped = `<style>.correction-note { clip-path: inset(50%) }</style><main>${correctionBlock}</main>`;
  const hiddenLimit = '<style>.lab-limit { display: none }</style><main><section id="findings"><li id="proof-fixture"><p>Claim</p><p class="lab-limit">Limit: this fixture is hidden.</p></li></section></main>';
  const reorderedClaim = '<style>.claim { display: none }</style><main><section id="findings"><li id="proof-fixture"><p class="lab-limit">Limit: a full fixture limit appears first.</p><p class="claim">The real claim is hidden.</p></li></section></main>';
  const proof = `<main><section id="findings">${renderLabProof(siteReader(join(root, 'site'), root), '', { plain: true })}</section></main>`;
  const [actual, control, long, pinned, fadedCorrection, clippedCorrection, hiddenFinding, reorderedFinding, expectedProof] = await inspectDom([{ file: join(dist, 'index.html'), expression: wordsDom }, { html: sample, expression: wordsDom }, { html: quoted, expression: wordsDom }, { html: `<main>${paragraphs.join('')}</main>`, expression: `[...document.querySelectorAll('main p')].map(p => p.innerText.replace(/\\s+/g, ' ').trim())` }, { html: faded, expression: wordsDom }, { html: clipped, expression: wordsDom }, { html: hiddenLimit, expression: wordsDom }, { html: reorderedClaim, expression: wordsDom }, { html: proof, expression: wordsDom }], { chrome });
  assert.equal(control.text, 'Closed label Open label Visible body Nested label', 'closed summaries and open bodies are counted');
  assert.ok(long.visible > VISIBLE_WORDS, 'quoted > and encoded spaces cannot hide an over-bound open body');
  assert.equal(actual.correctionVisible, true, 'the dated correction has visible area in the rendered main');
  assert.equal(actual.correctionWhenVisible, true, 'the dated correction heading is visible');
  assert.equal(actual.correctionLabelVisible, true, 'the dated correction label is visible');
  assert.ok(actual.correctionText.includes('Wording clarification · 1 November 2026'), 'the dated label is rendered');
  assert.deepEqual(actual.correctionParagraphs, pinned, 'every pinned paragraph is rendered verbatim');
  assert.ok(actual.correctionParagraphVisible.every(Boolean), 'every pinned paragraph has visible area');
  for (const paragraph of pinned) assert.ok(actual.text.includes(paragraph), 'the rendered main includes the full correction paragraph');
  assert.ok(fadedCorrection.correctionParagraphVisible.every(value => value === false), 'opacity zero on child paragraphs is caught');
  assert.equal(clippedCorrection.correctionVisible, false, 'a fully clipped correction is caught');
  assert.deepEqual(actual.limits.map(limit => limit.id), ['proof-review-cost', 'proof-brokers', 'proof-self-verify'], 'all featured findings are inspected');
  assert.deepEqual(actual.limits.map(({ id, claimText }) => ({ id, claimText })), expectedProof.limits.map(({ id, claimText }) => ({ id, claimText })), 'each visible finding retains its source claim');
  for (const limit of actual.limits) {
    assert.equal(limit.claimVisible, true, `${limit.id}: claim is visible`);
    assert.equal(limit.claimBeforeLimit, true, `${limit.id}: claim precedes its limit`);
    assert.equal(limit.limitVisible, true, `${limit.id}: limit is visible beside its claim`);
    assert.match(limit.limitText, /^Limit: .{20,}/, `${limit.id}: a full limit is rendered`);
    assert.ok(actual.text.includes(limit.limitText), `${limit.id}: rendered main includes the limit`);
  }
  assert.equal(hiddenFinding.limits[0].limitVisible, false, 'a CSS-hidden finding limit is caught');
  assert.equal(reorderedFinding.limits[0].claimVisible, false, 'a limit placed before a hidden claim cannot stand in for it');
  assert.equal(reorderedFinding.limits[0].claimBeforeLimit, false, 'a claim after its limit is caught');
  t.diagnostic(`Chrome reads ${actual.visible} visible words of ${actual.all} total on the built home`);
  assert.ok(actual.visible < VISIBLE_WORDS, `${actual.visible} visible words on the home (bound ${VISIBLE_WORDS})`);
  assert.ok(actual.all > actual.visible * 3, `under a third of the home's words show unopened (${actual.visible} of ${actual.all})`);
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
    .map(([, , node]) => ({ tag: 'details', cls: attr(node, 'class') ?? '', open: hasAttr(node, 'open') }));
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
  for (const id of ['journal', 'experiments', 'findings']) {
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

test('the built home keeps its dated correction visible after findings, every word verbatim in the HTML', () => {
  const source = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  const at = source.indexOf('<details class="factory-correction" open>');
  const paragraphs = source.slice(at, source.indexOf('</details>', at)).match(/<p>[^]*?<\/p>/g);
  assert.ok(paragraphs.length >= 2);
  // The paragraphs as #168 published them (213e1f1): a reword fails here, in the source and on the built page.
  assert.equal(createHash('sha256').update(paragraphs.join('')).digest('hex'), '254ec433ef524686ad35e8963baaf879b2139eaefc87b4e549fa35f56dd4df29');
  assert.equal(home.split('class="factory-correction').length, 2, 'once');
  const start = home.indexOf('<div class="factory-correction correction-note">');
  assert.ok(start >= 0, 'the visible notice');
  const block = home.slice(start, elementEnd(home, start));
  assert.ok(start > home.indexOf('id="findings"') && start > home.indexOf('id="how-we-check"') && start < home.indexOf('id="updates"'), 'visible after what we found, before updates');
  assert.ok(!detailsRanges(home).some(([a, b]) => a < start && start < b), 'not inside another <details>');
  assert.match(block, /^<div class="factory-correction correction-note"><p class="correction-when">We corrected our earlier headline and wording on <time datetime="2026-11-01">1 November 2026<\/time> and <time datetime="2026-11-02">2 November 2026<\/time>\.<\/p><p class="correction-label">Wording clarification · <time datetime="2026-11-01">1 November 2026<\/time><\/p>/);
  assert.ok(block.endsWith(`${paragraphs.join('')}</div>`), 'every paragraph of the correction, verbatim, in the HTML');
  assert.doesNotMatch(block, /<details|<summary/, 'the correction cannot be closed');
});

test('the built home shows the drawing first and the correction after what we found', () => {
  const main = home.slice(home.indexOf('<main'), home.indexOf('</main>'));
  const at = key => main.indexOf(key);
  const order = ['id="hero-title"', 'See what we found', 'class="factory-drawing"', 'class="station-compartment"', 'class="factory-boundary"', 'id="findings"', 'id="how-we-check"', 'How to read the drawing', 'class="factory-correction correction-note"', 'id="updates"'].map(at);
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `in order: ${order.join(', ')}`);
  // The interactive drawing and stations stay in the hero.
  const hero = main.slice(at('id="floor"'), elementEnd(main, main.lastIndexOf('<section', at('id="floor"'))));
  assert.match(hero, /factory-drawing/);
  assert.match(hero, /station-compartment/);
  assert.match(hero, /factory-boundary/);
  assert.doesNotMatch(hero, /factory-correction/);
});
