// Renders the "System-1 decisions without lock-in" field note FROM a measured results record.
// The record is produced by the laya-vs-jev experiment runner and copied here verbatim, with its
// sha256 and source path recorded in site/data/laya-vs-jev/manifest.json. Fixtures render only in
// tests and carry a visible FIXTURE banner; --write refuses them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const slug = 'system-1-decisions-without-lock-in';
export const articlePath = `site/journal/${slug}.html`;
export const dataDir = 'site/data/laya-vs-jev';
export const accessedOn = '2026-09-24';
export const topLevelKeys = ['schemaVersion','measuredAt','machine','models','corpus','perModel','agreement','notes'];
export const metricKeys = ['accuracy','calibratedAccuracy','p50Ms','p90Ms','maxMs','coldLoadS','costPer1kUsd'];
// Written before any result was copied into this repository; see the commit that introduced this file.
export const refutation = {
  accuracyMarginPoints: 10,
  parityMaxDelta: 0.01,
};

// Vendor and third-party pages are CLAIMS. Nothing here is measured by Odin.
export const sources = [
  { id: 'typesafe-launch', label: 'TypeSafe AI, “Introducing System One Models & Jev” (15 Sep 2026)', url: 'https://typesafe.ai/blog/introducing-system-one-models-and-jev', kind: 'vendor claim', claim: 'Jev returns typed, probabilistic decisions instead of text; end-to-end response 70–500 ms; input $0.042 per million tokens, output free.' },
  { id: 'laya-card', label: 'Convai Innovations, Laya model card, Hugging Face revision 55cf4c4', url: 'https://huggingface.co/convaiinnovations/laya/blob/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/README.md', kind: 'model-author claim', claim: 'Apache-2.0; ModernBERT-large backbone plus a decision head, 421M parameters; fine-tuned typed-decisions checkpoint 0.766 accuracy against a published Jev 1.13.0 figure of 0.727; 32.8–39.5 ms per question on a T4 GPU, 193–464 ms on CPU. The card states its Jev figures are third-party published, not measured by the authors.' },
  { id: 'laya-eval', label: 'Laya eval/results.md, Hugging Face revision 55cf4c4', url: 'https://huggingface.co/convaiinnovations/laya/blob/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/eval/results.md', kind: 'model-author claim', claim: 'Overall in-task accuracy 0.753 (ECE 0.030); zero-shot accuracy 0.651 (ECE 0.204) on held-out task families.' },
  { id: 'jev-ai-compare', label: 'Jev AI, “Jev vs Laya” comparison page (independently operated, not TypeSafe)', url: 'https://jev-ai.pro/compare/jev-vs-laya', kind: 'third-party claim', claim: 'JevBench v1.4.0 hard tier: Jev 74.1% against Laya 34.1%; judge tier 94.5% against 69.2%; Jev 0.65 s median on the hosted API. The bare /compare index returned HTTP 404 on the access date.' },
  { id: 'medium-raju', label: 'Sathish Raju, “What Is Jev? A Practical Look at TypeSafe’s System One Model”, Medium, Sep 2026', url: 'https://medium.com/@sathishkraju/what-is-jev-a-practical-look-at-typesafes-system-one-model-3b7c0fe34f6b', kind: 'commentary', claim: 'Background reading only. The page refused automated retrieval (HTTP 403) on the access date, so no figure here relies on it.' },
  { id: 'medium-mysore', label: 'Vishal Mysore, “Jev By TypeSafe: A model you were waiting for!”, Medium, Sep 2026', url: 'https://medium.com/@visrow/jev-by-typesafe-a-model-you-were-waiting-for-19e8fa8cb5cb', kind: 'commentary', claim: 'Background reading only. The page refused automated retrieval (HTTP 403) on the access date, so no figure here relies on it.' },
];

const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const fraction = x => x === null || (isNum(x) && x >= 0 && x <= 1);
const nonNegative = x => x === null || (isNum(x) && x >= 0);

export function validateResults(r) {
  assert(r && typeof r === 'object' && !Array.isArray(r), 'Results must be an object');
  for (const key of topLevelKeys) assert(key in r, `Results missing ${key}`);
  assert.equal(r.schemaVersion, 1, 'Unsupported schemaVersion');
  assert(Number.isFinite(Date.parse(r.measuredAt)), 'measuredAt must be an ISO date');
  assert(r.machine && typeof r.machine === 'object', 'machine must be an object');
  assert(Array.isArray(r.models) && r.models.length > 0, 'models must be a non-empty array');
  for (const m of r.models) for (const key of ['id','source','sha','license','backend']) assert(key in m, `model missing ${key}`);
  assert.equal(new Set(r.models.map(m => m.id)).size, r.models.length, 'Duplicate model id');
  assert(Number.isInteger(r.corpus?.rows) && r.corpus.rows > 0, 'corpus.rows must be a positive integer');
  assert(/^[a-f0-9]{64}$/.test(r.corpus.sha256 ?? ''), 'corpus.sha256 must be a sha256 hex digest');
  assert(r.perModel && typeof r.perModel === 'object', 'perModel must be an object');
  for (const [id, m] of Object.entries(r.perModel)) {
    assert(r.models.some(model => model.id === id), `perModel ${id} is not a listed model`);
    for (const key of metricKeys) assert(key in m, `perModel ${id} missing ${key}`);
    assert(fraction(m.accuracy) && fraction(m.calibratedAccuracy), `perModel ${id} accuracies must be fractions in [0,1] or null`);
    for (const key of ['p50Ms','p90Ms','maxMs','coldLoadS','costPer1kUsd']) assert(nonNegative(m[key]), `perModel ${id} ${key} must be a non-negative number or null`);
  }
  assert(r.agreement && 'laya_vs_jev' in r.agreement && fraction(r.agreement.laya_vs_jev), 'agreement.laya_vs_jev must be a fraction or null');
  assert(Array.isArray(r.notes) && r.notes.every(n => typeof n === 'string'), 'notes must be strings');
  assert(!/\/Users\/|\/private\/|\/home\/[^\s"]+/.test(JSON.stringify(r)), 'Private local paths in results');
  return r;
}

export function validateManifest(manifest, bytes) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'measured', 'Only a measured record may be published');
  assert(/^[\w.-]+\.json$/.test(manifest.file), 'Manifest file must be a bare JSON file name');
  assert.equal(sha256(bytes), manifest.sha256, 'Copied results differ from the recorded sha256');
  for (const key of ['repository','branch','revision','path']) assert(typeof manifest.source?.[key] === 'string' && manifest.source[key], `Manifest source.${key} required`);
  assert(/^[a-f0-9]{40}$/.test(manifest.source.revision), 'Source revision must be a git sha');
  assert(Number.isFinite(Date.parse(manifest.copiedAt)), 'copiedAt must be an ISO date');
  return manifest;
}

const pct = x => x === null || x === undefined ? 'not run' : `${(x * 100).toFixed(1)}%`;
const num = (x, unit, digits = 0) => x === null || x === undefined ? '—' : `${x.toFixed(digits)} ${unit}`;
const isJev = id => /jev/i.test(id) && !/laya/i.test(id);
const isLaya = id => /laya/i.test(id);

export function verdicts(r) {
  const jevEntry = Object.entries(r.perModel).find(([id]) => isJev(id));
  const jev = jevEntry && jevEntry[1].accuracy !== null ? jevEntry[1] : null;
  const layas = Object.entries(r.perModel).filter(([id, m]) => isLaya(id) && m.accuracy !== null);
  const out = [];
  if (!layas.length) out.push({ id: 'laya-answered', label: 'UNVERIFIED', text: 'No Laya model has a measured accuracy in this record.' });
  for (const [id, m] of layas) {
    if (!jev) out.push({ id: `${id}-accuracy`, label: 'UNVERIFIED', text: `${id}: Jev was not run in this recording, so the accuracy comparison could not be made.` });
    else {
      const gap = (jev.accuracy - m.accuracy) * 100;
      out.push({ id: `${id}-accuracy`, label: gap > refutation.accuracyMarginPoints ? 'RED' : 'GREEN', text: `${id}: ${pct(m.accuracy)} against Jev ${pct(jev.accuracy)} on the same rows (${gap > 0 ? gap.toFixed(1) + ' points behind' : (-gap).toFixed(1) + ' points ahead or level'}; refuted beyond ${refutation.accuracyMarginPoints}).` });
    }
    if (m.calibratedAccuracy === null) out.push({ id: `${id}-confidence`, label: 'UNVERIFIED', text: `${id}: no answers reached 0.9 confidence, so the confidence signal could not be tested.` });
    else out.push({ id: `${id}-confidence`, label: m.calibratedAccuracy >= m.accuracy ? 'GREEN' : 'RED', text: `${id}: answers at confidence ≥ 0.9 were ${pct(m.calibratedAccuracy)} correct against ${pct(m.accuracy)} overall.` });
    if (jev && isNum(m.p50Ms) && isNum(jev.p50Ms)) out.push({ id: `${id}-latency`, label: m.p50Ms < jev.p50Ms ? 'GREEN' : 'RED', text: `${id}: median ${num(m.p50Ms,'ms')} locally against ${num(jev.p50Ms,'ms')} for the hosted call, including network.` });
  }
  const parity = r.parity;
  if (parity && Number.isInteger(parity.decisionMismatches) && isNum(parity.maxTopProbDelta)) out.push({ id: 'parity', label: parity.decisionMismatches === 0 && parity.maxTopProbDelta <= refutation.parityMaxDelta ? 'GREEN' : 'RED', text: `Port parity: ${parity.decisionMismatches} decision mismatches against the reference implementation; maximum top-probability delta ${parity.maxTopProbDelta}.` });
  else out.push({ id: 'parity', label: 'UNVERIFIED', text: 'Port parity is not a field of this results record; see the notes below and the experiment’s own test.' });
  return out;
}

const header = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>System-1 decisions without lock-in: Jev vs open-weight Laya — Odin R&amp;D</title><meta name="description" content="Field notes from Odin R&amp;D. Can an open-weight model answer typed System-1 decisions locally, so a hosted model becomes a comparison rather than a dependency?"><link rel="canonical" href="https://odin-labs-ai.github.io/odin-rnd/journal/${slug}.html"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

export function renderArticle({ results, manifest, fixture = false }) {
  validateResults(results);
  const isFixture = fixture || 'fixture' in results;
  if (!isFixture) assert(manifest, 'A measured article needs its copy manifest');
  const measuredDay = new Date(results.measuredAt).toISOString().slice(0, 10);
  const displayDay = new Date(results.measuredAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  const jevRun = results.agreement.laya_vs_jev !== null;
  const rows = Object.entries(results.perModel).map(([id, m]) => `<tr><th scope="row"><code>${escape(id)}</code></th><td>${pct(m.accuracy)}</td><td>${m.accuracy !== null && m.calibratedAccuracy === null ? 'no answers ≥ 0.9' : pct(m.calibratedAccuracy)}</td><td>${num(m.p50Ms,'ms')} / ${num(m.p90Ms,'ms')} / ${num(m.maxMs,'ms')}</td><td>${num(m.coldLoadS,'s',1)}</td><td>${m.costPer1kUsd === null ? 'none billed' : '$' + m.costPer1kUsd.toFixed(4)}</td></tr>`).join('');
  const models = results.models.map(m => `<li><code>${escape(m.id)}</code>: ${escape(m.source)}${m.sha ? `, revision <code>${escape(m.sha)}</code>` : ''}; ${escape(m.license)}; backend ${escape(m.backend)}.</li>`).join('');
  const machine = Object.entries(results.machine).map(([k, v]) => `${escape(k)} ${escape(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' · ');
  const verdictItems = verdicts(results).map(v => `<li><strong>${v.label}</strong> ${escape(v.text)}</li>`).join('');
  const notes = results.notes.length ? `<ul>${results.notes.map(n => `<li>${escape(n)}</li>`).join('')}</ul>` : '<p>The record carries no notes.</p>';
  const provenance = isFixture
    ? '<p><strong>FIXTURE.</strong> This rendering uses invented renderer-test values. It is not a measurement and must never be published.</p>'
    : `<p>The figures above are rendered at build-authoring time from <a href="../data/laya-vs-jev/${escape(manifest.file)}"><code>${escape(manifest.file)}</code></a>, copied byte-for-byte from <code>${escape(manifest.source.path)}</code> on branch <code>${escape(manifest.source.branch)}</code> of <code>${escape(manifest.source.repository)}</code> at revision <code>${escape(manifest.source.revision)}</code>. Its sha256 is <code>${escape(manifest.sha256)}</code>; the <a href="../data/laya-vs-jev/manifest.json">copy manifest</a> records both. A repository test re-renders this page from that file and fails if they differ.</p>`;
  const sourceItems = sources.map(s => `<li><a href="${escape(s.url)}">${escape(s.label)}</a>. <em>${escape(s.kind)}</em>, accessed ${accessedOn}: ${escape(s.claim)}</li>`).join('');
  return `${header}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1><span style="white-space:nowrap">System-1</span> decisions without <span style="white-space:nowrap">lock-in</span>: Jev vs open-weight Laya</h1><p class="article-meta">EXPERIMENT NOTE / 001 · MEASURED ${escape(displayDay)} · ${isFixture ? 'FIXTURE — NOT A MEASUREMENT' : 'LOCAL MEASUREMENT'}</p></header><article class="article-body">
${isFixture ? '<p><strong>FIXTURE — NOT A MEASUREMENT.</strong> Every number on this rendering is invented to test the page. Do not publish it.</p>\n' : ''}<p>A new kind of model answers software’s small questions directly. Instead of writing text, it takes some state and a typed question (pick one option, give a score, say whether a statement holds) and returns an answer with a probability. TypeSafe calls this a System One model; its hosted model is Jev.</p>
<p>A decision that sits inside your control flow is a dependency. If the only model that can answer it lives behind one vendor’s API and key, the decision is locked in. So we asked a narrow question.</p>
<h2>The question</h2>
<p>Can an open-weight model answer the same typed decisions on an ordinary laptop, well enough that the hosted model becomes an optional comparison rather than a requirement?</p>
<p>The candidate is Laya, an Apache-2.0 decision model from Convai Innovations: a ModernBERT-large encoder with a small decision head, published on Hugging Face. Its authors report beating Jev on their own benchmark. A comparison site reports the opposite on a different one. Both are claims. This note records what happened on one machine, on questions we wrote ourselves.</p>
<h2>The method</h2>
<ul><li>A public corpus of ${results.corpus.rows} hand-written rows, balanced over the three answer types (<code>choice</code>, <code>score</code>, <code>noul</code>), each with its expected answer written before any model ran. Corpus sha256 <code>${escape(results.corpus.sha256)}</code>.</li><li>Laya loads from a pinned Hugging Face revision and runs locally. Nothing in the local path needs a Jev key.</li><li>Jev is called only when a key is present in the environment at run time, as a comparison. Without a key the run still completes and Jev is marked not run.</li><li>Each model answers every row sequentially. We record accuracy against the expected answers, accuracy of the answers given with at least 0.9 confidence, per-call latency and cold-load time.</li></ul>
<p>Models in this recording:</p><ul>${models}</ul>
<p>Machine: ${machine}. Measured ${escape(results.measuredAt)}.</p>
<h2>What would prove it wrong</h2>
<p>These criteria were committed before any result reached this repository. Any one of them failing refutes the claim for this corpus.</p>
<ul><li>Laya is more than ${refutation.accuracyMarginPoints} percentage points less accurate than Jev on the same rows.</li><li>Laya’s answers at confidence 0.9 or above are less accurate than its answers overall, so its confidence cannot be used to decide when to escalate.</li><li>The local port disagrees with the model’s reference implementation on any row, or its top probability differs by more than ${refutation.parityMaxDelta}.</li><li>Laya is slower per call on this machine than the hosted Jev call. This tests the speed claim, not the lock-in claim.</li></ul>
<h2>What we measured</h2>
<div role="region" aria-label="Measured results table" tabindex="0" style="overflow-x:auto"><table><caption class="technical">${isFixture ? 'FIXTURE VALUES' : 'MEASURED ON THIS MACHINE'} · ${escape(measuredDay)} · ${results.corpus.rows} ROWS</caption><thead><tr><th scope="col">Model</th><th scope="col">Accuracy</th><th scope="col">Accuracy at ≥ 0.9</th><th scope="col">p50 / p90 / max</th><th scope="col">Cold load</th><th scope="col">Cost / 1k calls</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>Agreement between Laya and Jev: ${jevRun ? pct(results.agreement.laya_vs_jev) + ' of rows.' : 'not measured; Jev was not run in this recording.'}</p>
<h2>Against the criteria</h2>
<ul>${verdictItems}</ul>
<h2>Notes the run recorded</h2>
${notes}
<h2>What this does not establish</h2>
<ul><li>${results.corpus.rows} authored rows are a mechanism check, not a benchmark. They do not predict accuracy on your decisions, in other languages or in other domains.</li><li>One machine, one run. The latencies describe this laptop under its load at the time; they are not a hosted-service comparison at scale.</li><li>Jev’s latency includes the network and whatever the hosted service was doing at the time. It is not Jev’s model speed.</li><li>Nothing here tests fine-tuning, long inputs beyond the model’s context, or label sets larger than the corpus uses.</li><li>Vendor, model-author and comparison-site figures below are claims. We did not reproduce them, and our numbers neither confirm nor refute them.</li></ul>
<h2>Provenance</h2>
${provenance}
<h2>Sources</h2>
<ul>${sourceItems}</ul>
<p class="article-note">Laya’s weights are never committed to this repository; they are fetched at a pinned revision when the experiment runs. No API key, key prefix or response header is recorded. Failures are kept in the record as evidence.</p>
</article></main>${footer}`;
}

function importResults(sourceFile, sourceRepoRoot) {
  const bytes = readFileSync(sourceFile);
  const results = validateResults(JSON.parse(bytes));
  assert(!('fixture' in results), 'Refusing to import a fixture');
  const git = args => execFileSync('git', ['-C', sourceRepoRoot, ...args], { encoding: 'utf8' }).trim();
  const relative = git(['ls-files', '--full-name', '--others', '--cached', '--', sourceFile]) || sourceFile.slice(sourceRepoRoot.length + 1);
  const revision = git(['rev-parse', 'HEAD']);
  const committedAtRevision = (() => { try { git(['cat-file', '-e', `${revision}:${relative}`]); return git(['diff', '--quiet', revision, '--', relative]) === ''; } catch { return false; } })();
  mkdirSync(dataDir, { recursive: true });
  const file = basename(sourceFile);
  copyFileSync(sourceFile, `${dataDir}/${file}`);
  const manifest = { schemaVersion: 1, kind: 'measured', file, sha256: sha256(bytes), source: { repository: 'odin-labs-ai/odin-rnd', branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), revision, path: relative, committedAtRevision }, copiedAt: new Date().toISOString(), note: 'Copied verbatim by scripts/laya-journal.mjs --import. The sha256 covers the copied bytes.' };
  writeFileSync(`${dataDir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function loadPublished(root = '.') {
  const manifestPath = `${root}/${dataDir}/manifest.json`;
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bytes = readFileSync(`${root}/${dataDir}/${manifest.file}`);
  validateManifest(manifest, bytes);
  const results = validateResults(JSON.parse(bytes));
  assert(!('fixture' in results), 'A fixture may never be published');
  return { manifest, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--import') {
    const [sourceFile, sourceRepoRoot] = rest;
    assert(sourceFile && sourceRepoRoot, 'usage: --import <results.json> <source repo root>');
    console.log(JSON.stringify(importResults(sourceFile, sourceRepoRoot), null, 2));
  } else if (command === '--write') {
    const published = loadPublished();
    assert(published, `No measured record in ${dataDir}; refusing to write the article`);
    writeFileSync(articlePath, renderArticle(published));
    console.log(`Wrote ${articlePath} from ${published.manifest.file} (${published.manifest.sha256}).`);
  } else if (command === '--fixture-preview') {
    const [out] = rest;
    assert(out && !out.startsWith('site/'), 'Fixture previews must be written outside site/');
    writeFileSync(out, renderArticle({ results: JSON.parse(readFileSync(new URL('./fixtures/laya-vs-jev.fixture.json', import.meta.url))), fixture: true }));
    console.log(`Wrote FIXTURE preview to ${out}.`);
  } else {
    console.error('usage: node scripts/laya-journal.mjs --import <results.json> <source repo root> | --write | --fixture-preview <out.html>');
    process.exitCode = 2;
  }
}
