// Lab 08, "Can an agent fix a red build?" (lane vp-bundle2). scripts/labs.mjs calls renderRedBuild() and writes, into
// dist/ only (nothing rendered is committed):
//   labs/red-build/index.html   the lab page, from site/labs/red-build/index.html (<!--RED_*--> markers)
// The record is site/data/labs/red-build/record.json (odin-lab-red-build v1, scripts/schemas/odin-lab-red-build.schema.json),
// which scripts/vendor-red-build.mjs builds from the agent space's private repository at its main; its sha256 is pinned
// in site/data/labs/red-build/record.sha256, which the Labs tile (scripts/lab-tiles.mjs) also checks.
//
// The answer is an honest negative: on nine fresh red builds the CI doctor made no fix a reviewer judged real. What the
// page may say is fixed here, not in the record. Every verdict is by a separate AI reviewer, not a human, and is boxed
// as such. Every number names the set it counts: the held-out nine (two reviewer rounds, eighteen verdicts) or the
// earlier set (twenty-seven judgments over three runs of the doctor), never one for the other. The held-out figures are
// a RECOUNT: the build counts the committed verdicts and refuses the record unless they give the committed score (the
// scorer's own inputs stayed private by design; the page says so). The build refuses the record, every reason listed,
// when:
//   - its bytes are not the pinned ones, or it misses the schema (every object is closed), or the kit record contract;
//   - the runs' verdicts, or the two rounds' own files, do not add up to the committed score, field by field;
//   - a run was judged a real fix (the page says none was), or the earlier set's runs do not add up to its totals;
//   - two runs share a label, or a label is not an anonymous label;
//   - a date is not real or is after the build, or any text fails the publisher's screen.
// The rendered page is screened again as a whole (pageLeaks), with only the record's own hashes masked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, instantProblems, pageLeaks, readPinned, recordHashes, screenRecord, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const RED_RECORD = 'data/labs/red-build/record.json';
export const RED_PIN = 'data/labs/red-build/record.sha256';
export const RED_TEMPLATE = 'labs/red-build/index.html';
export const RED_SCHEMA = join(here, 'schemas/odin-lab-red-build.schema.json');
const DIAGNOSES = ['right', 'partly', 'wrong'];
const PATCHES = ['fixes', 'partial', 'wrong', 'none-right', 'none-missed'];
const CLASSES = ['code_bug', 'test_is_wrong', 'config_env', 'flake', 'red_by_design'];
const LABEL = /^(run|repo)-[g-z]{8}$/;

const count = (values, keys) => Object.fromEntries(keys.map(k => [k, values.filter(v => v === k).length]));
const sum = (objs, keys) => Object.fromEntries(keys.map(k => [k, objs.reduce((n, o) => n + (o[k] ?? 0), 0)]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The class a run is counted under, by the scorer's own rule: the reviewers' classes; when they split, code_bug wins
 * over the others (the stricter reading for a fixer), and otherwise the commoner class, ties to the earlier in CLASSES.
 */
export function consensus(classes) {
  const cs = classes.filter(Boolean);
  if (!cs.length) return null;
  if (cs.includes('code_bug')) return 'code_bug';
  const n = c => cs.filter(x => x === c).length;
  return [...new Set(cs)].sort((a, b) => n(b) - n(a) || CLASSES.indexOf(a) - CLASSES.indexOf(b))[0];
}

/**
 * The recount: the committed verdicts against the committed score, field by field, the way the scorer counts them (a
 * run's class is the reviewers'; "ruled" is closed by rule; "missed" is a run where a reviewer said a fix was missed).
 * Empty when they agree. The vendor runs it too, and refuses to write a record that fails it.
 */
export function recount(record) {
  const h = record.heldOut, s = h.score, runs = h.runs, problems = [];
  const check = (what, got, want) => { if (!same(got, want)) problems.push(`${what}: the verdicts give ${JSON.stringify(got)}, the score says ${JSON.stringify(want)}`); };
  check('cases', runs.length, s.cases);
  check('diagnosis', count(runs.flatMap(r => r.reviewers.diagnosis), DIAGNOSES), s.diagnosis);
  check('patch', count(runs.flatMap(r => r.reviewers.patch), PATCHES), s.patch);
  check('byClass', count(runs.map(r => r.cls), CLASSES), s.byClass);
  check('ruled', runs.filter(r => r.how === 'no patch by rule').length, s.ruled);
  for (const k of ['reproduced', 'passes', 'judgedFix', 'judgedNot']) check(k, runs.filter(r => r[k]).length, s[k]);
  check('missed', runs.filter(r => r.reviewers.patch.includes('none-missed')).length, s.missed);
  // Each run's class is the reviewers' by the scorer's rule, and "split" is whether they differ.
  runs.forEach((r, i) => {
    check(`run ${i} class`, r.cls, consensus(r.reviewers.causeClass));
    check(`run ${i} split`, r.split, r.reviewers.causeClass[0] !== r.reviewers.causeClass[1]);
  });
  // Each round's own file, counted on its own, against its own reviewer's verdicts in the rows (the first round is
  // each run's first verdict, the second its second): the two rounds together are the score.
  for (const [name, r] of Object.entries(h.rounds)) {
    const at = name === 'a' ? 0 : 1;
    check(`round ${name} cases`, r.cases, s.cases);
    check(`round ${name} diagnoses`, count(runs.map(x => x.reviewers.diagnosis[at]), DIAGNOSES), r.diagnosis);
    check(`round ${name} patch verdicts`, count(runs.map(x => x.reviewers.patch[at]), PATCHES), r.patch);
  }
  check('the two rounds\' diagnoses', sum(Object.values(h.rounds).map(r => r.diagnosis), DIAGNOSES), s.diagnosis);
  check('the two rounds\' patch verdicts', sum(Object.values(h.rounds).map(r => r.patch), PATCHES), s.patch);
  const e = record.earlier;
  check('the earlier set\'s diagnoses', sum(e.byRun.map(r => r.diagnosis), DIAGNOSES), e.diagnosis);
  check('the earlier set\'s patch verdicts', sum(e.byRun.map(r => r.patch), PATCHES), e.patch);
  check('the earlier set\'s judgments', Object.values(e.diagnosis).reduce((a, b) => a + b, 0), e.judgments);
  check('the earlier set\'s runs of the doctor', e.byRun.length, e.runsOfTheDoctor);
  check('the earlier set\'s judgments, one per build per run of the doctor', e.builds * e.runsOfTheDoctor, e.judgments);
  return problems;
}

/** Every reason the record may not be published (empty when it may). */
export function redBuildProblems(record, { now = new Date(), where = RED_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(RED_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-red-build v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where), ...vendoredProblems(record.vendored, { where, now }));
  const v = record.vendored, h = record.heldOut;
  for (const [iso, at] of [[v.committed, '/vendored/committed'], [h.frozen, '/heldOut/frozen'], [h.since, '/heldOut/since'], [h.until, '/heldOut/until']]) problems.push(...instantProblems(iso, `${where}#${at}`, now));
  if (!(h.since < h.until && h.until <= h.frozen)) problems.push(`${where}#/heldOut: the set was not frozen after its window closed`);
  // Exactly one verdict per reviewer round on every run: the page shows two, and counts two per case.
  const rounds = Object.keys(h.rounds).length;
  h.runs.forEach((r, i) => { for (const k of ['diagnosis', 'patch', 'causeClass']) if (r.reviewers[k].length !== rounds) problems.push(`${where}#/heldOut/runs/${i}/reviewers/${k}: ${r.reviewers[k].length} verdicts, not one per round (${rounds})`); });
  if (problems.length) return problems;
  problems.push(...recount(record).map(p => `${where}#/heldOut: ${p}`));
  if (h.score.judgedFix !== 0) problems.push(`${where}#/heldOut/score/judgedFix: the page says no fix was judged real`);
  const labels = h.runs.map(r => r.label);
  if (new Set(labels).size !== labels.length) problems.push(`${where}#/heldOut/runs: two runs share a label`);
  for (const [i, r] of h.runs.entries()) for (const l of [r.label, r.repo]) if (!LABEL.test(l)) problems.push(`${where}#/heldOut/runs/${i}: ${l} is not an anonymous label`);
  if (new Set(h.runs.map(r => r.repo)).size !== h.repos) problems.push(`${where}#/heldOut/repos: not the number of repository labels the runs carry`);
  problems.push(...whyProblems(record, where));
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readRedBuild(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: RED_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: RED_PIN, file: RED_RECORD, vendor: 'scripts/vendor-red-build.mjs' }), check: record => redBuildProblems(record, { now }), refused: 'Lab 08 record refused' });
}

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const cap = s => s[0].toUpperCase() + s.slice(1);
const words = { code_bug: 'a code bug', test_is_wrong: 'the test is wrong', config_env: 'config or environment', flake: 'a flake', red_by_design: 'red by design', right: 'right', partly: 'partly right', wrong: 'wrong', fixes: 'a fix', partial: 'a partial fix', 'none-right': 'no patch, rightly', 'none-missed': 'no patch: a fix was missed' };
const w = k => escape(words[k] ?? String(k).replaceAll('_', ' '));
const pair = ([a, b]) => (a === b ? `${w(a)}, both` : `${w(a)} / ${w(b)}`);
const set = { held: 'the held-out nine, both reviewer rounds', earlier: 'the earlier set, three runs of the doctor' };
const src = which => `<span class="lab-set">${escape(set[which])}</span>`;

export function renderIntro(record) {
  const s = record.heldOut.score;
  return `<span class="technical">LAB 08 · CAN AN AGENT FIX A RED BUILD?</span><h1 id="lab-title">Can an agent fix a red build?</h1><p class="company-lead">Not yet. We gave the agent space's CI doctor ${s.cases} fresh red builds from ${record.heldOut.repos === 1 ? 'one of our own private repositories' : 'our own private repositories'}, frozen before it saw any of them. Two separate AI reviewers judged every answer, each blind to the other. <strong>Judged real fixes: ${s.judgedFix} of ${s.cases}.</strong> The diagnoses held up better than the fixes did, and the page says which set every number comes from.</p>`;
}

export function renderNumbers(record) {
  const h = record.heldOut, s = h.score, e = record.earlier;
  const verdicts = s.cases * Object.keys(h.rounds).length;
  const row = (what, value, which) => `<tr><th scope="row">${what}</th><td><strong>${value}</strong></td><td>${src(which)}</td></tr>`;
  return box('judge', { cls: 'red-numbers', id: 'numbers', body: `<p>Every verdict here is a separate AI reviewer's, given one case at a time with no sight of the other reviewer, the doctor's name or the run's outcome. None is a person's. The first two rows are what the doctor did; the rest are the reviewers' verdicts.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">What</th><th scope="col">Count</th><th scope="col">Of which set</th></tr></thead><tbody>${[
    row('Judged a real fix', `${s.judgedFix} of ${s.cases}`, 'held'),
    row('Closed by a rule, with no model session', `${s.ruled} of ${s.cases}`, 'held'),
    row('Diagnosis right', `${s.diagnosis.right} of ${verdicts} verdicts`, 'held'),
    row('Diagnosis partly right', `${s.diagnosis.partly} of ${verdicts} verdicts`, 'held'),
    row('Diagnosis wrong', `${s.diagnosis.wrong} of ${verdicts} verdicts`, 'held'),
    row('No patch, and rightly so', `${s.patch['none-right']} of ${verdicts} verdicts`, 'held'),
    row('No patch, but a fix was missed', `${s.patch['none-missed']} of ${verdicts} verdicts`, 'held'),
    row('Diagnosis right', `${e.diagnosis.right} of ${e.judgments} judgments`, 'earlier'),
    row('Diagnosis partly right', `${e.diagnosis.partly} of ${e.judgments} judgments`, 'earlier'),
    row('Diagnosis wrong', `${e.diagnosis.wrong} of ${e.judgments} judgments`, 'earlier'),
    row('Patch judged a fix', `${e.patch.fixes} of ${e.judgments} judgments`, 'earlier'),
    row('Patch judged wrong', `${e.patch.wrong} of ${e.judgments} judgments`, 'earlier'),
  ].join('')}</tbody></table></div><p class="lab-source">Two sets, never added together. The held-out nine are the test: frozen before any doctor run, judged by two reviewer rounds. The earlier set is ${e.runsOfTheDoctor} runs of the doctor over ${e.builds} earlier red builds, judged once each; it is where the diagnosis figures in our own notes come from, and its one judged fix is there and not on the held-out set.</p>` });
}

export function renderRuns(record) {
  const h = record.heldOut;
  const rows = h.runs.map(r => `<tr><th scope="row"><code>${escape(r.label)}</code></th><td>${escape(r.event.replaceAll('_', ' '))}</td><td>${escape(r.how)}</td><td>${pair(r.reviewers.causeClass)}</td><td>${pair(r.reviewers.diagnosis)}</td><td>${pair(r.reviewers.patch)}</td><td>${r.judgedFix ? 'yes' : 'no'}</td></tr>`).join('');
  return `<p>The nine newest red runs in a window of ${escape(String(Math.round((Date.parse(h.until) - Date.parse(h.since)) / 3600000)))} hours, one per workflow and branch, all from ${h.repos === 1 ? 'one private repository' : `${h.repos} private repositories`}, frozen on ${time(h.frozen.slice(0, 10))} before the doctor ran on any of them. A run is named by a keyed hash, not its id: the repository is private, and so are its runs.</p>${box('judge', { cls: 'red-runs', id: 'runs', body: `<div class="lab-table-wrap"><table><thead><tr><th scope="col">Run</th><th scope="col">What started it</th><th scope="col">What the doctor did</th><th scope="col">The cause, as the reviewers saw it</th><th scope="col">The diagnosis</th><th scope="col">The patch</th><th scope="col">A real fix</th></tr></thead><tbody>${rows}</tbody></table></div><p class="lab-source">Where the two reviewers differ, both are shown, the first round's first.</p>` })}`;
}

/** What "Why nothing was fixed" says, counted from the runs; whyProblems refuses a record that would contradict it. */
export function why(record) {
  const runs = record.heldOut.runs;
  const code = runs.filter(r => r.cls === 'code_bug');
  return {
    byClass: record.heldOut.score.byClass,
    ruled: runs.filter(r => r.how === 'no patch by rule'),
    code,
    reproduced: code.filter(r => r.reproduced),
    notReproduced: code.filter(r => !r.reproduced && /did not reproduce/.test(r.how)),
    missed: runs.filter(r => r.reviewers.patch.includes('none-missed')),
  };
}

function whyProblems(record, where) {
  const y = why(record), problems = [];
  if (y.ruled.some(r => r.reviewers.patch.some(p => p !== 'none-right'))) problems.push(`${where}#/heldOut/runs: the page says the reviewers agreed "no patch" was right on every run the rule closed`);
  if (y.reproduced.length !== 1 || y.reproduced[0].passes) problems.push(`${where}#/heldOut/runs: the page says one code bug failed again here and no fix for it passed`);
  if (y.notReproduced.length + y.reproduced.length !== y.code.length) problems.push(`${where}#/heldOut/runs: the page says every other code bug passed when run again`);
  if (y.missed.some(r => r.cls !== 'code_bug')) problems.push(`${where}#/heldOut/runs: the page says every missed fix is one of the code bugs`);
  return problems;
}

export function renderWhy(record) {
  const y = why(record), c = y.byClass;
  return `<p>Most of these builds had nothing in them to fix. By the reviewers' classes, ${c.red_by_design} were red by design: a gate doing its job, such as one that refuses a change only a person may land. ${c.config_env} had its cause outside the repository. A rule closes such runs before any model is asked; it closed ${y.ruled.length}, and on all ${y.ruled.length} both reviewers said "no patch" was right.</p><p>That leaves ${y.code.length} code bugs, the most this set could have had fixed. ${y.reproduced.length === 1 ? 'Only one of them' : `${y.reproduced.length} of them`} failed again on our own machine, so only that one could be worked on and checked: ${escape(y.reproduced[0]?.how ?? '')}. The other ${y.notReproduced.length} passed when run again, so no patch could be shown to work either way. Every "a fix was missed" above is one of these ${y.code.length}.</p><p>So the honest reading is narrow: on this set the rule's ${y.ruled.length} closures were all judged right, and the doctor fixed nothing.</p>`;
}

export function renderCheck(record) {
  const v = record.vendored, mc = v.mainCheck;
  const cites = v.cites.map(c => `<li>${escape(cap(c.what))}, ${time(c.at.slice(0, 10))}. ${cite(c, mc)}</li>`).join('');
  const files = v.files.map(f => `<li>${escape(cap(f.what))}: <code>${escape(f.sha256)}</code></li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${RED_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}. ${cite(v, mc)}</p>${box('summary', { cls: 'red-recount', id: 'recount', body: `<h3>A recount, not a re-score</h3><p>The scorer's own inputs, the key that unblinds each case and the doctor's raw answers, stayed on the machine that ran it, by design, and are not in the repository. What is there is each reviewer's verdict and the score they gave. The record carries both, and this site's build counts the verdicts and refuses to publish unless they give the score, field by field. So the score is checked here; the doctor's runs are not re-run.</p>` })}<h3 class="lab-subhead">The commits it stands on</h3><ul class="rogue-list">${cites}</ul><h3 class="lab-subhead">The files, by sha256</h3><ul class="rogue-list rogue-hashes">${files}</ul><p class="lab-source">Main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p>`;
}

export function renderBoundary() {
  return `<ul class="rogue-list"><li>Nine builds from one repository, over one afternoon. It does not say how the doctor would do on another codebase, or on more code bugs.</li><li>The reviewers are AI, not people. Each judged one case alone, but neither verdict was checked by a person here.</li><li>The page does not name the builds, the repository or the checks, so a reader cannot look them up. Someone with access to the private repository can.</li><li>The doctor's own runs are not re-run here, only counted.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderRedBuild(root = 'site', { now = new Date() } = {}) {
  const record = readRedBuild(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, RED_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--RED_INTRO-->': renderIntro(record), '<!--RED_NUMBERS-->': renderNumbers(record), '<!--RED_RUNS-->': renderRuns(record), '<!--RED_WHY-->': renderWhy(record), '<!--RED_CHECK-->': renderCheck(record), '<!--RED_BOUNDARY-->': renderBoundary() })) {
    if (!html.includes(marker)) throw new Error(`${RED_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${RED_TEMPLATE}: unresolved content marker`);
  const v = record.vendored;
  const leaks = pageLeaks(html, recordHashes(record), { onMain: [v.commit, v.mainCheck.main, ...v.mainCheck.commits] });
  if (leaks.length) throw new Error(`${RED_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [RED_TEMPLATE]: html } };
}
