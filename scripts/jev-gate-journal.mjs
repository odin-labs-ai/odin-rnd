// Renders the public EXP 005 pages from experiments/jev-gate/preregistration.json: the station 06
// exhibit on the floor and the pre-registration field note. Every number and every criterion is read
// from the record; the build and the tests re-render both and fail if a page drifts from it.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRecord, percent } from './jev-gate-prereg.mjs';

export const dataPath = 'data/jev-gate/preregistration.json';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const row = (label, value) => `<div class="record-comparison"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
const short = digest => `${digest.slice(0, 12)}…`;

// Station 06. The heading says it is pre-registered; it never presents a result.
export function renderTriageExhibit(record, station) {
  assert.equal(station.title, record.experiment.stationTitle, 'Station 06 title differs from the pre-registration');
  assert.equal(station.status, record.experiment.statusText, 'Station 06 status differs from the pre-registration');
  const { corpus, gates, cascade } = record;
  const criteria = record.criteria.map(c => `<li>${escape(c.statement)}</li>`).join('');
  return `<p class="artifact-label">Written down before any gate runs</p><p class="station-implication">${escape(record.experiment.stationSummary)}</p><div class="record-comparisons">${row('Corpus', `${corpus.items} authored changes`)}${row(`Ground truth · ${record.groundTruth.engine} ${record.groundTruth.version}`, `${corpus.groundTruthRed} RED / ${corpus.groundTruthGreen} GREEN`)}${row('Gates', `${gates.jev.model} · Laya · LLM reviewer ×${gates.reviewer.k}`)}${row('Cascade', `final at confidence ≥ ${cascade.confidenceThreshold}, else escalate`)}${row('Results', 'none yet')}</div><p class="artifact-label">The claim is refuted if</p><ul class="station-criteria">${criteria}</ul><p class="station-provenance">Pre-registered ${escape(record.experiment.authoredOn)} · corpus sha256 <code>${escape(short(corpus.corpusSha256))}</code><br><a href="${dataPath}">The pre-registration record</a><br>LLM reviewer: ${record.attribution.nina.replace('github.com/xhulz/nina', `<a href="${escape(record.attribution.ninaUrl)}">github.com/xhulz/nina</a>`)}</p>`;
}

export const slug = 'jev-as-a-fast-gate';
export const articlePath = `site/journal/${slug}.html`;
export const noteNumber = '002';
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const code = value => `<code>${escape(value)}</code>`;
const link = (url, label) => `<a href="${escape(url)}">${escape(label)}</a>`;
// Record prose names its own numeric fields; the page shows their values in their place.
const filler = record => text => escape(text)
  .replaceAll('decisionThreshold', escape(record.decisionRules.decisionThreshold))
  .replaceAll('confidenceThreshold', escape(record.cascade.confidenceThreshold))
  .replaceAll('readinessGateMaxAttempts', escape(record.retryProtocol.readinessGateMaxAttempts))
  .replaceAll('alreadySpentUsd', `$${escape(record.spendCap.alreadySpentUsd.toFixed(2))}`)
  .replaceAll('verdictPattern', code(record.decisionRules.verdictPattern));

const header = title => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="Field notes from Odin R&amp;D. The pre-registration of EXP 005, published before any gate runs: can a fast typed-decision model gate architectural drift from the diff alone?"><link rel="canonical" href="https://odin-labs-ai.github.io/odin-rnd/journal/${slug}.html"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

// The field note. It is the record in prose: nothing on it is a result, and nothing on it is typed twice.
export function renderNote(record, recordSha256) {
  assert.match(recordSha256, /^[a-f0-9]{64}$/, 'The note needs the sha256 of the record it renders');
  const { experiment: e, corpus, gates, decisionRules: d, cascade, statistics: s, thresholdRule: t, cost, spendCap, retryProtocol: retry, clock } = record;
  const title = `${e.title}: the pre-registration`;
  const fill = filler(record);
  const reviewer = gates.reviewer;
  const nina = record.attribution.nina.replace('github.com/xhulz/nina', `<a href="${escape(record.attribution.ninaUrl)}">github.com/xhulz/nina</a>`);
  const sources = record.sources.map(src => `<li>${link(src.url, src.label)}. ${escape(src.claim)}</li>`);
  return `${header(title)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(e.title)}: the pre-registration</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · PRE-REGISTERED ${escape(day(e.authoredOn))} · NO RESULTS YET</p></header><article class="article-body">
<p><strong>Pre-registered, no results yet.</strong> This note is published before any gate has seen a single item of the corpus. It is the plan, fixed in advance: what we ask, what we measure, and what would prove us wrong. ${escape(e.note)}</p>
<h2>The question</h2>
<p>${escape(record.question)}</p>
${record.framing.map(p => `<p>${escape(p)}</p>`).join('\n')}
<h2>Why a diff-only triage is not a replacement for bce</h2>
<p>bce needs a blueprint and the real tree; given both, it answers exactly and costs little. A check that sees only the diff and the rules as text, before merge, is a different setting. There the typed gate would sit in front, settle what it is sure of and pass the rest on. bce stays what every gate in this experiment is scored against.</p>
<h2>The cascade</h2>
<p>${fill(cascade.rule)}</p>
<p>${escape(cascade.reporting)}</p>
<h2>How each gate decides</h2>
${list([d.typedDecision, d.confidence, d.verdictParse, d.reviewerMajority, d.abstention, d.failures].map(fill))}
<h2>The corpus</h2>
<p>${escape(corpus.description)}</p>
<p>bce (${escape(record.groundTruth.engine)} ${escape(record.groundTruth.version)}, extractor ${code(record.groundTruth.extractor)}) labels ${corpus.groundTruthRed} of the ${corpus.items} changes RED and ${corpus.groundTruthGreen} GREEN; ${corpus.intentDisagreements} labels disagree with their author's intent and ${corpus.excluded} items are excluded. ${escape(record.groundTruth.labelRule)}</p>
<p>Corpus sha256 ${code(corpus.corpusSha256)}: ${escape(corpus.corpusSha256Meaning)}</p>
<p>Gate inputs sha256 ${code(corpus.inputsSha256)}: ${escape(corpus.inputsSha256Meaning)} Jev and Laya get the same state, built as ${code(record.stateConstruction)}, and this question:</p>
<pre tabindex="0">${escape(JSON.stringify(record.gateQuestion))}</pre>
<p>The rules, verbatim:</p>
<pre tabindex="0">${escape(record.rulesText)}</pre>
<h2>The gates</h2>
${list([
  `<strong>Jev</strong>, the gate under test: model ${code(gates.jev.model)} through ${escape(gates.jev.provider)}, at ${code(gates.jev.endpoint)}. ${escape(gates.jev.order)}`,
  `<strong>Laya</strong>, the open-weight comparison: ${link(`${gates.laya.repository}/tree/${gates.laya.revision}/${gates.laya.subdir}`, `${gates.laya.repository.replace('https://', '')}`)} at revision ${code(gates.laya.revision)}. ${escape(gates.laya.backend)} ${escape(gates.laya.sequence)}`,
  `<strong>The LLM reviewer</strong>: ${nina}. Release ${code(reviewer.release)} (commit ${code(reviewer.commit)}), agent ${code(reviewer.agent)}, run by ${escape(reviewer.client)} ${escape(reviewer.clientVersion)} with model ${code(reviewer.model)} at effort ${code(reviewer.effort)}, ${reviewer.k} runs per change. Tools: ${reviewer.allowedTools.map(code).join(', ')}. ${escape(reviewer.workspace)}`,
])}
<p>The reviewer's prompt, verbatim. ${escape(reviewer.promptAuthorship)}</p>
<pre tabindex="0">${escape(reviewer.prompt)}</pre>
<h2>What we measure</h2>
${list(record.metrics.map(m => `<strong>${escape(m.id)}</strong>: ${fill(m.definition)}`))}
<p>Every rate is published with its ${escape(s.singleRate.method)} at ${escape(percent(s.confidenceLevel))} (z = ${escape(s.z)}): ${code(s.singleRate.formula)}.</p>
<p>The cascade is compared with the reviewer on the same items with the ${escape(s.pairedDifference.method)}: ${escape(s.pairedDifference.formula)}</p>
<p>${escape(record.populations.primary)} ${escape(record.populations.sensitivity)}</p>
<h2>What would prove it wrong</h2>
${list(record.criteria.map(c => escape(c.statement)))}
<p>${escape(record.claimRule)}</p>
<p>Each criterion comes out in one of three states: ${t.states.map(x => `<em>${escape(x)}</em>`).join(', ')}. ${escape(t.singleRate)} ${escape(t.pairedDifference)} ${escape(t.publication)}</p>
<p>${escape(record.baselineValidity.statement)}</p>
<p>${escape(record.latency.role)}</p>
<h2>Cost, the spending cap and timing</h2>
${list([
  `Jev: $${escape(cost.jev.usdPerMillionInputTokens)} per million input tokens. ${escape(cost.jev.basis)}`,
  `Reviewer: ${escape(cost.reviewer.basis)}`,
  `Laya: ${escape(cost.laya.basis)}`,
  escape(cost.comparison),
  `A cap of $${escape(spendCap.usd)}, of which ${fill('alreadySpentUsd')} is already spent. ${fill(spendCap.covers)} ${fill(spendCap.rule)}`,
  `${fill(retry.rule)} ${escape(retry.gateCalls)}`,
  `${escape(clock.rule)} ${escape(clock.notBefore)}`,
])}
<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../${dataPath}"><code>preregistration.json</code></a>, the committed record at ${code('experiments/jev-gate/preregistration.json')}, whose sha256 is ${code(recordSha256)}. The build publishes that file byte for byte, and a repository test re-renders this page from it and fails if they differ. A validator recomputes every hash in the record from the files on disk.</p>
<h2>Sources</h2>
<ul>${sources.join('')}</ul>
<p class="article-note">No gate has been called. The results, when they exist, will be judged against this record as published, and reported as they come out, including a refutation.</p>
</article></main>${footer}`;
}

// The committed note must be exactly the render of the committed record; the build calls this.
export function assertNoteCurrent(root = '.') {
  const { record, sha256 } = checkRecord(root);
  assert.equal(readFileSync(`${root}/${articlePath}`, 'utf8'), renderNote(record, sha256), `${articlePath} differs from the pre-registration: run node scripts/jev-gate-journal.mjs --write`);
  return record;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--write') { console.error('usage: node scripts/jev-gate-journal.mjs --write'); process.exit(2); }
  const { record, sha256 } = checkRecord();
  writeFileSync(articlePath, renderNote(record, sha256));
  console.log(`Wrote ${articlePath} from the pre-registration (${sha256}).`);
}
