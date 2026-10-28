import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consensus, RED_PIN, RED_RECORD, RED_TEMPLATE, readRedBuild, recount, redBuildProblems, renderRedBuild } from './lab-red-build.mjs';
import { anonymous } from './vendor-red-build.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { renderLabs } from './labs.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';
import { namesRestricted } from './lab-dispatch-publish.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

// Lab 08, "Can an agent fix a red build?" (scripts/lab-red-build.mjs). An honest negative is only worth publishing if
// it is a true count: the committed verdicts must give the committed score, every number must name its set, every
// verdict must read as an AI reviewer's, and nothing may name a private repository, run or check.
const raw = readFileSync(join('site', RED_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[RED_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');
const tile = readFileSync('site/data/labs/red-build-tile.json', 'utf8');
const boxOf = cls => { const at = main.indexOf(`<div class="lab-panel ${cls}"`); assert.ok(at >= 0, cls); return main.slice(at, main.indexOf('</p></div>', at) + 10); };

test('Lab 08 renders, sits on the Labs index after Lab 05 and is in the sitemap', () => {
  assert.ok(page, 'labs/red-build/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab05 = index.indexOf('aria-labelledby="lab-tile-rogue"'), lab08 = index.indexOf('aria-labelledby="lab-tile-red-build"');
  assert.ok(lab05 >= 0 && lab08 > lab05, 'Lab 08 follows Lab 05');
  assert.match(index, /<span class="technical">LAB 08<\/span><h2 id="lab-tile-red-build">Can an agent fix a red build\?<\/h2>/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/red-build/</loc>'));
});

test('the recount: the committed verdicts give the committed score, and the headline is judged real fixes 0 of 9', () => {
  assert.deepEqual(recount(record), []);
  const s = record.heldOut.score;
  assert.deepEqual([s.cases, s.judgedFix, s.ruled, s.reproduced, s.missed], [9, 0, 5, 1, 3]);
  assert.deepEqual(s.diagnosis, { right: 11, partly: 3, wrong: 4 });
  assert.deepEqual(s.patch, { fixes: 0, partial: 0, wrong: 0, 'none-right': 14, 'none-missed': 4 });
  // Counted again here, from the rows alone, without the module's helper.
  const flat = k => record.heldOut.runs.flatMap(r => r.reviewers[k]);
  assert.deepEqual(['right', 'partly', 'wrong'].map(v => flat('diagnosis').filter(x => x === v).length), [11, 3, 4]);
  assert.equal(record.heldOut.runs.filter(r => r.judgedFix).length, 0);
  // Each round's own file, on its own, adds up to the score with the other.
  const { a, b } = record.heldOut.rounds;
  assert.deepEqual(['right', 'partly', 'wrong'].map(k => a.diagnosis[k] + b.diagnosis[k]), [11, 3, 4]);
  assert.match(textOf(page.match(/<p class="company-lead">[\s\S]*?<\/p>/)[0]), /Judged real fixes: 0 of 9\./);
  // The earlier set is another set: 17 right, 10 partly, 0 wrong of 27, with its one judged fix.
  const e = record.earlier;
  assert.deepEqual([e.judgments, e.builds, e.runsOfTheDoctor, e.diagnosis.right, e.diagnosis.partly, e.diagnosis.wrong, e.patch.fixes], [27, 9, 3, 17, 10, 0, 1]);
});

test('the class rule is the scorer\'s: code_bug wins a split, else the commoner, ties to the earlier class', () => {
  assert.equal(consensus(['code_bug', 'flake']), 'code_bug');
  assert.equal(consensus(['flake', 'code_bug']), 'code_bug');
  assert.equal(consensus(['config_env', 'red_by_design']), 'config_env');
  assert.equal(consensus(['red_by_design', 'red_by_design']), 'red_by_design');
  assert.equal(consensus([null, 'flake']), 'flake');
  assert.equal(consensus([]), null);
  for (const r of record.heldOut.runs) assert.equal(r.cls, consensus(r.reviewers.causeClass), r.label);
  assert.match(textOf(main), /the rule's 5 closures were all judged right, and the doctor fixed nothing\./);
  assert.doesNotMatch(textOf(main), /every build that should be left alone/);
});

test('every number names the set it counts, and the two sets are never mixed', () => {
  const box = boxOf('red-numbers');
  const rows = [...box.matchAll(/<tr><th scope="row">([^<]*)<\/th><td><strong>([^<]*)<\/strong><\/td><td><span class="lab-set">([^<]*)<\/span><\/td><\/tr>/g)];
  assert.equal(rows.length, 12);
  for (const [, what, value, set] of rows) {
    if (/of 9$|of 18 verdicts$/.test(value)) assert.equal(set, 'the held-out nine, both reviewer rounds', `${what} ${value}`);
    else if (/of 27 judgments$/.test(value)) assert.equal(set, 'the earlier set, three runs of the doctor', `${what} ${value}`);
    else assert.fail(`${what}: ${value} names no set size`);
  }
  assert.ok(rows.some(([, , v, s]) => v === '17 of 27 judgments' && /earlier/.test(s)), 'the 17 is the earlier set\'s');
  assert.ok(!rows.some(([, , v, s]) => /^17 /.test(v) && /held-out/.test(s)), 'and never the held-out set\'s');
  // Outside the numbers box, no figure of either set's diagnosis tally appears.
  assert.doesNotMatch(textOf(main.replace(box, '')), /\b(?:17|11) (?:of|right)\b|10 partly/);
});

test('every verdict is boxed as a separate AI reviewer\'s, not a human\'s, and the recount is boxed as a summary', () => {
  for (const cls of ['red-numbers', 'red-runs']) assert.match(main, new RegExp(`<div class="lab-panel ${cls}" id="[a-z-]+"><p class="technical">A SEPARATE AI REVIEWER, NOT A HUMAN</p>`), cls);
  const runs = main.slice(main.indexOf('<div class="lab-panel red-runs"'), main.indexOf('</table>', main.indexOf('<div class="lab-panel red-runs"')));
  assert.equal((runs.match(/<tr><th scope="row">/g) ?? []).length, record.heldOut.runs.length);
  for (const r of record.heldOut.runs) assert.ok(runs.includes(`<code>${r.label}</code>`), r.label);
  assert.doesNotMatch(textOf(main.replace(runs, '')), /right, both|no patch, rightly/, 'the verdict words only in the reviewer box');
  assert.match(boxOf('red-recount'), /<p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE<\/p><h3>A recount, not a re-score<\/h3>/);
  assert.match(textOf(main), /stayed on the machine that ran it, by design/);
  assert.match(textOf(main), /The reviewers are AI, not people\./);
});

test('the private commits are cited the way Lab 01 cites them', () => {
  const mc = record.vendored.mainCheck;
  for (const c of [record.vendored, ...record.vendored.cites]) assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  for (const f of record.vendored.files) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
});

test('anonymous labels: keyed, letters only, never a hash shape, and refused without the salt', () => {
  const salt = 'x'.repeat(40);
  assert.match(anonymous('run', 'some/repo\u00001', salt), /^run-[g-z]{8}$/);
  assert.equal(anonymous('run', 'a', salt), anonymous('run', 'a', salt));
  assert.notEqual(anonymous('run', 'a', salt), anonymous('run', 'a', `${salt}y`), 'another salt, another label');
  assert.notEqual(anonymous('run', 'a', salt).slice(4), anonymous('repo', 'a', salt).slice(5), 'kind is keyed in');
  assert.throws(() => anonymous('run', 'a', ''), /needs the private salt/);
  assert.throws(() => anonymous('run', 'a', 'short'), /needs the private salt/);
  for (const r of record.heldOut.runs) for (const l of [r.label, r.repo]) assert.doesNotMatch(l, /[0-9a-f]{8}/);
});

const LEAK_SHAPES = [/\/Users\//, /\/home\//, /\b[A-Z]:\\/, /~\/\./, /localhost/i, /\b127\.0\.0\.1\b/, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /:\d{4,5}\b(?!["\d])/,
  /\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]|\bAKIA[0-9A-Z]|-----BEGIN|\bxox[abp]-/, /odin-labs-ai\/(?!odin-rnd)/, /\d{9,}/, /usd|\bcost\b|spend/i, /gh-readonly-queue|\bgrant\//];

test('leak screen: no run id, repository, branch, money figure, path, host or credential anywhere it ships', () => {
  // The record's own commits and sha256s are masked first (they are hex, and may hold a long run of digits).
  const known = new Set(recordHashes(record));
  const masked = text => text.replace(/\b[0-9a-f]{40,64}\b/g, h => (known.has(h) ? 'HASH' : h));
  for (const [name, text] of [['page', main], ['record', raw], ['tile', tile]]) { for (const re of LEAK_SHAPES) assert.doesNotMatch(masked(text), re, `${name}: ${re}`); assert.ok(!namesRestricted(text), `${name}: a restricted name`); }
  assert.deepEqual(pageLeaks(page, recordHashes(record)), [], 'the rendered page passes the screen');
  assert.deepEqual(redBuildProblems(record), [], 'the record passes its checks and the screen');
  for (const file of ['scripts/lab-red-build.mjs', 'scripts/vendor-red-build.mjs', 'scripts/schemas/odin-lab-red-build.schema.json', 'site/labs/red-build/index.html']) {
    assert.deepEqual(screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name')), [], file);
  }
});

test('a planted leak fails the build, in the record and on the page (a failing negative per class)', () => {
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  const plants = [['run 40000000001', /long internal id/], ['odin-labs-ai/some-private-repo', /another repository/], [`the ${SYN_REPO} repository`, /restricted name/], [`a ${SYN_THEME} lender`, /restricted name/], ['it cost USD 0.29', /price or currency/], ['/Users/someone/x', /machine path|file path/], ['served on localhost', /local/], [credential, /credential/], ['see doctrine-path-guard.sh', /file path or file name/]];
  for (const [plant, reason] of plants) {
    const r = clone(); r.heldOut.runs[0].how = plant;
    assert.ok(redBuildProblems(r).some(p => reason.test(p)), `record: ${plant}`);
    assert.ok(pageLeaks(page.replace('</main>', `<p>${plant}</p></main>`), recordHashes(record)).some(p => reason.test(p)), `page: ${plant}`);
  }
  const r = clone(); r.heldOut.runs[0].label = 'run-40221108989';
  assert.ok(redBuildProblems(r).some(p => /does not match odin-lab-red-build v1/.test(p)), 'a run id as a label');
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(redBuildProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.heldOut.runs[0].reviewers.diagnosis = ['wrong', 'wrong']; }, /diagnosis: the verdicts give/);
  refused(r => { r.heldOut.score.diagnosis.right = 17; }, /diagnosis: the verdicts give/);
  refused(r => { r.heldOut.rounds.a.diagnosis.right += 1; }, /the two rounds' diagnoses/);
  refused(r => { r.heldOut.score.judgedFix = 1; r.heldOut.runs[0].judgedFix = true; }, /the page says no fix was judged real/);
  refused(r => { r.heldOut.score.ruled = 4; }, /ruled: the verdicts give/);
  refused(r => { r.heldOut.runs[3].reviewers.patch = ['none-right', 'none-right']; }, /patch: the verdicts give/);
  refused(r => { r.heldOut.runs[1].label = r.heldOut.runs[0].label; }, /two runs share a label/);
  refused(r => { r.heldOut.repos = 2; }, /not the number of repository labels/);
  refused(r => { r.earlier.byRun[0].diagnosis.right += 1; }, /the earlier set's diagnoses/);
  refused(r => { r.earlier.builds = 10; }, /one per build per run of the doctor/);
  refused(r => { r.heldOut.runs.find(x => x.how === 'no patch by rule').reviewers.patch = ['none-missed', 'none-right']; }, /no patch" was right on every run the rule closed/);
  refused(r => { for (const x of r.heldOut.runs) if (x.cls === 'code_bug') x.reproduced = false; r.heldOut.score.reproduced = 0; }, /one code bug failed again here/);
  refused(r => { r.heldOut.frozen = '2026-10-25T12:00:00Z'; }, /not frozen after its window closed/);
  // Review 1: opposing errors in the two rounds no longer cancel out; each round is its own reviewer's verdicts.
  refused(r => { r.heldOut.rounds.a.diagnosis = { right: 5, partly: 2, wrong: 2 }; r.heldOut.rounds.b.diagnosis = { right: 6, partly: 1, wrong: 2 }; }, /round a diagnoses/);
  // Review 1: a run's class is the reviewers' by the scorer's rule, so a table and its totals cannot disagree.
  refused(r => { r.heldOut.runs.find(x => x.cls === 'red_by_design').reviewers.causeClass = ['code_bug', 'code_bug']; }, /class: the verdicts give/);
  refused(r => { r.heldOut.runs.find(x => x.split).split = false; }, /split: the verdicts give/);
  // Review 1: exactly one verdict per round on every run, so no hidden third vote can be counted.
  refused(r => { r.heldOut.runs[0].reviewers.diagnosis.push('right'); r.heldOut.score.diagnosis.right += 1; r.heldOut.rounds.a.diagnosis.right += 1; }, /3 verdicts, not one per round/);
  refused(r => { r.vendored.cites[0].commit = 'e'.repeat(40); }, /not shown as part of the private main/);
  refused(r => { r.vendored.cites[0].at = '2099-01-01T00:00:00Z'; }, /after this build/);
  refused(r => { r.heldOut.runs[0].modelUsd = 0.1; }, /does not match odin-lab-red-build v1/);
  refused(r => { r.heldOut.runs[0].workflow = 'CI'; }, /does not match odin-lab-red-build v1/);
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-red-build-'));
  try {
    for (const file of [RED_RECORD, RED_PIN, RED_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readRedBuild(root).heldOut.score.cases, 9);
    assert.equal(renderRedBuild(root).pages[RED_TEMPLATE], page, 'a fixture with the same files renders the same page');
    writeFileSync(join(root, RED_RECORD), raw.replace('"cases": 9', '"cases": 9 '));
    assert.throws(() => readRedBuild(root), /record\.sha256: does not pin the sha256/);
    assert.equal(readFileSync(join('site', RED_PIN), 'utf8'), `${sha256(raw)}  record.json\n`, 'the committed pin is the committed record\'s');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
