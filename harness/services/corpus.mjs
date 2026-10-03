// Harness service `corpus`: the label-free gate states of EXP 005 (inputs.json, 60 items) and EXP 008-X
// (corpus-x.json, 140 items), each asserted by its committed sha256 before it is served. State construction is
// EXP 005's own exported buildState (rules.txt + "\n\n" + diff). Labels are never read: no labels file is opened here.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineComponent } from '../kernel.mjs';
import { INPUTS, RULES_FILE, buildState } from '../../experiments/jev-gate/gate-input.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const X_DIR = new URL('../../experiments/latent-handoff/corpus-x/', import.meta.url).pathname;
export const SETS = Object.freeze(['exp005', 'exp008x']);

function exp005() {
  const inputs = JSON.parse(readFileSync(INPUTS, 'utf8'));
  return inputs.items.map(it => ({ set: 'exp005', id: it.id, state: it.state, stateSha256: it.stateSha256 }));
}
function exp008x(rules) {
  const index = JSON.parse(readFileSync(join(X_DIR, 'corpus-x.json'), 'utf8'));
  return index.items.map(it => {
    const patch = readFileSync(join(X_DIR, 'corpus', `${it.id}.patch`), 'utf8');
    if (sha256(patch) !== it.patchSha256) throw new Error(`corpus exp008x/${it.id}: patch sha256 differs from corpus-x.json`);
    return { set: 'exp008x', id: it.id, state: buildState(rules, patch), stateSha256: it.stateSha256 };
  });
}

export default defineComponent({
  name: 'corpus',
  provides: ['corpus'],
  apply(ctx, { sets = SETS } = {}) {
    for (const s of sets) if (!SETS.includes(s)) throw new Error(`corpus: unknown set ${s}`);
    const rules = readFileSync(RULES_FILE, 'utf8');
    const items = [...(sets.includes('exp005') ? exp005() : []), ...(sets.includes('exp008x') ? exp008x(rules) : [])];
    for (const it of items) if (sha256(it.state) !== it.stateSha256) throw new Error(`corpus ${it.set}/${it.id}: state sha256 differs from its record`);
    const ids = new Set(items.map(i => i.id));
    if (ids.size !== items.length) throw new Error('corpus: duplicate item id across sets');
    const frozen = Object.freeze(items.map(i => Object.freeze(i)));
    ctx.provide('corpus', Object.freeze({
      items: frozen,
      /** sha256 over the ordered (set, id, stateSha256) triples: the corpus identity a prereg asserts. */
      sha256: sha256(frozen.map(i => `${i.set}\t${i.id}\t${i.stateSha256}\n`).join('')),
      get: id => frozen.find(i => i.id === id) ?? null,
    }));
  },
});
