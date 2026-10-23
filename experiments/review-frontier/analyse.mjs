// EXP 017 analysis — frozen by sha256 in experiments/review-frontier/preregistration.json before any counted call.
//
//   node experiments/review-frontier/analyse.mjs           read runs/*.json, write results.json
//   node experiments/review-frontier/analyse.mjs --check   recompute and exit 1 unless it equals the committed results.json
//
// Input: runs/<seat>-<run>.json, written by runner/collect.mjs from each counted run (counts, costs and latencies
// only; see that file). Nothing else is read. No network, no clock.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, d = 6) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Wilson 95% score interval for k of n, as shares. */
export function wilson(k, n, z = 1.959964) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [round(Math.max(0, c - h), 3), round(Math.min(1, c + h), 3)];
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One counted run: caught / false alarms of the 30 + 30 cases, billed $ and latency over the 58 reviews. */
export function runSummary(run) {
  const seeded = run.cases.filter(c => c.kind === 'seeded'), clean = run.cases.filter(c => c.kind === 'clean');
  const done = run.reviews.filter(r => r.costUsd !== null);
  const cost = done.reduce((a, r) => a + r.costUsd, 0);
  const served = done.filter(r => r.servedModel !== null);
  const out = {
    seat: run.seat, run: run.run, model: run.model, start: run.start, end: run.end, complete: run.complete === true,
    reviews: done.length, costUsd: round(cost), costPerReviewUsd: done.length ? round(cost / done.length) : null,
    medianLatencySec: median(done.map(r => r.latencySec).filter(Number.isFinite)),
    noVerdict: done.filter(r => r.noVerdict).length,
    servedModelMatches: served.filter(r => r.servedModel === run.model).length, servedModelReported: served.length,
    upstreams: Object.fromEntries([...new Set(served.map(r => r.upstream))].sort().map(u => [u, served.filter(r => r.upstream === u).length])),
  };
  if (out.complete) {
    const caught = seeded.filter(c => c.flagged).length, fa = clean.filter(c => c.flagged).length;
    Object.assign(out, { seeded: seeded.length, clean: clean.length, caught, caughtCI: wilson(caught, seeded.length),
      falseAlarms: fa, faCI: wilson(fa, clean.length) });
  }
  return out;
}

/** A seat is on the frontier if no other seat has both >= its catches and <= its $ per review, and is better in one. */
export function frontier(seats, key = ['caught', 'costPerReviewUsd']) {
  const [k, c] = key;
  return seats.filter(a => !seats.some(b => b !== a && b[k] >= a[k] && b[c] <= a[c] && (b[k] > a[k] || b[c] < a[c])))
    .map(s => s.seat);
}

export function analyse(runs, prereg) {
  const perRun = runs.map(runSummary).sort((a, b) => (a.seat + a.run).localeCompare(b.seat + b.run));
  const seats = prereg.seats.map(s => {
    const mine = perRun.filter(r => r.seat === s.id);
    const ok = mine.filter(r => r.complete);
    const base = { seat: s.id, model: s.model, runsComplete: ok.length, runsPlanned: prereg.design.runsPerSeat };
    if (ok.length < prereg.design.runsPerSeat) return { ...base, status: mine.length ? 'incomplete' : 'not run' };
    const n = ok.length, seeded = ok[0].seeded, clean = ok[0].clean;
    const caught = ok.reduce((a, r) => a + r.caught, 0), fa = ok.reduce((a, r) => a + r.falseAlarms, 0);
    const reviews = ok.reduce((a, r) => a + r.reviews, 0), cost = ok.reduce((a, r) => a + r.costUsd, 0);
    return { ...base, status: 'complete',
      caught, caughtOf: n * seeded, caughtCI: wilson(caught, n * seeded), caughtPerRun: ok.map(r => r.caught),
      falseAlarms: fa, falseAlarmsOf: n * clean, faCI: wilson(fa, n * clean), falseAlarmsPerRun: ok.map(r => r.falseAlarms),
      costUsd: round(cost), costPerReviewUsd: round(cost / reviews),
      medianLatencySec: median(ok.map(r => r.medianLatencySec).filter(Number.isFinite)),
      noVerdict: ok.reduce((a, r) => a + r.noVerdict, 0),
      servedModelMatches: ok.reduce((a, r) => a + r.servedModelMatches, 0), servedModelReported: ok.reduce((a, r) => a + r.servedModelReported, 0) };
  });
  const complete = seats.filter(s => s.status === 'complete');
  const onFrontier = frontier(complete);
  const fa3 = complete.filter(a => !complete.some(b => b !== a && b.caught >= a.caught && b.falseAlarms <= a.falseAlarms
    && b.costPerReviewUsd <= a.costPerReviewUsd && (b.caught > a.caught || b.falseAlarms < a.falseAlarms || b.costPerReviewUsd < a.costPerReviewUsd))).map(s => s.seat);
  const totalCost = perRun.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  return {
    schemaVersion: 1, kind: 'odin-rnd.results', experiment: prereg.experiment.id, slug: prereg.experiment.slug,
    preregistration: 'experiments/review-frontier/preregistration.json',
    decision: { onFrontier, offFrontier: complete.map(s => s.seat).filter(s => !onFrontier.includes(s)),
      notMeasured: seats.filter(s => s.status !== 'complete').map(s => `${s.seat}: ${s.status}`),
      rule: prereg.decision.frontier },
    secondary: { frontierWithFalseAlarms: fa3 },
    seats, runs: perRun, spend: { brokerReportedUsd: round(totalCost), reviews: perRun.reduce((a, r) => a + r.reviews, 0) },
  };
}

export function readRuns(dir = join(HERE, 'runs')) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const prereg = JSON.parse(readFileSync(join(HERE, 'preregistration.json'), 'utf8'));
  const text = JSON.stringify(analyse(readRuns(), prereg), null, 1) + '\n';
  const out = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 017: results.json is not what the frozen analysis computes'); process.exit(1); }
    console.log('EXP 017: results.json matches the frozen analysis');
  } else { writeFileSync(out, text); console.log(`EXP 017: wrote ${out}`); }
}
