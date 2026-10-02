// EXP 008-X, WO-03: the EXP 005 model-free baselines, run unchanged on the 140 new items.
// predict() is imported from the EXP 005 baseline scripts (they import without side effects: their CLI runs only
// when executed directly). Each predict sees exactly the gate state, rules.txt + "\n\n" + the patch; labels-x.json is
// read only afterwards, to score. Nothing here tunes items; it reports.
//
//   node experiments/latent-handoff/corpus-x/baselines-x.mjs [--json]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { predict as grep } from '../../../scripts/jev-gate-heuristic-grep.mjs';
import { predict as lint } from '../../../scripts/jev-gate-heuristic-lint.mjs';
import { CORPUS, HERE, RULES, stateOf } from './author-x.mjs';

export const BASELINES = { 'heuristic-grep': grep, 'heuristic-lint': lint };

export function scoreX() {
  const rules = readFileSync(RULES, 'utf8');
  const labels = JSON.parse(readFileSync(join(HERE, 'labels-x.json'), 'utf8')).items;
  const out = {};
  for (const [name, predict] of Object.entries(BASELINES)) {
    const scored = labels.filter(l => l.label === 'RED' || l.label === 'GREEN').map(l => {
      const red = Boolean(predict(stateOf(rules, readFileSync(join(CORPUS, l.id + '.patch'), 'utf8'))));
      return { id: l.id, truth: l.label, red };
    });
    const missedRed = scored.filter(s => s.truth === 'RED' && !s.red).map(s => s.id);
    const falseReject = scored.filter(s => s.truth === 'GREEN' && s.red).map(s => s.id);
    const correct = scored.length - missedRed.length - falseReject.length;
    out[name] = { scored: scored.length, correct, accuracy: Number((correct / scored.length).toFixed(4)), missedRed, falseReject };
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = scoreX();
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  for (const [name, r] of Object.entries(res)) console.log(`${name}: accuracy ${r.accuracy} (${r.correct}/${r.scored}), missed RED ${r.missedRed.length}, false reject ${r.falseReject.length}`);
}
