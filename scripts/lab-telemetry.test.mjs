import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TELEMETRY_FILE, WORK_BRANCH, isMainCommit, readTelemetry, renderTelemetry, telemetryProblems } from './lab-telemetry.mjs';
import { renderLabs } from './labs.mjs';

// Lab 01's vendored telemetry (mission rnd-labs-human-first-1024): the agent space's own measurements and the engine
// figures. Every figure carries its source, the session's counts must add up, and every word passes the screen.
const real = JSON.parse(readFileSync(`site/${TELEMETRY_FILE}`, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const problems = record => telemetryProblems(record).join('\n');
const edit = fn => { const record = clone(real); fn(record); return problems(record); };
const reverse = text => [...text].reverse().join('');
const page = renderLabs()['labs/agent-space/index.html'];

test('the committed telemetry passes, names the pack it was vendored from, and leaves out the run id and the benchmark', () => {
  assert.equal(problems(real), '');
  assert.ok(readTelemetry('site'));
  assert.match(real.vendored.commit, /^[0-9a-f]{40}$/);
  assert.match(real.vendored.packSha256, /^[0-9a-f]{64}$/);
  assert.equal('benchmark' in real, false);
  assert.equal(JSON.stringify(real).includes('lens_run'), false);
});

test('a figure without a source fails the build', () => {
  assert.match(edit(r => { delete r.engine[0].source; }), /engine\/0: missing source/);
  assert.match(edit(r => { delete r.engine[0].source.commit; }), /engine\/0\/source: missing commit/);
  assert.match(edit(r => { delete r.agent_space.source; }), /agent_space: missing source/);
  assert.match(edit(r => { delete r.agent_space.source.sha256; }), /agent_space\/source: missing sha256/);
  assert.match(edit(r => { delete r.vendored.packSha256; }), /vendored: missing packSha256/);
});

test('a run id or anything unknown is refused, in the session source or anywhere else', () => {
  assert.match(edit(r => { r.agent_space.source.lens_run = 'agent-space-live-1792929908'; }), /agent_space\/source\/lens_run: not allowed/);
  assert.match(edit(r => { r.agent_space.source.file = 'runs/agent-space-live-1792929908'; }), /agent_space\/source\/file: a phone number, timestamp or long internal id/);
  assert.match(edit(r => { r.benchmark = []; }), /#\/benchmark: not allowed/);
});

test('the session\'s counts must add up', () => {
  const [name] = Object.keys(real.agent_space.per_agent);
  assert.match(edit(r => { r.agent_space.per_agent[name].answered = r.agent_space.per_agent[name].asked + 1; }), /answered \d+ of \d+ asked/);
  assert.match(edit(r => { r.agent_space.per_agent[name].with_proof = r.agent_space.per_agent[name].answered + 1; }), /proof cards for \d+ answers/);
  assert.match(edit(r => { r.agent_space.per_agent[name].latency_s.p50 = 99; }), /p50 is over p95/);
  assert.match(edit(r => { r.agent_space.ok_rate = 1.5; }), /ok_rate: over 1/);
  assert.match(edit(r => { r.agent_space.rounds += 1; }), /asked, not \d+ rounds of/);
});

test('a pending session shows no number: the page says it is being measured', () => {
  const pending = { ...clone(real), agent_space: { status: 'pending' } };
  assert.equal(problems(pending), '');
  const all = renderTelemetry(pending), html = all.slice(0, all.indexOf('id="engine"'));
  assert.match(html, /BEING MEASURED/);
  assert.doesNotMatch(html, /Answer time per agent|p95/);
  assert.match(problems({ ...clone(real), agent_space: { status: 'pending', ok_rate: 1 } }), /a pending session carries no figures/);
  assert.match(problems({ ...clone(real), agent_space: { status: 'measured' } }), /agent_space: missing per_agent/);
});

test('every word passes the publisher\'s screen', () => {
  assert.match(edit(r => { r.engine[0].what = `a model trained at ${reverse('tfolemag')}`; }), /engine\/0\/what: a restricted name/);
  assert.match(edit(r => { r.engine[0].value = '$0.02 per task'; }), /engine\/0\/value: a price or currency amount/);
  assert.match(edit(r => { r.agent_space.note = `measured in ${reverse('nrooH')} on one machine, with the visitor's own overhead`; }), /agent_space\/note: a place name/);
  assert.match(edit(r => { r.engine[0].source.claims_file = `notes/${reverse('tfolemag')}.md`; }), /engine\/0\/source\/claims_file: a restricted name/);
});

test('the page shows the method note next to the numbers, a source under each, and labels a work-branch figure plainly', () => {
  const space = page.slice(page.indexOf('id="space-measured"'), page.indexOf('id="engine"'));
  assert.ok(space.includes(`<strong>How this was measured:</strong> ${real.agent_space.note.replaceAll('&', '&amp;')}`));
  assert.ok(space.indexOf('How this was measured') < space.indexOf('<svg'), 'the note comes before the chart');
  for (const [name, a] of Object.entries(real.agent_space.per_agent)) assert.ok(space.includes(`<th scope="row">${name}</th><td>${a.asked}</td><td>${a.answered}</td><td>${a.with_proof}</td>`), name);
  assert.ok(space.includes(real.agent_space.source.run_commit.slice(0, 8)));
  for (const figure of real.engine) {
    assert.ok(page.includes(`Source: claims row ${figure.source.row}, ${isMainCommit(figure.source.commit) ? 'commit' : 'branch'} <code>${figure.source.commit}</code>.`), String(figure.claim));
  }
  const branchFigures = real.engine.filter(f => !isMainCommit(f.source.commit));
  assert.equal((page.match(new RegExp(WORK_BRANCH.replaceAll('.', '\\.'), 'g')) ?? []).length, branchFigures.length);
  assert.match(page, /The brain benchmark from the same pack (has|gets) /);
});
