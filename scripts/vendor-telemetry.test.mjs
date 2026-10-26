import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { figuresDigest, sessionFromRows, telemetryProblems } from './lab-telemetry.mjs';
import { claimRow, figureVsRow, vendor, verify } from './vendor-telemetry.mjs';

// The vendoring of Lab 01's telemetry (review of odin-rnd #81): engine figures must be their claims rows, a "main
// build" figure must be an ancestor of the private main head, and --verify refuses a committed file that is not what
// the private files give, even when its digest was recomputed. The private files are synthesised here at test time.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MAIN = 'c'.repeat(40);
const rows = [
  { round: 0, agent: 'Odin', answered: true, s: 1.1, source: 'world-checked', via: 'rules', ok: true, proof: true },
  { round: 0, agent: 'Atlas', answered: true, s: 0.9, source: 'wiki', via: 'scripted', ok: true, proof: true },
];
const sessionBytes = Buffer.from(JSON.stringify({ rows }));
const { per_agent, ok_rate } = sessionFromRows(rows, ['Odin', 'Atlas']);
function inputs({ value = '45.6 -> 1.0', rowClaim = 'Model calls per success 45.6 → 1.0', rowSource = '`3b74a4e0` the router', status = 'MAIN', behind = 0 } = {}) {
  const pack = {
    format: 'odin-telemetry', version: 1, built_at_commit: 'b'.repeat(40), rule: 'every figure carries its source; nothing without one is published',
    agent_space: { status: 'measured', per_agent, ok_rate, rounds: 1, questions_per_round: 2, note: 'latency is wall time on one machine, measured from the visitor line',
      source: { file: 'private/session.json', lens_run: 'run-1', sha256: sha256(sessionBytes), run_commit: 'a'.repeat(40), started: '2026-10-25T13:05:08' } },
    engine: [{ claim: 8, what: 'model calls per successful task', value, unit: 'calls / success', source: { claims_file: 'private/claims.md', row: 8, commit: '3b74a4e0' } }],
  };
  return {
    packBytes: Buffer.from(JSON.stringify(pack)), sessionBytes,
    claimsBytes: Buffer.from(`| # | Claim | Status | Source |\n|---|---|---|---|\n| 8 | ${rowClaim} | ${status} | ${rowSource} |\n`),
    ancestry: { main: MAIN, how: 'GitHub compare API: behind_by 0 means an ancestor of main', checked: '2026-10-25', commits: { '3b74a4e0': { status: behind ? 'diverged' : 'ahead', behind_by: behind } } },
  };
}
const run = (over = {}) => vendor({ commit: 'd'.repeat(40), ...inputs(over) });

test('a faithful vendoring passes the build\'s checks and --verify, and records the main check', () => {
  const record = run();
  assert.deepEqual(telemetryProblems(record), []);
  assert.deepEqual(verify(record, inputs()), []);
  assert.equal(record.engine[0].source.onMain, MAIN);
  assert.equal(record.vendored.mainCheck.main, MAIN);
});

test('an engine figure that is not its claims row is refused at vendoring', () => {
  assert.throws(() => run({ value: '42 -> 1.0' }), /"42" of its value "42 -> 1.0" is not in its claims row/);
  assert.throws(() => run({ rowSource: '`99aa00bb` another run' }), /its commit 3b74a4e0 is not in its claims row's source/);
  assert.deepEqual(figureVsRow({ claim: 10, value: '1,867 passed / 0 failed', source: { commit: '175f14d7' } }, claimRow('| 10 | Tests 1,867 passed / 0 failed | MAIN | `175f14d7` the log |', 10)), []);
});

test('a MAIN row whose commit is not an ancestor of main is refused; the label alone is not enough', () => {
  assert.throws(() => run({ behind: 3 }), /does not show commit 3b74a4e0 as an ancestor of main/);
  assert.throws(() => vendor({ commit: 'd'.repeat(40), ...inputs(), ancestry: { ...inputs().ancestry, commits: {} } }), /as an ancestor of main/);
  assert.throws(() => vendor({ commit: 'd'.repeat(40), ...inputs(), ancestry: undefined }), /--ancestry: needs main/);
  const lane = run({ status: 'LANE' });
  assert.equal(lane.engine[0].source.status, 'work-branch');
  assert.equal('onMain' in lane.engine[0].source, false);
});

test('--verify refuses a hand-edited value even when its digest was recomputed to match', () => {
  const record = run();
  record.engine[0].value = '45.6 -> 0.5';
  record.vendored.figuresSha256 = figuresDigest(record.engine);
  assert.deepEqual(telemetryProblems(record), [], 'the build alone cannot tell: the digest sits beside the values');
  assert.match(verify(record, inputs()).join('\n'), /\/engine\/0\/value: committed "45\.6 -> 0\.5", the private files give "45\.6 -> 1\.0"/);
});

test('the build refuses a main-build figure that does not name the checked main head, and a work-branch one that does', () => {
  const record = run();
  const without = structuredClone(record); delete without.engine[0].source.onMain; without.vendored.figuresSha256 = figuresDigest(without.engine);
  assert.match(telemetryProblems(without).join('\n'), /onMain: a figure in the main build must name the main head/);
  const lane = run({ status: 'LANE' }); lane.engine[0].source.onMain = MAIN; lane.vendored.figuresSha256 = figuresDigest(lane.engine);
  assert.match(telemetryProblems(lane).join('\n'), /onMain: only a figure in the main build is checked against main/);
});
