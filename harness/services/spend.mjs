// Harness service `spend`: ONE experiment's own spend guard, never a merged one. `exp006` is EXP 006's SpendLedger6
// (the $60 cap, one line per paid call); `exp008` is EXP 008's spend8 (reserve/settle against the $100 cap). Their
// semantics stay theirs: this adapter imports them as published and only mirrors each ledger line it causes into the
// kernel's append-only `spend-line` emission. A ledger line is history: no inverse ever removes one.
import { resolve } from 'node:path';
import { defineComponent } from '../kernel.mjs';
import { SpendLedger6 } from '../../experiments/nina-changes/spend6.mjs';
import * as spend8 from '../../experiments/latent-handoff/spend8.mjs';

export const EXPERIMENTS = Object.freeze(['exp006', 'exp008']);

export default defineComponent({
  name: 'spend',
  provides: ['spend'],
  emits: ['spend-line'],
  apply(ctx, { experiment, ledger, mirror = null } = {}) {
    if (!EXPERIMENTS.includes(experiment)) throw new Error(`spend: experiment must be one of ${EXPERIMENTS.join(', ')}`);
    if (typeof ledger !== 'string' || !ledger) throw new Error('spend: a ledger path is required (no default ledger)');
    const path = resolve(ledger);
    const emit = row => ctx.record('spend-line', { experiment, ledger: path, ...row });
    if (experiment === 'exp006') {
      const l6 = new SpendLedger6(path);
      ctx.provide('spend', Object.freeze({
        experiment,
        check: (kind, opts) => l6.check(kind, opts),
        total: () => l6.total(),
        record: args => emit(l6.record(args)),
      }));
      return;
    }
    const opts = { ledger: path, mirror: mirror === null ? null : resolve(mirror) };
    // Every spend8 write is appended to the ledger; mirror the rows a call added, in order.
    const mirrored = async fn => {
      const before = spend8.readLedger(path).length;
      try { return await fn(); } finally { for (const row of spend8.readLedger(path).slice(before)) emit(row); }
    };
    ctx.provide('spend', Object.freeze({
      experiment,
      capUsd: spend8.CAP_USD,
      state: () => spend8.state(spend8.readLedger(path)),
      reserve: (upperUsd, bundle, label) => mirrored(() => spend8.reserve(upperUsd, bundle, label, opts)),
      settle: (rid, usd) => mirrored(() => spend8.settle(rid, usd, opts)),
      paid: (upperUsd, bundle, label, fn) => mirrored(() => spend8.paid(upperUsd, bundle, label, fn, opts)),
    }));
  },
});
