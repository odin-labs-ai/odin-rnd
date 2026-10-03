// Renders the public EXP 009 (composable-harness) pre-registration note from its committed record:
// site/journal/composable-harness-pre-registration.html, from experiments/composable-harness/preregistration.json,
// which is published byte for byte under site/data/composable-harness/. Every figure on the page is read from the
// record. The shared build (scripts/build.mjs) is not touched; the page, the data copy, the home-page row and the
// sitemap entry are committed under site/, which the build publishes as is. Same pattern as latent-handoff-site.mjs.
//   node scripts/composable-site.mjs --write   write the page, the data copy, the home-page row and the sitemap
//   node scripts/composable-site.mjs --check   check everything is current
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRecord, KERNEL_WORDING, publishedPath, recordPath, TO_FREEZE } from './composable-prereg.mjs';

export const noteSlug = 'composable-harness-pre-registration';
export const notePath = `site/journal/${noteSlug}.html`;
// Rebase-time check: 004 is held by an earlier experiment's note; confirm the next free number before publication.
export const noteNumber = '006';
const SITE = 'https://odin-labs-ai.github.io/odin-rnd/';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const shortDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const hex = /^[a-f0-9]{64}$/;
const value = v => (v === TO_FREEZE ? '<strong>to be frozen</strong>' : code(v));
const header = (title, description, canonical) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${SITE}${canonical}"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

export const resultWords = /\b(results? show|wins?|won|beats?|outperform\w*|proven|passe[sd]|confirmed|demonstrat\w+)\b/i;
// The page body names files (proven-core.ts) and states gate rules ("--verify passes"), so it gets a narrower guard:
// a sentence that reports an outcome.
export const pageResultWords = /\b(results? show|we (?:found|show)|outperform\w*|beats? the|confirmed|demonstrat\w+|diverged in \d)\b/i;

/** The pre-registration note, every sentence of substance read from the record. */
export function renderNote(record, recordSha256) {
  assert.match(recordSha256, hex, 'The note needs the sha256 of the record it renders');
  const { experiment: e, corpus: c, schedule: s, primary: { P1, P2 }, memoryWindow: w } = record;
  const draft = record.freeze.status !== 'frozen';
  const title = `${e.id}: ${e.title}, the pre-registration`;
  const pins = Object.entries(P2.baseline.pins).map(([k, p]) => `${escape(k)}: commit ${code(p.commit.slice(0, 12))}, ${Object.entries(p.sha256).map(([f, d]) => `${code(f.split('/').pop())} ${code(d.slice(0, 12))}…`).join(', ')}`);
  return `${header(title, `Field notes from Odin R&D. ${draft ? 'A draft of the pre-registration' : 'The pre-registration'} of ${e.id}, shown before the counted run: ${e.summary}`, `journal/${noteSlug}.html`)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(title)}</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · ${draft ? 'DRAFT' : 'PRE-REGISTERED'} ${escape(day(record.freeze.frozenOn ?? e.authoredOn))} · NOT YET RUN</p></header><article class="article-body">
${draft ? `<p><strong>Draft.</strong> ${escape(record.freeze.rule)} Fields still to freeze: ${record.freeze.toFreeze.map(code).join(', ')}.</p>\n` : ''}<p><strong>${escape(e.statusText)}.</strong> ${escape(e.summary)} ${escape(e.note)}</p>
<h2>The question</h2>
${list([`<strong>In time.</strong> ${escape(record.question.temporal)}`, `<strong>In space.</strong> ${escape(record.question.spatial)}`])}
<p>${escape(record.framing)} Inspired by ${escape(e.inspiredBy)}.</p>
<h2>The components</h2>
${list(record.components.map(x => `${code(x.name)}: ${escape(x.role)}`))}
<h2>The items</h2>
<p>${c.n} items: ${escape(c.sets.join(' and '))}. Corpus identity sha256 ${code(c.sha256)}; ${escape(c.identityRule)} ${escape(c.statement)}</p>
<h2>The arms</h2>
<table><thead><tr><th>Arm</th><th>What runs</th></tr></thead><tbody>${record.arms.map(a => `<tr><td>${escape(a.id)}</td><td>${escape(a.what)}</td></tr>`).join('')}</tbody></table>
<h2>The schedule</h2>
${list([escape(s.seedRule), `${s.trials} trials of ${s.opsPerTrial} operations (at least ${Math.round(s.minReconfigureShare * 100)}% reconfigures) with ${s.evaluationsPerTrial} evaluations each.`, `Block size ${value(s.blockSize)} trials; per-trial wall time ${value(s.perTrialWallSeconds)} s. ${escape(s.rule)}`])}
<h2>The claims</h2>
<p><strong>P1, equivalence in time.</strong> ${escape(P1.claim)} ${escape(P1.divergence)} With 0 divergences in ${P1.n}, the 95% Wilson upper bound is ${(P1.wilsonUpper95AtZero * 100).toFixed(2)}% (at most 1% from n = ${P1.minNForOnePercent}). Refuted by: ${escape(P1.refutedBy)}</p>
<p><strong>P2, soundness in space.</strong> ${escape(P2.claim)} ${escape(P2.silentInert)} ${escape(P2.falseInactive)} ${escape(P2.mapping)} Refuted by: ${escape(P2.refutedBy)}</p>
<h3>P2 was computed before registration</h3>
<p><strong>${escape(record.p2Disclosure.statement)}</strong> What it showed: the kernel was correct on ${record.p2Disclosure.seenOutcome.kernelCorrect} of ${record.p2Disclosure.seenOutcome.of} configurations, with ${record.p2Disclosure.seenOutcome.silentInert} silent-inert and ${record.p2Disclosure.seenOutcome.falseInactive} false-inactive; against the baseline, McNemar b = ${record.p2Disclosure.seenOutcome.mcnemar.b}, c = ${record.p2Disclosure.seenOutcome.mcnemar.c}. ${escape(record.p2Disclosure.weight)} ${escape(record.p2Disclosure.predictive)} Source: ${code(record.p2Disclosure.source)}.</p>
${list([
  `The ${P2.corpus.configs} configurations (${P2.corpus.faulty} faulty, ${P2.corpus.clean} clean): tree sha256 ${code(P2.corpus.tree.sha256)} (${P2.corpus.tree.files} files), spec sha256 ${code(P2.corpus.spec)}. ${escape(P2.corpus.authoring)}`,
  `Baseline. ${escape(P2.baseline.what)} ${pins.join('; ')}. At freeze it signalled ${P2.baseline.atFreeze.faultySignalled} of ${P2.corpus.faulty} faulty and ${P2.baseline.atFreeze.cleanSignalled} of ${P2.corpus.clean} clean configurations, and kept exactly the spec-enabled set in ${P2.baseline.atFreeze.agreesWithSpecEnabledAtBoot} of ${P2.corpus.configs}. ${escape(P2.baseline.comparison)}`,
])}
<h2>Secondary, deciding nothing</h2>
${list(record.secondary.map(x => `<strong>${escape(x.id)}.</strong> ${escape(x.statement)}`))}
<p>${escape(record.secondaryRule)}</p>
<h2>When a result is uninformative</h2>
${list(record.validityGates.map(escape))}
<p>${escape(record.validityRule)}</p>
<h2>The analysis</h2>
<p>${escape(record.analysis.rule)} Spec ${code(record.analysis.spec)} (sha256 ${value(record.files[record.analysis.spec] ?? record.pendingFiles[record.analysis.spec])}). File ${code(record.analysis.file)} (sha256 ${value(record.files[record.analysis.file] ?? record.pendingFiles[record.analysis.file])}), tests ${code(record.analysis.tests)} (sha256 ${value(record.files[record.analysis.tests] ?? record.pendingFiles[record.analysis.tests])}).</p>
${list(record.analysis.definitions.map(escape))}
<h2>Fences</h2>
${list(record.fences.map(escape))}
<h2>Memory, spend and the not-before</h2>
${list([`Every measured block runs under ${code(w.wrapper)}: a window opens when ${escape(w.opens)}; ${escape(w.breach)}; ${escape(w.exclusive)}. Unload memory tolerance ${value(w.mxMemoryToleranceGB)} GB.`, escape(record.spend.rule), escape(record.notBefore)])}
<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../data/composable-harness/preregistration.json"><code>preregistration.json</code></a>, the committed record at ${code(recordPath)}, whose sha256 is ${code(recordSha256)}. The site publishes that file byte for byte, and a repository test re-renders this page from it and fails if they differ. A validator rebuilds the record from the harness files and refuses any difference; it pins ${Object.keys(record.files).length} files by sha256${Object.keys(record.pendingFiles).length ? `; ${Object.keys(record.pendingFiles).length} more are still to be committed and frozen` : ''}.</p>
<p class="article-note">The counted run has not started. ${draft ? 'This is a draft: the results will be judged against the frozen record once it is published, never against this draft.' : 'The results, when they exist, will be judged against this record as published, and reported as they come out.'}</p>
</article></main>${footer}`;
}

export function renderJournalRow(record) {
  const e = record.experiment, date = record.freeze.frozenOn ?? e.authoredOn;
  return `<a class="journal-row" href="journal/${noteSlug}.html"><div class="journal-date"><time datetime="${escape(date)}">${shortDate(date)}</time><span class="technical">EXPERIMENT NOTE / ${noteNumber}</span></div><div><h3>${escape(e.id)}: ${escape(e.title)}: <br>the pre-registration</h3><p>${escape(e.summary)} ${record.freeze.status === 'frozen' ? 'Pre-registered; not yet run.' : 'Draft; not yet run.'}</p></div><span class="journal-arrow" aria-hidden="true">↗</span></a>`;
}

// The newest field note goes first: directly above EXP 008's row, which keeps EXP 008's own home-page check stable.
const anchorRow = '<a class="journal-row" href="journal/latent-handoff-pre-registration.html">';
export function withHome(html, record) {
  const row = renderJournalRow(record);
  assert(!resultWords.test(row), 'the EXP 009 row states a result');
  const out = html.replace(/<a class="journal-row" href="journal\/composable-harness-pre-registration\.html">[\s\S]*?<\/a>\n      /, '');
  assert.equal(out.split(anchorRow).length, 2, 'the home page carries the EXP 008 field-note row exactly once');
  return out.replace(anchorRow, `${row}\n      ${anchorRow}`);
}

export const sitemapUrl = `${SITE}journal/${noteSlug}.html`;
export function withSitemap(xml) {
  const out = xml.replace(`<url><loc>${sitemapUrl}</loc></url>`, '');
  // Directly before EXP 008's entries, which its own sitemap check re-inserts before work-with-us: both stay stable.
  const anchor = `<url><loc>${SITE}journal/latent-handoff-pre-registration.html</loc></url>`;
  assert.equal(out.split(anchor).length, 2, 'the sitemap carries the EXP 008 note entry exactly once');
  return out.replace(anchor, `<url><loc>${sitemapUrl}</loc></url>${anchor}`);
}

/** Everything the site carries for EXP 009, as it must be on disk. */
export async function expected(root = '.') {
  const read = f => readFileSync(join(root, f), 'utf8');
  const { record, sha256 } = await checkRecord(root);
  const note = renderNote(record, sha256);
  assert.ok(note.includes(KERNEL_WORDING), `the page says "${KERNEL_WORDING}"`);
  assert.ok(!pageResultWords.test(note.replace(/<[^>]+>/g, ' ')), 'the page states a result');
  return {
    [notePath]: note,
    [publishedPath]: read(recordPath),
    'site/index.html': withHome(read('site/index.html'), record),
    'site/sitemap.xml': withSitemap(read('site/sitemap.xml')),
  };
}

export async function assertSiteCurrent(root = '.') {
  const want = await expected(root);
  for (const [file, body] of Object.entries(want)) assert.equal(readFileSync(join(root, file), 'utf8'), body, `${file} is not current; run node scripts/composable-site.mjs --write`);
  return want;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === '--write') {
    for (const [file, body] of Object.entries(await expected())) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }
    console.log(`Wrote ${notePath}, the data copy, the home-page row and the sitemap entry.`);
  } else if (command === '--check') {
    await assertSiteCurrent();
    console.log('PASS composable-harness page, data copy, home page and sitemap are current');
  } else {
    console.error('usage: node scripts/composable-site.mjs --write | --check');
    process.exit(2);
  }
}
