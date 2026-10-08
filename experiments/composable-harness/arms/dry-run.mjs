#!/usr/bin/env node
// EXP 009 practice dry run (bundle 3 WO-05). PRACTICE SEEDS ONLY: a counted seed is refused. Run it only inside a held
// memory window (mac-memory-window.sh run -- node experiments/composable-harness/arms/dry-run.mjs ...).
//
//   node experiments/composable-harness/arms/dry-run.mjs --seed practice-<n> --trials 10 --out <dir> [--fake]
//
// It runs H1 against R0 on the practice items, then H2 (the blind plain registry) on the same schedule, re-runs a seeded 10% of the R0 keys fresh (byte-identical?), runs one
// R0 job twice from scratch (self-equivalent across a restart?), runs K1/K2 on the fake child, records the MLX child's
// active memory and that no harness child outlives an unload, and times every trial. The summary it prints (and writes
// to <dir>/summary.json) holds no labels, no local paths and no pids.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kernel } from '../../../harness/kernel.mjs';
import corpusAdapter from '../../../harness/services/corpus.mjs';
import { schedule, stream } from './schedule.mjs';
import { baseKernel, componentConfig, r0Client, runH1, SPECS } from './run.mjs';
import { runH2 } from './h2.mjs';
import { LEAKS, cleanupPlanted, detect } from '../probes/leaks.mjs';
import { SPEC } from '../probes/observe.mjs';
import { analyse } from '../analysis/analyse.mjs';

const argv = process.argv.slice(2);
const at = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const seed = at('--seed');
if (!/^practice-[\w-]+$/.test(seed ?? '')) { process.stderr.write('dry-run: --seed must be a practice seed (practice-...); counted seeds are refused\n'); process.exit(2); }
const trials = Number(at('--trials', '10'));
const out = at('--out');
if (!out) { process.stderr.write('dry-run: --out <dir> is required\n'); process.exit(2); }
mkdirSync(out, { recursive: true });
const fake = argv.includes('--fake');

const PINS = ['A', 'B'];
const env = fake
  ? { pins: { A: { modelKey: 'qwen3-fake-a', fake: true }, B: { modelKey: 'llama-fake-b', fake: true } }, memory: { stub: { freePct: 74, totalGB: 128, swapUsedMB: 100, load1: 3 } }, untimed: true }
  : { pins: { A: { modelKey: 'qwen3-0.6b-practice', modelDir: '<cache>/composable-harness/mlx/qwen3-0.6b-practice' }, B: { modelKey: 'llama-3.2-1b-practice', modelDir: '<cache>/composable-harness/mlx/llama-3.2-1b-practice' } }, memory: {}, untimed: true };
const log = line => { process.stderr.write(`${line}\n`); };
const marked = () => execFileSync('sh', ['-c', `pgrep -f '${SPEC.outside.markedProcesses.pattern}' | wc -l`], { encoding: 'utf8' }).trim();

const k0 = new Kernel();
await k0.load(corpusAdapter);
const items = k0.service('corpus').items.filter((_, i) => i % 10 === 3).slice(0, 20); // the practice spread
await k0.dispose();

// 1. MLX child: memory after load, after evaluations, and nothing left after unload.
const mem = {};
{
  const k = await baseKernel(env);
  for (const name of ['mlx.model', 'memo-cache', 'yesno-gate']) await k.load(SPECS[name], componentConfig(name, name === 'mlx.model' ? { pin: 'A' } : {}, env));
  const status = k.census().map(r => `${r.name}:${r.status}`);
  if (!status.every(s => s.endsWith(':active'))) throw new Error(`components not active: ${status.join(', ')}`);
  mem.afterLoad = await k.service('mlx').memory();
  for (const it of items.slice(0, 5)) await k.service('yesno').decide(it);
  mem.afterEvals = await k.service('mlx').memory();
  await k.unload('mlx.model');
  mem.markedAfterUnload = Number(marked());
  await k.dispose();
  log(`memory ${JSON.stringify(mem)}`);
}

// 2. H1 vs R0.
const stats = { hits: 0, runs: 0 };
const cacheDir = join(out, 'r0-cache');
const r0 = r0Client({ env, cacheDir, stats });
const sched = schedule({ seed, trials, items, pins: PINS });
const t0 = Date.now();
const rows = await runH1({ schedule: sched, env, r0, world: { scratch: null, baseGlobals: Object.keys(globalThis) }, onTrial: r => log(`trial ${r.trial}: ${r.divergences.length} divergences, ${r.wallMs} ms`) });
const h1Ms = Date.now() - t0;
writeFileSync(join(out, 'h1.jsonl'), rows.map(r => `${JSON.stringify(r)}\n`).join(''));

// 2b. H2: the blind plain-registry arm on the same schedule (each trial from an empty registry, torn down by hand).
const h2Rows = await runH2({ schedule: sched, env, r0, scratchRoot: join(out, 'h2'), onTrial: r => log(`H2 trial ${r.trial}: residue ${JSON.stringify(r.residue)}, ${r.mismatches} mismatches, ${r.errors.length} errors`) });
writeFileSync(join(out, 'h2.jsonl'), h2Rows.map(r => `${JSON.stringify(r)}\n`).join(''));

// 3. Seeded 10% R0 re-run, fresh, byte-identical; and one job twice from scratch (restart).
const keys = readdirSync(cacheDir).filter(f => /^[0-9a-f]{64}\.json$/.test(f)).sort();
const r = stream(seed, 'r0-rerun');
const sampled = keys.filter(() => r() < 0.1);
if (sampled.length === 0 && keys.length) sampled.push(keys[0]);
let identical = 0;
// The R0 client records each job under its cache key (jobs.json), so a sampled key can be re-run fresh.
const jobIndex = JSON.parse(readFileSync(join(cacheDir, 'jobs.json'), 'utf8'));
for (const key of sampled) {
  const job = jobIndex[key.replace(/\.json$/, '')];
  const again = await r0(job.loaded, job.item, { fresh: true });
  if (again === readFileSync(join(cacheDir, key), 'utf8')) identical += 1;
}
const probeJob = jobIndex[keys[0].replace(/\.json$/, '')];
const restartA = await r0(probeJob.loaded, probeJob.item, { fresh: true });
const restartB = await r0(probeJob.loaded, probeJob.item, { fresh: true });

// 4. K1 / K2 on the fake child.
let k1 = 0, k2Residue = 0;
for (const leak of LEAKS) {
  const a = await detect(leak, { reified: false, items });
  await cleanupPlanted();
  if (a.residue.some(p => p === a.expected || p.startsWith(`${a.expected}.`))) k1 += 1;
  k2Residue += (await detect(leak, { reified: true, items })).residue.length;
}

const gates = {
  k1: { detected: k1, of: LEAKS.length }, k2: { residueProbes: k2Residue }, r0Rerun: { sampled: sampled.length, identical },
  r0Restart: { identical: restartA === restartB }, pins: { verified: false, kernelShaInPrereg: false }, leases: { blocks: 0, held: 0 },
};
const summary = {
  kind: 'exp009-practice-dry-run', seed, fake, trials, items: items.map(i => i.id),
  pins: Object.fromEntries(Object.entries(env.pins).map(([k, v]) => [k, v.modelKey])),
  memory: mem, r0: { ...stats, keys: keys.length, rerun: gates.r0Rerun, restartIdentical: gates.r0Restart.identical },
  h1: { divergentTrials: rows.filter(x => x.divergences.length).length, ops: rows.reduce((s, x) => s + x.ops, 0), evals: rows.reduce((s, x) => s + x.evals, 0), reconfigures: rows.reduce((s, x) => s + x.reconfigures, 0), pinSwaps: rows.reduce((s, x) => s + x.pinSwaps, 0), wallMsPerTrial: rows.map(x => x.wallMs), totalMs: h1Ms },
  h2: { residueTrials: h2Rows.filter(x => x.residue.length).length, residueProbes: [...new Set(h2Rows.flatMap(x => x.residue))].sort(), mismatchTrials: h2Rows.filter(x => x.mismatches).length, errorTrials: h2Rows.filter(x => x.errors.length).length },
  k1: gates.k1, k2: gates.k2,
  analysis: analyse({ trials: [...rows, ...h2Rows], gates }),
  note: 'Practice only. pins and leases gates are not evaluated in a dry run (no prereg yet, the lease is recorded by mac-memory-window.sh); the analysis is therefore uninformative by construction.',
};
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\n`);
