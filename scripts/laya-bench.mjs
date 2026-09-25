// Renders the home-page Laya station and bench FROM the committed laya-vs-jev record; no figure is typed by hand.
// The station compartment renders during the build. The bench sits outside any build marker, and build.mjs and
// package.json are hash-pinned by the recorded experiments, so `--write` renders the bench into site/index.html
// between the markers below and the build (via renderStations) refuses a page whose bench differs from the record.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPublished, verdicts, refutation, slug } from './laya-journal.mjs';

const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const layaId = 'laya-typed-decisions';
export const jevId = 'jev';
export const readmePath = 'experiments/laya-vs-jev/README.md';
export const browserHref = 'projects/laya-browser/';
export const noteHref = `journal/${slug}.html`;
export const pagePath = 'site/index.html';
export const benchBegin = '<!-- laya-bench: rendered by scripts/laya-bench.mjs --write from the committed record; do not edit by hand -->';
export const benchEnd = '<!-- /laya-bench -->';

// The README's own "## Reproduce" shell block, verbatim, so the page cannot drift from it.
export function reproduceCommand(readme = readFileSync(readmePath, 'utf8')) {
  const section = readme.split(/^## Reproduce$/m)[1];
  assert(section, 'README has no "## Reproduce" section');
  const block = section.match(/```sh\n([\s\S]*?)```/);
  assert(block, 'README Reproduce section has no sh block');
  return block[1].trimEnd();
}

// The exact figures the home page shows. Tests compare the built page against this.
export function layaFigures(results) {
  const laya = results.perModel[layaId], jev = results.perModel[jevId];
  assert(laya && jev, `Record needs perModel.${layaId} and perModel.${jevId}`);
  for (const m of [laya, jev]) assert(Number.isInteger(m.detail?.correct) && Number.isInteger(m.detail?.rows), 'Record needs per-model correct/rows counts');
  const parity = results.parity;
  assert(parity && Number.isInteger(parity.sameDecision) && Number.isInteger(parity.rows), 'Record needs parity counts');
  const judged = verdicts(results);
  const label = id => { const v = judged.find(v => v.id === id); assert(v, `Missing verdict ${id}`); return v.label; };
  const loads = [...(results.machine.loadAverageAtStart ?? []), ...(results.machine.loadAverageAtEnd ?? [])];
  return {
    layaAccuracy: `${laya.detail.correct} / ${laya.detail.rows}`,
    jevAccuracy: `${jev.detail.correct} / ${jev.detail.rows}`,
    layaP50: `${Math.round(laya.p50Ms)} ms`,
    jevP50: `${Math.round(jev.p50Ms)} ms`,
    parity: `${parity.sameDecision} / ${parity.rows}`,
    parityDelta: parity.maxTopProbDelta.toFixed(4),
    agreement: `${results.agreement.laya_vs_jev.agree} / ${results.agreement.laya_vs_jev.comparedRows}`,
    gapPoints: ((jev.accuracy - laya.accuracy) * 100).toFixed(1),
    speedup: Math.round(jev.p50Ms / laya.p50Ms),
    confident: `${laya.detail.highConfidenceCorrect} of ${laya.detail.highConfidenceAnswers}`,
    rows: results.corpus.rows,
    load: loads.length ? `${Math.round(Math.min(...loads))}–${Math.round(Math.max(...loads))}` : null,
    measuredAt: results.measuredAt,
    machine: results.machine.chip,
    runtime: results.runtime?.mlx ? `MLX ${results.runtime.mlx}` : null,
    verdicts: {
      accuracy: label(`${layaId}-accuracy`),
      confidence: label(`${layaId}-confidence`),
      latency: label(`${layaId}-latency`),
      parity: label('parity'),
    },
  };
}

const recordHref = manifest => `data/laya-vs-jev/${escape(manifest.file)}`;
const row = (label, value, state) => `<div class="record-comparison ${state}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
const state = verdict => verdict === 'GREEN' ? 'accepted' : 'rejected';

// Body of the "05 / Decision" station compartment, in the same record-comparison vocabulary as stations 01–04.
export function renderLayaExhibit({ results, manifest }) {
  const f = layaFigures(results);
  return `<p class="artifact-label">${f.rows} typed questions. Open weights on a laptop against a hosted API.</p><div class="record-comparisons">${row('Accuracy / Laya, local', `${f.verdicts.accuracy} · ${f.layaAccuracy}`, state(f.verdicts.accuracy))}${row('Accuracy / Jev, hosted', f.jevAccuracy, '')}${row('Median time / local vs hosted, incl. network', `${f.layaP50} vs ${f.jevP50}`, state(f.verdicts.latency))}${row('Same answer as the reference code', f.parity, state(f.verdicts.parity))}</div><p class="station-implication">The local model needs no key and matches its reference on every row. It is ${escape(f.gapPoints)} points less accurate than Jev here, beyond the ${refutation.accuracyMarginPoints}-point limit set before the run.</p><div class="station-receipts"><a href="${browserHref}">Try it in your browser</a><a href="${noteHref}">Read the field note</a></div><p class="station-provenance">Laya typed-decisions · ${escape(f.measuredAt.slice(0,10))} · one laptop, ${f.rows} authored rows<br><a href="${recordHref(manifest)}">Recording and source provenance</a></p>`;
}

const checkText = f => ({
  accuracy: ['Within ' + refutation.accuracyMarginPoints + ' points of Jev', `${f.layaAccuracy} against ${f.jevAccuracy}: ${f.gapPoints} points behind.`],
  confidence: ['Confident answers are right', `${f.confident} answers at confidence ≥ 0.9 were correct, but only ${f.confident.split(' of ')[1]} of ${f.rows} reached it.`],
  parity: ['Same answers as the reference code', `${f.parity} same decision; largest probability difference ${f.parityDelta} (limit ${refutation.parityMaxDelta}).`],
  latency: ['Faster than the hosted call, network included', `Median ${f.layaP50} on the laptop against ${f.jevP50} for the hosted call, including the network.`],
});

// The second bench. BCE's bench is a rule applied to two trees; this one compares two models, so it keeps
// the bench's parts (menu, status, question, specimens, reproduce, provenance, scope) with its own content.
export function renderLayaBench({ results, manifest }, readme) {
  const f = layaFigures(results), checks = checkText(f);
  const green = Object.values(f.verdicts).filter(v => v === 'GREEN').length;
  const measured = new Date(f.measuredAt).toISOString().replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC');
  return `<div class="bench-introduction laya-introduction"><h3>Then a decision you can own.</h3><p>A second bench, because this one compares two models rather than one rule on two trees: open weights on a laptop against a hosted API, on the same questions.</p></div>
      <div class="workbench laya-bench dark-surface" id="laya-bench">
        <div class="bench-menu"><div class="bench-label technical">BENCH 02 / DECISIONS</div><p class="bench-entry"><span>EXP / 004</span><span>Laya vs Jev: typed decisions <span style="white-space:nowrap">without lock-in</span></span></p><a class="all-runs" href="${browserHref}">Try it in your browser <span aria-hidden="true">↗</span></a></div>
        <div class="bench-body">
          <div class="bench-status technical"><span>EXP / 004</span><span>ACCURACY / ${escape(f.verdicts.accuracy)} · ${green} OF 4 CHECKS GREEN</span></div>
          <h3>Can an open model answer the same typed decisions on a laptop, with no vendor key?</h3>
          <div class="laya-primer"><div><span class="technical">WHAT IS A SYSTEM-1 DECISION MODEL?</span><p>It answers a typed question about a situation: pick one of these options, give a score, or say yes or no. It returns that answer with a confidence. It does not write text, so software can branch on the answer directly.</p></div><div><span class="technical">WHY NO VENDOR LOCK-IN MATTERS</span><p>A decision inside your control flow is a dependency. Jev is a hosted API: every answer needs its key, its network and its price. Laya publishes open Apache-2.0 weights that run on your own machine, so the hosted model can become a comparison instead of a requirement.</p></div></div>
          <div class="specimen-pair"><div><span class="technical">SPECIMEN A / LAYA · OPEN WEIGHTS, LOCAL</span><strong class="verdict-${f.verdicts.accuracy.toLowerCase()}" id="laya-accuracy">${escape(f.layaAccuracy)}</strong><span>correct · median <span id="laya-p50">${escape(f.layaP50)}</span> per decision</span></div><div><span class="technical">SPECIMEN B / JEV · HOSTED API</span><strong id="jev-accuracy">${escape(f.jevAccuracy)}</strong><span>correct · median <span id="jev-p50">${escape(f.jevP50)}</span>, including the network</span></div></div>
          <p class="bench-explainer">Result: the local port gives the same decision as the model’s reference code on <strong id="laya-parity">${escape(f.parity)}</strong> rows, and its median call here took ${f.layaP50} on the laptop against ${f.jevP50} for the hosted call including its network round trip, but it is ${escape(f.gapPoints)} points less accurate than Jev. That is beyond the ${refutation.accuracyMarginPoints}-point limit set before the run, so the accuracy check is <strong>${escape(f.verdicts.accuracy)}</strong> and stays that way.</p>
          <ul class="laya-checks" aria-label="Checks written before the run">${Object.entries(checks).map(([key, [name, text]]) => `<li><strong class="verdict-${f.verdicts[key].toLowerCase()}">${escape(f.verdicts[key])}</strong><span><b>${escape(name)}.</b> ${escape(text)}</span></li>`).join('')}</ul>
          <div class="reproduce"><span class="technical">REPRODUCE / APPLE SILICON + UV · FROM A CLONE OF THIS REPOSITORY</span><pre id="laya-reproduce-command" tabindex="0">${escape(reproduceCommand(readme))}</pre><button data-copy-target="laya-reproduce-command" aria-label="Copy the Laya reproduction commands">Copy command</button><span class="copy-status" role="status"></span></div>
          <div class="run-meta"><span>MEASURED ${escape(measured)} · ${escape([f.machine, f.runtime].filter(Boolean).join(' · ').toUpperCase())}</span><a href="${recordHref(manifest)}">Full result &amp; provenance <span aria-hidden="true">↗</span></a><a href="${noteHref}">Read the field note <span aria-hidden="true">↗</span></a></div>
          <p class="scope-note">${f.rows} hand-written rows on one busy laptop${f.load ? ` (load average ${escape(f.load)} during the run)` : ''} is a mechanism check, not a benchmark. It does not predict accuracy on your decisions. Jev’s latency includes the public internet; Laya’s confident-answer figure rests on ${escape(f.confident.split(' of ')[1])} answers. Opening this page runs nothing; the browser demo downloads and runs Laya only when you ask it to.</p>
        </div>
      </div>`;
}

export function loadLaya(root = '.') {
  const published = loadPublished(root);
  assert(published, 'The home page needs the committed Laya record');
  return published;
}

export function benchBlock(html) {
  const parts = html.split(benchBegin);
  assert.equal(parts.length, 2, 'Home page needs exactly one Laya bench begin marker');
  const end = parts[1].indexOf(benchEnd);
  assert(end >= 0 && parts[1].split(benchEnd).length === 2, 'Home page needs exactly one Laya bench end marker');
  return { before: parts[0], block: parts[1].slice(0, end), after: parts[1].slice(end) };
}
const framed = rendered => `\n      ${rendered}\n      `;
export const spliceBench = (html, rendered) => { const { before, after } = benchBlock(html); return before + benchBegin + framed(rendered) + after; };
export function assertBenchCurrent(html, laya, readme) {
  assert.equal(benchBlock(html).block, framed(renderLayaBench(laya, readme)), 'The Laya bench in site/index.html differs from the committed record: run node scripts/laya-bench.mjs --write');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const laya = loadLaya();
    writeFileSync(pagePath, spliceBench(readFileSync(pagePath, 'utf8'), renderLayaBench(laya)));
    console.log(`Rendered the Laya bench into ${pagePath} from ${laya.manifest.file} (${laya.manifest.sha256}).`);
  } else {
    console.error('usage: node scripts/laya-bench.mjs --write');
    process.exitCode = 2;
  }
}
