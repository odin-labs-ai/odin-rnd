// Renders the measured EXP 005 results onto the public pages: station 06, the featured row on the home page,
// the field note's results section, and the note's spotlight section. nina's featured card appears only when
// amendment 01's bar was met AND the committed spotlight decision says, explicitly, that it is not held. Every figure is read from the committed results record, which is
// first recomputed from the committed gate runs by the frozen experiments/jev-gate/results.mjs and must match,
// or from the other committed records, each read or recomputed here. The pre-registration's own text and pages
// are not edited; the build adds these beside them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPublishable, computeResults, loadRecords } from '../experiments/jev-gate/results.mjs';
import { renderRunnerPins } from '../experiments/jev-gate/runner-guard.mjs';
import { classify } from '../experiments/jev-gate/diff-visibility.mjs';
import { publishedParentSha256 } from './jev-gate-amendment.mjs';
import { amendment01Sha256 } from './jev-gate-amendment-02.mjs';
import { ninaAttribution } from './jev-gate-prereg.mjs';
import { replaceHead } from './page-head.mjs';

const dir = 'experiments/jev-gate';
export const resultsDir = `${dir}/results`;
export const resultsPath = `${resultsDir}/results.json`;
export const diffVisibilityPath = `${resultsDir}/diff-visibility.json`;
export const publishedResultsPath = 'site/data/jev-gate/results.json';
export const resultsDataPath = 'data/jev-gate/results.json';
export const resultsSectionId = 'results';
export const harnessSectionId = 'spotlight';
export const spotlightDecisionPath = `${resultsDir}/spotlight-decision.json`;
const notePath = 'journal/jev-as-a-fast-gate.html';
// Upstream changes to nina, opened by Odin Labs while this experiment was being set up. They are references, not
// measured properties: neither is in the pinned 0.34.0 release the reviewer ran (checked on GitHub, 2026-09-29).
export const upstream = [
  { number: 39, url: 'https://github.com/xhulz/nina/pull/39', title: 'Print the usage for a command asked with --help, and run nothing', state: 'merged upstream on 28 Sep 2026' },
  { number: 41, url: 'https://github.com/xhulz/nina/pull/41', title: "Keep eval's reviewer from reading outside the staged project", state: 'open' },
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)} ${months[Number(m) - 1]} ${y}`; };
const pct = v => `${(v * 100).toFixed(1)}%`;
export const rate = r => `${r.x} of ${r.n} (${pct(r.estimate)})`;
// The confidence level is the pre-registration's (statistics.confidenceLevel), never typed here.
const confidence = `${Math.round(JSON.parse(readFileSync('experiments/jev-gate/preregistration.json', 'utf8')).statistics.confidenceLevel * 100)}%`;
export const interval = r => `${confidence} interval ${pct(r.lower)}–${pct(r.upper)}`;
const usd = (v, places = 4) => `$${v.toFixed(places)}`;
const secs = ms => `${(ms / 1000).toFixed(1)} s`;
const units = v => Math.round(Number((v * 1e7).toFixed(3)));
// A refused command was compound or a redirection only if it holds a real shell operator; the scrubbed placeholders
// (<ws>, <tmp>, <homebrew>) are not operators.
export const isCompound = cmd => /[;|&<>]/.test(cmd.replace(/<(ws|tmp|homebrew)>/g, ''));
// The runs the rule does not place, said exactly as the record has them.
export const unplacedClause = d => `${d.seen.runs} say they saw it; the other ${d.unclear.runs} are left unclassified, and ${d.unclearSaysNotSeen === 0 ? 'none of them says' : `${d.unclearSaysNotSeen} of them say`} it did not see the diff`;
const stateClass = state => (state === 'refuted' ? 'verdict-red' : state === 'passes' ? 'verdict-green' : 'verdict-amber');

// The one pinned runner file whose LIVE bytes may differ from the code the measured run recorded. This file (and the
// build) imports the live runner-guard.mjs, so for it alone scoring is not under the recorded code: its later changes
// (the Linux find fix, EXP 006's additive pre-flight parameters) touch no scoring path, and this allowlist plus its
// tests keep every other pinned file — results.mjs, metrics.mjs, the runners — exactly as the run recorded it.
export const LIVE_CODE_MAY_DIFFER = ['experiments/jev-gate/runner-guard.mjs'];

/** Refuses unless the live runners.sha256 and the run's recorded pins differ only in the allowlisted lines. */
export function assertLiveCodeAllowed(live, recorded) {
  const lines = code => renderRunnerPins(code).split('\n').filter(Boolean);
  const got = lines(live), want = lines(recorded);
  assert.equal(got.length, want.length, 'the live runner pins list other files than the run recorded');
  const differ = got.map((line, i) => (line === want[i] ? null : { live: line, recorded: want[i] })).filter(Boolean);
  for (const d of differ) {
    const [, path] = d.live.split('  '), [, recordedPath] = d.recorded.split('  ');
    assert.ok(path === recordedPath && LIVE_CODE_MAY_DIFFER.includes(path), `the live runner code differs from the run's recorded code in ${recordedPath === path ? path : `${recordedPath} / ${path}`}, which only ${LIVE_CODE_MAY_DIFFER.join(', ')} may`);
  }
  return differ.map(d => d.live.split('  ')[1]);
}

// The committed results record, recomputed from the committed runs and checked; null while none is committed.
export function checkResults(root = '.') {
  if (!existsSync(join(root, resultsPath))) return null;
  const bytes = readFileSync(join(root, resultsPath));
  const results = assertPublishable(JSON.parse(bytes));
  assert.equal(results.parentSha256, publishedParentSha256, 'The results were scored against another pre-registration');
  assert.equal(results.amendmentSha256, amendment01Sha256, 'The results were scored against another amendment 01');
  assert.equal(results.partial, null, 'A partial run decides nothing and is not rendered as a result');
  const runs = { jev: json(root, `${resultsDir}/jev.json`), laya: json(root, `${resultsDir}/laya.json`), reviewer: json(root, `${resultsDir}/reviewer.json`) };
  const preflight = json(root, `${resultsDir}/preflight.json`);
  // The measured run was made by the runner code recorded in each run's `code`, which is bound to the committed
  // pre-flight record (the frozen results.mjs re-checks runnersSha256 against it). A dated post-measurement change —
  // the Linux portability fix to the pre-flight classifier in runner-guard.mjs (see the README) — altered that
  // pinned file and re-pinned runners.sha256, so the LIVE pins now differ from the run's. The measurement is frozen,
  // so score under the code the RUN recorded, not the live file; results.json then recomputes byte-identically.
  // This is a no-op on a checkout whose runner code still equals the run's (all three runs must agree on it).
  const records = loadRecords();
  assert.deepEqual(runs.jev.code, runs.reviewer.code, 'the committed jev and reviewer runs disagree on the runner code');
  assert.deepEqual(runs.laya.code, runs.reviewer.code, 'the committed laya and reviewer runs disagree on the runner code');
  // The live pins may differ from the run's in runner-guard.mjs only (its one runners.sha256 line); anything else refuses.
  assertLiveCodeAllowed(records.stamp.code, runs.reviewer.code);
  const stamp = { ...records.stamp, code: runs.reviewer.code };
  assert.deepEqual(computeResults({ ...records, stamp, runs, preflight }), results, `${resultsPath} differs from what the frozen results.mjs computes from the committed runs`);
  const diffVisibility = json(root, diffVisibilityPath);
  assert.deepEqual(classify({ reviewer: runs.reviewer, labels: json(root, `${dir}/labels.json`) }), diffVisibility, `${diffVisibilityPath} differs from what experiments/jev-gate/diff-visibility.mjs computes`);
  // The founder's decision on the spotlight, a committed record naming these results by sha256. Without it, nothing is featured.
  const decision = existsSync(join(root, spotlightDecisionPath)) ? json(root, spotlightDecisionPath) : null;
  if (decision) {
    assert.equal(decision.kind, 'spotlight-decision');
    assert.equal(decision.resultsSha256, sha256(bytes), `${spotlightDecisionPath} was made on another results record`);
    assert.equal(typeof decision.held, 'boolean', `${spotlightDecisionPath} must say explicitly whether the spotlight is held`);
  }
  return { results, sha256: sha256(bytes), decision, facts: facts(root, results, runs, preflight, diffVisibility) };
}

// Figures the page states that live in the other committed records, each computed from them here.
export function facts(root, results, runs, preflight, diffVisibility) {
  const prereg = json(root, `${dir}/preregistration.json`);
  const a01 = json(root, `${dir}/amendment-01.json`), a02 = json(root, `${dir}/amendment-02.json`);
  const prerun = json(root, `${resultsDir}/prerun-matrix.json`);
  const teeth = json(root, `${dir}/teeth-report.json`);
  const reviewerCalls = runs.reviewer.calls;
  const ledger = readFileSync(join(root, `${dir}/spend-ledger.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  // The ledger counts from amendment 02's merge time, the results' notBefore; everything before is in amendment 02's figure.
  const since = ledger.filter(line => line.ts > results.notBefore && typeof line.costUsd === 'number');
  // As the runners' ledger does: sum the recorded costs, then round once to the 7th decimal.
  const sumUnits = lines => units(lines.reduce((s, line) => s + line.costUsd, 0));
  const totalUnits = units(a02.spend.alreadySpentUsd) + sumUnits(since);
  // Paid calls after amendment 02's merge and before the counted run, other than the pre-run matrix (inside its own record's window).
  const preCounted = since.filter(line => line.kind !== 'counted' && !(line.ts >= prerun.startedAt && line.ts <= prerun.endedAt));
  const count = pred => preCounted.filter(pred).length;
  const deniedCommands = reviewerCalls.flatMap(c => (c.permissionDenials ?? []).map(d => String(d.input?.command ?? d.tool_input?.command ?? '').trim()));
  const forms = Object.entries(deniedCommands.map(cmd => cmd.split(/\s+/).slice(0, 2).join(' ')).reduce((m, form) => ({ ...m, [form]: (m[form] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const denyRead = runs.reviewer.pins.settings.sandbox.filesystem.denyRead;
  const ended = [runs.jev, runs.laya, runs.reviewer].map(r => r.endedAt).sort().at(-1);
  const best = prereg.bestBaseline.id;
  const dv = diffVisibility.summary;
  return {
    measuredOn: ended.slice(0, 10),
    reviewerRuns: reviewerCalls.length,
    gitToolDenials: reviewerCalls.reduce((s, c) => s + (c.gitToolDenials ?? 0), 0),
    harnessCheckDenied: reviewerCalls.filter(c => JSON.stringify(c.permissionDenials ?? []).includes('harness:check')).length,
    harnessCheckMentioned: reviewerCalls.filter(c => (c.result ?? '').includes('harness:check')).length,
    deniedForms: forms.slice(0, 3),
    deniedCompound: deniedCommands.filter(isCompound).length,
    deniedTotal: deniedCommands.length,
    diff: { blind: dv['diff-blind'], seen: dv['diff-seen'], unclear: dv.unclear, runs: diffVisibility.runsTotal, items: diffVisibility.items, allCorrect: diffVisibility.runs.every(r => r.correct),
      // Whether any unclassified report says, even generically, that it did not see the diff.
      unclearSaysNotSeen: diffVisibility.runs.filter(r => r.class === 'unclear' && (r.saysDiffNotSeen || r.saysShellBlocked)).length },
    baseTree: { label: teeth.base.label, violations: teeth.base.violations },
    baseShas: [...new Set(reviewerCalls.map(c => c.baseSha))],
    spend: { previousUsd: a02.spend.alreadySpentUsd, sinceUsd: sumUnits(since) / 1e7, lines: since.length, totalUsd: totalUnits / 1e7, capUsd: prereg.spendCap.usd },
    preCounted: { calls: preCounted.length, matrices: count(l => l.kind === 'isolation-matrix'), reviewerPractice: count(l => l.gate === 'reviewer' && l.kind === 'practice'), jevPractice: count(l => l.gate === 'jev' && l.kind === 'practice'), usd: sumUnits(preCounted) / 1e7 },
    priorCalls: { amendment01: a01.priorCalls.calls.length, amendment02: a02.priorCalls.calls.length },
    preflight: { endedAt: preflight.endedAt, unreadable: preflight.skipped.reduce((s, x) => s + (x.unreadableBuckets ?? 0), 0), permissionSkipped: preflight.permissionSkipped, copies: preflight.copies.length,
      // Scanned roots the sandbox's denyRead does not cover (<tmp> is the scrubbed form of the temp roots it does cover).
      notDenied: preflight.scanned.filter(r => r !== '<tmp>' && !denyRead.some(d => r === d || r.startsWith(`${d}/`))) },
    prerun: { notBefore: prerun.notBefore, amendment02Sha256: prerun.amendment02Sha256, startedAt: prerun.startedAt, isolation: prerun.pins.isolation },
    best: { id: best, description: prereg.baselines.find(b => b.id === best)?.description, scope: prereg.bestBaseline.scope },
    commentOnly: { ids: prereg.commentOnlyRed.ids, words: prereg.commentOnlyRed.note.split('. ').find(s => /not architectural drift/.test(s)) },
    claimRule: prereg.claimRule,
    k: prereg.gates.reviewer.k,
    otherBaselines: prereg.baselines.map(b => b.id).filter(id => id !== best),
  };
}

// The one-paragraph headline: the claim's state and why, from the criteria.
export function headline({ results, facts: f }) {
  const refuted = results.criteria.filter(c => c.state === 'refuted');
  const jev = results.primary.gates.jev.missedDrift, base = results.primary.gates[f.best.id].missedDrift;
  if (!results.claim.refuted) return `The claim holds on this corpus: no criterion is refuted.`;
  const why = refuted.some(c => c.id === 'jev-vs-best-baseline')
    ? ` A linter written from the same rules (${f.best.id}) missed ${base.x} of ${base.n} drift items; Jev missed ${jev.x} of ${jev.n}. On rules a linter can express, a fast model gate added nothing that linter did not already catch.`
    : '';
  return `The claim is refuted${refuted.length ? `, by the criterion ${refuted.map(c => c.id).join(' and ')}` : ''}.${why}`;
}

// Beside the headline: how narrow the deciding difference is, and what the deciding item is.
export function headlineContext({ results, facts: f }) {
  const c = results.criteria.find(x => x.id === 'jev-vs-best-baseline');
  const missed = results.primary.gates.jev.missedIds;
  const comment = missed.filter(id => f.commentOnly.ids.includes(id));
  return `By ${missed.length === 1 ? 'one item' : `${missed.length} items`}: a difference of ${pct(c.interval.estimate)}, ${interval(c.interval)}.${comment.length ? ` Jev's ${missed.length === 1 ? 'only miss' : 'misses'}, ${comment.join(', ')}, ${comment.length === 1 ? 'is a comment-only RED item' : 'are comment-only RED items'}, which the pre-registration itself describes: "${f.commentOnly.words}."` : ''}`;
}

export const measuredStatus = ({ results }) => `Measured — ${results.claim.refuted ? 'claim refuted' : 'claim holds'}`;

// One criterion's figure, by kind.
export function criterionFigure(c) {
  if (c.kind === 'single-rate') return `${rate(c.interval)}, ${interval(c.interval)}`;
  if (c.kind === 'paired-difference') return `${rate(c.interval.first)} against ${rate(c.interval.second)}; difference ${pct(c.interval.estimate)}, ${interval(c.interval)}`;
  if (c.kind === 'point-ratio') return `${usd(c.cascadeMean)} against ${usd(c.reviewerMean)} per change, ratio ${c.ratio.toFixed(3)} (${c.basis})`;
  throw new Error(`Unknown criterion kind ${c.kind}`);
}
const criterionItem = c => `${escape(c.statement)} <strong class="${stateClass(c.state)}">${escape(c.state)}</strong> · ${escape(criterionFigure(c))}`;

// The diff-blind finding, in one sentence, from the classifier's committed output.
export function diffSentence({ facts: f }) {
  const d = f.diff;
  return `In ${d.blind.runs} of the ${d.runs} reviewer runs the reviewer never saw the change it was asked to review: this experiment's tool fence refused the git commands it tried to read it with, and the report says it did not see the diff. Of the other runs, ${unplacedClause(d)}. The cause was the fence, not nina. Every one of those runs was still decided correctly (${d.blind.correct} of ${d.blind.runs}), because the base tree has ${f.baseTree.violations} violations, so checking the whole working tree against the rules decides exactly what the label decides. For most runs, then, the reviewer audited a small repository against linter-shaped rules rather than reviewing a change.`;
}

// Station 06, measured.
export function renderMeasuredExhibit(data) {
  const { results, facts: f } = data, g = results.primary.gates;
  const row = (label, value, state = '') => `<div class="record-comparison ${state}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
  const spot = results.spotlight, md = spot.criteria.find(c => c.id === 'missed-drift');
  return `<p class="artifact-label">Measured ${escape(day(f.measuredOn))}, judged against the record as published</p><p class="station-implication">${escape(headline(data))} ${escape(headlineContext(data))}</p><div class="record-comparisons">${row('Jev · missed drift', rate(g.jev.missedDrift), g.jev.missedDrift.x > g[f.best.id].missedDrift.x ? 'rejected' : '')}${row(`Linter from the rules · ${f.best.id}`, rate(g[f.best.id].missedDrift), 'accepted')}${row('Jev · false reject', rate(g.jev.falseReject))}${row('Cascade · sent to the reviewer', rate(g.cascade.escalation))}${row(`Mean cost per change · ${results.meanCostPerChange.basis}`, `${usd(results.meanCostPerChange.cascade)} cascade · ${usd(results.meanCostPerChange.reviewerAlone)} reviewer alone`)}${row('LLM reviewer · spotlight bar, restricted setup', `${spot.verdict === 'PASS' ? 'bar met' : 'bar not met'}${spot.verdict === 'PASS' && !spotlightShown(data) ? ', spotlight held' : ''} · ${md.runLevel.x} of ${md.runLevel.n} missed · diff-blind in ${f.diff.blind.runs} of ${f.diff.runs} runs`)}</div><p class="artifact-label">The five criteria, as pre-registered</p><ul class="station-criteria">${results.criteria.map(c => `<li>${criterionItem(c)}</li>`).join('')}</ul><p class="station-provenance">Measured ${escape(day(f.measuredOn))} · <a href="${resultsDataPath}">The results record</a> · <a href="${notePath}#${resultsSectionId}">The results in full</a></p>`;
}

// Every registered figure for one gate or baseline.
function gateItem(results, name, id) {
  const g = results.primary.gates[id];
  const parts = [
    `agrees with bce on ${rate(g.agreement)}`,
    `missed drift ${rate(g.missedDrift)}, ${interval(g.missedDrift)}: code-level ${rate(g.missedDriftSplit.codeLevel)}, comment-only ${rate(g.missedDriftSplit.commentOnly)}${g.missedIds.length ? ` (missed ${g.missedIds.join(', ')})` : ''}`,
    `false reject ${rate(g.falseReject)}, ${interval(g.falseReject)}${g.falseRejectIds.length ? ` (${g.falseRejectIds.join(', ')})` : ''}`,
    `abstained on ${rate(g.abstentionRate.red)} RED and ${rate(g.abstentionRate.green)} GREEN`,
    `decided only: missed drift ${rate(g.decidedOnly.missedDrift)}, false reject ${rate(g.decidedOnly.falseReject)}`,
  ];
  if (g.accuracyAtHighConfidence) parts.push(`accuracy at high confidence ${g.accuracyAtHighConfidence.n ? rate(g.accuracyAtHighConfidence) : 'none (no answers at that confidence)'}`);
  if (g.escalation) parts.push(`sent to the reviewer ${rate(g.escalation)}`);
  if (g.reviewerVariance) parts.push(`runs that did not all agree ${rate(g.reviewerVariance.items)}; by run index ${g.reviewerVariance.perRunIndex.map(r => `run ${r.run}: missed ${rate(r.missedDrift)}, false reject ${rate(r.falseReject)}`).join('; ')}`);
  return `<strong>${escape(name)}</strong>: ${escape(parts.join('; '))}.`;
}

// The field note's results section.
export function renderResultsSection(data) {
  const { results, sha256: digest, facts: f } = data;
  const lat = results.latency, spot = results.spotlight, cost = results.costPer1000, d = f.diff;
  const perThousand = (name, c) => `${escape(name)}: ${c.usd === null ? 'no per-call price' : usd(c.usd)} per 1,000 decisions${c.note ? ` (${escape(c.note)})` : ''}. ${escape(c.basis)}`;
  return `<section id="${resultsSectionId}" class="article-amendment">
<h2>Results · ${escape(day(f.measuredOn))}</h2>
<p><strong>${escape(headline(data))}</strong> ${escape(headlineContext(data))}</p>
<p>${escape(f.best.scope)}</p>
<p>${escape(diffSentence(data))}</p>
<h3>The five criteria</h3>
${list(results.criteria.map(criterionItem))}
<p>${escape(f.claimRule)}</p>
<h3>Laya</h3>
<p>The pre-registration's framing says Laya is reported against "the same criteria"; its claim rule is the precise statement: Laya is judged on the two single-rate criteria only, missed drift and false reject, and its result does not decide the claim.</p>
${list(results.layaCriteria.map(c => `${escape(c.id)} <strong class="${stateClass(c.state)}">${escape(c.state)}</strong> · ${escape(rate(c.interval))}, ${escape(interval(c.interval))}`))}
<h3>Every gate and baseline, on the ${results.primary.items} changes</h3>
<p>Beside each headline rate, as registered: missed drift split into code-level and comment-only RED items, abstentions for RED and GREEN items, and the rates over decided items only.</p>
${list([gateItem(results, 'Jev', 'jev'), gateItem(results, 'Laya', 'laya'), gateItem(results, `The LLM reviewer (majority of ${f.k} runs)`, 'reviewer'), gateItem(results, 'The cascade', 'cascade'), gateItem(results, `Baseline · ${f.best.id}`, f.best.id), ...f.otherBaselines.map(id => gateItem(results, `Baseline · ${id}`, id))])}
<p>The reviewer's ${f.k} runs gave the same decided verdict on ${spot.criteria.find(c => c.id === 'self-agreement').x} of ${spot.criteria.find(c => c.id === 'self-agreement').n} changes.</p>
<p>Diff visibility, from ${code(diffVisibilityPath)} (computed by ${code(`${dir}/diff-visibility.mjs`)} from the reviewer record, which keeps refused tool calls and each report but not the calls that succeeded): ${d.blind.runs} runs were diff-blind; of the others, ${unplacedClause(d)}. ${d.items.majorityDiffBlind} of the ${d.items.total} majority verdicts rest on diff-blind runs, and on ${d.items.allRunsDiffBlind} items all ${f.k} runs were diff-blind. Every run was decided correctly. Diff-blind runs cost ${usd(d.blind.meanCostUsd)} on average against ${usd(d.seen.meanCostUsd)} for diff-seen runs, took ${d.blind.meanTurns.toFixed(1)} turns against ${d.seen.meanTurns.toFixed(1)}, and had a median latency of ${secs(d.blind.medianLatencyMs)} against ${secs(d.seen.medianLatencyMs)}.</p>
<p>Latency, median and 90th percentile, measured by our own wrapper: Jev ${Math.round(lat.jev.p50Ms)} and ${Math.round(lat.jev.p90Ms)} ms (including the public internet), Laya ${Math.round(lat.laya.p50Ms)} and ${Math.round(lat.laya.p90Ms)} ms, the reviewer ${Math.round(lat.reviewer.p50Ms)} and ${Math.round(lat.reviewer.p90Ms)} ms per run.</p>
<p>Mean cost per change (${escape(results.meanCostPerChange.basis)}): the cascade ${usd(results.meanCostPerChange.cascade)}, the reviewer alone ${usd(results.meanCostPerChange.reviewerAlone)}.</p>
${list([perThousand('Jev', cost.jev), perThousand('The reviewer', cost.reviewer), perThousand('Laya', cost.laya), perThousand('The cascade', cost.cascade)])}
<p>All paid calls in the experiment, prior uncounted calls included, came to ${usd(f.spend.totalUsd, 7)}: ${usd(f.spend.previousUsd, 7)} disclosed in amendment 02 and ${usd(f.spend.sinceUsd, 7)} in the ${f.spend.lines} ledger lines since its merge, under the $${escape(f.spend.capUsd)} cap.</p>
<h3>What these results do not establish</h3>
${list([
  `Mechanical rules only. ${escape(f.best.scope)}`,
  `${results.primary.red} RED and ${results.primary.green} GREEN items. The intervals above are wide, and a criterion that passes on its point estimate can still be "passes, not established at this N"; each state is shown as computed.`,
  `The reviewer ran in a restricted setup, not nina in the pipeline it was built for. Its file and git tools were fenced to its workspace (amendment 02), and its git commands were refused ${escape(f.gitToolDenials)} times across the ${escape(f.reviewerRuns)} runs, in forms the allow list does not match: ${escape(f.deniedForms.map(([form, n]) => `${form} … ${n} times`).join(', '))}; ${escape(f.deniedCompound)} of the refused commands were compound commands or redirections (a git status chained with other commands, for example), not a plain git status. ${escape(diffSentence(data))} nina's reviewer spec asks it to run pnpm harness:check, which these tools do not allow: no run attempted it (${escape(f.harnessCheckDenied)} refusals for it), and ${escape(f.harnessCheckMentioned)} of the ${escape(f.reviewerRuns)} reports mention it, mostly to say it was not run.`,
  `The reviewer-alone cost and latency describe this mostly diff-blind mode, which took more turns than reviewing a diff; the cost criterion compares the cascade with that same mode.`,
  `One machine, run sequentially, under a varying load from other work on the host. Latency describes that machine then, not a service level.`,
  `Paid calls made before the counted run, none counted in any result: amendment 01 discloses ${escape(f.priorCalls.amendment01)} calls and amendment 02 ${escape(f.priorCalls.amendment02)}; after amendment 02's merge and before the counted run there were ${escape(f.preCounted.calls)} more (${escape(f.preCounted.matrices)} isolation matrices, ${escape(f.preCounted.reviewerPractice)} reviewer practice runs and ${escape(f.preCounted.jevPractice)} Jev practice calls, ${escape(usd(f.preCounted.usd, 7))}), recorded in the spend ledger and included in the total above.`,
  `The answer-key pre-flight scanned the temp roots once, ending ${escape(f.preflight.endedAt)}, and found ${escape(f.preflight.copies)} copies; it could not read ${escape(f.preflight.unreadable)} root-owned buckets and skipped ${escape(f.preflight.permissionSkipped)} paths it had no permission to read, and a copy made after the scan would not have been seen. The reviewer's sandbox denied reads of the shared temp roots${f.preflight.notDenied.length ? `, but not of ${escape(f.preflight.notDenied.join(', '))}, which the pre-flight scanned; reads there rest on the allow list and the client's path checks` : ''}.`,
  `The pre-run isolation matrix record is stamped with amendment 01's not-before (${escape(f.prerun.notBefore)}) and no amendment 02 sha; it ran at ${escape(f.prerun.startedAt)}, after amendment 02's merge, with the ${escape(f.prerun.isolation)} flags, which is what counts.`,
])}
<p>This section is rendered from <a href="../${resultsDataPath}"><code>results.json</code></a>, the committed record at ${code(resultsPath)}, whose sha256 is ${code(digest)}. The build recomputes it from the committed gate runs with the frozen ${code(`${dir}/results.mjs`)} and fails if they differ.</p>
</section>
`;
}

// The card and any featuring need BOTH the registered PASS and an explicit decision that the spotlight is not held.
// EXP 006, the re-measure the held spotlight waits for (its note sits beside this one in journal/).
export const exp006NoteHref = 'nina-reviews-the-change.html';
export const spotlightShown = data => data.results.spotlight.verdict === 'PASS' && data.decision?.held === false;

// Amendment 01's spotlight bar, in the note: held, featured, or not met.
export function renderHarnessSection(data) {
  const { results, decision } = data, spot = results.spotlight;
  if (spot.verdict === 'PASS' && !spotlightShown(data)) return `<section id="${harnessSectionId}" class="article-amendment">
<h2>The spotlight bar: met, and held</h2>
<p>${nina()}. Amendment 01 fixed a bar that nina 0.34.0's reviewer had to meet, on mechanical architecture rules, before Odin R&amp;D would put it in the spotlight. The registered bar was met mechanically:</p>
${list(spotlightItems(results).map(escape))}
<p>${escape(diffSentence(data))}</p>
<p>So the spotlight is held${decision ? ` (${escape(decision.by)}, ${escape(decision.decidedOn)}: "${escape(decision.decision)}")` : ''} until a separate pre-registered experiment measures nina reviewing changes. Nothing about nina is featured until then.</p>
<p id="exp006">That experiment is pre-registered: <a href="${exp006NoteHref}">EXP 006, nina reviews the change</a>.</p>
${upstreamParagraph()}
</section>
`;
  if (spot.verdict !== 'PASS') return `<section id="${harnessSectionId}" class="article-amendment">\n<h2>The harness we measured</h2>\n<p>nina's reviewer did not meet the spotlight bar fixed in amendment 01 (${escape(spot.reasons.join('; ') || spot.verdict)}), so it is not featured. The results above stand as measured.</p>\n</section>\n`;
  return `<section id="${harnessSectionId}" class="article-amendment">
<h2>The harness we measured</h2>
<p>${nina()}. What was measured is nina 0.34.0's reviewer, deciding whether a change breaks mechanical architecture rules, in the restricted setup described above. Nothing else about nina was measured.</p>
<p>${escape(diffSentence(data))}</p>
<p>With that said, it met every criterion of the spotlight bar fixed in amendment 01 before any counted run:</p>
${list(spotlightItems(results).map(escape))}
${upstreamParagraph()}
</section>
`;
}

const nina = () => `<a href="https://github.com/xhulz/nina">nina</a> (github.com/xhulz/nina) — ${escape(ninaAttribution.split('— ')[1])}`;
export function spotlightItems(results) {
  const c = id => results.spotlight.criteria.find(x => x.id === id);
  const md = c('missed-drift'), fr = c('false-reject'), sa = c('self-agreement'), zp = c('zero-patches');
  return [
    `Missed drift: ${md.runLevel.x} of ${md.runLevel.n} RED runs (${pct(md.runLevel.estimate)}; bar ${pct(md.threshold)} or less); on the ${md.itemLevel.interval.n} RED items, ${rate(md.itemLevel.interval)}, ${interval(md.itemLevel.interval)}: ${md.itemLevel.state}.`,
    `False reject: ${fr.runLevel.x} of ${fr.runLevel.n} GREEN runs (${pct(fr.runLevel.estimate)}; bar ${pct(fr.threshold)} or less); on the ${fr.itemLevel.interval.n} GREEN items, ${rate(fr.itemLevel.interval)}, ${interval(fr.itemLevel.interval)}: ${fr.itemLevel.state}.`,
    `Self-agreement: all runs of a change gave the same decided verdict on ${sa.x} of ${sa.n} changes (bar ${pct(sa.threshold)} or more).`,
    `Zero patches: composed and run from the unmodified 0.34.0 release (${zp.patches.length} patches), with ${rate(zp.harnessFailures)} harness failures and ${rate(zp.hookErrors)} hook errors (bar ${pct(zp.harnessFailureMax)} or less).`,
  ];
}
const upstreamParagraph = () => `<p>Opened by Odin Labs while setting up this measurement, and not measured: ${upstream.map(u => `<a href="${u.url}">xhulz/nina#${u.number}</a> (${escape(u.title)}; ${escape(u.state)})`).join(' and ')}. Neither change is in the 0.34.0 release the reviewer ran.</p>`;

// nina's featured card on the home page, only when the spotlight bar was met.
export function renderSpotlightCard(data) {
  const { results, facts: f } = data;
  if (!spotlightShown(data)) return '';
  const c = id => results.spotlight.criteria.find(x => x.id === id);
  return `<article class="project-row project-featured" id="project-nina"><div class="project-number">005<span>HARNESS</span></div><div class="project-description"><h3><a href="${notePath}#${harnessSectionId}">nina, the harness we measured</a></h3><p>nina 0.34.0's reviewer, deciding whether a change breaks mechanical architecture rules, met the bar fixed before the counted run: ${escape(rate(c('missed-drift').runLevel))} runs missed drift (${escape(c('missed-drift').itemLevel.state)} on the items), ${escape(rate(c('false-reject').runLevel))} runs falsely rejected (${escape(c('false-reject').itemLevel.state)}), the same verdict on ${c('self-agreement').x} of ${c('self-agreement').n} changes, and no patch. In ${f.diff.blind.runs} of the ${f.diff.runs} runs this experiment's tool fence kept it from seeing the diff, so it audited the small repository against the rules instead; those runs were still all correct, because the base tree is clean. Nothing else about nina was measured.</p><div class="project-links"><a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a><a href="${notePath}#${harnessSectionId}">What was measured</a><a href="${resultsDataPath}">The record</a></div><p class="project-note">${nina()}.</p></div><dl class="project-spec"><div><dt>Measured</dt><dd>nina 0.34.0 reviewer</dd></div><div><dt>Bar</dt><dd>${escape(results.spotlight.verdict)}</dd></div><div><dt>Runs</dt><dd>${c('zero-patches').harnessFailures.n}</dd></div></dl></article>`;
}

// The built home page: row 004 and the journal row show the measured state, and nina's card follows row 004.
const row004Start = '<article class="project-row project-featured"><div class="project-number">004';
export function qualifyHomeResults(page, data) {
  const { results, facts: f } = data;
  const at = page.indexOf(row004Start);
  assert(at >= 0 && page.indexOf(row004Start, at + 1) < 0, 'The page must hold featured row 004 exactly once');
  const end = page.indexOf('</article>', at) + '</article>'.length;
  let row = page.slice(at, end);
  for (const [from, to] of [['<dt>Status</dt><dd>Pre-registered</dd>', '<dt>Status</dt><dd>Measured</dd>'], ['<dt>Results</dt><dd>Not yet run</dd>', `<dt>Results</dt><dd>${results.claim.refuted ? 'Claim refuted' : 'Claim holds'}</dd>`], ['<a href="journal/jev-as-a-fast-gate.html">The pre-registration</a>', `<a href="${notePath}#${resultsSectionId}">The results</a><a href="journal/jev-as-a-fast-gate.html">The pre-registration</a>`]]) {
    assert.equal(row.split(from).length, 2, `Row 004 must contain ${from} exactly once`);
    row = row.replace(from, to);
  }
  const para = row.indexOf('</p>');
  row = `${row.slice(0, para)} <a class="amendment-qualifier" href="${notePath}#${resultsSectionId}">Measured ${escape(day(f.measuredOn))}. ${escape(headline(data))} ${escape(headlineContext(data))}</a>${row.slice(para)}`;
  const out = page.slice(0, at) + row + renderSpotlightCard(data) + page.slice(end);
  const journalRow = 'Pre-registered, no results yet.</p></div><span class="journal-arrow"';
  assert.equal(out.split(journalRow).length, 2, 'The journal row must say it is pre-registered exactly once');
  return out.replace(journalRow, `Pre-registered; measured ${escape(day(f.measuredOn))}: ${results.claim.refuted ? 'the claim is refuted' : 'the claim holds'}.</p></div><span class="journal-arrow"`);
}

// The built note: the meta line says measured, the parent's "no results yet" sentences point at the results,
// and the results and harness sections come first in the body.
export function amendNoteResults(note, data) {
  const { facts: f } = data;
  const bodyOpen = '<article class="article-body">\n';
  for (const marker of [bodyOpen, ' · NO RESULTS YET</p>', 'No gate has been called. The results, when they exist, will be judged against this record as published, and reported as they come out, including a refutation.</p>']) assert.equal(note.split(marker).length, 2, `The note must contain ${JSON.stringify(marker)} exactly once`);
  assert(!note.includes(`id="${resultsSectionId}"`), 'The note already carries the results');
  const qualifier = ` <a class="amendment-qualifier" href="#${resultsSectionId}">Measured ${escape(day(f.measuredOn))}: see the results.</a>`;
  const first = note.indexOf('</p>', note.indexOf('<p><strong>Pre-registered, no results yet.</strong>'));
  let out = note.slice(0, first) + qualifier + note.slice(first);
  out = out.replace(' · NO RESULTS YET</p>', ` · MEASURED ${day(f.measuredOn).toUpperCase()}</p>`)
    .replace('including a refutation.</p>', `including a refutation.${qualifier}</p>`)
    .replace(bodyOpen, `${bodyOpen}${renderResultsSection(data)}${renderHarnessSection(data)}`);
  return replaceHead(out, measuredHead(data));
}

/**
 * The note's <head> once measured: the title and description say what the results say, not that the page was published
 * before any gate ran (the body keeps the pre-registration as published). Every phrase comes from the results record,
 * the spotlight decision and the dated records.
 */
export function measuredHead(data, root = '.') {
  const { results, facts: f } = data, spot = results.spotlight;
  const prereg = json(root, `${dir}/preregistration.json`), a01 = json(root, `${dir}/amendment-01.json`), a02 = json(root, `${dir}/amendment-02.json`);
  const e = prereg.experiment;
  const nina = spot.verdict === 'PASS' ? `nina's reviewer met the spotlight bar, and the spotlight ${spotlightShown(data) ? 'is featured' : 'is held'}` : 'nina\'s reviewer did not meet the spotlight bar';
  return {
    title: `${e.title}: measured`,
    description: `Field notes from Odin R&D. ${e.id}, ${e.title}, measured ${day(f.measuredOn)}: ${results.claim.refuted ? 'the claim is refuted' : 'the claim holds'}; ${nina}. Pre-registered ${day(e.authoredOn)}; amendment 01 ${day(a01.date)}, amendment 02 ${day(a02.date)}.`,
  };
}
