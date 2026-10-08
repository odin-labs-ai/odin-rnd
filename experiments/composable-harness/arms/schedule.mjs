// EXP 009 seeded schedule generator. One trial = OPS operations (load / unload / reconfigure, at least RECONFIGURE_SHARE
// of them reconfigures, pin swaps included) with EVALS evaluations interleaved. Everything is a pure function of
// (seed, trial): the counted run's seed is sha256 of the prereg merge commit; practice runs use practice seeds only.
import { createHash } from 'node:crypto';

export const SHAPE = Object.freeze({ ops: 20, evals: 40, reconfigureShare: 0.25 });
// The schedulable components and their order come from harness.json (arms/harness-set.mjs).
import { COMPONENTS } from './harness-set.mjs';
export { COMPONENTS };

/** sha256-counter stream: a reproducible uniform [0, 1) sequence for (seed, label). */
export function stream(seed, label) {
  let n = 0;
  return () => {
    const h = createHash('sha256').update(`${seed}\n${label}\n${n++}`).digest();
    return h.readUIntBE(0, 6) / 2 ** 48;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

/** A config for a component; mlx.model alternates between the two pins (a reconfigure to the other pin is a pin swap). */
function configFor(name, r, pins) {
  if (name === 'mlx.model') return { pin: pick(r, pins) };
  if (name === 'memo-cache') return { maxEntries: pick(r, [64, 256]) };
  return {};
}

/**
 * The steps of one trial: [{ kind: 'op', op: 'load'|'unload'|'reconfigure', name, config?, pinSwap? } |
 * { kind: 'eval', item }]. `state` is the loaded set entering the trial ({ name: config }), which the trial updates; a
 * schedule is generated against it so every op is valid (load only what is unloaded, etc.).
 */
export function trial({ seed, index, items, pins, state = {}, shape = SHAPE }) {
  const r = stream(seed, `trial-${index}`);
  const loaded = new Map(Object.entries(state));
  // At least ceil(ops x share) reconfigures by construction: one is forced whenever the slots left equal the
  // reconfigures still owed, and the last loaded component is never unloaded while one is owed (a reconfigure needs a
  // loaded component; an empty entering set gets its first load in slot 0, before anything is owed against it).
  let owed = Math.ceil(shape.ops * shape.reconfigureShare);
  const ops = [];
  for (let slot = 0; slot < shape.ops; slot += 1) {
    const left = shape.ops - slot;
    const reconf = loaded.size > 0 && (owed >= left || r() < owed / left);
    if (reconf) {
      owed = Math.max(0, owed - 1);
      const name = loaded.has('mlx.model') && r() < 0.5 ? 'mlx.model' : pick(r, [...loaded.keys()].sort());
      const prev = loaded.get(name);
      const config = name === 'mlx.model' ? { pin: pins.find(p => p !== prev.pin) ?? prev.pin } : configFor(name, r, pins);
      loaded.set(name, config);
      ops.push({ kind: 'op', op: 'reconfigure', name, config, pinSwap: name === 'mlx.model' && config.pin !== prev.pin });
    } else if ((loaded.size > 1 || (loaded.size === 1 && owed < left - 1)) && (loaded.size === COMPONENTS.length || r() < 0.4)) {
      const name = pick(r, [...loaded.keys()].sort());
      loaded.delete(name);
      ops.push({ kind: 'op', op: 'unload', name });
    } else {
      const name = pick(r, COMPONENTS.filter(c => !loaded.has(c)));
      const config = configFor(name, r, pins);
      loaded.set(name, config);
      ops.push({ kind: 'op', op: 'load', name, config });
    }
  }
  const evals = Array.from({ length: shape.evals }, () => ({ kind: 'eval', item: pick(r, items) }));
  // Interleave: a seeded merge that keeps each list's order.
  const steps = [];
  let o = 0, e = 0;
  while (o < ops.length || e < evals.length) {
    const takeOp = e >= evals.length || (o < ops.length && r() < (ops.length - o) / (ops.length - o + evals.length - e));
    steps.push(takeOp ? ops[o++] : evals[e++]);
  }
  return { steps, state: Object.fromEntries(loaded) };
}

/**
 * A run's schedule: `trials` trials, each starting from the state the previous one left (one long-lived kernel).
 * `startState` is the loaded set entering each trial ({ name: config }, in load order), which H2 registers first.
 */
export function schedule({ seed, trials, items, pins, shape = SHAPE }) {
  const out = [];
  let state = {};
  for (let i = 0; i < trials; i += 1) {
    const t = trial({ seed, index: i, items, pins, state, shape });
    out.push({ index: i, steps: t.steps, startState: state });
    state = t.state;
  }
  return out;
}
