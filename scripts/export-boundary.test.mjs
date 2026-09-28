import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('public export scanner rejects restricted content in module and downloadable text formats', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'odin-export-check-'));
  try {
    mkdirSync(join(temporary,'scripts'));
    mkdirSync(join(temporary,'dist'));
    for (const file of ['check.mjs','transcript.mjs','recording-provenance.mjs']) copyFileSync(resolve('scripts',file), join(temporary,'scripts',file));
    for (const extension of ['mjs','md','txt']) {
      const file = join(temporary,'dist',`unsafe.${extension}`);
      writeFileSync(file, 'google' + '-analytics');
      const result = spawnSync(process.execPath, ['scripts/check.mjs'], {cwd:temporary, encoding:'utf8'});
      assert.notEqual(result.status,0);
      assert.match(result.stderr, new RegExp(`Restricted or tracking content in dist/unsafe\\.${extension}`));
      rmSync(file);
    }
    writeFileSync(join(temporary,'dist','unapproved.md'), 'https://github.com/sharanda/manrope');
    const misplaced = spawnSync(process.execPath, ['scripts/check.mjs'], {cwd:temporary, encoding:'utf8'});
    assert.notEqual(misplaced.status,0);
    assert.match(misplaced.stderr, /Unexpected public export link/);
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
});

// A sha256 is exempt from the restricted-fingerprint scan only when it hashes a tracked file. The test runs a copy of
// check.mjs whose fingerprint list is replaced by one synthetic fingerprint, so no real restricted term is involved.
test('a sha256 is exempt from the fingerprint scan only when it hashes a tracked file', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'odin-export-hash-'));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: temporary, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  const scan = text => { writeFileSync(join(temporary, 'dist', 'record.json'), text); return spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: temporary, encoding: 'utf8' }).stderr; };
  const blocked = /Restricted or tracking content in dist\/record\.json/;
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  try {
    mkdirSync(join(temporary, 'scripts')); mkdirSync(join(temporary, 'dist'));
    for (const file of ['transcript.mjs', 'recording-provenance.mjs']) copyFileSync(resolve('scripts', file), join(temporary, 'scripts', file));
    // A synthetic fixture and a synthetic term: four characters taken from the fixture's own sha256.
    const fixture = 'synthetic fixture for the tracked-hash exemption\n';
    const digest = sha(fixture), term = digest.slice(20, 24);
    const source = readFileSync(resolve('scripts/check.mjs'), 'utf8');
    const line = /^const restrictedFingerprints = \{.*\};$/m;
    assert.match(source, line, 'check.mjs declares its fingerprints on one line');
    writeFileSync(join(temporary, 'scripts/check.mjs'), source.replace(line, `const restrictedFingerprints = {"4": ["${sha(term)}"]};`));
    writeFileSync(join(temporary, 'fixture.txt'), fixture);
    git('init', '-q');
    // Untracked, the fixture's hash is scanned like any text, and the synthetic term inside it is refused.
    assert.match(scan(`{"sha256":"${digest}"}`), blocked);
    git('add', 'fixture.txt'); git('commit', '-qm', 'fixture');
    // (a) the exact sha256 of the tracked fixture passes
    assert.doesNotMatch(scan(`{"sha256":"${digest}"}`), blocked);
    // (b) a random 64-hex string carrying the same term still fails
    const forged = `${'0'.repeat(30)}${term}${'0'.repeat(30)}`;
    assert.equal(forged.length, 64);
    assert.match(scan(`{"sha256":"${forged}"}`), blocked);
    // (c) a 64-hex string that hashes no tracked file is scanned normally: without the term it passes, with it it fails
    assert.doesNotMatch(scan(`{"sha256":"${'a'.repeat(64)}"}`), blocked);
    assert.match(scan(`{"sha256":"${'b'.repeat(30)}${term}${'b'.repeat(30)}"}`), blocked);
    // Exempt only as a whole token: one more hex digit and it is scanned again.
    assert.match(scan(`{"sha256":"${digest}0"}`), blocked);
    // Exempt only for the tracked content: an edit in the working tree does not move the exemption.
    writeFileSync(join(temporary, 'fixture.txt'), fixture + 'edited\n');
    assert.doesNotMatch(scan(`{"sha256":"${digest}"}`), blocked);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
