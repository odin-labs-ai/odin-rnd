// EXP 005: scrub local paths from the evidence records written before run_reviewer.mjs scrubbed at write time
// (refute of amendment 02, B1). The rule is run_reviewer.mjs SCRUB_RULES, the same code the runner applies to
// every new record; it is applied to each file's raw text, so nothing but the paths changes.
//
//   node experiments/jev-gate/rescrub-records.mjs --write   once: scrub the files and write scrubbed-records.json
//   node experiments/jev-gate/rescrub-records.mjs --check   each file is its scrubbed sha, and scrubbing changes nothing
//
// scrubbed-records.json discloses each original's sha256 next to the scrubbed one, so the published file can be
// tied back to what the runner first wrote (the originals themselves are not published: they hold the paths).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRUB_RULES, scrubPaths } from './run_reviewer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'scrubbed-records.json');
export const RECORDS = [
  'dry-run/isolation-probe.json', 'dry-run/jev-practice.json', 'dry-run/laya-practice.json',
  'isolation-probe-candidate-1.json', 'isolation-probe-narrow-1.json', 'isolation-probe-narrow-2.json', 'isolation-probe-narrow-3.json',
];
const sha256 = text => createHash('sha256').update(text).digest('hex');

export function check() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const f of manifest.files) {
    const text = readFileSync(join(HERE, f.path), 'utf8');
    if (sha256(text) !== f.scrubbedSha256) throw new Error(`${f.path} is not its recorded scrubbed bytes`);
    if (scrubPaths(text) !== text) throw new Error(`${f.path} still holds a local path`);
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) { check(); console.log('scrubbed records: every file matches and holds no local path'); process.exit(0); }
  if (!process.argv.includes('--write')) { console.error('usage: rescrub-records.mjs --write | --check'); process.exit(2); }
  if (existsSync(MANIFEST)) { console.error('scrubbed-records.json exists: the originals were already scrubbed'); process.exit(1); }
  const files = RECORDS.map(path => {
    const original = readFileSync(join(HERE, path), 'utf8');
    const scrubbed = scrubPaths(original);
    // Counted rule by rule, in the order they apply, so no match is counted twice.
    const replacements = {};
    SCRUB_RULES.reduce((t, [re, to]) => { const n = (t.match(new RegExp(re.source, re.flags)) ?? []).length; if (n) replacements[to] = n; return t.replace(re, to); }, original);
    if (scrubbed !== original) writeFileSync(join(HERE, path), scrubbed);
    return { path, originalSha256: sha256(original), scrubbedSha256: sha256(scrubbed), changed: scrubbed !== original, replacements };
  });
  writeFileSync(MANIFEST, `${JSON.stringify({
    schemaVersion: 1,
    note: 'Evidence records written before the runner scrubbed local paths at write time, scrubbed afterwards by rescrub-records.mjs with the runner\'s own SCRUB_RULES (run_reviewer.mjs). Only paths changed; the canary secrets are random tokens, not paths, so every leak judgment stands. originalSha256 is the sha256 of the file as the runner first wrote it (and as amendment-02 drafts pinned it).',
    rule: ['a path ending in a run temp dir (named jev-gate-reviewer-XXXXXX) -> <ws>', 'the macOS per-user temp root (var/folders/<a>/<b>/T, with or without the private prefix) -> <tmp>', 'the system tmp directory (with or without the private prefix) -> <tmp>', 'the home directory -> ~', 'the Homebrew client (opt/homebrew/bin/claude) -> claude; any other Homebrew path -> <homebrew>'],
    code: 'experiments/jev-gate/run_reviewer.mjs SCRUB_RULES',
    files,
  }, null, 2)}\n`);
  for (const f of files) console.log(`${f.path}: ${f.changed ? `${f.originalSha256.slice(0, 12)} -> ${f.scrubbedSha256.slice(0, 12)}` : 'no local path'} ${JSON.stringify(f.replacements)}`);
}
