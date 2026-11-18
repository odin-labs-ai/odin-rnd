// Pins every Instagram image under site/assets/og/instagram/ to what its name claims.
// Instagram takes JPEG only (4:5 to 1.91:1), and the odin-labs post wrapper (social-post.sh) takes Instagram
// media only as <name>.<first 16 hex of its sha256>.jpg on this site. So each file here must be:
//   - named <slug>.<sha16>.jpg, where sha16 is the first 16 hex of the sha256 of its own bytes;
//   - a baseline or progressive JPEG (starts FF D8 FF) whose frame header says 1200x630, the share-card size;
//   - a re-encode of its lab's committed share card site/assets/og/labs/<slug>.png (that card must exist), proven
//     decoded: ffmpeg decodes the JPEG and every card to RGB, and the JPEG must be close to its own card and far from
//     every other card (the decoded test below). The publish workflow's "Film copies, decoded" job installs ffmpeg and
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
  'ai-jury.e0d096038d65e4f2.jpg': {
    source: 'ai-jury.png',
    sourceSha256: 'faf758bb982f17389aa9681f71db5d4c4eef0ae08be70e462c10a54a42f62585',
    made: 'sips-316 (macOS 26.6.1): sips -s format jpeg -s formatOptions 92 ai-jury.png',
  },
};

/**
 * Width and height of a baseline (SOF0) or progressive (SOF2) JPEG; null for anything else or anything malformed.
 * The reader walks every marker segment from SOI up to and including the start of scan (SOS) and refuses: no SOI
 * (FF D8 FF) or no EOI (FF D9) at the end; any segment whose length is under 2 or runs past the bytes; any frame type
 * other than SOF0/SOF2 (SOF1, SOF3, SOF5-7, SOF9-15 are refused); a second frame header; a SOF whose length is not
 * 8 + 3 x its component count, whose precision is not 8, whose component count is not 1, 3 or 4, or whose width or
 * height is 0; an SOS before the frame header, an SOS header that is not 6 + 2 x Ns bytes for 1 <= Ns <= the frame's
 * component count, or no SOS at all. The entropy-coded data after SOS is not decoded.
 */
export function jpegSize(bytes) {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return null;
  let size = null;
  let i = 2;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
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
      size = { width, height, components };
    } else if (marker === 0xda) {
      // Start of scan: null when no frame header came first, or when the SOS header is not exactly
      // 6 + 2 x Ns bytes for 1 <= Ns <= the frame's component count.
      if (!size) return null;
      const ns = len >= 3 ? bytes[i + 4] : 0;
      if (ns < 1 || ns > 4 || ns > size.components || len !== 6 + 2 * ns) return null;
      return { width: size.width, height: size.height };
    }
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
// 3 components of 3 bytes each, a start of scan (FF DA, length 12), then FF D9.
const SOS = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00];
const frame = (marker, h, w, extra = []) => Buffer.from([0xff, 0xd8, ...extra, 0xff, marker, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03,
  1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, ...SOS, 0xff, 0xd9]);

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

// The decoded comparison. ffmpeg decodes each image to 8-bit RGB (rgb24) at its own size; the score is the mean
// absolute difference per channel value (0-255) over every pixel. An Instagram image passes only when it is the same
// size as its own card, scores under OWN_MAX against it, and scores more than OTHER_FACTOR times that (and at least
// OTHER_MIN) against EVERY other committed card, so a re-encode of the wrong card, a blank or a different render fails.
const OWN_MAX = 2;
const OTHER_FACTOR = 4;
const OTHER_MIN = 2;
const has = tool => { try { execFileSync(tool, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const required = process.env.FILM_DECODER_REQUIRED === '1';
const ffmpeg = has('ffmpeg');
const decoderSkip = !required && !ffmpeg && 'ffmpeg is not installed';

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

/** Problems with an image claimed to be a re-encode of `own`, given the decoded other cards; [] when it is. */
export function decodedProblems(image, own, others) {
  if (image.width !== own.width || image.height !== own.height) return [`size ${image.width}x${image.height}, its card is ${own.width}x${own.height}`];
  const problems = [], toOwn = meanAbsDiff(image, own);
  if (!(toOwn < OWN_MAX)) problems.push(`mean abs diff ${toOwn.toFixed(3)} to its own card, must be under ${OWN_MAX}`);
  for (const [name, other] of others) {
    if (other.width !== image.width || other.height !== image.height) continue; // a card of another size cannot be confused with it
    const toOther = meanAbsDiff(image, other);
    if (!(toOther > OTHER_FACTOR * toOwn && toOther >= OTHER_MIN)) problems.push(`mean abs diff ${toOther.toFixed(3)} to ${name} is not more than ${OTHER_FACTOR} x ${toOwn.toFixed(3)} (and at least ${OTHER_MIN})`);
  }
  return problems;
}

test('a decoder is present wherever one is required', () => {
  if (required) assert.ok(ffmpeg && has('ffprobe'), 'FILM_DECODER_REQUIRED is set but ffmpeg or ffprobe is missing');
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
  const job = lines.slice(start, end).join('\n');
  const problems = [];
  if (!job.includes(OG_STEP)) problems.push('the film-copies job does not run scripts/og-instagram.test.mjs with FILM_DECODER_REQUIRED=1');
  if (/\n    if:/.test(job)) problems.push('the film-copies job has a condition, so it can be skipped');
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
  ];
  for (const [changed, pattern] of broken) {
    assert.notEqual(changed, text, String(pattern));
    assert.ok(ogStepProblems(changed).some(p => pattern.test(p)), String(pattern));
  }
});
