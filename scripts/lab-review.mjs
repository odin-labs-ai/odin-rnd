// Lab 06, "Which model should review your code?" (vision-plan bundle 1, WO-03). scripts/labs.mjs calls renderReview()
// and writes, into dist/ only (nothing rendered is committed):
//   labs/review/index.html   the lab page, from site/labs/review/index.html (<!--REVIEW_*--> markers)
// The record is site/data/labs/review/record.json (odin-lab-review v1, scripts/schemas/odin-lab-review.schema.json),
// pinned by site/data/labs/review/record.sha256 and written by scripts/vendor-review.mjs. Every source is public, in this
// repository: three experiment records, each cited by the commit that last wrote it and by its sha256, and the bodies of
// this site's own merged pull requests, where the review receipts are.
//
// What may be shown, and how, is fixed here:
//   - EXP 017 (review-frontier) and EXP 006 (nina-changes): only numbers the build re-derives, at every build, from the
//     committed experiment records (whose bytes must be the cited ones); CI also re-runs each experiment's own --check
//     (scripts/lab-review.test.mjs), which recomputes those records from the experiment's committed runs;
//   - EXP 012 (self-verify): its committed record holds counts only, not the reviews, so the page shows it inside a box
//     marked "Summary only, not reproducible here";
//   - no money figure: EXP 017 measured price per review too; the page states its decision in words and points to the
//     experiment's record for the figures;
//   - the 60 changes each experiment reviews were written or seeded by us: boxed as authored fixtures;
//   - the findings gallery quotes the PR bodies word for word (vendor-review.mjs --verify re-reads them), and is boxed as
//     verdicts of a separate AI reviewer, not a human.
// The build refuses the record, every reason listed, when it is not the pinned bytes, misses the schema, fails the
// screen, cites a source whose committed bytes are not the cited ones, states a number those bytes do not give, or quotes
// a pull request outside the receipt list or a receipt with no FIX-NEEDED in it. The rendered page is screened as a whole.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, escape, pageLeaks, readPinned, recordHashes, screenRecord, sha256, sidecarPinProblems, validate } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REVIEW_RECORD = 'data/labs/review/record.json';
export const REVIEW_PIN = 'data/labs/review/record.sha256';
export const REVIEW_TEMPLATE = 'labs/review/index.html';
export const REVIEW_SCHEMA = join(here, 'schemas/odin-lab-review.schema.json');
const REPO = 'https://github.com/odin-labs-ai/odin-rnd';
const REPO_ROOT = join(here, '..');

// The pull requests whose bodies carry this site's review receipts (and no others).
export const RECEIPT_PRS = [84, 82, 80, 62, 58, 56, 54, 53, 52, 50, 45, 27];
// The receipt passage quoted from each pull request's description (verbatim: scripts/vendor-review.mjs checks it against the description; the build checks the record holds exactly it).
export const RECEIPTS = {
  84: ['2 recorded review rounds (FIX-NEEDED on 5962cca, SHIP on a3c3cda), 8 CI runs, landed 30fd41f'],
  82: ['Review round 1 (FIX-NEEDED 5f3ca4ce) was fixed in f48471c; the recheck (07ead9cc) confirmed finding 3 fixed. Findings 1, 2 and 4 are fixed in ff02879: the directive, symbol and advice holds cover 1 and 2, and the narrowed provenance claim covers 4.'],
  80: ['21 recorded review rounds (12 FIX-NEEDED, 9 SHIP; verdict + head sha + row id only, never review text)'],
  62: ['Review row f6bf03aa (FIX-NEEDED) is addressed in the follow-up commit, item by item; see the commit message.'],
  58: ['Review row c6c46629 (FIX-NEEDED) is addressed in 076f75e, item by item; see the commit message.'],
  52: ["FIX-NEEDED — one-pager's Laya-vs-Jev claim was internally inconsistent (48/48 identical decisions alongside a 14.6pp accuracy gap).", 'real figures are 37/48 (77.1%) decision agreement, 81.3% vs 95.8% accuracy'],
  45: ['Review: FIX-NEEDED on 215cfe2 (rnd-pr45-refute-1) → fixed in ca048cd; bounded recheck (rnd-pr45-refute-2) on ca048cd: F3–F5 FIXED, F1/F2 NOT-FIXED on remaining wording + this description → fixed in 2172aa4 and here.'],
  27: ['Independent review: r1–r3 FIX-NEEDED fixed forward; r4 SHIP on the same patch'],
};
// Their descriptions name the review step in the landing plan only: no FIX-NEEDED of their own.
export const PLAN_ONLY = [56, 54, 53, 50];

// Each source the record is built from: the file, in this repository, and what it is.
export const SOURCES = {
  frontier: { file: 'experiments/review-frontier/results.json', what: 'EXP 017, the results record its frozen analysis writes' },
  nina: { file: 'experiments/nina-changes/results/results.json', what: 'EXP 006, the results record its frozen scorer writes' },
  'self-verify': { file: 'experiments/self-verify/results.json', what: 'EXP 012, its results record (counts only)' },
};
// The models EXP 017 names, in plain words (a model id is a path-shaped string the screen refuses).
export const SEAT_NAMES = { flash: 'MiniMax M3.1 Flash', 'gpt-oss': 'gpt-oss 120B', sonnet: 'Claude Sonnet 5.5', opus: 'Claude Opus 5.5' };

/** EXP 017's figures this page shows, from its results record: no price, no time. */
export function deriveFrontier(r) {
  return {
    experiment: r.experiment,
    seats: r.seats.map(s => ({ seat: s.seat, name: SEAT_NAMES[s.seat], caught: s.caught, caughtOf: s.caughtOf, caughtPerRun: s.caughtPerRun, falseAlarms: s.falseAlarms, falseAlarmsOf: s.falseAlarmsOf, falseAlarmsPerRun: s.falseAlarmsPerRun, noVerdict: s.noVerdict, runs: s.runsComplete })),
    onFrontier: r.decision.onFrontier, offFrontier: r.decision.offFrontier,
  };
}

/** EXP 006's figures: the spotlight bar's four criteria, the manipulation check and its verdict. */
export function deriveNina(r) {
  const c = Object.fromEntries(r.spotlight.criteria.map(x => [x.id, x]));
  return {
    experiment: r.experiment, verdict: r.spotlight.verdict, manipulation: r.manipulation.state,
    countedRuns: r.manipulation.countedRuns, blindRuns: r.manipulation.blind, maxBlindRuns: r.manipulation.maxBlindRuns,
    missedDrift: { x: c['missed-drift'].runLevel.x, n: c['missed-drift'].runLevel.n, holds: c['missed-drift'].holds },
    falseReject: { x: c['false-reject'].runLevel.x, n: c['false-reject'].runLevel.n, holds: c['false-reject'].holds },
    selfAgreement: { x: c['self-agreement'].x, n: c['self-agreement'].n, holds: c['self-agreement'].holds },
    harnessFailures: { x: c['zero-patches'].harnessFailures.x, n: c['zero-patches'].harnessFailures.n, holds: c['zero-patches'].holds },
  };
}

/** EXP 012's two counted runs of review-then-verify, as its record states them. */
export function deriveSelfVerify(r) {
  return { experiment: r.experiment, decision: r.decision, runs: ['A1-a', 'A1-b'].map(id => ({ id, caught: r.arms[id].caught, falseAlarms: r.arms[id].falseAlarms, of: 30 })) };
}
const DERIVE = { frontier: deriveFrontier, nina: deriveNina, 'self-verify': deriveSelfVerify };
const KEY = { frontier: 'frontier', nina: 'nina', 'self-verify': 'selfVerify' };

/** Every reason the record may not be published (empty when it may). `read(file)` gives a source's committed bytes. */
export function reviewProblems(record, { where = REVIEW_RECORD, read = file => readFileSync(join(REPO_ROOT, file)) } = {}) {
  const problems = validate(JSON.parse(readFileSync(REVIEW_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-review v1)`);
  if (problems.length) return problems;
  // A source's file is a path in this repository, checked against SOURCES below; every other string is page text.
  problems.push(...screenRecord({ ...record, sources: record.sources.map(({ file, ...rest }) => rest) }, where));
  // Each source: its committed bytes are the cited ones, and every figure shown is what those bytes give.
  const roles = record.sources.map(s => s.role);
  if (JSON.stringify(roles) !== JSON.stringify(Object.keys(SOURCES))) problems.push(`${where}#/sources: one per source, in order (${Object.keys(SOURCES).join(', ')})`);
  for (const [i, s] of record.sources.entries()) {
    const want = SOURCES[s.role];
    if (!want) continue;
    if (s.file !== want.file) problems.push(`${where}#/sources/${i}/file: not ${want.file}`);
    let bytes = null;
    try { bytes = read(want.file); } catch { problems.push(`${want.file}: missing`); continue; }
    if (sha256(bytes) !== s.sha256) { problems.push(`${where}#/sources/${i}/sha256: ${want.file} is now ${sha256(bytes)}; re-vendor with scripts/vendor-review.mjs`); continue; }
    const derived = DERIVE[s.role](JSON.parse(bytes));
    if (JSON.stringify(derived) !== JSON.stringify(record[KEY[s.role]])) problems.push(`${where}#/${KEY[s.role]}: not what ${want.file} gives`);
  }
  const f = record.frontier;
  if (f.seats.some(s => !s.name)) problems.push(`${where}#/frontier/seats: a model this page has no plain name for`);
  // The gallery: receipts from the listed PRs only, each a FIX-NEEDED verdict, each PR once.
  const seen = new Set();
  for (const [i, g] of record.gallery.entries()) {
    const at = `${where}#/gallery/${i}`;
    if (!RECEIPT_PRS.includes(g.pr)) problems.push(`${at}/pr: #${g.pr} is not one of this site's receipt pull requests`);
    if (seen.has(g.pr)) problems.push(`${at}/pr: #${g.pr} is listed twice`);
    seen.add(g.pr);
    if (!g.receipt.some(part => /FIX-NEEDED/.test(part))) problems.push(`${at}/receipt: not a FIX-NEEDED receipt`);
    else if (JSON.stringify(g.receipt) !== JSON.stringify(RECEIPTS[g.pr])) problems.push(`${at}/receipt: not the passage chosen for #${g.pr} (RECEIPTS), which the vendor checks word for word`);
  }
  if (JSON.stringify(record.planOnly) !== JSON.stringify(PLAN_ONLY)) problems.push(`${where}#/planOnly: not ${PLAN_ONLY.join(', ')}`);
  for (const n of record.planOnly) {
    if (!RECEIPT_PRS.includes(n)) problems.push(`${where}#/planOnly: #${n} is not one of this site's receipt pull requests`);
    if (seen.has(n)) problems.push(`${where}#/planOnly: #${n} is in the gallery too`);
    seen.add(n);
  }
  if (seen.size !== RECEIPT_PRS.length) problems.push(`${where}#/gallery: every receipt pull request is in the gallery or listed as naming its review plan only`);
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readReview(root = 'site', options = {}) {
  return readPinned({ root, file: REVIEW_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: REVIEW_PIN, file: REVIEW_RECORD, vendor: 'scripts/vendor-review.mjs' }), check: record => reviewProblems(record, options), refused: 'Lab 06 record refused' });
}

/** The plain reading of EXP 017's table, computed from it, so the words cannot drift from the counts. */
export function frontierReading(f) {
  const caught = f.seats.map(x => x.caught), fa = [...f.seats].sort((a, b) => a.falseAlarms - b.falseAlarms);
  const runGap = Math.max(...f.seats.map(x => Math.max(...x.caughtPerRun) - Math.min(...x.caughtPerRun)));
  const silent = f.seats.filter(x => x.noVerdict > 0);
  return `The models caught between ${escape(Math.min(...caught))} and ${escape(Math.max(...caught))} of 60, a spread of ${escape(Math.max(...caught) - Math.min(...caught))}, while one model's two runs differed by up to ${escape(runGap)}: on catches, none is clearly ahead. False alarms spread wider: ${escape(fa[0].name)} flagged fewest clean changes (${escape(fa[0].falseAlarms)}), ${escape(fa.at(-1).name)} the most (${escape(fa.at(-1).falseAlarms)}).${silent.length ? ` ${silent.map(x => `${escape(x.name)} gave no verdict ${escape(x.noVerdict)} times`).join('; ')}, each counted as a miss or a false alarm.` : ''}`;
}

const commitLink = s => `<a href="${REPO}/commit/${escape(s.commit)}"><code>${escape(s.commit.slice(0, 8))}</code></a>`;
const fileLink = s => `<a href="${REPO}/blob/main/${escape(s.file)}">the experiment's record</a>`;
const of = (x, n) => `${escape(x)} of ${escape(n)}`;
const names = (record, seats) => seats.map(id => escape(SEAT_NAMES[id])).join(', ');
const source = (record, role) => record.sources.find(s => s.role === role);

export function renderIntro() {
  return `<span class="technical">LAB 06 · WHICH MODEL SHOULD REVIEW YOUR CODE?</span><h1 id="lab-title">Which model should review your code?</h1><p class="company-lead">We gave four models the same 60 changes to review, twice each, and counted what they caught and what they flagged that was fine. We measured a second reviewer on 60 more changes, and a third set-up that reviews and then checks its own findings. And on this site's own pull requests, an AI reviewer has to say SHIP before anything lands: below are the times it said no.</p>`;
}

export function renderFrontier(record) {
  const f = record.frontier, s = source(record, 'frontier');
  const rows = f.seats.map(x => `<tr><th scope="row">${escape(x.name)}</th><td><strong>${of(x.caught, x.caughtOf)}</strong> (${x.caughtPerRun.map(escape).join(' and ')})</td><td>${of(x.falseAlarms, x.falseAlarmsOf)} (${x.falseAlarmsPerRun.map(escape).join(' and ')})</td><td>${escape(x.noVerdict)}</td><td>${f.onFrontier.includes(x.seat) ? 'on' : 'off'}</td></tr>`).join('');
  const corpus = box('fixture', { cls: 'review-fixture', body: '<p>The 60 cases are 58 changes from our own private repositories: 30 with a defect we planted, 30 clean. The changes are not published; their sealed hashes are. Every model got the same prompt, one request per change, no tools and no file access.</p>' });
  return `<p>The question: per model, how many of 30 planted defects does a review catch, and how many of 30 clean changes does it flag anyway? Each model reviewed all 60 twice, so each count is of 60.</p>${corpus}<div class="lab-table-wrap"><table><thead><tr><th scope="col">Model</th><th scope="col">Defects caught, of 60 (each run)</th><th scope="col">Clean changes flagged, of 60 (each run)</th><th scope="col">No verdict</th><th scope="col">On the frontier</th></tr></thead><tbody>${rows}</tbody></table></div><p>${frontierReading(f)}</p><p><strong>The decision the experiment registered</strong> weighs catches against what one review costs. A model is on the frontier when no other model catches at least as many defects for no more per review. On it: ${names(record, f.onFrontier)}. Off it: ${names(record, f.offFrontier)}, because another model caught at least as many for no more per review. The price of a review is in ${fileLink(s)}, not on this page; this site does not show money figures.</p><p class="lab-source">From ${escape(f.experiment)}'s results record, last written by commit ${commitLink(s)}, sha256 <code>${escape(s.sha256)}</code>. Re-derived from that record at every build of this page; in CI, the experiment's own frozen analysis, run in its check mode, recomputes the record from the committed runs and must find it unchanged.</p>`;
}

export function renderNina(record) {
  const n = record.nina, s = source(record, 'nina');
  const corpus = box('fixture', { cls: 'review-fixture', body: '<p>The 60 changes are authored: we wrote each one to keep to, or break, a set of architecture rules, so the right answer is known for every one.</p>' });
  return `<p>A different question: does a reviewer that runs as a tool, nina, reject the changes that break the rules and accept the ones that keep them? ${escape(n.countedRuns / 60)} runs per change, ${escape(n.countedRuns)} runs. A run counts only when its own tool calls show it read the change; an earlier measurement had found its reviewer auditing the unchanged code instead.</p>${corpus}<ul class="rogue-list"><li>Rule-breaking changes it accepted: <strong>${of(n.missedDrift.x, n.missedDrift.n)}</strong> runs.</li><li>Good changes it rejected: <strong>${of(n.falseReject.x, n.falseReject.n)}</strong> runs.</li><li>Changes given the same verdict in every one of their runs: <strong>${of(n.selfAgreement.x, n.selfAgreement.n)}</strong>.</li><li>Runs where the harness failed: ${of(n.harnessFailures.x, n.harnessFailures.n)}. Runs that never saw the change: ${of(n.blindRuns, n.countedRuns)} (the bar allowed at most ${escape(n.maxBlindRuns)}).</li></ul><p>Verdict on the registered bar: <strong>${n.verdict === 'PASS' ? 'met' : 'not met'}</strong>; the check that it read the changes: <strong>${n.manipulation === 'PASS' ? 'passed' : 'failed'}</strong>. These are rule-checking changes in one codebase, not the planted bugs above; the two are not one league table.</p><p class="lab-source">From ${escape(n.experiment)}'s results record, last written by commit ${commitLink(s)}, sha256 <code>${escape(s.sha256)}</code>. Re-derived at every build; in CI, the experiment's own frozen scorer, run in its check mode, recomputes the record from the committed run and must match it byte for byte.</p>`;
}

export function renderSelfVerify(record) {
  const v = record.selfVerify, s = source(record, 'self-verify');
  const runs = v.runs.map(r => `<li>Run ${escape(r.id.slice(-1))}: caught <strong>${of(r.caught, r.of)}</strong> defects, flagged <strong>${of(r.falseAlarms, r.of)}</strong> clean changes.</li>`).join('');
  return box('summary', { cls: 'review-summary', id: 'self-verify-summary', body: `<h3>Can a reviewer talk itself out of its false alarms?</h3><p>${escape(v.experiment)} had one model review each change and then check its own findings, to drop the wrong ones. It did not work: the decision registered beforehand was <strong>${v.decision === 'no' ? 'no' : escape(v.decision)}</strong>.</p><ul class="rogue-list">${runs}</ul><p>This is a summary. The experiment's committed record holds these counts, not the reviews they come from, so this page, and anyone reading this repository, cannot re-run them. From ${escape(v.experiment)}'s results record, commit ${commitLink(s)}, sha256 <code>${escape(s.sha256)}</code>.</p>` });
}

export function renderGallery(record) {
  const cards = record.gallery.map(g => `<article class="lab-panel review-receipt" id="receipt-${escape(g.pr)}"><p class="technical">PULL REQUEST #${escape(g.pr)}</p><h4><a href="${REPO}/pull/${escape(g.pr)}">${escape(g.title)}</a></h4><blockquote><p>${g.receipt.map(escape).join(' … ')}</p></blockquote><p class="lab-source">Quoted word for word from the pull request's description${g.receipt.length > 1 ? ', in parts' : ''}. Merged as commit ${commitLink({ commit: g.mergeCommit })}.</p></article>`).join('');
  const plan = record.planOnly.map(n => `<a href="${REPO}/pull/${escape(n)}">#${escape(n)}</a>`).join(', ');
  return `<p>Nothing lands on this site until an AI reviewer, run apart from the agent that wrote the change, answers SHIP. When it answers FIX-NEEDED, the change is fixed and reviewed again. Here are the FIX-NEEDED receipts the pull requests themselves record.</p>${box('judge', { cls: 'review-judge', id: 'receipts', body: `<p>Every verdict below is a separate AI reviewer's, not a human's. A FIX-NEEDED is what it asked for, not proof that the code was wrong.</p><div class="rogue-acts">${cards}</div>` })}<p>Four more pull requests, ${plan}, name the review step in their landing plan but record no FIX-NEEDED of their own, so they are not shown as catches.</p>`;
}

export function renderBoundary() {
  return `<ul class="rogue-list"><li>Each experiment is one corpus, one prompt, one moment. A model's next version, or a different prompt, can change the counts.</li><li>The planted defects and the authored changes were written by us. They are not a sample of real bugs.</li><li>The review experiments measure catches and false alarms, not whether a team would act on a finding.</li><li>The receipts are the reviewer's verdicts as the pull requests record them; this page does not re-judge them.</li></ul>`;
}

/** Every short commit and row id a receipt quotes: public text, so the page screen may let it through. */
export const receiptTokens = record => record.gallery.flatMap(g => [...g.receipt.join(' ').matchAll(/\b[0-9a-f]{7,40}\b/g)].map(m => m[0]));

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderReview(root = 'site', options = {}) {
  const record = readReview(root, options);
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, REVIEW_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--REVIEW_INTRO-->': renderIntro(), '<!--REVIEW_FRONTIER-->': renderFrontier(record), '<!--REVIEW_NINA-->': renderNina(record), '<!--REVIEW_SELF_VERIFY-->': renderSelfVerify(record), '<!--REVIEW_GALLERY-->': renderGallery(record), '<!--REVIEW_BOUNDARY-->': renderBoundary() })) {
    if (!html.includes(marker)) throw new Error(`${REVIEW_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${REVIEW_TEMPLATE}: unresolved content marker`);
  const known = [...recordHashes(record), ...receiptTokens(record)];
  const leaks = pageLeaks(html, known);
  if (leaks.length) throw new Error(`${REVIEW_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [REVIEW_TEMPLATE]: html } };
}
