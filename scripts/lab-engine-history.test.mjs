import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_HISTORY_FILE, engineHistoryProblems, measuredLine, pinProblems, readEngineHistory, renderClaimsOverTime } from './lab-engine-history.mjs';
import { build, pinFor, serialise } from './vendor-engine-history.mjs';
import { renderLabs } from './labs.mjs';
import { namesRestricted } from './lab-dispatch-publish.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

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

test('the bytes are pinned, and the pin must name the record\'s own main head and source digest', () => withDir(dir => {
  const { record, sourceSha256 } = build(dir);
  const bytes = Buffer.from(serialise(record));
  const pin = { ...pinFor(bytes, sourceSha256, MAIN), file: `site/${ENGINE_HISTORY_FILE}` };
  assert.equal(record.vendored.sourceSha256, sourceSha256);
  assert.deepEqual(pinProblems(bytes, pin), []);
  assert.match(pinProblems(Buffer.from(`${bytes} `), pin).join(), /re-vendor/);
  assert.match(pinProblems(bytes, { ...pin, commit: 'a'.repeat(40) }).join(), /is not the main head the record was checked against/);
  assert.match(pinProblems(bytes, { ...pin, sourceSha256: '0'.repeat(64) }).join(), /sourceSha256 0{64} is not the record's/);
}));

test('a claim that disappears from the table is a change too: its point is recorded, never skipped', () => {
  const dir = history();
  try {
    const later = { sha: sha(6), date: '2026-10-24T12:00:00Z' };
    writeFileSync(join(dir, `claims/${later.sha}.md`), `| # | Claim | Status | Source |\n${row(10, 'Tests 1,901 passed / 0 failed', 'MAIN')}\n`);
    const commits = JSON.parse(readFileSync(join(dir, 'claims-commits.json'), 'utf8'));
    writeFileSync(join(dir, 'claims-commits.json'), JSON.stringify([...commits, later]));
    const ancestry = JSON.parse(readFileSync(join(dir, 'ancestry.json'), 'utf8'));
    ancestry.commits[later.sha] = { status: 'ahead', behind_by: 0 };
    writeFileSync(join(dir, 'ancestry.json'), JSON.stringify(ancestry));
    const status = build(dir).record.series.find(s => s.id === 'claims-on-main').points;
    assert.deepEqual(status.at(-1).values, { on_main: 1, recorded: 1 });
    assert.match(status.at(-1).change, /agents as QA, on a real outage: removed from the claims table/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the claims series is a step chart: a value is held until it changes, and every point cites its commit', () => withDir(dir => {
  const { record } = build(dir);
  const html = renderClaimsOverTime(record);
  assert.match(html, /Engine claims in the main build over time/);
  const svg = html.match(/<svg class="lab-chart engine-plot"[\s\S]*?<\/svg>/)[0];
  assert.doesNotMatch(svg, /<path|<polyline|<polygon/, 'no free line, no curve');
  const points = record.series.find(s => s.id === 'claims-on-main').points;
  assert.equal((svg.match(/class="engine-step"/g) ?? []).length, 2 * (points.length - 1), 'one flat and one riser per change');
  assert.equal((svg.match(/<circle/g) ?? []).length, points.length);
  for (const p of points) assert.ok(html.includes(`Private commit <code>${p.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${MAIN.slice(0, 8)}</code> on <time datetime="2026-10-26">2026-10-26</time>`), p.commit);
  assert.match(html, /A figure measured once becomes a series by itself/);
}));

test('a figure measured once is stated, never drawn; it becomes a line only when a later commit changes it', () => withDir(dir => {
  const { record } = build(dir);
  const once = measuredLine(record, 'answer-time');
  assert.match(once, /^<p class="engine-once">Measured once so far, on <time datetime="2026-10-25T12:00:00Z">25 Oct<\/time>\. Private commit <code>5{8}<\/code>, cited by hash, checked as part of the private main <code>e{8}<\/code> on <time datetime="2026-10-26">2026-10-26<\/time>/);
  assert.doesNotMatch(once, /<svg|<line|<path/);
  assert.equal(measuredLine(record, 'tick-1000'), '', 'no point: nothing at all');
  // Two points: it becomes a series by itself, drawn as a step chart, and EVERY point is cited with the main head.
  const twice = measuredLine(record, 'test-suite');
  assert.match(twice, /Measured 2 times, from <time[^>]*>23 Oct<\/time> to <time[^>]*>24 Oct<\/time>/);
  assert.match(twice, /<svg class="lab-chart engine-plot"/);
  for (const p of record.series.find(x => x.id === 'test-suite').points) assert.ok(twice.includes(`Private commit <code>${p.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${MAIN.slice(0, 8)}</code>`), p.commit);
  assert.doesNotMatch(twice, /<path|<polyline|<polygon/);
  const single = clone(record); const s = single.series.find(x => x.id === 'claims-on-main'); s.points = s.points.slice(0, 1);
  assert.doesNotMatch(renderClaimsOverTime(single), /<svg/, 'a one-point claims series is not drawn');
}));

test('the committed record passes, and Lab 01 shows it inside "The engine underneath"', () => {
  const record = readEngineHistory('site', { now: NOW });
  assert.ok(record);
  const page = renderLabs()['labs/agent-space/index.html'];
  const engine = page.slice(page.indexOf('id="engine"'));
  assert.match(engine, /Engine claims in the main build over time/);
  const singles = record.series.filter(x => x.points.length === 1).length;
  assert.equal((page.match(/Measured once so far, on /g) ?? []).length, singles, 'one line per single-point figure');
  assert.equal((page.match(/<svg class="lab-chart engine-plot"/g) ?? []).length, record.series.filter(x => x.points.length > 1).length);
  assert.doesNotMatch(page, /id="engine-over-time"/, 'no separate section');
  assert.ok(!namesRestricted(page), 'a restricted name (the private repository)');
});
