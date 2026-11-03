import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { probeWebp } from './webp-probe.mjs';

test('the committed lossy WebP headers report their actual dimensions', () => {
  for (const [path, width, height] of [
    ['films/agent-space-30s-poster-1280.webp', 1280, 720],
    ['films/agent-space-tour-poster-800.webp', 800, 450],
    ['session-2026-10-25-b/stills/02-s1-q2-1280.webp', 1280, 720],
  ]) {
    assert.deepEqual(probeWebp(join('site/assets/labs/agent-space', path)), { format: 'WebP', width, height }, path);
  }
  assert.throws(() => probeWebp('site/assets/labs/agent-space/session-2026-10-25-b/poster.png'), /not a WebP RIFF file/);
});
