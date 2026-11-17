// Pins every Instagram image under site/assets/og/instagram/ to what its name claims.
// Instagram takes JPEG only (4:5 to 1.91:1), and the odin-labs post wrapper (social-post.sh) takes Instagram
// media only as <name>.<first 16 hex of its sha256>.jpg on this site. So each file here must be:
//   - named <slug>.<sha16>.jpg, where sha16 is the first 16 hex of the sha256 of its own bytes;
//   - a baseline or progressive JPEG (starts FF D8 FF) whose frame header says 1200x630, the share-card size;
//   - a re-encode of its lab's committed share card site/assets/og/labs/<slug>.png (that card must exist).
// The folder may be absent or empty; a stray file of any other shape fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('site', 'assets', 'og', 'instagram');
const CARDS = join('site', 'assets', 'og', 'labs');

/** Width and height from the first SOFn frame header of a JPEG; null when there is none. */
export function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    const len = bytes.readUInt16BE(i + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    if (marker === 0xda) return null; // start of scan before any frame header
    i += 2 + len;
  }
  return null;
}

test('every Instagram image is named by its own sha256, is a 1200x630 JPEG, and has its lab card', () => {
  const names = existsSync(DIR) ? readdirSync(DIR).sort() : [];
  for (const name of names) {
    const m = /^([a-z0-9][a-z0-9-]*)\.([0-9a-f]{16})\.jpg$/.exec(name);
    assert.ok(m, `${DIR}/${name}: name must be <slug>.<sha16>.jpg`);
    const bytes = readFileSync(join(DIR, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 16), m[2], `${name}: the sha16 in the name is not the sha256 of its bytes`);
    assert.deepEqual(jpegSize(bytes), { width: 1200, height: 630 }, `${name}: must be a 1200x630 JPEG`);
    assert.ok(existsSync(join(CARDS, `${m[1]}.png`)), `${name}: no share card ${CARDS}/${m[1]}.png to have been re-encoded from`);
  }
});

test('the frame-header reader refuses what is not a JPEG and reads a minimal one', () => {
  assert.equal(jpegSize(Buffer.from('89504e470d0a1a0a', 'hex')), null);
  const sof = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(jpegSize(sof), { width: 1200, height: 630 });
  const app0 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(jpegSize(app0), { width: 32, height: 16 }, 'skips APPn segments; progressive SOF2 counts');
});
