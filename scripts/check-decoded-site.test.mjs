// R4 wiring. check.mjs and package.json are both pinned (EXP 006/007 runners.sha256; EXP 007's pre-registration
// record hashes package.json), so neither `pnpm check` nor check.mjs can call the decoding pass. `pnpm test` runs every
// scripts/*.test.mjs in CI, so the pass runs here, over a disposable build of the site (test-build.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { scanDecoded } from './check-decoded.mjs';

test('no built page carries a restricted term written as hex or base64', () => {
  assert.deepEqual(scanDecoded(join(builtCopy(), 'dist')), []);
});
