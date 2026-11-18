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
import { checkSite, format, resolvePointer } from './number-provenance.mjs';
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
  const findingsAt = home.indexOf('<section class="lab-launch content-section" id="findings"');
  const findings = home.slice(findingsAt, elementEnd(home, findingsAt));
  assert.ok(findingsAt >= 0 && findings.includes('id="lab"') && findings.includes('<h2 id="lab-title">') && findings.includes('aria-labelledby="lab-title"'), 'both legacy #lab and #lab-title resolve inside the visible findings section');
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
test('Chrome fixtures cannot overwrite a built page through an ambiguous input', async () => {
  const file = join(dist, 'index.html');
  const before = readFileSync(file, 'utf8');
  await assert.rejects(inspectDom([{ file, html: '<main>overwritten</main>', expression: 'true' }], { chrome, siteRoot: dist }), /exactly one file or HTML fixture/);
  assert.equal(readFileSync(file, 'utf8'), before, 'the built page remains byte for byte');
});
const wordsDom = `(() => {
  const main = document.querySelector('main');
  const visibleText = main.innerText;
  const copy = main.cloneNode(true);
  copy.querySelectorAll('script,style,svg').forEach(element => element.remove());
  const correction = main.querySelector('.factory-correction.correction-note');
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const readableForeground = el => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000';
    const style = getComputedStyle(el);
    paint.fillStyle = style.getPropertyValue('-webkit-text-fill-color') || style.color;
    paint.fillRect(0, 0, 1, 1);
    return paint.getImageData(0, 0, 1, 1).data[3] > 0;
  };
  const visible = el => {
    if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (!readableForeground(el)) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/\\bopacity\\(0(?:\\.0*)?\\)/.test(style.filter) || style.clipPath !== 'none') return false;
    }
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    return [...el.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).some(rect => {
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === el || el.contains(hit);
    });
  };
  const unclippedText = el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    if (!lines.length) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (!['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) continue;
      const box = node.getBoundingClientRect();
      if (lines.some(rect => rect.top < box.top - 1 || rect.bottom > box.bottom + 1 || rect.left < box.left - 1 || rect.right > box.right + 1)) return false;
    }
    return true;
  };
  const limits = [...main.querySelectorAll('#findings li[id^="proof-"]')].map(item => {
    const claim = item.querySelector('p:not(.lab-limit):not(.lab-source)');
    const limit = item.querySelector('p.lab-limit');
    const citation = item.querySelector('p.lab-source');
    return { id: item.id, claimVisible: visible(claim), claimText: claim?.innerText.replace(/\\s+/g, ' ').trim() ?? '', claimBeforeLimit: !!claim && !!limit && !!(claim.compareDocumentPosition(limit) & Node.DOCUMENT_POSITION_FOLLOWING),
      claimShape: item.children.length === 3 && item.children[0] === claim && item.children[1] === limit && item.children[2] === citation
        && ![...item.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()),
      limitVisible: visible(limit), limitText: limit?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      citationVisible: visible(citation), citationText: citation?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      citationLinks: citation ? [...citation.querySelectorAll('a')].map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href'), resolved: a.href,
        visible: visible(a), download: a.hasAttribute('download'), target: a.getAttribute('target') ?? '' })) : [],
      citationDates: citation ? [...citation.querySelectorAll('time')].map(time => [time.innerText.trim(), time.getAttribute('datetime')]) : [] };
  });
  return { pageUrl: location.href, text: visibleText.replace(/\\s+/g, ' ').trim(), visible: visibleText.split(/\\s+/).filter(Boolean).length, all: copy.textContent.split(/\\s+/).filter(Boolean).length,
    correctionVisible: visible(correction), correctionText: correction?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    correctionWhenVisible: visible(correction?.querySelector('.correction-when')), correctionLabelVisible: visible(correction?.querySelector('.correction-label')),
    correctionTimesVisible: correction ? [...correction.querySelectorAll('time')].map(visible) : [],
    correctionParagraphs: correction ? [...correction.querySelectorAll('p')].slice(1).map(p => p.innerText.replace(/\\s+/g, ' ').trim()) : [],
    correctionParagraphVisible: correction ? [...correction.querySelectorAll('p')].slice(1).map(p => visible(p) && unclippedText(p)) : [], limits };
})()`;

test('Chrome counts the unopened home below the word bound and one third of all words', { skip: !chrome && !chromeRequired ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 120000 }, async t => {
  assert.ok(chrome, 'Chrome is required in CI');
  const sample = '<main><details><summary>Closed label</summary><p>Hidden body</p></details><details open><summary>Open label</summary><p>Visible body</p><details><summary>Nested label</summary><p>Hidden nested body</p></details></details></main>';
  const quoted = `<main><details title="a>b" open><summary>Label</summary><p>${'visible&#32;'.repeat(VISIBLE_WORDS)}</p></details></main>`;
  const source = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  const at = source.indexOf('<details class="factory-correction" open>');
  const paragraphs = source.slice(at, source.indexOf('</details>', at)).match(/<p>[^]*?<\/p>/g);
  const correctionAt = home.indexOf('<div class="factory-correction correction-note" role="note">');
  const correctionBlock = home.slice(correctionAt, elementEnd(home, correctionAt));
  const faded = `<style>.correction-note > p { opacity: 0 }</style><main>${correctionBlock}</main>`;
  const transparent = `<style>.correction-note > p, .correction-note > p * { color: transparent; text-shadow: none }</style><main>${correctionBlock}</main>`;
  const transparentFill = `<style>.correction-note > p, .correction-note > p * { -webkit-text-fill-color: transparent; text-shadow: none }</style><main>${correctionBlock}</main>`;
  const transparentTimes = `<style>.correction-note time { -webkit-text-fill-color: transparent; text-shadow: none }</style><main>${correctionBlock}</main>`;
  const clipped = `<style>.correction-note { clip-path: inset(50%) }</style><main>${correctionBlock}</main>`;
  const partlyClipped = `<style>.correction-note > p { clip-path: inset(40% 0) }</style><main>${correctionBlock}</main>`;
  const overflowClipped = `<style>.correction-note > p { max-height: 1lh; overflow: hidden }</style><main>${correctionBlock}</main>`;
  const filtered = `<style>.correction-note { filter: opacity(0) }</style><main>${correctionBlock}</main>`;
  const hiddenLimit = '<style>.lab-limit { display: none }</style><main><section id="findings"><li id="proof-fixture"><p>Claim</p><p class="lab-limit">Limit: this fixture is hidden.</p></li></section></main>';
  const reorderedClaim = '<style>.claim { display: none }</style><main><section id="findings"><li id="proof-fixture"><p class="lab-limit">Limit: a full fixture limit appears first.</p><p class="claim">The real claim is hidden.</p></li></section></main>';
  const authoredClaims = JSON.parse(readFileSync(join(root, 'site', 'data', 'lab-proof.json'), 'utf8')).claims;
  const readSource = siteReader(join(root, 'site'), root);
  const sourceClaimTexts = new Map(authoredClaims.map(claim => [claim.id, claim.text.replace(/\{([a-zA-Z0-9]+)\}/g, (_, name) => {
    const value = claim.values[name];
    assert.ok(value, `${claim.id}: ${name} is declared in the authored finding`);
    const [path, pointer = ''] = value.source.split('#');
    const measured = resolvePointer(readSource(path), pointer);
    return value.format === 'code' || value.format === 'word' ? String(measured) : format(measured, value.format);
  }).replace(/\s+/g, ' ').trim()]));
  const sourceCitations = new Map(authoredClaims.map(claim => {
    const windowValue = (spec, first) => {
      const [path, pointer = ''] = spec.source.split('#');
      const at = resolvePointer(readSource(path), pointer);
      const values = (Array.isArray(at) ? at.map(value => spec.field ? value[spec.field] : value) : [at]).filter(value => typeof value === 'string').sort();
      assert.ok(values.length, `${claim.id}: a cited measurement date exists`);
      return first ? values[0] : values.at(-1);
    };
    const from = windowValue(claim.window.from, true);
    const to = claim.window.to ? windowValue(claim.window.to, false) : null;
    const dates = [from, ...(to && to.slice(0, 10) !== from.slice(0, 10) ? [to] : [])].map(value => [value.slice(0, 10), value]);
    const record = claim.record.split('#')[0];
    const links = [...(claim.note ? [['Read the result', claim.note]] : []), ['the record', record], ['the written plan', record.replace(/results\.json$/, 'preregistration.json')]];
    return [claim.id, { text: `Measured ${dates.map(([date]) => date).join(' to ')}. ${links.map(([label]) => label).join(' · ')}.`, dates, links }];
  }));
  const proof = `<main><section id="findings">${renderLabProof(siteReader(join(root, 'site'), root), '', { plain: true })}</section></main>`;
  const extraConclusion = proof.replace('The uncertainty ranges of all the reviewers overlap.</p>', 'The uncertainty ranges of all the reviewers overlap. The cheaper reviewer is better.</p>');
  assert.notEqual(extraConclusion, proof, 'the unsupported conclusion control changes only the review-cost claim');
  const extraSibling = proof.replace('The uncertainty ranges of all the reviewers overlap.</p>', 'The uncertainty ranges of all the reviewers overlap.</p><p>The cheaper reviewer is better.</p>');
  assert.notEqual(extraSibling, proof, 'the sibling conclusion control adds one visible paragraph before the cost limit');
  const extraText = proof.replace('The uncertainty ranges of all the reviewers overlap.</p>', 'The uncertainty ranges of all the reviewers overlap.</p>The cheaper reviewer is better.');
  assert.notEqual(extraText, proof, 'the text-node conclusion control adds visible words before the cost limit');
  const extraCitation = proof.replace('the written plan</a>.</p>', 'the written plan</a>. The cheaper reviewer is better.</p>');
  assert.notEqual(extraCitation, proof, 'the source-paragraph control adds an unsupported ranking after the last link');
  const hiddenCitationLink = `<style>#proof-review-cost .lab-source a[href$="preregistration.json"] { opacity: 0 }</style>${proof}`;
  const downloadCitationLink = proof.replace('<a href="data/review-frontier/preregistration.json">the written plan</a>', '<a href="data/review-frontier/preregistration.json" download>the written plan</a>');
  assert.notEqual(downloadCitationLink, proof, 'the written-plan control changes navigation to a download');
  const framedCitationLink = proof.replace('<a href="data/review-frontier/preregistration.json">the written plan</a>', '<a href="data/review-frontier/preregistration.json" target="hidden-frame">the written plan</a>');
  assert.notEqual(framedCitationLink, proof, 'the written-plan control changes navigation to another target');
  const proofLimits = [...proof.matchAll(/<p class="lab-limit">[\s\S]*?<\/p>/g)].map(match => match[0]);
  assert.equal(proofLimits.length, 3, 'one generated limit for each featured finding');
  let limitAt = 0;
  const swappedLimits = proof.replace(/<p class="lab-limit">[\s\S]*?<\/p>/g, match => {
    const at = limitAt++;
    return at === 0 ? proofLimits[1] : at === 1 ? proofLimits[0] : match;
  });
  const moduleProbe = `(() => {
    const fold = document.getElementById('all-experiments')?.closest('details');
    const targetExists = !!fold;
    const initiallyOpen = fold?.open ?? null;
    history.replaceState(null, '', '#all-experiments');
    dispatchEvent(new HashChangeEvent('hashchange'));
    return { targetExists, initiallyOpen, afterOpen: fold?.open ?? null };
  })()`;
  const [actual, moduleLoaded, moduleBlocked, control, long, pinned, fadedCorrection, transparentCorrection, transparentFillCorrection, transparentTimeCorrection, clippedCorrection, partlyClippedCorrection, overflowClippedCorrection, filteredCorrection, hiddenFinding, reorderedFinding, extraClaimProof, extraSiblingProof, extraTextProof, extraCitationProof, hiddenCitationProof, downloadCitationProof, framedCitationProof, swappedProof] = await inspectDom([{ file: join(dist, 'index.html'), expression: wordsDom }, { file: join(dist, 'index.html'), expression: moduleProbe }, { file: join(dist, 'index.html'), expression: moduleProbe, blockedUrls: ['*assets/home-fold.mjs'] }, { html: sample, expression: wordsDom }, { html: quoted, expression: wordsDom }, { html: `<main>${paragraphs.join('')}</main>`, expression: `[...document.querySelectorAll('main p')].map(p => p.innerText.replace(/\\s+/g, ' ').trim())` }, { html: faded, expression: wordsDom }, { html: transparent, expression: wordsDom }, { html: transparentFill, expression: wordsDom }, { html: transparentTimes, expression: wordsDom }, { html: clipped, expression: wordsDom }, { html: partlyClipped, expression: wordsDom }, { html: overflowClipped, expression: wordsDom }, { html: filtered, expression: wordsDom }, { html: hiddenLimit, expression: wordsDom }, { html: reorderedClaim, expression: wordsDom }, { html: extraConclusion, expression: wordsDom }, { html: extraSibling, expression: wordsDom }, { html: extraText, expression: wordsDom }, { html: extraCitation, expression: wordsDom }, { html: hiddenCitationLink, expression: wordsDom }, { html: downloadCitationLink, expression: wordsDom }, { html: framedCitationLink, expression: wordsDom }, { html: swappedLimits, expression: wordsDom }], { chrome, siteRoot: dist });
  assert.deepEqual(moduleLoaded, { targetExists: true, initiallyOpen: false, afterOpen: true }, 'the served home module opens its folded target');
  assert.deepEqual(moduleBlocked, { targetExists: true, initiallyOpen: false, afterOpen: false }, 'the same served home stays closed when only the opener module is blocked');
  assert.equal(control.text, 'Closed label Open label Visible body Nested label', 'closed summaries and open bodies are counted');
  assert.ok(long.visible > VISIBLE_WORDS, 'quoted > and encoded spaces cannot hide an over-bound open body');
  assert.equal(actual.correctionVisible, true, 'the dated correction has visible area in the rendered main');
  assert.equal(actual.correctionWhenVisible, true, 'the dated correction heading is visible');
  assert.equal(actual.correctionLabelVisible, true, 'the dated correction label is visible');
  assert.deepEqual(actual.correctionTimesVisible, [true, true, true, true], 'both heading dates and both original correction dates are readable');
  assert.ok(actual.correctionText.includes('Wording clarification · 1 November 2026'), 'the dated label is rendered');
  assert.deepEqual(actual.correctionParagraphs, pinned, 'every pinned paragraph is rendered verbatim');
  assert.ok(actual.correctionParagraphVisible.every(Boolean), 'every pinned paragraph has visible area');
  for (const paragraph of pinned) assert.ok(actual.text.includes(paragraph), 'the rendered main includes the full correction paragraph');
  assert.ok(fadedCorrection.correctionParagraphVisible.every(value => value === false), 'opacity zero on child paragraphs is caught');
  assert.equal(transparentCorrection.correctionLabelVisible, false, 'a transparent correction label is unreadable');
  assert.ok(transparentCorrection.correctionParagraphVisible.every(value => value === false), 'transparent correction paragraphs are unreadable');
  assert.equal(transparentFillCorrection.correctionLabelVisible, false, 'a transparent correction glyph fill makes the label unreadable');
  assert.ok(transparentFillCorrection.correctionParagraphVisible.every(value => value === false), 'a transparent correction glyph fill makes every paragraph unreadable');
  assert.deepEqual(transparentTimeCorrection.correctionTimesVisible, [false, false, false, false], 'transparent child glyph fill hides each correction date');
  assert.equal(clippedCorrection.correctionVisible, false, 'a fully clipped correction is caught');
  assert.ok(partlyClippedCorrection.correctionParagraphVisible.every(value => value === false), 'any clip path on a required correction paragraph is refused before its first or last lines can be cut');
  assert.ok(overflowClippedCorrection.correctionParagraphVisible.every(value => value === false), 'a one-line overflow crop cannot conceal the rest of a required paragraph');
  assert.equal(filteredCorrection.correctionVisible, false, 'a fully transparent filter on the correction is caught');
  assert.deepEqual(actual.limits.map(limit => limit.id), ['proof-review-cost', 'proof-brokers', 'proof-self-verify'], 'all featured findings are inspected');
  assert.ok(actual.limits.every(({ claimShape }) => claimShape), 'the complete visible claim is one paragraph before its own limit and source');
  assert.equal(extraSiblingProof.limits[0].claimShape, false, 'a second visible conclusion paragraph before the limit is rejected');
  assert.equal(extraTextProof.limits[0].claimShape, false, 'a visible text node before the limit is rejected');
  assert.ok(actual.limits.every(({ id, claimText }) => claimText === sourceClaimTexts.get(id)), 'each visible finding retains its independently authored source claim and sourced values');
  assert.equal(extraClaimProof.limits.every(({ id, claimText }) => claimText === sourceClaimTexts.get(id)), false, 'an unsupported conclusion fails the source claim comparison');
  const sourceLimits = new Map(authoredClaims.map(({ id, limit }) => [id, `Limit: ${limit}`]));
  assert.ok(actual.limits.every(({ id, limitText }) => limitText === sourceLimits.get(id)), 'each visible limit stays paired with its own source finding');
  assert.equal(swappedProof.limits.every(({ id, limitText }) => limitText === sourceLimits.get(id)), false, 'swapped study limits fail their source pairing');
  const citationsMatch = result => result.limits.every(({ id, citationVisible, citationText, citationLinks, citationDates }) => {
    const expected = sourceCitations.get(id);
    return citationVisible && citationText === expected.text && JSON.stringify(citationDates) === JSON.stringify(expected.dates)
      && citationLinks.length === expected.links.length && citationLinks.every((link, index) => link.text === expected.links[index][0]
        && link.href === expected.links[index][1] && link.resolved === new URL(expected.links[index][1], result.pageUrl).href
        && link.visible && !link.download && !link.target);
  });
  assert.equal(citationsMatch(actual), true, 'each full citation, date and visible navigation link matches the independently authored source');
  assert.equal(extraCitationProof.limits[0].claimShape, true, 'the added source-paragraph sentence leaves the three-child shape intact');
  assert.equal(citationsMatch(extraCitationProof), false, 'an unsupported ranking after a source link fails the citation comparison');
  assert.equal(citationsMatch(hiddenCitationProof), false, 'an invisible written-plan label fails the link proof');
  assert.equal(citationsMatch(downloadCitationProof), false, 'a written-plan download fails the navigation proof');
  assert.equal(citationsMatch(framedCitationProof), false, 'a written-plan frame target fails the navigation proof');
  const clickLinks = [...sourceCitations].flatMap(([id, { links }]) => links.map(([label, href], index) => ({
    id, label, href, clickSelector: `#${id} .lab-source a:nth-of-type(${index + 1})`,
  })));
  const canceled = proof.replace('<a href="data/review-frontier/preregistration.json">the written plan</a>', '<a href="data/review-frontier/preregistration.json" onclick="event.preventDefault()">the written plan</a>');
  assert.notEqual(canceled, proof, 'the canceled-click control changes only the written-plan anchor');
  const activated = await inspectDom([
    ...clickLinks.map(({ clickSelector }) => ({ file: join(dist, 'index.html'), clickSelector })),
    { html: canceled, clickSelector: '#proof-review-cost .lab-source a:last-of-type' },
  ], { chrome, siteRoot: dist });
  for (const [index, link] of clickLinks.entries()) {
    assert.equal(activated[index].navigated, true, `${link.id}: activating ${link.label} loads this tab`);
    assert.equal(activated[index].url, new URL(link.href, activated[index].sourceUrl).href, `${link.id}: activating ${link.label} reaches its authored target`);
  }
  assert.equal(activated.at(-1).navigated, false, 'a canceled click cannot pass the citation navigation proof');
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

test('Chrome resolves both legacy findings fragments to a visible heading and shows the visual hero in the first viewport', { skip: !chrome && !chromeRequired ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 120000 }, async () => {
  assert.ok(chrome, 'Chrome is required in CI');
  const fragment = `new Promise(resolve => setTimeout(() => resolve((() => {
    const findings = document.getElementById('findings');
    const heading = document.getElementById('lab-title');
    const target = document.getElementById(location.hash.slice(1));
    const rect = heading?.getBoundingClientRect();
    return { hash: location.hash, targetInside: !!target && findings.contains(target), headingInside: !!heading && findings.contains(heading),
      labelledByHeading: findings.getAttribute('aria-labelledby') === heading?.id,
      headingVisible: !!heading && heading.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !!rect && rect.width > 0 && rect.height > 0
        && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0 };
  })()), 500))`;
  const viewport = `(() => {
    const intersects = selector => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return !!rect && rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
    };
    return { width: innerWidth, height: innerHeight, scrollX, scrollY,
      drawing: intersects('.factory-drawing'), panel: intersects('.station-compartment'), panelExists: !!document.querySelector('.station-compartment') };
  })()`;
  const hiddenHeading = home.replace('</head>', '<style>#lab-title { display: none }</style></head>');
  const hiddenAlias = home.replace('</head>', '<style>#lab { display: none }</style></head>');
  const [lab, labTitle, hidden, aliasHidden, desktop, phone] = await inspectDom([
    { file: join(dist, 'index.html'), hash: '#lab', expression: fragment },
    { file: join(dist, 'index.html'), hash: '#lab-title', expression: fragment },
    { html: hiddenHeading, hash: '#lab-title', expression: fragment },
    { html: hiddenAlias, hash: '#lab', expression: fragment },
    { file: join(dist, 'index.html'), viewport: { width: 1440, height: 900 }, expression: viewport },
    { file: join(dist, 'index.html'), viewport: { width: 390, height: 844 }, expression: viewport },
  ], { chrome, siteRoot: dist });
  for (const [value, hash] of [[lab, '#lab'], [labTitle, '#lab-title']]) assert.deepEqual(value, {
    hash, targetInside: true, headingInside: true, labelledByHeading: true, headingVisible: true,
  }, `${hash}: a real Chrome fragment resolves inside findings to its visible heading`);
  assert.equal(hidden.headingVisible, false, 'HTML strings alone cannot make a hidden legacy heading usable');
  assert.equal(aliasHidden.headingVisible, false, 'a hidden alias cannot leave the visible heading off screen after navigation');
  for (const [value, size] of [[desktop, [1440, 900]], [phone, [390, 844]]]) {
    assert.deepEqual([value.width, value.height, value.scrollX, value.scrollY], [size[0], size[1], 0, 0], `${size.join('×')}: viewport before scrolling`);
    assert.equal(value.drawing, true, `${size.join('×')}: the drawing intersects the first viewport`);
    assert.equal(value.panelExists, true, `${size.join('×')}: the selected panel remains in the hero`);
  }
  assert.equal(desktop.panel, true, 'the desktop first viewport also shows the selected station panel');
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
  const start = home.indexOf('<div class="factory-correction correction-note" role="note">');
  assert.ok(start >= 0, 'the visible notice');
  const block = home.slice(start, elementEnd(home, start));
  assert.ok(start > home.indexOf('id="findings"') && start > home.indexOf('id="how-we-check"') && start < home.indexOf('id="updates"'), 'visible after what we found, before updates');
  assert.ok(!detailsRanges(home).some(([a, b]) => a < start && start < b), 'not inside another <details>');
  assert.match(block, /^<div class="factory-correction correction-note" role="note"><h3 class="correction-when">We corrected our earlier headline and wording on <time datetime="2026-11-01">1 November 2026<\/time> and <time datetime="2026-11-02">2 November 2026<\/time>\.<\/h3><p class="correction-label">Wording clarification · <time datetime="2026-11-01">1 November 2026<\/time><\/p>/);
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
