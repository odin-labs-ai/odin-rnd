// EXP 005 baseline (a): the WO-07 reviewer's keyword grep, heuristic H1c of heur.py, ported as is.
// It knows nothing about layers or the allowlist: RED when any added, non-comment line of a file
// under src/ contains one of six rule keywords. It reads only inputs.json (see baselines.mjs).
//
//   node scripts/jev-gate-heuristic-grep.mjs            print the score and record it in baselines.json
//   node scripts/jev-gate-heuristic-grep.mjs --check    recompute and compare with baselines.json
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseState, runBaseline } from '../experiments/jev-gate/baselines.mjs';

const KEYWORDS = /process\.env|'pg'|\.\.\/infra|\.\.\/app|\.\.\/config|import\(/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

export const predict = state => parseState(state).added
  .some(({ file, line }) => file !== null && file.startsWith('src/') && !COMMENT.test(line) && KEYWORDS.test(line));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBaseline('heuristic-grep', fileURLToPath(import.meta.url),
    "WO-07 heur.py H1c: an added non-comment line under src/ contains process.env, 'pg', ../infra, ../app, ../config or import(", predict);
}
