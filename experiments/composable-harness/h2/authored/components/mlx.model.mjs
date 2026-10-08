import { spawn } from 'node:child_process';

function startChild(server) {
  const child = spawn(server.command, server.args, {
    shell: false,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...(server.env || {}) },
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (err) => resolve({ code: null, signal: null, err }));
  });
  return { child, exited };
}

function isAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function killAndWait(child, exited, timers) {
  if (isAlive(child)) {
    child.kill('SIGTERM');
    const t = setTimeout(() => {
      if (isAlive(child)) child.kill('SIGKILL');
    }, 2000);
    timers.add(t);
    await exited;
    clearTimeout(t);
    timers.delete(t);
  } else {
    await exited;
  }
}

const sleep = (ms, timers) =>
  new Promise((resolve) => {
    const t = setTimeout(() => {
      timers.delete(t);
      resolve();
    }, ms);
    timers.add(t);
  });

export default {
  name: 'mlx.model',
  needs: [],
  provides: ['model'],
  async register(reg, config) {
    const { pin, server, readyPath, readyTimeoutMs } = config;
    const base = `http://127.0.0.1:${server.port}`;
    const timers = new Set();
    const { child, exited } = startChild(server);

    // Poll readiness.
    const deadline = Date.now() + readyTimeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      if (!isAlive(child)) break;
      try {
        const ac = new AbortController();
        const remaining = Math.max(1, deadline - Date.now());
        const at = setTimeout(() => ac.abort(), Math.min(1000, remaining));
        timers.add(at);
        try {
          const res = await fetch(base + readyPath, { signal: ac.signal });
          await res.arrayBuffer().catch(() => {});
          if (res.status === 200) {
            ready = true;
            break;
          }
        } finally {
          clearTimeout(at);
          timers.delete(at);
        }
      } catch {
        // not up yet
      }
      await sleep(50, timers);
    }
    if (!ready) {
      await killAndWait(child, exited, timers);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      throw new Error(`mlx.model: server not ready at ${base}${readyPath} within ${readyTimeoutMs}ms`);
    }

    const prefixCache = new Map();
    const keyFor = (prompt) => pin + '\u0000' + String(prompt).slice(0, 64);
    const service = {
      pin,
      async complete(prompt, opts) {
        const key = keyFor(prompt);
        if (prefixCache.has(key)) return prefixCache.get(key);
        const res = await fetch(base + '/v1/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt, ...(opts || {}) }),
        });
        if (!res.ok) throw new Error(`mlx.model: completion HTTP ${res.status}`);
        const body = await res.json();
        prefixCache.set(key, body);
        return body;
      },
      prefixKeys() {
        return [...prefixCache.keys()];
      },
    };
    reg.provide('model', service);
    return { child, exited, prefixCache, timers };
  },
  async unregister(reg, handle) {
    reg.withdraw('model');
    handle.prefixCache.clear();
    await killAndWait(handle.child, handle.exited, handle.timers);
    for (const t of handle.timers) clearTimeout(t);
    handle.timers.clear();
  },
};
