import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAN_ONLY, RECEIPTS, RECEIPT_PRS, REVIEW_PIN, REVIEW_RECORD, REVIEW_TEMPLATE, SOURCES, readReview, receiptTokens, renderAbout, renderReview, renderSelfVerify, reviewProblems } from './lab-review.mjs';
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
    // The copy renders exactly as the site's own record does (the Labs build then adds the runs section, if any).
    assert.equal(renderReview(root).pages[REVIEW_TEMPLATE], renderReview('site').pages[REVIEW_TEMPLATE]);
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

// What a reader of "What it is." takes away, recomputed here from the record: every count with its unit, every verdict
// sentence, and the tone of each outcome box. The expected words are written out per case below, not copied from the renderer.
const aboutOf = html => html.match(/<section[^>]*id="about"[\s\S]*?<\/section>/)?.[0];
const spreadOf = xs => Math.max(...xs) - Math.min(...xs);
const rangeOf = xs => (Math.min(...xs) === Math.max(...xs) ? `${Math.min(...xs)}` : `${Math.min(...xs)} to ${Math.max(...xs)}`);
const timesOf = k => ({ 1: 'once', 2: 'twice' })[k] ?? `${k} times`;
/** The sentences a reader should find for this record, and the opposite ones that must be absent. */
function expectedAbout(r) {
  const f = r.frontier, s0 = f.seats[0], n = r.nina, v = r.selfVerify;
  const defects = s0.caughtOf / s0.runs, clean = s0.falseAlarmsOf / s0.runs, twice = timesOf(s0.runs);
  const caught = f.seats.map(x => x.caught), flagged = f.seats.map(x => x.falseAlarms);
  const runGap = Math.max(...f.seats.map(x => Math.max(...x.caughtPerRun) - Math.min(...x.caughtPerRun)));
  const apart = `the models were up to ${spreadOf(caught)} catches apart, and a single model's own runs were up to ${runGap} apart`;
  const ahead = { yes: `on catches, no model was clearly ahead: ${apart}.`, no: `on catches, the models differed by more than one model's own runs did: ${apart}.` };
  const further = { yes: `On false alarms, the models were further apart, up to ${spreadOf(flagged)}:`, no: `On false alarms, the models were no further apart than on catches, up to ${spreadOf(flagged)}:` };
  const bar = { PASS: 'The tool reviewer met the bar set for it beforehand.', FAIL: 'The tool reviewer did not meet the bar set for it beforehand.' };
  const self = { yes: 'Checking its own findings did get that reviewer out of its false alarms.', no: 'Checking its own findings did not get that reviewer out of its false alarms.' };
  const pick = (table, key) => [table[key] ?? null, Object.entries(table).filter(([k]) => k !== key).map(([, s]) => s)];
  const [aheadS, aheadNot] = pick(ahead, spreadOf(caught) <= runGap ? 'yes' : 'no');
  const [furtherS, furtherNot] = pick(further, spreadOf(flagged) > spreadOf(caught) ? 'yes' : 'no');
  const [barS, barNot] = pick(bar, n.verdict);
  // "met the bar" stands alone only on a recorded read-check PASS; any other read result is said right after it
  const read = { PASS: null, FAIL: 'The check that it actually read the changes failed.' };
  const readS = n.manipulation in read ? read[n.manipulation] : `The check that it actually read the changes is recorded as "${n.manipulation}".`;
  const [selfS, selfNot] = pick(self, v.decision);
  return {
    present: [
      'It is made of three experiments.',
      `we gave ${f.seats.length} models the same ${defects + clean} cases to review, ${defects} with a known defect and ${clean} clean, and each model reviewed every case ${twice}.`,
      `a reviewer that runs as a tool checked ${n.selfAgreement.n} other changes we wrote to keep or break a set of rules, not the known defects.`,
      'In the third, one model reviewed and then checked its own findings.',
      'every case in these experiments was chosen or written by us.',
      aheadS,
      `Each caught ${rangeOf(caught)} of ${s0.caughtOf} tries (${defects} known defects, each reviewed ${twice}).`,
      furtherS,
      `each flagged ${rangeOf(flagged)} of ${s0.falseAlarmsOf} tries (${clean} clean cases, each reviewed ${twice}).`,
      (barS ?? `The tool reviewer's result against the bar set for it beforehand is recorded as "${n.verdict}".`) + (readS ? ` ${readS}` : ''),
      selfS ?? `Whether checking its own findings got that reviewer out of its false alarms is recorded as "${v.decision}".`,
      `${r.gallery.length} of this site's own pull requests record a FIX-NEEDED from the AI reviewer in their description; those receipts are further down.`,
      // the diagram, one lane per experiment, each starting from its own input
      `${f.experiment}: ${f.seats.length} models, each reviews every case ${twice} ${defects + clean} cases to review, chosen by us ${defects} with a known defect, ${clean} clean; reviewed by ${f.seats.map(x => x.name).join(', ')}`,
      `Defects caught, per model ${rangeOf(caught)} of ${s0.caughtOf} tries (${defects} known defects, each reviewed ${twice})`,
      `Clean cases flagged, per model ${rangeOf(flagged)} of ${s0.falseAlarmsOf} tries (${clean} clean cases, each reviewed ${twice})`,
      `on the frontier: ${f.onFrontier.map(id => f.seats.find(x => x.seat === id).name).join(', ')}`,
      `${n.experiment}: a reviewer that runs as a tool, ${n.countedRuns / n.selfAgreement.n} runs per change ${n.selfAgreement.n} other changes we wrote each written to keep or break a set of rules; not the known defects`,
      `${n.countedRuns} runs blind runs: ${n.blindRuns}, each scored as an error`,
      `rule-breaking changes accepted: ${n.missedDrift.x} of ${n.missedDrift.n} runs; good changes rejected: ${n.falseReject.x} of ${n.falseReject.n} runs`,
      `${v.experiment}: review, then check its own findings (summary only) One model reviews, then checks its own findings summary only`,
    ],
    // never the read result when it is a recorded PASS; never "planted" (the corpus's seededDefinition, in
    // experiments/self-verify/preregistration.json, takes 18 of the 30 defects from past reviews);
    // never "separate" or "own changes" (EXP 017's preregistration says its corpus is EXP 012's, a fact this record does not hold, so neither is said)
    absent: [...aheadNot, ...furtherNot, ...barNot, ...selfNot, ...(readS ? [] : Object.values(read).filter(Boolean)), 'planted', 'separate experiments', 'own changes', '60 changes',
      // never that every change here is AI-reviewed (#79 merged by hand, PR #80 says so), never that the reviewer "first"
      // said FIX-NEEDED on each receipt PR (#80's receipt counts rounds on #71 to #79, not on #80 itself)
      'On this site, that someone is', 'every change', 'first said FIX-NEEDED', 'first answered FIX-NEEDED'],
    caption: 'How it works: three experiments',
    // tone of each outcome box: good only for a recorded PASS+PASS / yes, bad for a recorded FAIL / no, else neutral
    barTone: n.verdict === 'PASS' && n.manipulation === 'PASS' ? 'good' : [n.verdict, n.manipulation].includes('FAIL') ? 'bad' : 'neutral',
    barTitle: ({ PASS: 'The registered bar: met', FAIL: 'The registered bar: not met' })[n.verdict] ?? `The registered bar: ${n.verdict}`,
    selfTone: ({ yes: 'good', no: 'bad' })[v.decision] ?? 'neutral',
    selfTitle: ({ yes: 'Dropped its false alarms: yes', no: 'Dropped its false alarms: no' })[v.decision] ?? `Dropped its false alarms: ${v.decision}`,
  };
}
function assertAbout(about, r, label) {
  const text = textOf(about), want = expectedAbout(r);
  for (const s of want.present) assert.ok(text.includes(s), `${label}: missing "${s}"`);
  for (const s of want.absent) assert.ok(!text.includes(s), `${label}: says "${s}", which the record does not support`);
  assert.ok(about.includes(`lab-flow-${want.barTone}"><strong>${want.barTitle}</strong>`), `${label}: the bar box is "${want.barTitle}" in the ${want.barTone} tone`);
  assert.ok(about.includes(`lab-flow-${want.selfTone}"><strong>${want.selfTitle}</strong>`), `${label}: the self-check box is "${want.selfTitle}" in the ${want.selfTone} tone`);
  assert.doesNotMatch(about, /lab-flow-source/, `${label}: no input row shared by all three experiments`);
  assert.equal(about.match(/<figcaption[^>]*>([^<]*)<\/figcaption>/)?.[1], want.caption, `${label}: the caption names the experiments and claims nothing about what they share`);
  for (const x of r.selfVerify.runs) for (const k of [x.caught, x.falseAlarms]) assert.ok(!text.includes(`${k} of ${x.of}`), `${label}: ${x.id}: EXP 012's counts stay in its summary box`);
  assert.match(text, /an AI, not a person/);
  assert.doesNotMatch(text, /[$€£]|\bprice\b|\bdollars?\b|\beuros?\b|\bhuman review/i, `${label}: no money figure, and never a human reviewer`);
}

test('"What it is." opens the page as on Lab 01: plain words, then how it works, every count and verdict the record\'s, the reviewers AI', () => {
  const about = aboutOf(main);
  assert.ok(about, 'the page has a What it is section');
  assert.ok(main.indexOf('</section>') < main.indexOf('id="about"') && main.indexOf('id="about"') < main.indexOf('id="frontier"'), 'right after the hero, before the frontier');
  assert.match(about, /<figure class="lab-flow">/);
  assertAbout(about, record, 'committed record');
});

// The rest of the page uses the same words as "What it is.": EXP 017 counts cases (58 changes give 60 cases), its defects
// are known, never "planted", and the boundary does not call them hand-made. Counts recomputed from the record.
test('outside "What it is." too: EXP 017 counts cases, its defects are known, never planted', () => {
  const s0 = record.frontier.seats[0], defects = s0.caughtOf / s0.runs, clean = s0.falseAlarmsOf / s0.runs, cases = defects + clean;
  const section = id => textOf(main.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))?.[0] ?? '');
  const hero = textOf(main.match(/<section[^>]*lab-hero[\s\S]*?<\/section>/)[0]);
  assert.ok(hero.includes(`We gave four models the same ${cases} cases to review, twice each,`), 'the intro counts cases');
  // #79 merged by hand (PR #80 says so): the hero never says an AI reviewer checks every change, only shows where one said no
  for (const s of ['each change before it merges', 'every change', 'checks each change', 'each change']) assert.ok(!hero.includes(s), `the intro says "${s}", which #79 (merged by hand) contradicts`);
  assert.ok(hero.includes('And below are pull requests on this site where an AI reviewer said no.'), 'the intro only points to the receipts');
  assert.ok(page.includes(`content="Four models review the same ${cases} cases twice:`), 'the description counts cases');
  const frontier = section('frontier');
  for (const s of [`Four models, the same ${cases} cases.`, `how many of ${defects} known defects does a review catch, and how many of ${clean} clean cases does it flag anyway? Each model reviewed all ${cases} cases twice`, `${defects} with a known defect, ${clean} clean.`, `Clean cases flagged, of ${s0.falseAlarmsOf} (each run)`]) assert.ok(frontier.includes(s), `frontier: missing "${s}"`);
  assert.ok(section('nina').includes('not the known defects above;'), 'nina: the known defects above');
  assert.ok(section('boundary').includes('We chose the cases with known defects and wrote the rule-checking changes ourselves. Neither is a random sample of the bugs a team meets.'), 'boundary: chosen, not a random sample');
  assert.doesNotMatch(textOf(main), /planted|real bugs/i, 'never "planted", never "not a sample of real bugs"');
  for (const id of ['about', 'frontier', 'self-verify', 'boundary']) assert.doesNotMatch(section(id), new RegExp(`\\b${cases} changes\\b`), `${id}: EXP 017's ${cases} are cases, not changes`);
});

test('"What it is." follows the record on every branch, and an unknown outcome fails closed to the neutral tone', () => {
  const cases = [
    ['self-check worked', r => { r.selfVerify.decision = 'yes'; }],
    ['self-check undecided', r => { r.selfVerify.decision = 'inconclusive'; }],
    ['self-check mixed', r => { r.selfVerify.decision = 'mixed'; }],
    ['tool reviewer failed its bar', r => { r.nina.verdict = 'FAIL'; }],
    ['tool reviewer blind', r => { r.nina.manipulation = 'FAIL'; }],
    ['tool reviewer read check unknown', r => { r.nina.manipulation = 'NOT RUN'; }],
    ['tool reviewer failed its bar and was blind', r => { r.nina.verdict = 'FAIL'; r.nina.manipulation = 'FAIL'; }],
    ['one model clearly ahead on catches', r => { r.frontier.seats[0].caught = 45; }],
    ['false alarms no wider than catches', r => { for (const x of r.frontier.seats) x.falseAlarms = 30 + (x.caught % 3); }],
  ];
  for (const [label, plant] of cases) {
    const r = clone();
    plant(r);
    assertAbout(`<section id="about">${renderAbout(r)}</section>`, r, label);
  }
  const lead = { yes: 'It worked: ', no: 'It did not work: ' };
  for (const decision of ['yes', 'no', 'inconclusive']) {
    const r = clone();
    r.selfVerify.decision = decision;
    const text = textOf(renderSelfVerify(r));
    for (const [k, s] of Object.entries(lead)) assert.equal(text.includes(s), k === decision, `EXP 012 box, decision ${decision}: "${s}"`);
    assert.ok(text.includes(`the decision registered beforehand was ${decision} .`), `EXP 012 box shows the decision word ${decision}`);
  }
  const r = clone();
  r.frontier.seats[1].caughtOf = 58;
  assert.throws(() => renderAbout(r), /caughtOf 58/, 'models counted on different totals cannot share one sentence');
});
