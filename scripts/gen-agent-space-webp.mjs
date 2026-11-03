// One-time asset step: CWEBP=/path/to/cwebp node scripts/gen-agent-space-webp.mjs (never part of build/test).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const originals = [
  'films/agent-space-30s-poster.png',
  'films/agent-space-tour-poster.png',
  'progress/hq-on-duty-poster.jpg',
  'session-2026-10-25-b/poster.png',
  'session-2026-10-25-b/stills/01-s1-q1.png',
  'session-2026-10-25-b/stills/02-s1-q2.png',
  'session-2026-10-25-b/stills/03-s1-q3.png',
  'session-2026-10-25-b/stills/04-s1-q4.png',
  'progress/hq-engineering-hall.jpg',
];
const assetDir = resolve('site/assets/labs/agent-space');
const cwebp = process.env.CWEBP ?? 'cwebp';

for (const original of originals) {
  const input = resolve(assetDir, original);
  if (!existsSync(input)) throw new Error(`Missing original: ${input}`);
  for (const width of [1280, 800]) {
    // Siblings replace the original .png/.jpg extension with -<width>.webp in the same directory.
    const output = input.replace(/\.(png|jpe?g)$/i, `-${width}.webp`);
    if (existsSync(output)) throw new Error(`Refusing to overwrite: ${output}`);
    execFileSync(cwebp, ['-q', '80', '-resize', String(width), '0', input, '-o', output], { stdio: 'inherit' });
  }
}
