import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No test may leave a temp dir behind: scratch copies of experiments/jev-gate hold labels.json, the answer key,
// and a copy left in the shared temp directory sits outside the reviewer sandbox's home-only read block
// (refute r4 of amendment 02, B2).
const tests = readdirSync('scripts').filter(f => f.endsWith('.test.mjs')).sort();

test('every test that makes a temp dir also removes it (static)', () => {
  for (const f of tests) {
    const src = readFileSync(join('scripts', f), 'utf8');
    if (/mkdtemp(Sync)?\(/.test(src)) assert.match(src, /\brm(Sync)?\(/, `${f} makes a temp dir and never removes one`);
  }
});

test('the jev-gate and laya tests leave nothing in the temp directory (run with a private TMPDIR)', { timeout: 600_000 }, () => {
  // The runners' end-to-end file stages real workspaces and is slow; it removes each one in a finally and is
  // covered by the static check. Everything else runs here against an empty TMPDIR.
  const files = tests.filter(f => /^(jev-gate-|laya-)/.test(f) && !['jev-gate-tempdirs.test.mjs', 'jev-gate-runners.test.mjs'].includes(f)).map(f => join('scripts', f));
  const tmp = mkdtempSync(join(tmpdir(), 'jev-gate-tempdirs-'));
  try {
    // NODE_TEST_CONTEXT makes a nested `node --test` report to this runner instead of running: drop it.
    const { NODE_TEST_CONTEXT: _, ...env } = process.env;
    const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { env: { ...env, TMPDIR: tmp }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const ran = Number(/^# tests (\d+)$/m.exec(out)?.[1] ?? 0);
    assert(ran > 50, `the nested run ran ${ran} tests`);
    assert.match(out, /^# fail 0$/m, 'the nested run passed');
    assert.deepEqual(readdirSync(tmp), [], `left behind in TMPDIR: ${readdirSync(tmp).join(', ')}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
