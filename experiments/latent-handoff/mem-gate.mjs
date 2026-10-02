// EXP 008 (latent-handoff) memory gate, bundle 3 WO-06.
//
// Checked before every invocation AND before every item. It proceeds only when ALL six hold:
//   1. free     `memory_pressure | tail -1` reports system-wide free >= 50% (the founder's rule);
//   2. headroom available memory >= the practice peak + 16 GB;
//   3. swap     no swap growth since the previous reading (`sysctl vm.swapusage`, used MB);
//   4. server   no resident `mlx_lm.server`, plain or as the WO-08 served.py wrapper (`pgrep -f` finds nothing);
//   5. load     1-minute load average below the frozen bound (timed runs only: an untimed computation such as a
//               download, a conversion or a calibration pass passes `untimed`, because load only distorts timings);
//   6. pair     the pair's footprint (footprints.json: max of weights and measured peak) <= its bound: 24 GB, or a
//               pair's own measured bound (D1' only: 48 GB, see footprints.json).
// Otherwise it WAITS, with backoff 30 s -> 10 min, and logs each wait. It never stops, re-prioritises or otherwise touches
// another process: the only commands it runs are the three read-only readers above (a static test asserts this).
//
// Every reader is injectable, so the tests drive each failing condition with stubs.
//
//   node experiments/latent-handoff/mem-gate.mjs --check [--peak-gb N] [--footprint-gb N]   exit 0 clear, 4 not clear
//   node experiments/latent-handoff/mem-gate.mjs --wait  [--peak-gb N] [--footprint-gb N] [--untimed]   waits until clear
import { spawnSync } from 'node:child_process';
import { loadavg, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const GATE = Object.freeze({
  minFreePct: 50,
  headroomGB: 16,
  maxLoad1: 12, // frozen bound for the 1-minute load average: two thirds of the Mac's 18 cores
  // The design bound. A pair may carry its own measured bound in footprints.json (boundGB): only D1' does (48 GB),
  // which callers pass as --max-footprint-gb.
  maxFootprintGB: 24,
  backoffStartMs: 30_000,
  backoffMaxMs: 600_000,
  swapBaselineMs: 5_000, // with no previous reading, swap growth is measured over this baseline interval
});

export const SERVER_PATTERN = 'mlx_lm[.]server|latent-handoff/served[.]py';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '' };
};

export function parseMemoryPressure(text) {
  const m = /System-wide memory free percentage:\s*(\d+)%/.exec(text);
  if (!m) throw new Error('memory_pressure output has no free percentage line');
  return Number(m[1]);
}

export function parseSwapUsage(text) {
  const m = /used\s*=\s*([\d.]+)([MG])/.exec(text);
  if (!m) throw new Error('vm.swapusage output has no used= field');
  return Number(m[1]) * (m[2] === 'G' ? 1024 : 1);
}

export const defaultReaders = Object.freeze({
  freePct: () => parseMemoryPressure(run('memory_pressure', []).stdout),
  totalGB: () => totalmem() / 2 ** 30,
  swapUsedMB: () => parseSwapUsage(run('sysctl', ['vm.swapusage']).stdout),
  // pgrep exits 1 when nothing matches; that is the "clear" answer.
  mlxServerPids: () => run('pgrep', ['-f', SERVER_PATTERN]).stdout.split('\n').filter(Boolean),
  load1: () => loadavg()[0],
});

/** One reading of every input. Pure given the readers. */
export function read(readers = defaultReaders) {
  const freePct = readers.freePct();
  const totalGB = readers.totalGB();
  return {
    ts: new Date().toISOString(),
    freePct,
    availableGB: Number(((totalGB * freePct) / 100).toFixed(2)),
    swapUsedMB: readers.swapUsedMB(),
    mlxServerPids: readers.mlxServerPids(),
    load1: Number(readers.load1().toFixed(2)),
  };
}

/**
 * Judge one reading. `prev` is the previous reading (swap growth is measured against it); `peakGB` is the practice
 * peak, `footprintGB` the pair footprint. Returns { ok, failures[], readings }.
 */
export function judge(readings, { prev = null, peakGB = 0, footprintGB = 0, gate = GATE, untimed = false, ownGB = 0 } = {}) {
  const failures = [];
  // ownGB: memory the CALLING run itself holds (a resumable run checking between its own segments). It is added
  // back, so a run never waits on itself; a fresh invocation passes 0 and is judged on the raw reading.
  const totalGB = readings.availableGB / Math.max(readings.freePct, 1e-9) * 100;
  const freePct = ownGB > 0 ? Math.min(100, readings.freePct + (ownGB / totalGB) * 100) : readings.freePct;
  const availableGB = readings.availableGB + ownGB;
  if (!(freePct >= gate.minFreePct)) failures.push(`free ${Number(freePct.toFixed(1))}% < ${gate.minFreePct}%${ownGB > 0 ? ` (own ${ownGB} GB added back)` : ''}`);
  if (!(availableGB >= peakGB + gate.headroomGB)) {
    failures.push(`available ${availableGB} GB < peak ${peakGB} + ${gate.headroomGB} GB`);
  }
  if (prev && readings.swapUsedMB > prev.swapUsedMB) {
    failures.push(`swap grew ${prev.swapUsedMB} -> ${readings.swapUsedMB} MB`);
  }
  if (readings.mlxServerPids.length > 0) failures.push(`mlx_lm.server resident (${readings.mlxServerPids.length})`);
  if (!untimed && !(readings.load1 < gate.maxLoad1)) failures.push(`load1 ${readings.load1} >= ${gate.maxLoad1}`);
  if (!(footprintGB <= gate.maxFootprintGB)) failures.push(`pair footprint ${footprintGB} GB > ${gate.maxFootprintGB} GB`);
  return { ok: failures.length === 0, failures, readings };
}

/**
 * Wait until the gate is clear. Never acts on another process: it reads, logs, sleeps and reads again.
 * `sleep` and `log` are injectable; `maxWaits` bounds the loop for tests (Infinity in real runs).
 */
export async function waitUntilClear({
  readers = defaultReaders, peakGB = 0, footprintGB = 0, prev = null, gate = GATE, untimed = false,
  sleep = ms => new Promise(r => setTimeout(r, ms)), log = line => process.stderr.write(`${line}\n`),
  maxWaits = Infinity,
} = {}) {
  let delay = gate.backoffStartMs;
  let waits = 0;
  let last = prev;
  if (!last) {
    last = read(readers);
    await sleep(gate.swapBaselineMs);
  }
  for (;;) {
    const verdict = judge(read(readers), { prev: last, peakGB, footprintGB, gate, untimed });
    if (verdict.ok) return { ...verdict, waits };
    if (waits >= maxWaits) return { ...verdict, waits, gaveUp: true };
    log(`mem-gate WAIT ${Math.round(delay / 1000)}s: ${verdict.failures.join('; ')}`);
    waits += 1;
    last = verdict.readings;
    await sleep(delay);
    delay = Math.min(delay * 2, gate.backoffMaxMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const num = flag => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : 0);
  const opts = { peakGB: num('--peak-gb'), footprintGB: num('--footprint-gb'), untimed: args.includes('--untimed'), ownGB: num('--own-gb') };
  if (args.includes('--max-footprint-gb')) opts.gate = { ...GATE, maxFootprintGB: num('--max-footprint-gb') };
  if (args.includes('--wait')) {
    const v = await waitUntilClear(opts);
    process.stdout.write(`${JSON.stringify(v)}\n`);
    process.exit(v.ok ? 0 : 4);
  }
  if (!args.includes('--check')) {
    process.stderr.write('usage: mem-gate.mjs --check|--wait [--peak-gb N] [--footprint-gb N]\n');
    process.exit(2);
  }
  const v = judge(read(), opts);
  process.stdout.write(`${JSON.stringify(v)}\n`);
  process.exit(v.ok ? 0 : 4);
}
