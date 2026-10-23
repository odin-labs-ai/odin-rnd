// EXP 015 analysis — frozen by sha256 in experiments/telemetry-truth/preregistration.json before any counted call.
//
//   node experiments/telemetry-truth/analyse.mjs           read capture/*.jsonl + fleet.json, write results.json
//   node experiments/telemetry-truth/analyse.mjs --check   recompute and exit 1 unless it equals the committed results.json
//
// Inputs (committed in the results PR, after the window closes and at least 24 h of settlement):
//   capture/*.jsonl   the probe rows the scheduled capture uploaded (one file per run; header lines are skipped)
//   fleet.json        { rowsInWindow, rowsZeroEstimate, rowsJoined, estimatedToBilledRatio, daysCovered }, computed
//                     privately by fleet-cost-reconcile.mjs over the same window (absolute dollars stay private)
// Nothing else is read. No network, no clock: the window comes from the pre-registration.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two-sided 95% Student t critical values, df 1..10.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
const round = (x, d = 6) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Mean of the daily means and its 95% t-interval across days (null interval with fewer than 2 days). */
export function acrossDays(dailyMeans) {
  const k = dailyMeans.length;
  if (!k) return { mean: null, ci95: null };
  const mean = dailyMeans.reduce((a, b) => a + b, 0) / k;
  if (k < 2) return { mean, ci95: null };
  const sd = Math.sqrt(dailyMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1));
  const h = T95[Math.min(k - 1, T95.length) - 1] * sd / Math.sqrt(k);
  return { mean, ci95: [mean - h, mean + h] };
}

/** A counted call: inside [from, to), ok, with both a broker-reported actual and a price-book estimate > 0. */
export function counted(row, fromMs, toMs) {
  const t = Date.parse(row.ts);
  return !row._header && row.ok === true && Number.isFinite(t) && t >= fromMs && t < toMs
    && typeof row.actualCostUsd === 'number' && typeof row.estimatedCostUsd === 'number' && row.estimatedCostUsd > 0;
}

export function brokerVerdict(n, med, ci, rule) {
  if (n < rule.minCalls) return 'not enough calls';
  const b = rule.holdsWithin;
  if (Math.abs(med) <= b && ci && ci[0] >= -b && ci[1] <= b) return 'estimate holds';
  if (ci && ci[1] - ci[0] <= rule.stableFactorMaxWidth) return 'estimate off by a stable factor';
  return 'estimate unreliable';
}

export function analyse(rows, fleet, prereg) {
  const { from, to } = prereg.window;
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const rule = prereg.decision.rule;
  const perBroker = {};
  const all = rows.filter(r => !r._header && Number.isFinite(Date.parse(r.ts)) && Date.parse(r.ts) >= fromMs && Date.parse(r.ts) < toMs);
  for (const broker of prereg.brokers) {
    const attempted = all.filter(r => r.broker === broker);
    const calls = attempted.filter(r => counted(r, fromMs, toMs));
    const rel = calls.map(r => r.actualCostUsd / r.estimatedCostUsd - 1);
    const byDay = {};
    calls.forEach((r, i) => { (byDay[r.ts.slice(0, 10)] ||= []).push(rel[i]); });
    const days = Object.keys(byDay).sort();
    const dailyMeans = days.map(d => byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length);
    const { mean, ci95 } = acrossDays(dailyMeans);
    const med = median(rel);
    const verdict = brokerVerdict(calls.length, med ?? 0, ci95, rule);
    const servedModels = [...new Set(calls.map(r => r.servedModel).filter(Boolean))].sort();
    perBroker[broker] = {
      callsAttempted: attempted.length,
      callsFailed: attempted.filter(r => r.ok !== true).length,
      n: calls.length,
      inBandCostShare: attempted.filter(r => r.ok === true).length ? round(attempted.filter(r => r.ok === true && r.usageCostPresent === true).length / attempted.filter(r => r.ok === true).length, 4) : null,
      medianRelativeGap: round(med),
      days: days.length,
      dailyMeanRelativeGap: Object.fromEntries(days.map((d, i) => [d, round(dailyMeans[i])])),
      meanOfDailyMeans: round(mean),
      ci95: ci95 ? ci95.map(x => round(x)) : null,
      factor: verdict === 'estimate off by a stable factor' ? round(1 + med, 4) : null,
      servedModels,
      verdict,
    };
  }
  const orRows = all.filter(r => r.broker === 'openrouter' && r.ok === true && typeof r.usageCostUsd === 'number' && typeof r.generationCostUsd === 'number');
  const agree = orRows.filter(r => Math.abs(r.usageCostUsd - r.generationCostUsd) <= Math.max(1e-9, 0.01 * r.generationCostUsd)).length;
  const f = rule.fleet;
  const zeroShare = fleet && fleet.rowsInWindow ? fleet.rowsZeroEstimate / fleet.rowsInWindow : null;
  const fleetVerdict = !fleet || typeof fleet.estimatedToBilledRatio !== 'number' || zeroShare === null ? 'not measurable'
    : (fleet.estimatedToBilledRatio >= f.ratioMin && fleet.estimatedToBilledRatio <= f.ratioMax && zeroShare <= f.maxZeroEstimateShare ? 'fleet estimates support a savings claim' : 'fleet estimates do not support a savings claim');
  return {
    experiment: prereg.experiment.id,
    window: { from, to },
    preregistrationSha256: prereg.sha256 ?? null,
    perBroker,
    openrouterInBandVsGenerationRecord: { n: orRows.length, agreeWithin1Pct: agree },
    fleet: fleet ? { rowsInWindow: fleet.rowsInWindow, zeroEstimateShare: round(zeroShare, 4), rowsJoined: fleet.rowsJoined, estimatedToBilledRatio: round(fleet.estimatedToBilledRatio, 4), daysCovered: fleet.daysCovered, verdict: fleetVerdict } : { verdict: fleetVerdict },
  };
}

export function readCapture(dir) {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a call */ }
    }
  }
  return rows;
}

function main() {
  const prereg = JSON.parse(readFileSync(join(HERE, 'preregistration.json'), 'utf8'));
  prereg.sha256 = readFileSync(join(HERE, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const fleetPath = join(HERE, 'fleet.json');
  const fleet = existsSync(fleetPath) ? JSON.parse(readFileSync(fleetPath, 'utf8')) : null;
  const text = JSON.stringify(analyse(readCapture(join(HERE, 'capture')), fleet, prereg), null, 2) + '\n';
  const out = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 015: results.json is not what the frozen analysis computes from the committed inputs'); return 1; }
    console.log('EXP 015: results.json recomputes exactly'); return 0;
  }
  writeFileSync(out, text);
  console.log(`EXP 015: wrote ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
