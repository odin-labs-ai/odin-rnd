import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kernel, KernelError, defineComponent, loadHarness, parseHarness, plan } from '../harness/kernel.mjs';

// Bundle 2 WO-02: the harness kernel (our kernel implementing a Cordis-semantics subset). These tests are its
// acceptance criteria: LIFO dispose, missing coeffects named and never applied, dependents withdrawn before their
// provider, emission keys append-only (an inverse touching one refused at load), the harness.json loader, and 100
// randomised load/unload/reconfigure cycles that leave no residue.

const noop = () => {};
const KERNEL = 'harness/kernel.mjs';

test('the kernel is at most 400 lines and has no cordis dependency', () => {
  assert.ok(readFileSync(KERNEL, 'utf8').split('\n').length - 1 <= 400);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(d => /cordis/.test(d)));
  assert.doesNotMatch(readFileSync(KERNEL, 'utf8'), /from ['"]cordis/);
});

test('defineComponent validates its spec and freezes it', () => {
  assert.throws(() => defineComponent({ name: 'Bad', apply: noop }), KernelError);
  assert.throws(() => defineComponent({ name: 'a' }), /apply must be a function/);
  assert.throws(() => defineComponent({ name: 'a', apply: noop, inject: 'x' }), /inject must be an array/);
  assert.throws(() => defineComponent({ name: 'a', apply: noop, hmr: true }), /unknown spec field\(s\) hmr/);
  const s = defineComponent({ name: 'a', apply: noop, inject: ['x', 'x'] });
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.inject));
  assert.deepEqual(s.inject, ['x']);
});

test('effects run in order and dispose LIFO', async () => {
  const log = [];
  const k = new Kernel();
  await k.load(defineComponent({
    name: 'a',
    async apply(ctx) {
      for (const i of [1, 2, 3]) await ctx.effect(() => log.push(`do${i}`), () => log.push(`undo${i}`));
    },
  }));
  await k.unload('a');
  assert.deepEqual(log, ['do1', 'do2', 'do3', 'undo3', 'undo2', 'undo1']);
  assert.deepEqual(k.snapshot(), new Kernel().snapshot());
});

test('a missing coeffect is reported and named, apply never runs; a provider activates it and its withdrawal deactivates it first', async () => {
  const log = [];
  const k = new Kernel();
  const user = defineComponent({ name: 'user', inject: ['clock'], apply(ctx) { log.push(`apply user ${ctx.inject.clock.now()}`); return ctx.effect(noop, () => log.push('undo user')); } });
  const clock = defineComponent({ name: 'clock', provides: ['clock'], apply(ctx, c) { ctx.provide('clock', { now: () => c.t }); return ctx.effect(noop, () => log.push('undo clock')); } });
  await k.load(user);
  assert.deepEqual(k.census().map(r => r.status), ['inactive: missing clock']);
  assert.deepEqual(log, []);
  assert.throws(() => k.service('clock'), /no provider for clock/);
  await k.load(clock, { t: 7 });
  assert.deepEqual(k.census().map(r => r.status), ['active', 'active']);
  assert.deepEqual(log, ['apply user 7']);
  await k.unload('clock');
  assert.deepEqual(log, ['apply user 7', 'undo user', 'undo clock']);
  assert.deepEqual(k.census(), [{ name: 'user', status: 'inactive: missing clock', inject: ['clock'], provides: [] }]);
});

test('dependents are withdrawn transitively before their provider, and reactivate after a reconfigure', async () => {
  const log = [];
  const k = new Kernel();
  const mk = (name, inject, provides) => defineComponent({
    name, inject, provides,
    apply(ctx, c) {
      for (const p of provides) ctx.provide(p, `${name}:${c.v ?? 0}`);
      log.push(`+${name}(${inject.map(i => ctx.inject[i]).join(',')})`);
      return ctx.effect(noop, () => log.push(`-${name}`));
    },
  });
  await k.load(mk('c', ['y'], []));
  await k.load(mk('b', ['x'], ['y']));
  await k.load(mk('a', [], ['x']));
  assert.deepEqual(log, ['+a()', '+b(a:0)', '+c(b:0)']);
  log.length = 0;
  await k.reconfigure('a', { v: 1 });
  assert.deepEqual(log, ['-c', '-b', '-a', '+a()', '+b(a:1)', '+c(b:0)']);
  log.length = 0;
  await k.unload('a');
  assert.deepEqual(log, ['-c', '-b', '-a']);
  assert.deepEqual(k.census().map(r => r.status), ['inactive: missing y', 'inactive: missing x']);
});

test('keys are typed: an inverse touching an emission is refused at load with the key named; emissions are append-only history', async () => {
  const keys = { ffr: 'emission', spend: 'emission' };
  const rows = [];
  const k = new Kernel({ keys, sinks: { ffr: r => rows.push(r) } });
  await assert.rejects(k.load(defineComponent({ name: 'bad', inverses: ['ffr'], apply: noop })), /ill-typed: bad: an inverse touches emission key ffr/);
  await assert.rejects(k.load(defineComponent({ name: 'bad2', provides: ['spend'], apply: noop })), /provides emission key spend/);
  await assert.rejects(k.load(defineComponent({ name: 'bad3', emits: ['cache'], apply: noop })), /emits cache, which is not an emission key/);
  assert.equal(k.entries.size, 0, 'a refused spec is never registered');
  // Declared correctly, a runtime effect that names an emission key is still refused, and the component fails clean.
  await k.load(defineComponent({ name: 'sneaky', emits: ['ffr'], apply: ctx => ctx.effect(noop, noop, { keys: ['ffr'] }) }));
  assert.match(k.census()[0].status, /^failed: sneaky: ill-typed: an inverse touches emission key ffr/);
  const handles = [];
  await k.load(defineComponent({ name: 'emitter', emits: ['ffr'], apply(ctx) { handles.push(ctx); ctx.record('ffr', { n: 1 }); } }));
  const [first] = handles;
  first.record('ffr', { n: 2 }); // after apply: a row per evaluation is allowed while active
  assert.throws(() => first.record('spend', { n: 0 }), /records undeclared emission spend/);
  await k.reconfigure('emitter', {});
  assert.equal(handles.length, 2);
  assert.throws(() => first.record('ffr', { n: 3 }), /records ffr while inactive/, 'a stale ctx from an earlier activation is refused');
  await k.unload('emitter');
  assert.deepEqual(k.emissions.get('ffr').map(r => r.n), [1, 2, 1], 'unload and reconfigure never remove history');
  assert.deepEqual(rows.map(r => r.n), [1, 2, 1]);
  assert.ok(Object.isFrozen(rows[0]));
  assert.throws(() => new Kernel({ keys, sinks: { cache: noop } }), /sink cache: not an emission key/);
});

test('a failing apply unwinds its partial effects and is reported failed; ctx is closed after apply', async () => {
  const log = [];
  const k = new Kernel();
  let late;
  await k.load(defineComponent({
    name: 'f', provides: ['s'],
    async apply(ctx) {
      ctx.provide('s', 1);
      await ctx.effect(() => log.push('do'), () => log.push('undo'));
      throw new Error('boom');
    },
  }));
  assert.deepEqual(log, ['do', 'undo']);
  assert.deepEqual(k.census().map(r => r.status), ['failed: boom']);
  assert.equal(k.services.size, 0);
  await k.load(defineComponent({ name: 'g', apply(ctx) { late = ctx; } }));
  await assert.rejects(late.effect(noop, noop), /ctx.effect after apply returned/);
  await k.load(defineComponent({ name: 'h', provides: ['t'], apply: noop }));
  assert.match(k.census()[2].status, /failed: declared t but did not provide it/);
  await assert.rejects(k.load(defineComponent({ name: 'h2', provides: ['t'], apply: noop })), /t is already provided by h/);
  await k.dispose();
  assert.deepEqual(k.snapshot(), new Kernel().snapshot());
});

test('every inverse runs even when one throws, and the failure is surfaced', async () => {
  const log = [];
  const k = new Kernel();
  await k.load(defineComponent({
    name: 'a',
    async apply(ctx) {
      await ctx.effect(noop, () => log.push('u1'));
      await ctx.effect(noop, () => { throw new Error('u2 broke'); });
      await ctx.effect(noop, () => log.push('u3'));
    },
  }));
  await assert.rejects(k.unload('a'), /a: an inverse failed: u2 broke/);
  assert.deepEqual(log, ['u3', 'u1']);
});

test('plan: the dry plan gives activation order, names unsatisfied keys, separates missing from blocked, and lists type errors', () => {
  const s = (name, inject = [], provides = [], more = {}) => defineComponent({ name, inject, provides, apply: noop, ...more });
  const p = plan([s('b', ['x'], ['y']), s('a', [], ['x']), s('c', ['nope']), s('d', ['z'], ['w']), s('e', ['w'], ['z']), s('f', [], [], { inverses: ['ffr'] })], { ffr: 'emission' });
  assert.deepEqual(p.order, ['a', 'f', 'b']);
  assert.deepEqual(p.unsatisfied, { c: ['missing nope'], d: ['blocked z'], e: ['blocked w'] });
  assert.equal(p.illTyped.length, 1);
  assert.match(p.illTyped[0], /f: an inverse touches emission key ffr/);
});

// ----------------------------------------------------------------------------------------------- harness.json loader

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'harness-loader-'));
  const kernelUrl = pathToFileURL(join(process.cwd(), KERNEL)).href;
  mkdirSync(join(root, 'c'));
  writeFileSync(join(root, 'c/clock.mjs'), `import { defineComponent } from '${kernelUrl}';\nexport default defineComponent({ name: 'clock', provides: ['clock'], apply(ctx, c) { ctx.provide('clock', { now: () => c.t }); } });\n`);
  writeFileSync(join(root, 'c/user.mjs'), `import { defineComponent } from '${kernelUrl}';\nexport const user = defineComponent({ name: 'user', inject: ['clock', 'mlx'], emits: ['ffr'], apply(ctx) { ctx.record('ffr', { t: ctx.inject.clock.now() }); } });\n`);
  writeFileSync(join(root, 'c/bad.mjs'), `import { defineComponent } from '${kernelUrl}';\nexport default defineComponent({ name: 'bad', inverses: ['ffr'], apply() {} });\n`);
  return root;
}

test('parseHarness refuses malformed documents', () => {
  const ok = { schema: 'odin-rnd.harness.v1', components: [{ module: 'c/clock.mjs' }] };
  assert.equal(parseHarness(ok).components[0].export, 'default');
  for (const [doc, re] of [
    [{ ...ok, schema: 'x' }, /schema must be/],
    [{ ...ok, extra: 1 }, /unknown field\(s\) extra/],
    [{ ...ok, components: [] }, /non-empty array/],
    [{ ...ok, components: [{ module: '../x.mjs' }] }, /repo-relative \.mjs path/],
    [{ ...ok, components: [{ module: '/abs.mjs' }] }, /repo-relative \.mjs path/],
    [{ ...ok, keys: { ffr: 'history' } }, /key ffr has kind history/],
    [{ ...ok, log: '/tmp/x.jsonl' }, /log must be a relative path/],
  ]) assert.throws(() => parseHarness(doc), re);
});

test('loadHarness: dry plan, strict refusal naming the key, the lifecycle log, and ill-typed refusal', async t => {
  const root = fixtureRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const doc = {
    schema: 'odin-rnd.harness.v1', keys: { ffr: 'emission' }, log: 'harness-lifecycle.jsonl',
    components: [{ module: 'c/user.mjs', export: 'user' }, { module: 'c/clock.mjs', name: 'clock', config: { t: 5 } }],
  };
  writeFileSync(join(root, 'harness.json'), JSON.stringify(doc));
  const dry = await loadHarness(join(root, 'harness.json'), { dryRun: true });
  assert.deepEqual(dry, { plan: { order: ['clock'], unsatisfied: { user: ['missing mlx'] }, illTyped: [] } });
  assert.ok(!existsSync(join(root, 'harness-lifecycle.jsonl')), 'a dry plan applies nothing');
  await assert.rejects(loadHarness(join(root, 'harness.json'), { strict: true }), /unsatisfied: user \(missing mlx\)/);
  const { kernel } = await loadHarness(join(root, 'harness.json'));
  assert.deepEqual(kernel.census().map(r => r.status), ['inactive: missing mlx', 'active']);
  const lines = readFileSync(join(root, 'harness-lifecycle.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => `${l.op}:${l.component}`), ['load:user', 'load:clock', 'activate:clock']);
  writeFileSync(join(root, 'bad.json'), JSON.stringify({ ...doc, components: [{ module: 'c/bad.mjs' }] }));
  await assert.rejects(loadHarness(join(root, 'bad.json')), /ill-typed: bad: an inverse touches emission key ffr/);
  writeFileSync(join(root, 'misnamed.json'), JSON.stringify({ ...doc, components: [{ module: 'c/clock.mjs', name: 'timer' }] }));
  await assert.rejects(loadHarness(join(root, 'misnamed.json')), /is clock, harness.json says timer/);
});

// ------------------------------------------------------------------------------------- the residue property test

// Six synthetic components, each with a real side effect routed through ctx.effect: an env var, a file in a scratch
// root, a timer, a child process, a listener, and a write into a provided store. Each kernel gets its own "world"
// (scratch dir, env prefix, emitter), so a fresh kernel can run beside the long-lived one for the per-op comparison.
function makeWorld(id) {
  const dir = mkdtempSync(join(tmpdir(), `harness-world-${id}-`));
  return { id, dir, env: `HARNESS_KT_${id}_`, emitter: new EventEmitter(), pids: new Set(), timers: new Set() };
}
function specsFor(w) {
  const worldSpec = defineComponent({ name: 'world', provides: ['world'], apply(ctx) { ctx.provide('world', w); } });
  const base = defineComponent({
    name: 'base', inject: ['world'], provides: ['store'], inverses: ['env'],
    async apply(ctx, c) {
      ctx.provide('store', new Map());
      const key = `${w.env}BASE`;
      await ctx.effect(() => { process.env[key] = String(c.v); }, () => { delete process.env[key]; }, { keys: ['env'] });
    },
  });
  const files = defineComponent({
    name: 'files', inject: ['world', 'store'], inverses: ['fs'],
    async apply(ctx, c) {
      const p = join(w.dir, `files-${c.v}.txt`);
      await ctx.effect(() => writeFileSync(p, String(c.v)), () => unlinkSync(p), { keys: ['fs'] });
    },
  });
  const timer = defineComponent({
    name: 'timer', inject: ['store'], inverses: ['timers'],
    async apply(ctx) {
      let h;
      await ctx.effect(() => { h = setInterval(noop, 60_000); w.timers.add(h); }, () => { clearInterval(h); w.timers.delete(h); }, { keys: ['timers'] });
    },
  });
  const proc = defineComponent({
    name: 'proc', inject: ['world'], provides: ['worker'], inverses: ['pids'],
    async apply(ctx, c) {
      const child = await ctx.effect(() => new Promise((ok, fail) => {
        const ch = spawn('/bin/sleep', ['120'], { stdio: 'ignore' });
        ch.once('spawn', () => { w.pids.add(ch.pid); ok(ch); }).once('error', fail);
      }), () => new Promise(ok => {
        const ch = child;
        if (ch.exitCode !== null || ch.signalCode !== null) { w.pids.delete(ch.pid); ok(); return; }
        ch.once('exit', () => { w.pids.delete(ch.pid); ok(); });
        ch.kill('SIGKILL');
      }), { keys: ['pids'] });
      ctx.provide('worker', { pid: child.pid, v: c.v });
    },
  });
  const listener = defineComponent({
    name: 'listener', inject: ['worker'], inverses: ['listeners'],
    async apply(ctx) {
      const on = () => {};
      await ctx.effect(() => w.emitter.on('tick', on), () => w.emitter.off('tick', on), { keys: ['listeners'] });
    },
  });
  const memo = defineComponent({
    name: 'memo', inject: ['store', 'worker'], inverses: ['store'],
    async apply(ctx, c) {
      const { store, worker } = ctx.inject;
      const key = `memo:${c.v}:${worker.v}`;
      await ctx.effect(() => store.set(key, c.v), () => store.delete(key), { keys: ['store'] });
    },
  });
  return { world: worldSpec, pool: { base, files, timer, proc, listener, memo } };
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Everything a component could have left behind, relative to its world, plus the kernel's own snapshot. */
function observe(k, w) {
  const store = k.services.has('store') ? [...k.services.get('store').value.entries()].sort() : null;
  return {
    snapshot: k.snapshot(),
    files: readdirSync(w.dir).sort(),
    env: Object.keys(process.env).filter(e => e.startsWith(w.env)).map(e => `${e.slice(w.env.length)}=${process.env[e]}`).sort(),
    listeners: w.emitter.listenerCount('tick'),
    timers: w.timers.size,
    pids: [...w.pids].filter(alive).length,
    store,
  };
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const activeTimeouts = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
const CLEAN = { snapshot: new Kernel().snapshot(), files: [], env: [], listeners: 0, timers: 0, pids: 0, store: null };

test('teeth: a component that changes the world outside ctx.effect leaves residue the observation sees', async () => {
  const w = makeWorld('teeth');
  const { world } = specsFor(w);
  const k = new Kernel();
  await k.load(world);
  let h;
  await k.load(defineComponent({
    name: 'leaky', inject: ['world'],
    apply() { // every change here bypasses ctx.effect, so nothing can undo it
      process.env[`${w.env}LEAK`] = '1';
      writeFileSync(join(w.dir, 'leak.txt'), 'x');
      w.emitter.on('tick', noop);
      h = setInterval(noop, 60_000); w.timers.add(h);
    },
  }));
  await k.dispose();
  const seen = observe(k, w);
  assert.deepEqual(seen.snapshot, CLEAN.snapshot, 'the kernel itself is clean');
  assert.deepEqual({ files: seen.files, env: seen.env, listeners: seen.listeners, timers: seen.timers }, { files: ['leak.txt'], env: ['LEAK=1'], listeners: 1, timers: 1 });
  clearInterval(h);
  delete process.env[`${w.env}LEAK`];
  rmSync(w.dir, { recursive: true, force: true });
});

test('100 randomised load/unload/reconfigure cycles: after every op the kernel matches a fresh kernel with the same active set, and every cycle leaves zero residue', { timeout: 30 * 60_000 }, async () => {
  const baselineTimeouts = activeTimeouts();
  const baselineEnv = Object.keys(process.env).sort();
  const names = ['base', 'files', 'timer', 'proc', 'listener', 'memo'];
  let ops = 0, reconfigures = 0, comparisons = 0;
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const r = rng(0x9e3779b9 ^ cycle);
    const w = makeWorld(`L${cycle}`);
    const { world, pool } = specsFor(w);
    const k = new Kernel();
    await k.load(world);
    const loaded = new Map(); // name -> config, in load order
    const steps = 4 + Math.floor(r() * 6);
    for (let s = 0; s < steps; s += 1) {
      const name = names[Math.floor(r() * names.length)];
      const config = { v: Math.floor(r() * 3) };
      if (!loaded.has(name)) { await k.load(pool[name], config); loaded.set(name, config); }
      else if (r() < 0.5) { await k.reconfigure(name, config); loaded.set(name, config); reconfigures += 1; }
      else { await k.unload(name); loaded.delete(name); }
      ops += 1;
      // A fresh kernel, in its own world, loaded with the same components and configs in the same order.
      const fw = makeWorld(`F${cycle}x${s}`);
      const fresh = specsFor(fw);
      const fk = new Kernel();
      await fk.load(fresh.world);
      for (const [n, c] of loaded) await fk.load(fresh.pool[n], c);
      assert.deepEqual(observe(k, w), observe(fk, fw), `cycle ${cycle} step ${s}: the long-lived kernel diverged from a fresh one`);
      comparisons += 1;
      await fk.dispose();
      assert.deepEqual(observe(fk, fw), { snapshot: new Kernel().snapshot(), files: [], env: [], listeners: 0, timers: 0, pids: 0, store: null });
      rmSync(fw.dir, { recursive: true, force: true });
    }
    const pids = [...w.pids];
    await k.dispose();
    assert.deepEqual(observe(k, w), { snapshot: new Kernel().snapshot(), files: [], env: [], listeners: 0, timers: 0, pids: 0, store: null }, `cycle ${cycle}: residue after dispose`);
    for (const pid of pids) assert.ok(!alive(pid), `cycle ${cycle}: pid ${pid} survived`);
    assert.equal(k.services.size, 0);
    rmSync(w.dir, { recursive: true, force: true });
  }
  assert.equal(activeTimeouts(), baselineTimeouts, 'no timer outlived its kernel');
  assert.deepEqual(Object.keys(process.env).sort(), baselineEnv, 'no env var outlived its kernel');
  assert.ok(ops >= 400 && reconfigures >= 50 && comparisons === ops, `ops ${ops}, reconfigures ${reconfigures}`);
});
