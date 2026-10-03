// EXP 009 component `lint`: EXP 005's line-regex linter (scripts/jev-gate-heuristic-lint.mjs), imported as published.
// Pure: no runtime state, so it has no effect to undo. decide(item) -> { decision: 'REJECT' | 'ACCEPT' }.
import { defineComponent } from '../../../harness/kernel.mjs';
import { predict } from '../../../scripts/jev-gate-heuristic-lint.mjs';

export default defineComponent({
  name: 'lint',
  provides: ['lint'],
  apply(ctx) {
    ctx.provide('lint', Object.freeze({ decide: item => ({ decision: predict(item.state) ? 'REJECT' : 'ACCEPT' }) }));
  },
});
