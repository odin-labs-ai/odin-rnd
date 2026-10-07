// EXP 009 component `memo-cache`: decisions memoised by "<pin>:<item state sha256>". It injects `mlx`, so a pin swap
// (a reconfigure of mlx.model) withdraws it first and its keys go with it; a key of another pin is therefore residue.
// The map is created and cleared through ctx.effect.
import { defineComponent } from '../../../harness/kernel.mjs';

export default defineComponent({
  name: 'memo-cache',
  inject: ['mlx'],
  provides: ['memo'],
  inverses: ['memo-keys'],
  async apply(ctx, { maxEntries = 1000 } = {}) {
    const { pin } = ctx.inject.mlx;
    const map = new Map();
    await ctx.effect(() => {}, () => map.clear(), { keys: ['memo-keys'] });
    ctx.provide('memo', Object.freeze({
      key: stateSha256 => `${pin}:${stateSha256}`,
      get: key => map.get(key),
      set(key, value) {
        if (!key.startsWith(`${pin}:`)) throw new Error(`memo-cache: key ${key} is not of pin ${pin}`);
        map.set(key, value);
        while (map.size > maxEntries) map.delete(map.keys().next().value);
      },
      keys: () => [...map.keys()],
    }));
  },
});
