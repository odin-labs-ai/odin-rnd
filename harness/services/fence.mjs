// Harness service `fence`: EXP 006's reviewer fence (fence6) and its offline model of how the client decides a Bash
// command. Import-only: fence6.mjs is used as published.
import { defineComponent } from '../kernel.mjs';
import { FENCE6_SETTINGS, ISOLATION6, WS_REPO, decideFence5, decideFence6, fence6Tools } from '../../experiments/nina-changes/fence6.mjs';

export default defineComponent({
  name: 'fence',
  provides: ['fence'],
  apply(ctx, { variant = ISOLATION6 } = {}) {
    if (variant !== 'fence6' && variant !== 'fence5') throw new Error(`fence: variant ${variant} is not fence6|fence5`);
    ctx.provide('fence', Object.freeze({
      variant,
      settings: FENCE6_SETTINGS,
      tools: repo => fence6Tools(repo),
      decide: (command, repo = WS_REPO) => (variant === 'fence6' ? decideFence6(command, repo) : decideFence5(command)),
    }));
  },
});
