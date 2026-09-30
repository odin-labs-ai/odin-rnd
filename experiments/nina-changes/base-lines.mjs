// EXP 006 R3-2: the BASE LINE SET. The sha256 of every trimmed line of every file tracked in the REAL staged base
// commit (3e35e4e2…, nina 0.34.0's written files included), so the classifier's `+` fingerprints can exclude any line
// the reviewer could see in the base commit (git show HEAD, git log -p, a Read of an unchanged file). Committed as
// base-lines.json so CI checks the fingerprints against it without the nina tarball.
//   node experiments/nina-changes/base-lines.mjs --write [--tarball f]   stage the base once and write base-lines.json
//   node experiments/nina-changes/base-lines.mjs --check [--tarball f]   re-derive from a fresh stage; must be equal
// Staging is EXP 005's own stageWorkspace (no model call): the base app, the verified 0.34.0 tarball extracted,
// nina init + compose, .gitignore, rules.txt, the pinned base commit. The stage lives in a temp dir that is removed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TARBALL, stageWorkspace, verifiedTarball } from '../jev-gate/run_reviewer.mjs';
import { checkRecords } from '../jev-gate/runner-guard.mjs';
import { gitgit } from './vendored-exp005.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const outFile = join(HERE, 'base-lines.json');
export const BASE_COMMIT = '3e35e4e274932a61bc0d92f378f8d506a9bb4ce0';
export const RULE = 'sha256 (hex) of every line of every file tracked in the staged EXP 005 base commit, trimmed of leading and trailing whitespace; unique, sorted. Files are read as UTF-8 and split on \\n.';

const sha256 = text => createHash('sha256').update(text).digest('hex');
export const lineHash = line => sha256(line.trim());

/** The base line set of a staged repository at its HEAD (the base commit), from the tracked files' committed bytes. */
export function baseLineHashes(repo) {
  const git = gitgit(repo);
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const files = git('ls-tree', '-r', '--name-only', '-z', 'HEAD').stdout.split('\0').filter(Boolean);
  const set = new Set();
  for (const f of files) {
    const text = git('show', `HEAD:${f}`).stdout;
    for (const line of text.split('\n')) set.add(lineHash(line));
  }
  return { head, files: files.length, hashes: [...set].sort() };
}

/** Stage the real base (no change applied) in a temp dir, derive the set, remove the stage. */
export function deriveBaseLines({ tarball = DEFAULT_TARBALL } = {}) {
  const { prereg, amendment } = checkRecords({ mode: 'practice' });
  verifiedTarball(tarball, amendment.changes.reviewer.nina.tarball.integrity);
  const parent = mkdtempSync(join(tmpdir(), 'nina-changes-base-'));
  const cleanup = () => rmSync(parent, { recursive: true, force: true });
  const onSignal = () => { cleanup(); process.exit(1); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, onSignal);
  try {
    const staged = stageWorkspace({ prereg, amendment, patch: null, tarball, parent });
    assert.equal(staged.baseSha, BASE_COMMIT, 'the staged base commit is the pinned one');
    const { head, files, hashes } = baseLineHashes(staged.repo);
    assert.equal(head, BASE_COMMIT);
    return { schemaVersion: 1, kind: 'base-lines', baseCommit: BASE_COMMIT, rule: RULE, files, count: hashes.length, sha256s: hashes };
  } finally {
    cleanup();
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(sig, onSignal);
  }
}

export const render = record => `${JSON.stringify(record, null, 1)}\n`;
export const loadBaseLines = (file = outFile) => JSON.parse(readFileSync(file, 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const tarball = argv.includes('--tarball') ? argv[argv.indexOf('--tarball') + 1] : DEFAULT_TARBALL;
  const record = deriveBaseLines({ tarball });
  if (argv[0] === '--write') writeFileSync(outFile, render(record));
  else if (argv[0] === '--check') assert.equal(readFileSync(outFile, 'utf8'), render(record), 'base-lines.json differs from a fresh stage');
  else { console.error('usage: node experiments/nina-changes/base-lines.mjs --write | --check [--tarball f]'); process.exit(2); }
  console.log(JSON.stringify({ baseCommit: record.baseCommit, files: record.files, count: record.count }));
}
