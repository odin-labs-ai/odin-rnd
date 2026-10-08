// EXP 009 component `yesno-gate`: EXP 008's frozen yes/no readout at stratum S (context = the item state, which is
// exactly EXP 008's S layout, rules + "\n\n" + diff), through mlx.model, memoised by memo-cache. p is rounded to 6
// decimals (the P1 comparison); REJECT when p >= readout.json's rejectThreshold.
// decide(item) -> { decision, p, cached }.
import { readFileSync } from 'node:fs';
import { defineComponent } from '../../../harness/kernel.mjs';

const READOUT = JSON.parse(readFileSync(new URL('../../latent-handoff/readout.json', import.meta.url), 'utf8'));
export const round6 = x => Number(x.toFixed(6));

export default defineComponent({
  name: 'yesno-gate',
  inject: ['mlx', 'memo'],
  provides: ['yesno'],
  apply(ctx) {
    const { mlx, memo } = ctx.inject;
    ctx.provide('yesno', Object.freeze({
      pin: mlx.pin,
      async decide(item) {
        const key = memo.key(item.stateSha256);
        const hit = memo.get(key);
        if (hit) return { ...hit, cached: true };
        const r = await mlx.eval(item.state);
        const p = round6(r.pYesBin);
        const out = { decision: p >= READOUT.rejectThreshold ? 'REJECT' : 'ACCEPT', p };
        memo.set(key, out);
        return { ...out, cached: false };
      },
    }));
  },
});
