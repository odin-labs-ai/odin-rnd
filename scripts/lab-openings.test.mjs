// Plain openings on every lab page (mission rnd-site-human PR 3, 2026-11-16; the founder found the site "too technical /
// jargon" and "hard to navigate"; PLAN A4). Each lab page opens, right after its hero, with In short (two plain
// sentences), What we found, Why it matters and a one-line Limit, then the existing detail; the record's identifiers sit,
// verbatim, in closed "How we checked" folds (scripts/lab-pages.mjs openLabPages, run by scripts/labs.mjs renderLabs, from
// site/data/lab-openings.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { bannedIn, jargon, plainBanned } from './plain-words.mjs';
import { blockText, CHECKED_OPEN, CHECKED_SUMMARY, elementEnd, foldChecks, glossaryIds, NOT_A_LAB, OPENINGS_CONFIG, pageLinks, renderOpening, resolveHref, siteReader, statesNumber, unfoldChecks } from './lab-pages.mjs';
import { renderLabPages, renderLabs } from './labs.mjs';
import { withLabRuns } from './lab-runs.mjs';

const config = JSON.parse(readFileSync(join('site', OPENINGS_CONFIG), 'utf8'));
const labPages = readdirSync('site/labs', { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join('site/labs', d.name, 'index.html'))).map(d => d.name);
const labs = labPages.filter(lab => !NOT_A_LAB.includes(`labs/${lab}/index.html`)).sort();
const read = siteReader('site');
const ids = glossaryIds('site');
const banned = [...jargon, ...plainBanned];
const openingOf = html => html.match(/<section class="company-section company-width lab-opening" id="in-short"[\s\S]*?<\/section>/)?.[0];
const sample = { short: 'We asked a plain question. The answer was plain too.', found: [[{ quote: 'caught 26 of 60' }]], why: 'It helps you choose.', limit: 'Our own cases.' };
const pageText = 'The model caught 26 of 60 tries. A broker served it.';

test('every lab page has an opening in the config, and only the pages about the labs (runs, how we decide) have none', () => {
  assert.deepEqual(Object.keys(config.labs).sort(), labs);
  assert.deepEqual(NOT_A_LAB.sort(), ['labs/how-we-decide/index.html', 'labs/runs/index.html']);
  assert.ok(labs.length >= 12, 'twelve labs or more');
});

test('the opening fails closed: a number in plain words, a quote the page does not hold, a glossary phrase not used or not in the glossary, a banned word, a third sentence', () => {
  assert.ok(renderOpening(read, 'sample', sample, { pageText, glossaryIds: ids }));
  const refuses = (change, pattern) => assert.throws(() => renderOpening(read, 'sample', { ...sample, ...change }, { pageText, glossaryIds: ids }), pattern);
  refuses({ why: 'It helps you choose from 4 models.' }, /plain words state a number/);
  refuses({ why: 'It helps you choose between two models.' }, /plain words state a number/);
  refuses({ found: [[{ quote: 'caught 27 of 60' }]] }, /the page no longer says/);
  refuses({ glossary: { reseller: 'broker' } }, /not used in the plain words/);
  refuses({ why: 'A broker helps you choose.', glossary: { broker: 'no-such-entry' } }, /not on How we test/);
  refuses({ why: 'It shows where the frontier lies.' }, /banned lab word/);
  refuses({ why: 'It was pre-registered.' }, /banned lab word/);
  refuses({ limit: 'Our own fixtures.' }, /banned lab word/);
  refuses({ short: 'We asked a question. We answered it. We said more.' }, /two sentences/);
  refuses({ found: [] }, /one to three findings/);
  refuses({ price: 'none' }, /unknown field/);
});

test('a glossary phrase links its first use in the opening only, a quote\'s words unchanged', () => {
  const html = renderOpening(read, 'sample', { ...sample, why: 'A broker served it, and the broker billed it.', limit: [{ quote: 'A broker served it.' }], glossary: { broker: 'broker' } }, { pageText, glossaryIds: ids });
  assert.equal(html.split('href="../../methods/#glossary-broker"').length - 1, 1);
  assert.match(html, /<p class="lab-opening-why">A <a class="glossary-link" href="\.\.\/\.\.\/methods\/#glossary-broker">broker<\/a> served it, and the broker billed it\.<\/p>/);
  assert.match(blockText(html), /Limit: A broker served it\./);
});

test('the folds keep the text: on every rendered lab page, taking the opening and the fold tags out gives back the page byte for byte, and no source line with a hash is left in view', () => {
  const before = withLabRuns(renderLabPages('site'), 'site'), pages = renderLabs();
  for (const lab of labs) {
    const rel = `labs/${lab}/index.html`, page = before[rel], folded = pages[rel];
    assert.ok(page && folded, `labs/${lab}/ is rendered`);
    assert.equal(unfoldChecks(folded).replace(openingOf(folded), ''), page, `${lab}: nothing reworded or removed`);
    assert.equal(foldChecks(folded, lab), folded, `${lab}: folding twice changes nothing`);
    for (const at of [...folded.matchAll(/<details class="method-details lab-checked">/g)].map(m => m.index)) {
      const fold = folded.slice(at, elementEnd(folded, at));
      assert.ok(fold.startsWith(CHECKED_OPEN), `${lab}: each fold is titled "${CHECKED_SUMMARY}", closed`);
      assert.doesNotMatch(fold.slice(0, fold.indexOf('</summary>')), /\bopen\b/);
    }
    // Every hash of the page is still on the page; out of the folds and the page's own disclosures, no list of digests is.
    const hashes = page.match(/\b[0-9a-f]{40,64}\b/g) ?? [];
    for (const h of hashes) assert.ok(folded.includes(h), `${lab}: ${h.slice(0, 12)} kept`);
    const main = folded.slice(folded.indexOf('<main'), folded.indexOf('</main>'));
    const visible = main.replace(/<details\b[\s\S]*?<\/details>/g, ' ');
    assert.doesNotMatch(visible, /<p class="lab-source[^"]*"[^>]*>(?:(?!<\/p>)[\s\S])*\bsha256\b/, `${lab}: no source line with a sha256 in view`);
    assert.doesNotMatch(visible, /<div class="lab-provenance"/, `${lab}: the latest-run provenance is folded`);
  }
});

test('the plain words of every opening carry no digit and no number word, and no banned lab word anywhere in it', () => {
  for (const [lab, o] of Object.entries(config.labs)) {
    for (const part of ['short', 'found', 'why', 'limit']) {
      const segments = (part === 'found' ? o.found.flat() : [o[part]].flat());
      for (const s of segments) {
        if (typeof s === 'string') assert.ok(!statesNumber(s), `${lab} ${part}: "${s}" states a number`);
        else assert.ok(s.quote !== undefined || s.value || s.window, `${lab} ${part}: a segment is words, a quote, a value or a window`);
        if (typeof s === 'string' || s.quote) assert.deepEqual(bannedIn(typeof s === 'string' ? s : s.quote, banned), [], `${lab} ${part}`);
      }
    }
  }
});

test('the pages about the labs pass through: no opening and no fold on the runs list or the How we decide ledger', () => {
  const before = withLabRuns(renderLabPages('site'), 'site'), pages = renderLabs();
  for (const rel of NOT_A_LAB) assert.equal(pages[rel], before[rel], rel);
  for (const rel of Object.keys(before).filter(p => !/^labs\/[^/]+\/index\.html$/.test(p))) assert.equal(pages[rel], before[rel], rel);
});

test('as built: every lab page opens with the four parts in order, right after its hero; plan and result link each other; the folds are closed and keep the record\'s words', { timeout: 600_000 }, () => {
  const dist = join(builtCopy(), 'dist');
  const built = JSON.parse(readFileSync(join(dist, 'data/lab-openings.json'), 'utf8'));
  assert.deepEqual(built, config, 'the built data is the committed config');
  for (const lab of labs) {
    const rel = `labs/${lab}/index.html`;
    const html = readFileSync(join(dist, rel), 'utf8');
    const opening = openingOf(html);
    assert.ok(opening, `${rel}: has an opening`);
    assert.equal(html.split('id="in-short"').length - 1, 1, `${rel}: one opening`);
    // Right after the hero: only the page's own "On this page" list may sit between them.
    const hero = html.search(/<section class="company-hero\b/);
    const between = html.slice(elementEnd(html, hero), html.indexOf(opening)).replace(/<nav class="toc[\s\S]*?<\/nav>/, '').trim();
    assert.equal(between, '', `${rel}: the opening follows the hero`);
    const text = blockText(opening);
    let at = -1;
    for (const part of ['In short.', 'What we found', 'Why it matters', 'Limit:']) {
      const next = text.indexOf(part, at + 1);
      assert.ok(next > at, `${rel}: "${part}" comes next`);
      at = next;
    }
    const short = blockText(opening.match(/<p class="lab-opening-short">([\s\S]*?)<\/p>/)[1]);
    assert.equal(short.split(/(?<=[.?!])\s+(?=[A-Z])/).length, 2, `${rel}: In short is two sentences`);
    assert.ok(short.split(/\s+/).length <= 60, `${rel}: In short is short`);
    assert.deepEqual(bannedIn(text, banned), [], `${rel}: no banned lab word in the opening`);
    const found = opening.match(/<ul class="lab-opening-found">([\s\S]*?)<\/ul>/)[1].match(/<li>/g).length;
    assert.ok(found >= 1 && found <= 3, `${rel}: one to three findings`);
    assert.equal(opening.match(/<p class="lab-limit lab-opening-limit"><strong>Limit:<\/strong>/g)?.length, 1, `${rel}: one limit line`);
    // Every link of the opening lands on a built file; a glossary link on an entry; each configured phrase linked once.
    for (const m of opening.matchAll(/\shref="([^"]+)"/g)) {
      const [path, hash] = m[1].split('#');
      const target = resolveHref(rel, path);
      assert.ok(existsSync(join(dist, target)), `${rel}: ${m[1]} lands on a built file`);
      if (hash) assert.ok(readFileSync(join(dist, target), 'utf8').includes(`id="${hash}"`), `${rel}: ${m[1]} lands on its anchor`);
    }
    for (const [phrase, entry] of Object.entries(config.labs[lab].glossary ?? {})) {
      assert.equal(opening.split(`href="../../methods/#glossary-${entry}">${phrase}</a>`).length - 1, 1, `${rel}: '${phrase}' links its glossary entry at its first use`);
    }
    for (const p of config.labs[lab].pairs ?? []) {
      assert.ok(pageLinks(opening, rel, p.plan.href) && pageLinks(opening, rel, p.result.href), `${rel}: links the plan and its result`);
      if (p.plan.href.endsWith('.html')) assert.ok(pageLinks(readFileSync(join(dist, p.plan.href), 'utf8'), p.plan.href, p.result.href), `${p.plan.href} links its result`);
      assert.ok(pageLinks(readFileSync(join(dist, p.result.href), 'utf8'), p.result.href, p.plan.href), `${p.result.href} links back to its plan`);
    }
    // Every fold is closed, titled How we checked, and holds the record's words: the page's hashes are all still there.
    const folds = [...html.matchAll(/<details class="method-details lab-checked">/g)];
    for (const f of folds) assert.ok(html.startsWith(CHECKED_OPEN, f.index), `${rel}: a closed "${CHECKED_SUMMARY}" fold`);
  }
  // The review page: the costs are shown with their date and source, and the old sentence is gone.
  const review = readFileSync(join(dist, 'labs/review/index.html'), 'utf8');
  assert.doesNotMatch(blockText(review), /does not show money figures/);
  assert.match(blockText(review), /This site shows a cost only with its date and its source/);
});
