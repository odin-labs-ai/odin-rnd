import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAN_ONLY, RECEIPTS, RECEIPT_PRS, REVIEW_PIN, REVIEW_RECORD, REVIEW_TEMPLATE, SOURCES, readReview, receiptTokens, renderReview, reviewProblems } from './lab-review.mjs';
import { SOURCE_COMMITS, build, serialise } from './vendor-review.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { maskKit } from './lab-rerun.mjs';
import { renderLabs } from './labs.mjs';
import { namesRestricted } from './lab-dispatch-publish.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

// Lab 06, "Which model should review your code?" (scripts/lab-review.mjs). Every number it shows is re-derived from a
// committed experiment record, and in CI each experiment's own --check recomputes that record (the first two tests).
const raw = readFileSync(join('site', REVIEW_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[REVIEW_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');

test('CI: EXP 017\'s own analysis recomputes its committed results record (node experiments/review-frontier/analyse.mjs --check)', () => {
  const r = spawnSync(process.execPath, ['experiments/review-frontier/analyse.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /EXP 017: results\.json matches the frozen analysis/);
});

test('CI: EXP 006\'s own scorer recomputes its committed results record byte for byte (write-results6.mjs --check)', () => {
  const r = spawnSync(process.execPath, ['experiments/nina-changes/write-results6.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS experiments\/nina-changes\/results\/results\.json recomputes byte for byte \(sha256 3ef7bcf6d0317b2095df953b404e86059f9b84ffc4af6b4cb476ddaa7d9c916c\)/);
  assert.equal(record.sources.find(s => s.role === 'nina').sha256, '3ef7bcf6d0317b2095df953b404e86059f9b84ffc4af6b4cb476ddaa7d9c916c');
});

test('Lab 06 renders, sits on the Labs index after Lab 05 and is in the sitemap', () => {
  assert.ok(page);
  const index = pages['labs/index.html'];
  const lab05 = index.indexOf('aria-labelledby="lab-tile-rogue"'), lab06 = index.indexOf('aria-labelledby="lab-tile-review"');
  assert.ok(lab05 >= 0 && lab06 > lab05, 'Lab 06 follows Lab 05');
  assert.match(index, /<span class="technical">LAB 06<\/span><h2 id="lab-tile-review">Which model should review your code\?<\/h2>/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/review/</loc>'));
});

test('every figure is what the committed experiment records give, and the record cites each by its commit and sha256', () => {
  assert.deepEqual(reviewProblems(record), []);
  for (const s of record.sources) {
    assert.equal(s.file, SOURCES[s.role].file);
    assert.equal(s.commit, SOURCE_COMMITS[s.role]);
    assert.equal(s.sha256, sha256(readFileSync(s.file)));
    assert.ok(main.includes(`<code>${s.commit.slice(0, 8)}</code>`) && main.includes(`<code>${s.sha256}</code>`), s.role);
  }
  const t = textOf(main);
  for (const x of record.frontier.seats) assert.ok(t.includes(`${x.name} ${x.caught} of 60 (${x.caughtPerRun.join(' and ')}) ${x.falseAlarms} of 60 (${x.falseAlarmsPerRun.join(' and ')}) ${x.noVerdict}`), x.seat);
  assert.match(t, /Off it: Claude Sonnet 5\.5, because another model caught at least as many for no more per review\./);
  assert.match(t, /Every run is counted\. A run whose own tool calls do not show it read the change is blind, and a blind run is scored as an error, whatever it decided/);
  assert.match(t, /Blind runs, each scored as an error above: 3 of 180; the registered check allowed at most 18\./);
  assert.doesNotMatch(t, /counts only when/);
  assert.match(t, /Rule-breaking changes it accepted: 1 of 90 runs\. Good changes it rejected: 2 of 90 runs\. Changes given the same verdict in every one of their runs: 57 of 60 \./);
});

test('no money figure anywhere: not on the page, not in the record, not on the tile', () => {
  const tile = readFileSync('site/data/labs/review-tile.json', 'utf8');
  for (const [name, text] of [['page', textOf(main)], ['record', raw], ['tile', tile]]) {
    assert.doesNotMatch(text, /[€$£¥]\s?\d|\d\s?(?:usd|eur|cents?|dollars?)\b|\bcost(?:Usd|PerReview)|\bper 1m\b|listPrice/i, name);
  }
  assert.match(textOf(main), /The price of a review is in the experiment's record , not on this page; this site does not show money figures\./);
});

test('the parts that are not a measurement here are boxed: authored fixtures, the summary and the AI reviewer', () => {
  const fixtures = [...main.matchAll(/<div class="lab-panel review-fixture"><p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US<\/p>/g)];
  assert.equal(fixtures.length, 2, 'both corpora are boxed as authored');
  const summary = main.match(/<div class="lab-panel review-summary" id="self-verify-summary">([\s\S]*?)<\/div>/)[1];
  assert.match(summary, /^<p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE<\/p>/);
  assert.match(textOf(summary), /caught 13 of 30 defects, flagged 20 of 30 clean changes.*caught 14 of 30 defects, flagged 22 of 30 clean changes/);
  assert.match(textOf(summary), /cannot re-run them/);
  // EXP 012's counts appear only inside its box.
  assert.doesNotMatch(main.replace(summary, ''), /EXP 012[\s\S]*?(13 of 30|20 of 30)/);
  const judge = main.match(/<div class="lab-panel review-judge" id="receipts">[\s\S]*<\/article><\/div><\/div>/)[0];
  assert.match(judge, /^<div class="lab-panel review-judge" id="receipts"><p class="technical">A SEPARATE AI REVIEWER, NOT A HUMAN<\/p>/);
  assert.equal((main.match(/class="lab-panel review-receipt"/g) ?? []).length, record.gallery.length);
  assert.doesNotMatch(main.replace(judge, ''), /class="lab-panel review-receipt"/, 'no receipt outside the AI-reviewer box');
});

test('left out, as the work order says: reviewer-keep and the journal note\'s headline', () => {
  for (const text of [main, raw]) {
    assert.doesNotMatch(text, /reviewer-keep|63\s?%|23\s?%|p\s?=\s?0\.002/i);
  }
});

test('the gallery quotes only the listed pull requests, word for word, each receipt a FIX-NEEDED', () => {
  assert.deepEqual([...record.gallery.map(g => g.pr), ...record.planOnly].sort((a, b) => a - b), [...RECEIPT_PRS].sort((a, b) => a - b));
  assert.ok(!RECEIPT_PRS.includes(76) && !RECEIPT_PRS.includes(81));
  for (const g of record.gallery) {
    assert.deepEqual(g.receipt, RECEIPTS[g.pr]);
    assert.ok(g.receipt.some(p => p.includes('FIX-NEEDED')), g.pr);
    const card = main.match(new RegExp(`<article class="lab-panel review-receipt" id="receipt-${g.pr}">[\\s\\S]*?</article>`))[0];
    assert.ok(card.includes(`href="https://github.com/odin-labs-ai/odin-rnd/pull/${g.pr}"`));
    for (const part of g.receipt) assert.ok(textOf(card).includes(part), `${g.pr}: ${part.slice(0, 40)}`);
  }
  assert.deepEqual(record.planOnly, PLAN_ONLY);
});

test('the vendor checks each receipt against the pull request\'s own description, and refuses a paraphrase', () => {
  const bodies = Object.fromEntries(RECEIPT_PRS.map(n => [n, { number: n, title: record.gallery.find(g => g.pr === n)?.title ?? 't', state: 'MERGED', mergeCommit: { oid: record.gallery.find(g => g.pr === n)?.mergeCommit ?? 'f'.repeat(40) }, body: PLAN_ONLY.includes(n) ? 'Landing-Plan: review, bounded recheck on FIX-NEEDED' : RECEIPTS[n].join('\n') }]));
  // No history in CI (one commit checked out): git answers with the committed bytes and "is an ancestor".
  const git = (cmd, arg) => (cmd === 'show' ? readFileSync(arg.split(':')[1]) : Buffer.alloc(0));
  const run = readPr => build({ readPr, git });
  assert.equal(serialise(run(n => bodies[n])), raw, 'the same descriptions give the committed record');
  assert.throws(() => build({ readPr: n => bodies[n], git: (cmd, arg) => (cmd === 'show' ? Buffer.from('{}') : Buffer.alloc(0)) }), /not the bytes at 9c379579/);
  assert.throws(() => build({ readPr: n => bodies[n], git: (cmd, arg) => { if (cmd === 'merge-base') throw new Error('no'); return readFileSync(arg.split(':')[1]); } }), /is not part of origin\/main/);
  assert.throws(() => run((n) => (n === 82 ? { ...bodies[n], body: 'Review round 1 was fixed.' } : bodies[n])), /#82: its receipt is not word for word/);
  assert.throws(() => run((n) => (n === 56 ? { ...bodies[n], body: 'Review row abc (FIX-NEEDED) fixed.' } : bodies[n])), /#56: listed as plan only, but its description records a FIX-NEEDED/);
  assert.throws(() => run((n) => (n === 45 ? { ...bodies[n], state: 'OPEN' } : bodies[n])), /#45: not merged/);
  for (const body of ['', 'A page for model providers.', 'Landing-Plan: driver x · land odin-pr-land.sh on SHIP']) assert.throws(() => run((n) => (n === 54 ? { ...bodies[n], body } : bodies[n])), /#54: listed as plan only, but its description has no Landing-Plan line naming the review step/, JSON.stringify(body));
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re, opts) => { const r = clone(); change(r); const p = reviewProblems(r, opts); assert.ok(p.some(x => re.test(x)), `${re}\n${p.join('\n')}`); };
  refused(r => { r.frontier.seats[0].caught = 40; }, /frontier: not what experiments\/review-frontier\/results\.json gives/);
  refused(r => { r.frontier.offFrontier = []; }, /frontier: not what/);
  refused(r => { r.nina.missedDrift.x = 0; }, /nina: not what/);
  refused(r => { r.selfVerify.runs[0].falseAlarms = 2; }, /selfVerify: not what/);
  refused(r => { r.sources[0].sha256 = '0'.repeat(64); }, /is now [0-9a-f]{64}; re-vendor/);
  refused(r => { r.sources[1].file = 'experiments/other/results.json'; }, /sources\/1\/file: not experiments\/nina-changes/);
  refused(r => { r.sources.reverse(); }, /one per source, in order/);
  refused(r => { r.gallery[0].pr = 76; }, /#76 is not one of this site's receipt pull requests/);
  refused(r => { r.gallery[1].pr = r.gallery[0].pr; }, /is listed twice/);
  refused(r => { r.gallery[0].receipt = ['Review row x was fine.']; }, /not a FIX-NEEDED receipt/);
  refused(r => { r.gallery[0].receipt = ['FIX-NEEDED on deadbeef1234, a passage nobody wrote']; }, /not the passage chosen for #84/);
  refused(r => { r.planOnly = [56, 54, 53]; r.gallery.push({ ...r.gallery[0], pr: 50 }); }, /planOnly: not 56, 54, 53, 50/);
  refused(r => { r.planOnly.pop(); }, /every receipt pull request is in the gallery or listed/);
  refused(r => { r.frontier.seats[0].costUsd = 1.7; }, /does not match odin-lab-review v1/);
  refused(r => { r.frontier.seats[0].model = 'minimax/minimax-m3.1-flash'; }, /does not match odin-lab-review v1/);
  refused(r => { r.gallery[0].title = 'served on localhost'; }, /local or IP address|local host/);
  refused(r => { r.gallery[0].receipt.push('it cost €40'); }, /price or currency amount/);
  refused(() => {}, /experiments\/self-verify\/results\.json: missing/, { read: file => { if (file.includes('self-verify')) throw new Error('gone'); return readFileSync(file); } });
});

test('the record is pinned: a changed byte refuses the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-review-'));
  try {
    for (const file of [REVIEW_RECORD, REVIEW_PIN, REVIEW_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); cpSync(join('site', file), join(root, file)); }
    assert.equal(renderReview(root).pages[REVIEW_TEMPLATE], page);
    writeFileSync(join(root, REVIEW_RECORD), raw.replace('"version": 1', '"version": 1 '));
    assert.throws(() => readReview(root), /record\.sha256: does not pin the sha256/);
    assert.equal(readFileSync(join('site', REVIEW_PIN), 'utf8'), `${sha256(raw)}  record.json\n`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The leak screen, a discriminating negative per class it guards.
test('leak screen: the page, the record and the tile, and a planted value of each class is caught', () => {
  // The "Re-run this" block's own commands and outputs are masked (scripts/lab-rerun.mjs), and nothing else is.
  assert.deepEqual(pageLeaks(maskKit(page, 'review', record), [...recordHashes(record), ...receiptTokens(record)]), []);
  const tile = readFileSync('site/data/labs/review-tile.json', 'utf8');
  for (const [name, text] of [['page', main], ['record', raw], ['tile', tile]]) {
    for (const re of [/\/Users\//, /\/home\//, /localhost/i, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /\bghp_|\bsk-[A-Za-z0-9]|-----BEGIN/, /odin-labs-ai\/(?!odin-rnd)/]) assert.doesNotMatch(text, re, `${name}: ${re}`);
    assert.ok(!namesRestricted(text), `${name}: a restricted name`);
  }
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  for (const [plant, reason] of [['/Users/someone/x', /machine path/], ['10.0.0.12:6488', /local host/], [`a ${SYN_THEME} lender`, /restricted name/], [`the ${SYN_REPO} repository`, /restricted name/], ['odin-labs-ai/some-private-repo', /another repository/], [credential, /credential/], ['about $12.00 a review', /price or currency/], ['commit 7d5527390abc', /a hash the record does not hold/]]) {
    const planted = maskKit(page, 'review', record).replace('<main id="main">', `<main id="main"><p>${plant}</p>`);
    assert.ok(pageLeaks(planted, [...recordHashes(record), ...receiptTokens(record)]).some(p => reason.test(p)), plant);
  }
});
