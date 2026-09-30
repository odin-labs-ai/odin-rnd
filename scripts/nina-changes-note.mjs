// Renders the public EXP 006 pages from experiments/nina-changes/preregistration.json: the pre-registration field note
// (site/journal/nina-reviews-the-change.html) and its row in the home page's field notes. Every figure is read from
// the record; the build and the tests re-render both and fail if a page drifts from it. It adds pages beside EXP 005's
// and edits none of EXP 005's renderers (their files are pinned by EXP 005's records).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRecord } from './nina-changes-prereg.mjs';

export const slug = 'nina-reviews-the-change';
export const articlePath = `site/journal/${slug}.html`;
export const dataPath = 'data/nina-changes/preregistration.json';
export const noteNumber = '003';
export const exp005SpotlightHref = 'jev-as-a-fast-gate.html#spotlight';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const link = (url, label) => `<a href="${escape(url)}">${escape(label)}</a>`;
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const nina = record => escape(record.attribution.nina).replace('github.com/xhulz/nina', `<a href="${escape(record.attribution.ninaUrl)}">github.com/xhulz/nina</a>`);

const header = (title, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="https://odin-labs-ai.github.io/odin-rnd/journal/${slug}.html"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

/** The field note: the record in prose. Nothing on it is a result. */
export function renderNote(record, recordSha256) {
  assert.match(recordSha256, /^[a-f0-9]{64}$/, 'The note needs the sha256 of the record it renders');
  const { experiment: e, reused: u, reviewer: r, fence: f, isolationEvidence: iso, classifier: c, bar: b, spend: s } = record;
  const title = `${e.id}: ${e.title}, the pre-registration`;
  const runRow = x => `<strong>${escape(x.name)}</strong> (${escape(x.variant)}, ${escape(x.role)}): ${x.rowsHeld ? `${escape(x.rowsHeld)} escape rows held, ${escape(x.controlsWorked)} controls worked, R28 ${escape(x.info.r28)}, I47 ${escape(x.info.i47)}` : escape(x.verdict)}; $${escape(x.costUsd.toFixed(7))}; record sha256 ${code(x.sha256)}`;
  return `${header(title, `Field notes from Odin R&D. The pre-registration of ${e.id}, published before any counted run: ${e.summary}`)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(e.id)}: ${escape(e.title)}, the pre-registration</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · PRE-REGISTERED ${escape(day(e.authoredOn))} · NOT YET RUN</p></header><article class="article-body">
<p><strong>Pre-registered, not yet run.</strong> ${escape(e.summary)} ${escape(e.note)}</p>
<h2>The question</h2>
<p>${escape(record.question)}</p>
<h2>Why measure again</h2>
<p>${escape(record.parent.finding)} This follows <a href="${exp005SpotlightHref}">EXP 005's held spotlight</a> (results record sha256 ${code(record.parent.results.sha256)}).</p>
<p>${escape(record.census.headline)}</p>
<h2>What is the same</h2>
<p>${escape(u.statement)} ${u.items} changes, ${u.red} RED and ${u.green} GREEN by bce; corpus sha256 ${code(u.corpusSha256)}; base commit ${code(u.baseCommit)}.</p>
${list([`The reviewer: ${nina(record)}, release ${code(u.nina.release)} (commit ${code(u.nina.commit)}). ${escape(u.nina.rule)}`, `${escape(u.client)} ${escape(u.clientVersion)}, model ${code(u.model)}, effort ${code(u.effort)}, agent ${code(u.agent)}, ${u.k} runs per change, ${u.timeoutSeconds} s per run. ${escape(u.order)}`, `The hang-stop: ${escape(u.hangStop.rule)}`])}
<p>The prompt, verbatim (EXP 005's):</p>
<pre tabindex="0">${escape(u.prompt)}</pre>
<h2>What changes: the fence, and the record of every tool call</h2>
${list(r.differences.map(escape))}
<p>${escape(r.commandRule)}</p>
<pre tabindex="0">${escape(r.command)}</pre>
<p>Allowed git forms: ${f.allowPrefixes.map(code).join(', ')} with ${f.verbs.map(code).join(', ')}. ${escape(f.compound)} ${escape(f.redirections)} Every EXP 005 deny rule stays: ${f.denyRules.map(code).join(' ')}. ${escape(r.runDirectory)}</p>
<h2>The fence, proven on canaries</h2>
<p>${escape(iso.judgedBy)}</p>
${list(iso.runs.map(runRow))}
<p>${escape(iso.codeStatement)} ${escape(iso.lostVerdict)} The probe of record is ${code(iso.probeOfRecord.file.split('/').pop())} (sha256 ${code(iso.probeOfRecord.sha256)}).</p>
<p>What the client did, from the recorded stream:</p>
${list(f.answers.map(a => `${escape(a.answer)} <span class="technical">(${escape(a.evidence)})</span>`))}
<h2>The manipulation check: did the reviewer see the change?</h2>
<p>${escape(c.rule)}</p>
${list([escape(c.refusals), escape(c.rename), escape(c.recompute), `Fingerprints: ${escape(c.fingerprints.rule)} (sha256 ${code(c.fingerprints.sha256)}; at least ${c.fingerprints.min} and at most ${c.fingerprints.max} per item). Base lines sha256 ${code(c.baseLines.sha256)}.`, `${c.addFileItems.length} items add a file (${c.addFileItems.map(code).join(', ')}); ${c.addOnlyItems} of them add only files.`])}
<p><strong>${escape(b.manipulation.rule)}</strong></p>
<h2>The bar: EXP 005's, unchanged</h2>
<p>${escape(b.statement)}</p>
${list(b.criteria.map(x => escape(x.statement)))}
<p>${escape(b.judging)}</p>
<p>${escape(b.rule)}</p>
<p>Harness failure: ${escape(b.harnessFailure)} ${escape(r.harnessFailureNote)}</p>
<p>${escape(b.mapping)}</p>
${list([escape(b.hookErrors), escape(b.diffSeenOnly), escape(b.partial), escape(b.percentile), `Each rate is published with its three-state label: ${Object.values(b.states).map(x => `<em>${escape(x)}</em>`).join(', ')}.`])}
<p>${escape(record.spotlightDecision)}</p>
<h2>Spend, the pre-flight and the clock</h2>
${list([`A cap of $${s.capUsd} on every paid call of ${escape(e.id)}, with a $${s.preCountedCeilingUsd} ceiling on everything before the counted run. ${escape(s.rule)}`, `Paid so far (${s.calls.length} matrix probes, none counted): ${escape(s.sum)} dollars.`, escape(s.bundle2), escape(s.askFork), escape(record.preflight), escape(record.notBefore)])}
<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../${dataPath}"><code>preregistration.json</code></a>, the committed record at ${code('experiments/nina-changes/preregistration.json')}, whose sha256 is ${code(recordSha256)}. The build publishes that file byte for byte, and a repository test re-renders this page from it and fails if they differ. A validator rebuilds the record from the files on disk.</p>
<p class="article-note">No counted run has started. The results, when they exist, will be judged against this record as published, and reported as they come out.</p>
</article></main>${footer}`;
}

const shortDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
/** The home page's field-note row, rendered from the record and inserted by the build above EXP 005's. */
export function renderJournalRow(record) {
  const e = record.experiment;
  return `<a class="journal-row" href="journal/${slug}.html"><div class="journal-date"><time datetime="${escape(e.authoredOn)}">${shortDate(e.authoredOn)}</time><span class="technical">EXPERIMENT NOTE / ${noteNumber}</span></div><div><h3>${escape(e.id)}: ${escape(e.title)}: <br>the pre-registration</h3><p>${escape(e.summary)} Pre-registered, not yet run.</p></div><span class="journal-arrow" aria-hidden="true">↗</span></a>`;
}
export const resultWords = /\b(results? show|wins?|won|beats?|outperform\w*|proven|passe[sd])\b/i;

/** The built home page with the EXP 006 row as the first field note. */
export function addJournalRow(html, record) {
  const anchor = '<a class="journal-row" href="journal/jev-as-a-fast-gate.html">';
  assert.equal(html.split(anchor).length, 2, 'the home page carries the EXP 005 field-note row exactly once');
  assert(!html.includes(`href="journal/${slug}.html"><div class="journal-date">`), 'the EXP 006 row is already there');
  const row = renderJournalRow(record);
  assert(!resultWords.test(row), 'the EXP 006 row states a result');
  return html.replace(anchor, `${row}\n      ${anchor}`);
}

/** The committed note must be exactly the render of the committed record; the build calls this. */
export function assertNoteCurrent(root = '.') {
  const { record, sha256 } = checkRecord(root);
  assert.equal(readFileSync(`${root}/${articlePath}`, 'utf8'), renderNote(record, sha256), `${articlePath} differs from the pre-registration: run node scripts/nina-changes-note.mjs --write`);
  return { record, sha256 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--write') { console.error('usage: node scripts/nina-changes-note.mjs --write'); process.exit(2); }
  const { record, sha256 } = checkRecord();
  writeFileSync(articlePath, renderNote(record, sha256));
  console.log(`Wrote ${articlePath} from the pre-registration (${sha256}).`);
}
