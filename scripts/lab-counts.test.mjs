import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTS_FILE, SOURCE_RECORD, countsProblems, readCounts, renderCounts, sourceValue } from './lab-counts.mjs';
import { renderLabs } from './labs.mjs';
import { resolvePointer } from './number-provenance.mjs';

// Lab 01's counts gate (mission rnd-labs-human-first-1024): every number names a committed lab record, and the build
// recomputes it from there. These run against the real site/ records.
const real = JSON.parse(readFileSync(`site/${COUNTS_FILE}`, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const problems = record => countsProblems(record, COUNTS_FILE, 'site').join('\n');
const reverse = text => [...text].reverse().join('');
const DISPATCH = 'data/labs/agent-space/dispatches/session-2026-10-25-b.json';
const withBar = edit => { const record = clone(real); edit(record.panels[0].bars[0]); return record; };

test('the committed counts pass, and every number is recomputed from the record it names', () => {
  assert.equal(problems(real), '');
  const record = readCounts('site');
  for (const panel of record.panels) for (const bar of panel.bars) {
    assert.match(bar.source.split('#')[0], SOURCE_RECORD, bar.label);
    assert.equal(sourceValue(bar, 'site').value, bar.value, bar.label);
  }
  // Spot-check one count against the dispatch by hand, not through sourceValue.
  const dispatch = JSON.parse(readFileSync(`site/${DISPATCH}`, 'utf8'));
  const questions = record.panels.flatMap(p => p.bars).find(bar => bar.source === `${DISPATCH}#/questions` && !bar.where);
  assert.equal(questions.value, resolvePointer(dispatch, '/questions').length);
});

test('a number without a source fails the build', () => {
  assert.match(problems(withBar(bar => { delete bar.source; })), /bars\/0: missing source/);
  assert.match(problems(withBar(bar => { bar.source = DISPATCH; })), /bars\/0\/source: the source names no JSON pointer/);
  assert.match(problems(withBar(bar => { bar.value = '4'; })), /bars\/0\/value: expected number/);
});

test('a source that is not a committed lab record is refused: not this file, a page, a pre-registration or another folder', () => {
  for (const source of [`${COUNTS_FILE}#/panels/0/bars/0/value`, 'labs/agent-space/index.html#/x', 'data/review-frontier/preregistration.json#/n',
    'data/labs/agent-space.json#/since', 'data/labs/agent-space/dispatches/../telemetry.json#/x', 'data/labs/agent-space/dispatches/session-2026-01-01.json#/questions']) {
    const record = withBar(bar => { bar.source = source; bar.derive = 'value'; });
    assert.match(problems(record), /bars\/0\/source: .*(is not a committed lab record|is missing)/, source);
  }
});

test('the vendored telemetry pack is an allowed source: its numbers are recomputed like any other', () => {
  const pack = 'data/labs/agent-space/telemetry.json';
  const answered = JSON.parse(readFileSync(`site/${pack}`, 'utf8')).agent_space.per_agent.Odin.answered;
  const bar = { label: 'Odin answered', value: answered, source: `${pack}#/agent_space/per_agent/Odin/answered` };
  assert.equal(sourceValue(bar, 'site').value, answered);
  assert.equal(problems(withBar(b => Object.assign(b, bar, { derive: 'value' }))), '');
  assert.match(problems(withBar(b => Object.assign(b, bar, { derive: 'value', value: answered + 1 }))), /is not what its source gives/);
  assert.match(problems(withBar(b => Object.assign(b, bar, { derive: 'value', source: `${pack}#/rule` }))), /is not a number/);
});

test('a value its source does not give is refused, as are a pointer that does not resolve and a misused derive', () => {
  assert.match(problems(withBar(bar => { bar.value += 1; })), /bars\/0\/value: 5 is not what its source gives \(4\)/);
  assert.match(problems(withBar(bar => { bar.source = `${DISPATCH}#/nowhere`; })), /does not resolve/);
  assert.match(problems(withBar(bar => { bar.derive = 'value'; })), /is not a number/);
  assert.match(problems(withBar(bar => { bar.derive = 'value'; bar.source = `${DISPATCH}#/clip/seconds`; bar.where = { source: 'wiki' }; })), /`where` only applies to derive "count"/);
  assert.match(problems(withBar(bar => { bar.source = `${DISPATCH}#/clip/seconds`; })), /is not a list to count/);
  assert.match(problems(withBar(bar => { bar.where = { source: ['wiki'] }; })), /may only compare fields with plain values/);
  assert.match(problems(withBar(bar => { bar.derive = 'sum'; })), /derive: does not match/);
});

test('the words pass the publisher\'s screen: a price, a restricted name or a place in a panel is refused', () => {
  const panel = edit => { const record = clone(real); edit(record.panels[0]); return problems(record); };
  assert.match(panel(p => { p.line = 'Each session cost $3 to run.'; }), /panels\/0\/line: a price or currency amount/);
  assert.match(panel(p => { p.title = `Answers for ${reverse('tfolemag')}`; }), /panels\/0\/title: a restricted name/);
  assert.match(panel(p => { p.bars[0].label = `Asked in ${reverse('nrooH')}`; }), /panels\/0\/bars\/0\/label: a place name/);
  assert.match(problems({ ...clone(real), note: 'See https://example.com/pack' }), /#\/note: a link to somewhere other than this lab/);
});

test('the page draws each panel as an accessible chart with its numbers as a table, every number linked to its record', () => {
  const page = renderLabs()['labs/agent-space/index.html'];
  for (const panel of real.panels) {
    assert.ok(page.includes(`<svg class="lab-chart" viewBox="0 0 320 ${panel.bars.length * 44}" role="img" aria-labelledby="counts-${panel.id}-title counts-${panel.id}-desc">`), panel.id);
    for (const bar of panel.bars) {
      const file = bar.source.split('#')[0];
      assert.ok(page.includes(`<a href="../../${file}" data-source="${bar.source}" data-format="int">${bar.value}</a>`), `${panel.id}: ${bar.label}`);
    }
  }
  assert.ok(page.includes(`<h3 class="lab-subhead" id="counts">${real.title}</h3>`));
  assert.equal(renderCounts(null), '');
});
