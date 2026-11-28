import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, checkPins, parseBranch, sha256Hex, windowDays } from './analyse.mjs';

const PREREG = {
  experiment: { id: 'EXP 023', authoredOn: '2026-11-28' },
  window: { from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z' },
  labs: ['rogue', 'review', 'red-build', 'measured-blind'],
  decision: { rule: { currentMedianLatencyMaxDays: 2, currentMinCoverage: 0.8, backloggedMaxLatencyMinDays: 7, backloggedMaxCoverage: 0.5 } },
};

test('parseBranch reads the lab and every day, dropping only the final HHMMSS group', () => {
  assert.deepEqual(parseBranch('records/rogue-20261127-053337'), { lab: 'rogue', days: ['20261127'] });
  assert.deepEqual(parseBranch('records/red-build-20261105-20261106-20261107-071918'), { lab: 'red-build', days: ['20261105', '20261106', '20261107'] });
});

test('parseBranch refuses anything outside the lander\'s own branch contract', () => {
  for (const ref of ['records/unknown-lab-20261127-053337', 'feature/not-a-record', 'records/rogue-20261127', 'records/rogue-2026112-053337', 'records/rogue-20261127-53337']) {
    assert.equal(parseBranch(ref), null, ref);
  }
});

test('erratum-02.json #10: a doubled dash (an empty day group) refuses the whole branch, rather than silently dropping the empty group and keeping the one real day', () => {
  assert.equal(parseBranch('records/rogue-20261101--120000'), null);
  assert.equal(parseBranch('records/red-build-20261105--20261107-071918'), null);
});

test('windowDays enumerates every day, half-open (to excluded)', () => {
  const days = windowDays(Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-04T00:00:00Z'));
  assert.deepEqual(days, ['20261101', '20261102', '20261103']);
});

function pr(headRefName, { state = 'MERGED', mergedAt = null, number = 1 } = {}) {
  return { number, headRefName, state, createdAt: mergedAt, mergedAt };
}

test('a same-day merge gives latencyDays near 0 and full coverage for a 1-day window', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' } };
  const capture = { fetchedAt: '2026-11-10T00:00:00Z', pullRequests: [pr('records/rogue-20261101-053337', { mergedAt: '2026-11-01T06:02:00Z' })] };
  const result = analyse(capture, prereg);
  assert.equal(result.perLab.rogue.coverage, 1);
  assert.equal(result.perLab.rogue.daysLanded, 1);
  assert.ok(result.perLab.rogue.medianLatencyDays < 1 && result.perLab.rogue.medianLatencyDays > 0);
  assert.equal(result.perLab.rogue.verdict, 'current');
});

test('a 9-day bundled PR gives each of its days its own latency, the oldest the largest', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-05T00:00:00Z', to: '2026-11-14T00:00:00Z' } };
  const days = ['20261105', '20261106', '20261107', '20261108', '20261109', '20261110', '20261111', '20261112', '20261113'];
  const branch = `records/red-build-${days.join('-')}-071918`;
  const capture = { fetchedAt: '2026-11-20T00:00:00Z', pullRequests: [pr(branch, { mergedAt: '2026-11-13T07:38:16Z' })] };
  const result = analyse(capture, prereg);
  const lab = result.perLab['red-build'];
  assert.equal(lab.daysLanded, 9);
  assert.equal(lab.coverage, 1);
  // 2026-11-05 waited ~8.3 days, 2026-11-13 waited ~0.3 days -- the spread must show up, not be averaged away silently.
  assert.ok(lab.maxLatencyDays > 8 && lab.maxLatencyDays < 9, lab.maxLatencyDays);
  assert.equal(lab.verdict, 'backlogged', JSON.stringify(lab));
});

test('a day with no merged PR and no open PR, well past the window, is stillOutstanding with its age', () => {
  const prereg = { ...PREREG, experiment: { ...PREREG.experiment, authoredOn: '2026-11-28' } };
  const capture = { fetchedAt: '2026-11-28T00:00:00Z', pullRequests: [] };
  const result = analyse(capture, prereg);
  const lab = result.perLab['measured-blind'];
  assert.equal(lab.coverage, 0);
  assert.equal(lab.medianLatencyDays, null);
  assert.equal(lab.stillOutstanding.length, 7); // all 7 days in the window, each > 3 days before authoredOn
  assert.equal(lab.stillOutstanding[0].day, '20261101');
  assert.ok(lab.stillOutstanding[0].ageDaysAtCapture > 26);
  assert.equal(lab.stillOutstanding.every(d => d.open === false), true);
  assert.equal(lab.verdict, 'backlogged');
});

test('a day within the last 3 days of authoredOn is never reported stillOutstanding (it has not had its chance yet)', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-25T00:00:00Z', to: '2026-11-28T00:00:00Z' }, experiment: { ...PREREG.experiment, authoredOn: '2026-11-28' } };
  const capture = { fetchedAt: '2026-11-28T00:00:00Z', pullRequests: [] };
  const result = analyse(capture, prereg);
  assert.equal(result.perLab.rogue.stillOutstanding.length, 0);
});

test('an open PR naming an outstanding day is flagged open:true, not silently hidden', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-03T00:00:00Z' } };
  const capture = { fetchedAt: '2026-11-28T00:00:00Z', pullRequests: [pr('records/review-20261101-20261102-120000', { state: 'OPEN', mergedAt: null })] };
  const result = analyse(capture, prereg);
  const lab = result.perLab.review;
  assert.equal(lab.coverage, 0, 'an open PR has not landed; it does not count as covered');
  assert.equal(lab.stillOutstanding.length, 2);
  assert.equal(lab.stillOutstanding.every(d => d.open === true), true);
});

test('a day named by two different merged PRs is an anomaly, and its latency comes from the earliest merge, never averaged or silently overwritten', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' } };
  const rows = [
    pr('records/rogue-20261101-053337', { mergedAt: '2026-11-01T06:00:00Z', number: 1 }),
    pr('records/rogue-20261101-20261102-090000', { mergedAt: '2026-11-02T10:00:00Z', number: 2 }),
  ];
  const result = analyse({ fetchedAt: '2026-11-10T00:00:00Z', pullRequests: rows }, prereg);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].day, '20261101');
  assert.deepEqual(result.anomalies[0].prNumbers.sort(), [1, 2]);
  // PR 1 (earlier mergedAt) sets the latency, not PR 2, even though this capture also lists PR 1 first.
  assert.ok(result.perLab.rogue.medianLatencyDays < 1, result.perLab.rogue.medianLatencyDays);
});

test('erratum-02.json #8: reversing the same two rows must not change which merge sets the latency -- the earliest mergedAt wins, never whichever row the capture lists first', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' } };
  const earlier = pr('records/rogue-20261101-053337', { mergedAt: '2026-11-01T06:00:00Z', number: 1 });
  const later = pr('records/rogue-20261101-20261102-090000', { mergedAt: '2026-11-02T10:00:00Z', number: 2 });
  const forward = analyse({ fetchedAt: '2026-11-10T00:00:00Z', pullRequests: [earlier, later] }, prereg);
  const reversed = analyse({ fetchedAt: '2026-11-10T00:00:00Z', pullRequests: [later, earlier] }, prereg);
  assert.equal(forward.perLab.rogue.medianLatencyDays, reversed.perLab.rogue.medianLatencyDays);
  assert.deepEqual(forward.anomalies[0].prNumbers.sort(), reversed.anomalies[0].prNumbers.sort());
  assert.ok(forward.perLab.rogue.medianLatencyDays < 1, 'both orderings must use PR 1\'s near-zero latency, not PR 2\'s');
});

test('a closed-without-merging PR never counts a day as covered on its own', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' } };
  const capture = { fetchedAt: '2026-11-10T00:00:00Z', pullRequests: [pr('records/rogue-20261101-053337', { state: 'CLOSED', mergedAt: null })] };
  const result = analyse(capture, prereg);
  assert.equal(result.perLab.rogue.coverage, 0);
});

test('decision rule: verdict classification matches the frozen thresholds exactly at their boundaries, not merely somewhere inside them', () => {
  // erratum-02.json #9: a boundary test must sit exactly on the threshold, so flipping <= to < (or >= to >) in the
  // frozen script would flip the assertion's own expected verdict, not stay green either way. Each case below is
  // built directly (no generic helper) so the exact landed-day count and latency are visible and checkable.
  const run = (fromTo, rows) => analyse({ fetchedAt: '2026-11-20T00:00:00Z', pullRequests: rows }, { ...PREREG, window: fromTo }).perLab.rogue;

  // 5-day window, 4 of 5 land -- coverage exactly 0.8 -- each at exactly 2 days' latency -- median exactly 2.
  // Both of the frozen rule's own boundaries (<= 2, >= 0.8) are hit on the nose: still 'current'.
  const fourOfFive = ['20261101', '20261102', '20261103', '20261104'].map((d, i) =>
    pr(`records/rogue-${d}-05000${i}`, { mergedAt: new Date(Date.parse(`2026-11-0${3 + i}T00:00:00Z`)).toISOString() }));
  const atBoundary = run({ from: '2026-11-01T00:00:00Z', to: '2026-11-06T00:00:00Z' }, fourOfFive);
  assert.equal(atBoundary.medianLatencyDays, 2);
  assert.equal(atBoundary.coverage, 0.8);
  assert.equal(atBoundary.verdict, 'current');

  // Same shape, every landed day one tick past the median boundary (2.01 days, not 2): 'current' no longer holds
  // on that clause; max 2.01 does not exceed 7 and coverage is still 0.8, so this falls to 'mixed', not 'backlogged'.
  const justOver = ['20261101', '20261102', '20261103', '20261104'].map((d, i) =>
    pr(`records/rogue-${d}-05000${i}`, { mergedAt: new Date(Date.parse(`2026-11-0${3 + i}T00:00:00Z`) + 0.01 * 86400000).toISOString() }));
  assert.equal(run({ from: '2026-11-01T00:00:00Z', to: '2026-11-06T00:00:00Z' }, justOver).verdict, 'mixed');

  // 1-day window, the single landed day waits exactly 7 days: median = max = 7, which already fails current's own
  // <= 2 clause (so current cannot be the reason this isn't backlogged), and 7 does not exceed the frozen rule's
  // own strict > 7, and coverage 1.0 does not fall under < 0.5 either: 'mixed', not 'backlogged'.
  const atMaxBoundary = run({ from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' }, [pr('records/rogue-20261101-050000', { mergedAt: '2026-11-08T00:00:00Z' })]);
  assert.equal(atMaxBoundary.maxLatencyDays, 7);
  assert.equal(atMaxBoundary.verdict, 'mixed');

  // 2-day window, 1 of 2 lands (coverage exactly 0.5) with a 3-day latency (fails current's <= 2, and 3 does not
  // exceed 7): the frozen rule's own strict < 0.5 is not crossed either, so this is 'mixed', not 'backlogged'.
  const atCoverageBoundary = run({ from: '2026-11-01T00:00:00Z', to: '2026-11-03T00:00:00Z' }, [pr('records/rogue-20261101-050000', { mergedAt: '2026-11-04T00:00:00Z' })]);
  assert.equal(atCoverageBoundary.coverage, 0.5);
  assert.equal(atCoverageBoundary.verdict, 'mixed');
});

test('erratum-02.json #1: a lab meeting both current\'s and backlogged\'s conditions at once (rogue\'s own real shape) is reported current -- the frozen script checks current first and never reaches backlogged', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-10T00:00:00Z' } }; // 9 days
  const days = ['20261101', '20261102', '20261103', '20261104', '20261105', '20261106', '20261107', '20261108'];
  // 8 of 9 days land same-day (median stays tiny); the 9th lands 8 days late (max > 7) -- coverage is still 1.0
  // (>= 0.8) because that 9th day is itself in-window and landed, just slowly. Both 'current' and 'backlogged'
  // conditions hold simultaneously, exactly like this record's own rogue result.
  const rows = days.map(d => pr(`records/rogue-${d}-050000`, { mergedAt: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T06:00:00Z` }));
  rows.push(pr('records/rogue-20261109-050001', { mergedAt: '2026-11-17T00:00:00Z' }));
  const result = analyse({ fetchedAt: '2026-11-20T00:00:00Z', pullRequests: rows }, prereg).perLab.rogue;
  assert.equal(result.coverage, 1);
  assert.ok(result.medianLatencyDays <= 2, result.medianLatencyDays);
  assert.ok(result.maxLatencyDays > 7, result.maxLatencyDays);
  assert.equal(result.verdict, 'current', 'current must take precedence over the simultaneously-true backlogged condition');
});

test('erratum-02.json #7: checkPins actually hashes the live bytes, never just echoes the sidecar -- a preregistration edited without updating its own pin is caught, not silently recomputed', () => {
  const preregText = '{"a":1}';
  const pinnedPreregHash = sha256Hex(preregText);
  const analyseBytes = Buffer.from('export const x = 1;\n');
  const pinnedAnalyseHash = sha256Hex(analyseBytes);
  // Both pins match: no problems.
  assert.deepEqual(checkPins({ preregText, pinnedPreregHash, analyseBytes, pinnedAnalyseHash }), []);
  // preregistration.json edited (even by one byte) without updating preregistration.sha256: caught.
  const editedPrereg = checkPins({ preregText: '{"a":2}', pinnedPreregHash, analyseBytes, pinnedAnalyseHash });
  assert.equal(editedPrereg.length, 1);
  assert.match(editedPrereg[0], /preregistration\.json .* no longer matches its own pin/);
  // analyse.mjs edited without updating preregistration.json#/analysis/sha256: caught, independently of the above.
  const editedAnalyse = checkPins({ preregText, pinnedPreregHash, analyseBytes: Buffer.from('export const x = 2;\n'), pinnedAnalyseHash });
  assert.equal(editedAnalyse.length, 1);
  assert.match(editedAnalyse[0], /analyse\.mjs .* no longer matches preregistration\.json#\/analysis\/sha256/);
  // Both edited at once: both are reported, neither masks the other.
  assert.equal(checkPins({ preregText: '{"a":2}', pinnedPreregHash, analyseBytes: Buffer.from('export const x = 2;\n'), pinnedAnalyseHash }).length, 2);
});
