// Harness service `clock`: wall time (system, or a fixed clock that steps by stepMs per reading, for replays and
// tests), not-before checks against the published EXP 005 freeze times, and EXP 008's seeded per-item stream and arm
// permutation. Import-only: runner-guard.mjs and timing.mjs are used as published.
import { defineComponent } from '../kernel.mjs';
import { NOT_BEFORE, NOT_BEFORE_02 } from '../../experiments/jev-gate/runner-guard.mjs';
import { armOrder, rngFor } from '../../experiments/latent-handoff/timing.mjs';

export const PUBLISHED_NOT_BEFORE = Object.freeze({ 'exp005-amendment-01': NOT_BEFORE, 'exp005-amendment-02': NOT_BEFORE_02 });

export default defineComponent({
  name: 'clock',
  provides: ['clock'],
  apply(ctx, { mode = 'system', at = null, stepMs = 0, seed = null } = {}) {
    if (!['system', 'fixed'].includes(mode)) throw new Error(`clock mode ${mode} is not system|fixed`);
    if (mode === 'fixed' && !(typeof at === 'string' && Number.isFinite(Date.parse(at)))) throw new Error('a fixed clock needs an ISO `at`');
    let t = mode === 'fixed' ? Date.parse(at) : null;
    const now = () => {
      if (mode === 'system') return new Date();
      const d = new Date(t);
      t += stepMs;
      return d;
    };
    ctx.provide('clock', Object.freeze({
      mode,
      now,
      iso: () => now().toISOString(),
      /** True once `when` (an ISO time, or a PUBLISHED_NOT_BEFORE name) has passed. */
      notBefore(when) {
        const iso = PUBLISHED_NOT_BEFORE[when] ?? when;
        if (!Number.isFinite(Date.parse(iso))) throw new Error(`not-before ${when} is not a time`);
        return now().getTime() >= Date.parse(iso);
      },
      rng: itemId => { if (seed === null) throw new Error('clock: no seed configured'); return rngFor(seed, itemId); },
      armOrder: (arms, itemId) => { if (seed === null) throw new Error('clock: no seed configured'); return armOrder(arms, seed, itemId); },
    }));
  },
});
