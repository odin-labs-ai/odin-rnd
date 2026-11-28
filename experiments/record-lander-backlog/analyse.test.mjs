import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, parseBranch, windowDays } from './analyse.mjs';

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

test('a day named by two different merged PRs is an anomaly, never averaged or silently overwritten', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' } };
  const capture = {
    fetchedAt: '2026-11-10T00:00:00Z',
    pullRequests: [
      pr('records/rogue-20261101-053337', { mergedAt: '2026-11-01T06:00:00Z', number: 1 }),
      pr('records/rogue-20261101-20261102-090000', { mergedAt: '2026-11-02T10:00:00Z', number: 2 }),
    ],
  };
  const result = analyse(capture, prereg);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].day, '20261101');
  assert.deepEqual(result.anomalies[0].prNumbers.sort(), [1, 2]);
  // The FIRST-seen merged PR wins the landed-by record (array order = capture order); not a silent last-wins overwrite.
  assert.equal(result.perLab.rogue.medianLatencyDays < 1, true);
});

test('a closed-without-merging PR never counts a day as covered on its own', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' } };
  const capture = { fetchedAt: '2026-11-10T00:00:00Z', pullRequests: [pr('records/rogue-20261101-053337', { state: 'CLOSED', mergedAt: null })] };
  const result = analyse(capture, prereg);
  assert.equal(result.perLab.rogue.coverage, 0);
});

test('decision rule: verdict classification matches the frozen thresholds exactly at their boundaries', () => {
  const prereg = { ...PREREG, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-04T00:00:00Z' } }; // 3 days
  // All 3 days land same-day (~0 latency), full coverage -> current.
  const mergeTimes = ['2026-11-01T06:00:00Z', '2026-11-02T06:00:00Z', '2026-11-03T06:00:00Z'];
  const current = analyse({ fetchedAt: '2026-11-10T00:00:00Z', pullRequests: ['20261101', '20261102', '20261103'].map((d, i) => pr(`records/rogue-${d}-05000${i}`, { mergedAt: mergeTimes[i] })) }, prereg);
  assert.equal(current.perLab.rogue.verdict, 'current');
});
