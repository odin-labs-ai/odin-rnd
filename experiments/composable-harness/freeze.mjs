// EXP 009 freeze record for the two blind-authored artifacts (bundle 3 WO-03).
// A tree digest is sha256 over the sorted lines "<sha256 of file bytes>  <path relative to the tree>\n".
// `node freeze.mjs` prints the digests; `node freeze.mjs --write` writes FREEZE.json; `--check` exits 1 on drift.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TREES = {
  corpus: 'corpus/authored',
  h2: 'h2/authored',
};
export const SPECS = ['corpus/SPEC.md', 'h2/SPEC.md'];

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const walk = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

export function treeDigest(rel, root = HERE) {
  const dir = join(root, rel);
  const lines = walk(dir).map(f => `${sha(readFileSync(f))}  ${relative(dir, f).split('\\').join('/')}`).sort();
  return { files: lines.length, sha256: sha(lines.map(l => `${l}\n`).join('')) };
}

export function computeFreeze(root = HERE) {
  return {
    schema: 'odin-rnd.exp009.freeze.v1',
    corpus: treeDigest(TREES.corpus, root),
    h2: treeDigest(TREES.h2, root),
    specs: Object.fromEntries(SPECS.map(p => [p, sha(readFileSync(join(root, p)))])),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = computeFreeze();
  const file = join(HERE, 'FREEZE.json');
  if (process.argv.includes('--write')) {
    writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
  } else if (process.argv.includes('--check')) {
    const committed = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (committed !== `${JSON.stringify(now, null, 2)}\n`) { console.error('FREEZE DRIFT'); process.exit(1); }
  }
  console.log(JSON.stringify(now));
}
