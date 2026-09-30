import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// EXP 006 R3-1 / R4-1: vendored-exp005.mjs carries BYTE-IDENTICAL copies of the module-private EXP 005 symbols it
// needs. One slice test per symbol against the committed b2dbb1fd source fixtures, whose sha256 equal EXP 005's pins.

const FIX = 'experiments/nina-changes/fixtures/exp005-b2dbb1fd';
const vendored = readFileSync('experiments/nina-changes/vendored-exp005.mjs', 'utf8');
const sources = {
  'run_reviewer.mjs': { text: readFileSync(`${FIX}/run_reviewer.mjs.txt`, 'utf8'), sha: '6134e3a3dfd6ab845d536a5afaca83b9d620bc48b3b4057c19d039b461505116' },
  'results.mjs': { text: readFileSync(`${FIX}/results.mjs.txt`, 'utf8'), sha: '010ca4bb6aaf9f8c5949bc0f15aa90c4a87be6b064543edb7010c9d1197cf29c' },
};
const sha256 = text => createHash('sha256').update(text).digest('hex');

/** A top-level declaration's text: one line ending in `;`, or through the first following line that is `}` / `};`. */
function sliceDeclaration(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex(l => new RegExp(`^(?:export )?(?:async )?(?:function ${name}\\(|const ${name} = )`).test(l));
  if (start < 0) return null;
  if (lines[start].endsWith(';')) return { line: start + 1, text: lines[start] };
  let end = start + 1;
  while (end < lines.length && !/^\};?$/.test(lines[end])) end += 1;
  return { line: start + 1, text: lines.slice(start, end + 1).join('\n') };
}

test('the b2dbb1fd source fixtures are EXP 005 runners.sha256 pins (and git history, where the clone has it)', () => {
  for (const [file, { text, sha }] of Object.entries(sources)) {
    assert.equal(sha256(text), sha, `${file} fixture sha`);
    const git = spawnSync('git', ['show', `b2dbb1fd:experiments/jev-gate/${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (git.status === 0) assert.equal(git.stdout, text, `${file} fixture equals git show b2dbb1fd`);
  }
  // The live run_reviewer.mjs and results.mjs are not edited by EXP 006.
  assert.equal(sha256(readFileSync('experiments/jev-gate/run_reviewer.mjs', 'utf8')), sources['run_reviewer.mjs'].sha);
  assert.equal(sha256(readFileSync('experiments/jev-gate/results.mjs', 'utf8')), sources['results.mjs'].sha);
});

// Symbol, source file, its line at b2dbb1fd (R4-1 cites re-verified).
const SYMBOLS = [
  ['GIT_FLAGS', 'run_reviewer.mjs', 38], ['GIT_ENV', 'run_reviewer.mjs', 40], ['run', 'run_reviewer.mjs', 249], ['gitgit', 'run_reviewer.mjs', 270],
  ['spawnTimed', 'run_reviewer.mjs', 368], ['hookContext', 'run_reviewer.mjs', 402], ['coverageGap', 'results.mjs', 241],
];
for (const [name, file, line] of SYMBOLS) {
  test(`vendored ${name} is byte-identical to ${file}:${line} at b2dbb1fd`, () => {
    const want = sliceDeclaration(sources[file].text, name);
    assert.ok(want, `${name} is declared in the fixture`);
    assert.equal(want.line, line, `${name} is at ${file}:${line}`);
    assert.doesNotMatch(want.text.split('\n')[0], /^export /, `${name} is module-private in EXP 005 (else import it)`);
    const got = sliceDeclaration(vendored, name);
    assert.ok(got, `${name} is in vendored-exp005.mjs`);
    assert.equal(got.text, want.text);
  });
}

test('every private symbol the vendored functions reach is vendored too, and nothing else is', () => {
  const declared = [...vendored.matchAll(/^(?:function (\w+)\(|const (\w+) = )/gm)].map(m => m[1] ?? m[2]).sort();
  assert.deepEqual(declared, SYMBOLS.map(s => s[0]).sort());
  const exported = /^export \{ ([^}]+) \};$/m.exec(vendored)[1].split(', ').sort();
  assert.deepEqual(exported, declared);
  // The EXP 005 exports they reach are imported, not copied.
  assert.match(vendored, /^import \{ BASE_IDENTITY \} from '\.\.\/jev-gate\/run_reviewer\.mjs';$/m);
  assert.match(vendored, /^import \{ sha256 \} from '\.\.\/jev-gate\/runner-guard\.mjs';$/m);
});
