import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyse, freshRouter } from '../experiments/router-arm-fresh/analyse.mjs';

const prereg = JSON.parse(readFileSync('experiments/router-arm-fresh/preregistration.json', 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const reference = JSON.parse(readFileSync(prereg.comparison.file, 'utf8'));

test('EXP 019 is frozen: pinned record, analysis, EXP 018 reference and EXP 018 analysis', () => {
  assert.equal(readFileSync('experiments/router-arm-fresh/preregistration.sha256', 'utf8').trim().split(/\s+/)[0], sha('experiments/router-arm-fresh/preregistration.json'));
  assert.equal(prereg.experiment.id, 'EXP 019');
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script));
  assert.equal(prereg.comparison.sha256, sha(prereg.comparison.file), 'EXP 018 results as published');
  assert.equal(prereg.metric.parentAnalysis.sha256, sha('experiments/router-arm/analyse.mjs'), 'EXP 018 analysis it imports');
  assert.deepEqual(prereg.design.lanes, [4, 5, 6]);
  assert.equal(prereg.spend.ceilingUsd, 78);
  assert.ok(prereg.spend.priorReplayUsd + prereg.spend.ceilingUsd <= prereg.spend.cumulativeCapUsd);
  const parent = JSON.parse(readFileSync('experiments/router-arm/preregistration.json', 'utf8'));
  assert.deepEqual(prereg.harness.sha256, parent.harness.sha256, 'the same harness as EXP 018');
  assert.equal(prereg.harness.commit, parent.harness.commit);
});

const cell = (replicate, task, fixed, total, extra = {}) => ({ arm: 'router', replicate, task, outOfSample: task === 't8', model: 'm', verdict: 'fail', targetFixed: fixed, targetTotal: total, budgetCut: false, timeout: false, sandboxEscape: false, ...extra });
const tasks = n => Array.from({ length: n }, (_, i) => `t${i + 1}`);

test('lanes 4..6 become replicates 1..3; any other lane or arm is refused', () => {
  const { cells, billing } = freshRouter({ cells: [cell(4, 't1', 1, 2), cell(6, 't1', 1, 2)] }, { billing: [{ arm: 'router', replicate: 1, billedUsd: null }, { arm: 'router', replicate: 5, billedUsd: 2 }] }, [4, 5, 6]);
  assert.deepEqual(cells.map(c => c.replicate), [1, 3]);
  assert.deepEqual(billing, [{ arm: 'router', replicate: 2, billedUsd: 2 }], 'the empty export rows for lanes 1..3 are dropped');
  assert.throws(() => freshRouter({ cells: [] }, { billing: [{ arm: 'router', replicate: 2, billedUsd: 5 }] }, [4, 5, 6]), /carries a bill/);
  assert.throws(() => freshRouter({ cells: [] }, { billing: [{ arm: 'opus', replicate: 4, billedUsd: 5 }] }, [4, 5, 6]), /billing arm/);
  assert.throws(() => freshRouter({ cells: [cell(2, 't1', 1, 2)] }, { billing: [] }, [4, 5, 6]), /unexpected cell/);
  assert.throws(() => freshRouter({ cells: [{ ...cell(4, 't1', 1, 2), arm: 'opus' }] }, { billing: [] }, [4, 5, 6]), /unexpected cell/);
});

test('three complete fresh replicates are judged against EXP 018 fixed arms by EXP 018 rule', () => {
  const cells = [], billing = [];
  [[4, 0.64, 30], [5, 0.65, 31], [6, 0.645, 32]].forEach(([lane, share, b]) => {
    for (const t of tasks(8)) cells.push(cell(lane, t, Math.round(share * 100), 100));
    billing.push({ arm: 'router', replicate: lane, billedUsd: b });
  });
  const out = analyse({ cells, outOfSampleTasks: ['t7', 't8'] }, { billing }, reference, prereg);
  assert.equal(out.router.completeReplicates, 3);
  assert.deepEqual(out.decision.map(d => d.versus), ['opus', 'luna']);
  assert.equal(out.decision[0].verdict, 'router beats', JSON.stringify(out.decision[0]));
  assert.equal(out.decision[1].verdict, 'router does not beat');
  assert.equal(out.spend.billedUsd, 93);
  assert.equal(out.spend.cumulativeReplayUsd, 289.661243);
  assert.equal(out.spend.withinCeiling, false, 'a fixture over the $78 ceiling is flagged');
  assert.equal(out.reference.arms.opus.completeReplicates, 3);
});

test('a cut cell leaves the comparison incomplete', () => {
  const cells = [], billing = [];
  for (const lane of [4, 5, 6]) { for (const t of tasks(8)) cells.push(cell(lane, t, 60, 100, lane === 6 && t === 't8' ? { verdict: 'error', budgetCut: true, targetFixed: 0 } : {})); billing.push({ arm: 'router', replicate: lane, billedUsd: 20 }); }
  const out = analyse({ cells, outOfSampleTasks: [] }, { billing }, reference, prereg);
  assert.deepEqual(out.decision.map(d => d.verdict), ['incomplete', 'incomplete']);
});

test('results.json, once committed, is exactly what the frozen analysis computes', () => {
  if (!existsSync('experiments/router-arm-fresh/results.json')) return;
  const out = analyse(JSON.parse(readFileSync('experiments/router-arm-fresh/data/cells.json', 'utf8')), JSON.parse(readFileSync('experiments/router-arm-fresh/data/billing.json', 'utf8')), reference, prereg);
  assert.equal(readFileSync('experiments/router-arm-fresh/results.json', 'utf8'), JSON.stringify(out, null, 2) + '\n');
});
