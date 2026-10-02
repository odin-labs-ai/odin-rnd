// The latent-handoff restricted-term tripwire. A sha256 of a short term is not a secret: anyone can hash a
// dictionary and compare. So this PUBLIC list is exactly the list scripts/check.mjs already publishes; it adds
// no new information. The experiment's private terms are checked PRIVATELY, in the
// governed publish path, from a plaintext list that never enters this repository (privateFingerprints below).
// The format matches check.mjs (which is pinned by EXP 006 and is therefore not edited). A digest comes off
// this list only in a diff that adds experiments/latent-handoff/permission.sha256 (latent-handoff-fences.mjs).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const restrictedFingerprints = {"13": ["5731fbf840cf0bfdc5d3d933edd5c3bc5dccb89ac3f3df02fa5ec89866aaa42a"], "12": ["8b0dd65e80ec8e80c5516ad7e7814fb83a7b7f688c0da01ea03cd9ab3782686f", "db8125a5a0a5825896a37524890fe5a4b7608cfc05c1125b0791cc65a61855b4"], "8": ["a9a5126d7cca4ab5eecee72061f1e2060f6022266c74209f9fec62e986adc091", "080ac5c86e07c86491882d68ede609dd9085958b54329bfffed755c8b88cd9a3"], "9": ["94899355c63b8d585e18d8ea77b107c61696b0cc0dc99b17387b328cb4899b9c", "3f1eb95d29d5a58c4500824d9e3925726639c5e77b3cadcc90a6181d92abcfe2"], "4": ["542c6ec5c666e7ba61d6d1a4750847cd4b48fde065782e11fda0787012682f97"]};

// The list is frozen: a scanner that ran with fewer digests than the declared line would be a silent removal.
for (const digests of Object.values(restrictedFingerprints)) Object.freeze(digests);
Object.freeze(restrictedFingerprints);

// Records carry many digests of files that are not in this tree, so a window that lies ENTIRELY inside a run of
// 40 or more hex characters is part of a digest, not text, and is skipped. Nothing is masked: a window that
// straddles a run's edge is scanned like any other, so a term written right against a digest is never hidden
// (whatever touches the run: a space, '-', '_', an accented letter, '#'). A window that is itself all hex
// counts only as a whole token (no hex character on either side), so short SHAs and blob ids inside records do
// not trip it at random; a whole-token hex group (a UUID segment, say) still can, rarely, and the built site
// keeps check.mjs's plain substring scan. Like check.mjs, this does not decode hex or base64: it is a tripwire,
// not a semantic privacy audit.
const hexChar = c => c !== undefined && /[0-9a-f]/.test(c);

export function restrictedContent(text, fingerprints = restrictedFingerprints) {
  const lower = text.toLowerCase();
  // runEnd[i] = end of the maximal 40+ hex run containing position i, or 0 when i is in no such run.
  const runEnd = new Uint32Array(lower.length);
  for (const run of lower.matchAll(/[0-9a-f]{40,}/g)) runEnd.fill(run.index + run[0].length, run.index, run.index + run[0].length);
  for (const [size, digests] of Object.entries(fingerprints)) {
    const length = Number(size), blocked = new Set(digests);
    for (let i = 0; i <= lower.length - length; i++) {
      if (runEnd[i] && i + length <= runEnd[i]) continue;
      const window = lower.slice(i, i + length);
      if (!blocked.has(createHash('sha256').update(window).digest('hex'))) continue;
      if (/^[0-9a-f]+$/.test(window) && (hexChar(lower[i - 1]) || hexChar(lower[i + length]))) continue;
      return true;
    }
  }
  return false;
}

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const binaryFile = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|br|mp4|webm|mov|wasm)$/i;
export const scannedDirs = ['site', 'experiments', 'demos', 'research', 'docs', 'dist'];

// Everything a page is built from, every committed record, the demos, research and docs, this experiment's own
// scripts, and the built site when one exists. Every file that is not a known binary type. Paths are relative.
export function scanTargets(root = '.', dirs = scannedDirs) {
  const under = dir => existsSync(`${root}/${dir}`) ? walk(`${root}/${dir}`).map(path => path.slice(root.length + 1)) : [];
  const scripts = existsSync(`${root}/scripts`) ? readdirSync(`${root}/scripts`).filter(name => name.startsWith('latent-handoff')).map(name => `scripts/${name}`) : [];
  return [...dirs.flatMap(under), ...scripts].filter(path => !binaryFile.test(path)).sort();
}

// A file is refused for its content or for its own name (the build publishes a list of source file names).
export function scanTree(root = '.', fingerprints = restrictedFingerprints, dirs = scannedDirs) {
  const body = path => { try { return readFileSync(`${root}/${path}`, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };
  // A file renamed away between the walk and the read (a local run's temp file) is skipped; any other error throws.
  return scanTargets(root, dirs).filter(path => restrictedContent(path, fingerprints) || restrictedContent(body(path), fingerprints));
}

// Digests computed at run time from a private plaintext list (one term per line), for the governed publish
// path's private scan. Nothing derived from it is ever written to this repository.
export function privateFingerprints(file) {
  const map = {};
  for (const term of readFileSync(file, 'utf8').split('\n').map(line => line.trim().toLowerCase()).filter(Boolean)) {
    const digest = createHash('sha256').update(term).digest('hex');
    (map[term.length] ||= []).includes(digest) || map[term.length].push(digest);
  }
  return map;
}
