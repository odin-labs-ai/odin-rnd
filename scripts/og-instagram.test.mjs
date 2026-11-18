// Pins every Instagram image under site/assets/og/instagram/ to what its name claims.
// Instagram takes JPEG only (4:5 to 1.91:1), and the odin-labs post wrapper (social-post.sh) takes Instagram
// media only as <name>.<first 16 hex of its sha256>.jpg on this site. So each file here must be:
//   - named <slug>.<sha16>.jpg, where sha16 is the first 16 hex of the sha256 of its own bytes;
//   - ONE complete baseline or progressive JPEG, from SOI to the EOI that ends the file, whose frame header says
//     1200x630 (the share-card size), carrying no metadata segment other than APP0 (JFIF) and APP2 (ICC profile);
//   - a re-encode of its lab's committed share card site/assets/og/labs/<slug>.png (that card must exist), measured
//     decoded: ffmpeg decodes the JPEG and every card to RGB, and the JPEG must be close to its own card over the whole
//     image AND in every 16x16 block, and far from every other card (the decoded test below). The publish workflow's "Film copies, decoded" job installs ffmpeg and
//     runs this file with FILM_DECODER_REQUIRED=1, so in CI a missing decoder fails instead of skipping, and verify
//     (which publish depends on) fails unless that job succeeded.
// The folder may be absent or empty; a stray file of any other shape fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('site', 'assets', 'og', 'instagram');
const CARDS = join('site', 'assets', 'og', 'labs');

// Where each image came from: the exact source card bytes (sha256) at conversion time and how it was made. A
// re-rendered card changes its sha256, so a stale Instagram image fails here instead of drifting silently. That the
// bytes really are that card is the decoded test below, which runs in CI (no recorded measurement is trusted).
const PROVENANCE = {
  'ai-jury.b9d0adfbcbc140f0.jpg': {
    source: 'ai-jury.png',
    sourceSha256: 'faf758bb982f17389aa9681f71db5d4c4eef0ae08be70e462c10a54a42f62585',
    made: 'sips-316 (macOS 26.6.1): sips -s format jpeg -s formatOptions 92 ai-jury.png; then its APP1 (Exif) and APP13 '
      + '(Photoshop) segments were cut out byte for byte, every other byte kept (the decoded pixels are unchanged)',
  },
};

/**
 * Width and height of ONE complete baseline (SOF0) or progressive (SOF2) JPEG; null for anything else or anything
 * malformed. The reader walks the whole file, marker by marker, from SOI to the EOI that must be its last two bytes:
 *   - every segment's length is at least 2 and stays inside the bytes;
 *   - exactly one frame header, SOF0 or SOF2 (SOF1, SOF3, SOF5-7, SOF9-15 are refused), of length 8 + 3 x Nf with
 *     precision 8, Nf 1, 3 or 4 and a non-zero width and height;
 *   - only these other segments: DHT, DQT, DRI, APP0 (JFIF) and APP2 (ICC profile). Every other APPn (Exif, XMP,
 *     Photoshop ...), COM, DAC, DNL and any unknown marker is refused, so the public file carries no metadata;
 *   - each start of scan (SOS) comes after the frame header, is 6 + 2 x Ns bytes for 1 <= Ns <= Nf, and has the
 *     spectral selection its frame allows: baseline Ss 0, Se 63, Ah = Al = 0; progressive either a DC scan (Ss = Se = 0)
 *     or an AC scan of one component (1 <= Ss <= Se <= 63), Ah and Al at most 13;
 *   - after each scan header the entropy-coded data is skipped (FF 00 stuffing and RST0-7 stay inside it) to the next
 *     marker; at least one scan;
 *   - the first EOI is the end of the file: a second image after it, or a second SOI anywhere, is refused.
 * The entropy-coded data itself is not decoded here; the decoded test below does that with ffmpeg.
 */
export function jpegSize(bytes) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let size = null, scans = 0, i = 2;
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
      size = { width, height, components, progressive: marker === 0xc2 };
    } else if (marker === 0xda) {
      if (!size) return null;
      const ns = len >= 3 ? bytes[i + 4] : 0;
      if (ns < 1 || ns > 4 || ns > size.components || len !== 6 + 2 * ns) return null;
      const ss = bytes[i + 5 + 2 * ns], se = bytes[i + 6 + 2 * ns], ah = bytes[i + 7 + 2 * ns] >> 4, al = bytes[i + 7 + 2 * ns] & 15;
      if (!size.progressive && (ss !== 0 || se !== 63 || ah !== 0 || al !== 0)) return null;
      if (size.progressive && (ss === 0 ? se !== 0 : (se < ss || se > 63 || ns !== 1))) return null;
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
    } else if (![0xc4, 0xdb, 0xdd, 0xe0, 0xe2].includes(marker)) {
      return null; // SOI again, APP1/3-15, COM, DAC, DNL, RSTn outside a scan, or anything unknown
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
    assert.equal(createHash('sha256').update(readFileSync(join(CARDS, prov.source))).digest('hex'), prov.sourceSha256,
      `${name}: ${CARDS}/${prov.source} changed since this image was made from it — re-make the image (stale)`);
  }
  for (const name of Object.keys(PROVENANCE)) assert.ok(names.includes(name), `PROVENANCE names ${name}, which is not in ${DIR}`);
});

// A minimal well-formed SOF0 frame: FF D8, FF C0 length 17 (8 + 3 x 3 components), precision 8, height, width,
// 3 components of 3 bytes each, a baseline start of scan (FF DA, length 12, Ss 0, Se 63, Ah/Al 0), two bytes of
// entropy-coded data, then FF D9. A progressive frame gets a DC first scan (Ss 0, Se 0) instead.
const SOS = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34];
const SOS_DC = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x00, 0x00, 0x12, 0x34];
const frame = (marker, h, w, extra = [], scan = marker === 0xc2 ? SOS_DC : SOS) => Buffer.from([0xff, 0xd8, ...extra, 0xff, marker, 0x00, 0x11, 0x08,
  h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, ...scan, 0xff, 0xd9]);

test('the frame-header reader reads a well-formed frame and skips APP0/APP2 segments', () => {
  assert.deepEqual(jpegSize(frame(0xc0, 630, 1200)), { width: 1200, height: 630 });
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])), { width: 32, height: 16 }, 'progressive SOF2 (DC scan) after an APP0 segment');
  assert.deepEqual(jpegSize(frame(0xc0, 630, 1200, [0xff, 0xe2, 0x00, 0x04, 0x00, 0x00])), { width: 1200, height: 630 }, 'an APP2 (ICC) segment');
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
  assert.deepEqual(jpegSize(Buffer.concat([head, Buffer.from('ffe000040000', 'hex'), tail])), { width: 1200, height: 630 }, 'a valid APP0 after the frame is fine');
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
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, [], scan(0, 0))), { width: 32, height: 16 }, 'a progressive DC scan');
  assert.deepEqual(jpegSize(frame(0xc2, 16, 32, [], scan(1, 63, 0, 1))), { width: 32, height: 16 }, 'a progressive AC scan of one component');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(1, 63, 0, 3))), null, 'a progressive AC scan of three components');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(5, 4, 0, 1))), null, 'Se below Ss');
  assert.equal(jpegSize(frame(0xc2, 16, 32, [], scan(0, 0, 0xe0))), null, 'Ah 14');
  assert.equal(jpegSize(frame(0xc0, 16, 32, [], scan(0, 0))), null, 'a baseline frame with Se 0');
  assert.equal(jpegSize(frame(0xc0, 16, 32, [], scan(0, 63, 0x01))), null, 'a baseline frame with Al 1');
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
  for (const [label, seg] of [['APP1 (Exif)', 'ffe1000645786966'], ['APP13 (Photoshop)', 'ffed00040000'], ['COM', 'ffe0000400ff'.replace('ffe0', 'fffe')], ['DAC', 'ffcc00040000'], ['DNL', 'ffdc00040000']]) {
    assert.equal(jpegSize(frame(0xc0, 630, 1200, [...Buffer.from(seg, 'hex')])), null, `${label} refused`);
  }
  { const b = Buffer.from(one); const at = b.length - 2 - 2; b[at] = 0xff; b[at + 1] = 0xd8; assert.equal(jpegSize(b), null, 'a second SOI inside the data'); }
  { const b = Buffer.from(one); const at = b.length - 2 - 2; b[at] = 0xff; b[at + 1] = 0xd3; assert.deepEqual(jpegSize(b), { width: 1200, height: 630 }, 'a restart marker inside the data is data'); }
});

// The decoded comparison. ffmpeg decodes each image to 8-bit RGB (rgb24) at its own size; a score is the mean
// absolute difference per channel value (0-255). An Instagram image passes only when it is the same size as its own
// card, scores under OWN_MAX against it over the whole image, scores under OWN_BLOCK_MAX in EVERY 16x16 block (so a
// local change such as an edited badge or a few characters fails even where the whole-image mean barely moves: any
// 32x32 change contains a whole 16x16 block), and scores more than OTHER_FACTOR times its own score (and at least
// OTHER_MIN) against EVERY other committed card. What this measures is decoded similarity at these thresholds; it does
// not prove which program made the bytes (that is the PROVENANCE line, author-recorded).
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

test('the other-card half and the block half each refuse on their own (refute row f67ac5a8 #4, #5)', { skip: decoderSkip }, () => {
  const cards = decodedCards();
  const name = readdirSync(DIR).find(n => n.endsWith('.jpg'));
  const own = cards.get(`${name.split('.')[0]}.png`);
  const image = decodeRgb(join(DIR, name));
  // Close to its own card, and just as close to a competing card: only the other-card loop can refuse it.
  const twin = { ...own, rgb: Buffer.from(own.rgb) };
  const onlyTwin = decodedProblems(image, own, [['twin.png', twin]]);
  assert.equal(onlyTwin.length, 1, onlyTwin.join('; '));
  assert.match(onlyTwin[0], /to twin\.png is not more than/);
  // A 32x32 patch over the card's own text (copied from a plain area, the way an edit would look), at a place no block
  // grid line is aligned to: the whole-image mean stays under OWN_MAX, so only the block check can refuse it.
  const worst = worstBlock(image, own);
  const patched = { ...image, rgb: Buffer.from(image.rgb) };
  const x0 = Math.max(0, worst.x - 7), y0 = Math.max(0, worst.y - 7);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) for (let c = 0; c < 3; c += 1) {
    patched.rgb[((y0 + y) * image.width + x0 + x) * 3 + c] = own.rgb[((5 + y) * image.width + 5 + x) * 3 + c];
  }
  assert.ok(meanAbsDiff(patched, own) < OWN_MAX, 'the patch must leave the whole-image mean under OWN_MAX for this test to mean anything');
  const patchedProblems = decodedProblems(patched, own, [...cards].filter(([k]) => k !== `${name.split('.')[0]}.png`));
  assert.ok(patchedProblems.some(p => p.startsWith('block at')), `a 32x32 edit passed: ${patchedProblems.join('; ')}`);
});

// The CI wiring this file's decoded claims rest on: .github/workflows/publish.yml must run this file with
// FILM_DECODER_REQUIRED=1 in the "Film copies, decoded" job (which installs ffmpeg, has no condition, and which verify
// needs and requires to succeed; scripts/film-fallbacks.test.mjs pins that job, the verify step and the deploy chain).
const OG_STEP = [
  "      - name: Decode every Instagram image and compare it with its share card",
  "        env:",
  "          FILM_DECODER_REQUIRED: '1'",
  "        run: node --test scripts/og-instagram.test.mjs",
].join('\n');
export function ogStepProblems(text) {
  const lines = text.split('\n'), start = lines.indexOf('  film-copies:');
  if (start < 0) return ['there is no film-copies job'];
  let end = lines.findIndex((l, i) => i > start && /^  [a-z][a-z0-9-]*:\s*$/.test(l));
  if (end < 0) end = lines.length;
  const jobLines = lines.slice(start, end), job = jobLines.join('\n');
  const problems = [];
  // The whole step, every key of it: from its "- name:" line to the next step or the end of the job, comments and
  // blank lines aside, it must be exactly OG_STEP, so a step-level if: or continue-on-error: anywhere in it fails.
  const at = jobLines.indexOf(OG_STEP.split('\n')[0]);
  let stepEnd = jobLines.findIndex((l, i) => i > at && /^      - /.test(l));
  if (stepEnd < 0) stepEnd = jobLines.length;
  const step = at < 0 ? '' : jobLines.slice(at, stepEnd).filter(l => l.trim() && !/^\s*#/.test(l)).join('\n');
  if (step !== OG_STEP) problems.push('the film-copies job does not run scripts/og-instagram.test.mjs with FILM_DECODER_REQUIRED=1 as exactly this step (no if:, no continue-on-error:)');
  if (/\n    if:/.test(job)) problems.push('the film-copies job has a condition, so it can be skipped');
  if (/\n    continue-on-error:/.test(job)) problems.push('the film-copies job may fail without failing the run (continue-on-error)');
  if (!/apt-get install .*\bffmpeg\b/.test(job)) problems.push('the film-copies job does not install ffmpeg');
  return problems;
}

test('the publish workflow decodes the Instagram images on every run, with a missing decoder a failure', () => {
  const text = readFileSync('.github/workflows/publish.yml', 'utf8');
  assert.deepEqual(ogStepProblems(text), []);
  const broken = [
    [text.replace("          FILM_DECODER_REQUIRED: '1'\n        run: node --test scripts/og-instagram.test.mjs", '        run: node --test scripts/og-instagram.test.mjs'), /does not run/],
    [text.replace('run: node --test scripts/og-instagram.test.mjs', 'run: echo skipped'), /does not run/],
    [text.replace('    name: Film copies, decoded\n', "    name: Film copies, decoded\n    if: github.event_name == 'push'\n"), /has a condition/],
    [text.replace('    name: Film copies, decoded\n', '    name: Film copies, decoded\n    continue-on-error: true\n'), /continue-on-error/],
    [text.replace('        run: node --test scripts/og-instagram.test.mjs', '        run: node --test scripts/og-instagram.test.mjs\n        if: false'), /exactly this step/],
    [text.replace('        run: node --test scripts/og-instagram.test.mjs', '        run: node --test scripts/og-instagram.test.mjs\n        continue-on-error: true'), /exactly this step/],
    [text.replace('      - name: Decode every Instagram image and compare it with its share card\n', "      - name: Decode every Instagram image and compare it with its share card\n        if: github.event_name == 'push'\n"), /exactly this step/],
  ];
  for (const [changed, pattern] of broken) {
    assert.notEqual(changed, text, String(pattern));
    assert.ok(ogStepProblems(changed).some(p => pattern.test(p)), String(pattern));
  }
});
