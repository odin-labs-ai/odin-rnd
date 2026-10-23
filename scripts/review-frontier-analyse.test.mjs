import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyse, frontier, median, readRuns, runSummary, wilson } from '../experiments/review-frontier/analyse.mjs';
import { collect } from '../experiments/review-frontier/runner/collect.mjs';

const prereg = JSON.parse(readFileSync('experiments/review-frontier/preregistration.json', 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('EXP 017 is frozen: the record matches its pin and pins its prompt, runner and analysis', () => {
  assert.equal(readFileSync('experiments/review-frontier/preregistration.sha256', 'utf8').trim().split(/\s+/)[0], sha('experiments/review-frontier/preregistration.json'));
  assert.equal(prereg.experiment.id, 'EXP 017');
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script));
  assert.equal(prereg.prompt.sha256, sha(prereg.prompt.file));
  for (const [file, want] of Object.entries(prereg.harness.runner)) assert.equal(sha(file), want, file);
  assert.equal(readFileSync(prereg.prompt.file, 'utf8'), readFileSync('experiments/self-verify/review-prompt.txt', 'utf8'), 'the same prompt as EXP 012');
  assert.deepEqual(prereg.seats.map(s => s.id), ['flash', 'gpt-oss', 'sonnet', 'opus']);
  assert.equal(prereg.design.runsPerSeat, 2);
});

test('Wilson 95% intervals and the median', () => {
  assert.deepEqual(wilson(16, 30), [0.361, 0.698]);
  assert.deepEqual(wilson(13, 30), [0.274, 0.608], 'the interval EXP 012 published for 13 of 30');
  assert.deepEqual(wilson(0, 30), [0, 0.114]);
  assert.deepEqual(wilson(30, 30), [0.886, 1]);
  assert.equal(wilson(0, 0), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('the pre-registered frontier: dominated only by a seat at least as good on both and better on one', () => {
  const s = (seat, caught, cost) => ({ seat, caught, costPerReviewUsd: cost });
  assert.deepEqual(frontier([s('cheap', 20, 0.001), s('mid', 20, 0.05), s('top', 30, 0.1)]), ['cheap', 'top']);
  assert.deepEqual(frontier([s('a', 20, 0.01), s('b', 20, 0.01)]), ['a', 'b'], 'exact ties dominate neither');
  assert.deepEqual(frontier([s('a', 10, 0.01), s('b', 30, 0.001)]), ['b']);
});

const fakeRun = (seat, run, flags, cost = 0.01, extra = {}) => ({
  seat, run, model: prereg.seats.find(x => x.id === seat).model, start: 's', end: 'e', complete: true,
  cases: Array.from({ length: 60 }, (_, i) => ({ n: i + 1, kind: i < 30 ? 'seeded' : 'clean', flagged: flags(i) })),
  reviews: Array.from({ length: 58 }, (_, i) => ({ n: i + 1, costUsd: cost, latencySec: 10 + i, attempts: 1, noVerdict: false,
    servedModel: prereg.seats.find(x => x.id === seat).model, upstream: 'Up' })),
  ...extra,
});

test('a run counts catches on seeded cases and false alarms on clean ones; cost is per review', () => {
  const r = runSummary(fakeRun('flash', 'a', i => i < 16 || i >= 40, 0.005));
  assert.equal(r.caught, 16);
  assert.equal(r.falseAlarms, 20);
  assert.equal(r.reviews, 58);
  assert.equal(r.costPerReviewUsd, 0.005);
  assert.equal(r.medianLatencySec, 38.5);
  assert.equal(r.servedModelMatches, 58);
});

test('a seat missing a complete run is not on the frontier and is not extrapolated', () => {
  const runs = [
    fakeRun('flash', 'a', i => i < 16), fakeRun('flash', 'b', i => i < 16),
    fakeRun('gpt-oss', 'a', i => i < 10, 0.001), fakeRun('gpt-oss', 'b', i => i < 10, 0.001),
    fakeRun('sonnet', 'a', i => i < 14, 0.05), fakeRun('sonnet', 'b', i => i < 14, 0.05),
    fakeRun('opus', 'a', i => i < 20, 0.09, { complete: false }),
  ];
  const res = analyse(runs, prereg);
  assert.deepEqual(res.decision.onFrontier, ['flash', 'gpt-oss']);
  assert.deepEqual(res.decision.offFrontier, ['sonnet']);
  assert.deepEqual(res.decision.notMeasured, ['opus: incomplete']);
  assert.equal(res.seats.find(s => s.seat === 'flash').caught, 32);
  assert.equal(res.seats.find(s => s.seat === 'opus').caught, undefined);
});

test('collect publishes counts only: no case id, bundle id, file name or finding text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exp017-'));
  try {
  mkdirSync(join(dir, 'reviews'));
  const manifest = { corpusVersion: 'cv-test', bundles: [{ id: 'b-secret1' }, { id: 'b-secret2' }],
    cases: [{ id: 'case-secret1', bundle: 'b-secret1', kind: 'seeded-defect' }, { id: 'case-secret2', bundle: 'b-secret2', kind: 'clean' }] };
  writeFileSync(join(dir, 'key-usage.json'), JSON.stringify({ seat: 'flash', run: 'a', model: 'm', start: 's', end: 'e', harnessExit: 2, keyBefore: { usage: 1 }, keyAfter: { usage: 1.5 } }));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ corpusVersion: 'cv-test', missed: [], falseAlarms: ['case-secret2'] }));
  writeFileSync(join(dir, 'verdicts.jsonl'), ['b-secret1', 'b-secret2'].map(b => JSON.stringify({ bundle: b, verdict: 'FIX-NEEDED',
    findings: [{ file: 'secret-file.sh', note: 'secret finding' }], latencySec: 5, attempts: 1, noVerdict: false, served: { model: 'm', provider: 'Up' } })).join('\n') + '\n');
  writeFileSync(join(dir, 'reviews', 'b-secret1.cost'), '0.002000\n');
  writeFileSync(join(dir, 'reviews', 'b-secret2.cost'), '0.003000\n');
  const out = collect(dir, manifest);
  const text = JSON.stringify(out);
  for (const secret of ['secret1', 'secret2', 'secret-file', 'secret finding']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(out.cases, [{ n: 1, kind: 'seeded', flagged: true }, { n: 2, kind: 'clean', flagged: true }]);
  assert.equal(out.reviews[1].costUsd, 0.003);
  assert.equal(out.complete, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('if results.json exists it is exactly what the frozen analysis computes', { skip: !existsSync('experiments/review-frontier/results.json') }, () => {
  assert.equal(readFileSync('experiments/review-frontier/results.json', 'utf8'), JSON.stringify(analyse(readRuns(), prereg), null, 1) + '\n');
});
