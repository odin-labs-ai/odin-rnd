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

test('test-build.mjs removes its build copy on exit and on signals, with a jev-gate- prefix (refute r3 addendum)', () => {
  // builtCopy() copies the whole checkout — including experiments/jev-gate/*.json, the answer key — into a temp
  // dir. A killed test run stranded one, which the counted pre-flight then found. So the copy must be removed on
  // normal exit, on an uncaught error, and on SIGINT/SIGTERM, and carry a recognisable prefix.
  const src = readFileSync('scripts/test-build.mjs', 'utf8');
  assert.match(src, /mkdtempSync\(join\(tmpdir\(\), 'jev-gate-build-'\)\)/, 'the build copy uses a jev-gate-build- prefix');
  assert.match(src, /process\.on\('exit', cleanup\)/, 'removed on normal exit');
  assert.match(src, /\['SIGINT', 'SIGTERM', 'SIGHUP'\][\s\S]*cleanup\(\); process\.exit/, 'removed on SIGINT/SIGTERM/SIGHUP');
  assert.match(src, /catch \(error\) \{\s*cleanup\(\)/, 'removed on an uncaught build error');
});

test('the jev-gate and laya tests leave nothing in the temp directory (run with a private TMPDIR)', { timeout: 600_000 }, () => {
  const files = tests.filter(f => /^(jev-gate-|laya-)/.test(f) && !['jev-gate-tempdirs.test.mjs', 'jev-gate-runners.test.mjs'].includes(f)).map(f => join('scripts', f));
  const tmp = mkdtempSync(join(tmpdir(), 'jev-gate-tempdirs-'));
  // NODE_TEST_CONTEXT makes a nested `node --test` report to this runner instead of running: drop it.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const runNested = (...args) => execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...args], { env: { ...env, TMPDIR: tmp }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const passed = out => { assert.match(out, /^# fail 0$/m, 'a nested run failed'); return Number(/^# tests (\d+)$/m.exec(out)?.[1] ?? 0); };
  try {
    assert(passed(runNested(...files)) > 50, 'the nested run ran too few tests');
    // The runners file is otherwise excluded (its nina-staging e2e is slow), but its answer-file-copying tests
    // (freeze, guard) and pre-flight tests must also leave nothing (refute r4 hygiene). Run just those — fast, no
    // staging — into the same private TMPDIR. The e2e/stage dirs hold no answer file and use the signal-safe
    // scratch helper (jev-gate-scratch.mjs) like the rest.
    const runners = runNested('--test-name-pattern', 'pins the runner and results|names another parent|pre-flight|did not finish|tasks prune|unreadable subtree', join('scripts', 'jev-gate-runners.test.mjs'));
    assert(passed(runners) >= 5, 'the runners answer-file/pre-flight subset ran');
    // No answer-file-named file, and nothing at all, is left behind.
    const answer = new Set(['labels.json', 'inputs.json', 'corpus.sha256', 'manifest.json', 'baselines.json']);
    const leftAnswer = execFileSync('find', [tmp, '-type', 'f'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter(p => answer.has(p.slice(p.lastIndexOf('/') + 1)));
    assert.deepEqual(leftAnswer, [], `answer-file copies left in TMPDIR: ${leftAnswer.join(', ')}`);
    assert.deepEqual(readdirSync(tmp), [], `left behind in TMPDIR: ${readdirSync(tmp).join(', ')}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
