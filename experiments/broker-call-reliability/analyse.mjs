// EXP 024 analysis — frozen by sha256 in experiments/broker-call-reliability/preregistration.json before any
// counted row of this record's own window was read.
//
//   node experiments/broker-call-reliability/analyse.mjs           read capture/*.jsonl, write results.json
//   node experiments/broker-call-reliability/analyse.mjs --check   recompute and exit 1 unless it equals results.json
//
// Inputs: capture/*.jsonl, the same per-call rows experiments/telemetry-truth/analyse.mjs reads, copied unchanged
// from the same scheduled capture workflow's artifacts for this record's own window. Nothing else is read. No
// network, no clock: the window comes from the pre-registration.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, d = 4) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

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

/** An attempted row for this broker: inside [from, to), matches broker, and carries a boolean ok field
 * (excludes _header and _trailer summary rows, neither of which has one). */
export function attempted(row, broker, fromMs, toMs) {
  const t = Date.parse(row.ts);
  return row.broker === broker && typeof row.ok === 'boolean' && Number.isFinite(t) && t >= fromMs && t < toMs;
}

export function brokerVerdict(n, failureRate, rule) {
  if (n < rule.minCalls) return 'not enough calls';
  if (failureRate <= rule.reliableMaxFailureRate) return 'reliable';
  if (failureRate <= rule.marginalMaxFailureRate) return 'marginal';
  return 'unreliable';
}

export function analyse(rows, prereg) {
  const { from, to } = prereg.window;
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const rule = prereg.decision.rule;
  const perBroker = {};
  for (const broker of prereg.brokers) {
    const calls = rows.filter(r => attempted(r, broker, fromMs, toMs));
    const failures = calls.filter(r => r.ok !== true);
    const n = calls.length;
    const failureRate = n ? failures.length / n : null;
    perBroker[broker] = {
      callsAttempted: n,
      callsFailed: failures.length,
      failureRate: round(failureRate),
      failureDetail: failures.map(r => ({ ts: r.ts, httpStatus: r.httpStatus ?? null, error: r.error ?? r.errorMessage ?? null })),
      verdict: brokerVerdict(n, failureRate ?? 1, rule),
    };
  }
  return { experiment: prereg.experiment.id, window: { from, to }, preregistrationSha256: prereg.sha256 ?? null, perBroker };
}

function main(argv) {
  const prereg = JSON.parse(readFileSync(join(HERE, 'preregistration.json'), 'utf8'));
  prereg.sha256 = readFileSync(join(HERE, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const text = JSON.stringify(analyse(readCapture(join(HERE, 'capture')), prereg), null, 2) + '\n';
  const out = join(HERE, 'results.json');
  if (argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 024: results.json is not what the frozen analysis computes from the committed inputs'); return 1; }
    console.log('EXP 024: results.json recomputes exactly');
    return 0;
  }
  writeFileSync(out, text);
  console.log(`EXP 024: wrote ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
