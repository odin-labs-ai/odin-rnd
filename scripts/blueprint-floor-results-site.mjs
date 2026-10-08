// EXP 007 stage-1 results on the site (PLAN-DETAIL WO-2-04, R6-2). Everything here renders ONLY what the pinned
// census gate (experiments/blueprint-floor/census-gate.mjs censusGate) returns: {publishable, variant, facts}. The variant
// (refuted | interim) is the scorer's kill output as the gate passes it on, never a choice made here. A committed
// results.json that the gate does not open on (a tampered record, a missing record, a ledger gap ...) stops the build.
//   refuted -> the field note gains its results section and its <head> states the measured result; station 07 "Floor"
//              renders the census; the home row says it was measured.
//   interim -> the note gains its results section; station 07 is not earned (stage 2 decides), and the station refuses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { censusGate, computeCensusResults, loadInputs, RESULTS_PATH } from '../experiments/blueprint-floor/census-gate.mjs';
import { AMENDMENT01_SHA256 } from '../experiments/blueprint-floor/freeze.mjs';
import { replaceHead } from './page-head.mjs';
import { slug } from './blueprint-floor-note.mjs';

export const resultsPath = RESULTS_PATH;
export const publishedResultsPath = 'site/data/blueprint-floor/results.json';
export const resultsDataPath = 'data/blueprint-floor/results.json';
export const resultsSectionId = 'results';
const notePath = `journal/${slug}.html`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const pct = v => (v === null || v === undefined ? 'no share' : `${(v * 100).toFixed(1)}%`);
const usd = v => `$${v.toFixed(7)}`;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const day = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)} ${months[Number(m) - 1]} ${y}`; };
const once = (text, marker, where) => assert.equal(text.split(marker).length, 2, `${where} must contain ${JSON.stringify(marker)} exactly once`);

/**
 * The census publication, from the pinned gate over the committed files: null when no results record is committed;
 * otherwise the gate's return, which must be publishable (a results record the gate refuses stops the build), plus the
 * pre-registration, the amendment and the results bytes (for the published copy and the provenance line).
 */
/**
 * Refute R-B1: the results record recomputed IN MEMORY from the committed records and ledger with the pinned code,
 * exactly as the pinned census-gate.mjs writeResults writes it (loadInputs, the same ledger parse, computeCensusResults
 * with amendment 01's inputs when it is frozen), serialised byte for byte as that writer does.
 */
export function recomputedResultsBytes(root = '.') {
  const i = loadInputs(root);
  const ledgerLines = i.ledgerText.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } });
  const inForce = Boolean(AMENDMENT01_SHA256);
  const results = computeCensusResults({ rules: i.rules, plugins: i.plugins, records: i.records, ledgerLines, denominator: i.denominator, scorerSha256: i.scorerDiskSha256, ...(inForce ? { attempt2Records: i.attempt2Records, amendment: i.amendment, amendmentSha256: i.amendmentDiskSha256 } : {}) });
  return `${JSON.stringify(results, null, 2)}\n`;
}

export function censusPublication(root = '.', { gate = censusGate } = {}) {
  if (!existsSync(join(root, RESULTS_PATH))) return null;
  const g = gate(root);
  if (!g.publishable) throw new Error(`EXP 007 results are committed but the pinned census gate refuses them: ${g.failures.slice(0, 5).join('; ')}`);
  assert(['refuted', 'interim'].includes(g.variant), 'the gate returns a variant');
  const bytes = readFileSync(join(root, RESULTS_PATH));
  // R-B1: every field the page shows, not only the score the gate binds, must be the pinned code's own recompute.
  let recomputed;
  try { recomputed = recomputedResultsBytes(root); } catch (error) { throw new Error(`EXP 007 results cannot be recomputed from the committed records: ${error.message}`); }
  if (recomputed !== bytes.toString('utf8')) throw new Error(`EXP 007 results.json is not byte for byte the pinned code's recompute from the committed records and ledger (${RESULTS_PATH})`);
  const prereg = JSON.parse(readFileSync(join(root, 'experiments/blueprint-floor/preregistration.json'), 'utf8'));
  const amendmentPath = join(root, 'experiments/blueprint-floor/amendment-01.json');
  const amendment = existsSync(amendmentPath) ? JSON.parse(readFileSync(amendmentPath, 'utf8')) : null;
  return { gate: g, variant: g.variant, facts: g.facts, prereg, amendment, resultsSha256: sha256(bytes) };
}

/**
 * Refute R-B2: what the census covers, from the gate's facts: the plugin rules (primary and the sampled secondary) and the
 * controls (the negative ones written for this experiment, the positive ones from EXP 005).
 */
export function censusScope(f) {
  const primary = f.perPlugin.reduce((n, p) => n + p.n, 0), secondary = f.secondary.n;
  const positive = f.controls.positive.n, negative = f.controls.negative.n;
  assert.equal(primary + secondary + positive + negative, f.denominator, 'the census scope adds up to the denominator');
  return { primary, secondary, plugin: primary + secondary, positive, negative, controls: positive + negative,
    text: `${primary + secondary} rules that the plugins ship (${primary} primary, ${secondary} sampled) and ${positive + negative} controls (${negative} written for this experiment, ${positive} from EXP 005)` };
}

/**
 * Refute N1: a disclosure found in review after the run. It is site text, labelled as such, and NOT part of the gate's
 * disclosure list (the census gate is pinned and its list is part of the recorded results).
 */
export const POST_REVIEW_DISCLOSURE = "Found in review after the run: each call ran in a fresh temp directory whose name began 'exp007-census', so the models could see the experiment id (never the hypothesis, plugin, rule label or expected class); the R6-1 canary terms did not include 'exp007'. A neutral prefix and the id in the canary terms are adopted for stage 2.";

/** The measured state in words, from the gate's variant and kill facts. */
export const measuredStatus = pub => (pub.variant === 'refuted' ? 'Measured — premise refuted' : 'Measured — stage 1 result (interim)');
export function headline(pub) {
  const { facts: f, variant } = pub, k = f.kill;
  const verdict = variant === 'refuted' ? 'below' : 'at or above';
  const outcome = variant === 'refuted' ? 'the premise is refuted: stage 2 is cancelled and the census is the result' : 'the premise stands for now: stage 2 decides';
  return `The median expressible share across the ${f.median.plugins} plugins with rules is ${pct(k.median)}, ${verdict} the pre-registered ${pct(k.threshold)} bar: ${outcome}.`;
}
const measuredOn = pub => pub.facts.measured.lastCallEndedAt;

/** The note's <head> once measured: the title and description state the measured result. */
export function measuredHead(pub) {
  const e = pub.prereg.experiment, f = pub.facts;
  return {
    title: `${e.id} — ${e.title} ${pub.variant === 'refuted' ? 'Measured: the premise is refuted' : 'Measured: stage 1 result (interim)'}`,
    description: `Field notes from Odin R&D. ${e.id}, measured ${day(measuredOn(pub))}: ${headline(pub)} ${censusScope(f).text}; the controls ${f.calibrated ? 'met' : 'missed'} the calibration bar. Pre-registered ${day(e.authoredOn)}${pub.amendment ? `; amendment 01 ${day(pub.amendment.authoredOn)}` : ''}.`,
  };
}

const counts = t => `${t.expressible} expressible, ${t.partial} partial, ${t.not} not, ${t.error} error`;
function pluginTable(f) {
  const head = '<tr><th scope="col">Plugin</th><th scope="col">Rules (n)</th><th scope="col">Expressible</th><th scope="col">Partial</th><th scope="col">Not</th><th scope="col">Error</th><th scope="col">Expressible share</th><th scope="col">Partial share</th></tr>';
  const rows = f.perPlugin.map(p => `<tr><th scope="row">${escape(p.plugin)}</th><td>${p.n}</td><td>${p.expressible}</td><td>${p.partial}</td><td>${p.not}</td><td>${p.error}</td><td>${p.n ? pct(p.expressibleShare) : 'no share'}</td><td>${p.n ? pct(p.partialShare) : 'no share'}</td></tr>`).join('');
  return `<div class="table-scroll" tabindex="0"><table><caption>Final class per plugin, primary stratum</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

/** The results section, rendered from the gate's facts and nothing else (plus the dated records' own texts). */
export function renderResultsSection(pub) {
  const { facts: f, prereg, amendment } = pub, k = f.kill, m = f.median, c = f.controls, a = f.agreement, s = f.spend;
  const piv = f.breakdown?.['pi-verdict'] ?? {};
  const am = f.amendment;
  return `<section id="${resultsSectionId}"><h2>Results: ${escape(measuredStatus(pub).replace('Measured — ', () => ''))}</h2>
<p class="results-headline"><strong>${escape(headline(pub))}</strong></p>
<p>The pre-registered rule: ${escape(k.rule)}. Measured from ${escape(f.measured.firstCallStartedAt)} to ${escape(f.measured.lastCallEndedAt)}; ${f.denominator} census rules, each with its record; decided by the pinned census gate (variant ${code(pub.variant)}).</p>
<h3>Per plugin</h3>
${pluginTable(f)}
${f.pluginsWithoutRules.length ? `<p>No share (no rule in the primary stratum): ${f.pluginsWithoutRules.map(escape).join(', ')}.</p>` : ''}
${list([`Median expressible share (the headline, strict): <strong>${pct(m.expressibleShare)}</strong> across ${m.plugins} plugins.`, `Median before the adjudicator's disputes: ${pct(m.preDispute)}.`, `Median with partial counted as 0.5 (sensitivity, not decisive): ${pct(m.partialAsHalf)}.`])}
<h3>Secondary sample</h3>
<p>hunch's specification rules, ${f.secondary.n} sampled: ${counts(f.secondary)}; expressible share ${pct(f.secondary.expressibleShare)}. Reported apart, never in the median.</p>
<h3>pi-verdict by rule group</h3>
${list(Object.entries(piv).map(([g, t]) => `${escape(g)}: ${t.n} rules, ${counts(t)}; expressible share ${pct(t.expressibleShare)}`))}
<h3>Controls and calibration</h3>
<p>${escape(c.bar)}. Positive controls final expressible or partial: ${c.positive.expressibleOrPartial} of ${c.positive.n}. Negative controls final expressible: ${c.negative.expressible} of ${c.negative.n}. <strong>${f.calibrated ? 'Calibrated: the bar is met.' : 'Translator uncalibrated: the bar is missed.'}</strong></p>
${list([...Object.entries(c.positive.finals), ...Object.entries(c.negative.finals)].map(([id, cls]) => `${code(id)}: ${escape(cls)}`))}
<h3>Translator and adjudicator agreement</h3>
<p>Cohen's kappa ${a.kappa === null ? 'not defined' : a.kappa.toFixed(3)} over ${a.n} rules (observed agreement ${a.observed === null ? 'n/a' : pct(a.observed)}, chance ${a.expected === null ? 'n/a' : pct(a.expected)}); ${escape(a.rule)}.</p>
<p>Disputes: ${f.disputes.length}${f.disputes.length ? ` (${f.disputes.map(d => `${code(d.ruleId)} ${escape(d.from)} → ${escape(d.to)}`).join('; ')})` : ''}. Downgrades by the mechanical checks: ${f.downgrades.length}${f.downgrades.length ? ` (${f.downgrades.map(d => `${code(d.ruleId)}: ${escape(d.failedCheck)}`).join('; ')})` : ''}. Engine-limit refusals: ${f.engineLimit.length}.</p>
<p>Errors (counted as not): ${f.errors.length}.</p>
${f.errors.length ? list(f.errors.map(e => `${code(e.ruleId)}: ${escape(e.reason)}`)) : ''}
<h3>Abide's own type, compared</h3>
<p>${escape(f.abide.mapping)}: ${f.abide.agree} of ${f.abide.comparable} agree (${pct(f.abide.agreement)}).</p>
${am ? `<h3>Amendment 01</h3>
<p>${amendment ? `${escape(amendment.incident.summary)} ` : ''}${am.eligible} rules were eligible under its rule and ${am.recalled} were re-called once; for them the attempt-2 record is the one scored. Amendment sha256 ${code(am.sha256)}, not-before ${escape(am.notBefore)}. <a href="#amendment-01">The amendment as published</a>.</p>` : ''}
<h3>Spend</h3>
${list([`Counted census calls: ${s.countedCalls}, ${usd(s.countedUsd)}.`, `Canary and practice calls (outside the census): ${s.excludedLines.length}, ${usd(s.excludedUsd)}.`, `Total: ${usd(s.totalUsd)}, against the census ceiling of $${prereg.spend.censusCeilingUsd} and the experiment's cap of $${prereg.spend.capUsd}.`, escape(s.basis)])}
<h3>Disclosed with these results</h3>
${list(f.disclosures.map(escape))}
<h3>Found in review after the run</h3>
<p class="post-review-disclosure">${escape(POST_REVIEW_DISCLOSURE)}</p>
<h3>Limits, as pre-registered</h3>
${list(prereg.limits.map(escape))}
<p>Provenance: <a href="../${resultsDataPath}"><code>results.json</code></a> (sha256 ${code(pub.resultsSha256)}), computed by the pinned scorer from the committed census records and spend ledger and opened by the pinned census gate; the build re-runs the gate and refuses a record it does not open.</p>
</section>
`;
}

/** The built note: the meta line says measured, the lead points at the results, the results come first in the body. */
export function amendNoteResults(note, pub) {
  const bodyOpen = '<article class="article-body">\n', meta = ' · NOT YET RUN</p>', lead = '<p><strong>Pre-registered, not yet run.</strong>';
  const tail = 'reported as they come out, including if the premise is refuted.</p>';
  for (const marker of [bodyOpen, meta, lead, tail]) once(note, marker, 'The EXP 007 note');
  assert(!note.includes(`id="${resultsSectionId}"`), 'The EXP 007 note already carries the results');
  const qualifier = ` <a class="amendment-qualifier" href="#${resultsSectionId}">${escape(measuredStatus(pub))}, ${escape(day(measuredOn(pub)))}: see the results.</a>`;
  const first = note.indexOf('</p>', note.indexOf(lead));
  let out = note.slice(0, first) + qualifier + note.slice(first);
  // Function replacers (refute N2): the inserted text carries data ($ amounts), which a string replacement would read as patterns.
  const section = renderResultsSection(pub), measured = ` · MEASURED ${day(measuredOn(pub)).toUpperCase()}</p>`;
  out = out.replace(meta, () => measured)
    .replace(tail, () => `reported as they come out, including if the premise is refuted.${qualifier}</p>`)
    .replace(bodyOpen, () => `${bodyOpen}${section}`);
  return replaceHead(out, measuredHead(pub));
}

/** The built home page: the EXP 007 field-note row says it was measured, and how. */
export function qualifyHomeExp007(page, pub) {
  const start = `<a class="journal-row" href="${notePath}">`;
  once(page, start, 'The home page');
  const at = page.indexOf(start), end = page.indexOf('</a>', at);
  const row = page.slice(at, end), lead = 'Pre-registered, not yet run.';
  once(row, lead, 'The EXP 007 field-note row');
  const measured = `Pre-registered; measured ${escape(day(measuredOn(pub)))}: ${pub.variant === 'refuted' ? 'the premise is refuted' : 'stage 1 result (interim)'}.`;
  const next = row.replace(`href="${notePath}"`, () => `href="${notePath}#${resultsSectionId}"`).replace(lead, () => measured);
  return page.slice(0, at) + next + page.slice(end);
}

/** Station 07 "Floor": earned only by a refuted census (an interim result waits for stage 2). From the gate's facts only. */
export function renderFloorExhibit(pub) {
  if (!pub) throw new Error('Station 07 needs the committed EXP 007 census results, opened by the pinned census gate');
  if (pub.variant !== 'refuted') throw new Error('Station 07 is earned by a refuted census only; an interim stage-1 result waits for stage 2');
  const f = pub.facts;
  const row = (label, value, state = '') => `<div class="record-comparison ${state}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
  return `<p class="artifact-label">${escape(censusScope(f).text)}, each translated blind into a static checker's constraints</p><div class="record-comparisons">${row('Median expressible share', `${pct(f.median.expressibleShare)} (bar ${pct(f.kill.threshold)})`, 'rejected')}${row('Rules expressible, primary stratum', `${f.perPlugin.reduce((n, p) => n + p.expressible, 0)} of ${f.perPlugin.reduce((n, p) => n + p.n, 0)}`)}${row('Partial (a model still needed)', `${f.perPlugin.reduce((n, p) => n + p.partial, 0)}`)}${row('Controls', f.calibrated ? 'calibration bar met' : 'translator uncalibrated', f.calibrated ? 'accepted' : 'rejected')}</div><p class="station-implication">${escape(headline(pub))}</p><p class="station-provenance">Pinned census gate · results.json sha256 ${escape(pub.resultsSha256.slice(0, 12))} · <a href="${resultsDataPath}">The results record</a></p>`;
}

/** The #station-data entry for station 07 carries the status its visible heading shows (app.js announces it). */
const stationDataRe = /<script type="application\/json" id="station-data">([\s\S]*?)<\/script>/;
export function qualifyFloorStationData(page, pub) {
  const matches = page.match(new RegExp(stationDataRe.source, 'g')) ?? [];
  assert.equal(matches.length, 1, 'The page must carry #station-data exactly once');
  const stations = JSON.parse(stationDataRe.exec(page)[1]);
  assert.equal(stations.filter(s => s.record === 'blueprint-floor').length, 1, 'The station data must hold station 07 exactly once');
  const qualified = stations.map(s => (s.record === 'blueprint-floor' ? { ...s, status: measuredStatus(pub) } : s));
  return page.replace(stationDataRe, () => `<script type="application/json" id="station-data">${JSON.stringify(qualified).replaceAll('<', '\\u003c')}</script>`);
}
export const floorLink = { href: `${notePath}#${resultsSectionId}`, text: 'Read the results' };
