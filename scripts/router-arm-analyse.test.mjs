import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyse, armSummary, decide, graded, meanCI, replicateSummary } from '../experiments/router-arm/analyse.mjs';

const prereg = JSON.parse(readFileSync('experiments/router-arm/preregistration.json', 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('EXP 018 is frozen: the record matches its pin and pins the analysis it ships with', () => {
  assert.equal(readFileSync('experiments/router-arm/preregistration.sha256', 'utf8').trim().split(/\s+/)[0], sha('experiments/router-arm/preregistration.json'));
  assert.equal(prereg.experiment.id, 'EXP 018');
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script));
  assert.deepEqual(prereg.arms.map(a => a.id), ['router', 'opus', 'luna']);
  assert.equal(prereg.design.replicates, 3);
  assert.equal(prereg.corpus.tasks, 8);
  assert.equal(prereg.spend.capUsd, 275);
  assert.match(prereg.harness.commit, /^[0-9a-f]{40}$/);
  for (const h of Object.values(prereg.harness.sha256)) assert.match(h, /^[0-9a-f]{64}$/);
});

test('mean and 95% t-interval', () => {
  assert.deepEqual(meanCI([1, 2, 3]), { n: 3, mean: 2, ci: [-0.484338, 4.484338] }, 't(df=2) = 4.303, sd 1, n 3');
  assert.deepEqual(meanCI([5]), { n: 1, mean: 5, ci: null });
  assert.deepEqual(meanCI([]), { n: 0, mean: null, ci: null });
});

const cell = (arm, replicate, task, fixed, total, extra = {}) => ({ arm, replicate, task, outOfSample: task === 't8', model: 'm', verdict: 'fail', targetFixed: fixed, targetTotal: total, budgetCut: false, timeout: false, sandboxEscape: false, ...extra });
const tasks2 = 2;

test('a replicate: graded cells only, the key bill, $ per case fixed; an error cell makes it incomplete', () => {
  const r = replicateSummary([cell('a', 1, 't1', 3, 10), cell('a', 1, 't8', 2, 5)], { arm: 'a', replicate: 1, billedUsd: 2.5 }, tasks2);
  assert.equal(r.complete, true); assert.equal(r.fixed, 5); assert.equal(r.target, 15); assert.equal(r.usdPerCaseFixed, 0.5);
  const e = replicateSummary([cell('a', 1, 't1', 3, 10), cell('a', 1, 't8', 0, 5, { verdict: 'error', budgetCut: true })], { arm: 'a', replicate: 1, billedUsd: 2 }, tasks2);
  assert.equal(e.complete, false); assert.equal(e.errors, 1); assert.equal(e.target, 10);
  assert.equal(graded(cell('a', 1, 't1', 0, 1, { sandboxEscape: true })), false);
  assert.equal(replicateSummary([cell('a', 1, 't1', 0, 10), cell('a', 1, 't8', 0, 5)], { billedUsd: 1 }, tasks2).usdPerCaseFixed, null, 'no case fixed: no $/case');
});

function arm(id, perRep) { // perRep: [[fixed1, fixed2, billed], ...]
  const cells = [], billing = [];
  perRep.forEach(([f1, f2, b], i) => { cells.push(cell(id, i + 1, 't1', f1, 10), cell(id, i + 1, 't8', f2, 10)); billing.push({ arm: id, replicate: i + 1, billedUsd: b }); });
  return { cells, billing };
}

test('the frozen decision rule: cheaper AND share not lower by more than the larger replicate share range', () => {
  const r = arm('router', [[8, 6, 2], [7, 7, 2], [8, 7, 2]]);
  const o = arm('opus', [[8, 7, 6], [8, 7, 6], [8, 7, 6]]);
  const l = arm('luna', [[6, 4, 0.5], [5, 5, 0.5], [6, 5, 0.5]]);
  const cells = [...r.cells, ...o.cells, ...l.cells], billing = [...r.billing, ...o.billing, ...l.billing];
  const R = armSummary('router', cells, billing, tasks2, 3), O = armSummary('opus', cells, billing, tasks2, 3), L = armSummary('luna', cells, billing, tasks2, 3);
  assert.equal(R.completeReplicates, 3);
  assert.equal(R.shareRange, 0.05);
  const vsO = decide(R, O, 3);
  assert.equal(vsO.verdict, 'router beats', JSON.stringify(vsO));
  assert.equal(vsO.spread, 0.05);
  const vsL = decide(R, L, 3);
  assert.equal(vsL.verdict, 'router does not beat'); assert.equal(vsL.cheaper, false);
  const worse = arm('opus', [[10, 10, 6], [10, 10, 6], [10, 10, 6]]);
  const W = armSummary('opus', worse.cells, worse.billing, tasks2, 3);
  assert.equal(decide(R, W, 3).shareNotLowerBeyondSpread, false, 'cheaper but fixing too few cases is not a win');
  const short = armSummary('router', r.cells.filter(c => c.replicate !== 3), r.billing, tasks2, 3);
  assert.equal(decide(short, O, 3).verdict, 'incomplete');
});

test('the out-of-sample row pools only the out-of-sample tasks', () => {
  const r = arm('router', [[8, 6, 2], [7, 7, 2], [8, 7, 2]]);
  const R = armSummary('router', r.cells, r.billing, tasks2, 3);
  assert.deepEqual(R.outOfSample, { cells: 3, fixed: 20, target: 30, share: 0.666667 });
});

test('results.json, once committed, is exactly what the frozen analysis computes', () => {
  if (!existsSync('experiments/router-arm/results.json')) return;
  const out = analyse(JSON.parse(readFileSync('experiments/router-arm/data/cells.json', 'utf8')), JSON.parse(readFileSync('experiments/router-arm/data/billing.json', 'utf8')), prereg);
  assert.equal(readFileSync('experiments/router-arm/results.json', 'utf8'), JSON.stringify(out, null, 2) + '\n');
});
