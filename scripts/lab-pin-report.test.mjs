import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinLines, pinReport } from './lab-pin-report.mjs';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const run = root => { try { return { rc: 0, out: execFileSync('node', ['scripts/lab-pin-report.mjs', root], { encoding: 'utf8' }) }; } catch (e) { return { rc: e.status, out: String(e.stdout) }; } };

test('every committed lab record matches its pin, one PIN line each', () => {
  const rows = pinReport('site');
  assert.ok(rows.some(r => r.path.endsWith(join('rogue', 'record.json'))) && rows.some(r => r.path.endsWith(join('review', 'record.json'))));
  for (const l of pinLines(rows)) assert.match(l, /^PIN site\/data\/labs\/[a-z0-9-]+\/record\.json [0-9a-f]{64} [0-9a-f]{64} MATCH$/);
  assert.equal(run('site').rc, 0);
});

test('a changed byte, a missing or malformed pin, or no record at all is a MISMATCH and exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-pin-'));
  try {
    const dir = join(root, 'data', 'labs', 'x');
    mkdirSync(dir, { recursive: true });
    assert.equal(run(root).rc, 1, 'no record');
    writeFileSync(join(dir, 'record.json'), '{"a": 1}\n');
    const nopin = run(root);
    assert.equal(nopin.rc, 1, 'no pin');
    assert.match(nopin.out, /^PIN .*record\.json [0-9a-f]{64} none MISMATCH$/m, 'no pin');
    for (const pin of [`${sha256('{"a": 1}\n')}  other.json\n`, `${sha256('{"a": 1}\n')} record.json\n`, `${sha256('{"a": 1}\n')}  record.json`, `${'0'.repeat(64)}  record.json\n`]) {
      writeFileSync(join(dir, 'record.sha256'), pin);
      const { rc, out } = run(root);
      assert.equal(rc, 1, JSON.stringify(pin));
      assert.match(out, /MISMATCH$/m);
    }
    writeFileSync(join(dir, 'record.sha256'), `${sha256('{"a": 1}\n')}  record.json\n`);
    assert.equal(run(root).rc, 0);
    writeFileSync(join(dir, 'record.json'), '{"a": 2}\n');
    assert.equal(run(root).rc, 1, 'a changed byte');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
