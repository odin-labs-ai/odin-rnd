import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_COMMIT, TELEMETRY_FILE, WORK_BRANCH, figuresDigest, readTelemetry, renderTelemetry, telemetryProblems } from './lab-telemetry.mjs';
import { renderLabs } from './labs.mjs';

// Lab 01's vendored telemetry (mission rnd-labs-human-first-1024): the agent space's own measurements and the engine
// figures. Every figure carries its source, every session figure is recomputed from the session's own question rows,
// an engine figure edited by hand is refused, and every word (a source included) passes the screen.
const real = JSON.parse(readFileSync(`site/${TELEMETRY_FILE}`, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const problems = record => telemetryProblems(record).join('\n');
const edit = fn => { const record = clone(real); fn(record); return problems(record); };
// An engine edit made the way an honest re-vendoring would make it: the figures' digest taken again.
const editEngine = fn => edit(r => { fn(r); r.vendored.figuresSha256 = figuresDigest(r.engine); });
const reverse = text => [...text].reverse().join('');
const page = renderLabs()['labs/agent-space/index.html'];

test('the committed telemetry passes, names the pack it was vendored from, and leaves out the run id and the benchmark', () => {
  assert.equal(problems(real), '');
  assert.ok(readTelemetry('site'));
  assert.match(real.vendored.commit, /^[0-9a-f]{40}$/);
  assert.match(real.vendored.packSha256, /^[0-9a-f]{64}$/);
  assert.equal('benchmark' in real, false);
  assert.equal(JSON.stringify(real).includes('lens_run'), false);
  assert.equal(JSON.stringify(real).includes('.md'), false, 'no private path');
  assert.equal(real.agent_space.rows.length, real.agent_space.rounds * real.agent_space.questions_per_round);
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
  assert.match(edit(r => { r.agent_space.source.file = 'evidence/lab01/telemetry/agent-space-session.json'; }), /agent_space\/source\/file: not allowed/);
  assert.match(edit(r => { r.engine[0].source.claims_file = 'notes/claims.md'; }), /engine\/0\/source\/claims_file: not allowed/);
  assert.match(edit(r => { r.benchmark = []; }), /#\/benchmark: not allowed/);
});

test('every session figure is recomputed from the question rows: a figure the rows do not give is refused', () => {
  const [name] = Object.keys(real.agent_space.per_agent);
  assert.match(edit(r => { r.agent_space.per_agent[name].answered -= 1; }), new RegExp(`per_agent/${name}/answered: \\d+, the session rows give \\d+`));
  assert.match(edit(r => { r.agent_space.per_agent[name].with_proof -= 1; }), /with_proof: \d+, the session rows give/);
  assert.match(edit(r => { r.agent_space.per_agent[name].latency_s.p50 = 0.42; }), /latency_s: .*the session rows give/);
  assert.match(edit(r => { r.agent_space.per_agent[name].sources = ['tool']; }), /sources: .*the session rows give/);
  // The case the review named: every count zeroed while the rate stays 1.
  const zeroed = edit(r => { for (const a of Object.values(r.agent_space.per_agent)) { a.answered = 0; a.with_proof = 0; } });
  assert.match(zeroed, /answered: 0, the session rows give/);
  assert.match(zeroed, /with_proof: 0, the session rows give/);
  assert.match(edit(r => { r.agent_space.ok_rate = 0.5; }), /ok_rate: 0.5, the session rows give 1/);
  // A row changed is a figure changed: the rows are the evidence, so editing one moves the recomputed figure.
  assert.match(edit(r => { r.agent_space.rows.find(x => x.agent === name && x.proof).proof = false; }), /with_proof: \d+, the session rows give/);
  assert.match(edit(r => { r.agent_space.rounds += 1; }), /asked, not \d+ rounds of/);
  assert.match(edit(r => { r.agent_space.rows.push({ ...r.agent_space.rows[0], agent: 'Vega' }); }), /rows for Vega, who has no figures/);
});

test('an engine figure edited by hand is refused: its value must be the one vendored', () => {
  assert.match(edit(r => { r.engine[0].value = '42'; }), /engine: the figures are not the ones vendored/);
  assert.match(edit(r => { r.engine[0].source.status = 'main'; r.engine.at(-1).source.status = 'main'; }), /engine: the figures are not the ones vendored/);
  assert.equal(editEngine(() => {}), '');
});

test('the main-build label comes from the claims row, never from what the commit looks like', () => {
  const branchIndex = real.engine.findIndex(f => f.source.status === 'work-branch');
  // A hex sha on a work branch stays labelled a work branch.
  const html = renderTelemetry({ ...clone(real), engine: real.engine.map((f, i) => (i === branchIndex ? { ...f, source: { ...f.source, commit: 'deadbeef' } } : f)) });
  assert.ok(html.includes(`Source: claims row ${real.engine[branchIndex].source.row}, on a work branch, commit <code>deadbeef</code>.`));
  assert.equal((html.match(new RegExp(WORK_BRANCH.replaceAll('.', '\\.'), 'g')) ?? []).length, 1);
  assert.match(editEngine(r => { r.engine[0].source.commit = null; }), /engine\/0\/source: a figure in the main build without its commit/);
  assert.match(editEngine(r => { r.engine[0].source.status = 'merged'; }), /engine\/0\/source\/status: does not match/);
});

test('all-zero latencies chart at 0, never NaN', () => {
  const zero = clone(real);
  for (const a of Object.values(zero.agent_space.per_agent)) a.latency_s = { p50: 0, p95: 0 };
  const html = renderTelemetry(zero);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /<line class="lab-chart-mark" x1="0" x2="0"/);
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
  assert.match(editEngine(r => { r.engine[0].source.row = `${reverse('tfolemag')}-7`; }), /engine\/0\/source\/row: a restricted name/);
  assert.match(edit(r => { r.agent_space.source.record = 'evidence/lab01/session.json'; }), /agent_space\/source\/record: must be/);
});

test('the page shows the method note next to the numbers, a source under each, and labels a work-branch figure plainly', () => {
  const space = page.slice(page.indexOf('id="space-measured"'), page.indexOf('id="engine"'));
  assert.ok(space.includes(`<strong>How this was measured:</strong> ${real.agent_space.note.replaceAll('&', '&amp;')}`));
  assert.ok(space.indexOf('How this was measured') < space.indexOf('<svg'), 'the note comes before the chart');
  for (const [name, a] of Object.entries(real.agent_space.per_agent)) assert.ok(space.includes(`<th scope="row">${name}</th><td>${a.asked}</td><td>${a.answered}</td><td>${a.with_proof}</td>`), name);
  assert.ok(space.includes(real.agent_space.source.run_commit.slice(0, 8)));
  for (const figure of real.engine) {
    const where = figure.source.status === 'main' ? 'in the main build' : 'on a work branch';
    const line = figure.source.commit ? `Source: claims row ${figure.source.row}, ${where}, commit <code>${figure.source.commit.slice(0, 8)}</code>.` : `Source: claims row ${figure.source.row}, ${where}. ${NO_COMMIT}`;
    assert.ok(page.includes(line), String(figure.claim));
  }
  const branchFigures = real.engine.filter(f => f.source.status !== 'main');
  assert.equal((page.match(new RegExp(WORK_BRANCH.replaceAll('.', '\\.'), 'g')) ?? []).length, branchFigures.length);
  // The answered line is the counts, never the ok rate under another name.
  const answered = Object.values(real.agent_space.per_agent).reduce((n, a) => n + a.answered, 0);
  assert.ok(space.includes(`: ${answered} answered,`));
  assert.doesNotMatch(space, /answered: \d+%/);
  for (const o of real.vendored.omitted) assert.ok(page.includes(`claim ${o.claim} (${o.why})`), o.claim);
  assert.match(page, /The brain benchmark from the same pack (has|gets) /);
});
