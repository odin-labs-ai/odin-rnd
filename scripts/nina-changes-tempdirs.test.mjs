import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// EXP 006 leaves nothing in the temp directory: its tests (the fast ones; the rehearsal and the e2e use the same
// signal-safe scratch helper) run nested with a private TMPDIR, which must be empty afterwards. And EXP 006's own code
// makes temp dirs only in two places, each removed in a finally and on signals.

test('the EXP 006 tests leave nothing in a private TMPDIR', { timeout: 600_000 }, () => {
  const files = ['census', 'vendored', 'classifier', 'units', 'results6'].map(f => join('scripts', `nina-changes-${f}.test.mjs`));
  const tmp = mkdtempSync(join(tmpdir(), 'nina-changes-tempdirs-'));
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  try {
    const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { env: { ...env, TMPDIR: tmp }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.match(out, /^# fail 0$/m, 'a nested run failed');
    assert.ok(Number(/^# tests (\d+)$/m.exec(out)?.[1] ?? 0) > 30, 'the nested run ran too few tests');
    assert.deepEqual(readdirSync(tmp), [], `left behind in TMPDIR: ${readdirSync(tmp).join(', ')}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('EXP 006 code makes temp dirs only where it removes them, on exit and on signals', () => {
  const dir = 'experiments/nina-changes';
  const makers = readdirSync(dir).filter(f => f.endsWith('.mjs')).filter(f => /mkdtemp(Sync)?\(/.test(readFileSync(join(dir, f), 'utf8'))).sort();
  assert.deepEqual(makers, ['base-lines.mjs', 'run_reviewer6.mjs']);
  const base = readFileSync(join(dir, 'base-lines.mjs'), 'utf8');
  assert.match(base, /finally \{\s*cleanup\(\);/);
  assert.match(base, /\['SIGINT', 'SIGTERM', 'SIGHUP'\]/);
  const runner = readFileSync(join(dir, 'run_reviewer6.mjs'), 'utf8');
  assert.match(runner, /mkdtempSync\(join\(RUN_ROOT6, RUN_PREFIX6\)\)/, 'run dirs live under home, not in the shared temp root');
  assert.match(runner, /rmSync\(parent, \{ recursive: true, force: true \}\);\s*\}\s*\}/, 'every run dir is removed in a finally');
});
