// EXP 008 (latent-handoff) arms, bundle 3 WO-04: the frozen arm list and the run driver.
//
// The driver runs runner.py (which reads no labels), then turns every result row into an ffr.v1 handoff event
// (ffr8.mjs). Scoring is a separate step (score.mjs), the only one that reads labels.
//
//   node experiments/latent-handoff/arms.mjs --pair D1 --stratum S --items c001,c002 --run-id practice-d1-s-01 [--arms A0,C1]
//   writes <cache>/runs/<run-id>.rows.jsonl and <run-id>.ffr.jsonl
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './ffr8.mjs';
import { GATE, judge, waitUntilClear } from './mem-gate.mjs';
import { armOrder, PROTOCOL } from './timing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = process.env.LH_MODEL_CACHE || join(homedir(), '.cache', 'odin-rnd', 'latent-handoff');
const PYTHON = process.env.LH_PYTHON || join(homedir(), 'ai-env', 'bin', 'python');

export const ARMS = Object.freeze({
  A0: { kind: 'text', what: 'text re-prefill of the whole prompt' },
  A1: { kind: 'text', what: 'sender summary (<= 256 tokens, frozen prompt, lint-checked) as the context' },
  C1: { kind: 'kv', what: "the receiver's own prefix cache through the transfer plumbing; must match A0 at KL < 1e-3" },
  C2: { kind: 'kv', what: "a deranged cache: the receiver's prefix cache of another item (seed 8008)" },
  C3: { kind: 'text', what: 'no context: the question alone' },
  A2a: { kind: 'kv', what: 'our extension of arXiv 2608.03893 (per-layer ridge, RoPE-stripped keys, character-boundary alignment)' },
  A2b: { kind: 'kv', what: 'our reimplementation of HeteroFold (arXiv 2609.32259): layers -4/0/+4 + Procrustes recolor, closed form' },
});
export const STAGE1_ARMS = Object.freeze(['A0', 'A1', 'C1', 'C2', 'C3', 'A2a', 'A2b']);

/** The rows of the latest timing attempt per (item, arm): a re-queued item's earlier attempts are superseded. */
export function latestRows(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = `${r.pair}|${r.stratum}|${r.itemId}|${r.arm}`;
    if (!best.has(k) || (r.attempt ?? 0) > (best.get(k).attempt ?? 0)) best.set(k, r);
  }
  return [...best.values()];
}

/** One runner row -> the ffr8 row shape. An abstention carries null usage with its reason. */
export function ffrRow(r, models) {
  const pair = models.pairs[r.pair];
  const repo = key => models.models[key].repo;
  const usage = r.abstain
    ? { prefillTok: null, prefillMs: null, ttftMs: null, peakMemGB: null }
    : { prefillTok: r.prefillTok, prefillMs: Number(r.prefillMs.toFixed(3)), ttftMs: Number(r.ttftMs.toFixed(3)), peakMemGB: Number(r.peakMemGB.toFixed(3)) };
  const reason = r.abstain ? (r.reason === 'oom' ? 'oom-abstention' : 'abstention') : null;
  return {
    runId: r.runId, itemId: r.itemId, stratum: r.stratum, arm: r.arm, ts: r.ts,
    fromModel: repo(pair.sender), toModel: repo(pair.receiver), usage,
    nullReasons: reason ? { prefillTok: reason, prefillMs: reason, ttftMs: reason, peakMemGB: reason } : {},
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = f => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const runId = get('--run-id');
  if (!runId || !get('--pair') || !get('--stratum') || !get('--items')) {
    process.stderr.write('usage: arms.mjs --pair P --stratum S|M|L --items a,b --run-id ID [--arms A0,...] [--peak-gb N]\n');
    process.exit(2);
  }
  const arms = (get('--arms') ?? STAGE1_ARMS.join(',')).split(',');
  for (const a of arms) if (!ARMS[a]) { process.stderr.write(`unknown arm ${a}\n`); process.exit(2); }
  const dir = join(CACHE_ROOT, 'runs');
  mkdirSync(dir, { recursive: true });
  const rowsPath = join(dir, `${runId}.rows.jsonl`);
  const models = JSON.parse(readFileSync(join(HERE, 'models.json'), 'utf8'));
  const pairDef = models.pairs[get('--pair')];
  // the gate's pair footprint: max(weights, measured peak in footprints.json), as runner.pair_footprint
  const weightsGB = ['sender', 'receiver'].reduce((s, k) => s + models.models[pairDef[k]].convert.weightsGB, 0);
  const fpPath = join(HERE, 'footprints.json');
  const fp = existsSync(fpPath) ? JSON.parse(readFileSync(fpPath, 'utf8')).pairs[get('--pair')] : undefined;
  const footprintGB = Math.max(weightsGB, fp?.peakGB ?? 0);
  const gateBounds = { ...GATE, maxFootprintGB: fp?.boundGB ?? GATE.maxFootprintGB };
  // Timing protocol (timing.mjs): a seeded arm order per item, PROTOCOL warm-ups + reps, gate readings before and
  // after every item. The runner pauses (exit 75, rows kept) when the gate fails between items; this driver holds no
  // model, waits on the strict gate, and resumes it. An item whose gate readings drifted is re-queued, at most
  // PROTOCOL.maxRequeues times, then its rows are marked timing-unstable.
  const readout = JSON.parse(readFileSync(join(HERE, 'readout.json'), 'utf8'));
  const items = get('--items').split(',');
  const ordersPath = join(dir, `${runId}.orders.json`);
  writeFileSync(ordersPath, JSON.stringify(Object.fromEntries(items.map(id => [id, armOrder(arms, readout.armOrderSeed, id)]))));
  const peakGB = Number(get('--peak-gb') ?? 0);
  // --footprint-only: a MEMORY measurement, not a timing one. The CPU-load criterion (which protects timings) is
  // skipped and recorded on every row; the memory criteria stay strict; one untimed call per arm.
  const footprintOnly = args.includes('--footprint-only');
  const protocol = footprintOnly ? { warmups: 0, reps: 1, maxRequeues: 0 } : PROTOCOL;
  const runAttempt = (attempt, ids) => {
    for (;;) {
      const r = spawnSync(PYTHON, [join(HERE, 'runner.py'), '--pair', get('--pair'), '--stratum', get('--stratum'), '--items', ids.join(','),
        '--arms', arms.join(','), '--out', rowsPath, '--run-id', runId, '--peak-gb', String(peakGB), '--orders', ordersPath,
        '--warmups', String(protocol.warmups), '--reps', String(protocol.reps), '--attempt', String(attempt),
        ...(footprintOnly ? ['--untimed'] : [])], { stdio: 'inherit' });
      if (r.status === 75) return 'paused';
      if (r.status !== 0) process.exit(r.status ?? 1);
      return 'done';
    }
  };
  let queue = items;
  for (let attempt = 0; queue.length; attempt += 1) {
    for (;;) {
      const gate = await waitUntilClear({ footprintGB, peakGB, untimed: footprintOnly, gate: gateBounds });
      if (!gate.ok) process.exit(4);
      if (runAttempt(attempt, queue) === 'done') break;
    }
    const latest = readFileSync(rowsPath, 'utf8').trim().split('\n').map(l => JSON.parse(l))
      .filter(x => x.runId === runId && x.attempt === attempt && queue.includes(x.itemId));
    const drifted = [...new Set(latest.filter(x => !judge(x.gateAfter, { prev: x.gate, footprintGB, peakGB, ownGB: x.gateAfter.ownGB, untimed: footprintOnly, gate: gateBounds }).ok).map(x => x.itemId))];
    if (attempt >= protocol.maxRequeues) {
      if (drifted.length) appendFileSync(rowsPath, `${JSON.stringify({ runId, kind: 'timing-unstable', attempt, items: drifted })}\n`);
      break;
    }
    queue = drifted;
  }
  const all = readFileSync(rowsPath, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(x => x.runId === runId);
  const unstable = new Set(all.filter(x => x.kind === 'timing-unstable').flatMap(x => x.items));
  const rows = latestRows(all.filter(x => !x.kind)).map(x => ({ ...x, timing: unstable.has(x.itemId) ? 'timing-unstable' : 'stable' }));
  for (const row of rows) await emit(join(dir, `${runId}.ffr.jsonl`), ffrRow(row, models));
  process.stdout.write(`${runId}: ${rows.length} rows, ${rows.filter(x => x.abstain).length} abstentions -> ${rowsPath}\n`);
}
