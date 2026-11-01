// "On this page" (scripts/site-toc.mjs, mission rnd-site-ux-nav-1101 wave 4): pure tests on synthetic pages, at and
// either side of each criterion, then the real build in a disposable copy (scripts/test-build.mjs), never in the checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { addToc, mainHeadings, mainWords, slugify, tocCandidate, TOC_MIN_HEADINGS, TOC_MIN_WORDS } from './site-toc.mjs';
import { NUMBER_PROVENANCE_DIRS } from './site-chrome.mjs';
import { builtCopy } from './test-build.mjs';

const words = n => Array.from({ length: n }, (_, i) => `word${i % 10 === 0 ? '' : 'x'}`).join(' ');

/** A field note in the committed shell: crumbs, back link, article header, then the body with `headings` h2s. */
function note({ headings = ['One', 'Two', 'Three', 'Four'], total = 2400, extra = '' } = {}) {
  const per = Math.floor(total / headings.length);
  const body = headings.map(h => `<h2>${h}</h2><p>${words(per)}</p>`).join('\n');
  return `<!doctype html><html><head><title>A note — Odin R&amp;D</title></head><body><header class="site-header dark-surface"><nav><a href="../">Home</a></nav></header>
<main id="main" class="article-shell"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li aria-current="page">A note</li></ol></nav><a class="article-back" href="../#journal">Back</a><header class="article-header"><h1>A note</h1><p class="article-meta">FIELD NOTE · 01 NOV 2026</p></header><article class="article-body">
${extra}${body}
</article></main><aside class="related" aria-label="Related"><h2 class="related-heading">Related</h2></aside><footer class="site-footer"></footer></body></html>`;
}

/** A lab page in the committed shell: a hero section, then sections each opening with an h2 that carries an id. */
function lab({ count = 5, total = 2600 } = {}) {
  const per = Math.floor(total / count);
  const sections = Array.from({ length: count }, (_, i) => `<section class="company-section company-width" id="s${i}"><h2 id="s${i}-title">Part ${i}.</h2><p>${words(per)}</p></section>`).join('\n');
  return `<!doctype html><html><head><title>A lab</title></head><body><header class="site-header dark-surface"><nav></nav></header>
<main id="main"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="../../">Home</a></li><li aria-current="page">A lab</li></ol></nav>
<section class="company-hero company-width lab-hero" aria-labelledby="lab-title"><div><h1 id="lab-title">A lab.</h1></div></section>
${sections}
</main><footer class="site-footer"></footer></body></html>`;
}

const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const tocLinks = html => {
  const nav = /<nav class="toc[^"]*"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  const rail = /<div class="toc-rail">[\s\S]*?<\/div>/.exec(nav)?.[0] ?? '';
  return [...rail.matchAll(/<a href="#([^"]+)">/g)].map(m => m[1]);
};

test('the criteria: more than TOC_MIN_WORDS words of main text and at least TOC_MIN_HEADINGS h2s, both needed', () => {
  assert.equal(TOC_MIN_WORDS, 2000);
  assert.equal(TOC_MIN_HEADINGS, 4);
  const rel = 'journal/a-note.html';
  assert.match(addToc(note({ total: 2400 }), rel), /<nav class="toc toc-note" aria-label="On this page">/, 'long, four headings: added');
  const short = note({ total: 1980 });
  assert.ok(mainWords(short, rel) <= 2000, `the short fixture is at most 2000 words (${mainWords(short, rel)})`);
  assert.equal(addToc(short, rel), short, 'four headings but not past 2000 words: unchanged');
  const three = note({ headings: ['One', 'Two', 'Three'], total: 6000 });
  assert.equal(addToc(three, rel), three, 'long but three headings: unchanged');
  // The related aside's h2 is outside <main>, so it neither counts nor is listed.
  assert.deepEqual(mainHeadings(note(), rel).map(h => h.text), ['One', 'Two', 'Three', 'Four']);
});

test('only field notes and lab pages, never a number-provenance page, a section index or any other page', () => {
  const page = note({ total: 5000 });
  for (const rel of ['journal/a.html', 'labs/x/index.html']) assert.ok(tocCandidate(rel), rel);
  for (const dir of NUMBER_PROVENANCE_DIRS) {
    assert.equal(tocCandidate(`${dir}index.html`), false, dir);
    assert.equal(addToc(page, `${dir}index.html`), page, `${dir}: byte-identical, no digit added`);
  }
  for (const rel of ['journal/index.html', 'projects/index.html', 'projects/ci-witness/index.html', 'index.html', 'labs/index.html', 'labs/agent-space/story/index.html', 'updates/index.html', 'records/x/index.html']) {
    assert.equal(addToc(page, rel), page, rel);
  }
});

test('placed right after the article header on a note and after the hero on a lab; links every listed h2 in order', () => {
  const out = addToc(note(), 'journal/a.html');
  assert.ok(out.includes('</header><nav class="toc toc-note"'), 'directly after the article header');
  assert.ok(out.indexOf('<nav class="toc') < out.indexOf('<article class="article-body">'), 'before the text');
  assert.deepEqual(tocLinks(out), ['one', 'two', 'three', 'four']);
  // Both renderings hold the same list: the fold (narrow screens) and the rail (wide ones).
  const nav = /<nav class="toc[\s\S]*?<\/nav>/.exec(out)[0];
  assert.match(nav, /^<nav class="toc toc-note" aria-label="On this page"><details class="toc-fold"><summary>On this page<span aria-hidden="true">\+<\/span><\/summary><ol class="toc-list">/);
  assert.equal((nav.match(/href="#one"/g) || []).length, 2, 'once in the fold, once in the rail');
  assert.doesNotMatch(nav, /<details[^>]*\bopen/, 'the fold starts closed');
  const labOut = addToc(lab(), 'labs/x/index.html');
  assert.ok(labOut.includes('</section><nav class="toc toc-lab company-width"'), 'directly after the hero section');
  assert.deepEqual(tocLinks(labOut), ['s0-title', 's1-title', 's2-title', 's3-title', 's4-title'], 'existing ids used as they are');
});

test('ids: existing ones never change; new ones come from the text, unique on the page, also against any other id', () => {
  const extra = '<section id="results" class="article-amendment"><h2>Results</h2><p>x</p></section><div data-id="the-plan"></div><h2 id="kept-as-is">The plan</h2>';
  const page = note({ headings: ['The plan', 'The plan', 'What’s next: café & “quotes”', 'Results', 'Results'], total: 3000, extra });
  const out = addToc(page, 'journal/a.html');
  assert.ok(out.includes('<h2 id="kept-as-is">The plan</h2>'), 'an existing id is kept byte for byte');
  const listed = tocLinks(out);
  assert.deepEqual(listed, ['results', 'kept-as-is', 'the-plan-2', 'the-plan-3', 'what-s-next-cafe-quotes', 'results-2', 'results-3']);
  assert.ok(out.includes('<section id="results" class="article-amendment"><h2>Results</h2>'), 'a heading that opens a section with an id is linked by that id and left byte for byte');
  const all = ids(out);
  assert.equal(all.length, new Set(all).size, 'no id twice, read the way scripts/check.mjs reads them (data-id included)');
  for (const id of listed) assert.equal(all.filter(x => x === id).length, 1, `#${id} lands on exactly one element`);
  assert.equal(slugify('  ¿Qué? —  '), 'que');
  assert.equal(slugify('***'), 'section');
});

test('stable and idempotent: the same page gives the same bytes, and a second pass changes nothing', () => {
  const page = note({ total: 3000 });
  const once = addToc(page, 'journal/a.html');
  assert.equal(addToc(page, 'journal/a.html'), once, 'deterministic');
  assert.equal(addToc(once, 'journal/a.html'), once, 'idempotent');
  const labOnce = addToc(lab(), 'labs/x/index.html');
  assert.equal(addToc(labOnce, 'labs/x/index.html'), labOnce);
  // Adding a heading's id does not move the others: each id depends only on its own text and those before it.
  const more = addToc(note({ headings: ['One', 'Two', 'Three', 'Four', 'Five'], total: 3000 }), 'journal/a.html');
  assert.deepEqual(tocLinks(more).slice(0, 4), tocLinks(once));
});

test('a heading inside a <details> is not listed and not counted', () => {
  const extra = '<details><summary>More</summary><h2>Folded</h2></details>';
  const page = note({ headings: ['One', 'Two', 'Three'], total: 3000, extra });
  assert.deepEqual(mainHeadings(page, 'journal/a.html').map(h => h.text), ['One', 'Two', 'Three']);
  assert.equal(addToc(page, 'journal/a.html'), page, 'three listable headings: unchanged');
});

test('a page without its header, or with two <main>s, stops the pass instead of guessing', () => {
  const headless = note({ total: 3000 }).replace(/<header class="article-header">[\s\S]*?<\/header>/, '');
  assert.throws(() => addToc(headless, 'journal/a.html'), /no article header/);
  const twoMains = note({ total: 3000 }).replace('</main>', '</main><main></main>');
  assert.throws(() => addToc(twoMains, 'journal/a.html'), /exactly one <main>/);
});

test('as built: the long notes and Lab 01 have one, short pages and number-provenance pages none, every anchor resolves', () => {
  const dist = join(builtCopy(), 'dist');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);
  const pages = new Map(walk(dist).map(file => [relative(dist, file).split('\\').join('/'), readFileSync(file, 'utf8')]));
  const withToc = [...pages].filter(([, html]) => html.includes('<nav class="toc')).map(([rel]) => rel).sort();
  for (const rel of ['labs/agent-space/index.html', 'journal/nina-reviews-the-change.html', 'journal/jev-as-a-fast-gate.html']) assert.ok(withToc.includes(rel), `${rel} has one`);
  // Below a criterion: failover (about 1,600 words, nine headings) and how-we-decide (about 2,300 words, two headings).
  for (const rel of ['journal/failover-pre-registration.html', 'labs/how-we-decide/index.html', 'journal/index.html']) assert.ok(!withToc.includes(rel), `${rel} has none`);
  for (const rel of withToc) {
    assert.ok(tocCandidate(rel), `${rel} is a note or lab page`);
    assert.ok(!NUMBER_PROVENANCE_DIRS.some(dir => rel.startsWith(dir)), `${rel} is not a number-provenance page`);
    const html = pages.get(rel);
    assert.equal((html.match(/<nav class="toc/g) || []).length, 1, `${rel}: one table of contents`);
    const listed = tocLinks(html);
    assert.ok(listed.length >= 4, `${rel}: at least four entries`);
    assert.deepEqual(listed, mainHeadings(html, rel).map(h => h.id), `${rel}: exactly its listed headings, in order`);
    const all = ids(html);
    assert.equal(all.length, new Set(all).size, `${rel}: no repeated id`);
    for (const id of listed) assert.ok(all.includes(id), `${rel}: #${id} exists`);
    assert.equal(addToc(html, rel), html, `${rel}: a second pass changes nothing`);
  }
  // Ids the committed note already had are all still there, unchanged.
  for (const name of readdirSync('site/journal').filter(n => n.endsWith('.html'))) {
    const built = new Set(ids(pages.get(`journal/${name}`)));
    for (const id of ids(readFileSync(join('site/journal', name), 'utf8'))) assert.ok(built.has(id), `journal/${name}: id "${id}" kept`);
  }
});

test('as built: Lab 01\'s pull-request log is folded closed under its count, every block kept', () => {
  const html = readFileSync(join(builtCopy(), 'dist/labs/agent-space/index.html'), 'utf8');
  const fold = /<details class="delivery-log"><summary>Source log \((\d+) entries, one per pull request\)<span aria-hidden="true">\+<\/span><\/summary>([\s\S]*?)<\/details>/.exec(html);
  assert.ok(fold, 'the log is in a closed <details> with its count');
  const blocks = (fold[2].match(/<article class="delivery-pr"/g) || []).length;
  assert.equal(blocks, Number(fold[1]), 'the count is the number of blocks it holds');
  assert.equal((html.match(/<article class="delivery-pr"/g) || []).length, blocks, 'no block outside it, none dropped');
  const record = JSON.parse(readFileSync('site/data/labs/delivery/odin-rnd.json', 'utf8'));
  assert.equal(blocks, record.prs.length, 'one block per pull request of the record');
});
