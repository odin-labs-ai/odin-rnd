// EXP 009 teeth controls. K1: twelve pre-registered planted leaks, each a runtime change made OUTSIDE ctx.effect (or a
// cache that survives its pin), so unloading cannot undo it. K2: the same twelve changes routed through ctx.effect with
// their inverse (the reifying coeffect). The validity gate: the probes must see at least 11 of the 12 K1 leaks, and K2
// must leave no residue. `detect(leak, { reified })` runs one scenario and returns the residue paths it observed.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Kernel, defineComponent } from '../../../harness/kernel.mjs';
import mlxMemory from '../../../harness/services/mlxMemory.mjs';
import mlxModel from '../components/mlx-model.mjs';
import memoCache from '../components/memo-cache.mjs';
import yesnoGate from '../components/yesno-gate.mjs';
import { observe, residue, staleResidue, warmUp } from './observe.mjs';

const CHILD = fileURLToPath(new URL('./leak-child.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('../fixtures/fake-mlx.mjs', import.meta.url));
const STUB = { freePct: 74, totalGB: 128, swapUsedMB: 100, load1: 3, mlxServerPids: [] };
const noop = () => {};

/**
 * One change, either made raw (K1) or through ctx.effect with its inverse (K2). A raw change's inverse is kept only
 * in `planted`, which the kernel never sees: cleanupPlanted() runs them AFTER the observation, so the harness process
 * itself does not carry the planted leaks forward (test hygiene, never part of what is measured).
 */
const planted = [];
async function change(ctx, reified, does, undo, keys) {
  if (reified) return ctx.effect(does, undo, { keys });
  const out = await does();
  planted.push(undo);
  return out;
}
export async function cleanupPlanted() {
  while (planted.length) { try { await planted.pop()(); } catch { /* its scratch root is already gone */ } }
}
// The handle the change opens is closed over, so the inverse (or nothing, for K1) can close it.
const held = (id, probe, open, close) => ({
  id, probe, scenario: 'unload',
  spec: reified => defineComponent({
    name: `k.${id}`, inverses: ['leak'],
    async apply(ctx, cfg) { let h; await change(ctx, reified, async () => { h = await open(cfg); }, () => close(h), ['leak']); },
  }),
});

export const LEAKS = Object.freeze([
  held('raw-interval', 'inside.timers', () => setInterval(noop, 60_000), h => clearInterval(h)),
  held('process-listener', 'inside.listeners', () => { const f = noop.bind(null); process.on('SIGUSR2', f); return f; }, f => process.off('SIGUSR2', f)),
  { id: 'stale-prefix-cache', probe: 'inside.staleKeys.prefix', scenario: 'pinswap' },
  { id: 'stale-memo', probe: 'inside.staleKeys.memo', scenario: 'pinswap' },
  held('temp-file', 'outside.scratch', cfg => { const p = join(cfg.scratch, 'k-temp-file.txt'); writeFileSync(p, 'x'); return p; }, p => unlinkSync(p)),
  held('unreified-child', 'outside.childPids', () => new Promise((ok, fail) => { const c = spawn(process.execPath, [CHILD], { stdio: 'ignore' }); c.once('spawn', () => ok(c)).once('error', fail); }),
    c => new Promise(ok => { if (c.exitCode !== null || c.signalCode !== null) return ok(); c.once('exit', () => ok()); c.kill('SIGKILL'); })),
  held('env-var', 'inside.env', () => { process.env.EXP009_K_ENV = '1'; return 'EXP009_K_ENV'; }, k => { delete process.env[k]; }),
  held('open-fd', 'outside.fds', cfg => openSync(join(cfg.scratch, '..', `${cfg.scratchName}.fd`), 'a'), fd => closeSync(fd)),
  held('net-server', 'outside.handles', () => new Promise(ok => { const s = createServer(); s.listen(0, '127.0.0.1', () => ok(s)); }), s => new Promise(ok => s.close(() => ok()))),
  held('global', 'inside.globals', () => { globalThis.exp009KGlobal = {}; return 'exp009KGlobal'; }, k => { delete globalThis[k]; }),
  held('fs-watcher', 'outside.handles', cfg => watch(cfg.scratch), w => w.close()),
  held('worker-thread', 'outside.fds', () => new Promise(ok => { const w = new Worker('setInterval(() => {}, 60_000)', { eval: true }); w.once('online', () => ok(w)); }), w => w.terminate()),
]);

// The two cache leaks are variants of the real components whose cache outlives an activation (module-level, never
// cleared). Their K2 twins are the real mlx.model and memo-cache, whose caches are ctx.effect state.
const leakyPrefix = new Set();
const leakyMlx = defineComponent({
  name: 'mlx.model', inject: ['mlxMemory'], provides: ['mlx'], inverses: ['mlx-child'],
  async apply(ctx, cfg) {
    // The real mlx.model, in a private kernel, serves the child; only the prefix-key mirror is made to leak.
    let child;
    const inner = new Kernel();
    await ctx.effect(async () => { await inner.load(mlxMemory, { stub: STUB }); await inner.load(mlxModel, cfg); child = inner.service('mlx'); }, () => inner.dispose(), { keys: ['mlx-child'] });
    ctx.provide('mlx', Object.freeze({
      pin: child.pin, pid: child.pid,
      async eval(state) { const r = await child.eval(state); leakyPrefix.add(r.prefixKey); return r; },
      prefixKeys: () => [...leakyPrefix],
      childPrefixKeys: () => child.childPrefixKeys(),
      memory: () => child.memory(),
    }));
  },
});
const leakyMemoMap = new Map();
const leakyMemo = defineComponent({
  name: 'memo-cache', inject: ['mlx'], provides: ['memo'],
  apply(ctx) {
    const { pin } = ctx.inject.mlx;
    ctx.provide('memo', Object.freeze({ key: s => `${pin}:${s}`, get: k => leakyMemoMap.get(k), set: (k, v) => leakyMemoMap.set(k, v), keys: () => [...leakyMemoMap.keys()] }));
  },
});

const mlxCfg = pin => ({ modelKey: pin, command: [process.execPath, FAKE, '--model-key', pin, '--prefix-cache', '4'], prefixCache: 4 });

/**
 * Run one leak scenario in a fresh kernel and scratch root. `unload`: observe, load the component, unload it, observe;
 * residue = the probes that changed. `pinswap`: evaluate three items under pin A, reconfigure mlx.model to pin B, and
 * read the cache-validity probes. Returns { id, reified, residue: [paths], expected: probe }.
 */
export async function detect(leak, { reified, items }) {
  await warmUp();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'exp009-k-'));
  const scratch = join(scratchRoot, 'scratch');
  mkdirSync(scratch);
  const world = { scratch, baseGlobals: Object.keys(globalThis) };
  const k = new Kernel();
  try {
    if (leak.scenario === 'unload') {
      const before = await observe(k, world);
      const spec = leak.spec(reified);
      await k.load(spec, { scratch, scratchName: 'scratch' });
      if (k.census()[0].status !== 'active') throw new Error(`${leak.id}: ${k.census()[0].status}`);
      await k.unload(spec.name);
      const after = await observe(k, world);
      return { id: leak.id, reified, expected: leak.probe, residue: residue(before, after) };
    }
    leakyPrefix.clear();
    leakyMemoMap.clear();
    await k.load(mlxMemory, { stub: STUB });
    await k.load(leak.id === 'stale-prefix-cache' && !reified ? leakyMlx : mlxModel, mlxCfg('pin-a'));
    await k.load(leak.id === 'stale-memo' && !reified ? leakyMemo : memoCache);
    await k.load(yesnoGate);
    for (const item of items.slice(0, 3)) await k.service('yesno').decide(item);
    await k.reconfigure('mlx.model', mlxCfg('pin-b'));
    return { id: leak.id, reified, expected: leak.probe, residue: staleResidue(await observe(k, world)) };
  } finally {
    await k.dispose();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}
