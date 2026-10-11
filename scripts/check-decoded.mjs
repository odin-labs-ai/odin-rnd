// The decoding half of the site check (vp-rnd-frontier-residuals R4). check.mjs scans the built site's raw text for
// restricted terms; a term written as hex or base64 passed it. check.mjs is pinned by EXP 006 and EXP 007 (their
// runners.sha256), so it is not edited: this separate tripwire runs after it in `pnpm check`, reads the SAME
// fingerprint list from check.mjs's source (so there is one list), decodes hex and base64/base64url tokens, and scans
// only the decodings that are readable text. Raw text stays check.mjs's job. Like check.mjs this is a tripwire, not a
// semantic privacy audit: it decodes one layer, and a term split across tokens or encoded twice is not found.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The restricted-term fingerprints exactly as scripts/check.mjs declares them. */
export function checkFingerprints(checkPath = join(HERE, 'check.mjs')) {
  const match = /^const restrictedFingerprints = (\{.*\});$/m.exec(readFileSync(checkPath, 'utf8'));
  if (!match) throw new Error('scripts/check.mjs no longer declares restrictedFingerprints on one line');
  return JSON.parse(match[1]);
}

const MIN_TOKEN = 8;
const utf8 = new TextDecoder('utf-8', { fatal: true });

// Readable = valid UTF-8, at least 4 characters, and at least 90% of it printable. Random bytes (a digest decoded as
// hex, an ordinary word decoded as base64) almost never pass, so they cost nothing downstream.
function readable(bytes) {
  if (bytes.length < 4) return null;
  let text;
  try { text = utf8.decode(bytes); } catch { return null; }
  const printable = [...text].filter(c => c === '\n' || c === '\r' || c === '\t' || !/\p{Cc}/u.test(c)).length;
  return printable >= 0.9 * [...text].length ? text : null;
}

/** The readable decodings of every hex and base64/base64url token in `text` (one layer, no recursion). */
export function decodedViews(text) {
  const views = new Set();
  for (const [token] of text.matchAll(/[0-9a-fA-F]{8,}/g)) {
    const even = token.length % 2 ? token.slice(0, -1) : token;
    const view = readable(Buffer.from(even, 'hex'));
    if (view) views.add(view);
  }
  for (const [token] of text.matchAll(/[A-Za-z0-9+/_-]{8,}={0,2}/g)) {
    if (token.replace(/=+$/, '').length < MIN_TOKEN) continue;
    const view = readable(Buffer.from(token, 'base64'));
    if (view) views.add(view);
  }
  return [...views];
}

function containsFingerprint(text, fingerprints) {
  const lower = text.toLowerCase();
  for (const [size, digests] of Object.entries(fingerprints)) {
    const length = Number(size), blocked = new Set(digests);
    for (let i = 0; i <= lower.length - length; i++) {
      if (blocked.has(createHash('sha256').update(lower.slice(i, i + length)).digest('hex'))) return true;
    }
  }
  return false;
}

/** True when a decoded token in `text` carries a restricted term. */
export function encodedRestricted(text, fingerprints = checkFingerprints()) {
  return decodedViews(text).some(view => containsFingerprint(view, fingerprints));
}

const walk = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

/** Files under `root` (the same text types check.mjs scans) that carry an encoded restricted term, relative paths. */
export function scanDecoded(root = 'dist', fingerprints = checkFingerprints()) {
  return walk(root)
    .filter(file => /\.(html|css|js|mjs|json|svg|md|txt)$/.test(file))
    .filter(file => encodedRestricted(readFileSync(file, 'utf8'), fingerprints))
    .map(file => relative(root, file))
    .sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = scanDecoded('dist');
  if (found.length) {
    console.error('Encoded restricted content in:\n' + found.map(file => `  dist/${file}`).join('\n'));
    process.exit(1);
  }
  console.log('No encoded restricted content in dist/.');
}
