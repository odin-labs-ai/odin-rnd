import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { censusGate } from '../experiments/blueprint-floor/census-gate.mjs';
import { amendNote } from './blueprint-floor-amendment.mjs';
import { amendNoteResults, censusPublication, headline, measuredHead, measuredStatus, publishedResultsPath, qualifyFloorStationData, qualifyHomeExp007, renderFloorExhibit, renderResultsSection, resultsPath } from './blueprint-floor-results-site.mjs';
import { readHead } from './page-head.mjs';
import { stations } from './station-contract.mjs';
import { builtCopy } from './test-build.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 007 results on the site: everything rendered comes from the pinned census gate's return; a results record the gate
// refuses stops the build; the variant is the gate's; every disclosure and every pre-registered limit is shown verbatim.

const sha = b => createHash('sha256').update(b).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const pub = censusPublication('.');
const LONG = { timeout: 900_000 };

test('the committed census is publishable under the pinned gate, and the publication is its return', () => {
  assert.ok(pub, 'results are committed');
  const g = censusGate('.');
  assert.deepEqual([g.publishable, g.variant], [true, pub.variant]);
  assert.deepEqual(pub.facts, g.facts, 'the page data is the gate\'s facts, nothing else');
  assert.equal(pub.variant, results.score.kill.variant, 'the variant is the scorer\'s kill output');
  assert.equal(pub.resultsSha256, sha(readFileSync(resultsPath)));
});

test('a tampered results.json (or record) is refused: the build stops', () => {
  const root = scratchDir('bf-results-tamper');
  try {
    cpSync('experiments/blueprint-floor', join(root, 'experiments/blueprint-floor'), { recursive: true });
    assert.ok(censusPublication(root), 'an untampered copy opens');
    const rp = join(root, resultsPath);
    const r = JSON.parse(readFileSync(rp, 'utf8'));
    r.score.median.expressibleShare = 0.5;
    writeFileSync(rp, JSON.stringify(r, null, 2));
    assert.throws(() => censusPublication(root), /the pinned census gate refuses them: .*not the scorer's recompute \(tampered\)/);
    writeFileSync(rp, JSON.stringify({ ...JSON.parse(readFileSync(resultsPath, 'utf8')), rehearsal: true }));
    assert.throws(() => censusPublication(root), /refuses them: the results are a rehearsal/);
    cpSync(resultsPath, rp);
    const rec = join(root, 'experiments/blueprint-floor/census/control/01.json');
    const c = JSON.parse(readFileSync(rec, 'utf8')); c.translator.classAfterMechanical = 'not'; c.final = { ...c.final, final: 'not', preDispute: 'not' };
    writeFileSync(rec, JSON.stringify(c));
    assert.throws(() => censusPublication(root), /refuses them/, 'a record edited after the results');
  } finally { removeScratch(root); }
});

test('the results section shows the gate\'s numbers: per plugin, medians, controls, agreement, errors, spend at 7 dp; every disclosure and limit verbatim; amendment 01', () => {
  const html = renderResultsSection(pub);
  const s = results.score;
  for (const p of s.perPlugin) assert.ok(html.includes(`<tr><th scope="row">${escape(p.plugin)}</th><td>${p.n}</td><td>${p.expressible}</td><td>${p.partial}</td><td>${p.not}</td><td>${p.error}</td>`), p.plugin);
  assert.ok(html.includes(`<strong>${(s.median.expressibleShare * 100).toFixed(1)}%</strong> across ${s.median.plugins} plugins`));
  assert.ok(html.includes(`Median with partial counted as 0.5 (sensitivity, not decisive): ${(s.median.partialAsHalf * 100).toFixed(1)}%`));
  assert.ok(html.includes(`Positive controls final expressible or partial: ${s.controls.positive.expressibleOrPartial} of ${s.controls.positive.n}`));
  assert.ok(html.includes(`Cohen's kappa ${s.agreement.kappa.toFixed(3)} over ${s.agreement.n} rules`));
  assert.ok(html.includes(`Errors (counted as not): ${s.errors.length}.`));
  for (const e of s.errors) assert.ok(html.includes(`<code>${escape(e.ruleId)}</code>: ${escape(e.reason)}`), e.ruleId);
  assert.ok(html.includes(`Disputes: ${s.disputes.length}`) && html.includes(`Downgrades by the mechanical checks: ${s.downgrades.length}`));
  assert.ok(html.includes(`$${results.spend.totalUsd.toFixed(7)}`) && html.includes(`$${results.spend.countedUsd.toFixed(7)}`) && html.includes(`$${results.spend.excludedUsd.toFixed(7)}`));
  assert.equal(results.spend.totalUsd.toFixed(7), '33.1047852');
  assert.equal(results.disclosures.length, 13);
  for (const d of results.disclosures) assert.ok(html.includes(`<li>${escape(d)}</li>`), `disclosure missing: ${d.slice(0, 60)}`);
  const prereg = JSON.parse(readFileSync('experiments/blueprint-floor/preregistration.json', 'utf8'));
  for (const l of prereg.limits) assert.ok(html.includes(`<li>${escape(l)}</li>`), `limit missing: ${l.slice(0, 60)}`);
  assert.ok(html.includes(`${pub.facts.amendment.eligible} rules were eligible under its rule and ${pub.facts.amendment.recalled} were re-called once`));
  assert.deepEqual([pub.facts.amendment.eligible, pub.facts.amendment.recalled], [37, 37]);
  assert.ok(html.includes(headline(pub)) && html.includes(`variant <code>${pub.variant}</code>`));
});

test('the variant\'s words come from the gate: refuted vs interim; station 07 is earned by a refuted census only', () => {
  assert.equal(pub.variant, 'refuted');
  assert.match(headline(pub), /below the pre-registered 25\.0% bar: the premise is refuted/);
  assert.equal(measuredStatus(pub), 'Measured — premise refuted');
  const interim = { ...pub, variant: 'interim', facts: { ...pub.facts, kill: { ...pub.facts.kill, median: 0.3, refuted: false, variant: 'interim' } } };
  assert.match(headline(interim), /at or above the pre-registered 25\.0% bar: the premise stands for now/);
  assert.equal(measuredStatus(interim), 'Measured — stage 1 result (interim)');
  assert.throws(() => renderFloorExhibit(interim), /earned by a refuted census only/);
  assert.throws(() => renderFloorExhibit(null), /needs the committed EXP 007 census results/);
  assert.match(renderFloorExhibit(pub), /Median expressible share/);
  assert.ok(stations.some(s => s.id === 'floor' && s.number === '07' && s.label === 'Floor' && s.record === 'blueprint-floor'));
});

test('the note: results first, meta MEASURED, the head states the measured result; the home row and the station data say so', () => {
  const note = amendNote(readFileSync('site/journal/which-rules-need-a-model.html', 'utf8'), JSON.parse(readFileSync('experiments/blueprint-floor/amendment-01.json', 'utf8')), sha(readFileSync('experiments/blueprint-floor/amendment-01.json')));
  const out = amendNoteResults(note, pub);
  assert.ok(out.indexOf('id="results"') < out.indexOf('<h2>The question</h2>'), 'results come first');
  assert.match(out, / · MEASURED \d+ [A-Z]{3} 2026<\/p>/);
  const head = readHead(out);
  assert.match(head.title, /Measured: the premise is refuted/);
  assert.ok(head.description.includes(escape(headline(pub))));
  assert.deepEqual(measuredHead(pub).title.includes('premise is refuted'), true);
  assert.throws(() => amendNoteResults(out, pub), /must contain|already carries the results/);
  const row = '<a class="journal-row" href="journal/which-rules-need-a-model.html"><div><p>x Pre-registered, not yet run.</p></div></a>';
  assert.match(qualifyHomeExp007(row, pub), /measured \d+ \w+ 2026: the premise is refuted/);
  const page = `<script type="application/json" id="station-data">${JSON.stringify(stations)}</script>`;
  const data = JSON.parse(/id="station-data">([\s\S]*?)<\/script>/.exec(qualifyFloorStationData(page, pub))[1]);
  assert.equal(data.find(s => s.id === 'floor').status, 'Measured — premise refuted');
});

test('the built site: results.json byte for byte, the measured note and head, station 07 from the gate (fresh build copy)', LONG, () => {
  const dist = join(builtCopy(), 'dist');
  assert.equal(sha(readFileSync(join(dist, 'data/blueprint-floor/results.json'))), pub.resultsSha256);
  assert.equal(readFileSync(publishedResultsPath, 'utf8'), readFileSync(resultsPath, 'utf8'), 'the committed site copy is the results record');
  const note = readFileSync(join(dist, 'journal/which-rules-need-a-model.html'), 'utf8');
  assert.ok(note.includes('id="results"') && note.includes('id="amendment-01"'));
  assert.match(readHead(note).title, /Measured: the premise is refuted/);
  for (const d of results.disclosures) assert.ok(note.includes(escape(d)));
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const exhibit = home.split('id="station-floor"')[1].split('</article>')[0];
  assert.ok(exhibit.includes('Measured — premise refuted') && exhibit.includes(escape(headline(pub))));
  assert.ok(home.includes('data-floor-station="floor"'));
  assert.match(home, /Pre-registered; measured \d+ \w+ 2026: the premise is refuted/);
});
