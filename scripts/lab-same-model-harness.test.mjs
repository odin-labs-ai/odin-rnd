import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armsPaired, callsFromRows, cellCounts, logPathOf, EXPERIMENT, fixtureOf, renderAbout, SMH_RECORD, SMH_TEMPLATE, sameModelHarnessProblems, totals, verdictSentence, wilson } from './lab-same-model-harness.mjs';
import { harnessRefusals, scoreReply } from '../experiments/same-model-harness/score.mjs';
import { fixtureManifest, runSuite } from '../experiments/same-model-harness/run.mjs';
import { namesRestricted, screenHits } from './lab-dispatch-publish.mjs';
import { renderLabs } from './labs.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_THEME } from './test-synthetic-names.mjs';

// Lab 11, "Same model, with and without a harness" (scripts/lab-same-model-harness.mjs). The page is worth publishing
// only if the fixture is neutral (no client or talk-theme word), every number is counted from the run log by the shared
// scorer, the record is bound to the files it was measured with, and the harness's own check is never shown as a model
// result. These tests hold it to that.
const raw = readFileSync(join('site', SMH_RECORD), 'utf8');
const record = JSON.parse(raw);
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');
const repoRoot = process.cwd();
const truth = { files: fixtureOf(join(EXPERIMENT, 'fixture')).files, suite: 'FAIL' };

/** Every text file the experiment ships: the fixture, the questions, the harness's text, the diff, runner and scorer. */
function experimentTexts(dir = EXPERIMENT) {
  const out = [];
  (function walk(d) { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else out.push([p, readFileSync(p, 'utf8')]); } })(dir);
  return out;
}
const bannedIn = text => namesRestricted(text, { anyWindow: true }) || screenHits(text).some(h => /^a (restricted|place) name/.test(h.reason));

test('the fixture and every file of the experiment carry no client, talk-theme or place name', () => {
  const files = experimentTexts();
  assert.ok(files.length >= 15, `the experiment's files are read (${files.length})`);
  for (const [path, text] of files) assert.ok(!bannedIn(text), `${path}: a restricted or place name`);
});

test('the banned-term test fails on a planted client-theme word (a discriminating negative)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab11-ban-'));
  try {
    cpSync(EXPERIMENT, dir, { recursive: true });
    const target = join(dir, 'fixture', 'README.md');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\nA ${SYN_THEME} quote planner.\n`);
    assert.ok(experimentTexts(dir).some(([, text]) => bannedIn(text)), 'the planted word is caught');
    cpSync(EXPERIMENT, dir, { recursive: true });
    assert.ok(!experimentTexts(dir).some(([, text]) => bannedIn(text)), 'a clean copy passes');
    const log = join(dir, 'runs', record.logDay, 'rows.jsonl');
    writeFileSync(log, readFileSync(log, 'utf8').replace('"kind":"call"', `"kind":"call","note":"${SYN_THEME}"`));
    assert.ok(experimentTexts(dir).some(([, text]) => bannedIn(text)), 'a word planted in a reply of the run log is caught');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The exact bytes of a Python traceback differ between Python versions (newer ones mark the failing expression), so
// the output's sha256 in the record is the measuring machine's; here the suite must fail the same way: the same tests
// run, the same two fail, nothing errors.
test("the fixture's suite fails after the change, the same two tests and nothing else", { skip: spawnSync('python3', ['--version']).status !== 0 && 'no python3' }, () => {
  const suite = runSuite();
  assert.equal(suite.suite, 'FAIL');
  assert.match(suite.output, /^Ran 6 tests$/m);
  assert.match(suite.output, /^FAILED \(failures=2\)$/m);
  assert.deepEqual([...suite.output.matchAll(/^(FAIL|ERROR): (\w+)/gm)].map(m => `${m[1]} ${m[2]}`).sort(), ['FAIL test_departure_is_not_a_stop', 'FAIL test_single_leg']);
  assert.ok(!suite.output.includes(process.cwd()) && !suite.output.includes(tmpdir()), 'no machine path in what the harness shows');
  assert.equal(fixtureManifest(), record.bound.fixture, "the runner's manifest is the build's");
});

test('the scorer: invented paths, wrong PASS, UNKNOWN and unreadable replies', () => {
  assert.deepEqual(scoreReply('{"files": ["planner/cost.py"], "tests": "UNKNOWN"}', truth), { readable: true, named: 1, invented: 0, verdict: 'UNKNOWN', wrongPass: false });
  assert.deepEqual(scoreReply('{"files": ["./planner/cost.py", "test_planner/cost_test.py"], "tests": "PASS"}', truth), { readable: true, named: 2, invented: 1, verdict: 'PASS', wrongPass: true });
  assert.equal(scoreReply('```json\n{"files": [], "tests": "fail"}\n```', truth).verdict, 'FAIL');
  assert.equal(scoreReply('no json here', truth).readable, false);
  assert.equal(scoreReply('{"files": "planner/cost.py", "tests": "PASS"}', truth).readable, false);
  assert.equal(scoreReply('{"files": [], "tests": "MAYBE"}', truth).readable, false);
  assert.deepEqual(harnessRefusals(scoreReply('{"files": ["planner/cost.py"], "tests": "FAIL"}', truth), truth), []);
  assert.equal(harnessRefusals(scoreReply('{"files": ["planner/nope.py"], "tests": "FAIL"}', truth), truth).length, 1);
  assert.equal(harnessRefusals(scoreReply('{"files": [], "tests": "UNKNOWN"}', truth), truth).length, 1);
  for (const empty of ['fixture/', './', '']) {
    const s = scoreReply(JSON.stringify({ files: [empty], tests: 'FAIL' }), truth);
    assert.equal(s.invented, 1, `${JSON.stringify(empty)} names no file: invented`);
    assert.equal(harnessRefusals(s, truth).length, 1, `${JSON.stringify(empty)} is refused by the check`);
  }
});

test('Wilson intervals', () => {
  assert.deepEqual(wilson(0, 10), [0, 0.278]);
  assert.deepEqual(wilson(10, 10), [0.722, 1]);
  assert.deepEqual(wilson(5, 10), [0.237, 0.763]);
});

test('the committed record passes, bound to the files and the run log', () => {
  assert.deepEqual(sameModelHarnessProblems(record, { repoRoot }), []);
  const log = readFileSync(join(EXPERIMENT, logPathOf(record)), 'utf8');
  assert.equal(sha256(log), record.bound.log);
  assert.deepEqual(callsFromRows(log, truth.files).calls, record.calls);
});

test('the record is refused when a call is retyped, a run dropped, a file changed or the dates are wrong', () => {
  const refused = (mutate, re) => { const r = clone(); mutate(r); const p = sameModelHarnessProblems(r, { repoRoot }); assert.ok(p.some(x => re.test(x)), `${re}: ${p.join(' | ')}`); };
  const bareFirst = r => r.calls.findIndex(c => c.arm === 'bare' && c.attempt === 1);
  refused(r => { const c = r.calls[bareFirst(r)]; c.verdict = c.verdict === 'FAIL' ? 'UNKNOWN' : 'FAIL'; c.wrongPass = false; }, /not the calls the run log gives/);
  refused(r => { r.calls.splice(bareFirst(r), 1); }, /not exactly runs 1 to/);
  refused(r => { r.bound.runner = '0'.repeat(64); }, /bound\/runner/);
  refused(r => { r.bound.fixture = '0'.repeat(64); }, /bound\/fixture/);
  refused(r => { r.measured.ended = '2099-01-01T00:00:00Z'; }, /after this build/);
  refused(r => { r.measured.machine = 'a Bigbox laptop with 1 GiB of memory'; }, /machine and Ollama version/);
  refused(r => { r.calls[bareFirst(r)].wrongPass = !r.calls[bareFirst(r)].wrongPass; }, /wrongPass is not/);
  refused(r => { r.calls[0].note = 'a path'; }, /not allowed/);
  refused(r => { r.suite = 'PASS'; }, /suite fails/);
  refused(r => { r.calls.find(c => c.arm === 'harnessed' && c.attempt === 1).seed += 1; }, /share one seed/);
  refused(r => { r.calls.push({ ...r.calls.find(c => c.arm === 'bare') }); }, /more than once/);
});

test('Lab 11 renders, its numbers are counted from the calls, and the check is boxed apart', () => {
  const pages = renderLabs();
  const page = pages[SMH_TEMPLATE];
  assert.ok(page, 'the page is rendered');
  const index = pages['labs/index.html'];
  const lab09 = index.indexOf('aria-labelledby="lab-tile-talk-leak"'), lab11 = index.indexOf('aria-labelledby="lab-tile-same-model-harness"'), lab13 = index.indexOf('aria-labelledby="lab-tile-measured-blind"');
  assert.ok(lab09 >= 0 && lab11 > lab09 && lab13 > lab11, 'Lab 11 sits between Lab 09 and Lab 13');
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/same-model-harness/</loc>'));
  for (const variant of ['open', 'forced']) assert.ok(page.includes(verdictSentence(record, variant).replaceAll('&', '&amp;')), `the ${variant} sentence is on the page`);
  const refusedCell = (model, variant, arm) => record.refusedCells.some(x => x.model === model && x.variant === variant && x.arm === arm);
  for (const { model } of record.models.filter(({ model }) => !refusedCell(model, 'forced', 'bare'))) {
    const c = cellCounts(record.calls, model, 'forced', 'bare');
    assert.ok(page.includes(`${c.wrongPass} of ${c.n}`), `${model}: its count is shown`);
  }
  const t = totals(record, 'forced', 'bare');
  assert.equal(t.n, record.models.filter(({ model }) => !refusedCell(model, 'forced', 'bare')).length * record.runsPerCell);
  for (const c of record.refusedCells) assert.ok(page.includes(`<code>${c.model}</code></td><td>${c.arm === 'bare' ? 'Bare' : 'With a harness'}</td><td colspan="5">Not run`), 'a cell refused for load is shown as not run');
  assert.match(page, /AN AUTHORED FIXTURE, WRITTEN BY US/);
  assert.match(page, /by construction, not a result of the model/);
  const head = page.split('<main id="main">')[0];
  assert.doesNotMatch(head.replace(/ten runs a cell/, ''), /\d+ of \d+|fewer|more mistakes|wrong PASS rate/i, 'the meta descriptions state no outcome');
});

// What a reader takes away from "What it is.", recounted here straight from a record's calls (not through totals()):
// per form and arm, the first answers, the wrong PASSes, the answers naming a file that does not exist, and the first
// answers with no verdict (no reply came back, or it could not be scored), which make neither mistake.
function recount(rec) {
  const out = {};
  for (const variant of ['open', 'forced']) for (const arm of ['bare', 'harnessed']) {
    const first = rec.calls.filter(c => c.variant === variant && c.arm === arm && c.attempt === 1);
    out[`${variant} ${arm}`] = { n: first.length, wrongPass: first.filter(c => c.verdict === 'PASS').length, invented: first.filter(c => c.invented > 0).length, unreadable: first.filter(c => c.verdict === null).length };
  }
  return out;
}
const plain = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replace(/\s+/g, ' ');
/** The diagram's lanes, in order: label, lane tone, and each box as {title, body, tone}. */
function lanesOf(about) {
  return [...about.matchAll(/<div class="lab-flow-lane lab-flow-lane-(\w+)"><p class="lab-flow-label">([^<]*)<\/p><ol class="lab-flow-row">([\s\S]*?)<\/ol><\/div>/g)].map(m => ({
    tone: m[1], label: m[2],
    nodes: [...m[3].matchAll(/<li class="lab-flow-node lab-flow-(\w+)"><strong>([^<]*)<\/strong>(?:<span>([^<]*)<\/span>)?<\/li>/g)].map(n => ({ tone: n[1], title: n[2], body: (n[3] ?? '').replaceAll('&#39;', "'") })),
  }));
}
/** What the about section must say for a record, computed from its calls; the expected tones fail closed: good only
 * when every box had answers, none of them unreadable, and no mistake. */
function expectAbout(rec, about) {
  const r = recount(rec), errs = t => t.wrongPass + t.invented;
  const tone = ts => (ts.some(t => errs(t) > 0) ? 'bad' : ts.every(t => t.n > 0 && t.unreadable === 0) ? 'good' : 'neutral');
  const lanes = lanesOf(about);
  assert.deepEqual(lanes.map(l => l.label), ['Bare: the model alone', 'With a harness: the same model'], 'bare first, then with the harness');
  for (const [i, arm] of ['bare', 'harnessed'].entries()) {
    const l = lanes[i];
    assert.equal(l.nodes.length, 3, `${arm}: an input box and one box per form`);
    assert.equal(l.nodes[0].title, arm === 'bare' ? 'The question and the change' : 'The question, the change and the tool output');
    assert.equal(l.nodes[0].tone, 'neutral');
    for (const [j, variant] of ['open', 'forced'].entries()) {
      const t = r[`${variant} ${arm}`], box = l.nodes[j + 1];
      assert.equal(box.title, variant === 'open' ? 'May say UNKNOWN' : 'Must say PASS or FAIL', `${arm} box ${j + 1}`);
      assert.equal(box.body, t.n === 0 ? 'not run: the computer was too busy' : `${t.wrongPass} of ${t.n} first answers said the failing tests pass; ${t.invented} of ${t.n} named a file that does not exist${t.unreadable ? `; ${t.unreadable} of ${t.n} could not be read` : ''}`, `${variant} ${arm}`);
      assert.equal(box.tone, tone([t]), `${variant} ${arm}: its tone follows its counts`);
    }
    assert.equal(l.tone, tone(['open', 'forced'].map(v => r[`${v} ${arm}`])), `${arm}: the lane tone follows its counts`);
  }
  const text = plain(about);
  const models = rec.models.map(x => x.model).join(', ');
  const groups = rec.models.length * 4, skipped = rec.refusedCells.length, runs = rec.runsPerCell;
  if (skipped === 0) {
    assert.ok(text.includes(`each model got each form ${runs} times bare and ${runs} times with the harness`), 'how often each model was asked');
    assert.ok(text.includes(`${models}; each asked ${runs} times bare and ${runs} times with the harness, for each form of the question`), 'the models and how often, in the source box');
  } else {
    assert.ok(!text.includes('each model got each form'), 'never claims every group ran');
    assert.ok(text.includes(`${skipped} of these ${groups} groups of ${runs}`) && text.includes('were not run because the computer was too busy'), 'the groups not run are said');
    assert.ok(text.includes(`${models}; each to be asked ${runs} times bare and ${runs} times with the harness, for each form of the question; ${skipped} of ${groups} groups not run`));
  }
  const sum = (arm, f) => ['open', 'forced'].reduce((s, v) => s + f(r[`${v} ${arm}`]), 0);
  const be = sum('bare', errs), he = sum('harnessed', errs), bn = sum('bare', t => t.n), hn = sum('harnessed', t => t.n);
  const bu = sum('bare', t => t.unreadable), hu = sum('harnessed', t => t.unreadable);
  const notRun = (m, v, a) => rec.refusedCells.some(c => c.model === m && c.variant === v && c.arm === a);
  const paired = rec.refusedCells.every(c => notRun(c.model, c.variant, c.arm === 'bare' ? 'harnessed' : 'bare'));
  if (!(paired && bn > 0 && bn === hn && bu === hu)) {
    assert.ok(text.includes('the two sides are not compared here'), 'unequal sides are not compared');
    assert.doesNotMatch(text, /made (fewer|more|as many) of them|Neither way made/);
    if (paired && bn > 0 && bn === hn) assert.ok(text.includes(`could not be read (no reply came back, or it could not be scored): ${bu} of ${bn} without the harness and ${hu} of ${hn} with it`), 'the unreadable answers are counted on both sides');
  } else if (be + he === 0 && bu === 0) assert.ok(text.includes('Neither way made either mistake'));
  else {
    const side = he < be ? 'fewer' : he > be ? 'more' : 'as many';
    assert.ok(text.includes(`With the harness, the same models made ${side} of them in their first answers: ${he} mistakes with the harness against ${be} without it, over ${hn} first answers each way.`), `the comparison says ${side}`);
    if (bu) assert.ok(text.includes(`On each side, ${bu} of the ${hn} first answers could not be read`));
  }
}

test('"What it is." opens the page as on Lab 01: plain words, then how it works, first answers only, the check kept apart', () => {
  const html = renderLabs()[SMH_TEMPLATE];
  const body = html.split('<main id="main">')[1].split('</main>')[0];
  const about = body.match(/<section[^>]*id="about"[\s\S]*?<\/section>/)?.[0];
  assert.ok(about, 'the page has a What it is section');
  assert.ok(body.indexOf('id="about"') > body.indexOf('lab-hero') && body.indexOf('id="about"') < body.indexOf('id="setup-section"'), 'right after the hero, before the setup');
  assert.match(about, /<figure class="lab-flow">/);
  assert.ok(about.includes(`How it works: ${record.models.length} local models`));
  assert.ok(about.includes(`${record.fixtureFiles} files; after the change its tests fail`));
  assert.match(about, /made up/);
  expectAbout(record, about);
  // The committed record: every group ran, the harness lane made no mistake, so it reads fewer and the lanes bad/good.
  assert.deepEqual(record.refusedCells, []);
  assert.deepEqual(lanesOf(about).map(l => l.tone), ['bad', 'good']);
  assert.ok(plain(about).includes('made fewer of them'));
  // The harness's own check is never shown as a model result: no refusal or second-answer count in this section.
  const text = plain(about);
  assert.doesNotMatch(text, /refused|accepted|second answer|after one more ask|\barm\b/i, 'the check is not counted here, and no jargon');
  assert.match(text, /kept apart from these counts/);
});

test('"What it is." follows the record when it changes: arms swapped, groups not run, a side with no answers', () => {
  // Arms swapped: the harness made the mistakes, so the lanes flip and the word is "more".
  const swapped = clone();
  for (const c of swapped.calls) c.arm = c.arm === 'bare' ? 'harnessed' : 'bare';
  const sw = renderAbout(swapped);
  expectAbout(swapped, sw);
  assert.deepEqual(lanesOf(sw).map(l => l.tone), ['good', 'bad']);
  assert.ok(plain(sw).includes('made more of them'));
  // One harnessed group not run (its bare twin ran): said so, and the sides are not compared.
  const one = clone(), m0 = one.models[0].model;
  one.calls = one.calls.filter(c => !(c.model === m0 && c.variant === 'forced' && c.arm === 'harnessed'));
  one.refusedCells = [{ model: m0, variant: 'forced', arm: 'harnessed', load1: one.maxLoad + 1 }];
  assert.deepEqual(sameModelHarnessProblems(one), [], 'a record with a group not run is a valid record');
  const o = renderAbout(one);
  expectAbout(one, o);
  assert.ok(plain(o).includes(`1 of these ${one.models.length * 4} groups`));
  // Both arms of a group not run: the sides hold the same groups, so the comparison stands.
  const both = clone();
  both.calls = both.calls.filter(c => !(c.model === m0 && c.variant === 'forced'));
  both.refusedCells = ['bare', 'harnessed'].map(arm => ({ model: m0, variant: 'forced', arm, load1: both.maxLoad + 1 }));
  const b = renderAbout(both);
  expectAbout(both, b);
  assert.ok(plain(b).includes('made fewer of them'));
  // Every harnessed group not run: no answers is not "good"; the lane and its boxes are neutral.
  const none = clone();
  none.calls = none.calls.filter(c => c.arm !== 'harnessed');
  none.refusedCells = none.models.flatMap(({ model }) => ['open', 'forced'].map(variant => ({ model, variant, arm: 'harnessed', load1: none.maxLoad + 1 })));
  const n = renderAbout(none);
  expectAbout(none, n);
  // The numbers section's verdict holds the same rule: with no harness answers it compares nothing (pool row ee7d9955).
  const notCompared = (rec, why) => {
    for (const variant of ['open', 'forced']) {
      const sentence = verdictSentence(rec, variant);
      assert.match(sentence, /did not run the same runs, so they are not compared\.$/, `${why}, ${variant}`);
      assert.doesNotMatch(sentence, /fewer|more of these|as many|nothing to fix/, `${why}, ${variant}`);
      assert.equal(armsPaired(rec, variant), false, `${why}, ${variant}`);
    }
  };
  notCompared(none, 'no harness answers');
  // Both arms empty: no runs at all is not "nothing to fix".
  const empty = clone(); empty.calls = [];
  notCompared(empty, 'no answers in either arm');
  // Equal totals, unpaired: each model keeps the same number of runs per arm, but other run numbers on each side.
  const unpaired = clone();
  unpaired.calls = unpaired.calls.filter(c => c.attempt !== 1 || (c.arm === 'bare' ? c.run % 2 === 1 : c.run % 2 === 0));
  assert.equal(totals(unpaired, 'open', 'bare').n, totals(unpaired, 'open', 'harnessed').n, 'the fixture keeps the totals equal');
  notCompared(unpaired, 'equal totals, other runs');
  // The committed record is paired, so its verdicts stand.
  for (const variant of ['open', 'forced']) assert.equal(armsPaired(clone(), variant), true, variant);
  assert.deepEqual(lanesOf(n).map(l => l.tone), ['bad', 'neutral']);
  assert.doesNotMatch(plain(n), /made fewer/);
  // Every harnessed first answer never came back (the model call failed): no reply is no answer, not "no mistake".
  const dead = clone();
  dead.calls = dead.calls.filter(c => !(c.arm === 'harnessed' && c.attempt === 2));
  for (const c of dead.calls.filter(c => c.arm === 'harnessed')) Object.assign(c, { answered: false, replySha256: null, readable: false, verdict: null, wrongPass: false, named: 0, invented: 0, refused: true });
  assert.deepEqual(sameModelHarnessProblems(dead), [], 'a record whose harnessed calls all failed is a valid record');
  const d = renderAbout(dead);
  expectAbout(dead, d);
  assert.deepEqual(lanesOf(d).map(l => l.tone), ['bad', 'neutral'], 'a lane of unanswered calls is never good');
  assert.ok(lanesOf(d)[1].nodes.slice(1).every(x => x.tone === 'neutral' && x.body.endsWith(`; ${dead.runsPerCell * dead.models.length} of ${dead.runsPerCell * dead.models.length} could not be read`)));
  assert.doesNotMatch(plain(d), /made (fewer|more|as many)|Neither way/);
  for (const variant of ['open', 'forced']) assert.doesNotMatch(verdictSentence(dead, variant), /fewer|more|as many|nothing to fix/, `${variant}: the numbers section does not compare either`);
});
