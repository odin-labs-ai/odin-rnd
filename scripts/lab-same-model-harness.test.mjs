import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callsFromRows, cellCounts, logPathOf, EXPERIMENT, fixtureOf, SMH_RECORD, SMH_TEMPLATE, sameModelHarnessProblems, totals, verdictSentence, wilson } from './lab-same-model-harness.mjs';
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
