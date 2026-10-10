// Renders the public latent-handoff pages from their committed records: the EXP 008 pre-registration note
// (site/journal/latent-handoff-pre-registration.html, from experiments/latent-handoff/preregistration.json) and the
// factory-intelligence horizon page (site/horizon/factory-intelligence.html, from experiments/latent-handoff/horizon.json).
// Both records are published byte for byte under site/data/latent-handoff/. Every figure on the pages is read from a
// record; a status (met, not yet met) is computed from the measured value and its threshold, never typed. The tests
// re-render everything and fail if a committed page, data copy, home-page row or sitemap entry drifts from the records.
// The shared build (scripts/build.mjs) is not touched: the pages and data copies are committed under site/, which the
// build publishes as is.
//   node scripts/latent-handoff-site.mjs --write   write the pages, the data copies, the home-page row and link, the sitemap
//   node scripts/latent-handoff-site.mjs --pin     pin the horizon record's sha256 in horizon.sha256
//   node scripts/latent-handoff-site.mjs --check   check everything is current
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRecord, publishedPath as preregPublishedPath, sha256, localPath, TO_FREEZE } from './latent-handoff-prereg.mjs';
import { amendmentPublishedPath, checkAmendment } from './latent-handoff-amendment.mjs';
import { amendment02PublishedPath, checkAmendment02 } from './latent-handoff-amendment-02.mjs';

export const horizonPath = 'experiments/latent-handoff/horizon.json';
export const horizonPinPath = 'experiments/latent-handoff/horizon.sha256';
export const horizonPublishedPath = 'site/data/latent-handoff/horizon.json';
// Dataset v0 (bundle 2 WO-06), published byte for byte beside the records; its files are pinned here by sha256.
export const DATASET = {
  dir: 'experiments/latent-handoff/datasets/ffr-handoffs-v0', published: 'site/data/latent-handoff/dataset-v0',
  files: { 'dataset-v0.jsonl': '8b39a717200b6722f6e0f3674e662495610cad6e8bdc5de9fb84b83d4e972fba', 'DATASHEET.md': '42e8933199bd056114b70dff50970de824c02e4c9b5a62a507c8a18de7ccd9bc' },
};
// The pair lock's committed record (rows, decision, and every edit made to the pre-registration after its run
// started), published byte for byte so the note can link it.
export const lockPath = 'experiments/latent-handoff/pair-lock.json';
export const lockPublishedPath = 'site/data/latent-handoff/pair-lock.json';
export const noteSlug = 'latent-handoff-pre-registration';
export const notePath = `site/journal/${noteSlug}.html`;
export const horizonPagePath = 'site/horizon/factory-intelligence.html';
export const noteNumber = '005';
// Every file that still carries the shorter A2b label. Each is hash-bound, so it stays as it is; the record's full label
// supersedes it. A test re-derives this list by scanning experiments/latent-handoff/.
export const SHORT_A2B_FILES = ['arms.mjs', 'calibrate.py', 'kvmap.py', 'mapper-freeze.json', 'mappers-D1.json', 'mappers-D1p.json', 'evidence/mappers-D1-attempt1-gpu-reduced-precision.json'];
// The dataset's null-cost reason code and EXP 008's say the same thing in two words; the page says so once.
export const UNPRICED_NOTE = 'Two reason codes mean the same thing: the dataset\'s local-no-price and EXP 008\'s local-unpriced both mark local compute that has no price, its cost recorded as unknown, never as zero.';
/** A source in the public site repository is named by path; one in the private monorepo by sha256 and commit only. */
export const isPublicSource = repository => repository.startsWith('odin-rnd');
const SITE = 'https://odin-labs-ai.github.io/odin-rnd/';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const shortDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const pct = share => `${(share * 100).toFixed(2)}%`;
const hex = /^[a-f0-9]{64}$/;

const header = (title, description, canonical) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#102b22"><title>${escape(title)} — Odin R&amp;D</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${SITE}${canonical}"><link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="../assets/company.css"><script type="module" src="../assets/activity.mjs"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="site-header dark-surface"><a href="../" class="wordmark" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><nav aria-label="Main navigation"><a href="../#floor">The floor</a><a href="../#experiments">Experiments</a><a href="../#projects">Open source</a><a href="../#journal">Field notes</a><a href="../work-with-us/">Work with us</a></nav><a class="source-link" href="https://github.com/odin-labs-ai/odin-rnd">View source ↗</a></header>`;
const footer = `<footer class="site-footer"><a href="../" class="footer-brand" aria-label="Odin Labs R&amp;D home"><img src="../assets/odin-logo.svg" width="36" height="40" alt=""><span class="brand-name">Odin<strong>Labs</strong></span><span class="brand-rnd">R&amp;D</span></a><span>From the dark factory. Out in the open.</span><div><a href="https://odin-labs.ai/">Odin Labs</a><a href="https://odin-labs-ai.github.io/open-docs/#learn">Open Docs</a><a href="https://github.com/odin-labs-ai/odin-rnd">Source</a><a href="../#journal">More field notes</a></div><span class="technical">REV 0.2.0 · 2026</span></footer></body></html>\n`;

// ---- the horizon record ----

// How a fact's state reads on the page. met-on-publication: the source is private, so the milestone is met only when this page shows it.
export const FACT_STATE = { met: 'met', 'met-on-publication': 'met on publication of this page', 'in-progress': 'in progress', 'not-started': 'not started' };
const OPS = { '>=': (a, b) => a >= b, '<': (a, b) => a < b };
/** A measurement's states, computed from its value and thresholds. */
export function measurementState(m) {
  return {
    milestone: m.milestone ? (OPS[m.milestone.op](m.value, m.milestone.value) ? 'met' : 'not yet met') : null,
    kill: m.kill ? (OPS[m.kill.op](m.value, m.kill.value) ? 'triggered' : 'not triggered') : null,
  };
}

export function validateHorizon(record) {
  assert.equal(record.kind, 'horizon');
  assert.deepEqual(record.rungs.map(r => r.id), ['H0', 'H1', 'H2', 'H3']);
  for (const r of record.rungs) {
    assert.ok(r.when && r.theme && r.milestones.length && r.kill.length, `${r.id} needs a date, a theme, milestones and a kill criterion`);
    for (const x of [...r.milestones, ...r.kill]) {
      assert.ok(typeof x.statement === 'string' && x.statement.length > 10, `${r.id}: a statement is missing`);
      // A criterion that cannot be judged yet says when it can and why, and carries no number.
      if (x.notYetMature) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(x.notYetMature.evaluableFrom) && x.notYetMature.reason?.length > 20, `${r.id}: notYetMature needs a date and a reason`);
        assert.ok(!x.measure && !x.fact, `${r.id}: a criterion that is not yet mature carries no measurement`);
        assert.ok(Date.parse(x.notYetMature.evaluableFrom) > Date.parse(record.thresholdsSet.committedAt), `${r.id}: evaluableFrom is in the past of the ladder`);
      }
      if (x.measure) assert.ok(record.measurements.some(m => m.id === x.measure && m.role === 'milestone'), `${r.id}: ${x.measure} is not a milestone measurement`);
      if (x.fact) assert.ok(record.facts.some(f => f.id === x.fact), `${r.id}: unknown fact ${x.fact}`);
    }
  }
  for (const m of record.measurements) {
    // A number is published only with its fraction, its window and the committed record it came from.
    assert.ok(Number.isInteger(m.numerator) && Number.isInteger(m.denominator) && m.denominator > 0, `${m.id}: numerator and denominator`);
    assert.equal(m.value, Number((m.numerator / m.denominator).toFixed(4)), `${m.id}: value is not numerator / denominator to 4 places`);
    // A ladder measurement is judged against its threshold; a context figure carries none and is never what a rung cites.
    assert.ok(['milestone', 'context'].includes(m.role), `${m.id}: role must be milestone or context`);
    if (m.role === 'context') assert.ok(!m.milestone && !m.kill && /^Context, not the milestone value/.test(m.label), `${m.id}: a context figure carries no threshold and says so in its label`);
    else assert.ok(m.milestone || m.kill, `${m.id}: a measurement on the ladder needs a threshold`);
    assert.ok(Date.parse(m.window.start) < Date.parse(m.window.end) && m.window.days > 0, `${m.id}: window`);
    assert.equal(Math.round((Date.parse(m.window.end) - Date.parse(m.window.start)) / 864e5), m.window.days, `${m.id}: the window is not ${m.window.days} days`);
    for (const k of ['repository', 'record', 'recordSha256', 'command', 'commit']) assert.ok(m.source?.[k], `${m.id}: source.${k} is missing`);
    assert.match(m.source.recordSha256, hex);
    if (m.breakdown) {
      assert.equal(m.breakdown.reduce((s, b) => s + b.numerator, 0), m.numerator, `${m.id}: the breakdown numerators do not sum to the numerator`);
      assert.equal(m.breakdown.reduce((s, b) => s + b.denominator, 0), m.denominator, `${m.id}: the breakdown denominators do not sum to the denominator`);
    }
  }
  // The prize size: every figure is a fraction or a value with its unit and n, under one sourced window.
  const z = record.prizeSize;
  for (const k of ['repository', 'record', 'recordSha256', 'data', 'dataSha256', 'curve', 'curveSha256', 'command', 'commit']) assert.ok(z?.source?.[k], `prizeSize.source.${k} is missing`);
  for (const k of ['recordSha256', 'dataSha256', 'curveSha256']) assert.match(z.source[k], hex);
  assert.equal(Math.round((Date.parse(z.window.end) - Date.parse(z.window.start)) / 864e5), z.window.days, 'prizeSize: the window');
  for (const f of z.figures) {
    const fraction = Number.isInteger(f.numerator) && Number.isInteger(f.denominator) && f.denominator > 0 && f.numerator <= f.denominator;
    const value = typeof f.value === 'number' && f.unit && Number.isInteger(f.n) && f.n > 0;
    assert.ok(fraction !== value, `prizeSize.${f.id}: a figure is either a fraction or a value with unit and n`);
    assert.ok(f.label && f.note, `prizeSize.${f.id}: label and note`);
  }
  // The thresholds must predate every measurement they judge.
  for (const k of ['statement', 'repository', 'commit', 'committedAt']) assert.ok(record.thresholdsSet?.[k], `thresholdsSet.${k} is missing`);
  for (const m of record.measurements) assert.ok(Date.parse(record.thresholdsSet.committedAt) < Date.parse(m.window.end), `${m.id} was measured before its thresholds were set`);
  for (const f of record.facts) {
    assert.ok(Object.keys(FACT_STATE).includes(f.state), `${f.id}: state`);
    assert.ok(f.source?.repository && f.source?.record, `${f.id}: source`);
    if (f.source.recordSha256) assert.match(f.source.recordSha256, hex);
  }
  // Every number in a statement is either a threshold the record defines or a measured figure with its source.
  const text = JSON.stringify(record);
  assert(!localPath.test(text), 'a local machine path in the horizon record');
  assert(!/\b(consent|stage[ -]2|camera-ready|not-yet-public|unpublished)\b/i.test(text), 'the horizon names no unpublished method and makes no stage-2 promise');
  return record;
}

export function checkHorizon(root = '.') {
  const bytes = readFileSync(join(root, horizonPath));
  const pinned = existsSync(join(root, horizonPinPath)) ? readFileSync(join(root, horizonPinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${horizonPath} differs from the sha256 pinned in ${horizonPinPath}: review the change, then node scripts/latent-handoff-site.mjs --pin`);
  return { record: validateHorizon(JSON.parse(bytes)), sha256: sha256(bytes), bytes };
}

// ---- pages ----

/** What D1's A0 answered in the lock run, counted from pair-lock.json's items. */
export function lockAnswers(lock) {
  const accept = lock.items.filter(i => i.decision === 'ACCEPT').length, n = lock.items.length;
  return accept === n ? `In the lock run, D1's A0 answered ACCEPT on all ${n} practice items, so its ${lock.result.correct} right answers are the ${lock.result.correct} GREEN items.` : `In the lock run, D1's A0 answered ACCEPT on ${accept} of ${n} practice items.`;
}

/** The EXP 008 pre-registration note: the record in prose. Nothing on it is a result. */
export function renderNote(record, recordSha256, lock = null, amendment = null, amendment02 = null) {
  assert.match(recordSha256, hex, 'The note needs the sha256 of the record it renders');
  if (record.pairLockResult) {
    assert.ok(lock, 'a record with a pair-lock result needs pair-lock.json, which discloses the edits made after its run started');
    assert.equal(lock.record.sha256, recordSha256, 'pair-lock.json describes a different record');
    assert.equal(lock.decision, record.pairLockResult.decision, 'pair-lock.json and the record disagree on the locked pair');
    assert.ok(lock.notes.some(x => x.includes('analysed n 180 to 175, fallback 40 to 39')), 'the lock notes state the 180 to 175 shrink the edit summary repeats');
  }
  const { experiment: e, corpus: c, strata: s, pins: p, pairs, readout: r, primary: { P1 }, mappers: m, spend } = record;
  const draft = record.freeze.status !== 'frozen';
  const model = x => `${escape(x.repo)} at ${code(x.revision.slice(0, 12))} (${x.geometry.layers} layers × ${x.geometry.kvHeads} KV heads × ${x.geometry.headDim}; ${escape(x.source)})`;
  const pairRow = x => `<tr><td>${escape(x.id === 'D1p' ? 'D1′' : x.id)}</td><td>${model(x.sender)}</td><td>${model(x.receiver)}</td><td>${escape(x.use)}</td></tr>`;
  const value = v => v === TO_FREEZE ? '<strong>to be frozen</strong>' : code(v);
  const title = `${e.id}: ${e.title}, the pre-registration`;
  if (amendment) assert.equal(amendment.record.parent.sha256, recordSha256, 'the amendment amends a different record');
  if (amendment02) {
    assert.ok(amendment, 'amendment 02 is shown after amendment 01');
    assert.equal(amendment02.record.parent.sha256, recordSha256, 'amendment 02 amends a different record');
    assert.deepEqual(amendment02.record.priorAmendments.map(p => p.sha256), [amendment.sha256], 'amendment 02 names another amendment 01');
  }
  return `${header(title, `Field notes from Odin R&D. ${draft ? 'A draft of the pre-registration' : 'The pre-registration'} of ${e.id}, shown before the counted run: ${e.summary}`, `journal/${noteSlug}.html`)}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(title)}</h1><p class="article-meta">EXPERIMENT NOTE / ${noteNumber} · ${escape(e.id)} · ${draft ? 'DRAFT' : 'PRE-REGISTERED'} ${escape(day(record.freeze.frozenOn ?? e.authoredOn))}${amendment ? ` · AMENDED ${escape(day(amendment.record.date))}${amendment02 ? ` AND ${escape(day(amendment02.record.date))}` : ''}` : ''} · NOT YET RUN</p></header><article class="article-body">
${draft ? `<p><strong>Draft.</strong> ${escape(record.freeze.rule)} Fields still to freeze: ${record.freeze.toFreeze.map(code).join(', ')}.</p>\n` : ''}<p><strong>${escape(e.statusText)}.</strong> ${escape(e.summary)} ${escape(e.note)}</p>
<h2>The question</h2>
<p>${escape(record.question)}</p>
<p>${escape(record.framing)} Where this sits in the longer plan: <a href="../horizon/factory-intelligence.html">the factory-intelligence horizon</a>.</p>
<h2>The changes</h2>
${list([
  `${c.exp005.items} EXP 005 changes (${escape(c.exp005.ids)}; ${c.exp005.red} RED, ${c.exp005.green} GREEN). ${escape(c.exp005.statement)} Corpus sums sha256 ${code(c.exp005.corpusSumsSha256)}, inputs ${code(c.exp005.inputsSha256)}, labels ${code(c.exp005.labelsSha256)}.`,
  `${c.exp008x.items} EXP 008-X changes (${escape(c.exp008x.ids)}; ${c.exp008x.red} RED, ${c.exp008x.green} GREEN). ${escape(c.exp008x.statement)} Sums sha256 ${code(c.exp008x.sumsSha256)}, labels ${code(c.exp008x.labelsSha256)}.`,
  `${c.n} items are run. ${escape(c.analysed)} ${escape(c.fallback)}`,
  ...c.exposures.map(x => `<strong>Seen before this record: ${escape(x.items)}.</strong> ${escape(x.reason)}.`),
  `Committed rows from before this record (all on seen items): ${c.exposureEvidence.map(e => `${code(e.file.split('/').pop())} (${escape(e.pairs.map(p => p === 'D1p' ? 'D1′' : p).join(', '))}; ${escape(e.arms.join(', '))}; ${escape(e.items.join(', '))})`).join('; ')}.`,
])}
<h2>Three lengths of context</h2>
<p>One builder makes every context from hashed parts (manifest sha256 ${code(s.manifest.sha256)}): S is ${escape(s.layout.S)} (${s.tokensRange.S[0]}–${s.tokensRange.S[1]} tokens), M is ${escape(s.layout.M)} (${s.tokensRange.M[0]}–${s.tokensRange.M[1]}), L is ${escape(s.layout.L)} (${s.tokensRange.L[0]}–${s.tokensRange.L[1]}). <strong>L is primary.</strong> ${escape(s.paddingDisclosure)} The padding is the start of ${code('lodash.js')} 4.17.21 (${escape(s.distractor.license)}, sha256 ${code(s.distractor.sha256)}). The lint found ${s.lint.findings} problems in ${s.lint.contexts} contexts.</p>
<h2>The models</h2>
<table><thead><tr><th>Pair</th><th>Sender</th><th>Receiver</th><th>Use</th></tr></thead><tbody>${Object.values(pairs).map(pairRow).join('')}</tbody></table>
${list([escape(p.rule), escape(p.vocabAssertion), ...p.mirrors.map(escape), `Pins file sha256 ${code(p.sha256)}; MLX ${escape(p.toolchain.mlx)}, mlx-lm ${escape(p.toolchain.mlxLm)}.`])}
<p><strong>Which pair is counted.</strong> ${escape(record.pairLock)} ${escape(record.pairLockEarlierPractice)}${record.pairLockResult ? ` <strong>${escape(record.pairLockResult.statement)}</strong>` : ''}${lock ? ` ${lockAnswers(lock)} The record was edited after the lock run started: see <a href="#after-the-lock">the edits after the lock run started</a>.` : ''}</p>
${list([`D1: ${escape(record.hardware.D1)}`, `D1′: ${escape(record.hardware.D1p)}`, `Memory: ${escape(record.hardware.footprints.statement)}`])}
<h2>The decision</h2>
<p>${escape(r.rule)} The question is EXP 005's: “${escape(r.question)}” followed by “${escape(r.answerInstruction)}” Readout sha256 ${code(r.sha256)}; receiver chat templates by sha256: ${Object.entries(r.chatTemplates).map(([k, v]) => `${escape(k)} ${code(v.slice(0, 12))}…`).join(', ')}.</p>
<h2>The arms</h2>
<p>The transfer interface is ${code(record.interface.signature)}. ${escape(record.interface.rule)}</p>
<table><thead><tr><th>Arm</th><th>What the receiver gets</th></tr></thead><tbody>${record.arms.map(a => `<tr><td>${escape(a.id)}</td><td>${escape(a.what)}</td></tr>`).join('')}</tbody></table>
<p>${escape(m.label)} ${escape(m.transfer)} ${escape(m.calibration)} ${escape(m.weights)}</p>
${m.implementations === TO_FREEZE ? '' : list(Object.entries(m.implementations).map(([k, v]) => `<strong>${escape(k)}</strong>: ${escape(v)}`))}
<p><strong>The parity gate.</strong> ${m.parity === TO_FREEZE ? value(m.parity) : `${escape(m.parity.items)}: ${escape(m.parity.itemsAre)}. Mapping: ${escape(m.parity.mapping)}. Readout: ${escape(m.parity.readout)}. Pass: ${escape(m.parity.pass)}. ${escape(m.parity.rationale)} Result at freeze: ${m.pairs === TO_FREEZE ? value(m.pairs) : Object.entries(m.pairs).map(([p, x]) => `${p === 'D1p' ? 'D1′' : escape(p)}: ${Object.entries(x.parityBinding).map(([k, b]) => `${escape(k)} ${b.agree}/${b.items}, max |Δp| ${b.maxDp.toExponential(1)}`).join(', ')}`).join('; ')}.`} ${escape(m.parityRule)}</p>
${m.notes.length ? list(m.notes.map(escape)) : ''}
<p>Every file that still carries a shorter A2b label (each hash-bound, so it stays as it is, and the label above supersedes it): ${SHORT_A2B_FILES.map(code).join(', ')}.</p>
${list([...Object.entries(m.code).map(([f, d]) => `${code(f.split('/').pop())}: ${value(d)}`), `Calibration text: ${value(m.calibrationTextSha256)} (${m.calibrationWhere === TO_FREEZE ? value(m.calibrationWhere) : escape(m.calibrationWhere)})`, ...(m.pairs === TO_FREEZE ? [`Per-pair records: ${value(m.pairs)}`] : Object.entries(m.pairs).map(([p, x]) => `${p === 'D1p' ? 'D1′' : escape(p)}: mapper record ${value(x.mapperRecordSha256)}, mapper weights ${value(x.mapperWeightsSha256)}, parity record ${value(x.parityRecordSha256)}`)), `Freeze record: ${m.freezeRecord === TO_FREEZE ? value(m.freezeRecord) : `${code(m.freezeRecord.file.split('/').pop())} ${code(m.freezeRecord.sha256)}. ${escape(m.freezeRecord.rule)}`}`])}
<h2>The claim: P1</h2>
<p>On ${escape(P1.on)}:</p>
${list(P1.criteria.map(x => escape(x.statement)))}
<p>${escape(P1.rule)}</p>
<h2>Secondary claims</h2>
${list(record.secondary.map(x => `<strong>${escape(x.id)}.</strong> ${escape(x.statement)}`))}
<p><strong>Reported, never a gate.</strong></p>
${list(record.descriptive.map(x => `<strong>${escape(x.id)}.</strong> ${x.statement === TO_FREEZE ? value(x.statement) : escape(x.statement)} Evidence: ${x.evidence === TO_FREEZE ? value(x.evidence) : x.evidence.map(e => `${code(e.file.split('/').pop())} ${code(e.sha256)}`).join(', ')}.`))}
<p>${escape(record.secondaryRule)}</p>
<h2>When a result is uninformative</h2>
${list(record.validityGates.map(escape))}
<p>${escape(record.validityRule)}</p>
<p>${escape(record.analysis)}</p>
<h2>Fences against leakage</h2>
${list(record.leakageFences.map(escape))}
<h2>Memory, timing and spend</h2>
${list([escape(record.memoryGate.rule), escape(record.timing.rule), escape(record.telemetry.rule), `${escape(spend.rule)} Stage 1 budget $${spend.stage1BudgetUsd}: ${escape(spend.stage1Split)} ${escape(spend.local)}`, escape(record.notBefore)])}
${lock ? `<h2 id="after-the-lock">Edits after the lock run started</h2>
<p>The lock run started seconds after the record was frozen. The record on this page is not byte-identical to the one in force then: it was revised afterwards, in disclosure, wording and date fields only. One of those disclosures, a third exposure found by a refute, shrank the analysed set from 180 to 175 items (and the fallback from 40 to 39). The pair-lock rule, its bar, its practice set and the files the run used are unchanged and are checked against this record. The lock's committed record, <a href="../data/latent-handoff/pair-lock.json"><code>pair-lock.json</code></a>, lists every edit; its last note gives the sha256 of the record in force when the run started. The commit that held that record is not on a public branch.</p>
${list(lock.notes.map(escape))}
<p>${escape(lock.alwaysAccept)}</p>
` : ''}${amendment ? renderAmendment(amendment) : ''}${amendment02 ? renderAmendment02(amendment02) : ''}<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../data/latent-handoff/preregistration.json"><code>preregistration.json</code></a>, the committed record at ${code('experiments/latent-handoff/preregistration.json')}, whose sha256 is ${code(recordSha256)}. The site publishes that file byte for byte, and a repository test re-renders this page from it and fails if they differ. A validator rebuilds the record from the harness files and refuses any difference; it pins ${Object.keys(record.files).length} files by sha256.</p>
<p class="article-note">The counted run has not started. ${draft ? 'This is a draft: the results will be judged against the frozen record once it is published, never against this draft.' : 'The results, when they exist, will be judged against this record as published, and reported as they come out.'}</p>
</article></main>${footer}`;
}

/** The horizon page: the ladder, with today's measured position on its first rung. */
export function renderHorizon(record, recordSha256) {
  assert.match(recordSha256, hex, 'The page needs the sha256 of the record it renders');
  const byId = Object.fromEntries(record.measurements.map(m => [m.id, m]));
  const factById = Object.fromEntries(record.facts.map(f => [f.id, f]));
  const sourceLine = s => isPublicSource(s.repository)
    ? `Source: ${escape(s.repository)}, ${code(s.record)}${s.recordSha256 ? ` (sha256 ${code(s.recordSha256)})` : ''}${s.commit ? ` at commit ${code(s.commit)}` : ''}${s.command ? `; command ${code(s.command)}` : ''}${s.toolFailures !== undefined ? `; ${s.toolFailures} tool failures` : ''}.`
    : `Source: ${escape(s.repository)}, a committed record${s.recordSha256 ? ` with sha256 ${code(s.recordSha256)}` : ''}${s.commit ? ` at commit ${code(s.commit)}` : ''}${s.toolFailures !== undefined ? `; ${s.toolFailures} tool failures` : ''}.`;
  const measured = m => {
    const st = measurementState(m);
    const bits = [st.milestone ? `Milestone (≥ ${pct(m.milestone.value)}): <strong>${st.milestone}</strong>` : null, st.kill ? `Kill line (below ${pct(m.kill.value)}): <strong>${st.kill}</strong>` : null].filter(Boolean);
    const parts = m.breakdown ? `<p class="technical">By source: ${m.breakdown.map(b => `${escape(b.source)} ${b.numerator} of ${b.denominator} (${pct(Number((b.numerator / b.denominator).toFixed(4)))})`).join('; ')}.</p>\n` : '';
    if (m.role === 'context') return `<p id="${escape(m.id)}"><em>${escape(m.label)}: ${pct(m.value)}</em> (${m.numerator} of ${m.denominator}, the same window).</p>\n${parts}<p class="technical">${escape(m.definition)} ${sourceLine(m.source)}</p>`;
    return `<p id="${escape(m.id)}"><strong>${escape(m.label)}: ${pct(m.value)}</strong> (${m.numerator} of ${m.denominator}, ${m.window.days} days, ${escape(m.window.start.slice(0, 16))}Z to ${escape(m.window.end.slice(0, 16))}Z). ${bits.join('; ')}.</p>\n<p class="technical">${escape(m.definition)} ${sourceLine(m.source)}</p>`;
  };
  const mature = x => x.notYetMature ? ` <em>Not yet mature: evaluable from ${escape(day(x.notYetMature.evaluableFrom))}.</em> ${escape(x.notYetMature.reason)}` : '';
  const milestone = x => `${escape(x.statement)}${mature(x)}${x.measure ? ` <em>Now: ${pct(byId[x.measure].value)}, ${escape(measurementState(byId[x.measure]).milestone)}</em> (<a href="#${escape(x.measure)}">measured</a>).` : ''}${x.fact ? ` <em>Now: ${escape(FACT_STATE[factById[x.fact].state])}</em> (<a href="#${escape(x.fact)}">source</a>).` : ''}`;
  const kill = x => `${escape(x.statement)}${mature(x)}${x.measure ? ` <em>Now: ${escape(measurementState(byId[x.measure]).kill)}</em> (<a href="#${escape(x.measure)}">measured</a>).` : ''}`;
  const title = `${record.title}: the horizon`;
  return `${header(title, `Odin R&D. ${record.summary}`, 'horizon/factory-intelligence.html')}<main id="main" class="article-shell"><a class="article-back" href="../#journal">← Back to the field notes</a><header class="article-header"><h1>${escape(title)}</h1><p class="article-meta">HORIZON · STATED ${escape(day(record.authoredOn))} · RUNG H0 IN PROGRESS</p></header><article class="article-body">
<p>${escape(record.summary)}</p>
<h2>The dot</h2>
<p><strong>${escape(record.dot.rung)}, ${escape(record.dot.when)}.</strong> ${escape(record.dot.statement)}</p>
<p>${escape(record.invariant)}</p>
<p>${escape(record.thresholdsSet.statement)}</p>
<p class="technical">Source: ${escape(record.thresholdsSet.repository)}, commit ${code(record.thresholdsSet.commit)}, committed ${escape(record.thresholdsSet.committedAt)}.</p>
<h2>Where we stand on H0</h2>
${record.measurements.map(measured).join('\n')}
${record.facts.map(f => `<p id="${escape(f.id)}"><strong>${escape(FACT_STATE[f.state][0].toUpperCase() + FACT_STATE[f.state].slice(1))}.</strong> ${escape(f.statement)}${f.id === 'exp008' ? ' <a href="../journal/latent-handoff-pre-registration.html">Read the pre-registration</a>.' : ''}${f.id === 'dataset-v0' ? ` <a href="../data/latent-handoff/dataset-v0/dataset-v0.jsonl">Download the rows</a> and <a href="../data/latent-handoff/dataset-v0/DATASHEET.md">read the datasheet</a>. ${escape(UNPRICED_NOTE)}` : ''}</p>\n<p class="technical">${sourceLine(f.source)}</p>`).join('\n')}
<h2 id="prize">How big the prize is today</h2>
<p>${escape(record.prizeSize.statement)}</p>
${list(record.prizeSize.figures.map(f => `<strong>${escape(f.label)}: ${f.unit ? `${escape(f.value.toLocaleString('en-US'))} ${escape(f.unit)}</strong> (n = ${f.n})` : `${pct(Number((f.numerator / f.denominator).toFixed(4)))}</strong> (${f.numerator.toLocaleString('en-US')} of ${f.denominator.toLocaleString('en-US')})`}. ${escape(f.note)}`))}
<p class="technical">Window ${escape(record.prizeSize.window.start)} to ${escape(record.prizeSize.window.end)} (${record.prizeSize.window.days} days). ${isPublicSource(record.prizeSize.source.repository) ? `Source: ${escape(record.prizeSize.source.repository)}, ${code(record.prizeSize.source.record)} (sha256 ${code(record.prizeSize.source.recordSha256)}), data ${code(record.prizeSize.source.data)} (sha256 ${code(record.prizeSize.source.dataSha256)}), prefill curve ${code(record.prizeSize.source.curve)} (sha256 ${code(record.prizeSize.source.curveSha256)}), at commit ${code(record.prizeSize.source.commit)}; command ${code(record.prizeSize.source.command)}.` : `Source: ${escape(record.prizeSize.source.repository)}, committed records with sha256 ${code(record.prizeSize.source.recordSha256)} (the summary), ${code(record.prizeSize.source.dataSha256)} (the data) and ${code(record.prizeSize.source.curveSha256)} (the prefill curve), at commit ${code(record.prizeSize.source.commit)}.`}</p>
<h2>The ladder</h2>
${record.rungs.map(r => `<h3>${escape(r.id)} · ${escape(r.when)}: ${escape(r.theme)}</h3>\n<p><strong>Milestones.</strong></p>\n${list(r.milestones.map(milestone))}\n<p><strong>Kill criteria.</strong></p>\n${list(r.kill.map(kill))}`).join('\n')}
<h2>What this does not establish</h2>
${list(record.limits.map(escape))}
<h2>Provenance</h2>
<p>This page is rendered from <a href="../data/latent-handoff/horizon.json"><code>horizon.json</code></a>, the committed record at ${code(horizonPath)}, whose sha256 is ${code(recordSha256)}. The site publishes that file byte for byte. Each status above is computed from the measured value and its threshold when the page is rendered; a repository test re-renders the page and fails if it differs.</p>
</article></main>${footer}`;
}

/** The home page's field-note row for the EXP 008 note. Its lead is "Pre-registered; not yet run.", not EXP 006's
 *  "Pre-registered, not yet run.", which EXP 006's results tooling looks for on the whole home page. */
export function renderJournalRow(record) {
  const e = record.experiment;
  return `<a class="journal-row" href="journal/${noteSlug}.html"><div class="journal-date"><time datetime="${escape(record.freeze.frozenOn ?? e.authoredOn)}">${shortDate(record.freeze.frozenOn ?? e.authoredOn)}</time><span class="technical">EXPERIMENT NOTE / ${noteNumber}</span></div><div><h3>${escape(e.id)}: ${escape(e.title)}: <br>the pre-registration</h3><p>${escape(e.summary)} ${record.freeze.status === 'frozen' ? 'Pre-registered; not yet run.' : 'Draft; not yet run.'}</p></div><span class="journal-arrow" aria-hidden="true">↗</span></a>`;
}
export const horizonLink = ' <a href="horizon/factory-intelligence.html">See the horizon and where we stand today</a>.';
const horizonAnchor = 'quality, cost and outcomes that matter to your team.';
const firstJournalRow = '<a class="journal-row" href="journal/jev-as-a-fast-gate.html">';
export const resultWords = /\b(results? show|wins?|won|beats? (?:the|A0)|outperform\w*|proven|passe[sd])\b/i;

/** The home page with the EXP 008 row first among the field notes and the horizon link in the Factory Intelligence card. */
export function withHome(html, record) {
  const row = renderJournalRow(record);
  assert(!resultWords.test(row), 'the EXP 008 row states a result');
  let out = html.replace(/<a class="journal-row" href="journal\/latent-handoff-pre-registration\.html">[\s\S]*?<\/a>\n      /, '');
  assert.equal(out.split(firstJournalRow).length, 2, 'the home page carries the EXP 005 field-note row exactly once');
  out = out.replace(firstJournalRow, `${row}\n      ${firstJournalRow}`);
  out = out.replace(horizonLink, '');
  assert.equal(out.split(horizonAnchor).length, 2, 'the Factory Intelligence card text is there exactly once');
  return out.replace(horizonAnchor, `${horizonAnchor}${horizonLink}`);
}

/** Amendment 01 on the note: what it adds, the clauses it implements, the run it fixes and the later not-before. */
export function renderAmendment({ record: a, sha256: digest }) {
  return `<h2 id="amendment-01">${escape(a.title)}</h2>
<p><strong>${escape(a.statusText)}.</strong> The pre-registration's analysis field reads: “${escape(a.reason.record)}” ${escape(a.reason.statement)} ${escape(a.changes.statement)}</p>
<p>The script is ${code(a.analysis.file)} (sha256 ${code(a.analysis.sha256)}); its tests are ${code(a.analysis.tests.file)} (sha256 ${code(a.analysis.tests.sha256)}). It reads ${escape(a.analysis.reads)}. The amendment is published byte for byte as <a href="../data/latent-handoff/amendment-01.json"><code>amendment-01.json</code></a>, sha256 ${code(digest)}; each clause there quotes the pre-registration's own words beside its implementation.</p>
${list(a.clauses.map(c => `<strong>${escape(c.id)}</strong> (${c.record.map(q => code(q.path)).join(', ')}): ${escape(c.implementation)}`))}
<p><strong>The run.</strong> ${escape(a.run.statement)} Counted: ${a.run.counted.map(x => `${code(x.runId)} (${escape(x.stratum)})`).join(', ')}; re-run: ${a.run.rerun.map(x => `${code(x.runId)} (${escape(x.stratum)})`).join(', ')}.</p>
<p><strong>The not-before.</strong> ${escape(a.notBefore)}</p>
${list(a.limits.map(escape))}
`;
}

/** Amendment 02 on the note, in short: the counter fix, the rebinding, the fresh run ids, the void attempt and the later not-before. */
export function renderAmendment02({ record: a, sha256: digest }) {
  const runner = a.changes.runner;
  return `<h2 id="amendment-02">${escape(a.title)}</h2>
<p><strong>${escape(a.statusText)}.</strong> ${escape(a.reason.bug)} ${escape(a.reason.evidence)}</p>
<p><strong>The fix.</strong> ${escape(runner.change)} A regression test, ${code(runner.test.name)} in ${code(runner.test.file)}, covers it: ${escape(runner.test.statement)} The record binds runner.py by sha256, and its own rule reads: “${escape(a.reason.record)}” So this is a dated amendment. It rebinds ${a.rebinds.map(r => `${code(r.file)} (${code(r.from.slice(0, 12))} → ${code(r.to.slice(0, 12))})`).join(', ')}; every other bound file is unchanged. ${escape(a.changes.analysis)}</p>
<p><strong>The run.</strong> Counted: ${a.run.counted.map(x => `${code(x.runId)} (${escape(x.stratum)})`).join(', ')}; re-run: ${a.run.rerun.map(x => `${code(x.runId)} (${escape(x.stratum)})`).join(', ')}. ${escape(a.void.statement)}</p>
<p><strong>The not-before.</strong> ${escape(a.notBefore)}</p>
${list(a.limits.map(escape))}
<p>The amendment is published byte for byte as <a href="../data/latent-handoff/amendment-02.json"><code>amendment-02.json</code></a>, sha256 ${code(digest)}; each clause it touches quotes the pre-registration's or amendment 01's own words beside the change.</p>
`;
}

export const sitemapUrls = [`${SITE}journal/${noteSlug}.html`, `${SITE}horizon/factory-intelligence.html`];
export function withSitemap(xml) {
  let out = xml;
  for (const url of sitemapUrls) out = out.replace(`<url><loc>${url}</loc></url>`, '');
  const anchor = `<url><loc>${SITE}work-with-us/</loc></url>`;
  assert.equal(out.split(anchor).length, 2, 'the sitemap carries the work-with-us entry exactly once');
  return out.replace(anchor, `${sitemapUrls.map(u => `<url><loc>${u}</loc></url>`).join('')}${anchor}`);
}

/** Everything the site carries for latent-handoff, as it must be on disk. */
export function expected(root = '.') {
  const prereg = checkRecord(root), horizon = checkHorizon(root), amendment = checkAmendment(root), amendment02 = checkAmendment02(root);
  // The horizon's EXP 008 fact must agree with the pre-registration's freeze status.
  const fact = horizon.record.facts.find(f => f.id === 'exp008');
  assert.equal(fact.state, 'in-progress');
  assert.equal(/not yet frozen/.test(fact.statement), prereg.record.freeze.status === 'draft', 'the horizon\'s EXP 008 fact disagrees with the pre-registration\'s freeze status');
  const read = f => readFileSync(join(root, f), 'utf8');
  const lockBytes = readFileSync(join(root, lockPath));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const dataset = Object.fromEntries(Object.entries(DATASET.files).map(([f, digest]) => {
    const bytes = readFileSync(join(root, DATASET.dir, f));
    assert.equal(sha256(bytes), digest, `${DATASET.dir}/${f} is not the pinned dataset v0 file`);
    return [`${DATASET.published}/${f}`, bytes];
  }));
  const dsFact = horizon.record.facts.find(f => f.id === 'dataset-v0');
  assert.equal(dsFact?.source.recordSha256, DATASET.files['dataset-v0.jsonl'], 'the horizon\'s dataset fact names the pinned dataset');
  return {
    ...dataset,
    [notePath]: renderNote(prereg.record, prereg.sha256, lock, amendment, amendment02),
    [amendmentPublishedPath]: amendment.bytes,
    [amendment02PublishedPath]: amendment02.bytes,
    [lockPublishedPath]: lockBytes,
    [horizonPagePath]: renderHorizon(horizon.record, horizon.sha256),
    [preregPublishedPath]: prereg.bytes,
    [horizonPublishedPath]: horizon.bytes,
    'site/index.html': withHome(read('site/index.html'), prereg.record),
    'site/sitemap.xml': withSitemap(read('site/sitemap.xml')),
  };
}

export function assertSiteCurrent(root = '.') {
  for (const [file, want] of Object.entries(expected(root))) {
    const have = readFileSync(join(root, file));
    assert(have.equals(Buffer.isBuffer(want) ? want : Buffer.from(want)), `${file} differs from its records: run node scripts/latent-handoff-site.mjs --write`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--pin') {
    validateHorizon(JSON.parse(readFileSync(horizonPath, 'utf8')));
    writeFileSync(horizonPinPath, `${sha256(readFileSync(horizonPath))}  horizon.json\n`);
    console.log(`Pinned ${horizonPath} in ${horizonPinPath}. Now --write.`);
    process.exit(0);
  } else if (command === '--write') {
    for (const [file, content] of Object.entries(expected())) {
      mkdirSync(file.split('/').slice(0, -1).join('/'), { recursive: true });
      writeFileSync(file, content);
    }
    console.log(`Wrote ${notePath}, ${horizonPagePath}, the data copies (record, amendments 01 and 02, horizon, pair lock, dataset v0), the home-page row and link, and the sitemap.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/latent-handoff-site.mjs --check | --write | --pin');
    process.exit(2);
  }
  assertSiteCurrent();
  console.log('PASS latent-handoff site pages, data copies, home page and sitemap are current');
}
