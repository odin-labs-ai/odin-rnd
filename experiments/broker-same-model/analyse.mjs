// EXP 016 analysis — frozen by sha256 in experiments/broker-same-model/preregistration.json before any counted call.
//
//   node experiments/broker-same-model/analyse.mjs           read runs/*.jsonl, write results.json and spend-ledger.jsonl
//   node experiments/broker-same-model/analyse.mjs --check   recompute; exit 1 unless both files equal the committed ones
//
// Input: runs/*.jsonl, the rows run.mjs wrote for the counted run (header and trailer lines are skipped). A counted
// row has kind "counted" and a timestamp at or after the pre-registration's notBefore. Nothing else is read: no
// network and no clock.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, d = 6) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  // nearest-rank: the smallest value with at least q of the sample at or below it
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** Distribution-free 95% interval for the median: order statistics n/2 -+ 1.96 sqrt(n)/2 (normal approximation). */
export function medianCi95(xs) {
  const n = xs.length;
  if (n < 6) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = 1.96 * Math.sqrt(n) / 2;
  const lo = Math.max(1, Math.floor(n / 2 - h)), hi = Math.min(n, Math.ceil(n / 2 + h + 1));
  return [s[lo - 1], s[hi - 1]];
}

/** Wilson 95% interval for k of n. */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The list price of a call's own tokens, from the pre-registered price list. */
export function listUsd(row, price) {
  if (!Number.isFinite(row.promptTokens) || !Number.isFinite(row.completionTokens)) return null;
  return (row.promptTokens * price.inputPer1mUsd + row.completionTokens * price.outputPer1mUsd) / 1e6;
}

export function countedRows(rows, notBeforeMs) {
  return rows.filter(r => !r._header && !r._trailer && r.kind === 'counted' && Date.parse(r.ts) >= notBeforeMs);
}

/** spread = max / min - 1 over the brokers' values; null when any is missing. */
export function spread(values) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v <= 0)) return null;
  return Math.max(...values) / Math.min(...values) - 1;
}

export function analyse(rows, prereg) {
  const rule = prereg.decision.rule;
  const counted = countedRows(rows, Date.parse(prereg.notBefore));
  const perArm = {};
  for (const [arm, spec] of Object.entries(prereg.arms)) {
    const perBroker = {};
    for (const broker of prereg.brokers) {
      const att = counted.filter(r => r.arm === arm && r.broker === broker);
      const ok = att.filter(r => r.ok === true);
      const priced = ok.filter(r => typeof r.costUsd === 'number');
      const rate = priced.map(r => { const l = listUsd(r, spec.listPrice); return l ? r.costUsd / l : null; }).filter(Number.isFinite);
      const lat = ok.map(r => r.latencyMs).filter(Number.isFinite);
      const reps = [...new Set(att.map(r => r.rep))].sort((a, b) => a - b);
      // $ per 60 changes only over replicates in which every one of the 60 calls was priced: a replicate with a failed
      // call would otherwise sum lower and make a less reliable broker look cheaper.
      const complete = reps.filter(rep => priced.filter(r => r.rep === rep).length === prereg.changes.count);
      const billedPerRep = complete.map(rep => priced.filter(r => r.rep === rep).reduce((a, r) => a + r.costUsd, 0));
      const completeReps = complete.length;
      const statuses = {};
      for (const r of att) { const k = r.status == null ? 'transport' : String(r.status); statuses[k] = (statuses[k] || 0) + 1; }
      const errors = att.length - ok.length;
      const matched = ok.filter(r => r.servedMatches === true).length;
      perBroker[broker] = {
        attempted: att.length,
        ok: ok.length,
        errors,
        errorRate: att.length ? round(errors / att.length, 4) : null,
        errorRateCi95: att.length ? wilson(errors, att.length).map(x => round(x, 4)) : null,
        statuses,
        servedMatch: { matched, of: ok.length, rate: ok.length ? round(matched / ok.length, 4) : null },
        servedModels: [...new Set(ok.map(r => r.servedModel).filter(Boolean))].sort(),
        servedProviders: [...new Set(ok.map(r => r.servedProvider).filter(Boolean))].sort(),
        mismatches: [...new Set(ok.filter(r => r.servedMatches !== true).map(r => r.servedModel ?? '(none)'))].sort(),
        priced: priced.length,
        billedToListMedian: round(median(rate), 4),
        billedToListRange: rate.length ? [round(Math.min(...rate), 4), round(Math.max(...rate), 4)] : null,
        billedUsdTotal: round(priced.reduce((a, r) => a + r.costUsd, 0), 6),
        billedUsdPer60Changes: billedPerRep.length ? round(billedPerRep.reduce((a, b) => a + b, 0) / billedPerRep.length, 6) : null,
        completeReplicates: completeReps,
        meanPromptTokens: round(ok.reduce((a, r) => a + (r.promptTokens || 0), 0) / (ok.length || 1), 1),
        meanCompletionTokens: round(ok.reduce((a, r) => a + (r.completionTokens || 0), 0) / (ok.length || 1), 1),
        latencyMs: { n: lat.length, p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), p50Ci95: medianCi95(lat) },
      };
    }
    const enough = prereg.brokers.every(b => perBroker[b].priced >= rule.minPricedCallsPerBroker);
    const rateSpread = spread(prereg.brokers.map(b => perBroker[b].billedToListMedian));
    const billSpread = spread(prereg.brokers.map(b => perBroker[b].billedUsdPer60Changes));
    const verdict = s => (!enough ? 'not enough calls' : s === null ? 'not measurable' : s <= rule.equivalentWithin ? 'price-equivalent' : 'measured price spread');
    const cis = prereg.brokers.map(b => perBroker[b].latencyMs.p50Ci95);
    const separated = [];
    for (let i = 0; i < prereg.brokers.length; i++) for (let j = i + 1; j < prereg.brokers.length; j++) {
      const [a, b] = [cis[i], cis[j]];
      if (a && b && (a[1] < b[0] || b[1] < a[0])) separated.push(a[1] < b[0] ? [prereg.brokers[i], prereg.brokers[j]] : [prereg.brokers[j], prereg.brokers[i]]);
    }
    perArm[arm] = {
      family: spec.family,
      perBroker,
      rate: { spread: round(rateSpread, 4), verdict: verdict(rateSpread) },
      bill: { spread: round(billSpread, 4), verdict: verdict(billSpread) },
      latency: { fasterAtP50: separated.map(([f, s]) => `${f} < ${s}`), rule: 'a broker is faster only where the 95% intervals of the two medians do not overlap' },
      silentSubstitutions: prereg.brokers.reduce((a, b) => a + (perBroker[b].servedMatch.of - perBroker[b].servedMatch.matched), 0),
    };
  }
  const times = counted.map(r => r.ts).sort();
  return {
    experiment: prereg.experiment.id,
    preregistrationSha256: prereg.sha256 ?? null,
    window: { firstCall: times[0] ?? null, lastCall: times[times.length - 1] ?? null, calls: counted.length },
    expectedCalls: prereg.changes.count * prereg.replicates * prereg.brokers.length * Object.keys(prereg.arms).length,
    perArm,
  };
}

/** One spend line per counted call, in the lab's spend-ledger format. A call without a reported cost is listed with
 *  costUsd null and its reason; it is never priced at zero. */
export function spendLedger(rows, prereg) {
  return countedRows(rows, Date.parse(prereg.notBefore)).map(r => JSON.stringify({
    ts: r.ts, kind: 'counted', id: `${r.change}:${r.arm}:${r.broker}:${r.rep}`, broker: r.broker, model: r.requestedModel,
    costUsd: typeof r.costUsd === 'number' ? r.costUsd : null, costBasis: 'broker-reported usage.cost', ...(typeof r.costUsd === 'number' ? {} : { costMissing: r.costWhy ?? 'unknown' }),
  })).join('\n') + '\n';
}

export function readRuns(dir) {
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
  const rows = readRuns(join(HERE, 'runs'));
  const outputs = {
    'results.json': JSON.stringify(analyse(rows, prereg), null, 2) + '\n',
    'spend-ledger.jsonl': spendLedger(rows, prereg),
  };
  if (process.argv.includes('--check')) {
    for (const [name, text] of Object.entries(outputs)) {
      const p = join(HERE, name);
      if (!existsSync(p) || readFileSync(p, 'utf8') !== text) { console.error(`EXP 016: ${name} is not what the frozen analysis computes from runs/`); return 1; }
    }
    console.log('EXP 016: results.json and spend-ledger.jsonl recompute exactly'); return 0;
  }
  for (const [name, text] of Object.entries(outputs)) writeFileSync(join(HERE, name), text);
  console.log('EXP 016: wrote results.json and spend-ledger.jsonl');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
