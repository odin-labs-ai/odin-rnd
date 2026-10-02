// EXP 008-X, WO-03: the overlap fence between the 140 new items and EXP 005's 60.
//
// It uses EXP 006's own change-fingerprint definition, imported (both modules were checked to import without side
// effects: no file is written and no temp dir is made at import time):
//   fingerprintItem / parsePatch  from ../../nina-changes/fingerprints.mjs
//   lineHash / loadBaseLines      from ../../nina-changes/base-lines.mjs (the committed base-lines.json)
// A `+` fingerprint is a `+` line of a patch, trimmed, at least 8 characters, whose hash is not in the base line set.
//
// Rules (any hit is a collision, listed, exit 1):
//   (a) no 008-X `+` fingerprint equals any EXP 005 item's `+` fingerprint (nor, with --calibration <file>, any
//       trimmed line of at least 8 characters of that public calibration text);
//   (b) for each file an 008-X item modifies (a modified file, or the source side of a rename), the signature
//       path + sorted unique trimmed `-` lines must not equal the signature of any EXP 005 item for that file.
//       A file an item only inserts into has an empty `-` set: it removes no base line, so it has no base-line
//       signature to compare (an empty set is not compared; the count of such files is printed for disclosure);
//   (c) no two 008-X items are identical patches or have the same full `+` fingerprint set.
//
//   node experiments/latent-handoff/corpus-x/overlap-x.mjs [--calibration <file>] [--json]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintItem, parsePatch, MIN_CHARS } from '../../nina-changes/fingerprints.mjs';
import { lineHash, loadBaseLines } from '../../nina-changes/base-lines.mjs';
import { CORPUS, JEV, assertPinned } from './author-x.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const readCorpus = dir => readdirSync(dir).filter(f => /^c\d{3}\.patch$/.test(f)).sort().map(f => ({ id: f.slice(0, 4), patch: readFileSync(join(dir, f), 'utf8') }));

/** Per modified (or renamed-from) file: the `-` signature of one patch. Empty `-` sets are kept, flagged empty. */
export function minusSignatures(patch) {
  return parsePatch(patch).filter(f => f.kind === 'modified' || f.kind === 'renamed').map(f => {
    const minus = [...new Set(f.minus.map(l => l.trim()))].sort();
    return { path: f.from, minus, key: f.from + '\0' + minus.join('\n') };
  });
}

export function overlap({ calibration = null, exp005Dir = join(JEV, 'corpus'), xDir = CORPUS } = {}) {
  assertPinned();
  const baseSet = new Set(loadBaseLines().sha256s);
  const old = readCorpus(exp005Dir), fresh = readCorpus(xDir);
  const collisions = [];

  // (a) change fingerprints
  const oldPlus = new Map();
  for (const { id, patch } of old) for (const fp of fingerprintItem(patch, baseSet).plus) oldPlus.set(fp, [...(oldPlus.get(fp) ?? []), id]);
  const calib = new Set();
  if (calibration) {
    for (const line of readFileSync(calibration, 'utf8').split('\n')) if (line.trim().length >= MIN_CHARS) calib.add(line.trim());
  }
  const freshFp = fresh.map(({ id, patch }) => ({ id, patch, fp: fingerprintItem(patch, baseSet) }));
  for (const { id, fp } of freshFp) {
    for (const line of fp.plus) {
      if (oldPlus.has(line)) collisions.push({ rule: 'a', id, with: oldPlus.get(line), line });
      if (calib.has(line)) collisions.push({ rule: 'a-calibration', id, line });
    }
  }

  // (b) base-line signatures
  const oldSig = new Map();
  for (const { id, patch } of old) for (const s of minusSignatures(patch)) if (s.minus.length) oldSig.set(s.key, [...(oldSig.get(s.key) ?? []), id]);
  let emptySignatures = 0;
  for (const { id, patch } of fresh) {
    for (const s of minusSignatures(patch)) {
      if (!s.minus.length) { emptySignatures++; continue; }
      if (oldSig.has(s.key)) collisions.push({ rule: 'b', id, with: oldSig.get(s.key), path: s.path, minus: s.minus });
    }
  }

  // (c) within 008-X
  const byPatch = new Map(), byPlus = new Map();
  for (const { id, patch, fp } of freshFp) {
    const p = sha256(patch), q = sha256(fp.plus.join('\n'));
    if (byPatch.has(p)) collisions.push({ rule: 'c-identical', id, with: [byPatch.get(p)] });
    else byPatch.set(p, id);
    if (byPlus.has(q)) collisions.push({ rule: 'c-plus-set', id, with: [byPlus.get(q)] });
    else byPlus.set(q, id);
  }

  return {
    exp005Items: old.length, xItems: fresh.length, exp005PlusFingerprints: oldPlus.size,
    xPlusFingerprints: new Set(freshFp.flatMap(f => f.fp.plus)).size, calibrationLines: calib.size,
    emptyMinusSignaturesNotCompared: emptySignatures, collisions,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const calibration = argv.includes('--calibration') ? argv[argv.indexOf('--calibration') + 1] : null;
  if (argv.includes('--calibration') && !calibration) { console.error('usage: overlap-x.mjs [--calibration <file>] [--json]'); process.exit(2); }
  const result = overlap({ calibration });
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  const { collisions, ...summary } = result;
  console.log(JSON.stringify(summary));
  if (collisions.length) {
    for (const c of collisions) console.log(`collision (${c.rule}) ${c.id}${c.with ? ' with ' + c.with.join(',') : ''}: ${c.line ?? c.path ?? ''}`);
    console.log(`${collisions.length} shared fingerprint(s)`);
    process.exitCode = 1;
  } else {
    console.log('0 shared fingerprints');
  }
}
