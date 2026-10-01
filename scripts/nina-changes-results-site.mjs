// Renders the measured EXP 006 results onto the public pages (WO-3-03): the note's results section and its measured
// status, the home page's field-note row, and the EXP 005 note's #exp006 line. Every figure is read from the committed
// results record, which the build first recomputes from the committed run with the frozen scorer
// (experiments/nina-changes/write-results6.mjs check6) and must match byte for byte, or from the other committed
// records (the reviewer run's end time, the spotlight decision, the spend ledger, the pre-registration). Nothing is
// rendered while no results record exists: the build then leaves every page exactly as the pre-registration made it.
// WHETHER nina's entry shows is not decided here: that is the pinned gate (gateFromBytes), whose verdict this file only
// reports, and which scripts/nina-changes-spotlight.mjs renders.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDecision, gateFromBytes } from '../experiments/nina-changes/spotlight-gate.mjs';
import { callDigests6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { DIGEST_PLACEHOLDER6, maskDigests6 } from '../experiments/nina-changes/scrub6.mjs';
import { LEDGER6, SpendLedger6 } from '../experiments/nina-changes/spend6.mjs';
import { RULE as DIFF_SEEN_RULE } from '../experiments/nina-changes/diff-seen.mjs';
import { conditions6 } from '../experiments/nina-changes/write-decision6.mjs';
import { check6, FILES, loadPrereg6, RESULTS_DIR, sha256 } from '../experiments/nina-changes/write-results6.mjs';
import { checkAmendment } from './nina-changes-amendment.mjs';
import { sectionId as amendmentSectionId } from './nina-changes-amendment-note.mjs';
import { slug } from './nina-changes-note.mjs';
import { entryId } from './nina-changes-spotlight.mjs';

export const resultsSectionId = 'results';
export const DRY_RUN_DIR = 'experiments/nina-changes/dry-run';
export const publishedDir = 'site/data/nina-changes';
const dataHref = file => `../data/nina-changes/${file}`;
/** The records the build publishes beside the pre-registration, byte for byte (the decision only once it exists). */
export const SCRUBBED = 'scrubbed-records.json';
export const PUBLISHED = [FILES.results, FILES.reviewer, FILES.preflight, FILES.decision, SCRUBBED];

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const day = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d} ${MONTHS[Number(m) - 1]} ${y}`; };
const pct = v => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'no runs');
/** "x of n (p%)"; a rate over no runs says so. */
export const rateText = r => (r && r.n > 0 ? `${r.x} of ${r.n} (${pct(r.estimate)})` : `${r?.x ?? 0} of ${r?.n ?? 0}`);
const usd = (v, places) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(places)}` : 'not recorded');
const holdsText = c => (c.holds ? 'holds' : 'does not hold');

/**
 * The page data from the records' bytes. The decision, when present, must be bound to these results (the pinned gate's
 * checkDecision); the gate verdict is the pinned gateFromBytes (its freeze defaults to the committed freeze.mjs; tests
 * inject a synthetic one, never by committing it).
 */
export function resultsData({ resultsBytes, reviewerBytes, decisionBytes = null, freeze, root = '.' }) {
  const results = JSON.parse(resultsBytes);
  const reviewer = JSON.parse(reviewerBytes);
  assert.equal(typeof reviewer.endedAt, 'string', 'the reviewer run record has no end time (the measured date)');
  assert(Number.isFinite(Date.parse(reviewer.endedAt)), 'the reviewer run record\'s end time does not parse');
  const decision = decisionBytes ? checkDecision(resultsBytes, JSON.parse(decisionBytes)) : null;
  if (decision) assert.equal(decision.reviewerSha256, sha256(reviewerBytes), 'the spotlight decision names another reviewer run record');
  const gate = gateFromBytes({ resultsBytes, decisionBytes, reviewerBytes, ...(freeze ? { freeze } : {}) });
  const ledger = new SpendLedger6(join(root, LEDGER6));
  const counted = e => e.kind === 'counted';
  const spend = { totalUsd: ledger.total(), lines: ledger.entries().length, countedUsd: ledger.total(counted), countedLines: ledger.entries().filter(counted).length, capUsd: ledger.limits.capUsd };
  const exp005 = JSON.parse(readFileSync(join(root, 'experiments/jev-gate/preregistration.json'), 'utf8'));
  // The pre-flight override, from the records (results refute N2): every committed dry-run record that ran its
  // practice pre-flight with an override of the scanned roots, and the counted pre-flight record's own override.
  const dryRunDir = join(root, DRY_RUN_DIR);
  const practiceOverrides = existsSync(dryRunDir) ? readdirSync(dryRunDir).filter(f => f.endsWith('.json')).sort()
    .map(f => ({ file: f, override: JSON.parse(readFileSync(join(dryRunDir, f), 'utf8')).pins?.preflight?.override ?? null })).filter(x => x.override) : [];
  const preflightFile = join(root, RESULTS_DIR, FILES.preflight);
  const countedOverride = existsSync(preflightFile) ? { override: JSON.parse(readFileSync(preflightFile, 'utf8')).override ?? null } : null;
  // resultSha256 is hashed before the write-time scrub (run_reviewer6 buildCallRecord), so a call whose result text the
  // scrub changed has a digest its published text does not reproduce (results refute N3): counted from the record.
  const calls = (reviewer.calls ?? []).filter(c => c && !c.stageError);
  // The post-run re-scrub (results refute N1, experiments/nina-changes/rescrub-records6.mjs), from its side record.
  const scrubbedFile = join(root, RESULTS_DIR, SCRUBBED);
  const rescrub = existsSync(scrubbedFile) ? JSON.parse(readFileSync(scrubbedFile, 'utf8')) : null;
  const preScrubDigests = calls.filter(c => typeof c.result === 'string' && typeof c.resultSha256 === 'string' && sha256(c.result) !== c.resultSha256).map(c => `${c.id} run ${c.run}`);
  return { results, sha256: sha256(resultsBytes), reviewerSha256: sha256(reviewerBytes), maskedDigests: maskedDigests6(reviewerBytes), supersededMasked: maskedDigests6(reviewerBytes, supersededDigests6(root)) - maskedDigests6(reviewerBytes), practiceOverrides, countedOverride, preScrubDigests, rescrub, resultDigestCalls: calls.filter(c => typeof c.resultSha256 === 'string').length, decision, gate, spend, prereg6: loadPrereg6(root).record, amendment6: checkAmendment(root), confidence: `${Math.round(exp005.statistics.confidenceLevel * 100)}%`, measuredOn: reviewer.endedAt };
}

/** The committed EXP 006 results, recomputed and checked; null while none is committed. */
export function checkResults6(root = '.') {
  if (!existsSync(join(root, RESULTS_DIR, FILES.results))) return null;
  const { bytes, reviewerBytes } = check6({ root, dir: RESULTS_DIR });
  const decisionFile = join(root, RESULTS_DIR, FILES.decision);
  return resultsData({ resultsBytes: bytes, reviewerBytes, decisionBytes: existsSync(decisionFile) ? readFileSync(decisionFile) : null, root });
}

/**
 * The published copy of the reviewer run record. Every per-call runner digest that the published text beside it
 * reproduces (EXP 006 amendment 01, A1: toolCalls.N.outputSha256 = sha256 of that call's kept output, resultSha256 = of
 * the result text, hook.sha256 = of the hook text; run_reviewer6 callDigests6, recomputed here) is replaced by the
 * placeholder "<sha256>" (scrub6 maskDigests6). check.mjs scans every published file for its restricted-term
 * fingerprints and exempts a 64-hex token only when it is the sha256 of a tracked file, so a random digest can trip it
 * by chance (as the dry run's p06 did the runner's lint); masking only the digests anyone can recompute from the same
 * file loses nothing. A digest the text does not reproduce stays as recorded, and is scanned. The committed record
 * (results/reviewer.json, which the scorer and the gate read) is never altered; the page names its sha256.
 */
//
// `superseded` (bounded confirm N-a): the digests the post-run re-scrub left over text as first recorded, named by the
// side record (scrubbed-records.json digestsNoLongerReproduced, e.g. calls.149.toolCalls.4.outputSha256). Their preimage
// held the local account name, so the published copy masks them too; the committed record keeps them.
export function publicReviewer6(bytes, superseded = []) {
  const run = JSON.parse(bytes);
  const own = new Set(superseded);
  const calls = run.calls.map((c, i) => {
    if (!c || c.stageError) return c;
    const extra = [...own].map(p => p.split('.')).filter(([k, n]) => k === 'calls' && Number(n) === i).map(([, , ...rest]) => [rest, rest.reduce((o, k) => o?.[k], c)]);
    return maskDigests6(c, [...callDigests6(c.toolCalls ?? [], c.result, c.hook), ...extra]);
  });
  return Buffer.from(`${JSON.stringify({ ...run, calls }, null, 2)}\n`);
}
const placeholders = text => (text.match(new RegExp(`"${DIGEST_PLACEHOLDER6}"`, 'g')) ?? []).length;
/** How many digests the published copy masks (stated on the page, from the bytes). */
export const maskedDigests6 = (bytes, superseded = []) => placeholders(publicReviewer6(bytes, superseded).toString('utf8')) - placeholders(bytes.toString('utf8'));
/** The superseded digest paths the side record names (none when there is no side record under `root`). */
export const supersededDigests6 = (root = '.') => {
  const file = join(root, RESULTS_DIR, SCRUBBED);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).files.flatMap(f => (f.path === `${RESULTS_DIR}/${FILES.reviewer}` ? (f.digestsNoLongerReproduced ?? []).map(d => d.path) : [])) : [];
};

/**
 * Publishes the committed records into site/data/nina-changes/ (the reviewer run record as publicReviewer6's copy, the
 * others byte for byte) and returns [{file, sha256}] of what it wrote, for the build's dist check.
 */
export function publishResults6(root = '.') {
  mkdirSync(join(root, publishedDir), { recursive: true });
  return PUBLISHED.filter(f => existsSync(join(root, RESULTS_DIR, f))).map(f => {
    const src = readFileSync(join(root, RESULTS_DIR, f));
    const out = f === FILES.reviewer ? publicReviewer6(src, supersededDigests6(root)) : src;
    writeFileSync(join(root, publishedDir, f), out);
    return { file: f, sha256: sha256(out) };
  });
}

// ----------------------------------------------------------------------------- the words

/** The measured status after the dash, from the record and the gate: what a reader needs in one line. */
export function measuredDetail({ results: r, gate }) {
  if (r.partial !== null) return 'partial run, decides nothing';
  const bar = r.spotlight.verdict === 'PASS' ? 'bar met' : 'bar not met';
  if (r.manipulation.state !== 'PASS') return `${bar}, manipulation check failed`;
  if (r.spotlight.verdict !== 'PASS') return bar;
  return gate.shown ? 'bar met, nina in the spotlight' : 'bar met, spotlight held';
}
export const measuredStatus6 = data => `${data.results.rehearsal ? 'Rehearsal, not a measurement' : 'Measured'} — ${measuredDetail(data)}`;

/** The spotlight outcome: a link to nina's entry when the gate is open, otherwise which condition failed, plainly. */
export function outcomeSentence(data) {
  const { results, decision, gate } = data;
  if (gate.shown) return `The bar was met, the manipulation check passed, and the pre-registered spotlight decision (${escape(decision.decidedOn)}) does not hold it: <a href="../#${entryId}">nina's entry in the tools list</a>.`;
  // A held decision already names every condition that failed, in a sentence of its own.
  if (decision?.held) return `No spotlight. ${escape(decision.reason)}`;
  const parts = decision
    ? [`the spotlight gate is closed: ${gate.reason}`]
    : [...conditions6(results).filter(c => !c.met && c.id !== 'refute' && c.id !== 'eligible').map(c => c.failed), 'no spotlight decision is committed yet'];
  return `No spotlight: ${escape([...new Set(parts)].join('; '))}.`;
}

// ----------------------------------------------------------------------------- the results section

const ruleText = rule => (rule === 'a' ? 'a: a changed line in a git output' : rule === 'b' ? 'b: the added file listed and read' : 'none');

function barRows(data) {
  const { results: r, confidence } = data;
  const c = id => r.spotlight.criteria.find(x => x.id === id);
  const md = c('missed-drift'), fr = c('false-reject'), sa = c('self-agreement'), zp = c('zero-patches');
  const dso = r.diffSeenOnly;
  const item = x => (x.itemLevel.interval ? `; on the ${x.itemLevel.interval.n} items, ${rateText(x.itemLevel.interval)}, ${confidence} interval ${pct(x.itemLevel.interval.lower)}–${pct(x.itemLevel.interval.upper)}: ${x.itemLevel.state}` : `; item level: ${x.itemLevel.state}`);
  const patches = Array.isArray(zp.patches) ? (zp.patches.length === 0 ? 'no local patch' : `${zp.patches.length} local patches`) : 'patches not recorded';
  return [
    [`Missed drift, at most ${pct(md.threshold)} of RED runs`, `${rateText(md.runLevel)}${item(md)}`, rateText(dso.missedDrift), holdsText(md)],
    [`False reject, at most ${pct(fr.threshold)} of GREEN runs`, `${rateText(fr.runLevel)}${item(fr)}`, rateText(dso.falseReject), holdsText(fr)],
    [`Self-agreement, at least ${pct(sa.threshold)} of changes`, rateText(sa), rateText(dso.selfAgreement), holdsText(sa)],
    [`Zero patches, harness failures at most ${pct(zp.harnessFailureMax)} of runs`, `${patches}; ${rateText(zp.harnessFailures)} harness failures`, 'not applicable', holdsText(zp)],
  ];
}
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** The note's results section. */
export function renderResultsSection6(data) {
  const { results: r, prereg6: p, amendment6: a, spend, sha256: digest, reviewerSha256, measuredOn } = data;
  const m = r.manipulation, zp = r.spotlight.criteria.find(x => x.id === 'zero-patches');
  const states = Object.entries(r.runStates).map(([s, n]) => `${n} ${s}`).join(', ');
  const title = `${r.rehearsal ? 'Rehearsal' : 'Results'} · ${day(measuredOn)}`;
  return `<section id="${resultsSectionId}" class="article-amendment">
<h2>${escape(title)}</h2>
${r.rehearsal ? '<p><strong>A rehearsal, not a measurement.</strong> The committed stream-json fake stood in for the model; this record is marked rehearsal and the build refuses to publish it.</p>\n' : ''}<p><strong>${escape(measuredStatus6(data))}.</strong> ${outcomeSentence(data)}</p>
${r.partial !== null ? `<p>${escape(p.bar.partial)} This run was partial: ${escape(r.partial.map(x => `${x.reason}${x.detail ? ` (${x.detail})` : ''}`).join('; '))}. The figures below are published as measured and decide nothing.</p>\n` : ''}<h3>The bar, as pre-registered</h3>
<p>${escape(p.bar.statement)} The primary figures count every counted run, a diff-blind run as an error; the diff-seen-only figures leave the blind runs out and are reported beside the primary, never in its place.</p>
${table(['Criterion', 'All runs (primary)', 'Diff-seen runs only', 'State'], barRows(data))}
<p>The bar: <strong>${escape(r.spotlight.verdict)}</strong>${r.spotlight.reasons.length ? ` (${escape(r.spotlight.reasons.join('; '))})` : ''}.${r.spotlight.notEstablishedPhrase ? ` Item level: ${escape(r.spotlight.notEstablishedPhrase)}.` : ''} Hook errors, recorded beside the bar and not a criterion: ${escape(rateText(zp.hookErrors))}.</p>
<h3>The manipulation check: did the reviewer see the change?</h3>
<p>${escape(p.bar.manipulation.rule)}</p>
<p><strong>${escape(m.state ?? 'Not decided (partial run)')}</strong>: ${m.blind} of ${m.countedRuns} counted runs were diff-blind, ${m.harnessFailures} of them harness failures, against the pre-registered maximum of ${m.maxBlindRuns} of ${m.denominator}. Run states: ${escape(states)}.</p>
<details><summary>Every run's diff visibility (${r.perRun.length} runs) <span aria-hidden="true">+</span></summary>
${table(['Item', 'Run', 'State', 'Rule'], r.perRun.map(x => [x.id, String(x.run), x.state, ruleText(x.rule)]))}
</details>
<p>${escape(DIFF_SEEN_RULE)}</p>
<h3>Cost</h3>
<p>${escape(r.cost.basis)} Per counted run: mean ${escape(usd(r.cost.meanUsd, 4))}, 90th percentile ${escape(usd(r.cost.p90Usd, 4))}, computed with ${escape(r.cost.p90Method)}, largest ${escape(usd(r.cost.maxUsd, 4))}, over ${r.cost.calls} runs with a reported cost${r.cost.callsWithoutCost ? `; ${r.cost.callsWithoutCost} runs reported none and were charged the upper bound in the ledger` : ''}.</p>
<p>Every paid call of ${escape(p.experiment.id)}, from the committed spend ledger (${code(LEDGER6)}): ${escape(usd(spend.totalUsd, 7))} over ${spend.lines} calls, of which ${escape(usd(spend.countedUsd, 7))} over ${spend.countedLines} counted runs, under the $${escape(spend.capUsd)} cap.</p>
<h3>What these results do not establish</h3>
${list([escape(p.bar.mapping), ...p.limits.map(escape), ...a.record.limits.map(x => `${escape(x)} <span class="technical">(amendment 01)</span>`), ...runLimits(data).map(escape)])}
<h3>Reproduce</h3>
<p>From a checkout of this repository at the commit that published these records, with Node 22:</p>
<pre tabindex="0">pnpm install --frozen-lockfile
node experiments/nina-changes/write-results6.mjs --check</pre>
<p>It recomputes ${code(`${RESULTS_DIR}/${FILES.results}`)} from the committed run record with the frozen scorer, including every run's diff visibility from its committed tool outputs and fingerprints, and fails unless the bytes match. The build runs the same check.</p>
<p>This section is rendered from <a href="${dataHref(FILES.results)}"><code>results.json</code></a> (sha256 ${code(digest)}), made from <a href="${dataHref(FILES.reviewer)}"><code>reviewer.json</code></a>, the counted run record (the committed record's sha256 is ${code(reviewerSha256)}; the published copy replaces the ${data.maskedDigests} per-call digests that its own text reproduces${data.supersededMasked ? `, and the ${data.supersededMasked} digest${data.supersededMasked === 1 ? '' : 's'} the re-scrub superseded,` : ''} with ${code('<sha256>')}, so a random digest cannot trip the site's restricted-term check, and is otherwise the same record), and the answer-key <a href="${dataHref(FILES.preflight)}">pre-flight record</a>${data.decision ? `, with the <a href="${dataHref(FILES.decision)}">spotlight decision</a>` : ''}. The run and the results name the pre-registration (sha256 ${code(r.prereg6Sha256 ?? 'not recorded')}) and <a href="#${amendmentSectionId}">amendment 01</a> (sha256 ${code(r.amendment6Sha256 ?? 'not recorded')}; the committed amendment is ${code(a.sha256)}).</p>
</section>
`;
}

/** Limits that come from this run's records (results refute N2, N3), each rendered from them. */
export function runLimits(data) {
  const out = [];
  const { practiceOverrides: po = [], countedOverride: co = null, preScrubDigests: ps = [], resultDigestCalls: n = 0, rescrub = null } = data;
  if (po.length) out.push(`The practice runs' answer-key pre-flight scanned only the roots an override named (${[...new Set(po.map(x => x.override))].join(', ')}, recorded in pins.preflight.override of ${po.map(x => x.file).join(', ')}).${co ? ` The counted run's pre-flight record ${co.override === null ? 'records no override: it scanned the default roots' : `has the override ${co.override}`}.` : ''}`);
  else if (co) out.push(`The counted run's pre-flight record ${co.override === null ? 'records no override: it scanned the default roots' : `has the override ${co.override}`}.`);
  const f = rescrub?.files?.[0];
  const later = f?.digestsNoLongerReproduced ?? [];
  const rescrubText = f ? ` After the run the committed record was re-scrubbed (${SCRUBBED}: ${rescrub.rule}; ${f.replacements} replacements in ${f.fields.length} field${f.fields.length === 1 ? '' : 's'}; the record was ${f.originalSha256} as the runner wrote it and is ${f.sha256} as committed). ${later.length ? `For ${later.length === 1 ? 'that tool output' : `those ${later.length} tool outputs`} (${later.map(d => `${d.call}, ${d.path}`).join('; ')}) the outputSha256 is the digest of the output as first recorded, so it no longer reproduces from the published text either.` : ''}` : '';
  out.push(`resultSha256 is the sha256 of the result text as the client returned it, before the write-time scrub; amendment 01 calls it "the sha256 of the result text". For ${ps.length} of the ${n} calls${ps.length ? ` (${ps.join(', ')})` : ''} the scrub changed the result text, so the published text does not reproduce that digest.${rescrubText} ${later.length ? `The published copy keeps the result digest${ps.length === 1 ? '' : 's'} above as recorded, and masks ${later.length === 1 ? 'that superseded output digest' : 'those superseded output digests'} (it is the digest of text that held the local account name); the committed record keeps ${later.length === 1 ? 'it' : 'them'}.` : 'The published copy keeps every such digest as recorded.'}`);
  return out;
}

// ----------------------------------------------------------------------------- placing it

const once = (page, marker, what) => assert.equal(page.split(marker).length, 2, `${what} must contain ${JSON.stringify(marker)} exactly once`);

/** The built EXP 006 note: the meta line and the two "not yet run" sentences point at the results, which come first. */
export function amendNote6(note, data) {
  const bodyOpen = '<article class="article-body">\n', meta = ' · NOT YET RUN</p>', lead = '<p><strong>Pre-registered, not yet run.</strong>', tail = 'reported as they come out.</p>';
  for (const marker of [bodyOpen, meta, lead, tail]) once(note, marker, 'The EXP 006 note');
  assert(!note.includes(`id="${resultsSectionId}"`), 'The EXP 006 note already carries the results');
  const qualifier = ` <a class="amendment-qualifier" href="#${resultsSectionId}">${escape(measuredStatus6(data))}, ${escape(day(data.measuredOn))}: see the results.</a>`;
  const first = note.indexOf('</p>', note.indexOf(lead));
  let out = note.slice(0, first) + qualifier + note.slice(first);
  out = out.replace(meta, ` · ${data.results.rehearsal ? 'REHEARSAL, NOT A MEASUREMENT' : 'MEASURED'} ${day(data.measuredOn)}</p>`)
    .replace(tail, `reported as they come out.${qualifier}</p>`)
    .replace(bodyOpen, `${bodyOpen}${renderResultsSection6(data)}`);
  return out;
}

/** The built home page: the EXP 006 field-note row says it was measured, and how. */
export function qualifyHome6(page, data) {
  // The row as the note and amendment renderers left it (amendment 01 links it to its section and qualifies the lead).
  const start = `<a class="journal-row" href="journal/${slug}.html`;
  once(page, start, 'The home page');
  const at = page.indexOf(start), end = page.indexOf('</a>', at);
  const row = page.slice(at, end), lead = 'Pre-registered, not yet run.';
  once(row, lead, 'The EXP 006 field-note row');
  const measured = `Pre-registered; ${data.results.rehearsal ? 'rehearsed' : 'measured'} ${escape(day(data.measuredOn))}: ${escape(measuredDetail(data))}.`;
  return page.slice(0, at) + row.replace(lead, measured) + page.slice(end);
}

/** The built EXP 005 note: its #exp006 line (the held spotlight's pointer) says EXP 006 was measured, from the record. */
export function qualifyExp005Note(note, data) {
  const from = `<p id="exp006">That experiment is pre-registered: <a href="${slug}.html">EXP 006, nina reviews the change</a>.</p>`;
  once(note, from, 'The EXP 005 note');
  return note.replace(from, `<p id="exp006">That experiment has been ${data.results.rehearsal ? 'rehearsed' : 'measured'}, ${escape(day(data.measuredOn))}: <a href="${slug}.html#${resultsSectionId}">EXP 006, nina reviews the change</a>, ${escape(measuredDetail(data))}.</p>`);
}

