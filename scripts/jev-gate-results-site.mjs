// Renders the measured EXP 005 results onto the public pages: station 06, the featured row on the home page,
// the field note's results section and, only when amendment 01's spotlight bar was met, nina's card and the
// note's "The harness we measured" section. Every figure is read from the committed results record, which is
// first recomputed from the committed gate runs by the frozen experiments/jev-gate/results.mjs and must match.
// The pre-registration's own text and pages are not edited; the build adds these beside them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPublishable, computeResults, loadRecords } from '../experiments/jev-gate/results.mjs';
import { publishedParentSha256 } from './jev-gate-amendment.mjs';
import { amendment01Sha256 } from './jev-gate-amendment-02.mjs';
import { ninaAttribution } from './jev-gate-prereg.mjs';

const dir = 'experiments/jev-gate';
export const resultsDir = `${dir}/results`;
export const resultsPath = `${resultsDir}/results.json`;
export const publishedResultsPath = 'site/data/jev-gate/results.json';
export const resultsDataPath = 'data/jev-gate/results.json';
export const resultsSectionId = 'results';
export const harnessSectionId = 'the-harness-we-measured';
const notePath = 'journal/jev-as-a-fast-gate.html';
// Upstream changes to nina found while this experiment was being set up. They are references, not measured
// properties: neither is in the pinned 0.34.0 release the reviewer ran (checked on GitHub, 2026-09-29).
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
const units = v => Math.round(Number((v * 1e7).toFixed(3)));
export const diffUnreadPattern = /(couldn't|could not|can't|cannot|unable to|wasn't able to|was not able to) (open|read|see|view|get|show) the (diff|change)/i;
const stateClass = state => (state === 'refuted' ? 'verdict-red' : state === 'passes' ? 'verdict-green' : 'verdict-amber');

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
  assert.deepEqual(computeResults({ ...loadRecords(), runs, preflight }), results, `${resultsPath} differs from what the frozen results.mjs computes from the committed runs`);
  return { results, sha256: sha256(bytes), facts: facts(root, results, runs, preflight) };
}

// Figures the page states that live in the other committed records, each computed from them here.
export function facts(root, results, runs, preflight) {
  const prereg = json(root, `${dir}/preregistration.json`);
  const a01 = json(root, `${dir}/amendment-01.json`), a02 = json(root, `${dir}/amendment-02.json`);
  const reviewerCalls = runs.reviewer.calls;
  const ledger = readFileSync(join(root, `${dir}/spend-ledger.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  // The ledger counts from amendment 02's merge time, the results' notBefore; everything before is in amendment 02's figure.
  const since = ledger.filter(line => line.ts > results.notBefore && typeof line.costUsd === 'number');
  // As the runners' ledger does: sum the recorded costs, then round once to the 7th decimal.
  const sinceUnits = units(since.reduce((s, line) => s + line.costUsd, 0));
  const totalUnits = units(a02.spend.alreadySpentUsd) + sinceUnits;
  const denied = reviewerCalls.flatMap(c => (c.permissionDenials ?? []).map(d => String(d.input?.command ?? d.tool_input?.command ?? '').trim().split(/\s+/).slice(0, 2).join(' ')));
  const forms = Object.entries(denied.reduce((m, form) => ({ ...m, [form]: (m[form] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const ended = [runs.jev, runs.laya, runs.reviewer].map(r => r.endedAt).sort().at(-1);
  const best = prereg.bestBaseline.id;
  return {
    measuredOn: ended.slice(0, 10),
    reviewerRuns: reviewerCalls.length,
    gitToolDenials: reviewerCalls.reduce((s, c) => s + (c.gitToolDenials ?? 0), 0),
    harnessCheckDenied: reviewerCalls.filter(c => JSON.stringify(c.permissionDenials ?? []).includes('harness:check')).length,
    harnessCheckMentioned: reviewerCalls.filter(c => (c.result ?? '').includes('harness:check')).length,
    deniedForms: forms.slice(0, 3),
    // Reports that say, in the model's own words, that the diff could not be seen or read through its tools.
    diffUnread: reviewerCalls.filter(c => diffUnreadPattern.test(c.result ?? '')).length,
    deniedTotal: denied.length,
    baseShas: [...new Set(reviewerCalls.map(c => c.baseSha))],
    spend: { previousUsd: a02.spend.alreadySpentUsd, sinceUsd: sinceUnits / 1e7, lines: since.length, totalUsd: totalUnits / 1e7, capUsd: prereg.spendCap.usd },
    priorCalls: { amendment01: a01.priorCalls.calls.length, amendment02: a02.priorCalls.calls.length },
    preflight: { endedAt: preflight.endedAt, roots: preflight.scanned.length + preflight.skipped.length, unreadable: preflight.skipped.reduce((s, x) => s + (x.unreadableBuckets ?? 0), 0), permissionSkipped: preflight.permissionSkipped, copies: preflight.copies.length },
    gateStarts: Object.fromEntries(Object.entries(runs).map(([gate, r]) => [gate, r.calls[0]?.startedAt ?? r.startedAt])),
    best: { id: best, description: prereg.baselines.find(b => b.id === best)?.description, scope: prereg.bestBaseline.scope },
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

export const measuredStatus = ({ results }) => `Measured — ${results.claim.refuted ? 'claim refuted' : 'claim holds'}`;

// One criterion's figure, by kind.
export function criterionFigure(c) {
  if (c.kind === 'single-rate') return `${rate(c.interval)}, ${interval(c.interval)}`;
  if (c.kind === 'paired-difference') return `${rate(c.interval.first)} against ${rate(c.interval.second)}; difference ${pct(c.interval.estimate)}, ${interval(c.interval)}`;
  if (c.kind === 'point-ratio') return `${usd(c.cascadeMean)} against ${usd(c.reviewerMean)} per change, ratio ${c.ratio.toFixed(3)} (${escape(c.basis)})`;
  throw new Error(`Unknown criterion kind ${c.kind}`);
}
const criterionItem = c => `${escape(c.statement)} <strong class="${stateClass(c.state)}">${escape(c.state)}</strong> · ${escape(criterionFigure(c))}`;

// Station 06, measured.
export function renderMeasuredExhibit(data) {
  const { results, facts: f } = data, g = results.primary.gates;
  const row = (label, value, state = '') => `<div class="record-comparison ${state}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
  const spot = results.spotlight;
  return `<p class="artifact-label">Measured ${escape(day(f.measuredOn))}, judged against the record as published</p><p class="station-implication">${escape(headline(data))}</p><div class="record-comparisons">${row('Jev · missed drift', rate(g.jev.missedDrift), g.jev.missedDrift.x > g[f.best.id].missedDrift.x ? 'rejected' : '')}${row(`Linter from the rules · ${f.best.id}`, rate(g[f.best.id].missedDrift), 'accepted')}${row('Jev · false reject', rate(g.jev.falseReject))}${row('Cascade · sent to the reviewer', rate(g.cascade.escalation))}${row('Mean cost per change', `${usd(results.meanCostPerChange.cascade)} cascade · ${usd(results.meanCostPerChange.reviewerAlone)} reviewer alone`)}${row('LLM reviewer · spotlight bar', `${spot.verdict} · ${spot.criteria.find(c => c.id === 'missed-drift').runLevel.x} of ${spot.criteria.find(c => c.id === 'missed-drift').runLevel.n} missed`, spot.verdict === 'PASS' ? 'accepted' : 'rejected')}</div><p class="artifact-label">The five criteria, as pre-registered</p><ul class="station-criteria">${results.criteria.map(c => `<li>${criterionItem(c)}</li>`).join('')}</ul><p class="station-provenance">Measured ${escape(day(f.measuredOn))} · <a href="${resultsDataPath}">The results record</a> · <a href="${notePath}#${resultsSectionId}">The results in full</a></p>`;
}

// The field note's results section.
export function renderResultsSection(data) {
  const { results, sha256: digest, facts: f } = data, g = results.primary.gates;
  const gate = (name, id) => `<strong>${escape(name)}</strong>: agrees with bce on ${rate(g[id].agreement)}; missed drift ${rate(g[id].missedDrift)}, ${interval(g[id].missedDrift)}; false reject ${rate(g[id].falseReject)}, ${interval(g[id].falseReject)}; abstained on ${rate(g[id].abstentionRate.all)}.`;
  const lat = results.latency;
  const spot = results.spotlight;
  return `<section id="${resultsSectionId}" class="article-amendment">
<h2>Results · ${escape(day(f.measuredOn))}</h2>
<p><strong>${escape(headline(data))}</strong></p>
<p>${escape(f.best.scope)}</p>
<h3>The five criteria</h3>
${list(results.criteria.map(criterionItem))}
<p>${escape(f.claimRule)}</p>
<h3>Laya</h3>
<p>The pre-registration's framing says Laya is reported against "the same criteria"; its claim rule is the precise statement: Laya is judged on the two single-rate criteria only, missed drift and false reject, and its result does not decide the claim.</p>
${list(results.layaCriteria.map(c => `${escape(c.id)} <strong class="${stateClass(c.state)}">${escape(c.state)}</strong> · ${escape(rate(c.interval))}, ${escape(interval(c.interval))}`))}
<h3>Every gate, on the ${results.primary.items} changes</h3>
${list([gate('Jev', 'jev'), gate('Laya', 'laya'), gate(`The LLM reviewer (majority of ${f.k} runs)`, 'reviewer'), gate('The cascade', 'cascade'), gate(`Baseline · ${f.best.id}`, f.best.id), ...f.otherBaselines.map(id => gate(`Baseline · ${id}`, id))])}
<p>The cascade sent ${escape(rate(g.cascade.escalation))} changes on to the reviewer. The reviewer's ${f.k} runs gave the same decided verdict on ${spot.criteria.find(c => c.id === 'self-agreement').x} of ${spot.criteria.find(c => c.id === 'self-agreement').n} changes.</p>
<p>Latency, median and 90th percentile, measured by our own wrapper: Jev ${Math.round(lat.jev.p50Ms)} and ${Math.round(lat.jev.p90Ms)} ms (including the public internet), Laya ${Math.round(lat.laya.p50Ms)} and ${Math.round(lat.laya.p90Ms)} ms, the reviewer ${Math.round(lat.reviewer.p50Ms)} and ${Math.round(lat.reviewer.p90Ms)} ms per run.</p>
<p>Cost per change: the cascade ${usd(results.meanCostPerChange.cascade)}, the reviewer alone ${usd(results.meanCostPerChange.reviewerAlone)} (${escape(results.meanCostPerChange.basis)}). All paid calls in the experiment, prior uncounted calls included, came to ${usd(f.spend.totalUsd, 7)}: ${usd(f.spend.previousUsd, 7)} disclosed in amendment 02 and ${usd(f.spend.sinceUsd, 7)} in the ${f.spend.lines} ledger lines since its merge, under the $${escape(f.spend.capUsd)} cap.</p>
<h3>What these results do not establish</h3>
${list([
  `Mechanical rules only. ${escape(f.best.scope)}`,
  `${results.primary.red} RED and ${results.primary.green} GREEN items. The intervals above are wide, and a criterion that passes on its point estimate can still be "passes, not established at this N"; each state is shown as computed.`,
  `The reviewer ran in a restricted setup, not nina in the pipeline it was built for. Its file and git tools were fenced to its workspace (amendment 02), and its git commands were refused ${escape(f.gitToolDenials)} times across the ${escape(f.reviewerRuns)} runs, most often in forms the allow list does not match (${escape(f.deniedForms.map(([form, n]) => `${form} … ${n} times`).join(', '))}); ${escape(f.diffUnread)} of the ${escape(f.reviewerRuns)} reports say in their own words that they could not see or read the diff, and judged the working tree, where the change was applied, against the rules instead. nina's reviewer spec asks it to run pnpm harness:check, which these tools do not allow: no run attempted it (${escape(f.harnessCheckDenied)} refusals for it), and ${escape(f.harnessCheckMentioned)} of the ${escape(f.reviewerRuns)} reports mention it, mostly to say it was not run.`,
  `One machine, run sequentially, under a varying load from other work on the host. Latency describes that machine then, not a service level.`,
  `Paid calls made before the counted run, none counted in any result, are disclosed in amendment 01 (${escape(f.priorCalls.amendment01)} calls) and amendment 02 (${escape(f.priorCalls.amendment02)} calls).`,
  `The answer-key pre-flight scanned the temp roots once, ending ${escape(f.preflight.endedAt)}, and found ${escape(f.preflight.copies)} copies; it could not read ${escape(f.preflight.unreadable)} root-owned buckets and skipped ${escape(f.preflight.permissionSkipped)} paths it had no permission to read, and a copy made after the scan would not have been seen. The reviewer's sandbox denied reads of those temp roots throughout.`,
])}
<p>This section is rendered from <a href="../${resultsDataPath}"><code>results.json</code></a>, the committed record at ${code(resultsPath)}, whose sha256 is ${code(digest)}. The build recomputes it from the committed gate runs with the frozen ${code(`${dir}/results.mjs`)} and fails if they differ.</p>
</section>
`;
}

// Amendment 01's spotlight bar, in the note: the harness we measured, or why it was not earned.
export function renderHarnessSection(data) {
  const { results } = data, spot = results.spotlight;
  if (spot.verdict !== 'PASS') return `<section id="${harnessSectionId}" class="article-amendment">\n<h2>The harness we measured</h2>\n<p>nina's reviewer did not meet the spotlight bar fixed in amendment 01 (${escape(spot.reasons.join('; ') || spot.verdict)}), so it is not featured. The results above stand as measured.</p>\n</section>\n`;
  return `<section id="${harnessSectionId}" class="article-amendment">
<h2>The harness we measured</h2>
<p>${nina()}. What was measured is nina 0.34.0's reviewer, deciding whether a change breaks mechanical architecture rules, in the restricted setup described above. Nothing else about nina was measured. In ${escape(data.facts.diffUnread)} of its ${escape(data.facts.reviewerRuns)} runs it reported that it could not read the diff through its tools and judged the working tree, which holds the change, against the rules instead.</p>
<p>It met every criterion of the spotlight bar fixed in amendment 01 before any counted run:</p>
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
const upstreamParagraph = () => `<p>Found while setting up this measurement, and not measured: ${upstream.map(u => `<a href="${u.url}">xhulz/nina#${u.number}</a> (${escape(u.title)}; ${escape(u.state)})`).join(' and ')}. Neither change is in the 0.34.0 release the reviewer ran.</p>`;

// nina's featured card on the home page, only when the spotlight bar was met.
export function renderSpotlightCard(data) {
  const { results } = data;
  if (results.spotlight.verdict !== 'PASS') return '';
  const c = id => results.spotlight.criteria.find(x => x.id === id);
  return `<article class="project-row project-featured" id="project-nina"><div class="project-number">005<span>HARNESS</span></div><div class="project-description"><h3><a href="${notePath}#${harnessSectionId}">nina, the harness we measured</a></h3><p>nina 0.34.0's reviewer, deciding whether a change breaks mechanical architecture rules, met the bar fixed before the counted run: ${escape(rate(c('missed-drift').runLevel))} runs missed drift (${escape(c('missed-drift').itemLevel.state)} on the items), ${escape(rate(c('false-reject').runLevel))} runs falsely rejected (${escape(c('false-reject').itemLevel.state)}), the same verdict on ${c('self-agreement').x} of ${c('self-agreement').n} changes, and no patch. Measured in a restricted setup, in which ${data.facts.diffUnread} of the ${data.facts.reviewerRuns} runs could not read the diff through their tools and judged the working tree instead; nothing else about nina was measured.</p><div class="project-links"><a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a><a href="${notePath}#${harnessSectionId}">What was measured</a><a href="${resultsDataPath}">The record</a></div><p class="project-note">${nina()}.</p></div><dl class="project-spec"><div><dt>Measured</dt><dd>nina 0.34.0 reviewer</dd></div><div><dt>Bar</dt><dd>${escape(results.spotlight.verdict)}</dd></div><div><dt>Runs</dt><dd>${c('zero-patches').harnessFailures.n}</dd></div></dl></article>`;
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
  row = `${row.slice(0, para)} <a class="amendment-qualifier" href="${notePath}#${resultsSectionId}">Measured ${escape(day(f.measuredOn))}. ${escape(headline(data))}</a>${row.slice(para)}`;
  let out = page.slice(0, at) + row + renderSpotlightCard(data) + page.slice(end);
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
  return out;
}
