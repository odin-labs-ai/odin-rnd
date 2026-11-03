import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeWebp } from './webp-probe.mjs';

const pin = JSON.parse(readFileSync('scripts/agent-space-webp.pin.json', 'utf8'));
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('every Lab 01 WebP is a pinned, correctly sized sibling of a pinned original', () => {
  assert.equal(pin.format, 'odin-agent-space-webp-pin');
  assert.equal(pin.version, 1);
  assert.equal(pin.images.length, 9, 'all nine original pictures are pinned');
  assert.equal(new Set(pin.images.map(image => image.original)).size, 9);
  for (const image of pin.images) {
    assert.match(image.original, /^assets\/labs\/agent-space\/(?!.*\.\.)[\w/-]+\.(?:png|jpe?g)$/);
    assert.equal(sha256(join('site', image.original)), image.originalSha256, image.original);
    assert.deepEqual(image.variants.map(v => v.width), [1280, 800], image.original);
    for (const variant of image.variants) {
      assert.equal(variant.path, image.original.replace(/\.(png|jpe?g)$/, `-${variant.width}.webp`));
      assert.equal(variant.height, variant.width === 1280 ? 720 : 450, variant.path);
      const file = join('site', variant.path);
      assert.equal(sha256(file), variant.sha256, variant.path);
      assert.deepEqual(probeWebp(file), { format: 'WebP', width: variant.width, height: variant.height }, variant.path);
    }
  }
});

test('shared WebP blobs are aliases only when the pinned originals have the same bytes', () => {
  const byHash = new Map();
  for (const image of pin.images) for (const variant of image.variants) {
    const group = byHash.get(variant.sha256) ?? [];
    group.push(image);
    byHash.set(variant.sha256, group);
  }
  for (const [hash, images] of byHash) {
    if (images.length > 1) assert.equal(new Set(images.map(image => image.originalSha256)).size, 1, hash);
  }
  const poster = pin.images.find(image => image.original.endsWith('/session-2026-10-25-b/poster.png'));
  const firstStill = pin.images.find(image => image.original.endsWith('/session-2026-10-25-b/stills/01-s1-q1.png'));
  assert.ok(poster && firstStill, 'the dispatch poster and first still are both pinned');
  assert.equal(poster.originalSha256, firstStill.originalSha256, 'the dispatch recorded the same source frame twice');
  assert.deepEqual(poster.variants.map(v => v.sha256), firstStill.variants.map(v => v.sha256));
});
