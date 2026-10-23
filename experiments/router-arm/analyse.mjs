// EXP 018 analysis — frozen by sha256 in experiments/router-arm/preregistration.json before any counted cell.
//
//   node experiments/router-arm/analyse.mjs           read data/cells.json + data/billing.json, write results.json
//   node experiments/router-arm/analyse.mjs --check   recompute and exit 1 unless it equals the committed results.json
//
// Inputs (written by the private export script pinned in the pre-registration): one row per graded cell (arm,
// replicate, an opaque task index, target cases fixed / total, verdict, flags) and one row per arm x replicate key
// (billed $ = the key's usage after minus before). No task names, no paths, no transcript text. No network, no clock.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, d = 6) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// Two-sided 95% Student-t quantiles by degrees of freedom.
const T95 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 };

/** Mean and 95% t-interval of xs (null interval for fewer than 2 values). */
export function meanCI(xs) {
  const v = xs.filter(Number.isFinite);
  if (!v.length) return { n: 0, mean: null, ci: null };
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  if (v.length < 2) return { n: v.length, mean: round(m), ci: null };
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
  const h = T95[v.length - 1] * sd / Math.sqrt(v.length);
  return { n: v.length, mean: round(m), ci: [round(m - h), round(m + h)] };
}

/** A cell counts toward the headline when it was graded: not an error (budget cut, no model, sandbox escape). */
export const graded = c => c.verdict !== 'error' && !c.budgetCut && !c.sandboxEscape;

/** One arm x replicate: cases fixed of the graded target cases, the key's bill, and $ per case fixed. */
export function replicateSummary(cells, bill, tasks) {
  const g = cells.filter(graded);
  const fixed = g.reduce((a, c) => a + c.targetFixed, 0), target = g.reduce((a, c) => a + c.targetTotal, 0);
  const billed = bill && Number.isFinite(bill.billedUsd) ? bill.billedUsd : null;
  return {
    replicate: bill?.replicate ?? cells[0]?.replicate ?? null, cells: cells.length, graded: g.length,
    complete: g.length === tasks && new Set(g.map(c => c.task)).size === tasks,
    errors: cells.length - g.length, fixed, target, share: target ? round(fixed / target) : null,
    billedUsd: billed, usdPerCaseFixed: billed !== null && fixed > 0 ? round(billed / fixed) : null,
    models: Object.fromEntries([...new Set(cells.map(c => c.model))].sort().map(m => [m, cells.filter(c => c.model === m).length])),
  };
}

export function armSummary(arm, cells, billing, tasks, replicates) {
  const reps = [];
  for (let k = 1; k <= replicates; k++) {
    const cs = cells.filter(c => c.arm === arm && c.replicate === k);
    const bill = billing.find(b => b.arm === arm && b.replicate === k) || null;
    reps.push(replicateSummary(cs, bill, tasks));
  }
  const done = reps.filter(r => r.complete && r.usdPerCaseFixed !== null);
  const shares = done.map(r => r.share);
  const billed = reps.reduce((a, r) => a + (r.billedUsd ?? 0), 0);
  const fixedAll = done.reduce((a, r) => a + r.fixed, 0), billedDone = done.reduce((a, r) => a + r.billedUsd, 0);
  const oos = cells.filter(c => c.arm === arm && c.outOfSample && graded(c));
  const oosFixed = oos.reduce((a, c) => a + c.targetFixed, 0), oosTarget = oos.reduce((a, c) => a + c.targetTotal, 0);
  return {
    arm, replicates: reps, completeReplicates: done.length,
    usdPerCaseFixed: meanCI(done.map(r => r.usdPerCaseFixed)),
    share: meanCI(shares),
    shareRange: shares.length ? round(Math.max(...shares) - Math.min(...shares)) : null,
    pooledUsdPerCaseFixed: fixedAll > 0 ? round(billedDone / fixedAll) : null,
    billedUsd: round(billed),
    outOfSample: { cells: oos.length, fixed: oosFixed, target: oosTarget, share: oosTarget ? round(oosFixed / oosTarget) : null },
  };
}

/** The frozen rule: routing beats fixed X iff its mean $/case-fixed is lower AND its mean share is not lower than
 *  X's by more than the replicate spread (the larger of the two arms' per-replicate share ranges). */
export function decide(router, fixed, replicates) {
  if (router.completeReplicates < replicates || fixed.completeReplicates < replicates) {
    return { versus: fixed.arm, verdict: 'incomplete', why: `complete replicates: router ${router.completeReplicates}, ${fixed.arm} ${fixed.completeReplicates} (need ${replicates} each)` };
  }
  const spread = Math.max(router.shareRange, fixed.shareRange);
  const cheaper = router.usdPerCaseFixed.mean < fixed.usdPerCaseFixed.mean;
  const notWorse = router.share.mean >= fixed.share.mean - spread;
  return {
    versus: fixed.arm, verdict: cheaper && notWorse ? 'router beats' : 'router does not beat',
    cheaper, shareNotLowerBeyondSpread: notWorse, spread: round(spread),
    routerUsdPerCaseFixed: router.usdPerCaseFixed.mean, fixedUsdPerCaseFixed: fixed.usdPerCaseFixed.mean,
    routerShare: router.share.mean, fixedShare: fixed.share.mean,
  };
}

export function analyse(cellsDoc, billingDoc, prereg) {
  const tasks = prereg.corpus.tasks, replicates = prereg.design.replicates;
  const arms = Object.fromEntries(prereg.arms.map(a => [a.id, armSummary(a.id, cellsDoc.cells, billingDoc.billing, tasks, replicates)]));
  const totalBilled = Object.values(arms).reduce((a, s) => a + s.billedUsd, 0);
  return {
    schemaVersion: 1, kind: 'odin-rnd.results', experiment: prereg.experiment.id, slug: prereg.experiment.slug,
    corpus: { name: prereg.corpus.name, tasks, outOfSampleTasks: cellsDoc.outOfSampleTasks },
    arms,
    decision: prereg.arms.filter(a => a.id !== 'router').map(a => decide(arms.router, arms[a.id], replicates)),
    spend: { billedUsd: round(totalBilled), capUsd: prereg.spend.capUsd, withinCap: totalBilled <= prereg.spend.capUsd },
  };
}

const stable = v => JSON.stringify(v, null, 2) + '\n';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const prereg = JSON.parse(readFileSync(join(HERE, 'preregistration.json'), 'utf8'));
  const cellsDoc = JSON.parse(readFileSync(join(HERE, 'data/cells.json'), 'utf8'));
  const billingDoc = JSON.parse(readFileSync(join(HERE, 'data/billing.json'), 'utf8'));
  const out = stable(analyse(cellsDoc, billingDoc, prereg));
  const target = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== out) { console.error('EXP 018: results.json is not what the frozen analysis computes'); process.exit(1); }
    console.log('EXP 018: results.json recomputes exactly');
  } else { writeFileSync(target, out); console.log(`EXP 018: wrote ${target}`); }
}
