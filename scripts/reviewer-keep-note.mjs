// Renders the public EXP 011 (reviewer-keep) pre-registration note from its committed record:
// site/journal/where-a-model-reviewer-earns-its-keep.html, from experiments/reviewer-keep/preregistration.json (plus the
// files it pins: the eligibility decisions, the vendored rules and the baseline mapping), published byte for byte under
// site/data/reviewer-keep/. Every figure on the page is read from those files. The page, the data copy, the home-page row
// and the sitemap entry are committed under site/; scripts/build.mjs re-checks them and fails the build on any drift.
// Same shape as composable-site.mjs (EXP 009).
//   node scripts/reviewer-keep-note.mjs --write   write the page, the data copy, the home-page row and the sitemap entry
//   node scripts/reviewer-keep-note.mjs --check   check everything is current
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRecord, D, publishedPath, recordPath } from './reviewer-keep-prereg.mjs';

export const slug = 'where-a-model-reviewer-earns-its-keep';
export const articlePath = `site/journal/${slug}.html`;
export const dataPath = 'data/reviewer-keep/preregistration.json';
// The next free note number: 001-007 are held (EXP 009's results note is 007).
export const noteNumber = '008';
const SITE = 'https://odin-labs-ai.github.io/odin-rnd/';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const usd = n => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const range = r => (r.lowUsd === r.highUsd ? usd(r.lowUsd) : `${usd(r.lowUsd)}–${usd(r.highUsd)}`);
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const shortDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const header = (title, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${SITE}journal/${slug}.html"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

// A row or page sentence that reports an outcome. The page states gate rules ("the gate passes"), so it gets the narrower guard.
export const resultWords = /\b(results? show|wins?|won|beats?|outperform\w*|proven|refuted|passe[sd])\b/i;
export const pageResultWords = /\b(results? show|we (?:found|show)|outperform\w*|beats? the|confirmed|demonstrat\w+)\b/i;

/** The pinned files the page lists beside the record: the decisions and the baseline mapping. */
export function pageInputs(root = '.') {
  const json = f => JSON.parse(readFileSync(join(root, f), 'utf8'));
  const decisions = json(`${D}/eligibility.json`);
  const baselines = json(`${D}/baselines.json`);
  return { decisions, baselines };
}

/** The field note: the record in prose. Nothing on it is a result. */
export function renderNote(record, recordSha256, { decisions, baselines }) {
  assert.match(recordSha256, /^[a-f0-9]{64}$/, 'The note needs the sha256 of the record it renders');
  const { experiment: e, parents: p, eligibility: el, rules: r, fixture: f, items: it, labels: lb, arms: a, scoring: s, spend: sp } = record;
  const title = `${e.id} — ${e.title} ${e.statusText}`;
  const toolName = Object.fromEntries(baselines.tools.map(t => [t.id, t.name]));
  const mapping = Object.fromEntries(baselines.rules.map(x => [x.ruleId, x]));
  const eligible = decisions.filter(d => d.eligible), excluded = decisions.filter(d => !d.eligible);
  const ref = x => `${code(x.file)} (sha256 ${code(x.sha256)})`;
  return `${header(title, `Field notes from Odin R&D. The pre-registration of ${e.id}, published before any item or paid call exists: ${e.summary}`)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(e.id)} — ${escape(e.title)}</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · PRE-REGISTERED ${escape(day(e.authoredOn))} · NOT YET RUN</p></header><article class="article-body">
<p><strong>${escape(e.statusText)}.</strong> ${escape(e.summary)} ${escape(e.note)}</p>
<h2>The claim</h2>
<p>${escape(record.claim)}</p>
<p>${escape(record.claimReading)}</p>
<p>${escape(record.question)}</p>
<h2>Why ask it</h2>
${list([`<a href="jev-as-a-fast-gate.html">EXP 005</a>: ${escape(p.exp005.finding)} Record ${ref(p.exp005.preregistration)}; results ${ref(p.exp005.results)}.`, `<a href="nina-reviews-the-change.html">EXP 006</a>: ${escape(p.exp006.finding)} Record ${ref(p.exp006.preregistration)}; amendment 01 ${ref(p.exp006.amendment01)}; results ${ref(p.exp006.results)}.`, `<a href="which-rules-need-a-model.html">EXP 007</a>: ${escape(p.exp007.finding)} Recomputed from its results: ${p.exp007.primaryClasses.expressible} expressible, ${p.exp007.primaryClasses.partial} partial, ${p.exp007.primaryClasses.not} not, ${p.exp007.primaryClasses.error} error. Record ${ref(p.exp007.preregistration)}; amendment 01 ${ref(p.exp007.amendment01)}; results ${ref(p.exp007.results)}.`])}
<h2>The rules: ${el.eligible} of ${el.rules}, by a filter frozen before any item</h2>
<p>${escape(el.source)} ${escape(el.decidedBy)} ${escape(el.killFloor)}</p>
<p>Per plugin: ${Object.entries(el.perPlugin).map(([k, v]) => `${escape(k)} ${v}`).join(', ')}. Excluded, by reason: ${Object.entries(el.perCode).filter(([k]) => k !== 'ELIGIBLE').map(([k, v]) => `${code(k)} ${v}`).join(', ')}. Criteria ${ref(el.criteria)}; decisions ${ref(el.decisions)}.</p>
<p>${escape(r.statement)}</p>
${list(r.plugins.map(x => `<strong>${escape(x.plugin)}</strong> (${code(x.repo)} at ${code(x.sha.slice(0, 8))}; ${escape(x.license)}, ${escape(x.copyright)}): ${x.rules} rule${x.rules === 1 ? '' : 's'}, ${code(x.file)}`))}
<h3>The ${eligible.length} eligible rules and the model-free tools mapped to each</h3>
<p>Each rule's text, verbatim, is in its vendored record (${r.plugins.map(x => code(x.file)).join(', ')}).</p>
<table><thead><tr><th>Rule</th><th>Tools</th><th>Why</th></tr></thead><tbody>${eligible.map(d => `<tr><td>${code(d.ruleId)}</td><td>${mapping[d.ruleId].tools.length ? mapping[d.ruleId].tools.map(t => code(toolName[t])).join(' ') : 'none'}</td><td>${escape(mapping[d.ruleId].reason)}</td></tr>`).join('')}</tbody></table>
<h3>The ${excluded.length} excluded rules, each with its reason</h3>
${list(excluded.map(d => `${code(d.ruleId)}: ${code(d.code)}${d.uncertain ? ' (uncertain)' : ''}. ${escape(d.reason)}`))}
<h2>The fixture and the items</h2>
<p>${escape(f.description)} ${f.files} files, manifest ${ref(f.manifest)}. ${escape(f.authoredBy)}</p>
<pre tabindex="0">${escape(f.history)}</pre>
<p>${escape(f.baseCleanliness)}</p>
${list([`${it.perRule.red} RED and ${it.perRule.green} GREEN items per rule: ${it.red} RED and ${it.green} GREEN, ${it.total} in all. ${escape(it.status)}`, escape(it.nearMiss), escape(it.shown), escape(r.ruleFileShown), escape(it.cleanMeans), escape(it.onePrior), `${escape(it.controls.statement)} ${escape(it.controls.batch)}`])}
<h2>The labels</h2>
${list([`Author: ${escape(lb.author.family)}, model ${escape(lb.author.model)}. ${escape(lb.author.fence)}`, `Blind labeller: ${escape(lb.labeller.family)}, model ${escape(lb.labeller.model)}. ${escape(lb.labeller.blind)}`, `Human spot-check: ${lb.humanSpotCheck.n} items (${lb.humanSpotCheck.red} RED, ${lb.humanSpotCheck.green} GREEN; ${escape(lb.humanSpotCheck.share)}), seed ${lb.humanSpotCheck.seed}. ${escape(lb.humanSpotCheck.procedure)}`, escape(lb.agreementBar.statement), escape(lb.disagreements)])}
<h2>The arms</h2>
<p><strong>The reviewer.</strong> nina ${escape(a.reviewer.nina.release)} at ${code(a.reviewer.nina.commit)}, ${code(a.reviewer.model)}, ${escape(a.reviewer.client)} ${escape(a.reviewer.clientVersion)}, effort ${code(a.reviewer.effort)}, ${a.reviewer.runsPerItem} runs per item. ${escape(a.reviewer.statement)} ${escape(a.reviewer.ignoreList)} Its prompt, ${ref(a.reviewer.prompt)}:</p>
<pre tabindex="0">${escape(a.reviewer.promptText)}</pre>
<p>Reused from EXP 006 at commit ${code(a.reviewer.reusedFromExp006.commit.slice(0, 12))}: ${Object.keys(a.reviewer.reusedFromExp006.files).map(x => code(x.split('/').pop())).join(', ')}.</p>
<p><strong>The comparator: ${escape(record.comparatorName)}.</strong> ${escape(a.baselines.statement)} ${escape(a.baselines.or)} Mapping ${ref(a.baselines.mapping)}.</p>
${list(a.baselines.tools.map(t => `${code(t.command)}${Object.keys(t.packages).length ? `: ${Object.entries(t.packages).map(([k, v]) => `${escape(k)} ${escape(v)}`).join(', ')}` : ''}`))}
<pre tabindex="0">${escape(a.baselines.churn)}</pre>
<p>References: ${a.references.map(escape).join('; ')}. <strong>Jev:</strong> ${escape(a.jev)}</p>
<h2 id="bar">The bar</h2>
<pre tabindex="0">${escape(s.primary.verbatim)}</pre>
<p><strong>Matched budget.</strong> ${escape(s.primary.matchedBudget)}</p>
${list([escape(s.primary.runsPerItem), escape(s.primary.interval), escape(s.primary.comparatorFixed), escape(s.primary.itemCall), escape(s.primary.reported)])}
<p>The best baseline, one definition for the hardness gate and the primary:</p>
<pre tabindex="0">${s.bestBaseline.map(escape).join('\n')}</pre>
<p>The scorer is ${ref(s.scorer)}, frozen with this record.</p>
<h3>Secondary, gates and controls</h3>
${list([...s.secondary.map(x => `<strong>${escape(x.id)}</strong>: ${escape(x.statement)}`), `<strong>Hardness gate</strong>: ${escape(s.hardnessGate)}`, `<strong>Manipulation</strong>: ${escape(s.manipulation)}`, `<strong>Controls</strong>: ${escape(s.controls)}`])}
<h2 id="kill">Floors and kills</h2>
<pre tabindex="0">${record.floors.map(escape).join('\n')}</pre>
${list(record.kills.map(escape))}
<h2 id="preconditions">Before the first paid call</h2>
${list(record.preconditions.map(escape))}
<h2>Spend and the clock</h2>
<p><strong>Cap:</strong> ${escape(sp.capStatus)}. Pre-counted ceiling ${usd(sp.preCountedCeilingUsd)}. ${escape(sp.thisBundle)}</p>
<table><thead><tr><th>Item</th><th>Estimate</th></tr></thead><tbody>${sp.estimate.map(x => `<tr><td>${escape(x.item)}</td><td>${range(x)}</td></tr>`).join('')}</tbody></table>
${list([`${sp.countedRuns} counted runs at ${usd(sp.perRunUsd[0])}–${usd(sp.perRunUsd[1])} each.`, escape(sp.breaker), escape(sp.fallback), `Not before ${escape(record.notBefore)}.`])}
<pre tabindex="0">${escape(sp.ceilingTrip)}</pre>
<h2>Decisions the design left open</h2>
${list(record.decisions.map(escape))}
<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<p>Publication: ${escape(record.publication)}.</p>
<h2>Provenance</h2>
<p>This page is rendered from <a href="../${dataPath}"><code>preregistration.json</code></a>, the committed record at ${code(recordPath)}, whose sha256 is ${code(recordSha256)}. The site publishes that file byte for byte, and a repository test re-renders this page from it and fails if they differ. A validator rebuilds every file fact in the record from the files on disk; it pins ${Object.keys(record.files).length} files by sha256.</p>
<p class="article-note">No item exists and no paid call has been made. The results, when they exist, will be judged against this record as published, and reported as they come out, whichever way they go.</p>
</article></main>${footer}`;
}

/** The home page's field-note row, rendered from the record. */
export function renderJournalRow(record) {
  const e = record.experiment;
  return `<a class="journal-row" href="journal/${slug}.html"><div class="journal-date"><time datetime="${escape(e.authoredOn)}">${shortDate(e.authoredOn)}</time><span class="technical">EXPERIMENT NOTE / ${noteNumber}</span></div><div><h3>${escape(e.id)}: ${escape(e.title)} <br>the pre-registration</h3><p>${escape(e.summary)} Pre-registered; not yet run.</p></div><span class="journal-arrow" aria-hidden="true">↗</span></a>`;
}

// The newest note goes first: directly above EXP 009's results row, the current top row, found by its structure (the opening
// tag of its journal-row link, with or without a #fragment), never by its text. EXP 009's results check removes
// and re-inserts its row above EXP 009's pre-registration row, which leaves this row in place.
export const topRowPattern = /<a class="journal-row" href="journal\/composable-harness-results\.html(?:#[^"]*)?">/g;
const ownRowPattern = new RegExp(`<a class="journal-row" href="journal/${slug}\\.html">[\\s\\S]*?</a>\\n {6}`);
export function withHome(html, record) {
  const row = renderJournalRow(record);
  assert(!resultWords.test(row), 'the EXP 011 row states a result');
  const out = html.replace(ownRowPattern, '');
  const openings = [...out.matchAll(topRowPattern)];
  assert.equal(openings.length, 1, 'the home page carries the EXP 009 results row exactly once');
  const at = openings[0].index;
  return `${out.slice(0, at)}${row}\n      ${out.slice(at)}`;
}

export const sitemapUrl = `${SITE}journal/${slug}.html`;
/** The sitemap entry, directly before EXP 009's results entry (which its own check re-inserts before EXP 009's pre-registration entry: both stay stable). */
export function withSitemap(xml) {
  const out = xml.replace(`<url><loc>${sitemapUrl}</loc></url>`, '');
  const anchor = `<url><loc>${SITE}journal/composable-harness-results.html</loc></url>`;
  assert.equal(out.split(anchor).length, 2, 'the sitemap carries the EXP 009 results entry exactly once');
  return out.replace(anchor, `<url><loc>${sitemapUrl}</loc></url>${anchor}`);
}

/** Everything the site carries for EXP 011, as it must be on disk. */
export function expected(root = '.') {
  const read = file => readFileSync(join(root, file), 'utf8');
  const { record, sha256 } = checkRecord(root);
  const note = renderNote(record, sha256, pageInputs(root));
  return {
    [articlePath]: note,
    [publishedPath]: read(recordPath),
    'site/index.html': withHome(read('site/index.html'), record),
    'site/sitemap.xml': withSitemap(read('site/sitemap.xml')),
  };
}

/** The committed page, data copy, home row and sitemap entry must be exactly the render of the record; the build calls this. */
export function assertSiteCurrent(root = '.') {
  const want = expected(root);
  for (const [file, body] of Object.entries(want)) assert.equal(readFileSync(join(root, file), 'utf8'), body, `${file} is not current; run node scripts/reviewer-keep-note.mjs --write`);
  return { ...checkRecord(root), want };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === '--write') {
    for (const [file, body] of Object.entries(expected())) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }
    console.log(`Wrote ${articlePath}, the data copy, the home-page row and the sitemap entry.`);
  } else if (command === '--check') {
    assertSiteCurrent();
    console.log('PASS reviewer-keep page, data copy, home page and sitemap are current');
  } else {
    console.error('usage: node scripts/reviewer-keep-note.mjs --write | --check');
    process.exit(2);
  }
}
