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
// The most separator characters (after white space is collapsed) between two words of one term, as in `", "` or `</b> <b>`.
const MAX_GAP = 8;
export const MAX_BINARY = 256 * 1024 * 1024;

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
  return { salt: d.salt, kinds, heads: new Set(d.heads), terms: new Set(d.terms).size, canaries: new Set(d.canaries).size, commitment: commitmentOf(d.salt, d.terms, d.canaries, d.heads) };
}

/** The public commitment to one exact term set: its counts and the sha256 of its sorted hashes (no term, no salt). */
export function commitmentOf(salt, terms, canaries, heads) {
  const [t, c, f] = [terms, canaries, heads].map(list => [...new Set(list)].sort());
  // The salt is hashed in too (a random 128-bit value: its hash gives nothing away), so a set with the right hashes
  // but another salt, which would match nothing, is a different set.
  return { terms: t.length, canaries: c.length, sha256: createHash('sha256').update(`salt\n${salt}\nterms\n${t.join('\n')}\ncanaries\n${c.join('\n')}\nheads\n${f.join('\n')}\n`).digest('hex') };
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
  ['loopback', /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\[::1\]|\blocalhost:\d/i],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['api-key', /\bsk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// HTML's whole table of named references (scripts/html-named-references.json, the WHATWG list): a reference reads as
// the longest name at its start, with its semicolon or, for the 106 legacy names, without ("&copyQuarry;" is
// "©Quarry;", "&notin;" is "∉"). A name not in the table stays as written, as it does in a browser.
const REFS = JSON.parse(readFileSync(new URL('./html-named-references.json', import.meta.url), 'utf8')).references;
const LONGEST_REF = Math.max(...Object.keys(REFS).map(k => k.length));

// A reading of a text keeps, for every character, the offset in the ORIGINAL text it came from. Two readings that see
// the same occurrence therefore name the same offset, and one occurrence counts once however many readings see it.
const identity = text => { const at = new Int32Array(text.length); for (let i = 0; i < at.length; i++) at[i] = i; return { text, at }; };
function mapped(r, re, fn) {
  let text = '', parts = [], last = 0;
  const at = [];
  for (const m of r.text.matchAll(re)) {
    text += r.text.slice(last, m.index); parts.push(r.at.subarray(last, m.index));
    // fn returns a string (every character from the match's start) or {text, from}: each character's offset in the match.
    const out = fn(...m), str = typeof out === 'string' ? out : out.text;
    if (typeof out !== 'string' && out.from.length !== str.length) throw new Error('leak gate: a reading lost its offsets');
    text += str;
    parts.push(typeof out === 'string' ? new Int32Array(str.length).fill(r.at[m.index] ?? 0) : Int32Array.from(out.from, k => r.at[m.index + k] ?? 0));
    last = m.index + m[0].length;
  }
  if (last === 0 && !parts.length) return r;
  text += r.text.slice(last); parts.push(r.at.subarray(last));
  const all = new Int32Array(text.length);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return { text, at: all };
}
/**
 * A run of percent codes, decoded as UTF-8 (%C2%A0 is a no-break space), each character keeping the offset of its own
 * first code so two words in one run stay two occurrences. A byte that is not valid UTF-8 stays as written; control
 * characters read as white space.
 */
function percentRun(run) {
  const bytes = run.match(/%[0-9a-f]{2}/gi).map(c => Number.parseInt(c.slice(1), 16));
  let text = '';
  const from = [];
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i], len = b < 0x80 ? 1 : b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0;
    let ch = null;
    if (len && i + len <= bytes.length) { try { ch = decodeURIComponent(run.slice(i * 3, (i + len) * 3)); } catch { ch = null; } }
    if (ch === null) { text += run.slice(i * 3, i * 3 + 3); from.push(i * 3, i * 3 + 1, i * 3 + 2); i++; continue; }
    if (/^[\x00-\x1f\x7f]$/.test(ch)) ch = ' ';
    text += ch;
    for (let k = 0; k < ch.length; k++) from.push(i * 3);
    i += len;
  }
  return { text, from };
}
/** A named reference as HTML reads it: the longest name in the table at its start; the rest stays text. */
function namedRef(m) {
  const tail = m.slice(1);
  for (let len = Math.min(tail.length, LONGEST_REF); len > 0; len--) {
    const name = tail.slice(0, len);
    if (!Object.hasOwn(REFS, name)) continue;
    const head = REFS[name], rest = tail.slice(len);
    // One offset per UTF-16 code unit, as mapped() counts them (an astral character such as 𝔄 is two).
    return { text: head + rest, from: [...Array.from({ length: head.length }, () => 0), ...Array.from({ length: rest.length }, (_, k) => 1 + len + k)] };
  }
  return m;
}
/** The same text as a reader (or a parser) would see it: references, escapes and percent-codes undone. */
function decodedReading(r) {
  r = mapped(r, /&#x([0-9a-f]+);?/gi, (m, h) => { const c = Number.parseInt(h, 16); return c <= 0x10ffff ? String.fromCodePoint(c) : m; });
  r = mapped(r, /&#(\d+);?/g, (m, d) => (Number(d) <= 0x10ffff ? String.fromCodePoint(Number(d)) : m));
  r = mapped(r, /&[A-Za-z][A-Za-z0-9]*;?/g, namedRef);
  r = mapped(r, /\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
  r = mapped(r, /\\([/"\\])/g, (_, c) => c);
  r = mapped(r, /\\u\{([0-9a-f]{1,6})\}/gi, (m, h) => { const c = Number.parseInt(h, 16); return c <= 0x10ffff ? String.fromCodePoint(c) : m; });
  r = mapped(r, /\\x([0-9a-f]{2})/gi, (_, h) => { const c = Number.parseInt(h, 16); return c < 0x20 || c === 0x7f ? ' ' : String.fromCharCode(c); });
  r = mapped(r, /\\[nrtbf]/g, () => ' ');
  r = mapped(r, /(?:%[0-9a-f]{2})+/gi, percentRun);
  // Invisible format characters (zero-width spaces, a soft hyphen, direction marks) vanish, as they do on screen.
  return mapped(r, /\p{Cf}/gu, () => '');
}
export const decoded = text => decodedReading(identity(text)).text;
/** Tags removed (their line breaks kept): a term split by markup reads whole. */
// A comment runs to its "-->" (or the end), whatever it holds; a tag ends at the first ">" outside a quoted attribute
// value, as in HTML: <span title=">"> is one tag.
const TAG = /<!--[\s\S]*?(?:-->|$)|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const untagged = r => mapped(r, TAG, tag => tag.replace(/[^\n]/g, ''));
/** Tags read as a space: "Some<br>Name", where removing the tag would glue the words into one. */
const spaced = r => mapped(r, TAG, () => ' ');
/** NFKC and lower case, character by character, so every offset still maps back. */
const folded = r => (/[^\x00-\x7f]/.test(r.text) ? mapped(r, /[^\x00-\x7f]/gu, c => c.normalize('NFKC').toLowerCase()) : r);

const lineOf = (starts, pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
const lineStarts = text => { const out = [0]; for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1); return out; };

/** -> [{kind, at (offset in the original text), hash?}] for one reading. */
function scanOne(r, secret, cache) {
  const hits = [];
  const f = folded(r);
  const low = f.text.toLowerCase();
  const words = [...low.matchAll(WORD)].map(m => [m[0], m.index, m.index + m[0].length]);
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let n = 1; n <= MAX_WORDS && i + n <= words.length; n++) {
      const w = words[i + n - 1];
      if (n > 1) {
        // Any run of white space (a line break included) reads as one space: "Some\n  Name" is "Some Name".
        const gap = low.slice(words[i + n - 2][2], w[1]).replace(/\s+/g, ' ');
        if (gap.length > MAX_GAP) break;
      }
      joined = n === 1 ? w[0] : `${joined}-${w[0]}`;
      let h = cache.get(joined);
      if (h === undefined) { h = digest(secret.salt, joined); if (cache.size < 2_000_000) cache.set(joined, h); }
      const kind = secret.kinds.get(h);
      if (kind) hits.push({ kind, at: f.at[words[i][1]], hash: h.slice(0, 8) });
      // Longer runs are hashed only from a word that starts some term (the set's "heads"): the same answer, far fewer hashes.
      if (n === 1 && !secret.heads.has(h)) break;
    }
  }
  for (const [kind, re] of PATTERNS) {
    for (const m of r.text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) hits.push({ kind, at: r.at[m.index] });
  }
  return hits;
}

/**
 * Every leak in one text, read as written, decoded, and with its tags removed. One occurrence is one hit: each reading
 * names an occurrence by its offset in the original text, so readings that see the same occurrence count it once, and
 * occurrences that only one reading sees each count.
 */
export function scanText(text, secret, cache = new Map()) {
  const raw = identity(text);
  // Decoded twice as well: a script's escape can spell a reference (\u0026#111; is &#111;, which HTML then reads).
  const dec = decodedReading(raw), twice = decodedReading(dec);
  const readings = [raw, dec, untagged(dec), spaced(dec), twice, untagged(twice), spaced(twice)].filter((r, i, all) => all.findIndex(x => x.text === r.text) === i);
  const seen = new Map();
  for (const r of readings) for (const hit of scanOne(r, secret, cache)) {
    const key = `${hit.kind}:${hit.hash ?? ''}:${hit.at}`;
    if (!seen.has(key)) seen.set(key, hit);
  }
  const starts = lineStarts(text);
  return [...seen.values()].sort((a, b) => a.at - b.at).map(({ kind, at, hash }) => ({ kind, line: lineOf(starts, at), ...(hash ? { hash } : {}) }));
}

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|webm|mp4|mov|woff2?|ttf|otf|pdf|zip)$/i;
// A file of a text type is read as text whatever bytes it holds: a NUL byte never hides a page.
const TEXT = /\.(html?|json|jsonl|js|mjs|cjs|css|svg|xml|txt|md|csv|tsv|map|vtt|srt|ya?ml|toml|sha256|webmanifest)(\.gz)?$/i;
/**
 * The runs of printable text inside a binary file (metadata, an embedded comment), read like any text: every run, of
 * any length, each on its own line. A short term can turn up in compressed bytes by
 * chance; such a hit is reviewed and listed as a known occurrence, never filtered away here.
 */
function printable(bytes) {
  const out = [];
  for (const m of bytes.toString('latin1').matchAll(/[\x20-\x7e\t]+/g)) out.push(m[0]);
  return out.join('\n');
}
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (error) { throw new Error(`leak gate: a directory cannot be read (${error.code ?? 'error'})`); }
  return entries.flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * The files of a tar archive (a vendored bundle of raw evidence), each as {name, bytes}. ustar names with their prefix,
 * GNU long names and pax paths are read; entries that are not regular files are read as metadata (see below). A truncated or malformed
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
    // Everything else an archive carries is read too: a link's target, the owner names, and the whole header and body
    // of any entry that is not a regular file (a directory, a link, a pax or GNU record).
    // Each text field on its own line, so no field runs into the next ("2" + "/Users/..." would hide the path).
    const fields = [[157, 100], [265, 32], [297, 32], ...(type === '0' || type === '7' ? [] : [[0, 100], [345, 155]])].map(([from, len]) => field(h, from, len));
    if (type !== '0' && type !== '7') fields.push(name);
    yield { meta: Buffer.concat([Buffer.from(fields.join('\n') + '\n'), type === '0' || type === '7' ? Buffer.alloc(0) : body]) };
    at += 512 + Math.ceil(size / 512) * 512;
  }
  // No end-of-archive block: the archive is cut short.
  throw new Error(`leak gate: ${shown} is not a readable tar archive`);
}

/** -> {files, texts, binaries, hits:[{file, line, kind, hash?}]}. A path's name is scanned too, and so is every file inside a tar archive. */
export function scanPaths(paths, secret, { maxBinary = MAX_BINARY } = {}) {
  const cache = new Map();
  const result = { files: 0, texts: 0, binaries: 0, hits: [] };
  const one = (path, read) => {
    result.files++;
    // A path that itself holds a leak is never printed: it is named by the first 8 hex of its sha256 instead.
    const pathHits = scanText(path, secret, cache);
    const shown = pathHits.length ? `[a file name, sha256 ${createHash('sha256').update(path).digest('hex').slice(0, 8)}]` : path;
    for (const hit of pathHits) result.hits.push({ file: shown, ...hit, line: 0 });
    // A read error names the path; it is reported by the name shown instead, which is redacted when it holds a leak.
    let bytes;
    try { bytes = read(); } catch (error) { throw new Error(`leak gate: ${shown} cannot be read (${error.code ?? 'error'})`); }
    if (/\.(gz|tgz)$/i.test(path)) { try { bytes = gunzipSync(bytes); } catch { throw new Error(`leak gate: ${shown} does not decompress`); } }
    if (/\.(tar|tar\.gz|tgz)$/i.test(path)) {
      result.binaries++;
      const meta = [];
      for (const entry of tarEntries(bytes, shown)) {
        if (entry.meta) meta.push(entry.meta, Buffer.from([10]));
        else one(`${shown}!${entry.name}`, () => entry.bytes);
      }
      for (const hit of scanText(printable(Buffer.concat(meta)), secret, cache)) result.hits.push({ file: `${shown}!(archive headers)`, ...hit, line: 0 });
      return;
    }
    if (!TEXT.test(path) && (BINARY.test(path) || bytes.subarray(0, 8192).includes(0))) {
      result.binaries++;
      // Read whole, never in windows (a term could straddle a window's edge); a binary too large to read whole stops the build.
      if (bytes.length > maxBinary) throw new Error(`leak gate: ${shown} is too large to read whole (${bytes.length} bytes)`);
      for (const hit of scanText(printable(bytes), secret, cache)) result.hits.push({ file: shown, ...hit, line: 0 });
      return;
    }
    result.texts++;
    for (const hit of scanText(bytes.toString('utf8').replaceAll('\0', ''), secret, cache)) result.hits.push({ file: shown, ...hit });
  };
  for (const root of paths) {
    if (!existsSync(root)) throw new Error('leak gate: a path to scan does not exist');
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
    if (row.kind !== 'term' && !PATTERNS.some(([kind]) => kind === row.kind)) throw new Error('leak gate: a known occurrence names a kind the gate does not report');
    if (row.kind === 'term' && !/^[0-9a-f]{8}$/.test(row.hash ?? '')) throw new Error('leak gate: a known term needs its 8-hex hash prefix');
    if (row.kind !== 'term' && row.hash !== undefined) throw new Error('leak gate: only a known term carries a hash');
    const extra = Object.keys(row).filter(k => !['file', 'kind', 'hash', 'count', 'reason'].includes(k));
    if (extra.length) throw new Error('leak gate: a known occurrence has a field the gate does not read');
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
  // A row's file is printed only when it holds no leak itself, like any scanned name.
  const named = file => (scanText(file, secret).length ? `[a file name, sha256 ${createHash('sha256').update(file).digest('hex').slice(0, 8)}]` : file);
  for (const row of stale) console.log(`STALE known occurrence ${named(row.file)} ${row.kind}${row.hash ? ` hash ${row.hash}` : ''}: listed ${row.count}, seen ${row.seen}`);
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
