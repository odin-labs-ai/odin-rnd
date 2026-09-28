// EXP 005: the two model-free baselines are deterministic, read only the gate view, and match baselines.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entryFor } from '../experiments/jev-gate/baselines.mjs';
import { predict as grep } from './jev-gate-heuristic-grep.mjs';
import { predict as lint } from './jev-gate-heuristic-lint.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = rel => readFileSync(join(root, rel), 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const recorded = JSON.parse(read('experiments/jev-gate/baselines.json'));
const scripts = { 'heuristic-grep': ['scripts/jev-gate-heuristic-grep.mjs', grep], 'heuristic-lint': ['scripts/jev-gate-heuristic-lint.mjs', lint] };

test('baselines.json is bound to the current inputs and labels', () => {
  assert.equal(recorded.inputsSha256, sha256(read('experiments/jev-gate/inputs.json')));
  assert.equal(recorded.labelsSha256, sha256(read('experiments/jev-gate/labels.json')));
  assert.deepEqual(Object.keys(recorded.baselines), Object.keys(scripts));
});

for (const [name, [path, predict]] of Object.entries(scripts)) {
  test(`${name}: deterministic, and its recorded entry reproduces`, () => {
    const once = entryFor(join(root, path), recorded.baselines[name].description, predict);
    const twice = entryFor(join(root, path), recorded.baselines[name].description, predict);
    assert.deepEqual(once, twice);
    assert.deepEqual(once, recorded.baselines[name]);
    assert.equal(once.scriptSha256, sha256(read(path)));
    assert.equal(once.libSha256, sha256(read('experiments/jev-gate/baselines.mjs')));
    assert.equal(once.correct + once.missedRed.length + once.falseReject.length, once.scored);
  });

  test(`${name}: the CLI --check passes`, () => {
    const r = spawnSync(process.execPath, [join(root, path), '--check'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /baselines\.json reproduces/);
  });

  test(`${name}: sees only the gate view (no labels, manifest or intent)`, () => {
    const source = read(path);
    for (const word of ['labels.json', 'manifest', 'corpus/', 'intent', 'family']) assert.ok(!source.includes(word), `${path} mentions ${word}`);
  });
}

test('hand cases: the grep port keeps H1c blind spots, the linter follows rules.txt', () => {
  const state = (file, line) => `rules\n\ndiff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1,2 @@\n x\n+${line}\n`;
  assert.equal(grep(state('src/app/a.ts', "import { x } from '../infra';")), true);
  assert.equal(grep(state('src/app/a.ts', "// see '../infra'")), false);
  assert.equal(grep(state('test/a.test.ts', 'process.env.X = 1;')), false);
  assert.equal(grep(state('src/domain/a.ts', 'import pg from "pg";')), false);
  assert.equal(lint(state('src/domain/a.ts', 'import pg from "pg";')), true);
  assert.equal(lint(state('src/domain/a.ts', '// process.env is read in src/config')), true);
  assert.equal(lint(state('src/app/a.ts', "import type { Services } from '../infra/index';")), false);
  assert.equal(lint(state('src/app/a.ts', "import { createPool } from '../infra/db/pool';")), true);
  assert.equal(lint(state('src/config/a.ts', "const a = process.env['X'];")), true);
  assert.equal(lint(state('src/config/a.ts', 'const a = process.env.PORT;')), false);
});
