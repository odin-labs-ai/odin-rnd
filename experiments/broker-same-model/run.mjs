#!/usr/bin/env node
// EXP 016 runner: the same request, for the same model, through three brokers.
//
// For each replicate, change and arm, the three brokers are called at the same moment (in parallel), so time-of-day
// effects fall on every broker alike; the arm order alternates per change. Every call is one HTTPS request with no
// retry: a failure is a measured outcome. Each row records the HTTP status, the wall-clock latency until the full
// response body has arrived, the model and provider the broker says served it, the tokens, and the cost the broker
// reports in the response (usage.cost). Keys come from the environment (BROKER_OPENROUTER_KEY, BROKER_EUROUTER_KEY,
// BROKER_REQUESTY_KEY) and are never written anywhere. The model's answer is recorded only as its length, its sha256
// and its first-line verdict.
//
// Spend stop: before every slot the runner stops if the money already reported plus the slot's worst case would pass
// --cap-usd. A call that reports no cost counts at its worst case, never at zero. The hard ceilings are the keys' own
// broker-side limits.
//
// usage: node experiments/broker-same-model/run.mjs --kind calibration|counted --out <rows.jsonl>
//          [--changes all|c001,c002] [--replicates 2] [--arms sonnet,mini] [--brokers openrouter,eurouter,requesty]
//          [--cap-usd 10] [--timeout-ms 120000]
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS, BROKERS, family, reportedCostUsd, requestBody, servedMatches } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, '../jev-gate/corpus');
// Worst case per call for the spend stop: a 4,000-token prompt (the largest change is about 2 KB) and the full
// 400-token answer at 1.2 x list price (EUrouter lists 10% above).
export const WORST_CASE_USD = { sonnet: (4000 * 2.0 + 400 * 10.0) * 1.2 / 1e6, mini: (4000 * 0.15 + 400 * 0.6) * 1.2 / 1e6 };

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
};
const sha256 = text => createHash('sha256').update(text).digest('hex');

export function verdictOf(text) {
  const m = /VERDICT:\s*(SHIP|FIX-NEEDED)/i.exec(text || '');
  return m ? m[1].toUpperCase() : null;
}

async function call(broker, arm, change, patch, key, timeoutMs) {
  const body = requestBody(arm, broker, patch);
  const row = { broker, arm, change, requestedModel: body.model };
  const t0 = performance.now();
  try {
    const res = await fetch(`${BROKERS[broker].baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    row.latencyMs = Math.round(performance.now() - t0);
    row.status = res.status;
    let data = null;
    try { data = JSON.parse(text); } catch { /* recorded below */ }
    const content = data?.choices?.[0]?.message?.content;
    row.ok = res.status === 200 && typeof content === 'string' && content.length > 0;
    if (!row.ok) row.error = (data?.error?.message || text || '').replace(/\s+/g, ' ').slice(0, 200);
    row.servedModel = typeof data?.model === 'string' ? data.model : null;
    row.servedProvider = typeof data?.provider === 'string' ? data.provider : null;
    row.servedFamily = family(row.servedModel);
    row.servedMatches = servedMatches(arm, row.servedModel);
    row.promptTokens = data?.usage?.prompt_tokens ?? null;
    row.completionTokens = data?.usage?.completion_tokens ?? null;
    const cost = reportedCostUsd(broker, data?.usage);
    row.costUsd = cost.usd;
    row.costWhy = cost.why;
    row.finishReason = data?.choices?.[0]?.finish_reason ?? null;
    row.answerChars = typeof content === 'string' ? content.length : 0;
    row.answerSha256 = typeof content === 'string' ? sha256(content) : null;
    row.verdict = verdictOf(content);
  } catch (e) {
    row.latencyMs = Math.round(performance.now() - t0);
    row.status = null;
    row.ok = false;
    row.error = `${e.name}: ${e.message}`.slice(0, 200);
    row.costUsd = null;
    row.costWhy = 'transport';
  }
  return row;
}

export function changeIds(spec) {
  const all = readdirSync(CORPUS).filter(f => /^c\d{3}\.patch$/.test(f)).map(f => f.slice(0, 4)).sort();
  if (!spec || spec === 'all') return all;
  const want = spec.split(',');
  for (const id of want) if (!all.includes(id)) throw new Error(`unknown change ${id}`);
  return want;
}

async function main() {
  const kind = arg('kind');
  const out = arg('out');
  if (!['calibration', 'counted'].includes(kind) || !out) {
    console.error('usage: run.mjs --kind calibration|counted --out <rows.jsonl> [options]');
    process.exit(1);
  }
  if (existsSync(out)) { console.error(`refusing to append to an existing file: ${out}`); process.exit(1); }
  const changes = changeIds(arg('changes', 'all'));
  const replicates = Number(arg('replicates', '2'));
  const arms = arg('arms', 'sonnet,mini').split(',');
  const brokers = arg('brokers', 'openrouter,eurouter,requesty').split(',');
  const cap = Number(arg('cap-usd', '10'));
  const timeoutMs = Number(arg('timeout-ms', '120000'));
  for (const a of arms) if (!ARMS[a]) throw new Error(`unknown arm ${a}`);
  const keys = {};
  for (const b of brokers) {
    if (!BROKERS[b]) throw new Error(`unknown broker ${b}`);
    keys[b] = process.env[BROKERS[b].keyEnv];
    if (!keys[b]) { console.error(`${BROKERS[b].keyEnv} is not set`); process.exit(1); }
  }
  const startedAt = new Date().toISOString();
  appendFileSync(out, JSON.stringify({ _header: true, experiment: 'EXP 016', kind, startedAt,
    command: `node experiments/broker-same-model/run.mjs ${process.argv.slice(2).join(' ')}`,
    changes: changes.length, replicates, arms, brokers, capUsd: cap }) + '\n');
  let spent = 0, slot = 0, stopped = null;
  outer:
  for (let rep = 1; rep <= replicates; rep++) {
    for (const [i, change] of changes.entries()) {
      const patch = readFileSync(join(CORPUS, `${change}.patch`), 'utf8');
      const order = i % 2 === 0 ? arms : [...arms].reverse();
      for (const arm of order) {
        const worst = WORST_CASE_USD[arm] * brokers.length;
        if (spent + worst > cap) { stopped = `cap: spent ${spent.toFixed(6)} + slot worst case ${worst.toFixed(6)} > ${cap}`; break outer; }
        slot++;
        const ts = new Date().toISOString();
        const rows = await Promise.all(brokers.map(b => call(b, arm, change, patch, keys[b], timeoutMs)));
        for (const r of rows) {
          spent += r.costUsd ?? WORST_CASE_USD[arm];
          appendFileSync(out, JSON.stringify({ ts, kind, rep, slot, ...r }) + '\n');
        }
        process.stdout.write(`\rslot ${slot} rep ${rep} ${change} ${arm} spent $${spent.toFixed(4)}   `);
      }
    }
  }
  appendFileSync(out, JSON.stringify({ _trailer: true, endedAt: new Date().toISOString(), slots: slot,
    spentUsdCounted: Number(spent.toFixed(8)), stopped }) + '\n');
  process.stdout.write(`\ndone: ${slot} slots, counted spend $${spent.toFixed(6)}${stopped ? `, STOPPED ${stopped}` : ''}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
