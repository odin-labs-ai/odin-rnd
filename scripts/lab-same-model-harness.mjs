// Lab 11, "Same model, with and without a harness" (vision-plan vp-10-more-labs, bundle 3 WO-02). scripts/labs.mjs
// calls renderSameModelHarness() and writes, into dist/ only (nothing rendered is committed):
//   labs/same-model-harness/index.html   the lab page, from site/labs/same-model-harness/index.html (<!--SMH_*--> markers)
// The record is site/data/labs/same-model-harness/record.json (odin-lab-same-model-harness v1,
// scripts/schemas/odin-lab-same-model-harness.schema.json). scripts/vendor-same-model-harness.mjs builds it from the
// runner's own log, experiments/same-model-harness/runs/<date>/rows.jsonl, which this repository holds: unlike the labs
// before it, nothing here is private, so the record cites no private commit and anyone can run the experiment again.
// Its sha256 is pinned in site/data/labs/same-model-harness/record.sha256, which the Labs tile also checks.
//
// What the page may say is fixed here, not in the record: the fixture is authored (boxed as such); the numbers are each
// model's FIRST answer, scored by experiments/same-model-harness/score.mjs; the harness's check is deterministic, so
// what it lets through is right by construction (said in words, never shown as a model result). The build refuses the
// record, every reason listed, when:
//   - its bytes are not the pinned ones, or it misses the schema (every object is closed), or any text fails the
//     publisher's screen, or a date is not real or is after the build;
//   - on this repository's own site: a file it was measured with (the fixture, the two task variants, the harness's
//     tool text, the diff, the runner, the scorer, the run log) no longer has the sha256 the record holds;
//   - its calls are not exactly the ones the run log gives, each reply scored again here (so no row is typed by hand);
//   - a cell (model, variant, arm) has not exactly its runs' first answers, a harnessed first answer the check refused
//     has no second answer, or a second answer exists where the check accepted the first.
// Every rate on the page is counted here from the calls, with its Wilson 95% interval; none is copied from the record.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, escape, instantProblems, pageLeaks, readPinned, recordHashes, screenRecord, sidecarPinProblems, validate } from './lab-kit.mjs';
import { harnessRefusals, scoreReply } from '../experiments/same-model-harness/score.mjs';
import { renderFlow } from './lab-flow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SMH_RECORD = 'data/labs/same-model-harness/record.json';
export const SMH_PIN = 'data/labs/same-model-harness/record.sha256';
export const SMH_TEMPLATE = 'labs/same-model-harness/index.html';
export const SMH_SCHEMA = join(here, 'schemas/odin-lab-same-model-harness.schema.json');
export const EXPERIMENT = 'experiments/same-model-harness';
export const VARIANTS = ['open', 'forced'];
export const ARMS = ['bare', 'harnessed'];
const REPO_SITE = resolve(here, '..', 'site');
const sha256 = b => createHash('sha256').update(b).digest('hex');

/** The files the record binds, by its key in `bound`: their paths under the experiment folder. */
/** The run log of a record, under the experiment folder: runs/<day>/rows.jsonl (the record holds the day only). */
export const logPathOf = record => `runs/${record.logDay}/rows.jsonl`;

export const BOUND_FILES = { taskOpen: 'task-open.txt', taskForced: 'task-forced.txt', harness: 'harness.txt', diff: 'change.diff', runner: 'run.mjs', scorer: 'score.mjs' };

/** Every file of a folder, relative and sorted (as the runner lists the fixture). */
function listFiles(dir) {
  const out = [];
  (function walk(d, rel) { for (const name of readdirSync(d).sort()) { if (name === '__pycache__') continue; const p = join(d, name); const r = rel ? `${rel}/${name}` : name; if (statSync(p).isDirectory()) walk(p, r); else out.push(r); } })(dir, '');
  return out.sort();
}

/** The fixture's one sha256 (of its sha256sum listing, sorted by path) and its file list. */
export function fixtureOf(dir) {
  const files = listFiles(dir);
  return { files, manifest: sha256(files.map(f => `${sha256(readFileSync(join(dir, f)))}  ${f}\n`).join('')) };
}

/**
 * The record's calls, derived from the run log's text: every reply scored again with the shared scorer against the
 * fixture's file list and the suite result the session row holds. A reply's text never reaches the record; its sha256 does.
 */
export function callsFromRows(text, fixtureFiles) {
  const rows = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const session = rows.find(r => r.kind === 'session');
  if (!session) throw new Error('the run log has no session row');
  const truth = { files: fixtureFiles, suite: session.suite };
  const calls = rows.filter(r => r.kind === 'call').map(r => {
    const score = r.ok ? scoreReply(r.text, truth) : { readable: false, named: 0, invented: 0, verdict: null, wrongPass: false };
    return {
      model: r.model, variant: r.variant, arm: r.arm, run: r.run, attempt: r.attempt, seed: r.seed,
      ms: r.ms, load1: r.load1, answered: !!r.ok, readable: score.readable, named: score.named, invented: score.invented,
      verdict: score.verdict, wrongPass: score.wrongPass,
      refused: r.arm === 'harnessed' ? (r.ok ? harnessRefusals(score, truth).length > 0 : true) : null,
      replySha256: r.ok ? sha256(r.text) : null,
    };
  });
  const refusedCells = rows.filter(r => r.kind === 'cell-refused').map(r => ({ model: r.model, variant: r.variant, arm: r.arm, load1: r.load1 }));
  const end = rows.find(r => r.kind === 'end');
  return { session, calls, refusedCells, end };
}

/** The machine, in words, from the run log's session row: its chip and memory, never its name. */
export const machineText = s => `${/^[aeiou]/i.test(s.machine.cpu) ? 'an' : 'a'} ${s.machine.cpu} laptop with ${s.machine.memoryGiB} GiB of memory`;

/** Wilson 95% interval for k of n, as two fractions rounded to three places. */
export function wilson(k, n) {
  if (!(n > 0)) return [0, 0];
  const z = 1.959964, p = k / n, d = 1 + z * z / n;
  const mid = (p + z * z / (2 * n)) / d, half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, +(mid - half).toFixed(3)), Math.min(1, +(mid + half).toFixed(3))];
}

/** The first answers of one cell, counted. */
export function cellCounts(calls, model, variant, arm) {
  const first = calls.filter(c => c.model === model && c.variant === variant && c.arm === arm && c.attempt === 1);
  const second = calls.filter(c => c.model === model && c.variant === variant && c.arm === arm && c.attempt === 2);
  const n = first.length;
  const ms = first.filter(c => c.answered).map(c => c.ms).sort((a, b) => a - b);
  const median = ms.length ? (ms.length % 2 ? ms[(ms.length - 1) / 2] : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2) : null;
  return {
    n,
    wrongPass: first.filter(c => c.wrongPass).length,
    invented: first.filter(c => c.invented > 0).length,
    unknown: first.filter(c => c.verdict === 'UNKNOWN').length,
    fail: first.filter(c => c.verdict === 'FAIL').length,
    unreadable: first.filter(c => !c.readable).length,
    refused: arm === 'harnessed' ? first.filter(c => c.refused).length : null,
    acceptedAfterAsk: arm === 'harnessed' ? second.filter(c => c.refused === false).length : null,
    medianMs: median,
    loads: first.map(c => c.load1),
  };
}

/** Every reason the record may not be published (empty when it may). */
export function sameModelHarnessProblems(record, { now = new Date(), where = SMH_RECORD, repoRoot = null } = {}) {
  const problems = validate(JSON.parse(readFileSync(SMH_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-same-model-harness v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where));
  const m = record.measured;
  problems.push(...instantProblems(m.started, `${where}#/measured/started`, now), ...instantProblems(m.ended, `${where}#/measured/ended`, now));
  if (m.started.slice(0, 10) !== m.on) problems.push(`${where}#/measured/on: not the date the run started`);
  if (m.ended < m.started) problems.push(`${where}#/measured/ended: before the run started`);
  if (record.suite !== 'FAIL') problems.push(`${where}#/suite: the page says the fixture's suite fails after the change`);
  const models = record.models.map(x => x.model);
  if (new Set(models).size !== models.length) problems.push(`${where}#/models: a model is listed twice`);
  // Every cell: exactly `runs` first answers, runs 1..runs once each, unless the cell was refused for load.
  for (const model of models) for (const variant of VARIANTS) for (const arm of ARMS) {
    const at = `${where}#/calls (${model} ${variant} ${arm})`;
    const refusedCell = record.refusedCells.some(c => c.model === model && c.variant === variant && c.arm === arm);
    const first = record.calls.filter(c => c.model === model && c.variant === variant && c.arm === arm && c.attempt === 1);
    if (refusedCell) { if (first.length) problems.push(`${at}: a cell refused for load has calls`); continue; }
    const runs = first.map(c => c.run).sort((a, b) => a - b);
    if (JSON.stringify(runs) !== JSON.stringify(Array.from({ length: record.runsPerCell }, (_, i) => i + 1))) problems.push(`${at}: not exactly runs 1 to ${record.runsPerCell}, once each`);
    for (const c of record.calls.filter(c => c.model === model && c.variant === variant && c.arm === arm && c.attempt === 2)) {
      const f = first.find(x => x.run === c.run);
      if (arm !== 'harnessed' || !f?.refused) problems.push(`${at}: run ${c.run} has a second answer the check did not ask for`);
    }
    if (arm === 'harnessed') for (const f of first.filter(x => x.refused && x.answered)) if (!record.calls.some(c => c.model === model && c.variant === variant && c.arm === arm && c.attempt === 2 && c.run === f.run)) problems.push(`${at}: run ${f.run} was refused and has no second answer`);
  }
  // Each (model, variant, arm, run, attempt) once; run n of both arms, and its re-ask, with one seed (the page says so).
  const keys = record.calls.map(c => `${c.model}|${c.variant}|${c.arm}|${c.run}|${c.attempt}`);
  for (const k of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) problems.push(`${where}#/calls: ${k.replaceAll('|', ' ')} is there more than once`);
  for (const model of models) for (const variant of VARIANTS) for (let run = 1; run <= record.runsPerCell; run++) {
    const seeds = new Set(record.calls.filter(c => c.model === model && c.variant === variant && c.run === run).map(c => c.seed));
    if (seeds.size > 1) problems.push(`${where}#/calls (${model} ${variant} run ${run}): the arms and the re-ask do not share one seed`);
  }
  for (const [i, c] of record.calls.entries()) {
    if (!models.includes(c.model)) problems.push(`${where}#/calls/${i}: a model the record does not list`);
    if (c.wrongPass !== (c.verdict === 'PASS')) problems.push(`${where}#/calls/${i}: wrongPass is not "said PASS" (the suite fails)`);
    if (c.answered !== (c.replySha256 !== null)) problems.push(`${where}#/calls/${i}: an answered call has its reply's sha256, an unanswered one none`);
    if (c.readable !== (c.verdict !== null)) problems.push(`${where}#/calls/${i}: a readable reply has a verdict, an unreadable one none`);
    if ((c.arm === 'harnessed') !== (c.refused !== null)) problems.push(`${where}#/calls/${i}: only the harnessed arm has the check's verdict`);
    if (c.invented > c.named) problems.push(`${where}#/calls/${i}: more invented files than named ones`);
  }
  // On this repository's own site, the record is bound to the files it was measured with, and its calls to the run log.
  if (repoRoot) {
    const dir = join(repoRoot, EXPERIMENT);
    const fx = fixtureOf(join(dir, 'fixture'));
    if (fx.manifest !== record.bound.fixture) problems.push(`${where}#/bound/fixture: the fixture is not the one measured (its manifest is ${fx.manifest})`);
    if (fx.files.length !== record.fixtureFiles) problems.push(`${where}#/fixtureFiles: the fixture has ${fx.files.length} files`);
    for (const [key, file] of Object.entries(BOUND_FILES)) {
      const actual = sha256(readFileSync(join(dir, file)));
      if (actual !== record.bound[key]) problems.push(`${where}#/bound/${key}: ${EXPERIMENT} ${key} is not the one measured (sha256 ${actual})`);
    }
    const logPath = join(dir, logPathOf(record));
    if (!existsSync(logPath)) problems.push(`${where}#/log: the run log is not in ${EXPERIMENT}`);
    else {
      const text = readFileSync(logPath, 'utf8');
      if (sha256(text) !== record.bound.log) problems.push(`${where}#/bound/log: the run log is not the one vendored`);
      const derived = callsFromRows(text, fx.files);
      if (JSON.stringify(derived.calls) !== JSON.stringify(record.calls)) problems.push(`${where}#/calls: not the calls the run log gives, scored again (re-vendor with scripts/vendor-same-model-harness.mjs)`);
      if (JSON.stringify(derived.refusedCells) !== JSON.stringify(record.refusedCells)) problems.push(`${where}#/refusedCells: not the run log's`);
      const s = derived.session;
      if (s.fixtureManifest !== record.bound.fixture || s.taskSha256?.open !== record.bound.taskOpen || s.taskSha256?.forced !== record.bound.taskForced || s.harnessSha256 !== record.bound.harness || s.diffSha256 !== record.bound.diff || s.runnerSha256 !== record.bound.runner || s.scorerSha256 !== record.bound.scorer) problems.push(`${where}#/bound: the run log's session row was measured with other files`);
      if (s.suiteOutputSha256 !== record.bound.suiteOutput) problems.push(`${where}#/bound/suiteOutput: not the run log's`);
      if (machineText(s) !== m.machine || s.ollama !== m.ollama) problems.push(`${where}#/measured: machine and Ollama version are not the run log's`);
      if (s.runs !== record.runsPerCell || s.maxLoad !== record.maxLoad || s.suite !== record.suite) problems.push(`${where}: runs, load ceiling or suite result are not the run log's`);
      if (s.at !== m.started || derived.end?.at !== m.ended) problems.push(`${where}#/measured: start and end are not the run log's`);
      if (JSON.stringify(s.models) !== JSON.stringify(record.models)) problems.push(`${where}#/models: not the run log's models and digests`);
    }
  }
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readSameModelHarness(root = 'site', { now = new Date() } = {}) {
  const repoRoot = resolve(root) === REPO_SITE ? resolve(root, '..') : null;
  return readPinned({ root, file: SMH_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: SMH_PIN, file: SMH_RECORD, vendor: 'scripts/vendor-same-model-harness.mjs' }), check: record => sameModelHarnessProblems(record, { now, repoRoot }), refused: 'Lab 11 record refused' });
}

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const pct = x => `${Math.round(x * 100)}%`;
const frac = (k, n) => `${k} of ${n}`;
const interval = (k, n) => { const [lo, hi] = wilson(k, n); return `<span class="lab-source">(${pct(lo)} to ${pct(hi)})</span>`; };
const seedRange = record => { const s = record.calls.map(c => c.seed); return `${Math.min(...s)} to ${Math.max(...s)}`; };
const secs = ms => (ms === null ? 'none' : `${(ms / 1000).toFixed(1)} s`);

export function renderIntro() {
  return `<span class="technical">LAB 11 · SAME MODEL, WITH AND WITHOUT A HARNESS</span><h1 id="lab-title">Same model, with and without a harness</h1><p class="company-lead">We like to say the model is rented and the harness is yours. This lab tests that instead of saying it. One small made-up project, one change to it, one question: which files does the change touch, and does the test suite still pass? Each local model answers it bare, and again with a harness that ran three tools for it first. Same model, same question, same seed. The only difference is the harness.</p>`;
}

// "What it is.": the lab in plain words, then how it runs (scripts/lab-flow.mjs). Every count is totals()' first
// answers over the record's calls; the project is said to be made up, and the harness's own check (its refusals and
// second answers) is named only as kept apart, never counted here: it is not a result of the model.
// How often each model was asked is read from the record too: a group (model, form, arm) the runner did not start
// because the machine was busy (record.refusedCells) is said so, never counted as run. Bare and harnessed are compared
// only when every not-run group's other arm was not run either (so both sides hold the same groups) and both sides have
// answers; otherwise the section says less. A box or lane with no answers gets the neutral tone, never good. A first
// answer that never came back or could not be read (readable false) makes neither mistake, so it is no answer either:
// a box or lane with any such answer is never good, its box says how many, and the sides are compared only when they
// hold as many of them (fail closed: a harness whose every call failed must not read as a win).
export function renderAbout(record) {
  const errs = t => t.wrongPass + t.invented;
  const k = record.models.length, runs = record.runsPerCell;
  const notRun = (model, variant, arm) => record.refusedCells.some(c => c.model === model && c.variant === variant && c.arm === arm);
  const groups = k * VARIANTS.length * ARMS.length, skipped = record.refusedCells.length;
  const paired = record.refusedCells.every(c => notRun(c.model, c.variant, c.arm === 'bare' ? 'harnessed' : 'bare'));
  const all = Object.fromEntries(VARIANTS.map(v => [v, Object.fromEntries(ARMS.map(a => [a, totals(record, v, a)]))]));
  const sum = (arm, f) => VARIANTS.reduce((s, v) => s + f(all[v][arm]), 0);
  const bareErrs = sum('bare', errs), harnErrs = sum('harnessed', errs), bareN = sum('bare', t => t.n), harnN = sum('harnessed', t => t.n);
  const bareUnread = sum('bare', t => t.unreadable), harnUnread = sum('harnessed', t => t.unreadable);
  const sameRuns = paired && bareN > 0 && bareN === harnN;
  const comparable = sameRuns && bareUnread === harnUnread;
  const side = harnErrs < bareErrs ? 'fewer' : harnErrs > bareErrs ? 'more' : 'as many';
  const suite = record.suite === 'FAIL' ? 'fail' : 'pass';
  const asked = skipped === 0
    ? `each model got each form ${runs} times bare and ${runs} times with the harness`
    : `each model was to get each form ${runs} times bare and ${runs} times with the harness, but ${skipped} of these ${groups} groups of ${runs} (one model, one form, bare or with the harness) were not run because the computer was too busy, so they have no answers`;
  const counted = 'Two mistakes are counted: saying the failing tests pass, and naming a file that does not exist.';
  const unreadNote = bareUnread === 0 ? '' : ` On each side, ${bareUnread} of the ${harnN} first answers could not be read (no reply came back, or it could not be scored), so they count as neither mistake.`;
  const verdict = !sameRuns
    ? `${counted} Because not every group was run on both sides, the two sides are not compared here; the counts below are only for the groups that ran.`
    : !comparable
      ? `${counted} Some first answers could not be read (no reply came back, or it could not be scored): ${bareUnread} of ${bareN} without the harness and ${harnUnread} of ${harnN} with it. Such an answer makes neither mistake, so the two sides are not compared here; the counts below show both.`
    : bareErrs + harnErrs === 0 && bareUnread === 0 ? 'Neither way made either mistake: on this project the harness had nothing to fix.'
    : `${counted} With the harness, the same models made ${side} of them in their first answers: ${harnErrs} mistakes with the harness against ${bareErrs} without it, over ${harnN} first answers each way.${unreadNote}`;
  const prose = `<p>People say the AI model is rented and the harness around it is yours. A harness is the code that runs tools for the model and checks what it says. This lab tests whether the harness changes the answers, with the model kept the same.</p><p>We made up a small project and one change to it, after which its tests ${suite}. ${k === 1 ? 'One local model was' : `${k} local models were`} asked which files the change touches and whether the tests still pass: once with only the question and the change, and once with what the harness's tools found in the project first. The question came in two forms, one where the model may say it cannot tell and one where it must say pass or fail, and ${asked}. Every first answer was scored by code, not by a person.</p><p>${verdict} The harness can also check an answer and ask again; that is shown further down, kept apart from these counts.</p>`;
  const toneOf = ts => (ts.some(t => errs(t) > 0) ? 'bad' : ts.every(t => t.n > 0 && t.unreadable === 0) ? 'good' : 'neutral');
  const outcome = (variant, arm) => {
    const t = all[variant][arm];
    const body = t.n === 0 ? 'not run: the computer was too busy' : `${t.wrongPass} of ${t.n} first answers said the failing tests pass; ${t.invented} of ${t.n} named a file that does not exist${t.unreadable ? `; ${t.unreadable} of ${t.n} could not be read` : ''}`;
    return { title: variant === 'open' ? 'May say UNKNOWN' : 'Must say PASS or FAIL', body, tone: toneOf([t]) };
  };
  const lane = (arm, label, first) => ({ label, tone: toneOf(VARIANTS.map(v => all[v][arm])), nodes: [first, ...VARIANTS.map(v => outcome(v, arm))] });
  const each = skipped === 0
    ? `each asked ${runs} times bare and ${runs} times with the harness, for each form of the question`
    : `each to be asked ${runs} times bare and ${runs} times with the harness, for each form of the question; ${skipped} of ${groups} groups not run (the computer was too busy)`;
  const flow = renderFlow({
    caption: `How it works: ${k} local models, the same question, asked bare and with a harness`,
    source: [
      { title: 'A made-up project and one change', body: `${record.fixtureFiles} files; after the change its tests ${suite}` },
      { title: `${k} local models`, body: `${record.models.map(x => x.model).join(', ')}; ${each}` },
    ],
    lanes: [
      lane('bare', 'Bare: the model alone', { title: 'The question and the change', body: 'nothing else' }),
      lane('harnessed', 'With a harness: the same model', { title: 'The question, the change and the tool output', body: "the harness's tools look at the project before the model is asked" }),
    ],
  });
  return `${prose}${flow}`;
}

export function renderSetup(record) {
  return `${box('fixture', { cls: 'smh-fixture', id: 'fixture', body: `<p>The project is a route planner for Northwind Labs, a courier we made up: ${record.fixtureFiles} files of Python, four modules and their tests. The change moves one line in the pricing module, so that the departure depot is charged as a stop. The tests say it is not one, so after the change the suite fails. We wrote the project, the change and the question; nothing in it comes from a client.</p>` })}
<ul class="rogue-list"><li><strong>Bare.</strong> The model gets the question and the diff. Nothing else.</li><li><strong>With a harness.</strong> The model gets the same question and diff, plus the output of three tools the harness ran on the project before asking: the list of files, a search for the changed function, and the test run with its exit status.</li><li><strong>Two ways to ask.</strong> In the open question the model may answer UNKNOWN for the tests. In the forced one it must say PASS or FAIL, the shape of a coding agent's closing report.</li><li><strong>The test files too.</strong> The question asks for the test files that cover the changed function. The bare arm cannot see the project, so any test file it names is a guess.</li><li><strong>Scored by code.</strong> A reply invents a file when it names a path that is not in the project. It is a wrong PASS when it says the suite passes. Both are counted from the model's first answer, by the same scorer the runner uses.</li></ul>`;
}

function cellRow(record, model, variant, arm) {
  const c = cellCounts(record.calls, model, variant, arm);
  if (record.refusedCells.some(x => x.model === model && x.variant === variant && x.arm === arm)) return `<tr><td><code>${escape(model)}</code></td><td>${arm === 'bare' ? 'Bare' : 'With a harness'}</td><td colspan="5">Not run: the machine was too busy when this cell was due.</td></tr>`;
  return `<tr><td><code>${escape(model)}</code></td><td>${arm === 'bare' ? 'Bare' : 'With a harness'}</td><td>${frac(c.wrongPass, c.n)} ${interval(c.wrongPass, c.n)}</td><td>${frac(c.invented, c.n)} ${interval(c.invented, c.n)}</td><td>${frac(c.unknown, c.n)}</td><td>${frac(c.unreadable, c.n)}</td><td>${secs(c.medianMs)}</td></tr>`;
}

/** Totals over all models for one variant and arm (first answers). */
export function totals(record, variant, arm) {
  const sum = { n: 0, wrongPass: 0, invented: 0, unknown: 0, unreadable: 0 };
  for (const { model } of record.models) { const c = cellCounts(record.calls, model, variant, arm); sum.n += c.n; sum.wrongPass += c.wrongPass; sum.invented += c.invented; sum.unknown += c.unknown; sum.unreadable += c.unreadable; }
  return sum;
}

/** The sentence that tests the claim, from the counts: never typed. */
export function verdictSentence(record, variant) {
  const b = totals(record, variant, 'bare'), h = totals(record, variant, 'harnessed');
  const errs = t => t.wrongPass + t.invented;
  const what = variant === 'open' ? 'When the model may say UNKNOWN' : 'When the model must say PASS or FAIL';
  if (errs(b) === 0 && errs(h) === 0 && b.unreadable === 0 && h.unreadable === 0) return `${what}, neither arm made either mistake: on this fixture the harness had nothing to fix.`;
  // The arms are compared only over the same number of first answers, more than none: a side that did not run (or ran
  // fewer groups) makes no mistakes it was never asked to make (pool row ee7d9955).
  if (b.n !== h.n || b.n === 0) return `${what}, across all models: bare, ${frac(b.wrongPass, b.n)} first answers said the failing suite passes and ${frac(b.invented, b.n)} named a file that does not exist; with the harness, ${frac(h.wrongPass, h.n)} and ${frac(h.invented, h.n)}. The two arms did not run the same number of times, so they are not compared.`;
  // An unreadable first answer (no reply, or none that could be scored) makes neither mistake: compare only like with like.
  if (b.unreadable !== h.unreadable) return `${what}, across all models: bare, ${frac(b.wrongPass, b.n)} first answers said the failing suite passes, ${frac(b.invented, b.n)} named a file that does not exist and ${frac(b.unreadable, b.n)} could not be read; with the harness, ${frac(h.wrongPass, h.n)}, ${frac(h.invented, h.n)} and ${frac(h.unreadable, h.n)}. An answer that could not be read makes neither mistake, so the two arms are not compared.`;
  const side = errs(h) < errs(b) ? 'fewer' : errs(h) > errs(b) ? 'more' : 'as many';
  return `${what}, across all models: bare, ${frac(b.wrongPass, b.n)} first answers said the failing suite passes and ${frac(b.invented, b.n)} named a file that does not exist; with the harness, ${frac(h.wrongPass, h.n)} and ${frac(h.invented, h.n)}. The same models made ${side} of these mistakes with the harness.`;
}

export function renderNumbers(record) {
  const head = ['Model', 'Arm', 'Said the failing suite passes', 'Named a file that does not exist', 'Said UNKNOWN', 'Unreadable reply', 'Median time'];
  const table = variant => `<div class="lab-table-wrap"><table><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${record.models.map(({ model }) => ARMS.map(arm => cellRow(record, model, variant, arm)).join('')).join('')}</tbody></table></div>`;
  return `<p>Each cell is ${record.runsPerCell} runs of one model, first answers only; run <em>n</em> of both arms used the same seed (${seedRange(record)}). In brackets, the Wilson 95% interval: with ${record.runsPerCell} runs a cell is wide, so read the totals before any one cell.</p>
<h3 class="lab-subhead" id="open">The open question: UNKNOWN allowed</h3><p><strong>${escape(verdictSentence(record, 'open'))}</strong></p>${table('open')}
<h3 class="lab-subhead" id="forced">The forced question: PASS or FAIL</h3><p><strong>${escape(verdictSentence(record, 'forced'))}</strong></p>${table('forced')}`;
}

export function renderCheck(record) {
  const rows = record.models.map(({ model }) => VARIANTS.map(variant => {
    const c = cellCounts(record.calls, model, variant, 'harnessed');
    return `<tr><td><code>${escape(model)}</code></td><td>${variant}</td><td>${frac(c.refused, c.n)}</td><td>${c.refused ? frac(c.acceptedAfterAsk, c.refused) : 'none was asked again'}</td></tr>`;
  }).join('')).join('');
  return `${box('real', { cls: 'smh-check', id: 'check-box', body: `<p>A harness can also check the answer. Ours refuses a reply that names a file not in the project, or whose test verdict is not the suite's own exit status, and asks once more with the reason. Its check is plain code, so what it lets through cannot be a wrong PASS or an invented file. That is true by construction, not a result of the model, and it is not counted in the numbers above.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">Model</th><th scope="col">Question</th><th scope="col">First answers the check refused</th><th scope="col">Accepted after one more ask</th></tr></thead><tbody>${rows}</tbody></table></div>` })}`;
}

export function renderRun(record) {
  const m = record.measured, b = record.bound;
  const loads = record.calls.map(c => c.load1);
  const lo = Math.min(...loads), hi = Math.max(...loads);
  const models = record.models.map(x => `<li><code>${escape(x.model)}</code>, digest <code>${escape(x.digest)}</code></li>`).join('');
  const files = [['the fixture (one sha256 over its sha256sum listing)', b.fixture], ['the open question', b.taskOpen], ['the forced question', b.taskForced], ["the harness's tool text", b.harness], ['the change', b.diff], ['the runner', b.runner], ['the scorer', b.scorer], ["the test run's output, as the harness showed it on that machine (another Python version words a traceback differently)", b.suiteOutput], ['the run log', b.log]].map(([what, h]) => `<li>${escape(what[0].toUpperCase() + what.slice(1))}: <code>${escape(h)}</code></li>`).join('');
  return `<p>Measured on <time datetime="${escape(m.on)}">${escape(longDate(m.on))}</time>, from <time datetime="${escape(m.started)}">${escape(m.started.slice(11, 16))}</time> to <time datetime="${escape(m.ended)}">${escape(m.ended.slice(11, 16))}</time> UTC, on ${escape(m.machine)}, with Ollama ${escape(m.ollama)}. The calls ran one at a time; a cell would not start above a one-minute load of ${record.maxLoad}. The one-minute load before each call ranged from ${lo.toFixed(1)} to ${hi.toFixed(1)}: other work was running on the same machine, so the times are what this machine gave at that load, not a benchmark. Each model's own default sampling settings were used; the qwen3 models ran with thinking off, and every reply was asked for as JSON.</p>
<h3 class="lab-subhead">The models, as served that day</h3><ul class="rogue-list">${models}</ul>
<h3 class="lab-subhead">Check it yourself</h3><p>Everything on this page comes from one record, <a href="../../${SMH_RECORD}">published here</a> and pinned by its sha256. The project, the questions, the runner, the scorer and the full run log, with every reply as the model wrote it, are in <a href="https://github.com/odin-labs-ai/odin-rnd/tree/main/${EXPERIMENT}">the repository</a>. With Ollama and the same models, the runner asks the same questions again; the build refuses this page if any of those files is not the one measured, or if a row of the record is not what the run log gives when each reply is scored again.</p><ul class="rogue-list rogue-hashes">${files}</ul>`;
}

export function renderBoundary(record) {
  return `<ul class="rogue-list"><li>One small project, one change, one question, ${record.models.length} local models. It does not say how often this happens on real projects, or with hosted models.</li><li>The harness here is three tools and a check. A different harness, or a model asked to call the tools itself, could do better or worse.</li><li>With ${record.runsPerCell} runs a cell, a single model's rate is wide; the intervals say how wide.</li><li>In the harnessed arm the suite's result is in the tool output the model was given, so a right verdict there shows the model read what the harness ran, not that it reasoned its way to it. The comparison is about what the same model does with and without that output.</li><li>A wrong PASS in the bare arm is a guess the model was not given the means to check. That is the point of the comparison, not a flaw in the model: the open question shows what the same models do when they are allowed to say they cannot tell.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderSameModelHarness(root = 'site', { now = new Date() } = {}) {
  const record = readSameModelHarness(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, SMH_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--SMH_INTRO-->': renderIntro(record), '<!--SMH_ABOUT-->': renderAbout(record), '<!--SMH_SETUP-->': renderSetup(record), '<!--SMH_NUMBERS-->': renderNumbers(record), '<!--SMH_CHECK-->': renderCheck(record), '<!--SMH_RUN-->': renderRun(record), '<!--SMH_BOUNDARY-->': renderBoundary(record) })) {
    if (!html.includes(marker)) throw new Error(`${SMH_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${SMH_TEMPLATE}: unresolved content marker`);
  const leaks = pageLeaks(html, recordHashes(record), { onMain: [] });
  if (leaks.length) throw new Error(`${SMH_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [SMH_TEMPLATE]: html } };
}
