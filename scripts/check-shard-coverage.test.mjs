import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allTestFiles, coverageProblems } from './check-shard-coverage.mjs';

// The CI shards of `pnpm test` (scripts/check-shard-coverage.mjs): a dropped or doubled test file fails the build.
const all = allTestFiles();
// The partition the workflow makes: the sorted list, file i to shard (i mod 3).
const thirds = [0, 1, 2].map(s => all.filter((_, i) => i % 3 === s));

test('the unsharded set is what scripts/*.test.mjs expands to, and this file is in it', () => {
  assert.ok(all.includes('scripts/check-shard-coverage.test.mjs'));
  assert.deepEqual(all, [...all].sort());
  const shell = execFileSync('bash', ['-c', 'LC_ALL=C; printf "%s\\n" scripts/*.test.mjs'], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(all, [...shell].sort());
});

test("the workflow's three-way split is one exact partition", () => {
  assert.deepEqual(coverageProblems(thirds, all, 3), []);
});

test('planted negative: a test file missing from every shard is refused', () => {
  const dropped = [thirds[0], thirds[1].slice(1), thirds[2]];
  assert.deepEqual(coverageProblems(dropped, all, 3), [`${thirds[1][0]} ran in no shard`]);
});

test('planted negatives: a file in two shards, a file that is not a test file, an empty shard, a single shard', () => {
  assert.match(coverageProblems([thirds[0], [...thirds[1], thirds[0][0]], thirds[2]], all, 3).join('\n'), /ran in shard 1 and in shard 2/);
  assert.match(coverageProblems([thirds[0], [...thirds[1], 'scripts/nope.test.mjs'], thirds[2]], all, 3).join('\n'), /scripts\/nope\.test\.mjs is not one of the test files/);
  assert.match(coverageProblems([[...thirds[0], ...thirds[1]], [], thirds[2]], all, 3).join('\n'), /shard 2 ran no test file/);
  assert.match(coverageProblems([all], all, 3).join('\n'), /1 shard list\(s\); the run has 3 shards/);
  // Complete partitions with the wrong number of lists: two and four.
  const halves = [all.filter((_, i) => i % 2 === 0), all.filter((_, i) => i % 2 === 1)];
  assert.deepEqual(coverageProblems(halves, all, 3), ['2 shard list(s); the run has 3 shards']);
  const quarters = [0, 1, 2, 3].map(s => all.filter((_, i) => i % 4 === s));
  assert.deepEqual(coverageProblems(quarters, all, 3), ['4 shard list(s); the run has 3 shards']);
  assert.match(coverageProblems(thirds, all, undefined).join('\n'), /expected shard count/);
});

test('the command line exits 1 on a dropped file and 0 on the full partition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shards-'));
  try {
    const write = (name, files) => { const f = join(dir, name); writeFileSync(f, `${files.join('\n')}\n`); return f; };
    const ok = thirds.map((files, i) => write(`ok-${i}.txt`, files));
    assert.match(execFileSync('node', ['scripts/check-shard-coverage.mjs', '--shards', '3', ...ok], { encoding: 'utf8' }), /each in exactly one of 3 shards/);
    const bad = [write('b0.txt', thirds[0]), write('b1.txt', thirds[1].slice(1)), write('b2.txt', thirds[2])];
    assert.throws(() => execFileSync('node', ['scripts/check-shard-coverage.mjs', '--shards', '3', ...bad], { stdio: 'pipe' }), e => e.status === 1 && e.stderr.toString().includes(`${thirds[1][0]} ran in no shard`));
    assert.equal(readFileSync(ok[0], 'utf8').split('\n')[0], thirds[0][0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
