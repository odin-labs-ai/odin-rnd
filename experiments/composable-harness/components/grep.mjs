// EXP 009 component `grep`: EXP 005's keyword grep baseline (scripts/jev-gate-heuristic-grep.mjs), imported as published.
// Pure: no runtime state, so it has no effect to undo. decide(item) -> { decision: 'REJECT' | 'ACCEPT' }.
import { defineComponent } from '../../../harness/kernel.mjs';
import { predict } from '../../../scripts/jev-gate-heuristic-grep.mjs';

export default defineComponent({
  name: 'grep',
  provides: ['grep'],
  apply(ctx) {
    ctx.provide('grep', Object.freeze({ decide: item => ({ decision: predict(item.state) ? 'REJECT' : 'ACCEPT' }) }));
  },
});
