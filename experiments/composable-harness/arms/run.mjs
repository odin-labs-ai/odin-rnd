// EXP 009 arms. H1: one long-lived kernel runs the seeded schedule. R0: a fresh process per (loaded set, item), cached
// by key (r0.mjs). After every operation H1's inside-boundary projection is compared with R0's for the same loaded set;
// after every evaluation H1's decisions are compared with R0's for the same (loaded set, item). Any difference is a
// divergence. The runner never reads labels: an item is { set, id, state, stateSha256 } from the corpus service.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kernel } from '../../../harness/kernel.mjs';
import { inside } from '../probes/observe.mjs';
import { DEFAULTS, INFRASTRUCTURE, SPECS } from './harness-set.mjs';

export { SPECS };
const R0 = fileURLToPath(new URL('./r0.mjs', import.meta.url));
const sha256 = s => createHash('sha256').update(s).digest('hex');
const canon = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));

/**
 * The run environment, shared by H1 and R0 (passed to r0.mjs on stdin, never interpolated into code):
 *   { pins: { <pin>: { modelKey, modelDir } | { modelKey, fake: true } }, memory: { stub } | {}, untimed }
 */
export function componentConfig(name, config, env) {
  if (name !== 'mlx.model') return { ...DEFAULTS[name], ...config };
  const p = env.pins[config.pin];
  if (!p) throw new Error(`no pin ${config.pin} in the run environment`);
  const fake = fileURLToPath(new URL('../fixtures/fake-mlx.mjs', import.meta.url));
  return p.fake
    ? { modelKey: p.modelKey, prefixCache: 4, command: [process.execPath, fake, '--model-key', p.modelKey, '--prefix-cache', '4'], untimed: env.untimed ?? false }
    : { modelKey: p.modelKey, modelDir: p.modelDir, prefixCache: 4, untimed: env.untimed ?? false };
}

/** A kernel with harness.json's infrastructure entry (the memory gate) loaded, before any scheduled component. */
export async function baseKernel(env) {
  const k = new Kernel();
  await k.load(INFRASTRUCTURE.spec, { ...INFRASTRUCTURE.config, ...(env.memory ?? {}) });
  return k;
}

/**
 * The P1 projection: the kernel registry, the mlx pin, the cache-validity counts, and the process-wide inside probes
 * as deltas from this process's own baseline (taken before any scheduled component loaded). Cache CONTENTS are not in
 * it: a fresh process has not evaluated what a long-lived one has; a key of a stale pin is what counts.
 */
export function projection(kernel, baseline, world) {
  const o = inside(kernel, world);
  const delta = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] - (b[k] ?? 0)]));
  return {
    registry: o.registry,
    mlxPin: o.pins.mlx,
    staleKeys: o.staleKeys,
    listeners: delta(o.listeners, baseline.listeners),
    timers: o.timers - baseline.timers,
    env: o.env.filter(e => !baseline.env.includes(e)),
    globals: o.globals.filter(g => !baseline.globals.includes(g)),
  };
}

/** Decisions of every active decision component for one item. */
export async function evaluate(kernel, item) {
  const out = {};
  if (kernel.services.has('lint')) out.lint = kernel.service('lint').decide(item).decision;
  if (kernel.services.has('grep')) out.grep = kernel.service('grep').decide(item).decision;
  if (kernel.services.has('yesno')) {
    const { decision, p } = await kernel.service('yesno').decide(item);
    out.yesno = { decision, p };
    if (kernel.services.has('spend-counter')) kernel.service('spend-counter').charge('yesno');
  }
  return out;
}

/**
 * R0, cached: run r0.mjs for (loaded set, item | null) in a fresh process; the job goes over stdin. Every R0 child runs
 * with the TMPDIR in effect when the client is made, so an R0 run during the H2 arm (which points this process's TMPDIR
 * at its scratch root) is the same as one during H1, and writes nothing into H2's observed scratch.
 */
export function r0Client({ env, cacheDir, stats }) {
  mkdirSync(cacheDir, { recursive: true });
  const childEnv = { ...process.env, TMPDIR: tmpdir() };
  const jobsFile = join(cacheDir, 'jobs.json');
  const jobs = existsSync(jobsFile) ? JSON.parse(readFileSync(jobsFile, 'utf8')) : {};
  return async (loaded, item, { fresh = false } = {}) => {
    const job = { env, loaded, item: item ? { id: item.id, state: item.state, stateSha256: item.stateSha256 } : null };
    const key = sha256(canon({ env, loaded, item: item ? item.stateSha256 : null }));
    const file = join(cacheDir, `${key}.json`);
    if (!fresh && existsSync(file)) { stats.hits += 1; return readFileSync(file, 'utf8'); }
    stats.runs += 1;
    const out = await new Promise((ok, fail) => {
      const ch = spawn(process.execPath, [R0], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
      let so = '', se = '';
      ch.stdout.on('data', d => { so += d; });
      ch.stderr.on('data', d => { se += d; });
      ch.once('error', fail);
      ch.once('exit', code => (code === 0 ? ok(so) : fail(new Error(`r0 exit ${code}: ${se.trim().split('\n').slice(-3).join(' | ')}`))));
      ch.stdin.end(JSON.stringify(job));
    });
    if (!fresh) {
      writeFileSync(file, out);
      jobs[key] = { loaded, item };
      writeFileSync(jobsFile, JSON.stringify(jobs));
    }
    return out;
  };
}

/**
 * H1 over a schedule, compared step by step with R0. Returns one row per trial:
 *   { arm: 'H1', trial, ops, evals, reconfigures, pinSwaps, divergences: [{ step, kind, detail }], wallMs }
 */
export async function runH1({ schedule, env, r0, world, onTrial = () => {} }) {
  const k = await baseKernel(env);
  const baseline = inside(k, world);
  const loaded = [];
  const rows = [];
  try {
    for (const t of schedule) {
      const t0 = Date.now();
      const row = { arm: 'H1', trial: t.index, ops: 0, evals: 0, reconfigures: 0, pinSwaps: 0, divergences: [] };
      for (const [step, s] of t.steps.entries()) {
        if (s.kind === 'op') {
          row.ops += 1;
          if (s.op === 'load') { loaded.push([s.name, s.config]); await k.load(SPECS[s.name], componentConfig(s.name, s.config, env)); }
          if (s.op === 'unload') { loaded.splice(loaded.findIndex(([n]) => n === s.name), 1); await k.unload(s.name); }
          if (s.op === 'reconfigure') {
            row.reconfigures += 1; if (s.pinSwap) row.pinSwaps += 1;
            loaded[loaded.findIndex(([n]) => n === s.name)][1] = s.config;
            await k.reconfigure(s.name, componentConfig(s.name, s.config, env));
          }
          const mine = canon(projection(k, baseline, world));
          const ref = canon(JSON.parse(await r0(loaded.map(x => [...x]), null)).projection);
          if (mine !== ref) row.divergences.push({ step, kind: 'snapshot', detail: { h1: JSON.parse(mine), r0: JSON.parse(ref) } });
        } else {
          row.evals += 1;
          const mine = canon(await evaluate(k, s.item));
          const ref = canon(JSON.parse(await r0(loaded.map(x => [...x]), s.item)).decisions);
          if (mine !== ref) row.divergences.push({ step, kind: 'decision', detail: { item: s.item.id, h1: JSON.parse(mine), r0: JSON.parse(ref) } });
        }
      }
      row.wallMs = Date.now() - t0;
      rows.push(row);
      onTrial(row);
    }
  } finally {
    await k.dispose();
  }
  return rows;
}
