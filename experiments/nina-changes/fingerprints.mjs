// EXP 006 R2-2 / R3-2: the change fingerprints, generated from the EXP 005 corpus patches and the committed base line
// set. Per item:
//   plus:    `+` lines (modified AND added files), trimmed, at least 8 characters, NOT in the base line set;
//   minus:   `-` lines, trimmed, at least 8 characters (a root base commit prints no `-` line, so no base filter);
//   added / deleted paths, renames (from -> to);
//   addedContent: per added path, its `+` fingerprints (rule (b) needs the hit on that path itself).
// A pure 100% rename has no hunk and yields no fingerprint; c018 is covered by its modify hunks (rule (a)).
//   node experiments/nina-changes/fingerprints.mjs --write | --check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineHash, loadBaseLines, outFile as baseLinesFile } from './base-lines.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JEV = join(HERE, '..', 'jev-gate');
export const outFile = join(HERE, 'change-fingerprints.json');
export const MIN_CHARS = 8;
export const RULE = `Per corpus item: every hunk line of its patch, trimmed. A + line (modified or added file) is a fingerprint when it has at least ${MIN_CHARS} characters and its sha256 is not in base-lines.json; a - line when it has at least ${MIN_CHARS} characters. Added, deleted and renamed paths are listed. A fingerprint matches only a whole trimmed line with the same sign.`;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** One unified git patch, file by file: paths, kind, and the hunk lines with their sign. */
export function parsePatch(patch) {
  const files = [];
  let cur = null, inHunk = false;
  for (const line of patch.split('\n')) {
    const head = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (head) { cur = { from: head[1], to: head[2], kind: 'modified', plus: [], minus: [] }; files.push(cur); inHunk = false; continue; }
    if (!cur) continue;
    if (!inHunk) {
      if (/^new file mode/.test(line)) cur.kind = 'added';
      else if (/^deleted file mode/.test(line)) cur.kind = 'deleted';
      else if (/^rename from /.test(line)) cur.kind = 'renamed';
      if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) cur.plus.push(line.slice(1));
    else if (line.startsWith('-')) cur.minus.push(line.slice(1));
  }
  return files;
}

export function fingerprintItem(patch, baseSet) {
  const files = parsePatch(patch);
  const keepPlus = l => l.trim().length >= MIN_CHARS && !baseSet.has(lineHash(l));
  const keepMinus = l => l.trim().length >= MIN_CHARS;
  const uniq = xs => [...new Set(xs)].sort();
  const addedContent = Object.fromEntries(files.filter(f => f.kind === 'added').map(f => [f.to, uniq(f.plus.filter(keepPlus).map(l => l.trim()))]));
  return {
    plus: uniq(files.flatMap(f => f.plus.filter(keepPlus).map(l => l.trim()))),
    minus: uniq(files.flatMap(f => f.minus.filter(keepMinus).map(l => l.trim()))),
    added: files.filter(f => f.kind === 'added').map(f => f.to).sort(),
    deleted: files.filter(f => f.kind === 'deleted').map(f => f.from).sort(),
    renames: files.filter(f => f.kind === 'renamed').map(f => ({ from: f.from, to: f.to })),
    modified: files.filter(f => f.kind === 'modified').map(f => f.to).sort(),
    addedContent,
  };
}

export function fingerprints({ jev = JEV, baseLines = loadBaseLines() } = {}) {
  const inputs = JSON.parse(readFileSync(join(jev, 'inputs.json'), 'utf8'));
  const corpusSha = readFileSync(join(jev, 'corpus.sha256'));
  const baseSet = new Set(baseLines.sha256s);
  const items = {};
  for (const { id, patchSha256 } of [...inputs.items].sort((a, b) => a.id.localeCompare(b.id))) {
    const patch = readFileSync(join(jev, 'corpus', `${id}.patch`), 'utf8');
    assert.equal(sha256(patch), patchSha256, `${id}.patch does not match inputs.json`);
    items[id] = fingerprintItem(patch, baseSet);
  }
  const counts = Object.values(items).map(i => i.plus.length + i.minus.length);
  return {
    schemaVersion: 1, kind: 'change-fingerprints', rule: RULE, minChars: MIN_CHARS,
    corpusSha256: sha256(corpusSha), baseLinesSha256: sha256(readFileSync(baseLinesFile)), baseCommit: baseLines.baseCommit,
    summary: { items: counts.length, minFingerprints: Math.min(...counts), maxFingerprints: Math.max(...counts), addFileItems: Object.values(items).filter(i => i.added.length).length, addOnlyItems: Object.values(items).filter(i => i.added.length && !i.modified.length && !i.deleted.length && !i.renames.length).length },
    items,
  };
}

export const render = record => `${JSON.stringify(record, null, 1)}\n`;
export const loadFingerprints = (file = outFile) => JSON.parse(readFileSync(file, 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const record = fingerprints();
  if (command === '--write') writeFileSync(outFile, render(record));
  else if (command === '--check') assert.equal(readFileSync(outFile, 'utf8'), render(record), 'change-fingerprints.json differs from what fingerprints.mjs computes');
  else { console.error('usage: node experiments/nina-changes/fingerprints.mjs --write | --check'); process.exit(2); }
  console.log(JSON.stringify(record.summary));
}
