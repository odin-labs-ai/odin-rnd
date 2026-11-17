// og-instagram-compare.mjs — reproducible decoded comparison of an Instagram JPEG with its lab's share card.
// The CI test (og-instagram.test.mjs) proves name, hash, JPEG structure and the recorded source; it cannot
// decode JPEG (no decoder dependency here). This script does the decoded comparison on a Mac, where `sips`
// (macOS built-in) decodes both images to uncompressed BMP; the rest is plain Node.
//   node scripts/og-instagram-compare.mjs <slug> [<control-slug>]
// Prints the mean absolute RGB difference (0-255) on every 5th pixel in both axes, against the lab's own card
// and against a control card; exit 0 when own < 2 and control > 4 x own, else 1.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [slug, control = 'rogue'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(slug || '') || !/^[a-z0-9-]+$/.test(control)) { console.error('usage: og-instagram-compare.mjs <slug> [<control-slug>]'); process.exit(1); }
const jpgs = readdirSync('site/assets/og/instagram').filter(n => new RegExp(`^${slug}\\.[0-9a-f]{16}\\.jpg$`).test(n));
if (jpgs.length !== 1) { console.error(`expected one site/assets/og/instagram/${slug}.<sha16>.jpg, found ${jpgs.length}`); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'og-ig-'));
const bmp = (src, name) => { const out = join(dir, `${name}.bmp`); execFileSync('sips', ['-s', 'format', 'bmp', src, '--out', out], { stdio: 'ignore' }); return readFileSync(out); };
function samples(b) {
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22)), step = b.readUInt16LE(28) / 8;
  const row = Math.ceil((w * step) / 4) * 4, out = [];
  for (let y = 0; y < h; y += 5) for (let x = 0; x < w; x += 5) for (let c = 0; c < 3; c += 1) out.push(b[off + y * row + x * step + c]);
  return { w, h, out };
}
const mad = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
try {
  const jpg = samples(bmp(join('site/assets/og/instagram', jpgs[0]), 'jpg'));
  const own = samples(bmp(join('site/assets/og/labs', `${slug}.png`), 'own'));
  const other = samples(bmp(join('site/assets/og/labs', `${control}.png`), 'other'));
  if (jpg.w !== own.w || jpg.h !== own.h) { console.log(`size differs: jpg ${jpg.w}x${jpg.h}, card ${own.w}x${own.h}`); process.exit(1); }
  const a = mad(jpg.out, own.out), b = mad(jpg.out, other.out);
  console.log(`${jpgs[0]} vs ${slug}.png: mean abs diff ${a.toFixed(3)}; vs ${control}.png (control): ${b.toFixed(3)}; samples ${jpg.out.length}`);
  process.exit(a < 2 && b > 4 * a ? 0 : 1);
} finally { rmSync(dir, { recursive: true, force: true }); }
