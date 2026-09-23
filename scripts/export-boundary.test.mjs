import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
