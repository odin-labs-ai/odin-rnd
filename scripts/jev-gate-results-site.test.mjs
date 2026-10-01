import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { amendNote } from './jev-gate-amendment-note.mjs';
import { amendNote02 } from './jev-gate-amendment-02-note.mjs';
import { checkAmendment } from './jev-gate-amendment.mjs';
import { checkAmendment02 } from './jev-gate-amendment-02.mjs';
import { articlePath } from './jev-gate-journal.mjs';
import { ninaAttribution } from './jev-gate-prereg.mjs';
import { amendNoteResults, checkResults, isCompound, spotlightShown, spotlightDecisionPath, criterionFigure, diffSentence, diffVisibilityPath, harnessSectionId, headline, headlineContext, interval, measuredStatus, qualifyHomeResults, rate, renderHarnessSection, renderMeasuredExhibit, renderResultsSection, renderSpotlightCard, resultsSectionId, spotlightItems, upstream } from './jev-gate-results-site.mjs';
import { renderStations } from './station-render.mjs';
import { classify } from '../experiments/jev-gate/diff-visibility.mjs';
import { stripBlocks, stripTags } from './test-html-text.mjs';

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
  for (const phrase of ['Mechanical rules only', 'restricted setup', `refused ${facts.gitToolDenials} times`, `In ${facts.diff.blind.runs} of the ${facts.diff.runs} reviewer runs`, 'The cause was the fence, not nina', 'rather than reviewing a change', 'compound commands or redirections', 'pnpm harness:check', 'One machine', `amendment 01 discloses ${facts.priorCalls.amendment01} calls and amendment 02 ${facts.priorCalls.amendment02}`, `there were ${facts.preCounted.calls} more (${facts.preCounted.matrices} isolation matrices, ${facts.preCounted.reviewerPractice} reviewer practice runs and ${facts.preCounted.jevPractice} Jev practice calls`, 'but not of /private/var/tmp', 'would not have been seen', 'stamped with amendment 01', 'mostly diff-blind mode']) assert(section.includes(html(phrase)), `Limits must state: ${phrase}`);
  assert(section.includes(html(headlineContext(data))) && headlineContext(data).includes('c026') && headlineContext(data).includes('not architectural drift in the usual sense'));
  for (const id of ['jev', 'laya', 'reviewer', 'cascade', 'heuristic-lint', 'heuristic-grep']) {
    const g = results.primary.gates[id];
    for (const part of [`code-level ${rate(g.missedDriftSplit.codeLevel)}, comment-only ${rate(g.missedDriftSplit.commentOnly)}`, `abstained on ${rate(g.abstentionRate.red)} RED and ${rate(g.abstentionRate.green)} GREEN`, `decided only: missed drift ${rate(g.decidedOnly.missedDrift)}`]) assert(section.includes(html(part)), `${id} lacks: ${part}`);
  }
  assert(section.includes(html(`accuracy at high confidence ${rate(results.primary.gates.jev.accuracyAtHighConfidence)}`)));
  assert(section.includes(html(`runs that did not all agree ${rate(results.primary.gates.reviewer.reviewerVariance.items)}`)));
  for (const gate of ['jev', 'reviewer', 'laya', 'cascade']) assert(section.includes(html(results.costPer1000[gate].basis)), `cost per 1,000 basis for ${gate}`);
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
  const figures = [String(facts.gitToolDenials), facts.spend.totalUsd.toFixed(7), results.meanCostPerChange.cascade.toFixed(4), results.meanCostPerChange.reviewerAlone.toFixed(4), `${results.primary.gates.cascade.escalation.x} of`, String(facts.diff.blind.runs), String(facts.harnessCheckMentioned), results.criteria.find(c => c.id === 'cascade-cost').ratio.toFixed(3), String(facts.deniedCompound), facts.preCounted.usd.toFixed(7), 'c026', '/private/var/tmp'];
  for (const figure of figures) assert(!source.includes(figure), `The renderer types ${figure}; read it from the record`);
});

test('the spotlight is held: the bar met with its figures, no card, nothing featured', () => {
  assert.equal(results.spotlight.verdict, 'PASS', 'The registered bar was met');
  assert.equal(data.decision.held, true); assert.equal(data.decision.decision, 'Hold spotlight, measure again');
  assert.equal(spotlightShown(data), false);
  assert.equal(renderSpotlightCard(data), '', 'No card while the spotlight is held');
  const section = renderHarnessSection(data);
  assert.match(section, /The spotlight bar: met, and held/);
  for (const item of spotlightItems(results)) assert(section.includes(html(item)), 'The bar\'s figures stay visible');
  assert(section.includes(html(results.spotlight.criteria.find(c => c.id === 'missed-drift').itemLevel.state)));
  assert(section.includes(html(diffSentence(data))) && section.includes(`In ${facts.diff.blind.runs} of the ${facts.diff.runs} reviewer runs`) && section.includes('The cause was the fence, not nina'));
  assert.match(section, /until a separate pre-registered experiment measures nina reviewing changes/);
  assert(section.includes(html(ninaAttribution.split('— ')[1])), 'The attribution is verbatim');
  for (const u of upstream) assert(section.includes(u.url));
  assert.match(section, /Opened by Odin Labs while setting up this measurement, and not measured/);
  assert.doesNotMatch(section, /harness we measured|featured card/i, 'Nothing promotional');
  const page = qualifyHomeResults(readFileSync('site/index.html', 'utf8'), data);
  assert(!page.includes('id="project-nina"') && !page.includes('HARNESS</span>'), 'The home page carries no nina card');
  // The built page: no EXP 005 card. EXP 006's entry takes the same slot (005, id project-nina) once its own pinned gate
  // opens (EXP 006 REVISION 5: one nina entry only), so the slot may hold that entry and nothing else.
  if (existsSync('dist/index.html')) {
    const built = readFileSync('dist/index.html', 'utf8');
    assert(!built.includes('nina, the harness we measured'), 'The built home page carries no EXP 005 nina card: pnpm build');
    assert(built.split('id="project-nina"').length <= 2, 'one nina entry at most');
    if (built.includes('id="project-nina"')) assert(built.includes('nina: harness orchestration for Claude Code'), 'the only nina entry is EXP 006\'s');
  }
});

test('the card needs BOTH a registered PASS and an explicit not-held decision', () => {
  const variant = (verdict, decision) => { const d = copy(); d.results.spotlight.verdict = verdict; d.decision = decision; return d; };
  const open = { ...data.decision, held: false };
  assert.notEqual(renderSpotlightCard(variant('PASS', open)), '', 'PASS and not held: the card renders');
  assert.equal(renderSpotlightCard(variant('PASS', data.decision)), '', 'PASS but held: no card');
  assert.equal(renderSpotlightCard(variant('PASS', null)), '', 'PASS with no decision record: no card');
  assert.equal(renderSpotlightCard(variant('PASS', { ...open, held: 'false' })), '', 'Only an explicit boolean false opens it');
  assert.equal(renderSpotlightCard(variant('FAIL', open)), '', 'FAIL: no card whatever the decision');
  const failed = variant('FAIL', open); failed.results.spotlight.reasons = ['missed-drift over its bar'];
  assert.match(renderHarnessSection(failed), /did not meet the spotlight bar/);
  const shown = variant('PASS', open);
  assert(qualifyHomeResults(readFileSync('site/index.html', 'utf8'), shown).includes('id="project-nina"'));
  assert(renderSpotlightCard(shown).includes(`In ${facts.diff.blind.runs} of the ${facts.diff.runs} runs`), 'Even when shown, the card states the diff-blind count');
});

test('the spotlight decision is a committed record bound to these results', () => {
  const decision = JSON.parse(readFileSync(spotlightDecisionPath, 'utf8'));
  assert.equal(decision.kind, 'spotlight-decision');
  assert.equal(decision.resultsSha256, data.sha256);
  assert.equal(typeof decision.held, 'boolean');
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
});

test('the results and harness sections cannot scroll sideways at 375px or 320px', () => {
  const css = readFileSync('site/assets/style.css', 'utf8').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const wraps = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(',').map(x => x.trim()).includes('.article-body') && /overflow-wrap:\s*anywhere/.test(body));
  const runs = stripTags(stripBlocks(renderResultsSection(data) + renderHarnessSection(data), ['pre'], ' '), ' ').replace(/&[a-z0-9#]+;/g, 'x').split(/\s+/);
  for (const width of [375, 320]) assert(runs.every(t => t.length <= Math.floor((width - 32) / 9)) || wraps, `An unbroken run is wider than ${width}px and nothing wraps it`);
});

test('the diff-blind classification is committed and reproducible from the reviewer record', () => {
  const committed = JSON.parse(readFileSync(diffVisibilityPath, 'utf8'));
  const recomputed = classify({ reviewer: JSON.parse(readFileSync('experiments/jev-gate/results/reviewer.json', 'utf8')), labels: JSON.parse(readFileSync('experiments/jev-gate/labels.json', 'utf8')) });
  assert.deepEqual(recomputed, committed);
  assert.equal(committed.runs.length, facts.reviewerRuns);
  const blind = committed.runs.filter(r => r.class === 'diff-blind');
  assert(blind.every(r => r.refusedChangeRead && !r.saysRanDiff && (r.saysDiffNotSeen || (r.saysShellBlocked && !r.saysSaw))), 'Diff-blind needs the tool evidence and the report saying the diff went unseen');
  assert(blind.every(r => r.correct), 'Every diff-blind run was correct');
  assert.equal(committed.summary['diff-blind'].runs + committed.summary['diff-seen'].runs + committed.summary.unclear.runs, committed.runs.length);
  assert(facts.diff.blind.meanCostUsd > facts.diff.seen.meanCostUsd && facts.diff.blind.medianLatencyMs > facts.diff.seen.medianLatencyMs);
  assert.equal(facts.baseTree.violations, 0, 'The clean base is what makes a tree audit equal to the label');
});

test('station 06 carries the mixed-basis label on its cost row and the diff caveat on the reviewer row', () => {
  const exhibit = renderMeasuredExhibit(data);
  assert(exhibit.includes(html(`Mean cost per change · ${results.meanCostPerChange.basis}`)));
  assert(exhibit.includes(html(`diff-blind in ${facts.diff.blind.runs} of ${facts.diff.runs} runs`)));
  assert(exhibit.includes(html(headlineContext(data))));
});

// The runs the independent results refute (round 2) adjudicated by reading the reports, and five more read for this
// fix. The classifier must place each as read; c032#2 ran git diff and printed its output, so it is never diff-blind.
test('the diff-visibility classifier agrees with the hand-read runs', () => {
  const expected = {
    'c005#2': 'diff-blind', 'c012#1': 'diff-blind', 'c012#2': 'diff-blind', 'c012#3': 'diff-blind', 'c021#2': 'diff-blind',
    'c029#2': 'diff-blind', 'c044#2': 'diff-blind', 'c047#3': 'diff-blind', 'c056#2': 'diff-blind',
    'c032#2': 'diff-seen', 'c004#1': 'unclear',
    'c023#3': 'diff-blind', 'c025#2': 'diff-blind', 'c027#1': 'diff-blind', 'c028#3': 'diff-blind', 'c034#2': 'diff-blind',
    // Refute round 3: these reports plainly describe the diff as seen.
    'c049#1': 'diff-seen', 'c035#3': 'diff-seen', 'c036#2': 'diff-seen', 'c036#3': 'diff-seen', 'c007#1': 'diff-seen', 'c038#1': 'diff-seen',
    'c059#3': 'diff-seen', 'c031#1': 'diff-seen', 'c033#2': 'diff-seen', 'c037#2': 'diff-seen', 'c027#3': 'diff-seen',
  };
  const runs = JSON.parse(readFileSync(diffVisibilityPath, 'utf8')).runs;
  for (const [key, cls] of Object.entries(expected)) {
    const [id, run] = key.split('#');
    assert.equal(runs.find(r => r.id === id && r.run === Number(run)).class, cls, `${key} should be ${cls}`);
  }
  assert.doesNotMatch(renderResultsSection(data), /at least \d+ of the \d+ reviewer runs/, 'The count is stated exactly');
  assert.equal(facts.diff.unclearSaysNotSeen, 0, 'No unclassified report says it did not see the diff');
  const phrase = `${facts.diff.seen.runs} say they saw it; the other ${facts.diff.unclear.runs} are left unclassified, and none of them says it did not see the diff`;
  assert(renderResultsSection(data).includes(html(phrase)) && renderHarnessSection(data).includes(html(phrase)), 'The page says exactly what the unplaced runs say');
  assert.doesNotMatch(renderResultsSection(data), /say neither or both/);
  assert.deepEqual([facts.diff.blind.runs, facts.diff.items.majorityDiffBlind, facts.diff.items.allRunsDiffBlind], [131, 49, 24], 'The diff-blind figures stay');
});

test('a scrubbed placeholder is not a redirection; a real shell operator is', () => {
  assert.equal(isCompound('git -C <ws> diff'), false);
  assert.equal(isCompound('git -C <ws>/repo status --short'), false);
  assert.equal(isCompound('git status --short > "$TMPDIR/d.txt" 2>&1'), true);
  assert.equal(isCompound('git status --short; git diff'), true);
  assert.equal(isCompound('git log | head'), true);
  const reviewer = JSON.parse(readFileSync('experiments/jev-gate/results/reviewer.json', 'utf8'));
  const commands = reviewer.calls.flatMap(c => (c.permissionDenials ?? []).map(d => String(d.input?.command ?? '')));
  assert.equal(facts.deniedCompound, commands.filter(cmd => /[;|&<>]/.test(cmd.split('<ws>').join('').split('<tmp>').join(''))).length);
  assert(facts.deniedCompound < facts.deniedTotal);
});

test('an empty high-confidence set reads as none, not 0 of 0', () => {
  const section = renderResultsSection(data);
  assert.doesNotMatch(section, /accuracy at high confidence 0 of 0/);
  if (results.primary.gates.laya.accuracyAtHighConfidence.n === 0) assert.match(section, /accuracy at high confidence none \(no answers at that confidence\)/);
});
