import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_HISTORY_FILE, ONE_POINT, engineHistoryProblems, pinProblems, readEngineHistory, renderEngineHistory } from './lab-engine-history.mjs';
import { build, pinFor, serialise } from './vendor-engine-history.mjs';
import { renderLabs } from './labs.mjs';

// "The engine, measured over time" (founder plan 6): each point is a commit that CHANGED a figure, cited by hash and
// checked against the private main head; nothing is drawn between points. The private history is synthesised here.
const MAIN = 'e'.repeat(40);
const sha = n => String(n).repeat(40).slice(0, 40);
const row = (id, text, status) => `| ${id} | ${text} | ${status} | src |`;
function history({ ancestorOf = () => true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-hist-'));
  mkdirSync(join(dir, 'claims')); mkdirSync(join(dir, 'pack'));
  const claims = [
    { sha: sha(1), date: '2026-10-23T03:00:00Z', rows: [row(10, 'Tests 1,867 passed / 0 failed', 'MAIN')] },
    { sha: sha(2), date: '2026-10-23T06:00:00Z', rows: [row(10, 'Tests 1,867 passed / 0 failed', 'MAIN'), row(15, 'agents as QA', 'LANE')] },
    { sha: sha(3), date: '2026-10-23T09:00:00Z', rows: [row(10, 'Tests 1,867 passed / 0 failed', 'MAIN'), row(15, 'agents as QA', 'MAIN')] },
    { sha: sha(4), date: '2026-10-24T09:00:00Z', rows: [row(10, 'Tests 1,901 passed / 0 failed', 'MAIN'), row(15, 'agents as QA', 'MAIN')] },
  ];
  for (const c of claims) writeFileSync(join(dir, `claims/${c.sha}.md`), `| # | Claim | Status | Source |\n${c.rows.join('\n')}\n`);
  writeFileSync(join(dir, 'claims-commits.json'), JSON.stringify(claims.map(({ sha: s, date }) => ({ sha: s, date }))));
  const pack = [{ sha: sha(5), date: '2026-10-25T12:00:00Z' }];
  writeFileSync(join(dir, `pack/${pack[0].sha}.json`), JSON.stringify({ agent_space: { status: 'measured', per_agent: { Odin: { latency_s: { p50: 1.11, p95: 1.12 } } } } }));
  writeFileSync(join(dir, 'pack-commits.json'), JSON.stringify(pack));
  const commits = Object.fromEntries([...claims, ...pack].map(c => [c.sha, ancestorOf(c.sha) ? { status: 'ahead', behind_by: 0 } : { status: 'diverged', behind_by: 2 }]));
  writeFileSync(join(dir, 'ancestry.json'), JSON.stringify({ main: MAIN, how: 'GitHub compare of each cited commit against the private main head', checked: '2026-10-26', commits }));
  return dir;
}
const NOW = new Date('2026-10-26T12:00:00Z');
const withDir = fn => { const dir = history(); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const clone = v => JSON.parse(JSON.stringify(v));

test('a point is a commit that changed a figure: a restated figure adds no point', () => withDir(dir => {
  const { record } = build(dir);
  const by = Object.fromEntries(record.series.map(s => [s.id, s]));
  assert.deepEqual(by['test-suite'].points.map(p => p.values.passed), [1867, 1901], 'restated in commit 2 and 3: no point; changed in 4: a point');
  assert.equal(by['test-suite'].points[1].change, 'passed 1867 → 1901');
  assert.deepEqual(by['claims-on-main'].points.map(p => [p.values.on_main, p.values.recorded]), [[1, 1], [1, 2], [2, 2]]);
  assert.match(by['claims-on-main'].points[2].change, /agents as QA, on a real outage: moved from a work branch into the main build/);
  assert.equal(by['answer-time'].points.length, 1);
  assert.equal(by['tick-1000'].points.length, 0);
  assert.deepEqual(engineHistoryProblems(record, { now: NOW }), []);
}));

test('the vendoring is deterministic and refuses a commit that is not an ancestor of main', () => withDir(dir => {
  assert.equal(serialise(build(dir).record), serialise(build(dir).record));
  const bad = history({ ancestorOf: s => s !== sha(3) });
  try { assert.throws(() => build(bad), /commit 3{40} is not shown as an ancestor of main/); } finally { rmSync(bad, { recursive: true, force: true }); }
}));

test('the gate refuses a bad commit, another main head, a fake date, disorder, the future, a non-number and a screen hit', () => withDir(dir => {
  const { record } = build(dir);
  const edit = fn => { const r = clone(record); fn(r); return engineHistoryProblems(r, { now: NOW }).join('\n'); };
  assert.match(edit(r => { r.series[1].points[0].commit = 'abc'; }), /commit: does not match/);
  assert.match(edit(r => { r.series[1].points[0].onMain = 'd'.repeat(40); }), /onMain: a point must name the main head/);
  assert.match(edit(r => { r.series[1].points[0].at = '2026-02-30T00:00:00Z'; }), /is not a real date/);
  assert.match(edit(r => { r.series[1].points.reverse(); }), /comes before the point above it/);
  assert.match(edit(r => { r.series[1].points[1].at = '2027-01-01T00:00:00Z'; }), /is after this build/);
  assert.match(edit(r => { r.series[1].points[0].values.passed = 'many'; }), /not a finite number/);
  assert.match(edit(r => { r.series[1].note = 'Run on /Users/someone/engine for €40.'; }), /a price or currency amount|a file path/);
  assert.match(edit(r => { r.series[1].points[0].repo = 'odin-labs-ai/private'; }), /repo: not allowed/);
}));

test('the bytes are pinned', () => withDir(dir => {
  const { record, sourceSha256 } = build(dir);
  const bytes = Buffer.from(serialise(record));
  const pin = pinFor(bytes, sourceSha256, MAIN);
  assert.deepEqual(pinProblems(bytes, { ...pin, file: `site/${ENGINE_HISTORY_FILE}` }), []);
  assert.match(pinProblems(Buffer.from(`${bytes} `), { ...pin, file: `site/${ENGINE_HISTORY_FILE}` }).join(), /re-vendor/);
}));

test('the page: one dot per point, nothing between them; a single point says so; every point cites its commit', () => withDir(dir => {
  const { record } = build(dir);
  const html = renderEngineHistory(record);
  assert.match(html, /The engine, measured over time\./);
  const plots = html.match(/<svg class="lab-chart engine-plot"[\s\S]*?<\/svg>/g) ?? [];
  assert.equal(plots.length, 2, 'claims-on-main and test-suite have two or more points');
  for (const svg of plots) {
    assert.doesNotMatch(svg, /<path|<polyline|<polygon/, 'no line between points');
    assert.equal((svg.match(/<line /g) ?? []).length, 1, 'only the time axis');
  }
  assert.equal((html.match(new RegExp(ONE_POINT.replace('.', '\\.'), 'g')) ?? []).length, 1, 'answer time has one point');
  assert.doesNotMatch(html, /id="engine-tick-1000"/, 'a series with no point is not drawn');
  for (const s of record.series) for (const p of s.points) assert.ok(html.includes(`Private commit <code>${p.commit.slice(0, 8)}</code>, cited by hash`), p.commit);
}));

test('the committed record passes, and Lab 01 shows it', () => {
  const record = readEngineHistory('site', { now: NOW });
  assert.ok(record);
  const page = renderLabs()['labs/agent-space/index.html'];
  assert.match(page, /id="engine-over-time"/);
  for (const s of record.series.filter(x => x.points.length === 1)) assert.ok(page.slice(page.indexOf(`id="engine-${s.id}"`)).includes(ONE_POINT), s.id);
  assert.doesNotMatch(page.slice(page.indexOf('id="engine-over-time"')), /\boac\b/i);
});
