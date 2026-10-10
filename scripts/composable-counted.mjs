#!/usr/bin/env node
// EXP 009 counted run, one block (bundle 5 WO-01). Run it only through scripts/composable-counted-blocks.sh, which
// wraps it in odin-labs' mac-memory-window.sh lease:
//
//   node scripts/composable-counted.mjs --merge-commit <40-hex merge id of the odin-rnd PR that published the record> --block NN
//   node scripts/composable-counted.mjs --next-block      print the lowest block with no complete attempt (or "none")
//
// It derives the seed itself (the record's schedule.seedRule: sha256 of the 40-char lower-case hex merge commit id,
// UTF-8) and refuses unless it equals the published seed. Then two gates, each fail-closed, none with an override:
//   (a) not-before: the current UTC time must be after the record's not-before (merge + 24 h);
//   (c) this process runs inside a held memory-window lease labelled for its block, whose holder is an ancestor.
// Gate (b), "EXP 008's counted run has finished", was dropped (supervisor 2026-10-07: gate dropped; lease serialises).
// EXP 009's pinned weights are not EXP 008's counted ones, and the one machine-wide memory-window lease already
// serialises every measured run: while EXP 008 holds it, a block waits in the wrapper. The driver reads nothing of
// EXP 008's state, so that state can neither block nor unblock a block.
// Then the WO-01 pre-flight: the record --check (its sha256), and EXP 008's pins.mjs verify (every pinned weight hash).
//
// Block k is trials [k x blockSize, (k + 1) x blockSize) of the 400-trial schedule seeded by the counted seed over the
// whole 200-item corpus, pins A = llama-3.2-3b and B = qwen3-1.7b (the record's mlx.model: Llama-3.2-3B, swapped by
// reconfigure to Qwen3-1.7B; EXP 008's pinned, converted weights, read only). In the block it runs, as the record
// defines them: H1 against R0, H2 on the same trials, the seeded 10% R0 re-run, the R0 restart check, K1/K2, the MLX
// child's memory after load / evaluations / unload, and (block 0 only) P2's 120 configurations. Lease and breach
// evidence are written per attempt.
//
// Block boundary. H1 is one long-lived kernel within a block; a block is its own process in its own window, so the
// kernel cannot live across blocks. A block's kernel first loads the set the block's first trial enters with (the
// schedule's startState, in load order) as a prelude, compared with R0 like any step, recorded apart (arm
// "H1-prelude") and never counted as a trial. H2 registers each trial's entering set itself.
//
// Output (runs/composable-harness/counted/, outside the record's pinned roots): one append-only JSONL per arm, every row
// carrying its block and attemptId. Nothing is overwritten: a block with a complete attempt is refused; a resumed or
// re-queued block is a new attempt with its own id and start time. r0-cache/ is R0's content-addressed cache.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const C = join(REPO_ROOT, 'experiments/composable-harness');
export const RECORD = JSON.parse(readFileSync(join(C, 'preregistration.json'), 'utf8'));
export const RECORD_SHA256 = 'd25f7f3fe9f802b19ed5caa9a437126109b20f83fe993086854a20bb902e7e7e';
export const SEED = '32e343ca3a4e46c007abbdd09ee5e406a1cb4e7f452aad67587812f36b96a7c5';
/** GitHub mergedAt of odin-rnd #28 (merge 91de325d), recorded after publication as the record's notBefore says. */
export const PUBLISHED_AT = '2026-10-07T11:34:15Z';
export const NOT_BEFORE = '2026-10-08T11:34:15Z';
export const TRIALS = RECORD.schedule.trials;
export const BLOCK_SIZE = RECORD.schedule.blockSize;
export const BLOCKS = TRIALS / BLOCK_SIZE;
export const PINS = ['A', 'B'];
export const COUNTED_MODELS = Object.freeze({ A: 'llama-3.2-3b', B: 'qwen3-1.7b' });
export const OUT_ROOT = join(REPO_ROOT, 'runs/composable-harness/counted');
export const LEASE_DIR = join(homedir(), '.odin/state/mac-memory-window/lease');
export const ARM_FILES = Object.freeze({
  attempts: 'attempts.jsonl', h1: 'h1.jsonl', prelude: 'h1-prelude.jsonl', h2: 'h2.jsonl', rerun: 'r0-rerun.jsonl',
  restart: 'r0-restart.jsonl', k: 'k.jsonl', memory: 'memory.jsonl', p2: 'p2.jsonl', leases: 'leases.jsonl',
});
const UNPRICED = Object.freeze({ costUsd: null, reason: 'local-unpriced' });
if (BLOCKS !== Math.floor(BLOCKS) || NOT_BEFORE !== new Date(Date.parse(PUBLISHED_AT) + 24 * 3600 * 1000).toISOString().replace('.000Z', 'Z')) {
  throw new Error('counted: the record schedule or the not-before constant is inconsistent');
}

const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
const nn = k => String(k).padStart(2, '0');
const refused = (gate, reason) => ({ ok: false, gate, reason });

// ---- seed and gates (pure given their inputs; the CLI passes only real values) --------------------------------

/** The record's seedRule. Throws unless `mergeCommit` is a 40-char lower-case hex id. */
export function deriveSeed(mergeCommit) {
  if (!/^[0-9a-f]{40}$/.test(mergeCommit ?? '')) throw new Error('the merge commit id must be 40 lower-case hex characters');
  return sha256(mergeCommit);
}

export function seedGate(mergeCommit) {
  let seed;
  try { seed = deriveSeed(mergeCommit); } catch (e) { return refused('seed', e.message); }
  return seed === SEED ? { ok: true, gate: 'seed', seed } : refused('seed', `derived seed ${seed.slice(0, 12)}… is not the published seed ${SEED.slice(0, 12)}…`);
}

/** (a) Strictly after the not-before. `now` is a Date. */
export function notBeforeGate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return refused('not-before', 'no readable clock');
  return now.getTime() > Date.parse(NOT_BEFORE) ? { ok: true, gate: 'not-before', now: now.toISOString() }
    : refused('not-before', `${now.toISOString()} is not after ${NOT_BEFORE}`);
}

/** The parent pid of `pid` (ps), or null. */
export function ppidOf(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return /^\d+$/.test(out) ? Number(out) : null;
  } catch { return null; }
}

/**
 * (c) A held lease: LEASE_DIR exists, its label is this block's (exp009-counted-bNN, so no other lease can carry a
 * block), its runId is this run's MMW_RUN_ID, the sidecar named in MMW_RUN_SIDECAR is that run's, and the lease
 * holder's pid is a strict ancestor of `pid`. Returns the lease facts the record keeps (no
 * pids, no local paths).
 */
export function leaseGate({ block, leaseDir = LEASE_DIR, pid = process.pid, env = process.env, parentOf = ppidOf } = {}) {
  const field = f => { try { return readFileSync(join(leaseDir, f), 'utf8').trim(); } catch { return null; } };
  if (!existsSync(leaseDir)) return refused('lease', 'no memory-window lease is held');
  const holder = field('pid');
  const runId = field('runId');
  if (!/^\d+$/.test(holder ?? '')) return refused('lease', 'the lease holder pid is unreadable');
  if (!Number.isInteger(block) || field('label') !== `exp009-counted-b${nn(block)}`) return refused('lease', 'the lease is not this block\'s (label differs)');
  if (!runId || runId !== env.MMW_RUN_ID) return refused('lease', 'the lease is not this run\'s (MMW_RUN_ID differs or is unset)');
  if (!env.MMW_RUN_SIDECAR || basename(env.MMW_RUN_SIDECAR) !== `${runId}.jsonl`) return refused('lease', 'MMW_RUN_SIDECAR is not this run\'s sidecar');
  const seen = new Set();
  for (let p = parentOf(pid); p && p > 1 && !seen.has(p); p = parentOf(p)) {
    seen.add(p);
    if (p === Number(holder)) return { ok: true, gate: 'lease', lease: { runId, label: field('label'), startedAt: field('startedAt') } };
  }
  return refused('lease', 'the lease holder is not an ancestor of this process');
}

/** WO-01 pre-flight: EXP 009's counted weights exist (converted MLX dirs with a config and weights). Never loads them. */
export function pinsExist({ cacheRoot = join(homedir(), '.cache/odin-rnd/latent-handoff') } = {}) {
  const missing = Object.values(COUNTED_MODELS).filter(key => {
    const dir = join(cacheRoot, 'mlx', key);
    return !existsSync(join(dir, 'config.json')) || !(existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.safetensors')));
  });
  return missing.length ? refused('pins', `counted weights missing: ${missing.join(', ')}`) : { ok: true, gate: 'pins' };
}

// ---- blocks and the append-only output ------------------------------------------------------------------------

/** Block k's trials: [first, end). */
export function blockRange(k, { trials = TRIALS, blockSize = BLOCK_SIZE } = {}) {
  if (!Number.isInteger(k) || k < 0 || k >= trials / blockSize) throw new Error(`block ${k} is outside 0..${trials / blockSize - 1}`);
  return { first: k * blockSize, end: (k + 1) * blockSize };
}

const readJsonl = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** attempts.jsonl as { complete: Set(block), starts: Map(block -> count) }. */
export function attemptState(outRoot = OUT_ROOT) {
  const rows = readJsonl(join(outRoot, ARM_FILES.attempts));
  const complete = new Set(rows.filter(r => r.event === 'complete').map(r => r.block));
  const starts = new Map();
  for (const r of rows.filter(x => x.event === 'start')) starts.set(r.block, (starts.get(r.block) ?? 0) + 1);
  return { complete, starts };
}

export function nextBlock(outRoot = OUT_ROOT, { trials = TRIALS, blockSize = BLOCK_SIZE } = {}) {
  const { complete } = attemptState(outRoot);
  for (let k = 0; k < trials / blockSize; k += 1) if (!complete.has(k)) return k;
  return null;
}

/** Append-only writer: appendFileSync only, never a truncating write. */
function writer(outRoot, block, attemptId) {
  mkdirSync(outRoot, { recursive: true });
  return (arm, row) => appendFileSync(join(outRoot, ARM_FILES[arm]), `${JSON.stringify({ block, attemptId, ...row })}\n`);
}

/** Every R0 cache key the seeded 10% re-run samples: membership is a function of (seed, key) alone. */
export const rerunSampled = (seed, key) => createHash('sha256').update(`${seed}\nr0-rerun\n${key}`).digest().readUIntBE(0, 6) / 2 ** 48 < 0.1;

/** P2: every blind-authored configuration, once. The runner passes the config to runConfig, which reads no label. */
export async function runP2(onRow) {
  const { runConfig } = await import('../experiments/composable-harness/arms/p2.mjs');
  const dir = join(C, 'corpus/authored');
  const files = readdirSync(dir).filter(f => /^cfg-\d{3}\.json$/.test(f)).sort();
  for (const f of files) {
    const config = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const census = await runConfig(config);
    onRow({ config: config.id, ...census });
  }
  return files.length;
}

/**
 * One attempt at one block. `env` is the run environment of arms/run.mjs (tests pass fake pins); `items` the corpus
 * items the schedule draws from. Refuses a block that already has a complete attempt. Returns the attempt summary.
 */
export async function runBlock({ block, seed, env, items, outRoot = OUT_ROOT, lease = null, preflight = {}, trials = TRIALS, blockSize = BLOCK_SIZE, p2 = block === 0, log = () => {} }) {
  const { first, end } = blockRange(block, { trials, blockSize });
  const state = attemptState(outRoot);
  if (state.complete.has(block)) throw Object.assign(new Error(`block ${nn(block)} already has a complete attempt; the counted run is append-only`), { refusal: true });
  const startedAt = new Date().toISOString();
  const attemptId = `b${nn(block)}-a${state.starts.get(block) ?? 0}-${startedAt.replace(/[-:.]/g, '')}`;
  const put = writer(outRoot, block, attemptId);
  put('attempts', { event: 'start', trials: [first, end], startedAt, lease, preflight, spend: UNPRICED });

  const { execFileSync: run } = await import('node:child_process');
  const { schedule, stream } = await import('../experiments/composable-harness/arms/schedule.mjs');
  const { baseKernel, componentConfig, r0Client, runH1, SPECS } = await import('../experiments/composable-harness/arms/run.mjs');
  const { runH2 } = await import('../experiments/composable-harness/arms/h2.mjs');
  const { LEAKS, cleanupPlanted, detect } = await import('../experiments/composable-harness/probes/leaks.mjs');
  const { SPEC } = await import('../experiments/composable-harness/probes/observe.mjs');
  const scratchRoot = mkdtempSync(join(tmpdir(), 'exp009-counted-h2-'));
  try {
    const mine = schedule({ seed, trials, items, pins: PINS }).slice(first, end);

    // 1. MLX child memory: after load, after evaluations, marked processes after unload (S2, the unload check).
    {
      const k = await baseKernel(env);
      for (const name of ['mlx.model', 'memo-cache', 'yesno-gate']) await k.load(SPECS[name], componentConfig(name, name === 'mlx.model' ? { pin: 'A' } : {}, env));
      const afterLoad = await k.service('mlx').memory();
      for (const it of items.slice(0, 5)) await k.service('yesno').decide(it);
      const afterEvals = await k.service('mlx').memory();
      await k.unload('mlx.model');
      const marked = Number(run('sh', ['-c', 'pgrep -f "$1" | wc -l', 'sh', SPEC.outside.markedProcesses.pattern], { encoding: 'utf8' }).trim());
      await k.dispose();
      put('memory', { afterLoad, afterEvals, markedAfterUnload: marked, spend: UNPRICED });
    }

    // 2. H1 against R0, the block's trials after the boundary prelude.
    const stats = { hits: 0, runs: 0 };
    const cacheDir = join(outRoot, 'r0-cache');
    const r0 = r0Client({ env, cacheDir, stats });
    const entering = Object.entries(mine[0].startState);
    const prelude = entering.length ? [{ index: `prelude-b${nn(block)}`, steps: entering.map(([name, config]) => ({ kind: 'op', op: 'load', name, config })) }] : [];
    await runH1({
      schedule: [...prelude, ...mine], env, r0, world: { scratch: null, baseGlobals: Object.keys(globalThis) },
      onTrial: r => { if (typeof r.trial === 'number') { put('h1', r); log(`H1 trial ${r.trial}: ${r.divergences.length} divergences, ${r.wallMs} ms`); } else put('prelude', { ...r, arm: 'H1-prelude' }); },
    });

    // 3. H2 on the same trials.
    await runH2({ schedule: mine, env, r0, scratchRoot, onTrial: r => { put('h2', r); log(`H2 trial ${r.trial}: residue ${r.residue.length}`); } });

    // 4. The seeded 10% R0 re-run (every sampled key not yet re-run) and one restart pair.
    const keys = readdirSync(cacheDir).filter(f => /^[0-9a-f]{64}\.json$/.test(f)).map(f => f.slice(0, 64)).sort();
    const jobs = JSON.parse(readFileSync(join(cacheDir, 'jobs.json'), 'utf8'));
    const done = new Set(readJsonl(join(outRoot, ARM_FILES.rerun)).map(r => r.key));
    // A key without a job entry (a crash between R0's two cache writes) cannot be re-run: recorded, never guessed.
    for (const key of keys.filter(x => rerunSampled(seed, x) && !done.has(x))) {
      if (!jobs[key]) { put('rerun', { key, identical: null, skipped: 'no job entry' }); continue; }
      const again = await r0(jobs[key].loaded, jobs[key].item, { fresh: true });
      put('rerun', { key, identical: again === readFileSync(join(cacheDir, `${key}.json`), 'utf8') });
    }
    const withJob = keys.filter(x => jobs[x]);
    const pick = withJob[Math.floor(stream(seed, `r0-restart-b${nn(block)}`)() * withJob.length)];
    const a = await r0(jobs[pick].loaded, jobs[pick].item, { fresh: true });
    const b = await r0(jobs[pick].loaded, jobs[pick].item, { fresh: true });
    put('restart', { key: pick, identical: a === b });

    // 5. K1 / K2 (the planted leaks on the fake child, as probes/leaks.mjs defines them).
    for (const leak of LEAKS) {
      const k1 = await detect(leak, { reified: false, items });
      await cleanupPlanted();
      const k2 = await detect(leak, { reified: true, items });
      put('k', { leak: leak.id, expected: k1.expected, k1Residue: k1.residue, k1Detected: k1.residue.some(p => p === k1.expected || p.startsWith(`${k1.expected}.`)), k2Residue: k2.residue });
    }

    // 6. P2, once (block 0).
    const p2Configs = p2 ? await runP2(row => put('p2', row)) : 0;

    // 7. Lease and breach evidence so far (the wrapper's close summary follows the exit; the block runner copies it).
    const sidecar = process.env.MMW_RUN_SIDECAR;
    const samples = lease && sidecar && existsSync(sidecar) ? readJsonl(sidecar) : [];
    put('leases', { lease, samples: samples.length, breaches: samples.filter(s => s.kind === 'breach').map(({ ts, freePct, load1 }) => ({ ts, freePct, load1 })) });

    const summary = { r0: stats, p2Configs, endedAt: new Date().toISOString() };
    put('attempts', { event: 'complete', ...summary });
    return { attemptId, block, first, end, ...summary };
  } catch (e) {
    put('attempts', { event: 'error', message: String(e.message).slice(0, 400), at: new Date().toISOString() });
    throw e;
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

// ---- CLI -------------------------------------------------------------------------------------------------------

async function main(argv) {
  const at = f => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  if (argv.includes('--next-block')) { const k = nextBlock(); process.stdout.write(`${k === null ? 'none' : nn(k)}\n`); return 0; }
  const refuse = r => { process.stderr.write(`counted: REFUSED (${r.gate}): ${r.reason}\n`); return 2; };
  const s = seedGate(at('--merge-commit'));
  if (!s.ok) return refuse(s);
  const blockArg = at('--block');
  if (!/^\d{1,2}$/.test(blockArg ?? '')) return refuse(refused('usage', '--block NN is required'));
  const block = Number(blockArg);
  try { blockRange(block); } catch (e) { return refuse(refused('usage', e.message)); }
  for (const g of [notBeforeGate(new Date()), leaseGate({ block })]) if (!g.ok) return refuse(g);
  const lease = leaseGate({ block }).lease;
  if (attemptState().complete.has(block)) return refuse(refused('append-only', `block ${nn(block)} already has a complete attempt`));

  // WO-01 pre-flight: the record, then the pins (exist, then EXP 008's full pins.mjs verify, which hashes the weights).
  const check = spawnSync(process.execPath, ['scripts/composable-prereg.mjs', '--check'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (check.status !== 0 || !check.stdout.includes(RECORD_SHA256)) return refuse(refused('preflight', 'composable-prereg.mjs --check did not print the published record sha256'));
  const p = pinsExist();
  if (!p.ok) return refuse(p);
  const { loadModels, verify } = await import('../experiments/latent-handoff/pins.mjs');
  const pinErrors = await verify(loadModels());
  if (pinErrors.length) return refuse(refused('preflight', `pins.mjs verify: ${pinErrors.length} error(s), first: ${pinErrors[0]}`));

  const { Kernel } = await import('../harness/kernel.mjs');
  const { default: corpusAdapter } = await import('../harness/services/corpus.mjs');
  const k0 = new Kernel();
  await k0.load(corpusAdapter);
  const items = k0.service('corpus').items;
  await k0.dispose();
  const env = {
    pins: Object.fromEntries(Object.entries(COUNTED_MODELS).map(([pin, key]) => [pin, { modelKey: key, modelDir: `<cache>/latent-handoff/mlx/${key}` }])),
    memory: {}, untimed: true,
  };
  const out = await runBlock({
    block, seed: s.seed, env, items, lease,
    preflight: { recordSha256: RECORD_SHA256, pinsVerified: true, notBefore: NOT_BEFORE },
    log: line => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { process.stderr.write(`counted: ${e.refusal ? 'REFUSED (append-only)' : 'FAILED'}: ${e.message}\n`); process.exit(e.refusal ? 2 : 1); });
}
