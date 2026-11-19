// Pins every Instagram image under site/assets/og/instagram/ to what its name claims.
// Instagram takes JPEG only (4:5 to 1.91:1), and the odin-labs post wrapper (social-post.sh) takes Instagram
// media only as <name>.<first 16 hex of its sha256>.jpg on this site. So each file here must be:
//   - named <slug>.<sha16>.jpg, where sha16 is the first 16 hex of the sha256 of its own bytes;
//   - ONE complete baseline or progressive JPEG, from SOI to the EOI that ends the file, whose frame header says
//     1200x630 (the share-card size), carrying no metadata segment other than one plain JFIF APP0 header;
//   - a re-encode of its lab's committed share card site/assets/og/labs/<slug>.png (that card must exist), measured
//     decoded: ffmpeg decodes the JPEG and every card to RGB, and the JPEG must score under fixed thresholds against
//     its own card (whole image and every 16x16 block) and far from every other card (the decoded test below). The publish workflow's "Film copies, decoded" job installs ffmpeg and
//     runs this file with FILM_DECODER_REQUIRED=1, so in CI a missing decoder fails instead of skipping, and verify
//     (which publish depends on) fails unless that job succeeded.
// The folder may be absent or empty; a stray file of any other shape fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join('site', 'assets', 'og', 'instagram');
const CARDS = join('site', 'assets', 'og', 'labs');

// Where each image came from: the exact source card bytes (sha256) at conversion time and how it was made. A
// re-rendered card changes its sha256, so a stale Instagram image fails here instead of drifting silently. That the
// bytes really are that card is the decoded test below, which runs in CI (no recorded measurement is trusted).
const PROVENANCE = {
  'ai-jury.b9d0adfbcbc140f0.jpg': {
    source: 'ai-jury.png',
    sha256: 'b9d0adfbcbc140f068a80434298a2e02a5e081b71aa7a1c9c1bbecb9e10bc701',
    sourceSha256: 'faf758bb982f17389aa9681f71db5d4c4eef0ae08be70e462c10a54a42f62585',
    made: 'sips-316 (macOS 26.6.1): sips -s format jpeg -s formatOptions 92 ai-jury.png; then its APP1 (Exif) and APP13 '
      + '(Photoshop) segments were cut out byte for byte, every other byte kept (the decoded pixels are unchanged)',
  },
};

/**
 * True when the payload [from, to) is exactly a whole number of tables, each sized by tableBytes(at) (-1 = malformed),
 * so a DQT or DHT segment carries its tables and no other bytes.
 */
function tablesFill(bytes, from, to, tableBytes) {
  let at = from;
  if (at >= to) return false;
  while (at < to) {
    const size = tableBytes(at);
    if (size < 0 || at + size > to) return false;
    at += size;
  }
  return at === to;
}

/** A plain JFIF APP0 payload: "JFIF\0", version 1.00-1.02, units 0-2, non-zero densities, a 0x0 thumbnail. */
export function isPlainJfif(p) {
  return p.length === 14 && p.subarray(0, 5).equals(Buffer.from('JFIF\0', 'latin1')) && p[5] === 1 && p[6] <= 2 && p[7] <= 2
    && p.readUInt16BE(8) > 0 && p.readUInt16BE(10) > 0 && p[12] === 0 && p[13] === 0;
}

/**
 * The SHAPE of one baseline (SOF0) or progressive (SOF2) JPEG; null for any other shape. This is a marker walk, not a
 * JPEG validator: it bounds every segment by its length, allows only DQT, DHT, DRI, one plain JFIF APP0, one SOF0/SOF2
 * frame, SOS scans and the EOI that must end the file, and checks the header fields listed below. It does NOT judge
 * table CONTENTS (whether a Huffman table is a valid code, whether quantisation values are sensible) or the
 * entropy-coded data. What the decode adds: ffmpeg -xerror exiting 0 shows that this decoder produced a 1200x630 frame
 * from the file under these flags (CI, FILM_DECODER_REQUIRED=1), and one regression shows it refuses an oversubscribed
 * Huffman table; it is not a proof that every malformed table is refused. The committed image is pinned byte for byte
 * by the full sha256 in PROVENANCE; these shape checks defend a FUTURE file in this folder.
 * Shape checked here:
 *   - every segment's length is at least 2 and stays inside the bytes; the first EOI is the end of the file (a second
 *     image after it, or a second SOI anywhere, is refused);
 *   - exactly one frame header, SOF0 or SOF2, of length 8 + 3 x Nf, precision 8, Nf 1, 3 or 4, non-zero size, distinct
 *     component ids, sampling factors 1-4, quantisation table ids 0-3;
 *   - DQT and DHT segments are a whole number of tables by their declared sizes (no trailing bytes); DRI is 4 bytes;
 *     at most one APP0, exactly a plain 16-byte JFIF header; every other APPn, COM, DAC, DNL or unknown marker refused;
 *   - each SOS comes after the frame, is 6 + 2 x Ns bytes for 1 <= Ns <= Nf, names frame components once each with
 *     table selectors 0-3, and has the spectral selection its frame allows (baseline Ss 0, Se 63, Ah = Al = 0;
 *     progressive DC Ss = Se = 0 with AC selectors 0, or one-component AC 1 <= Ss <= Se <= 63 with DC selector 0;
 *     Ah, Al <= 13); the entropy-coded data after it is skipped (FF 00 and RST0-7 stay inside it); at least one scan.
 */
export function jpegSize(bytes) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let size = null, scans = 0, jfif = 0, i = 2;
  for (;;) {
    if (i + 2 > n || bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte before a marker
    if (marker === 0xd9) return i + 2 === n && size && scans > 0 ? { width: size.width, height: size.height } : null;
    if (i + 4 > n) return null;
    const len = bytes.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > n) return null;
    const anySof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (anySof) {
      if ((marker !== 0xc0 && marker !== 0xc2) || size) return null;
      if (len < 8) return null;
      const precision = bytes[i + 4];
      const height = bytes.readUInt16BE(i + 5);
      const width = bytes.readUInt16BE(i + 7);
      const components = bytes[i + 9];
      if (precision !== 8 || ![1, 3, 4].includes(components) || len !== 8 + 3 * components || !width || !height) return null;
      const ids = [];
      for (let k = 0; k < components; k += 1) {
        const id = bytes[i + 10 + 3 * k], h = bytes[i + 11 + 3 * k] >> 4, v = bytes[i + 11 + 3 * k] & 15, tq = bytes[i + 12 + 3 * k];
        if (ids.includes(id) || h < 1 || h > 4 || v < 1 || v > 4 || tq > 3) return null; // distinct ids, sampling 1-4, table 0-3
        ids.push(id);
      }
      size = { width, height, components, ids, progressive: marker === 0xc2 };
    } else if (marker === 0xda) {
      if (!size) return null;
      const ns = len >= 3 ? bytes[i + 4] : 0;
      if (ns < 1 || ns > 4 || ns > size.components || len !== 6 + 2 * ns) return null;
      const ss = bytes[i + 5 + 2 * ns], se = bytes[i + 6 + 2 * ns], ah = bytes[i + 7 + 2 * ns] >> 4, al = bytes[i + 7 + 2 * ns] & 15;
      if (!size.progressive && (ss !== 0 || se !== 63 || ah !== 0 || al !== 0)) return null;
      if (size.progressive && (ss === 0 ? se !== 0 : (se < ss || se > 63 || ns !== 1))) return null;
      const seen = [];
      for (let k = 0; k < ns; k += 1) {
        const id = bytes[i + 5 + 2 * k], tables = bytes[i + 6 + 2 * k];
        if (!size.ids.includes(id) || seen.includes(id) || (tables >> 4) > 3 || (tables & 15) > 3) return null; // a frame component, once; tables 0-3
        seen.push(id);
        if (size.progressive && ss === 0 && (tables & 15) !== 0) return null; // a DC scan selects no AC table
        if (size.progressive && ss !== 0 && (tables >> 4) !== 0) return null; // an AC scan selects no DC table
      }
      if (ah > 13 || al > 13) return null;
      scans += 1;
      i += 2 + len;
      // Entropy-coded data: FF 00 (a stuffed FF) and FF D0-D7 (restart markers) belong to it; FF FF is fill.
      for (;;) {
        if (i + 1 >= n) return null;
        if (bytes[i] === 0xff) {
          const next = bytes[i + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { i += 2; continue; }
          if (next === 0xff) { i += 1; continue; }
          break;
        }
        i += 1;
      }
      continue;
    } else if (marker === 0xe0) {
      if (!isPlainJfif(bytes.subarray(i + 4, i + 2 + len)) || ++jfif > 1) return null;
    } else if (marker === 0xdd) {
      if (len !== 4) return null; // DRI: exactly the two-byte restart interval
    } else if (marker === 0xdb) {
      if (!tablesFill(bytes, i + 4, i + 2 + len, (at) => { const pq = bytes[at] >> 4; return pq > 1 || (bytes[at] & 15) > 3 ? -1 : 1 + 64 * (pq + 1); })) return null;
    } else if (marker === 0xc4) {
      if (!tablesFill(bytes, i + 4, i + 2 + len, (at) => {
        if (bytes[at] >> 4 > 1 || (bytes[at] & 15) > 3 || at + 17 > n) return -1;
        let count = 0;
        for (let k = 1; k <= 16; k += 1) count += bytes[at + k];
        return count > 256 ? -1 : 17 + count;
      })) return null;
    } else {
      return null; // SOI again, APP1-15, COM, DAC, DNL, RSTn outside a scan, or anything unknown
    }
    i += 2 + len;
  }
}

test('every Instagram image is named by its own sha256, is a 1200x630 JPEG, and has its lab card', () => {
  const names = existsSync(DIR) ? readdirSync(DIR).sort() : [];
  for (const name of names) {
    const m = /^([a-z0-9][a-z0-9-]*)\.([0-9a-f]{16})\.jpg$/.exec(name);
    assert.ok(m, `${DIR}/${name}: name must be <slug>.<sha16>.jpg`);
    const bytes = readFileSync(join(DIR, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 16), m[2], `${name}: the sha16 in the name is not the sha256 of its bytes`);
    assert.deepEqual(jpegSize(bytes), { width: 1200, height: 630 }, `${name}: must be a 1200x630 baseline or progressive JPEG`);
    assert.ok(existsSync(join(CARDS, `${m[1]}.png`)), `${name}: no share card ${CARDS}/${m[1]}.png to have been re-encoded from`);
    const prov = PROVENANCE[name];
    assert.ok(prov, `${name}: no PROVENANCE entry (source card sha256 + how it was made)`);
    assert.equal(prov.source, `${m[1]}.png`, `${name}: provenance names another card`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), prov.sha256, `${name}: its full sha256 is not the recorded one (the name pins only the first 64 bits)`);
    assert.equal(createHash('sha256').update(readFileSync(join(CARDS, prov.source))).digest('hex'), prov.sourceSha256,
      `${name}: ${CARDS}/${prov.source} changed since this image was made from it — re-make the image (stale)`);
  }
  for (const name of Object.keys(PROVENANCE)) assert.ok(names.includes(name), `PROVENANCE names ${name}, which is not in ${DIR}`);
});

// A minimal well-formed SOF0 frame: FF D8, FF C0 length 17 (8 + 3 x 3 components), precision 8, height, width,
// 3 components of 3 bytes each, a baseline start of scan (FF DA, length 12, Ss 0, Se 63, Ah/Al 0), two bytes of
// entropy-coded data, then FF D9. A progressive frame gets a DC first scan (Ss 0, Se 0) instead.
const SOS = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34];
const SOS_DC = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0x00, 2, 0x10, 3, 0x10, 0x00, 0x00, 0x00, 0x12, 0x34];
// A plain JFIF APP0: "JFIF\0", version 1.01, units 0, density 72 x 72, no thumbnail (the committed image's own header).
const JFIF = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00];
const frame = (marker, h, w, extra = [], scan = marker === 0xc2 ? SOS_DC : SOS) => Buffer.from([0xff, 0xd8, ...extra, 0xff, marker, 0x00, 0x11, 0x08,
  h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, ...scan, 0xff, 0xd9]);

test('the frame-header reader reads a well-formed frame and skips one plain JFIF header', () => {
  assert.deepEqual(jpegSize(frame(0xc0, 630, 1200)), { width: 1200, height: 630 });
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, JFIF)), { width: 32, height: 16 }, 'progressive SOF2 (DC scan) after a JFIF APP0');
});

test('an APP0 must be exactly one plain JFIF header; no APP2 (refute row edee1a29 #10)', () => {
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])), null, 'an APP0 of two zero bytes');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xe2, 0x00, 0x04, 0x00, 0x00])), null, 'an APP2 segment');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [...JFIF, ...JFIF])), null, 'two JFIF headers');
  const bad = (at, v) => { const j = [...JFIF]; j[at] = v; return frame(0xc0, 630, 1200, j); };
  assert.equal(jpegSize(bad(4, 0x58)), null, 'not "JFIF"');
  assert.equal(jpegSize(bad(10, 0x05)), null, 'version 1.05');
  assert.equal(jpegSize(bad(16, 0x02)), null, 'a 2-pixel-wide thumbnail');
  assert.equal(jpegSize(bad(13, 0x00)), null, 'a zero X density');
  const longer = [0xff, 0xe0, 0x00, 0x12, ...JFIF.slice(4), 0x41, 0x42];
  assert.equal(jpegSize(frame(0xc0, 630, 1200, longer)), null, 'a JFIF header with extra bytes');
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

test('only baseline or progressive frames, every segment up to the scan checked (refute row b5b289e4 #93-#96)', () => {
  for (const m of [0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    assert.equal(jpegSize(frame(m, 630, 1200)), null, `SOF 0x${m.toString(16)} refused`);
  }
  const f = frame(0xc0, 630, 1200);
  const head = f.subarray(0, f.length - 2 - SOS.length); // SOI + SOF0, no scan
  const tail = Buffer.from([...SOS, 0xff, 0xd9]);
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffe00001', 'hex'), tail])), null, 'APP0 of length 1 after the frame');
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffe0ffff', 'hex'), tail])), null, 'APP0 running past the bytes after the frame');
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffd9', 'hex')])), null, 'no start of scan at all');
  assert.equal(jpegSize(Buffer.concat([head, head.subarray(2), tail])), null, 'a second frame header');
  assert.deepEqual(jpegSize(Buffer.concat([head, Buffer.from(JFIF), tail])), { width: 1200, height: 630 }, 'a plain JFIF APP0 after the frame is fine');
});

test('the start-of-scan header must be well formed (refute row 2fea6878 #1)', () => {
  const f = frame(0xc0, 630, 1200);
  const head = f.subarray(0, f.length - 2 - SOS.length);
  const eoi = Buffer.from('ffd9', 'hex');
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffda0002', 'hex'), eoi])), null, 'SOS with no component count');
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffda000300', 'hex'), eoi])), null, 'SOS with Ns = 0');
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffda000c040100021103110000', 'hex'), eoi])), null, 'SOS length not 6 + 2 x Ns');
  assert.equal(jpegSize(Buffer.concat([head, Buffer.from('ffda000e040100021103110411003f00', 'hex'), eoi])), null, 'Ns 4 for a 3-component frame');
  assert.deepEqual(jpegSize(Buffer.concat([head, Buffer.from('ffda0008010100003f00', 'hex'), eoi])), { width: 1200, height: 630 }, 'a one-component scan is fine');
});

test('the scan parameters must fit the frame type (refute row f67ac5a8 #3)', () => {
  const scan = (ss, se, ahal = 0, ns = 3) => [0xff, 0xda, 0x00, 6 + 2 * ns, ns, ...[1, 0x00, 2, 0x11, 3, 0x11].slice(0, 2 * ns), ss, se, ahal, 0x12, 0x34];
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(0, 63))), null, 'a progressive frame with a baseline-shaped scan (Ss 0, Se 63)');
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, [], SOS_DC)), { width: 32, height: 16 }, 'a progressive DC scan, AC selectors 0');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(0, 0))), null, 'a progressive DC scan that selects AC table 1 (refute row edee1a29 #3)');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], [0xff, 0xda, 0x00, 0x08, 0x01, 1, 0x10, 1, 63, 0x00, 0x12, 0x34])), null, 'a progressive AC scan that selects DC table 1');
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, [], [0xff, 0xda, 0x00, 0x08, 0x01, 1, 0x00, 1, 63, 0x00, 0x12, 0x34])), { width: 32, height: 16 }, 'a progressive AC scan of one component');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(1, 63, 0, 3))), null, 'a progressive AC scan of three components');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(5, 4, 0, 1))), null, 'Se below Ss');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0x00, 2, 0x10, 3, 0x10, 0x00, 0x00, 0xe0, 0x12, 0x34])), null, 'Ah 14');
  assert.equal(jpegSize(frame(0xc0, 16, 32, [], scan(0, 0))), null, 'a baseline frame with Se 0');
  assert.equal(jpegSize(frame(0xc0, 16, 32, [], scan(0, 63, 0x01))), null, 'a baseline frame with Al 1');
});

test('every table segment holds exactly its tables; component ids and selectors are consistent (refute row c63c8d5a #11)', () => {
  const dqt = [0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(1)];
  const dht = [0xff, 0xc4, 0x00, 0x14, 0x00, 1, ...Array(15).fill(0), 0x00];
  assert.deepEqual(jpegSize(frame(0xc0, 630, 1200, [...dqt, ...dht, 0xff, 0xdd, 0x00, 0x04, 0x00, 0x00])), { width: 1200, height: 630 }, 'a DQT, a DHT and a DRI of the right sizes');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xdd, 0x00, 0x06, 0x00, 0x00, 0xab, 0xcd])), null, 'a DRI with two extra bytes');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xdd, 0x00, 0x02])), null, 'a DRI with no interval');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xdb, 0x00, 0x44, 0x00, ...Array(65).fill(1)])), null, 'a DQT with one extra byte');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xdb, 0x00, 0x43, 0x20, ...Array(64).fill(1)])), null, 'a DQT of precision 2');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xc4, 0x00, 0x15, 0x00, 1, ...Array(15).fill(0), 0x00, 0x99])), null, 'a DHT with one extra byte');
  assert.equal(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xc4, 0x00, 0x14, 0x20, 1, ...Array(15).fill(0), 0x00])), null, 'a DHT of class 2');
  const f = frame(0xc0, 630, 1200);
  const at = f.indexOf(Buffer.from([0xff, 0xc0])) + 10; // first component id
  { const b = Buffer.from(f); b[at + 3] = b[at]; assert.equal(jpegSize(b), null, 'two frame components with the same id'); }
  { const b = Buffer.from(f); b[at + 1] = 0x50; assert.equal(jpegSize(b), null, 'a sampling factor of 5'); }
  { const b = Buffer.from(f); const sos = b.indexOf(Buffer.from([0xff, 0xda])); b[sos + 5] = 9; assert.equal(jpegSize(b), null, 'a scan naming a component the frame does not have'); }
  { const b = Buffer.from(f); const sos = b.indexOf(Buffer.from([0xff, 0xda])); b[sos + 7] = 1; assert.equal(jpegSize(b), null, 'a scan naming one component twice'); }
});

test('one complete image and no metadata segments (refute row f67ac5a8 #1 and the APP13 finding)', () => {
  const one = frame(0xc0, 630, 1200);
  assert.equal(jpegSize(Buffer.concat([one, one])), null, 'two JPEGs back to back');
  assert.equal(jpegSize(Buffer.concat([one, frame(0xc0, 16, 32)])), null, 'a second, different JPEG after the first');
  assert.equal(jpegSize(Buffer.concat([one, Buffer.from('00', 'hex')])), null, 'a byte after the EOI');
  const name = readdirSync(DIR).find(n => n.endsWith('.jpg'));
  const real = readFileSync(join(DIR, name));
  assert.deepEqual(jpegSize(real), { width: 1200, height: 630 }, 'the committed image itself');
  assert.equal(jpegSize(Buffer.concat([real, real])), null, 'the committed image twice');
  for (const [label, seg] of [['APP1 (Exif)', 'ffe1000645786966'], ['APP2 (ICC)', 'ffe200040000'], ['APP13 (Photoshop)', 'ffed00040000'], ['COM', 'fffe000400ff'], ['DAC', 'ffcc00040000'], ['DNL', 'ffdc00040000']]) {
    assert.equal(jpegSize(frame(0xc0, 630, 1200, [...Buffer.from(seg, 'hex')])), null, `${label} refused`);
  }
  { const b = Buffer.from(one); const at = b.length - 2 - 2; b[at] = 0xff; b[at + 1] = 0xd8; assert.equal(jpegSize(b), null, 'a second SOI inside the data'); }
  { const b = Buffer.from(one); const at = b.length - 2 - 2; b[at] = 0xff; b[at + 1] = 0xd3; assert.deepEqual(jpegSize(b), { width: 1200, height: 630 }, 'a restart marker inside the data is data'); }
});

// The decoded comparison. ffmpeg decodes each image to 8-bit RGB (rgb24) at its own size; a score is the mean
// absolute difference per channel value (0-255). An Instagram image passes only when it is the same size as its own
// card, scores under OWN_MAX against it over the whole image and under OWN_BLOCK_MAX in EVERY 16x16 block, and scores
// more than OTHER_FACTOR times its own whole-image score (and at least OTHER_MIN) against EVERY other committed card.
// That is all it measures: decoded similarity at these thresholds. A local edit is caught only if it moves some 16x16
// block's mean past OWN_BLOCK_MAX; a small one (a punctuation mark, a few pixels) can pass. It does not prove which
// program made the bytes (that is the PROVENANCE line, author-recorded); the founder sees the image itself in the
// post preview before any Instagram post.
// Measured (ffmpeg 8, the committed ai-jury image): whole image 0.453 to its card; worst 16x16 block 14.724; nearest
// other card 7.169.
const OWN_MAX = 2;
const BLOCK = 16;
const OWN_BLOCK_MAX = 24;
const OTHER_FACTOR = 4;
const OTHER_MIN = 2;
const has = tool => { try { execFileSync(tool, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const required = process.env.FILM_DECODER_REQUIRED === '1';
const decoders = has('ffmpeg') && has('ffprobe');
const decoderSkip = !required && !decoders && 'ffmpeg or ffprobe is not installed';

/** Decodes an image file to { width, height, rgb } with ffmpeg; throws when ffmpeg fails or the size is off. */
export function decodeRgb(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  assert.equal(probe.status, 0, `ffprobe exited ${probe.status} on ${file}: ${probe.stderr}`);
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  assert.ok(width > 0 && height > 0, `${file}: ffprobe gave no size`);
  const run = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
  // A spawn error or a signal is a decoder FAULT, never a refusal: only a numeric exit status reaches "ffmpeg exited".
  assert.ok(!run.error, `ffmpeg could not run on ${file}: ${run.error && run.error.message}`);
  assert.equal(run.signal, null, `ffmpeg was killed by ${run.signal} decoding ${file}`);
  assert.equal(typeof run.status, 'number', `ffmpeg gave no exit status decoding ${file}`);
  assert.equal(run.status, 0, `ffmpeg exited ${run.status} decoding ${file}: ${run.stderr}`);
  assert.equal(run.stdout.length, width * height * 3, `${file}: decoded ${run.stdout.length} bytes, expected ${width}x${height}x3`);
  return { width, height, rgb: run.stdout };
}

/** Mean absolute difference per channel value of two same-size decoded images. */
export function meanAbsDiff(a, b) {
  assert.ok(a.width === b.width && a.height === b.height, `size differs: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  let sum = 0;
  for (let i = 0; i < a.rgb.length; i += 1) sum += Math.abs(a.rgb[i] - b.rgb[i]);
  return sum / a.rgb.length;
}

/** The worst mean absolute difference over the BLOCK x BLOCK blocks of two same-size decoded images, and where. */
export function worstBlock(a, b) {
  assert.ok(a.width === b.width && a.height === b.height, 'size differs');
  let worst = { diff: 0, x: 0, y: 0 };
  for (let by = 0; by < a.height; by += BLOCK) {
    for (let bx = 0; bx < a.width; bx += BLOCK) {
      let sum = 0, count = 0;
      for (let y = by; y < Math.min(by + BLOCK, a.height); y += 1) {
        for (let x = bx; x < Math.min(bx + BLOCK, a.width); x += 1) {
          for (let c = 0; c < 3; c += 1) { const i = (y * a.width + x) * 3 + c; sum += Math.abs(a.rgb[i] - b.rgb[i]); count += 1; }
        }
      }
      if (sum / count > worst.diff) worst = { diff: sum / count, x: bx, y: by };
    }
  }
  return worst;
}

/** Problems with an image claimed to be a re-encode of `own`, given the decoded other cards; [] when it is. */
export function decodedProblems(image, own, others) {
  if (image.width !== own.width || image.height !== own.height) return [`size ${image.width}x${image.height}, its card is ${own.width}x${own.height}`];
  const problems = [], toOwn = meanAbsDiff(image, own);
  if (!(toOwn < OWN_MAX)) problems.push(`mean abs diff ${toOwn.toFixed(3)} to its own card, must be under ${OWN_MAX}`);
  const block = worstBlock(image, own);
  if (!(block.diff < OWN_BLOCK_MAX)) problems.push(`block at ${block.x},${block.y}: mean abs diff ${block.diff.toFixed(3)} to its own card, must be under ${OWN_BLOCK_MAX} in every ${BLOCK}x${BLOCK} block`);
  // A card of another size cannot be confused with the image, so it is not scored; at least one card of the same size
  // must be, or the "far from every other card" half proves nothing.
  const sameSize = others.filter(([, o]) => o.width === image.width && o.height === image.height);
  if (sameSize.length === 0) problems.push('no other card of the same size to compare against');
  for (const [name, other] of sameSize) {
    const toOther = meanAbsDiff(image, other);
    if (!(toOther > OTHER_FACTOR * toOwn && toOther >= OTHER_MIN)) problems.push(`mean abs diff ${toOther.toFixed(3)} to ${name} is not more than ${OTHER_FACTOR} x ${toOwn.toFixed(3)} (and at least ${OTHER_MIN})`);
  }
  return problems;
}

test('a decoder is present wherever one is required', () => {
  if (required) assert.ok(decoders, 'FILM_DECODER_REQUIRED is set but ffmpeg or ffprobe is missing');
});

const decodedCards = () => new Map(readdirSync(CARDS).filter(n => n.endsWith('.png')).sort().map(n => [n, decodeRgb(join(CARDS, n))]));

test('every Instagram image decodes to its own share card and not to any other card (ffmpeg)', { skip: decoderSkip }, () => {
  const names = existsSync(DIR) ? readdirSync(DIR).sort() : [];
  const cards = decodedCards();
  for (const name of names) {
    const slug = name.split('.')[0];
    const own = cards.get(`${slug}.png`);
    assert.ok(own, `${name}: no card ${slug}.png`);
    const others = [...cards].filter(([n]) => n !== `${slug}.png`);
    assert.ok(others.length > 0, 'no other card to compare against');
    assert.deepEqual(decodedProblems(decodeRgb(join(DIR, name)), own, others), [], name);
  }
});

test('the decoded comparison refuses an image of another card, a blank, and a wrong size (ffmpeg)', { skip: decoderSkip }, () => {
  const cards = decodedCards();
  const names = [...cards.keys()];
  assert.ok(names.length >= 3, 'needs at least three cards');
  const [a, b] = names;
  const othersOf = n => [...cards].filter(([k]) => k !== n);
  assert.deepEqual(decodedProblems(cards.get(a), cards.get(a), othersOf(a)), [], 'a card is its own re-encode');
  assert.ok(decodedProblems(cards.get(b), cards.get(a), othersOf(a)).length > 0, `${b} passed as a re-encode of ${a}`);
  const own = cards.get(a);
  const blank = { width: own.width, height: own.height, rgb: Buffer.alloc(own.rgb.length) };
  assert.ok(decodedProblems(blank, own, othersOf(a)).length > 0, 'a black image passed');
  const small = { width: own.width / 2, height: own.height, rgb: own.rgb.subarray(0, own.rgb.length / 2) };
  assert.ok(decodedProblems(small, own, othersOf(a))[0].startsWith('size'), 'a wrong size passed');
  assert.deepEqual(decodedProblems(own, own, []), ['no other card of the same size to compare against'], 'no control card passed');
});

/** Offset of the first segment with this marker, found by walking segment lengths from SOI (never a raw byte search). */
function segmentAt(bytes, marker) {
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff && bytes[i + 1] !== 0xda) {
    if (bytes[i + 1] === marker) return i;
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return -1;
}

test('a table the shape walk accepts but no decoder can use is refused by the decode (ffmpeg -xerror)', { skip: decoderSkip }, () => {
  const name = 'ai-jury.b9d0adfbcbc140f0.jpg'; // the named committed asset, not whichever file sorts first
  const bytes = Buffer.from(readFileSync(join(DIR, name)));
  // The first DHT's code-length counts, rewritten to three 1-bit codes (only two exist) with the same total, so the
  // segment keeps its exact size: an oversubscribed Huffman table (refute row 51ca87d0 #12). The DHT is found at a
  // segment boundary by walking lengths, and must be a DC/AC table header.
  const dht = segmentAt(bytes, 0xc4);
  assert.ok(dht > 0 && (bytes[dht + 4] >> 4) <= 1, 'no DHT segment before the scan');
  const at = dht + 5;
  const counts = [...bytes.subarray(at, at + 16)];
  let move = 3 - counts[0];
  counts[0] = 3;
  for (let k = 15; k > 0 && move > 0; k -= 1) { const take = Math.min(counts[k], move); counts[k] -= take; move -= take; }
  Buffer.from(counts).copy(bytes, at);
  assert.deepEqual(jpegSize(bytes), { width: 1200, height: 630 }, 'the shape walk does not judge table contents');
  const dir = mkdtempSync(join(tmpdir(), 'og-ig-'));
  try {
    const file = join(dir, 'oversubscribed.jpg');
    writeFileSync(file, bytes);
    // A clean refusal: a numeric, nonzero exit status (a crash or a spawn error fails decodeRgb with another message).
    assert.throws(() => decodeRgb(file), /ffmpeg exited [1-9]\d* decoding/, 'ffmpeg -xerror must refuse an oversubscribed Huffman table with a nonzero exit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the other-card half and the block half each refuse on their own (refute row f67ac5a8 #4, #5)', { skip: decoderSkip }, () => {
  const cards = decodedCards();
  const name = 'ai-jury.b9d0adfbcbc140f0.jpg';
  const own = cards.get(`${name.split('.')[0]}.png`);
  const image = decodeRgb(join(DIR, name));
  // Close to its own card, and just as close to a competing card: only the other-card loop can refuse it.
  const twin = { ...own, rgb: Buffer.from(own.rgb) };
  const onlyTwin = decodedProblems(image, own, [['twin.png', twin]]);
  assert.equal(onlyTwin.length, 1, onlyTwin.join('; '));
  assert.match(onlyTwin[0], /to twin\.png is not more than/);
  // A 32x32 patch over the card's own text (copied from a plain area), at a place no block grid line is aligned to: the
  // whole-image mean stays under OWN_MAX, so only the block check can refuse it, and the block it reports overlaps the
  // patch (overlap, not containment, is what is asserted). This pins that the block check runs; it
  // is not a claim that every local edit is caught.
  const worst = worstBlock(image, own);
  const patched = { ...image, rgb: Buffer.from(image.rgb) };
  const clamp = (v, max) => Math.min(Math.max(0, v), max);
  const x0 = clamp(worst.x - 7, image.width - 32), y0 = clamp(worst.y - 7, image.height - 32);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) for (let c = 0; c < 3; c += 1) {
    patched.rgb[((y0 + y) * image.width + x0 + x) * 3 + c] = own.rgb[((5 + y) * image.width + 5 + x) * 3 + c];
  }
  assert.ok(meanAbsDiff(patched, own) < OWN_MAX, 'the patch must leave the whole-image mean under OWN_MAX for this test to mean anything');
  const patchedProblems = decodedProblems(patched, own, [...cards].filter(([k]) => k !== `${name.split('.')[0]}.png`));
  assert.equal(patchedProblems.length, 1, `only the block check may refuse it: ${patchedProblems.join('; ')}`);
  const where = /^block at (\d+),(\d+):/.exec(patchedProblems[0]);
  assert.ok(where, patchedProblems[0]);
  const [bx, by] = [Number(where[1]), Number(where[2])];
  assert.ok(bx + BLOCK > x0 && bx < x0 + 32 && by + BLOCK > y0 && by < y0 + 32, `the refused block ${bx},${by} does not overlap the patch at ${x0},${y0}`);
});

// The CI wiring this file's decoded claims rest on: .github/workflows/publish.yml's "Film copies, decoded" job, pinned
// BYTE FOR BYTE (the film-fallbacks test pins verify's dependency on it and the deploy chain). The decoder step names
// its own shell (bash), so a workflow defaults.run.shell cannot change how it runs. The pinned text must be the jobs
// mapping's film-copies entry: a single plain `jobs:` line at column 0, the job line after it and before the next
// column-0 key, every job key in that block plain (no quoted or escaped key that could be a second film-copies), and no
// other line anywhere naming a film-copies key. The file may hold no line break other than LF (YAML also breaks lines
// on CR, and YAML 1.1 on NEL, LS and PS). This is a text guard, not a YAML parser: it fails closed on the shapes above;
// anything subtler (a workflow-level env that changes how node runs, for example) is for the review of the workflow
// change itself.
const FILM_JOB = [
  "  film-copies:",
  "    name: Film copies, decoded",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
  "        with:",
  "          persist-credentials: false",
  "      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
  "        with:",
  "          node-version: '22'",
  "      - name: Install ffmpeg",
  "        run: |",
  "          sudo apt-get update -q",
  "          sudo apt-get install -y -q --no-install-recommends ffmpeg",
  "          ffmpeg -version | head -1",
  "      - name: Decode every film copy and check it against its WebM and its record",
  "        env:",
  "          FILM_DECODER_REQUIRED: '1'",
  "        run: node --test scripts/film-fallbacks.test.mjs",
  "      # The same decoder proves each Instagram image (site/assets/og/instagram/) decodes to its own lab share card and",
  "      # to no other card (scripts/og-instagram.test.mjs pins this step).",
  "      - name: Decode every Instagram image and compare it with its share card",
  "        shell: bash",
  "        env:",
  "          FILM_DECODER_REQUIRED: '1'",
  "        run: node --test scripts/og-instagram.test.mjs",
].join('\n');
/**
 * The workflow PARSED by a YAML parser (Ruby's Psych, YAML.safe_load: aliases and custom tags refused), as
 * JSON; null when ruby is missing; an object { error } when the file does not parse under those rules. Ruby ships on
 * the GitHub ubuntu runners and macOS; a missing ruby is a failure of the workflow check, never a fallback to text.
 */
export function parsedWorkflow(text) {
  const run = spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'print JSON.generate(YAML.safe_load($stdin.read))'], { input: text, encoding: 'utf8' });
  if (run.error && run.error.code === 'ENOENT') return null;
  if (run.status !== 0) return { error: (run.stderr || '').split('\n').find(l => l.trim()) || `ruby exited ${run.status}` };
  return JSON.parse(run.stdout);
}

/**
 * Every mapping key in the workflow whose DECODED value is `<<` (a merge key in any spelling: plain, quoted, escaped,
 * explicit `? <<`), read from Psych's node tree before any merge is applied; null when ruby is missing; an object
 * { error } when the file does not parse.
 */
export function mergeKeysIn(text) {
  const walk = 'def w(n, a); if n.is_a?(Psych::Nodes::Mapping); n.children.each_slice(2) { |k, _| a << k.value if k.is_a?(Psych::Nodes::Scalar) && k.value == "<<" }; end; (n.children || []).each { |c| w(c, a) }; a; end; print JSON.generate(w(Psych.parse_stream($stdin.read), []).length)';
  const run = spawnSync('ruby', ['-ryaml', '-rjson', '-e', walk], { input: text, encoding: 'utf8' });
  if (run.error && run.error.code === 'ENOENT') return null;
  if (run.status !== 0) return { error: (run.stderr || '').split('\n').find(l => l.trim()) || `ruby exited ${run.status}` };
  return JSON.parse(run.stdout);
}

export function ogStepProblems(text) {
  const problems = [];
  // Bound to the PARSED job, not to text: whatever the spelling, indentation or scalar tricks, the jobs mapping's
  // film-copies entry must be the pinned job, parsed the same way.
  const parsed = parsedWorkflow(text);
  if (parsed === null) {
    problems.push('ruby (the YAML parser this check binds to) is missing: the workflow check cannot run without it');
  } else if (parsed.error) {
    problems.push(`the workflow does not parse as plain YAML (no aliases or custom tags): ${parsed.error}`);
  } else {
    const pinned = parsedWorkflow(`jobs:\n${FILM_JOB}\n`);
    const job = parsed && typeof parsed.jobs === 'object' && parsed.jobs ? parsed.jobs['film-copies'] : undefined;
    if (JSON.stringify(job) !== JSON.stringify(pinned.jobs['film-copies'])) problems.push('the parsed jobs.film-copies is not the pinned job (parsed)');
  }
  if (/[\r\u0085\u2028\u2029]/.test(text)) problems.push('the workflow holds a line break other than LF (CR, NEL, LS or PS)');
  // safe_load refuses an alias but still applies a merge key whose value is an inline mapping, so merge keys are
  // refused anywhere in the file: by the decoded key in Psych's node tree (any spelling), and as text.
  const merges = parsed === null ? null : mergeKeysIn(text);
  if (/(^|[\s{,\-?])["']?<<["']?\s*:/m.test(text) || (typeof merges === 'number' && merges > 0)) problems.push('the workflow uses a YAML merge key (<<)');
  const lines = text.split('\n');
  const jobsAt = lines.reduce((at, l, i) => (/^["']?jobs["']?\s*:/.test(l) ? [...at, i] : at), []);
  if (jobsAt.length !== 1 || lines[jobsAt[0]] !== 'jobs:') return [...problems, 'expected exactly one plain `jobs:` mapping line'];
  let jobsEnd = lines.findIndex((l, i) => i > jobsAt[0] && /^\S/.test(l) && !/^#/.test(l));
  if (jobsEnd < 0) jobsEnd = lines.length;
  for (let i = jobsAt[0] + 1; i < jobsEnd; i += 1) {
    if (/^  \S/.test(lines[i]) && !/^  #/.test(lines[i]) && !/^  [a-z][a-z0-9_-]*:\s*$/.test(lines[i])) problems.push(`a job key that is not a plain name: ${lines[i].trim()}`);
  }
  const named = lines.reduce((at, l, i) => (/film(?:-|\\u002d|\\x2d|\\U0000002d)copies["']?\s*:/i.test(l) ? [...at, i] : at), []);
  const starts = named.filter(i => lines[i] === '  film-copies:' && i > jobsAt[0] && i < jobsEnd);
  if (named.length !== 1 || starts.length !== 1) return [...problems, `expected exactly one film-copies job (a plain key in the jobs mapping), found ${named.length} key line(s)`];
  const start = starts[0];
  let end = lines.findIndex((l, i) => i > start && /^  \S/.test(l) && !/^  #/.test(l));
  if (end < 0) end = lines.length;
  while (end > start + 1 && lines[end - 1] === '') end -= 1; // the file's final LF (job last) is not part of the job
  if (lines.slice(start, end).join('\n') !== FILM_JOB) problems.push('the film-copies job is not byte for byte the pinned job that runs scripts/og-instagram.test.mjs with FILM_DECODER_REQUIRED=1');
  return problems;
}

test('the parsed binding alone refuses a decoy the text checks are not needed for (refute row c80293e3 #2)', () => {
  const text = readFileSync('.github/workflows/publish.yml', 'utf8');
  const lines = text.split('\n');
  // The real film-copies job is replaced by a one-space-indented, escaped key with no steps, while the pinned job text
  // survives line for line (every line indented two more spaces) inside a quoted scalar of another job.
  const decoy = [' decoy:', '  name: "x', ...FILM_JOB.split('\n').map(l => `  ${l}`), '  "', '  runs-on: ubuntu-latest', '  steps: []',
    ' "film\\u002dcopies":', '  runs-on: ubuntu-latest', '  steps: []'];
  // (The other jobs are dropped: at one-space indentation they would nest under the decoy.)
  const attacked = [...lines.slice(0, lines.indexOf('jobs:') + 1), ...decoy, ''].join('\n');
  assert.ok(attacked.includes(FILM_JOB.split('\n').map(l => `  ${l}`).join('\n')), 'the decoy must carry every pinned line, indented two spaces');
  const parsed = parsedWorkflow(attacked);
  assert.ok(parsed && !parsed.error, 'the decoy must be valid YAML for this test to mean anything');
  assert.deepEqual(parsed.jobs['film-copies'], { 'runs-on': 'ubuntu-latest', steps: [] }, 'the parser reads the escaped key as the real job');
  assert.ok(ogStepProblems(attacked).includes('the parsed jobs.film-copies is not the pinned job (parsed)'), 'the parsed binding must refuse it');
});

test('the publish workflow decodes the Instagram images on every run, with a missing decoder a failure', () => {
  const text = readFileSync('.github/workflows/publish.yml', 'utf8');
  assert.deepEqual(ogStepProblems(text), []);
  if (required) assert.ok(parsedWorkflow(text) && !parsedWorkflow(text).error, 'the parsed check must have run');
  const after = (anchor, add) => text.replace(anchor, anchor + add);
  const NAME = '    name: Film copies, decoded\n', RUN = '        run: node --test scripts/og-instagram.test.mjs';
  const broken = [
    [text.replace("          FILM_DECODER_REQUIRED: '1'\n" + RUN, RUN), /byte for byte/],
    [text.replace(RUN, '        run: echo skipped'), /byte for byte/],
    [after(NAME, "    if: github.event_name == 'push'\n"), /byte for byte/],
    [after(NAME, '    continue-on-error: true\n'), /byte for byte/],
    [after(NAME, "    'continue-on-error': true\n"), /byte for byte/],
    [after(NAME, '    "continue\\u002Don-error": true\n'), /byte for byte/],
    [after(NAME, '    <<: *lenient\n'), /byte for byte/],
    [after(NAME, '    { continue-on-error: true }\n'), /byte for byte/],
    [after(RUN, '\n        if: false'), /byte for byte/],
    [after(RUN, '\n        continue-on-error: true'), /byte for byte/],
    [text.replace('    runs-on: ubuntu-latest\n    timeout-minutes: 10', '    runs-on: ubuntu-latest\r    continue-on-error: true\n    timeout-minutes: 10'), /other than LF/],
    [text.replace('    runs-on: ubuntu-latest\n    timeout-minutes: 10', '    runs-on: ubuntu-latest\u2028    continue-on-error: true\n    timeout-minutes: 10'), /other than LF/],
    [text.replace('  verify:\n', '  film-copies:\n    runs-on: ubuntu-latest\n    steps: []\n  verify:\n'), /exactly one film-copies job/],
    [text.replace('  verify:\n', '  "film-copies":\n    runs-on: ubuntu-latest\n    steps: []\n  verify:\n'), /not a plain name|exactly one film-copies/],
    [text.replace('  verify:\n', '  "film\\u002dcopies":\n    runs-on: ubuntu-latest\n    steps: []\n  verify:\n'), /not a plain name|exactly one film-copies/],
    [text.replace('jobs:\n', 'jobs: |\n'), /plain `jobs:`/],
    [text.replace('  verify:\n', ' "film\\U0000002dcopies":\n    runs-on: ubuntu-latest\n    steps: []\n  verify:\n'), /parsed|exactly one film-copies/],
    [text.replace('  film-copies:\n', '  film-copies-x: "\n').replace('    needs: [test, windows-paths, film-copies]', '    needs: [test, windows-paths, film-copies]') + '', /./],
    [text.replace('    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4', '    timeout-minutes: 10\n    steps: &s\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4'), /plain YAML|byte for byte/],
    [text.replace('jobs:\n', 'notes: |\n') + '\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []\n', /exactly one film-copies job/],
    [text.replace("        shell: bash\n        env:\n          FILM_DECODER_REQUIRED: '1'\n        run: node --test scripts/og-instagram.test.mjs", "        env:\n          FILM_DECODER_REQUIRED: '1'\n        run: node --test scripts/og-instagram.test.mjs"), /byte for byte/],
    [text.replace('  verify:\n', '  verify:\n    <<: { continue-on-error: true }\n'), /merge key/],
    [text.replace('  verify:\n', '  verify:\n    "<<": { continue-on-error: true }\n'), /merge key/],
    [text.replace('  verify:\n', '  verify:\n    env: { <<: { A: b } }\n'), /merge key/],
    [text.replace('  verify:\n', '  verify:\n    "\\x3c\\x3c": { continue-on-error: true }\n'), /merge key/],
    [text.replace('  verify:\n', '  verify:\n    "\\u003C\\u003C": { continue-on-error: true }\n'), /merge key/],
    [text.replace('  verify:\n', '  verify:\n    ? <<\n    : { continue-on-error: true }\n'), /merge key/],
  ];
  for (const [changed, pattern] of broken) {
    assert.notEqual(changed, text, String(pattern));
    assert.ok(ogStepProblems(changed).some(p => pattern.test(p)), `${pattern}: ${ogStepProblems(changed).join('; ')}`);
  }
});

test('the film-copies job may be the last job in the file (refute row e19355e0 #3)', () => {
  const text = readFileSync('.github/workflows/publish.yml', 'utf8');
  assert.ok(text.endsWith('\n') && text.includes(`${FILM_JOB}\n`), 'the workflow must end in LF and hold the pinned job');
  const moved = `${text.replace(`${FILM_JOB}\n`, '')}${FILM_JOB}\n`;
  assert.ok(moved.endsWith(`${FILM_JOB}\n`), 'the job must now be last');
  assert.deepEqual(ogStepProblems(moved), []);
});

test('the committed ai-jury image is a baseline JPEG: its frame header is SOF0, not SOF2 (refute row e19355e0)', () => {
  const bytes = readFileSync(join(DIR, 'ai-jury.b9d0adfbcbc140f0.jpg'));
  assert.ok(segmentAt(bytes, 0xc0) > 0, 'no SOF0 (baseline) frame header before the scan');
  assert.equal(segmentAt(bytes, 0xc2), -1, 'a SOF2 (progressive) frame header before the scan');
});
