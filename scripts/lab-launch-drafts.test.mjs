import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SYN_THEME } from './test-synthetic-names.mjs';
import { LAUNCH_FILES, X_LINK_WEIGHT, catalogue, changedSince, labDrafts, labUrl, readPage, writeLaunchDrafts, xLength } from './lab-launch-drafts.mjs';
import { SITE_URL } from './labs.mjs';
import { X_LIMIT } from './lab-dispatch-drafts.mjs';

// The launch-drafts cadence (mission rnd-nightshift-1112). Every page here is made up at run time: invented headline,
// lead and numbers, in the shape the lab pages are built in (hero with a lead, sections with h2 headings, a table, a
// "What this does not show" list and the "Related" links), so no real lab's words are fixed into this test.
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'lab-launch-drafts.mjs');
const temp = mkdtempSync(join(tmpdir(), 'lab-launch-drafts-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const run = (...argv) => spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8' });

const CARD = `${SITE_URL}assets/og/odin-rnd-og-image.png`;
const tile = { label: 'Lab 98', title: 'How many pebbles fit in the jar?', experiment: 'strangers' };
function page({ slug = 'strangers', headline = 'How many pebbles fit in the jar?', lead = 'A jar sits on the bench. We counted how many pebbles it takes before the lid will not close. This page sets the count beside a guess, and keeps the two apart.', canonical = labUrl(slug), og = CARD } = {}) {
  return `<!doctype html><html lang="en"><head><title>x</title><meta property="og:image" content="${og}"><link rel="canonical" href="${canonical}"></head><body>
<header><nav><a href="../">Labs</a></nav></header>
<main id="main">
  <section class="company-hero company-width labs-hero lab-hero"><div><span class="technical">LAB 98</span><h1 id="lab-title">${headline}</h1><p class="company-lead">${lead}</p></div></section>
  <section class="company-section" id="side"><div class="company-section-heading"><h2>The guess, and the count.</h2><p>Side by side.</p></div>
    <ul><li>Guessed cap: <strong>40 pebbles</strong>, at most 80 on a quiet day.</li><li>Counted on 3 jars of 1.5 litres. Every jar held 61 to 64.</li><li>No number here at all.</li></ul>
    <table><tr><td>Row with 999 in a table</td></tr></table>
  </section>
  <section class="company-section" id="limits"><div><h2>What this does not show.</h2></div><div class="company-prose"><ul><li>Only round pebbles were tried.</li><li>One bench, 1 afternoon.</li></ul></div></section>
  <section class="company-section"><h2>Related</h2><ul><li>Lab 97, 12 jars</li></ul></section>
</main></body></html>`;
}

test('readPage lifts the headline, lead, numbered sentences and boundary, and joins words across inline tags', () => {
  const p = readPage(page());
  assert.equal(p.canonical, labUrl('strangers'));
  assert.equal(p.ogImage, CARD);
  assert.equal(p.headline, 'How many pebbles fit in the jar?');
  assert.match(p.lead, /^A jar sits on the bench\./);
  assert.deepEqual(p.numbered, ['Guessed cap: 40 pebbles, at most 80 on a quiet day.', 'Counted on 3 jars of 1.5 litres.', 'Every jar held 61 to 64.']);
  assert.equal(p.boundary, 'Only round pebbles were tried.');
  assert.ok(!p.numbered.some(s => /999|12 jars|1 afternoon/.test(s)), 'no table cell, Related link or boundary line is a numbered sentence');
});

test('xLength counts a link as X does, 23', () => {
  assert.equal(xLength(`ab ${labUrl('strangers')}`), 3 + X_LINK_WEIGHT);
});

test('a lab drafts four files, each sentence quoted from the page, the X post within 280, the card named', () => {
  const html = page();
  const r = labDrafts(tile, html);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(Object.keys(r.files).sort(), [...LAUNCH_FILES].sort());
  const text = readPage(html).text;
  for (const file of ['linkedin.md', 'x.md', 'github-discussion.md']) {
    assert.ok(r.files[file].includes(labUrl('strangers')), `${file} links the page`);
    assert.match(r.files[file], /DRAFT — the founder posts/);
  }
  const post = r.files['x.md'].split('-->\n\n')[1].trim();
  assert.ok(xLength(post) <= X_LIMIT);
  // Every paragraph of the post but the label line and the link stands in the page text verbatim.
  for (const para of post.split('\n\n').slice(1, -1)) assert.ok(text.includes(para), para);
  assert.match(post, /Guessed cap: 40 pebbles, at most 80 on a quiet day\./);
  const card = JSON.parse(r.files['card.json']);
  assert.deepEqual({ card: card.card, repoPath: card.repoPath, siteDefault: card.siteDefault }, { card: CARD, repoPath: 'site/assets/og/odin-rnd-og-image.png', siteDefault: true });
  assert.match(r.files['linkedin.md'], /What this does not show: Only round pebbles were tried\./);
});

test('single-quoted attributes are read too', () => {
  const html = page().replace(`<meta property="og:image" content="${CARD}">`, `<meta property='og:image' content='${CARD}'>`).replace(`<link rel="canonical" href="${labUrl('strangers')}">`, `<link rel='canonical' href='${labUrl('strangers')}'>`);
  const p = readPage(html);
  assert.equal(p.canonical, labUrl('strangers'));
  assert.equal(p.ogImage, CARD);
  assert.deepEqual(labDrafts(tile, html).problems, []);
});

test('a lab card of its own is reported as its own', () => {
  const r = labDrafts(tile, page({ og: `${SITE_URL}assets/og/labs/strangers.png` }));
  assert.equal(JSON.parse(r.files['card.json']).siteDefault, false);
  assert.equal(JSON.parse(r.files['card.json']).repoPath, 'site/assets/og/labs/strangers.png');
});

test('when no sentence fits, the X post is the headline and the link, never a cut sentence', () => {
  const long = `${'A very long sentence about pebbles '.repeat(9).trim()}.`;
  const r = labDrafts(tile, page({ headline: `Pebbles ${'and jars '.repeat(25).trim()}`, lead: long }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.x.bare, true);
  assert.ok(!r.files['x.md'].includes('A very long'));
  assert.match(r.files['x.md'], /No sentence of the page fits/);
  // A headline too long to post even alone is refused, never shortened.
  const over = labDrafts(tile, page({ headline: `Pebbles ${'and jars '.repeat(27).trim()}`, lead: long }));
  assert.match(over.problems.join('\n'), /x\.md: \d+ characters, over 280/);
});

test('refused: a page that names another address, a card off the site, a restricted word, nothing written', () => {
  assert.match(labDrafts(tile, page({ canonical: labUrl('other') })).problems.join('\n'), /names itself/);
  assert.match(labDrafts(tile, page({ og: 'https://example.com/card.png' })).problems.join('\n'), /the card .*not on an allowed host/);
  const hit = labDrafts(tile, page({ lead: `A jar from ${SYN_THEME} sits on the bench.` }));
  assert.ok(hit.problems.some(p => /restricted name/.test(p)), hit.problems.join('\n'));
  assert.deepEqual(hit.files, {});
});

test('changedSince counts a page or tile change, never a data append', () => {
  const cat = catalogue();
  const log = ['site/labs/strangers/index.html', 'site/data/labs/same-model-harness-tile.json', 'site/data/labs/review/records/day.json', ''].join('\n');
  assert.deepEqual(changedSince('2026-11-05', { cat, log }), ['same-model-harness', 'strangers']);
  assert.deepEqual(changedSince('2026-11-05', { cat, log: 'site/data/labs/review/records/day.json\n' }), []);
  assert.throws(() => changedSince('last week', { cat, log }), /YYYY-MM-DD/);
});

test('changedSince reads a real git history: a page commit in the window counts, one before it and a data append do not', () => {
  const repo = join(temp, 'git'); mkdirSync(repo);
  const git = (env, ...a) => { const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', ...env } }); assert.equal(r.status, 0, r.stderr); };
  const commit = (date, file) => { mkdirSync(join(repo, dirname(file)), { recursive: true }); writeFileSync(join(repo, file), date); git({}, 'add', file); git({ GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` }, 'commit', '-q', '-m', file); };
  git({}, 'init', '-q');
  commit('2026-10-01', 'site/labs/same-model-harness/index.html');
  commit('2026-11-10', 'site/labs/strangers/index.html');
  commit('2026-11-11', 'site/data/labs/review/records/day.json');
  assert.deepEqual(changedSince('2026-11-05', { cat: catalogue(), repo }), ['strangers']);
});

test('writeLaunchDrafts writes a dated folder, and refuses an unknown lab or an out dir under site/ with nothing written', () => {
  const cat = new Map([['strangers', { ...tile, file: 'site/data/labs/strangers-tile.json' }]]);
  const out = join(temp, 'drafts');
  const ok = writeLaunchDrafts({ out, date: '2026-11-12', slugs: ['strangers'], pages: { strangers: page() }, cat, reason: 'Named.' });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(readdirSync(join(out, '2026-11-12', 'strangers')).sort(), [...LAUNCH_FILES].sort());
  assert.match(readFileSync(join(out, '2026-11-12', 'INDEX.md'), 'utf8'), /Lab 98.*X post \d+ of 280/);

  const none = join(temp, 'refused');
  const bad = writeLaunchDrafts({ out: none, date: '2026-11-12', slugs: ['strangers', 'no-such-lab'], pages: { strangers: page() }, cat, reason: 'Named.' });
  assert.match(bad.problems.join('\n'), /no-such-lab: not on the lab catalogue/);
  assert.equal(existsSync(none), false);

  const site = join(temp, 'site'); mkdirSync(site);
  const under = writeLaunchDrafts({ out: join(site, 'drafts'), date: '2026-11-12', slugs: ['strangers'], pages: { strangers: page() }, cat, reason: 'Named.', roots: [site] });
  assert.match(under.problems.join('\n'), /drafts are never published/);

  const empty = writeLaunchDrafts({ out: join(temp, 'empty'), date: '2026-11-12', slugs: [], pages: {}, cat, reason: 'Since.' });
  assert.match(readFileSync(join(temp, 'empty', '2026-11-12', 'INDEX.md'), 'utf8'), /nothing to draft/);
  assert.deepEqual(empty.problems, []);
});

test('the command drafts from a page folder, and refuses usage without --labs or --since', () => {
  const pages = join(temp, 'pages', 'labs', 'strangers'); mkdirSync(pages, { recursive: true });
  writeFileSync(join(pages, 'index.html'), page());
  const out = join(temp, 'cli');
  const r = run('--out', out, '--labs', 'strangers', '--page-dir', join(temp, 'pages'), '--date', '2026-11-12');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRAFTED 1 lab/);
  assert.ok(existsSync(join(out, '2026-11-12', 'strangers', 'x.md')));
  assert.equal(run('--out', out).status, 3);
});
