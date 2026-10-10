// Renders the public EXP 009 (composable-harness) results note from the committed results record:
// site/journal/composable-harness-results.html, from results/composable-harness/results.json, which is published byte for
// byte under site/data/composable-harness/. The results record is first recomputed from the raw records with the frozen
// analysis (scripts/composable-results.mjs check) and bound to the counted run's raw files; any difference stops here.
// Every figure on the page is read from the results record or the pre-registration. The shared build (scripts/build.mjs)
// is not touched, and the pre-registration's page, row and sitemap entry (scripts/composable-site.mjs) are left as they
// are: the results get their own page, home-page row and sitemap entry, placed directly above the pre-registration's.
//   node scripts/composable-results-site.mjs --write   write the page, the data copy, the home-page row and the sitemap
//   node scripts/composable-results-site.mjs --check   check everything is current
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KERNEL_WORDING } from './composable-prereg.mjs';
import { check, RAW_ROOT, RESULTS_PATH } from './composable-results.mjs';
import { noteSlug as preregSlug } from './composable-site.mjs';

export const noteSlug = 'composable-harness-results';
export const notePath = `site/journal/${noteSlug}.html`;
export const publishedPath = 'site/data/composable-harness/results.json';
export const noteNumber = '007';
/**
 * The counted run's raw files, pinned: sha256 over the sorted "<sha256>  <path under the counted root>\n" lines of every
 * raw file, as the orchestrator's backup manifest (raw-backup-20261009.sha256, taken after the last block and before any
 * results code existed) lists them. A consistent rewrite of a raw record and the results record cannot pass this.
 */
export const RAW_MANIFEST_SHA256 = '5331ac78cd575a41d986b50642474d59477fe936746a449c099b1d39f0e09d81';
export const P2_LABEL = 'P2 pre-computed before registration: a disclosure, not a prediction';
const SITE = 'https://odin-labs-ai.github.io/odin-rnd/';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const shortDate = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y.slice(2)}`; };
const pct = (x, digits = 2) => `${(x * 100).toFixed(digits)}%`;
// The site chrome, as scripts/composable-site.mjs renders it for the pre-registration note.
const header = (title, description, canonical) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${SITE}${canonical}"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

/** The raw-file manifest digest of a results record (see RAW_MANIFEST_SHA256). */
export function rawManifestSha256(results) {
  const lines = results.raw.map(f => [f.path.slice(`${RAW_ROOT}/`.length), f.sha256]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(lines.map(([p, h]) => `${h}  ${p}\n`).join(''));
}

/** One sentence per claim, from the results record. */
export function headline(results) {
  const { P1, P2, validity } = results.result;
  const gates = validity.informative ? `All ${validity.gates.length} validity gates passed, so the record is informative.` : `A validity gate failed (${validity.gates.filter(g => !g.pass).map(g => g.id).join(', ')}), so every claim is uninformative.`;
  return {
    P1: `P1 ${P1.verdict}: ${P1.divergentTrials} of ${P1.n} H1 trials diverged from R0 (95% Wilson upper bound ${pct(P1.wilsonUpper95)}).`,
    P2: `P2 ${P2.verdict}: ${P2.kernel.silentInert} silent-inert and ${P2.kernel.falseInactive} false-inactive kernel configurations of ${P2.n}.`,
    gates,
  };
}

/** The results note. `record` is the pre-registration; `results` the results record; `resultsSha256` its digest. */
export function renderNote(record, results, resultsSha256) {
  const r = results.result, { P1, P2, S1, S2, S3 } = r, e = record.experiment;
  const h = headline(results);
  const title = `${e.id}: ${e.title}, the results`;
  const measured = results.run.lastEndedAt;
  const verdictRows = ['P1', 'P2'].map(id => `<tr><td>${id}</td><td>${escape(results.verdicts[id].claim)}</td><td><strong>${escape(results.verdicts[id].verdict)}</strong></td><td>${escape(results.verdicts[id].refutedBy)}</td></tr>`).join('');
  const divergences = results.p1Divergences.map(t => `<li>Block ${t.block}, trial ${t.trial}: ${t.divergences.length} divergence(s).${list(t.divergences.map(d => `step ${escape(d.step)}, ${escape(d.kind)}: ${code(JSON.stringify(d.detail))}`))}</li>`).join('');
  return `${header(title, `Field notes from Odin R&D. The measured results of ${e.id}, judged against its published pre-registration: ${h.P1} ${h.P2}`, `journal/${noteSlug}.html`)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(title)}</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · MEASURED ${escape(day(measured))}</p></header><article class="article-body">
<p><strong>Measured.</strong> ${escape(h.P1)} ${escape(h.P2)} ${escape(h.gates)} The counted run was ${results.run.blocks} window-held blocks from ${escape(results.run.firstStartedAt)} to ${escape(measured)}, judged against <a href="${preregSlug}.html">the pre-registration</a> with its frozen analysis, unchanged.</p>
<p>${escape(record.framing)}</p>
<h2>The verdict per claim</h2>
<div class="table-scroll"><table><thead><tr><th>Claim</th><th>As pre-registered</th><th>Verdict</th><th>Refuted by</th></tr></thead><tbody>${verdictRows}</tbody></table></div>
<p>${escape(results.verdicts.validityRule)} The verdict words are the frozen analysis's own (${code('analysis/analyse.mjs')}): ${code('supported')}, ${code('refuted')}, ${code('underpowered')} or ${code('uninformative')}.</p>
<h2>P1, equivalence in time</h2>
<p>${P1.divergentTrials} of ${P1.n} H1 trials had at least one divergence from R0; the 95% Wilson upper bound on the divergence rate is ${pct(P1.wilsonUpper95)} (${code(P1.wilsonUpper95)}). The record's rule is "${escape(record.primary.P1.refutedBy)}", so P1 is ${escape(P1.verdict)}. Every divergent trial, as recorded:</p>
${divergences ? `<ul>${divergences}</ul>` : '<p>None.</p>'}
${results.disclosures.filter(d => d.id === 'divergence-diagnosis').map(d => `<p>${escape(d.text)}</p>`).join('\n')}
<h2>P2, soundness in space</h2>
<p><strong>${escape(P2_LABEL)}.</strong></p>
<p>Kernel census on the ${P2.n} blind-authored configurations (${P2.faulty} faulty): ${P2.kernel.silentInert} silent-inert, ${P2.kernel.falseInactive} false-inactive, ${P2.kernelMislabelled} mislabelled; correct on ${P2.kernelCorrect} of ${P2.n}. The unchanged baseline filter: correct on ${P2.baselineCorrect} of ${P2.n}, with ${P2.baseline.silentInert} silent-inert, ${P2.baseline.silentDropped} silent-dropped and ${P2.baseline.falseInactive} false-inactive. McNemar on kernel-correct against baseline-correct: b = ${P2.mcnemar.b}, c = ${P2.mcnemar.c}, exact two-sided p = ${code(P2.mcnemar.p)} (secondary; it decides nothing). P2 is ${escape(P2.verdict)}.</p>
<p>${escape(record.p2Disclosure.statement)} ${escape(record.p2Disclosure.weight)} ${escape(record.p2Disclosure.predictive)}</p>
<h2>Secondary, deciding nothing</h2>
${list([
  `<strong>S1.</strong> ${S1.residueTrials} of ${S1.n} H2 trials left residue (share ${escape(S1.share)}): ${escape(S1.statement)}. H2's decision mismatches against R0, expected by design: ${S1.mismatchTrials} of ${S1.n} trials.`,
  `<strong>S2.</strong> K1 detected ${S2.k1Detected} of its ${S2.k1Of} planted leaks; K2 left ${S2.k2ResidueProbes} residue probes.`,
  `<strong>S3.</strong> Not measured (H1 median ${escape(S3.h1MedianReadyMs)}, R0 median ${escape(S3.r0MedianReadyMs)}): see the disclosures.`,
])}
<p>${escape(record.secondaryRule)} ${escape(r.decides)}.</p>
<h2>Validity gates</h2>
<div class="table-scroll"><table><thead><tr><th>Gate</th><th>Result</th><th>Detail</th></tr></thead><tbody>${r.validity.gates.map(g => `<tr><td>${escape(g.id)}</td><td>${g.pass ? 'pass' : '<strong>fail</strong>'}</td><td>${escape(g.detail)}</td></tr>`).join('')}</tbody></table></div>
<h2>Disclosures</h2>
${list(results.disclosures.map(d => escape(d.text)))}
<h2>What this does not establish</h2>
${list(results.limits.map(escape))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../data/composable-harness/results.json"><code>results.json</code></a>, the committed results record at ${code(RESULTS_PATH)}, whose sha256 is ${code(resultsSha256)}. That record is the output of the frozen ${code(results.analysis.file)} (sha256 ${code(results.analysis.sha256)}) over the ${results.raw.length} committed raw files under ${code(`${RAW_ROOT}/`)}, each listed in it with its sha256. A repository check recomputes it from those files and refuses any difference, and binds the raw files to the manifest taken after the last block (digest ${code(RAW_MANIFEST_SHA256)}). The pre-registration it is judged against is ${code(results.record.path)} (sha256 ${code(results.record.sha256)}), published by merge ${code(results.record.mergeCommit)}; seed ${code(results.record.seed)}.</p>
</article></main>${footer}`;
}

export function renderJournalRow(record, results) {
  const e = record.experiment, date = results.run.lastEndedAt.slice(0, 10), h = headline(results);
  return `<a class="journal-row" href="journal/${noteSlug}.html"><div class="journal-date"><time datetime="${escape(date)}">${shortDate(date)}</time><span class="technical">EXPERIMENT NOTE / ${noteNumber}</span></div><div><h3>${escape(e.id)}: ${escape(e.title)}: <br>the results</h3><p>${escape(h.P1)} ${escape(h.P2)} ${escape(h.gates)}</p></div><span class="journal-arrow" aria-hidden="true">↗</span></a>`;
}

// The results row goes directly above the pre-registration's row. composable-site.mjs strips and re-inserts that row
// directly above EXP 008's, which leaves this row where it is: both pages' checks stay stable.
const anchorRow = `<a class="journal-row" href="journal/${preregSlug}.html">`;
export function withHome(html, record, results) {
  const row = renderJournalRow(record, results);
  const out = html.replace(/<a class="journal-row" href="journal\/composable-harness-results\.html">[\s\S]*?<\/a>\n {6}/, '');
  assert.equal(out.split(anchorRow).length, 2, 'the home page carries the EXP 009 pre-registration row exactly once');
  return out.replace(anchorRow, `${row}\n      ${anchorRow}`);
}

export const sitemapUrl = `${SITE}journal/${noteSlug}.html`;
export function withSitemap(xml) {
  const out = xml.replace(`<url><loc>${sitemapUrl}</loc></url>`, '');
  const anchor = `<url><loc>${SITE}journal/${preregSlug}.html</loc></url>`;
  assert.equal(out.split(anchor).length, 2, 'the sitemap carries the EXP 009 pre-registration entry exactly once');
  return out.replace(anchor, `<url><loc>${sitemapUrl}</loc></url>${anchor}`);
}

/** Everything the site carries for the EXP 009 results, as it must be on disk. */
export function expected(root = '.') {
  const read = f => readFileSync(join(root, f), 'utf8');
  const { sha256: resultsSha256, results } = check(root);
  assert.equal(rawManifestSha256(results), RAW_MANIFEST_SHA256, 'the raw records are not the counted run\'s (raw manifest digest differs)');
  const record = JSON.parse(read(results.record.path));
  assert.equal(sha256(readFileSync(join(root, results.record.path))), results.record.sha256, 'the pre-registration is not the one the results were judged against');
  const note = renderNote(record, results, resultsSha256);
  assert.ok(note.includes(KERNEL_WORDING), `the page says "${KERNEL_WORDING}"`);
  assert.ok(note.includes(P2_LABEL), 'the page carries the P2 label');
  for (const limit of results.limits) assert.ok(note.includes(escape(limit)), 'the page carries every limit, verbatim');
  return {
    [notePath]: note,
    [publishedPath]: read(RESULTS_PATH),
    'site/index.html': withHome(read('site/index.html'), record, results),
    'site/sitemap.xml': withSitemap(read('site/sitemap.xml')),
  };
}

export function assertSiteCurrent(root = '.') {
  const want = expected(root);
  for (const [file, body] of Object.entries(want)) assert.equal(readFileSync(join(root, file), 'utf8'), body, `${file} is not current; run node scripts/composable-results-site.mjs --write`);
  return want;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === '--write') {
    for (const [file, body] of Object.entries(expected())) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }
    console.log(`Wrote ${notePath}, the data copy, the home-page row and the sitemap entry.`);
  } else if (command === '--check') {
    assertSiteCurrent();
    console.log('PASS composable-harness results page, data copy, home page and sitemap are current');
  } else {
    console.error('usage: node scripts/composable-results-site.mjs --write | --check');
    process.exit(2);
  }
}
