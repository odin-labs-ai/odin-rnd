// Refresh the pin from existing WebP bytes; CWEBP=/path/to/cwebp is needed only for missing siblings.
// This asset step is never part of build/test.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { probeWebp } from './webp-probe.mjs';

const originals = [
  'films/agent-space-30s-poster.png',
  'films/agent-space-tour-poster.png',
  'progress/hq-on-duty-poster.jpg',
  'session-2026-10-25-b/poster.png',
  'session-2026-10-25-b/stills/01-s1-q1.png',
  'session-2026-10-25-b/stills/02-s1-q2.png',
  'session-2026-10-25-b/stills/03-s1-q3.png',
  'session-2026-10-25-b/stills/04-s1-q4.png',
  'session-2026-11-08/poster.png',
  'session-2026-11-08/stills/01-s1-q1.png',
  'session-2026-11-08/stills/02-s1-q2.png',
  'session-2026-11-08/stills/03-s1-q3.png',
  'session-2026-11-08/stills/04-s1-q4.png',
  'progress/hq-engineering-hall.jpg',
];
const siteDir = resolve('site');
const cwebp = process.env.CWEBP ?? 'cwebp';
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const images = originals.map(original => {
  const originalPath = `assets/labs/agent-space/${original}`;
  const input = resolve(siteDir, originalPath);
  if (!existsSync(input)) throw new Error(`Missing original: ${input}`);
  const variants = [1280, 800].map(width => {
    // Siblings replace the original .png/.jpg extension with -<width>.webp in the same directory.
    const path = originalPath.replace(/\.(png|jpe?g)$/i, `-${width}.webp`);
    const output = resolve(siteDir, path);
    if (!existsSync(output)) execFileSync(cwebp, ['-q', '80', '-resize', String(width), '0', input, '-o', output], { stdio: 'inherit' });
    const dimensions = probeWebp(output);
    if (dimensions.width !== width) throw new Error(`${output}: expected width ${width}, got ${dimensions.width}`);
    return { path, width, height: dimensions.height, sha256: sha256(output) };
  });
  return { original: originalPath, originalSha256: sha256(input), variants };
});

writeFileSync(resolve('scripts/agent-space-webp.pin.json'), `${JSON.stringify({ format: 'odin-agent-space-webp-pin', version: 1, images }, null, 2)}\n`);
