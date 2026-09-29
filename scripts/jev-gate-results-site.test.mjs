import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { amendNote } from './jev-gate-amendment-note.mjs';
import { amendNote02 } from './jev-gate-amendment-02-note.mjs';
import { checkAmendment } from './jev-gate-amendment.mjs';
import { checkAmendment02 } from './jev-gate-amendment-02.mjs';
import { articlePath } from './jev-gate-journal.mjs';
import { ninaAttribution } from './jev-gate-prereg.mjs';
import { amendNoteResults, checkResults, criterionFigure, harnessSectionId, headline, interval, measuredStatus, qualifyHomeResults, rate, renderHarnessSection, renderMeasuredExhibit, renderResultsSection, renderSpotlightCard, resultsSectionId, spotlightItems, upstream } from './jev-gate-results-site.mjs';
import { renderStations } from './station-render.mjs';

const data = checkResults();
const { results, facts } = data;
const copy = () => structuredClone(data);
const html = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const a01 = checkAmendment(), a02 = checkAmendment02();
const builtNote = () => amendNoteResults(amendNote02(amendNote(readFileSync(articlePath, 'utf8'), a01.record, a01.sha256), a02.record, a02.sha256), data);
const report = JSON.parse(readFileSync('site/data/experiments.json', 'utf8'));
const reports = ['migration-witness', 'test-witness', 'ci-witness'].map(id => JSON.parse(readFileSync(`site/data/witnesses/${id}.json`, 'utf8')));

test('the results record is the frozen results.mjs computation of the committed runs, and publishable', () => {
  assert(data, 'A committed results record exists');
  assert.equal(results.fixture, false);
  assert.equal(results.partial, null);
  assert.equal(results.claim.refuted, results.criteria.some(c => c.state === 'refuted'), 'The claim rule: refuted if any criterion is');
});

test('the headline states the refutation and why, from the record', () => {
  const h = headline(data);
  const best = results.primary.gates[facts.best.id].missedDrift, jev = results.primary.gates.jev.missedDrift;
  assert.match(h, /^The claim is refuted, by the criterion jev-vs-best-baseline\./);
  assert(h.includes(`missed ${best.x} of ${best.n} drift items; Jev missed ${jev.x} of ${jev.n}`));
  assert.equal(measuredStatus(data), 'Measured — claim refuted');
  const changed = copy(); changed.results.primary.gates.jev.missedDrift.x += 2;
  assert(headline(changed).includes(`Jev missed ${jev.x + 2} of ${jev.n}`), 'A changed record changes the headline');
  const held = copy(); held.results.claim.refuted = false;
  assert.match(headline(held), /holds/);
});

test('station 06 is measured: every criterion with its state verbatim and its figure, refuted shown red', () => {
  const exhibit = renderStations(report, reports).split('id="station-triage"')[1].split('</article>')[0];
  assert(exhibit.includes(`<span>${measuredStatus(data)}</span>`));
  assert(exhibit.includes(renderMeasuredExhibit(data)));
  for (const c of results.criteria) {
    assert(exhibit.includes(html(c.statement)) && exhibit.includes(html(criterionFigure(c))), `Station 06 is missing ${c.id}`);
    assert(exhibit.includes(`<strong class="${c.state === 'refuted' ? 'verdict-red' : c.state === 'passes' ? 'verdict-green' : 'verdict-amber'}">${html(c.state)}</strong>`));
  }
  assert(exhibit.includes('passes, not established at this N'));
  assert(exhibit.includes(`href="journal/jev-as-a-fast-gate.html#${resultsSectionId}"`) && exhibit.includes('href="data/jev-gate/results.json"'));
  assert.doesNotMatch(exhibit, /Pre-registered — not yet run/);
  const changed = copy(); changed.results.criteria[0].interval.x = 7; changed.results.criteria[0].interval.estimate = 7 / 30;
  assert(renderMeasuredExhibit(changed).includes('7 of 30'), 'A changed record changes the station');
  assert.equal(renderStations(report, reports, undefined, undefined, undefined, undefined, undefined, null).includes('Pre-registered — not yet run'), true, 'Without results the station stays pre-registered');
});

test('the journal results section carries every criterion, Laya on its two criteria, the gates, cost, spend and the limits', () => {
  const section = renderResultsSection(data);
  for (const c of results.criteria) assert(section.includes(html(c.statement)) && section.includes(html(c.state)) && section.includes(html(criterionFigure(c))));
  for (const c of results.layaCriteria) assert(section.includes(html(c.id)) && section.includes(html(rate(c.interval))) && section.includes(html(interval(c.interval))));
  assert.match(section, /Laya is judged on the two single-rate criteria only/);
  assert(section.includes(html(rate(results.primary.gates.cascade.escalation))));
  assert(section.includes(`$${results.meanCostPerChange.cascade.toFixed(4)}`) && section.includes(`$${results.meanCostPerChange.reviewerAlone.toFixed(4)}`));
  assert(section.includes(`$${facts.spend.totalUsd.toFixed(7)}`));
  for (const phrase of ['Mechanical rules only', 'restricted setup', `refused ${facts.gitToolDenials} times`, 'could not see or read the diff', 'pnpm harness:check', 'One machine', `amendment 01 (${facts.priorCalls.amendment01} calls)`, `amendment 02 (${facts.priorCalls.amendment02} calls)`, 'pre-flight', 'would not have been seen']) assert(section.includes(html(phrase)), `Limits must state: ${phrase}`);
  const changed = copy(); changed.results.latency.jev.p50Ms = 1234;
  assert(renderResultsSection(changed).includes('Jev 1234 and'), 'A changed record changes the section');
});

test('the figures taken from the other records are computed from them', () => {
  const reviewer = JSON.parse(readFileSync('experiments/jev-gate/results/reviewer.json', 'utf8'));
  assert.equal(facts.gitToolDenials, reviewer.calls.reduce((s, c) => s + (c.gitToolDenials ?? 0), 0));
  assert.equal(facts.reviewerRuns, reviewer.calls.length);
  assert.equal(facts.deniedForms.reduce((s, [, n]) => s + n, 0) <= facts.deniedTotal, true);
  const ledger = readFileSync('experiments/jev-gate/spend-ledger.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.ts > results.notBefore);
  const since = Math.round(Number((ledger.reduce((s, l) => s + l.costUsd, 0) * 1e7).toFixed(3)));
  assert.equal(Math.round(facts.spend.totalUsd * 1e7), Math.round(a02.record.spend.alreadySpentUsd * 1e7) + since);
  assert(facts.spend.totalUsd < facts.spend.capUsd);
});

test('no result figure is typed in the renderer', () => {
  const source = readFileSync('scripts/jev-gate-results-site.mjs', 'utf8');
  const figures = [String(facts.gitToolDenials), facts.spend.totalUsd.toFixed(7), results.meanCostPerChange.cascade.toFixed(4), results.meanCostPerChange.reviewerAlone.toFixed(4), `${results.primary.gates.cascade.escalation.x} of`, String(facts.diffUnread), String(facts.harnessCheckMentioned), results.criteria.find(c => c.id === 'cascade-cost').ratio.toFixed(3)];
  for (const figure of figures) assert(!source.includes(figure), `The renderer types ${figure}; read it from the record`);
});

test('nina is spotlighted only when the bar was met: card and section render from the record', () => {
  assert.equal(results.spotlight.verdict, 'PASS');
  const card = renderSpotlightCard(data);
  assert(card.includes('id="project-nina"') && card.includes('href="https://github.com/xhulz/nina"'));
  assert(card.includes(html(ninaAttribution.split('— ')[1])), 'The attribution is verbatim');
  assert.match(card, /nothing else about nina was measured/);
  const section = renderHarnessSection(data);
  for (const item of spotlightItems(results)) assert(section.includes(html(item)));
  assert(section.includes(html(results.spotlight.criteria.find(c => c.id === 'missed-drift').itemLevel.state)));
  for (const u of upstream) assert(section.includes(u.url));
  assert.match(section, /not measured/); assert.match(section, /Neither change is in the 0\.34\.0 release the reviewer ran/);
  assert(!card.includes('pull/39') && !card.includes('pull/41'), 'The upstream changes are not on the card as properties');
  const failed = copy(); failed.results.spotlight.verdict = 'FAIL'; failed.results.spotlight.reasons = ['missed-drift over its bar'];
  assert.equal(renderSpotlightCard(failed), '', 'No card without a PASS');
  assert.match(renderHarnessSection(failed), /did not meet the spotlight bar/);
  const page = readFileSync('site/index.html', 'utf8');
  assert(qualifyHomeResults(page, data).includes('id="project-nina"'));
  assert(!qualifyHomeResults(page, failed).includes('id="project-nina"'));
  const changed = copy(); changed.results.spotlight.criteria.find(c => c.id === 'self-agreement').x = 57;
  assert(renderSpotlightCard(changed).includes('57 of'), 'A changed record changes the card');
});

test('the home page shows the measured state in row 004 and the journal row', () => {
  const page = qualifyHomeResults(readFileSync('site/index.html', 'utf8'), data);
  const row = page.split('<div class="project-number">004')[1].split('</article>')[0];
  assert(row.includes('<dt>Status</dt><dd>Measured</dd>') && row.includes('<dt>Results</dt><dd>Claim refuted</dd>'));
  assert(row.includes(html(headline(data))) && row.includes(`#${resultsSectionId}`));
  assert(page.includes('Pre-registered; measured 29 Sep 2026: the claim is refuted.'));
  assert.throws(() => qualifyHomeResults(page, data), /exactly once/);
});

test('the built note: results and the harness first, the pre-registration text otherwise unchanged', () => {
  const parent = readFileSync(articlePath, 'utf8');
  const note = builtNote();
  assert(note.includes(renderResultsSection(data)) && note.includes(renderHarnessSection(data)));
  assert(note.indexOf(`id="${resultsSectionId}"`) < note.indexOf(`id="${harnessSectionId}"`) && note.indexOf(`id="${harnessSectionId}"`) < note.indexOf('id="amendment-01"'));
  assert.match(note, /AMENDED AGAIN 28 SEP 2026 · MEASURED 29 SEP 2026<\/p>/);
  // Every line of the parent's article body survives, apart from the three lines the qualifiers extend.
  const body = parent.split('<article class="article-body">\n')[1].split('</article>')[0].split('\n');
  const extended = body.filter(line => !note.includes(line));
  assert(extended.length <= 3, `Parent lines changed: ${extended.length}`);
  for (const line of extended) assert(/No results yet|no results yet|including a refutation/.test(line), `An unexpected parent line changed: ${line.slice(0, 80)}`);
  assert.throws(() => amendNoteResults(note, data), /exactly once|already carries/);
  if (existsSync('dist/journal/jev-as-a-fast-gate.html')) assert(readFileSync('dist/journal/jev-as-a-fast-gate.html', 'utf8').includes(renderResultsSection(data)), 'The built note is not the committed results: pnpm build');
  if (existsSync('dist/index.html')) assert(readFileSync('dist/index.html', 'utf8').includes(renderSpotlightCard(data)), 'The built home page lacks nina\'s card: pnpm build');
});

test('the results and harness sections cannot scroll sideways at 375px or 320px', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  const runs = (renderResultsSection(data) + renderHarnessSection(data)).replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
  for (const width of [375, 320]) assert(runs.every(t => t.length <= Math.floor((width - 32) / 9)) || wraps, `An unbroken run is wider than ${width}px and nothing wraps it`);
});
