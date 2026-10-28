// The site's own leak gate: the last step before the Pages deploy. It reads every file of the built site (and every
// vendored record) and fails the build on any protected term, any canary, or any machine-shaped leak.
//
//   node scripts/leak-gate.mjs [--secret-env NAME] [--page FILE] [--commit SHA] PATH...
//
// THE TERM SET IS NEVER IN THIS REPO. The protected terms (names, private repositories, hosts, the client's words) and
// the canaries (random strings planted only in private sources this site vendors from) arrive as one repository
// secret, JSON {"format":"odin-leak-screen","version":1,"salt":"…","terms":["<24 hex>",…],"canaries":["<24 hex>",…],
// "heads":["<24 hex>",…]}: each entry is sha256(salt, "\0", the term as its words) cut to 24 hex, and the heads are the
// same hash of each term's first word. The gate splits every text into words
// (NFKC, lower case, runs of letters and digits), hashes every run of 1 to 4 words with the salt and looks it up. On a
// hit it prints the file, the line, the kind and the first 8 hex of the hash: never the text.
//
// FAIL CLOSED: a missing, unreadable, malformed or empty secret (no salt, no terms or no canaries) is a failure, never a
// pass; so is a set that differs from the public commitment in scripts/leak-gate-set.json (counts and the sha256 of
// the sorted hashes), a path that does not exist, or a scan that reads no text at all.
//
// The machine-shaped leaks (home paths, private and loopback addresses, local hosts, token shapes) are not secret and
// stand below as plain patterns.
//
// --page FILE: after a clean scan, fill the Leak screen page's slots (counts, the time, the commit, the files read)
// and scan the filled page once more.
import { createHash, hash as oneShot } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';

export const MAX_WORDS = 4;
const HEX24 = /^[0-9a-f]{24}$/;
const WORD = /[\p{L}\p{N}]+/gu;
const MAX_GAP = 3;

export function digest(salt, words) {
  return oneShot('sha256', `${salt}\0${words}`, 'hex').slice(0, 24);
}

/** A term as the gate reads it: its words, NFKC and lower case, joined by "-" ("Some Name" == "some_name"). */
export function normalise(term) {
  return (String(term).normalize('NFKC').toLowerCase().match(WORD) ?? []).join('-');
}

/** The secret, checked. Throws on anything but a complete term set: the gate never runs on a partial one. */
export function loadSecret(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('leak gate: the term set is missing or empty');
  let d;
  try { d = JSON.parse(raw); } catch { throw new Error('leak gate: the term set is not JSON'); }
  if (!d || d.format !== 'odin-leak-screen' || d.version !== 1) throw new Error('leak gate: the term set has the wrong format');
  if (typeof d.salt !== 'string' || d.salt.length < 16) throw new Error('leak gate: the term set has no salt');
  for (const key of ['terms', 'canaries', 'heads']) {
    if (!Array.isArray(d[key]) || d[key].length === 0) throw new Error(`leak gate: the term set has no ${key}`);
    if (!d[key].every(h => typeof h === 'string' && HEX24.test(h))) throw new Error(`leak gate: a ${key} entry is not a 24-hex hash`);
  }
  const kinds = new Map();
  for (const h of d.terms) kinds.set(h, 'term');
  for (const h of d.canaries) kinds.set(h, 'canary');
  return { salt: d.salt, kinds, heads: new Set(d.heads), terms: new Set(d.terms).size, canaries: new Set(d.canaries).size, commitment: commitmentOf(d.terms, d.canaries, d.heads) };
}

/** The public commitment to one exact term set: its counts and the sha256 of its sorted hashes (no term, no salt). */
export function commitmentOf(terms, canaries, heads) {
  const [t, c, f] = [terms, canaries, heads].map(list => [...new Set(list)].sort());
  return { terms: t.length, canaries: c.length, sha256: createHash('sha256').update(`terms\n${t.join('\n')}\ncanaries\n${c.join('\n')}\nheads\n${f.join('\n')}\n`).digest('hex') };
}

/**
 * The term set must be exactly the one committed in public (scripts/leak-gate-set.json): a set with one term removed is
 * a different set and stops the build. Changing the set is a reviewed change to that file.
 */
export function checkCommitment(secret, raw) {
  let want;
  try { want = JSON.parse(raw); } catch { throw new Error('leak gate: the term-set commitment is not JSON'); }
  if (!want || want.format !== 'odin-leak-gate-set' || want.version !== 1) throw new Error('leak gate: the term-set commitment has the wrong format');
  const got = secret.commitment;
  if (want.terms !== got.terms || want.canaries !== got.canaries || want.sha256 !== got.sha256) throw new Error(`leak gate: the term set is not the committed one (committed ${want.terms} terms, ${want.canaries} canaries; got ${got.terms}, ${got.canaries})`);
}

// Machine-shaped leaks. The match itself is never printed (a home path names its user).
export const PATTERNS = [
  ['home-path', /(?<![\w.])\/(?:Users|home)\/[A-Za-z][\w.-]*|\b[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s"'<>]+/],
  ['private-address', /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/],
  ['loopback', /\b127\.0\.0\.1\b|\[::1\]:\d|\blocalhost:\d/i],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['api-key', /\bsk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' };
/** The same text as a reader (or a parser) would see it: references, escapes and percent-codes undone. */
export function decoded(text) {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\([/"\\])/g, '$1')
    .replace(/%([0-9a-f]{2})/gi, (m, h) => { const c = Number.parseInt(h, 16); return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : m; })
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '');
}
/** Tags removed (their line breaks kept): a term split by markup reads whole. */
const untagged = text => text.replace(/<[^>]*>/g, tag => tag.replace(/[^\n]/g, ''));

const lineOf = (starts, pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
const lineStarts = text => { const out = [0]; for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1); return out; };

function scanOne(text, secret, cache, patterns = true) {
  const hits = [];
  const starts = lineStarts(text);
  const words = [...text.normalize('NFKC').toLowerCase().matchAll(WORD)].map(m => [m[0], m.index, m.index + m[0].length]);
  // NFKC can move offsets; the line is then counted in the normalised text, which keeps its line breaks.
  const norm = text.normalize('NFKC');
  const nstarts = norm === text ? starts : lineStarts(norm);
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let n = 1; n <= MAX_WORDS && i + n <= words.length; n++) {
      const w = words[i + n - 1];
      if (n > 1) {
        // Any run of white space (a line break included) reads as one space: "Some\n  Name" is "Some Name".
        const gap = norm.slice(words[i + n - 2][2], w[1]).replace(/\s+/g, ' ');
        if (gap.length > MAX_GAP) break;
      }
      joined = n === 1 ? w[0] : `${joined}-${w[0]}`;
      let h = cache.get(joined);
      if (h === undefined) { h = digest(secret.salt, joined); if (cache.size < 2_000_000) cache.set(joined, h); }
      const kind = secret.kinds.get(h);
      if (kind) hits.push({ kind, line: lineOf(nstarts, words[i][1]), hash: h.slice(0, 8) });
      // Longer runs are hashed only from a word that starts some term (the set's "heads"): the same answer, far fewer hashes.
      if (n === 1 && !secret.heads.has(h)) break;
    }
  }
  if (patterns) for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) hits.push({ kind, line: lineOf(starts, m.index) });
  }
  return hits;
}

/**
 * Every leak in one text, read as written, decoded, and with its tags removed. One occurrence is one hit: a reading
 * that sees the same kind (and hash) on a line more often than another counts its own number there, so the readings
 * never add up to more than the text holds, and two occurrences on one line are two hits.
 */
export function scanText(text, secret, cache = new Map(), patterns = true) {
  const variants = [text];
  const dec = decoded(text);
  if (dec !== text) variants.push(dec);
  const bare = untagged(dec);
  if (bare !== dec) variants.push(bare);
  const most = new Map();
  for (const v of variants) {
    const here = new Map();
    for (const hit of scanOne(v, secret, cache, patterns)) {
      const key = `${hit.kind}:${hit.line}:${hit.hash ?? ''}`;
      if (!here.has(key)) here.set(key, { hit, n: 0 });
      here.get(key).n++;
    }
    for (const [key, x] of here) if ((most.get(key)?.n ?? 0) < x.n) most.set(key, x);
  }
  return [...most.values()].flatMap(({ hit, n }) => Array.from({ length: n }, () => ({ ...hit })));
}

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|webm|mp4|mov|woff2?|ttf|otf|pdf|zip)$/i;
// A file of a text type is read as text whatever bytes it holds: a NUL byte never hides a page.
const TEXT = /\.(html?|json|jsonl|js|mjs|cjs|css|svg|xml|txt|md|csv|tsv|map|vtt|srt|ya?ml|toml|sha256|webmanifest)(\.gz)?$/i;
/**
 * The runs of printable text inside a binary file (metadata, an embedded comment), for the term and canary lookup. Only
 * runs of 8 or more characters count: a short run in compressed bytes is noise, and could spell a short term by chance.
 */
function printable(bytes) {
  const out = [];
  for (const m of bytes.toString('latin1').matchAll(/[\x20-\x7e\t]{8,}/g)) out.push(m[0]);
  return out.join('\n');
}
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.name === '.git' || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/**
 * The files of a tar archive (a vendored bundle of raw evidence), each as {name, bytes}. ustar names with their prefix,
 * GNU long names and pax paths are read; anything that is not a regular file is skipped. A truncated or malformed
 * archive throws: an archive the gate cannot read is never a pass.
 */
export function* tarEntries(buf, shown) {
  let at = 0, longName = null;
  const field = (h, from, len) => h.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '');
  while (at + 512 <= buf.length) {
    const h = buf.subarray(at, at + 512);
    if (h.every(b => b === 0)) return;
    const size = Number.parseInt(field(h, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || at + 512 + size > buf.length) throw new Error(`leak gate: ${shown} is not a readable tar archive`);
    const type = String.fromCharCode(h[156] || 48), body = buf.subarray(at + 512, at + 512 + size);
    let name = longName ?? [field(h, 345, 155), field(h, 0, 100)].filter(Boolean).join('/');
    longName = null;
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
    else if (type === 'x') { const m = body.toString('utf8').match(/^\d+ path=(.*)$/m); if (m) longName = m[1]; }
    else if (type === '0' || type === '7') yield { name, bytes: body };
    at += 512 + Math.ceil(size / 512) * 512;
  }
  // No end-of-archive block: the archive is cut short.
  throw new Error(`leak gate: ${shown} is not a readable tar archive`);
}

/** -> {files, texts, binaries, hits:[{file, line, kind, hash?}]}. A path's name is scanned too, and so is every file inside a tar archive. */
export function scanPaths(paths, secret) {
  const cache = new Map();
  const result = { files: 0, texts: 0, binaries: 0, hits: [] };
  const one = (path, read) => {
    result.files++;
    // A path that itself holds a leak is never printed: it is named by the first 8 hex of its sha256 instead.
    const pathHits = scanText(path, secret, cache);
    const shown = pathHits.length ? `[a file name, sha256 ${createHash('sha256').update(path).digest('hex').slice(0, 8)}]` : path;
    for (const hit of pathHits) result.hits.push({ file: shown, ...hit, line: 0 });
    let bytes = read();
    if (/\.(gz|tgz)$/i.test(path)) { try { bytes = gunzipSync(bytes); } catch { throw new Error(`leak gate: ${shown} does not decompress`); } }
    if (/\.(tar|tar\.gz|tgz)$/i.test(path)) {
      result.binaries++;
      for (const entry of tarEntries(bytes, shown)) one(`${shown}!${entry.name}`, () => entry.bytes);
      return;
    }
    if (!TEXT.test(path) && (BINARY.test(path) || bytes.subarray(0, 8192).includes(0))) {
      result.binaries++;
      for (let from = 0; from < bytes.length; from += 1 << 26) for (const hit of scanText(printable(bytes.subarray(from, from + (1 << 26) + 64)), secret, cache, false)) result.hits.push({ file: shown, ...hit, line: 0 });
      return;
    }
    result.texts++;
    for (const hit of scanText(bytes.toString('utf8').replaceAll('\0', ''), secret, cache)) result.hits.push({ file: shown, ...hit });
  };
  for (const root of paths) {
    if (!existsSync(root)) throw new Error(`leak gate: ${root} does not exist`);
    const files = statSync(root).isDirectory() ? walk(root) : [root];
    for (const file of files) one(relative(process.cwd(), file) || file, () => readFileSync(file));
  }
  return result;
}

export const report = hit => `LEAK ${hit.file}:${hit.line} ${hit.kind}${hit.hash ? ` hash ${hit.hash}` : ''}`;

/**
 * The known occurrences (scripts/leak-gate-known.json): rows {file, kind, hash?, count, reason} for a hit that is
 * reviewed and cannot be edited away here, such as a term inside a hash-pinned pre-registration. A row covers exactly
 * `count` hits of that kind (and hash) in that file: one more is a new leak, one fewer is a stale row, and both fail.
 * A canary can never be a known occurrence.
 */
export function loadKnown(raw) {
  const d = JSON.parse(raw);
  if (!d || d.format !== 'odin-leak-gate-known' || d.version !== 1 || !Array.isArray(d.known)) throw new Error('leak gate: the known-occurrence list has the wrong format');
  for (const row of d.known) {
    if (typeof row.file !== 'string' || typeof row.kind !== 'string' || !Number.isInteger(row.count) || row.count < 1 || typeof row.reason !== 'string' || row.reason.length < 10) throw new Error('leak gate: a known occurrence needs file, kind, count and a reason');
    if (row.kind === 'canary') throw new Error('leak gate: a canary can never be a known occurrence');
    if (row.kind === 'term' && !/^[0-9a-f]{8}$/.test(row.hash ?? '')) throw new Error('leak gate: a known term needs its 8-hex hash prefix');
  }
  return d.known;
}

const keyOf = h => `${h.file}\0${h.kind}\0${h.hash ?? ''}`;
// A row whose file is "<archive>!*" covers that kind in every file inside the archive, as one exact count.
const archiveOf = file => (file.includes('!') ? `${file.slice(0, file.indexOf('!'))}!*` : null);
/** -> {fresh: hits no row covers, stale: rows whose count differs, known: hits a row covers}. */
export function settle(hits, known) {
  const groups = new Map();
  const rows = new Map(known.map(row => [keyOf(row), row]));
  for (const hit of hits) {
    const wide = archiveOf(hit.file) && keyOf({ ...hit, file: archiveOf(hit.file) });
    const k = wide && rows.has(wide) ? wide : keyOf(hit);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(hit);
  }
  const fresh = [], stale = [];
  let covered = 0;
  for (const [k, list] of groups) {
    const row = rows.get(k);
    if (!row || list[0].kind === 'canary') fresh.push(...list);
    else if (row.count !== list.length) stale.push({ ...row, seen: list.length });
    else covered += list.length;
  }
  for (const [k, row] of rows) if (!groups.has(k)) stale.push({ ...row, seen: 0 });
  return { fresh, stale, known: covered };
}

const SLOTS = ['terms', 'canaries', 'scanned', 'commit', 'files', 'hits', 'known'];
/** The Leak screen page, its slots filled. Throws when a slot is missing, so the page cannot silently go stale. */
export function fillPage(html, values) {
  let out = html;
  for (const slot of SLOTS) {
    const re = new RegExp(`(<[^>]*data-leak-screen="${slot}"[^>]*>)[^<]*(<)`);
    if (!re.test(out)) throw new Error(`leak gate: the Leak screen page has no "${slot}" slot`);
    out = out.replace(re, (_, open, close) => `${open}${String(values[slot]).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}${close}`);
  }
  return out.replace(/(<time[^>]*data-leak-screen="scanned"[^>]*datetime=")[^"]*(")/, `$1${values.scanned}$2`);
}

function main(argv) {
  const args = [...argv], paths = [];
  let env = 'LEAK_SCREEN_SECRET', page = null, knownPath = null, setPath = null, commit = process.env.GITHUB_SHA ?? '';
  while (args.length) {
    const a = args.shift();
    if (a === '--secret-env') env = args.shift();
    else if (a === '--page') page = args.shift();
    else if (a === '--commit') commit = args.shift();
    else if (a === '--known') knownPath = args.shift();
    else if (a === '--set') setPath = args.shift();
    else paths.push(a);
  }
  if (!paths.length) throw new Error('leak gate: nothing to scan');
  const secret = loadSecret(process.env[env]);
  if (!setPath) throw new Error('leak gate: --set names the committed term set; the gate never runs without it');
  checkCommitment(secret, readFileSync(setPath, 'utf8'));
  const result = scanPaths(paths, secret);
  if (result.texts === 0) throw new Error('leak gate: no text was read');
  const known = knownPath ? loadKnown(readFileSync(knownPath, 'utf8')) : [];
  const { fresh, stale, known: covered } = settle(result.hits, known);
  for (const hit of fresh) console.log(report(hit));
  for (const row of stale) console.log(`STALE known occurrence ${row.file} ${row.kind}${row.hash ? ` hash ${row.hash}` : ''}: listed ${row.count}, seen ${row.seen}`);
  console.log(`leak gate: ${secret.terms} protected terms, ${secret.canaries} canaries; ${result.texts} text files read, ${result.binaries} binary files counted; ${fresh.length} hits, ${covered} known occurrences, ${stale.length} stale rows.`);
  if (fresh.length || stale.length) return 1;
  if (page) {
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('leak gate: --page needs the commit (40 hex) the site was built from');
    const filled = fillPage(readFileSync(page, 'utf8'), { terms: secret.terms, canaries: secret.canaries, scanned: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), commit, files: result.texts, hits: 0, known: covered });
    const again = scanText(filled, secret);
    if (again.length) { for (const hit of again) console.log(report({ file: page, ...hit })); return 1; }
    writeFileSync(page, filled);
    console.log(`leak gate: ${page} filled for ${commit.slice(0, 12)}.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
