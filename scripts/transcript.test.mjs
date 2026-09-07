import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDemo } from './transcript.mjs';
const sample = 'GREEN conformant: score 100, exit 0\nRED drift: score 60, would exit 1, violation reverse-import\nbce demo: module-layering discriminates GREEN from RED\n';
test('accepts the real released demo output contract', () => assert.equal(parseDemo(sample, 'module-layering', 0).passed, true));
test('rejects a successful process with missing RED or GREEN', () => {
  assert.equal(parseDemo(sample.replace(/^RED.*\n/m, ''), 'module-layering', 0).passed, false);
  assert.equal(parseDemo(sample.replace(/^GREEN.*\n/m, ''), 'module-layering', 0).passed, false);
});
test('rejects stale recipe identity, command failure and changed transcript format', () => {
  assert.equal(parseDemo(sample, 'configuration-allowlist', 0).passed, false);
  assert.equal(parseDemo(sample, 'module-layering', 1).passed, false);
  assert.equal(parseDemo('success', 'module-layering', 0).passed, false);
});
