// EXP 009 component `mlx.model`: one MLX model in a child process this component spawns and owns (mlx_gate.py).
//
// Every runtime change goes through ctx.effect: the child (undo: SIGKILL its OWN pid, then wait for its exit), and the
// mirror of its prefix-cache keys (undo: clear). A reconfigure (a pin swap) therefore kills the child, drops every
// key of the old pin, and starts a fresh child under the new one. The memory gate (mlxMemory) is checked before the
// child starts. The service:
//   eval(state)  -> { pin, prefixKey, cached, lpYes, lpNo, pYesBin }   (EXP 008's readout, in the child)
//   prefixKeys() -> the mirrored keys, "<pin>:<sha256>", in insertion order
//   memory()     -> the child's mx.get_active_memory() in bytes
// `command` replaces the child's argv (tests run a fake child that speaks the same protocol, with no MLX).
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineComponent } from '../../../harness/kernel.mjs';

const GATE_PY = fileURLToPath(new URL('./mlx_gate.py', import.meta.url));
const PYTHON = process.env.LH_PYTHON || join(homedir(), 'ai-env', 'bin', 'python');

/** A line-protocol child: send(obj) resolves with the next reply line, in order. */
function lineChild(argv) {
  return new Promise((ok, fail) => {
    const ch = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    const waiting = [];
    let buf = '', stderr = '', ready = false;
    ch.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    ch.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!ready) { ready = true; ok({ ch, hello: msg, send }); continue; }
        waiting.shift()?.ok(msg);
      }
    });
    ch.once('error', fail);
    ch.once('exit', (code, sig) => {
      const err = new Error(`mlx child exited (${code ?? sig}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
      if (!ready) fail(err);
      for (const w of waiting.splice(0)) w.fail(err);
    });
    function send(obj) {
      return new Promise((resolve, reject) => {
        waiting.push({ ok: resolve, fail: reject });
        ch.stdin.write(`${JSON.stringify(obj)}\n`);
      });
    }
  });
}

const killOwn = ch => new Promise(ok => {
  if (ch.exitCode !== null || ch.signalCode !== null) { ok(); return; }
  ch.once('exit', () => ok());
  ch.kill('SIGKILL');
});

export default defineComponent({
  name: 'mlx.model',
  inject: ['mlxMemory'],
  provides: ['mlx'],
  inverses: ['mlx-child', 'prefix-keys'],
  async apply(ctx, { modelKey, modelDir = null, command = null, prefixCache = 8, untimed = false } = {}) {
    if (typeof modelKey !== 'string' || !modelKey) throw new Error('mlx.model: modelKey is required');
    if (command === null && typeof modelDir !== 'string') throw new Error('mlx.model: modelDir is required');
    const gate = ctx.inject.mlxMemory.check({ untimed });
    if (!gate.ok) throw new Error(`memory gate not clear: ${gate.failures.join('; ')}`);
    // A committed config never names a local home path: "<cache>/…" is ~/.cache/odin-rnd/… on the running machine.
    const dir = modelDir?.replace(/^<cache>\//, `${join(homedir(), '.cache', 'odin-rnd')}/`);
    const argv = command ?? [PYTHON, GATE_PY, '--model-dir', dir, '--model-key', modelKey, '--prefix-cache', String(prefixCache)];
    let child = null;
    const proc = await ctx.effect(async () => (child = await lineChild(argv)), () => killOwn(child.ch), { keys: ['mlx-child'] });
    if (proc.hello.pin !== modelKey) throw new Error(`mlx child serves ${proc.hello.pin}, configured ${modelKey}`);
    const keys = new Set();
    await ctx.effect(() => {}, () => keys.clear(), { keys: ['prefix-keys'] });
    const call = async req => {
      const r = await proc.send(req);
      if (!r.ok) throw new Error(`mlx child: ${r.error}`);
      return r;
    };
    ctx.provide('mlx', Object.freeze({
      pin: modelKey,
      pid: proc.ch.pid,
      async eval(state) {
        const { ok, ...r } = await call({ op: 'eval', state });
        // The mirror follows the child's LRU exactly: a hit moves the key to the end, the oldest past N is dropped.
        keys.delete(r.prefixKey);
        keys.add(r.prefixKey);
        while (keys.size > prefixCache) keys.delete(keys.values().next().value);
        return r;
      },
      prefixKeys: () => [...keys],
      childPrefixKeys: async () => (await call({ op: 'keys' })).prefixKeys,
      memory: async () => (await call({ op: 'memory' })).activeBytes,
    }));
  },
});
