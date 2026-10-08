// EXP 009 component `spend-counter`: a stub with no network access. It counts local evaluations per kind; local MLX
// compute has no metered price, so every charge is costUsd null with the reason `local-unpriced` (zero never means
// unknown). The counts are runtime state, created and cleared through ctx.effect.
import { defineComponent } from '../../../harness/kernel.mjs';

export default defineComponent({
  name: 'spend-counter',
  provides: ['spend-counter'],
  inverses: ['spend-counts'],
  async apply(ctx) {
    const counts = new Map();
    await ctx.effect(() => {}, () => counts.clear(), { keys: ['spend-counts'] });
    ctx.provide('spend-counter', Object.freeze({
      charge(kind) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        return { kind, costUsd: null, reason: 'local-unpriced' };
      },
      counts: () => Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1))),
    }));
  },
});
