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

/**
 * Width and height from the first SOFn frame header of a JPEG; null for anything that is not a well-formed one.
 * Refused: no SOI (FF D8 FF) or no EOI (FF D9) at the end; a segment length under 2 or running past the bytes; a SOF
 * segment whose length is not exactly 8 + 3 x its component count, whose precision is not 8, whose component count is
 * not 1, 3 or 4, or whose width or height is 0; a start of scan before any frame header.
 */
export function jpegSize(bytes) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    const len = bytes.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > n) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      if (len < 8) return null;
      const precision = bytes[i + 4];
      const height = bytes.readUInt16BE(i + 5);
      const width = bytes.readUInt16BE(i + 7);
      const components = bytes[i + 9];
      if (precision !== 8 || ![1, 3, 4].includes(components) || len !== 8 + 3 * components || !width || !height) return null;
      return { width, height };
    }
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

// A minimal well-formed SOF0 frame: FF D8, FF C0 length 17 (8 + 3 x 3 components), precision 8, height, width,
// 3 components of 3 bytes each, then FF D9.
const frame = (marker, h, w, extra = []) => Buffer.from([0xff, 0xd8, ...extra, 0xff, marker, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03,
  1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

test('the frame-header reader reads a well-formed frame and skips APPn segments', () => {
  assert.deepEqual(jpegSize(frame(0xc0, 630, 1200)), { width: 1200, height: 630 });
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])), { width: 32, height: 16 }, 'progressive SOF2 after an APP0 segment');
});

test('the frame-header reader refuses what is not a well-formed JPEG (refute row 6b09594a item 28)', () => {
  assert.equal(jpegSize(Buffer.from('89504e470d0a1a0a', 'hex')), null, 'a PNG');
  assert.equal(jpegSize(Buffer.from('ffd8ffc0000008027604b000', 'hex')), null, 'zero-length SOF, no EOI');
  assert.equal(jpegSize(Buffer.from('ffd8ffc0000208027604b000ffd9', 'hex')), null, 'two-byte SOF with no frame payload');
  assert.equal(jpegSize(Buffer.from('ffd8ffc0000b08027604b003ffd9', 'hex')), null, 'SOF length runs past the bytes');
  const bad = (i, v) => { const b = frame(0xc0, 630, 1200); b[i] = v; return b; };
  assert.equal(jpegSize(bad(6, 0x0c)), null, 'precision 12');
  assert.equal(jpegSize(bad(11, 0x02)), null, 'component count 2');
  assert.equal(jpegSize(bad(5, 0x10)), null, 'SOF length not 8 + 3 x components');
  assert.equal(jpegSize(frame(0xc0, 0, 1200)), null, 'zero height');
  { const f = frame(0xc0, 630, 1200); assert.equal(jpegSize(f.subarray(0, f.length - 2)), null, 'no EOI at the end'); }
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])), null, 'scan before any frame');
});
