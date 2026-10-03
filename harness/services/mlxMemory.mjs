// Harness service `mlxMemory`: EXP 008's memory gate (free %, headroom, swap growth, no resident mlx_lm.server, load,
// pair footprint). Import-only: mem-gate.mjs is used as published; it only reads (memory_pressure, sysctl, pgrep).
// `stub` replaces the readers with fixed readings (tests, replays); it never touches the host.
import { defineComponent } from '../kernel.mjs';
import { GATE, defaultReaders, judge, read, waitUntilClear } from '../../experiments/latent-handoff/mem-gate.mjs';

const stubReaders = s => Object.freeze({
  freePct: () => s.freePct, totalGB: () => s.totalGB, swapUsedMB: () => s.swapUsedMB, mlxServerPids: () => [...(s.mlxServerPids ?? [])], load1: () => s.load1,
});

export default defineComponent({
  name: 'mlxMemory',
  provides: ['mlxMemory'],
  apply(ctx, { stub = null, gate = {} } = {}) {
    if (stub !== null) for (const f of ['freePct', 'totalGB', 'swapUsedMB', 'load1']) if (!Number.isFinite(stub[f])) throw new Error(`mlxMemory stub: ${f} must be a number`);
    const readers = stub === null ? defaultReaders : stubReaders(stub);
    const g = Object.freeze({ ...GATE, ...gate });
    ctx.provide('mlxMemory', Object.freeze({
      gate: g,
      read: () => read(readers),
      judge: (readings, opts = {}) => judge(readings, { gate: g, ...opts }),
      check: (opts = {}) => judge(read(readers), { gate: g, ...opts }),
      waitUntilClear: (opts = {}) => waitUntilClear({ readers, gate: g, ...opts }),
    }));
  },
});
