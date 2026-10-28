// The test shards ran every test file, each exactly once (.github/workflows/publish.yml, job `verify`). Each shard
// writes the list of test files it ran; this refuses, every reason listed, unless the shards' lists together are
// exactly the unsharded file set (`pnpm test` = node --test scripts/*.test.mjs) and no file is in two shards. A test
// file sharding dropped, or ran twice, fails the build.
//
//   node scripts/check-shard-coverage.mjs --shards N <shard list> ...     (one path per line; N = the matrix's shards)
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The unsharded test files: what scripts/*.test.mjs expands to, sorted. */
export const allTestFiles = (dir = 'scripts') => readdirSync(dir, { withFileTypes: true })
  .filter(e => e.isFile() && !e.name.startsWith('.') && e.name.endsWith('.test.mjs')).map(e => `${dir}/${e.name}`).sort();

/** Every way the shard lists are not one exact partition of `all` (empty when they are). */
export function coverageProblems(shards, all, expected) {
  const problems = [];
  if (!Number.isInteger(expected) || expected < 2) problems.push(`the expected shard count ${expected} is not an integer of two or more`);
  else if (shards.length !== expected) problems.push(`${shards.length} shard list(s); the run has ${expected} shards`);
  const seen = new Map();
  shards.forEach((files, i) => {
    if (!files.length) problems.push(`shard ${i + 1} ran no test file`);
    for (const f of files) {
      if (seen.has(f)) problems.push(`${f} ran in shard ${seen.get(f) + 1} and in shard ${i + 1}`);
      else seen.set(f, i);
    }
  });
  const want = new Set(all);
  for (const f of all) if (!seen.has(f)) problems.push(`${f} ran in no shard`);
  for (const f of seen.keys()) if (!want.has(f)) problems.push(`${f} is not one of the test files`);
  return problems;
}

const lines = text => text.split('\n').map(l => l.trim()).filter(Boolean);

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const expected = args[0] === '--shards' ? Number(args.splice(0, 2)[1]) : NaN;
  const files = args;
  const problems = coverageProblems(files.map(f => lines(readFileSync(f, 'utf8'))), allTestFiles(), expected);
  if (problems.length) { console.error(`shard coverage refused:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`shard coverage: ${allTestFiles().length} test files, each in exactly one of ${files.length} shards`);
}
