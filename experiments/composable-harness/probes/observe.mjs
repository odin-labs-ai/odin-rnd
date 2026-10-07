// EXP 009 observation set O: what the probes read, and how it is serialised. The spec, with its sha256 in the
// pre-registration's file map, is observation-set.json; this module implements exactly the probes it lists and
// observe.test asserts the two agree. Adding a probe after the prereg freezes needs a dated amendment.
//
// Serialisation: plain JSON with sorted keys; counts and sorted names only, never a pid, a path outside the scratch
// root, or a time. Two identical runs therefore serialise byte-identically. `residue(before, after)` lists every
// probe whose value differs (mx active memory within its frozen tolerance).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const SPEC = JSON.parse(readFileSync(new URL('./observation-set.json', import.meta.url), 'utf8'));
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return e.stdout ?? ''; } };
const countBy = xs => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort(([a], [b]) => (a < b ? -1 : 1)));
const sortKeys = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : Array.isArray(v) ? v.map(sortKeys) : v);

/**
 * Once per observer process, before its first observation: create and fully release one of each lazily initialised
 * process-wide facility (a child process, a worker thread, an fs watcher, a listening server). Node allocates some
 * machinery on first use and keeps it for the life of the process (the SIGCHLD signal pipe, say); without the warm-up
 * that one-time allocation would be counted as the residue of whichever component happened to use it first. Each warm-up
 * object is closed again, so anything it left beyond that machinery would still show.
 */
let warmed = null;
export function warmUp() {
  warmed ??= (async () => {
    await new Promise((ok, fail) => { const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); c.once('exit', ok).once('error', fail); });
    await new Promise(ok => { const w = new Worker('', { eval: true }); w.once('exit', ok); });
    const d = mkdtempSync(join(tmpdir(), 'exp009-warm-'));
    watch(d).close();
    rmSync(d, { recursive: true, force: true });
    await new Promise(ok => { const s = createServer(); s.listen(0, '127.0.0.1', () => s.close(ok)); });
  })();
  return warmed;
}

/** The pin a cache key carries ("<pin>:<sha>"). */
const pinOf = key => key.slice(0, key.lastIndexOf(':'));

/**
 * Inside the boundary: what the kernel and its services hold. `kernel` is the harness kernel; `world` is the
 * observer's context: { scratch } (the run's scratch root) and { baseGlobals } (globalThis keys at start).
 */
export function inside(kernel, world) {
  const has = k => kernel.services.has(k);
  const mlxPin = has('mlx') ? kernel.service('mlx').pin : null;
  const prefixKeys = has('mlx') ? kernel.service('mlx').prefixKeys() : [];
  const memoKeys = has('memo') ? kernel.service('memo').keys() : [];
  const stale = keys => keys.filter(k => pinOf(k) !== mlxPin).length;
  return {
    registry: kernel.snapshot(),
    pins: { mlx: mlxPin, prefixKeyPins: [...new Set(prefixKeys.map(pinOf))].sort(), memoKeyPins: [...new Set(memoKeys.map(pinOf))].sort() },
    staleKeys: { prefix: stale(prefixKeys), memo: stale(memoKeys) },
    listeners: Object.fromEntries(SPEC.inside.listeners.events.map(e => [e, process.listenerCount(e)])),
    timers: process.getActiveResourcesInfo().filter(r => SPEC.inside.timers.types.includes(r)).length,
    env: Object.keys(process.env).filter(k => SPEC.inside.env.prefixes.some(p => k.startsWith(p))).sort(),
    globals: Object.keys(globalThis).filter(k => !world.baseGlobals.includes(k)).sort(),
  };
}

/** Outside the boundary: what the operating system sees of this process and its descendants. */
export async function outside(kernel, world) {
  const children = run('pgrep', ['-P', String(process.pid)]).split('\n').filter(Boolean)
    .filter(pid => !run('ps', ['-o', 'command=', '-p', pid]).includes(' ps -o')); // never count the probe's own ps
  const lsof = run('lsof', ['-a', '-p', String(process.pid), '-d', '0-9999', '-F', 't']).split('\n').filter(l => l.startsWith('t')).map(l => l.slice(1));
  // Marked processes that are this process's own children, or orphans (re-parented to pid 1): another process's live
  // harness children (a concurrent test, another lane) are not this observer's residue.
  const markedRe = new RegExp(SPEC.outside.markedProcesses.pattern);
  const marker = run('ps', ['-A', '-o', 'pid=,ppid=,command=']).split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .filter(([, , ppid, cmd]) => (ppid === String(process.pid) || ppid === '1') && markedRe.test(cmd));
  let mxActiveBytes = null;
  if (kernel.services.has('mlx')) mxActiveBytes = await kernel.service('mlx').memory();
  return {
    handles: countBy(process._getActiveHandles().map(h => h?.constructor?.name ?? typeof h)),
    childPids: children.length,
    markedProcesses: marker.length,
    fds: countBy(lsof),
    mxActiveBytes,
    scratch: existsSync(world.scratch) ? readdirSync(world.scratch).sort() : null,
  };
}

/**
 * Quiesce before reading: Node releases a closed handle a few event-loop turns after its 'exit' / 'close' event (a
 * child's process handle and pipes, a server, a watcher). The observer advances the loop one turn at a time until the
 * active-handle set is unchanged for two consecutive turns (at most SPEC.quiesce.maxTurns). It waits on loop turns,
 * never on wall time; a real leak is a handle that stays, so it is never settled away.
 */
const handleSet = () => process._getActiveHandles().map(h => h?.constructor?.name ?? typeof h).sort().join(',');
export async function quiesce(maxTurns = SPEC.quiesce.maxTurns) {
  let prev = handleSet(), stable = 0;
  for (let turn = 0; turn < maxTurns && stable < 2; turn += 1) {
    await new Promise(r => setImmediate(r));
    const cur = handleSet();
    stable = cur === prev ? stable + 1 : 0;
    prev = cur;
  }
}

/** The whole observation, serialised canonically (sorted keys), taken at quiescence. */
export async function observe(kernel, world) {
  await quiesce();
  return sortKeys({ inside: inside(kernel, world), outside: await outside(kernel, world) });
}
export const serialise = obs => `${JSON.stringify(sortKeys(obs))}\n`;

/** Every probe path whose value differs between two observations; mx memory compares within SPEC tolerance. */
export function residue(before, after) {
  const out = [];
  const tol = SPEC.outside.mxActiveBytes.toleranceBytes;
  const walk = (a, b, path) => {
    if (path === 'outside.mxActiveBytes') {
      if ((a === null) !== (b === null) || (a !== null && Math.abs(a - b) > tol)) out.push(path);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path);
  };
  walk(before, after, '');
  return out;
}

/** Validity of the caches alone: a key of a pin other than the current mlx pin is residue of an earlier pin. */
export const staleResidue = obs => Object.entries(obs.inside.staleKeys).filter(([, n]) => n > 0).map(([k]) => `inside.staleKeys.${k}`);
