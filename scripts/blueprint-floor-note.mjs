// Renders the public EXP 007 pages from experiments/blueprint-floor/preregistration.json: the pre-registration field note
// (site/journal/which-rules-need-a-model.html) and its row in the home page's field notes. Every figure is read from the
// record; the build and the tests re-render both and fail if a page drifts from it. The page shell follows the EXP 006
// note's markup; that module keeps its shell private and EXP 006's files stay untouched, so the shell is written here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRecord } from './blueprint-floor-prereg.mjs';

export const slug = 'which-rules-need-a-model';
export const articlePath = `site/journal/${slug}.html`;
export const dataPath = 'data/blueprint-floor/preregistration.json';
export const noteNumber = '004';
export const exp005Href = 'jev-as-a-fast-gate.html';
export const exp006RowAnchor = '<a class="journal-row" href="journal/nina-reviews-the-change.html">';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };

const header = (title, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="https://odin-labs-ai.github.io/odin-rnd/journal/${slug}.html"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

/** The field note: the record in prose. Nothing on it is a result. */
export function renderNote(record, recordSha256) {
  assert.match(recordSha256, /^[a-f0-9]{64}$/, 'The note needs the sha256 of the record it renders');
  const { experiment: e, lineage: l, selection: s, engine: g, adapter: a, translator: t, mechanical: m, adjudicator: j, controls: c, census: n, calls: k, killCriteria: kc, spend: sp } = record;
  const title = `${e.id} — ${e.title} ${e.statusText}`;
  const pluginRow = p => `<strong>${escape(p.plugin)}</strong> (${code(p.repo)} at ${code(p.sha.slice(0, 8))}; ${escape(p.license)}, ${escape(p.copyright)}): ${p.primary} rule${p.primary === 1 ? '' : 's'} in the primary stratum${p.secondary ? `, ${p.secondary} in the secondary sample` : ''}, ${p.excluded} item${p.excluded === 1 ? '' : 's'} excluded with a reason`;
  return `${header(title, `Field notes from Odin R&D. The pre-registration of ${e.id}, published before any census call: ${e.summary}`)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(e.id)} — ${escape(e.title)}</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · PRE-REGISTERED ${escape(day(e.authoredOn))} · NOT YET RUN</p></header><article class="article-body">
<p><strong>${escape(e.statusText)}.</strong> ${escape(e.summary)} ${escape(e.note)}</p>
<h2>The question</h2>
<p>${escape(record.question)}</p>
<p>Stage ${escape(record.stage)}.</p>
<h2>Why ask it</h2>
<p>${escape(l.exp005.finding)} (<a href="${exp005Href}">EXP 005</a>: its better model-free baseline missed ${l.exp005.lintMissedRed} of ${l.exp005.redItems} drift items; results record sha256 ${code(l.exp005.resultsSha256)}.)</p>
<p>${escape(l.motivation)}</p>
<h2>The rules: eight plugins, pinned</h2>
<p>Each plugin's own rule files, read at a pinned commit and vendored with the sha256 of every source file. ${escape(s.inclusionTest)} ${escape(s.granularity)}</p>
${list(record.plugins.map(pluginRow))}
<p>${n.primaryRules} rules in the primary stratum across ${n.pluginsInMedian} plugins; ${n.pluginsWithoutRules.length ? `${n.pluginsWithoutRules.map(escape).join(', ')} ${n.pluginsWithoutRules.length === 1 ? 'has' : 'have'} none that passes the inclusion test at the pin, so ${n.pluginsWithoutRules.length === 1 ? 'it has' : 'they have'} no share in the median. ` : ''}${escape(s.hunchSecondary)} Out of scope: ${record.excludedPlugins.map(x => `${escape(x.plugin)} (${escape(x.reason)})`).join('; ')}.</p>
<h2>The translator is blind</h2>
<p>${escape(t.input)}</p>
<p>It never sees: ${escape(t.never)} ${escape(t.blindness)}</p>
<p>${escape(t.output)}</p>
<p>The three classes, defined before any call:</p>
${list(Object.entries(record.classes).map(([name, def]) => `<strong>${escape(name)}</strong>: ${escape(def)}`))}
<h2>What can only lower an answer</h2>
<p>Mechanical checks, in code, in this order:</p>
${list(m.checks.map(escape))}
<p>${escape(m.downgrade)} ${escape(m.engineLimit)} ${escape(m.error)}</p>
<p>${escape(j.input)} It answers ${escape(j.output)} ${escape(j.finalClass)} ${escape(j.agreement)}</p>
<h2>The checker and the adapter</h2>
<p>${escape(g.package)} ${escape(g.version)}. ${escape(g.rule)} ${escape(g.customPolicy)}</p>
${list([`Plugin rules: ${g.pluginVocabulary.map(code).join(', ')}.`, `Positive controls: ${g.controlVocabulary.map(code).join(', ')}.`, `Not in the vocabulary: ${g.excludedTypes.map(code).join(', ')}.`])}
<p>${escape(a.profiles)}</p>
${list(a.inputs.map(escape))}
<p>${escape(a.judge)} ${escape(a.teeth)} ${escape(a.base)} Base commit ${code(a.baseCommit)}, tree ${code(a.baseTree)}.</p>
<h2>Controls</h2>
${list([escape(c.positive), escape(c.negative)])}
<p><strong>Calibration bar.</strong> ${escape(c.calibrationBar)} ${escape(c.miss)}</p>
<h2>What is measured</h2>
${list(record.metrics.map(x => `<strong>${escape(x.id)}</strong>: ${escape(x.definition)}`))}
<p>The census: ${n.rules} rules (${n.primaryRules} primary, ${n.secondaryRules} secondary, ${n.controls} controls), two calls each, ${n.calls} calls.</p>
<h2 id="kill">The bar that would refute it</h2>
<p><strong>${escape(kc.stage1)}</strong></p>
<p>${escape(kc.source)}</p>
<pre tabindex="0">${escape(kc.verbatim)}</pre>
<pre tabindex="0">${escape(kc.discriminatingNegativesVerbatim)}</pre>
<p>${escape(kc.publication)}</p>
<h2>Calls, spend and the clock</h2>
${list([`Translator ${code(k.translatorModel)}, adjudicator ${code(k.adjudicatorModel)}, ${escape(k.client)} ${escape(k.clientVersion)}, effort ${code(k.effort)}, ${k.attempts} attempt per call.`, escape(k.workingDirectory), escape(k.environment), escape(k.modelAssertion), escape(k.canary), escape(k.billing), escape(k.bareRejected)])}
<pre tabindex="0">${escape(k.command)}</pre>
${list([`A cap of $${sp.capUsd} on every metered call of ${escape(e.id)}, with a census ceiling of $${sp.censusCeilingUsd}; ledger ${code(sp.ledger)}.`, ...sp.rules.map(escape), escape(sp.unknownCost), escape(sp.bundle1), escape(record.notBefore), escape(record.runnerGuard)])}
<p>${escape(sp.plain)}</p>
<p>The pre-registration's own wording of the same point, quoted verbatim from the plan:</p>
<blockquote><p>${escape(sp.wording)}</p></blockquote>
<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<h2>Sources</h2>
${list(record.sources.map(x => `<a href="${escape(x.url)}">${escape(x.label)}</a>: ${escape(x.claim)}`))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../${dataPath}"><code>preregistration.json</code></a>, the committed record at ${code('experiments/blueprint-floor/preregistration.json')}, whose sha256 is ${code(recordSha256)}. The build publishes that file byte for byte, and a repository test re-renders this page from it and fails if they differ. A validator rebuilds every file fact in the record from the files on disk.</p>
<p class="article-note">No census call has been made. The results, when they exist, will be judged against this record as published, and reported as they come out, including if the premise is refuted.</p>
</article></main>${footer}`;
}

const shortDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
/** The home page's field-note row, rendered from the record. */
export function renderJournalRow(record) {
  const e = record.experiment;
  return `<a class="journal-row" href="journal/${slug}.html"><div class="journal-date"><time datetime="${escape(e.authoredOn)}">${shortDate(e.authoredOn)}</time><span class="technical">EXPERIMENT NOTE / ${noteNumber}</span></div><div><h3>${escape(e.id)}: ${escape(e.title)} <br>the pre-registration</h3><p>${escape(e.summary)} Pre-registered, not yet run.</p></div><span class="journal-arrow" aria-hidden="true">↗</span></a>`;
}
export const resultWords = /\b(results? show|wins?|won|beats?|outperform\w*|proven|refuted|passe[sd])\b/i;

/** The built home page with the EXP 007 row inserted directly above EXP 006's row (the newest note leads). */
export function addJournalRow(html, record) {
  assert.equal(html.split(exp006RowAnchor).length, 2, 'the home page carries the EXP 006 field-note row exactly once (add it first)');
  assert(!html.includes(`href="journal/${slug}.html"><div class="journal-date">`), 'the EXP 007 row is already there');
  const row = renderJournalRow(record);
  assert(!resultWords.test(row), 'the EXP 007 row states a result');
  return html.replace(exp006RowAnchor, `${row}\n      ${exp006RowAnchor}`);
}

/** The committed note must be exactly the render of the committed record; the build calls this. */
export async function assertNoteCurrent(root = '.') {
  const { record, sha256 } = await checkRecord(root);
  assert.equal(readFileSync(`${root}/${articlePath}`, 'utf8'), renderNote(record, sha256), `${articlePath} differs from the pre-registration: run node scripts/blueprint-floor-note.mjs --write`);
  return { record, sha256 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--write') { console.error('usage: node scripts/blueprint-floor-note.mjs --write'); process.exit(2); }
  const { record, sha256 } = await checkRecord();
  writeFileSync(articlePath, renderNote(record, sha256));
  console.log(`Wrote ${articlePath} from the pre-registration (${sha256}).`);
}
