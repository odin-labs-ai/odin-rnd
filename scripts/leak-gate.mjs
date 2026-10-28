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
import { crc32, inflateRawSync, inflateSync } from 'node:zlib';
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
  return (String(term).normalize('NFKC').toLowerCase().replaceAll('ς', 'σ').match(WORD) ?? []).join('-');
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
  // strict: the terms of a class that has no allowlist (the client, an employer, a publisher). Always present, may not
  // be empty, every entry one of the terms: a known occurrence can never cover one of them.
  if (!Array.isArray(d.strict) || d.strict.length === 0 || !d.strict.every(h => typeof h === 'string' && HEX24.test(h) && d.terms.includes(h))) throw new Error('leak gate: the term set has no valid strict class');
  const kinds = new Map();
  for (const h of d.terms) kinds.set(h, 'term');
  for (const h of d.canaries) kinds.set(h, 'canary');
  return { salt: d.salt, kinds, heads: new Set(d.heads), terms: new Set(d.terms).size, canaries: new Set(d.canaries).size, strict: new Set(d.strict.map(h => h.slice(0, 8))), commitment: commitmentOf(d.salt, d.terms, d.canaries, d.heads, d.strict) };
}

/** The public commitment to one exact term set: its counts and the sha256 of its sorted hashes (no term, no salt). */
export function commitmentOf(salt, terms, canaries, heads, strict) {
  const [t, c, f, x] = [terms, canaries, heads, strict].map(list => [...new Set(list)].sort());
  // The salt is hashed in too (a random 128-bit value: its hash gives nothing away), so a set with the right hashes
  // but another salt, which would match nothing, is a different set.
  return { terms: t.length, canaries: c.length, sha256: createHash('sha256').update(`salt\n${salt}\nterms\n${t.join('\n')}\ncanaries\n${c.join('\n')}\nheads\n${f.join('\n')}\nstrict\n${x.join('\n')}\n`).digest('hex') };
}

/**
 * The term set must be exactly the one committed in public (scripts/leak-gate-set.json): a set with one term removed is
 * a different set and stops the build. Changing the set is a reviewed change to that file.
 */
export function checkCommitment(secret, raw) {
  let want;
  try { want = JSON.parse(raw); } catch { throw new Error('leak gate: the term-set commitment is not JSON'); }
  if (!want || want.format !== 'odin-leak-gate-set' || want.version !== 1 || !Number.isInteger(want.terms) || !Number.isInteger(want.canaries) || !/^[0-9a-f]{64}$/.test(want.sha256 ?? '')) throw new Error('leak gate: the term-set commitment has the wrong format');
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
// HTML also closes a comment at "<!-->", "<!--->" and "--!>".
const TAG = /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const untagged = r => mapped(r, TAG, tag => tag.replace(/[^\n]/g, ''));
/** Tags read as a space: "Some<br>Name", where removing the tag would glue the words into one. */
const spaced = r => mapped(r, TAG, () => ' ');
/** NFKC and lower case, character by character, so every offset still maps back. */
// NFKC and lower case over a whole run of non-ASCII text (with the character before it), exactly as a term is
// normalised, while every output character keeps the offset of the grapheme that produced it. When the run folds
// grapheme by grapheme to the same text (nearly always), that is the mapping; otherwise the run is normalised as a
// growing prefix and each new output character takes the offset of the grapheme just added. A run above 4,096
// graphemes that needs this stops the build (fail closed) rather than lose its occurrences' offsets.
const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' });
// A final sigma is a sigma: lower case depends on the next character, which a run may not include.
const fold = t => t.normalize('NFKC').toLowerCase().replaceAll('ς', 'σ');
function foldRun(run) {
  const segs = [...GRAPHEMES.segment(run)];
  const whole = fold(run);
  let text = '';
  const from = [];
  for (const { segment, index } of segs) { const f = fold(segment); text += f; for (let k = 0; k < f.length; k++) from.push(index); }
  if (text === whole) return { text, from };
  if (segs.length > 4096) throw new Error('leak gate: a long run of text normalises in a way the gate cannot map to its source; the file cannot be screened');
  let prev = '', offs = [], raw = '';
  for (const { segment, index } of segs) {
    raw += segment;
    const cur = fold(raw);
    let p = 0;
    while (p < prev.length && p < cur.length && prev[p] === cur[p]) p++;
    offs = [...offs.slice(0, p), ...Array.from({ length: cur.length - p }, () => index)];
    prev = cur;
  }
  return { text: prev, from: offs };
}
const folded = r => (/[^\x00-\x7f]/.test(r.text) ? mapped(r, /[\x21-\x7e]?[^\x00-\x7f]+/gu, foldRun) : r);

const lineOf = (starts, pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
const lineStarts = text => { const out = [0]; for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1); return out; };

/** -> [{kind, at (offset in the original text), hash?}] for one reading. */
function scanOne(r, secret, cache, shortest) {
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
      // A term shorter than `shortest` letters is not matched here (raw compressed bytes); a canary always is.
      if (kind && (kind === 'canary' || joined.length - n + 1 >= shortest)) hits.push({ kind, at: f.at[words[i][1]], hash: h.slice(0, 8) });
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
export function scanText(text, secret, cache = new Map(), shortest = 1) {
  const raw = identity(text);
  // Decoded twice as well: a script's escape can spell a reference (\u0026#111; is &#111;, which HTML then reads).
  const dec = decodedReading(raw), twice = decodedReading(dec);
  const readings = [raw, dec, untagged(dec), spaced(dec), twice, untagged(twice), spaced(twice)].filter((r, i, all) => all.findIndex(x => x.text === r.text) === i);
  const seen = new Map();
  for (const r of readings) for (const hit of scanOne(r, secret, cache, shortest)) {
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
  // Printable ASCII and well-formed UTF-8 sequences both count, so a UTF-8 name in metadata ("café") reads whole.
  for (const m of bytes.toString('latin1').matchAll(/(?:[\x20-\x7e\t]|[\xc2-\xdf][\x80-\xbf]|[\xe0-\xef][\x80-\xbf]{2}|[\xf0-\xf4][\x80-\xbf]{3})+/g)) out.push(Buffer.from(m[0], 'latin1').toString('utf8'));
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
    // The end-of-archive block: everything after it must be zero padding, or the archive hides bytes no entry holds.
    if (h.every(b => b === 0)) { if (buf.subarray(at).every(b => b === 0)) return; throw new Error(`leak gate: ${shown} has bytes after its end`); }
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
    // And the whole header block as printable runs, so no field or unused byte of it goes unread.
    yield { meta: Buffer.concat([Buffer.from(fields.join('\n') + '\n'), h, Buffer.from([10]), type === '0' || type === '7' ? Buffer.alloc(0) : body]) };
    // A member's padding up to its 512-byte boundary must be zero: anything else is bytes no entry holds.
    const end = at + 512 + Math.ceil(size / 512) * 512;
    if (end > buf.length) throw new Error(`leak gate: ${shown} is not a readable tar archive`);
    if (!buf.subarray(at + 512 + size, end).every(b => b === 0)) throw new Error(`leak gate: ${shown} has bytes in a member's padding`);
    at = end;
  }
  // No end-of-archive block: the archive is cut short.
  throw new Error(`leak gate: ${shown} is not a readable tar archive`);
}

export const RAW_SHORTEST = 5;

/**
 * The readable metadata of a binary, as text (one item per line), or null for a type the gate does not parse: PNG
 * text and other ancillary chunks (zTXt and compressed iTXt inflated), JPEG APPn and comment segments (EXIF, XMP,
 * IPTC), and every WebM element outside the clusters and cues (title, muxing and writing app, tags, track names,
 * attachments). A file of these types that does not parse stops the build: its metadata cannot be read.
 */
export function binaryMetadata(path, b, shown) {
  const bad = () => new Error(`leak gate: ${shown} does not parse, so its metadata cannot be read`);
  const text = buf => printable(buf);
  if (/\.png$/i.test(path)) {
    // The full signature, IHDR first, at least one IDAT, every chunk's CRC, and IEND: anything else does not parse.
    if (b.length < 8 || !b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw bad();
    const out = [];
    let first = true, idat = false;
    const inflated = data => { try { return inflateSync(data); } catch { throw bad(); } };
    for (let at = 8; ;) {
      if (at + 12 > b.length) throw bad();
      const len = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + len);
      if (at + 12 + len > b.length || b.readUInt32BE(at + 8 + len) !== crc32(b.subarray(at + 4, at + 8 + len))) throw bad();
      if (first && (type !== 'IHDR' || len !== 13)) throw bad();
      first = false;
      if (type === 'IDAT') idat = true;
      if (type === 'zTXt' || type === 'iCCP') { const k = data.indexOf(0); if (k < 0) throw bad(); out.push(text(data.subarray(0, k)), text(inflated(data.subarray(k + 2)))); }
      else if (type === 'iTXt') {
        const k = data.indexOf(0), compressed = data[k + 1], rest = data.subarray(k + 3), l = rest.indexOf(0), t = rest.subarray(l + 1), m = t.indexOf(0), body = t.subarray(m + 1);
        if (k < 0 || l < 0 || m < 0) throw bad();
        out.push(text(data.subarray(0, k)), text(rest.subarray(0, l)), text(t.subarray(0, m)), text(compressed ? inflated(body) : body));
      } else if (!['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'fdAT'].includes(type)) out.push(text(data));
      at += 12 + len;
      if (type === 'IEND') { if (!idat) throw bad(); if (at < b.length) out.push(text(b.subarray(at))); return out.join('\n'); }
    }
  }
  if (/\.jpe?g$/i.test(path)) {
    // Every marker segment through EOI, across scans: the compressed data after each SOS runs to the next marker
    // (stuffed FF00, restart markers and fill bytes stay inside it). A file without SOS or EOI does not parse.
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw bad();
    const out = [];
    let scans = 0, frame = false;
    for (let at = 2; ;) {
      if (at + 2 > b.length || b[at] !== 0xff) throw bad();
      const marker = b[at + 1];
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd9) { if (!scans) throw bad(); if (at + 2 < b.length) out.push(text(b.subarray(at + 2))); return out.join('\n'); }
      if (at + 4 > b.length) throw bad();
      const len = b.readUInt16BE(at + 2);
      if (len < 2 || at + 2 + len > b.length) throw bad();
      if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) out.push(text(b.subarray(at + 4, at + 2 + len)));
      // A frame header (SOFn: precision, height, width, 1-4 components of 3 bytes) must come before the first scan, and
      // every scan header (SOS: 1-4 components of 2 bytes, then 3 bytes) must be complete.
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { const n = b[at + 9]; if (len !== 8 + 3 * n || n < 1 || n > 4) throw bad(); frame = true; }
      if (marker === 0xda) { const n = b[at + 4]; if (!frame || n < 1 || n > 4 || len !== 6 + 2 * n) throw bad(); }
      at += 2 + len;
      if (marker === 0xda) {
        scans++;
        while (at < b.length && !(b[at] === 0xff && at + 1 < b.length && b[at + 1] !== 0 && !(b[at + 1] >= 0xd0 && b[at + 1] <= 0xd7) && b[at + 1] !== 0xff)) at++;
        if (at >= b.length) throw bad();
      }
    }
  }
  if (/\.(webm|mkv)$/i.test(path)) {
    const out = [];
    const vint = (at, keep) => {
      if (at >= b.length) throw bad();
      const first = b[at];
      let len = 1, mask = 0x80;
      while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
      if (len > 8 || at + len > b.length) throw bad();
      let v = keep ? first : first & (mask - 1);
      for (let i = 1; i < len; i++) v = v * 256 + b[at + i];
      return { v, len, unknown: !keep && v === 2 ** (7 * len) - 1 };
    };
    // Master elements walked for their children; the rest are payloads read as text, except inside clusters and cues.
    const MASTER = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1254c367, 0x7373, 0x63c0, 0x67c8, 0x1941a469, 0x61a7, 0x1043a770, 0x45b9, 0xb6, 0x80, 0x114d9b74, 0x4dbb]);
    // Where an unknown-size cluster ends: the next top-level element, or a new EBML document or segment.
    const LEVEL1 = new Set([0x1a45dfa3, 0x18538067, 0x114d9b74, 0x1549a966, 0x1f43b675, 0x1654ae6b, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);
    const SKIP = new Set([0x1f43b675, 0x1c53bb6b]);
    const walk = (from, to) => {
      for (let at = from; at < to;) {
        const id = vint(at, true), size = vint(at + id.len, false), data = at + id.len + size.len;
        if (size.unknown) {
          if (id.v === 0x18538067) { walk(data, to); return; }
          if (id.v !== 0x1f43b675) throw bad();
          // A cluster of unknown size ends at the next top-level element.
          let c = data;
          while (c < to) { const cid = vint(c, true); if (LEVEL1.has(cid.v)) break; const cs = vint(c + cid.len, false); if (cs.unknown) throw bad(); c += cid.len + cs.len + cs.v; }
          if (c > to) throw bad();
          at = c;
          continue;
        }
        const end = data + size.v;
        if (end > to) throw bad();
        if (MASTER.has(id.v)) walk(data, end);
        else if (!SKIP.has(id.v)) out.push(text(b.subarray(data, end)));
        at = end;
      }
    };
    walk(0, b.length);
    return out.join('\n');
  }
  return null;
}

/**
 * A gzip file, decompressed, when it is one member with no header text: a file name, a comment or an extra field in
 * the header, or a second member or bytes after the first, is text or data the gate would not read, and stops the build.
 */
export function gunzipStrict(buf, shown) {
  if (buf.length < 18 || buf[0] !== 0x1f || buf[1] !== 0x8b || buf[2] !== 8) throw new Error(`leak gate: ${shown} does not decompress`);
  const flags = buf[3];
  // No optional header field at all (name, comment, extra, header CRC): a plain 10-byte header, whose bytes are read.
  if (flags !== 0) throw new Error(`leak gate: ${shown} carries gzip header fields the gate does not read`);
  const start = 10;
  let out;
  try { out = inflateRawSync(buf.subarray(start), { info: true }); } catch { throw new Error(`leak gate: ${shown} does not decompress`); }
  if (start + out.engine.bytesWritten + 8 !== buf.length) throw new Error(`leak gate: ${shown} has more than one gzip member, or bytes after it`);
  // The trailer must be the CRC32 and length of what was decompressed: eight bytes that carry nothing else.
  if (buf.readUInt32LE(buf.length - 8) !== crc32(out.buffer) || buf.readUInt32LE(buf.length - 4) !== out.buffer.length % 2 ** 32) throw new Error(`leak gate: ${shown} has a gzip trailer that does not match its content`);
  return out.buffer;
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
    if (/\.(gz|tgz)$/i.test(path)) {
      for (const hit of scanText(printable(bytes.subarray(0, 10)), secret, cache)) result.hits.push({ file: `${shown}!(gzip header)`, ...hit, line: 0 });
      bytes = gunzipStrict(bytes, shown);
    }
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
      // Raw bytes: every canary, every machine pattern and every term of 5 letters or more. A shorter term turns up in
      // compressed bytes by chance, so it is matched only in the file's readable metadata, which is read for all terms.
      for (const hit of scanText(printable(bytes), secret, cache, RAW_SHORTEST)) result.hits.push({ file: shown, ...hit, line: 0 });
      const meta = binaryMetadata(path, bytes, shown);
      if (meta !== null) for (const hit of scanText(meta, secret, cache)) result.hits.push({ file: `${shown}!(metadata)`, ...hit, line: 0 });
      return;
    }
    result.texts++;
    let hits;
    try { hits = scanText(bytes.toString('utf8').replaceAll('\0', ''), secret, cache); } catch (error) { throw new Error(`${error.message} (${shown})`); }
    for (const hit of hits) result.hits.push({ file: shown, ...hit });
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
/** The canonical bytes a review stamp covers: every row, its fields in one fixed order. */
export const rowsDigest = rows => createHash('sha256').update(JSON.stringify(rows.map(r => [r.file, r.kind, r.hash ?? null, r.count, r.reason]))).digest('hex');

/**
 * The known list carries a review stamp, {rowsSha256, by, on}: the sha256 of its rows. Any change to the rows (a row
 * added, a count raised, a reason reworded) without a new stamp stops the build, so the list changes only by an
 * explicit, visible review. A row for a strict-class term (secret.strict) is refused outright: that class has no
 * allowlist.
 */
export function loadKnown(raw, secret = null) {
  let d;
  try { d = JSON.parse(raw); } catch { throw new Error('leak gate: the known-occurrence list is not JSON'); }
  if (!d || d.format !== 'odin-leak-gate-known' || d.version !== 1 || !Array.isArray(d.known)) throw new Error('leak gate: the known-occurrence list has the wrong format');
  for (const row of d.known) {
    if (typeof row.file !== 'string' || typeof row.kind !== 'string' || !Number.isInteger(row.count) || row.count < 1 || typeof row.reason !== 'string' || row.reason.length < 10) throw new Error('leak gate: a known occurrence needs file, kind, count and a reason');
    if (row.kind === 'canary') throw new Error('leak gate: a canary can never be a known occurrence');
    if (row.kind !== 'term' && !PATTERNS.some(([kind]) => kind === row.kind)) throw new Error('leak gate: a known occurrence names a kind the gate does not report');
    if (row.kind === 'term' && !/^[0-9a-f]{8}$/.test(row.hash ?? '')) throw new Error('leak gate: a known term needs its 8-hex hash prefix');
    if (row.kind !== 'term' && row.hash !== undefined) throw new Error('leak gate: only a known term carries a hash');
    const extra = Object.keys(row).filter(k => !['file', 'kind', 'hash', 'count', 'reason'].includes(k));
    if (extra.length) throw new Error('leak gate: a known occurrence has a field the gate does not read');
    if (secret && row.kind === 'term' && secret.strict.has(row.hash)) throw new Error('leak gate: a known occurrence names a term of a class that has no allowlist (client, employer, publisher)');
  }
  const r = d.reviewed;
  if (!r || typeof r !== 'object' || !/^[0-9a-f]{64}$/.test(r.rowsSha256 ?? '') || typeof r.by !== 'string' || r.by.length < 2 || !/^\d{4}-\d\d-\d\d$/.test(r.on ?? '')) throw new Error('leak gate: the known-occurrence list has no review stamp');
  if (r.rowsSha256 !== rowsDigest(d.known)) throw new Error('leak gate: the known-occurrence list changed without a new review stamp');
  return d.known;
}

const keyOf = h => `${h.file}\0${h.kind}\0${h.hash ?? ''}`;
// A row whose file is "<archive>!*" covers that kind in every file inside the archive, as one exact count.
const archiveOf = file => (file.includes('!') ? `${file.slice(0, file.indexOf('!'))}!*` : null);
/** -> {fresh: hits no row covers, stale: rows whose count differs, known: hits a row covers}. */
export function settle(hits, known, strict = new Set()) {
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
    if (!row || list[0].kind === 'canary' || (list[0].kind === 'term' && strict.has(list[0].hash))) fresh.push(...list);
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
  // Configuration files are read with fixed messages: a read error would name the path, which could hold a leak.
  const config = (file, what) => { try { return readFileSync(file, 'utf8'); } catch (error) { throw new Error(`leak gate: the ${what} cannot be read (${error.code ?? 'error'})`); } };
  checkCommitment(secret, config(setPath, 'term-set commitment'));
  const result = scanPaths(paths, secret);
  if (result.texts === 0) throw new Error('leak gate: no text was read');
  const known = knownPath ? loadKnown(config(knownPath, 'known-occurrence list'), secret) : [];
  const { fresh, stale, known: covered } = settle(result.hits, known, secret.strict);
  for (const hit of fresh) console.log(report(hit));
  // A row's file is printed only when it holds no leak itself, like any scanned name.
  const named = file => (scanText(file, secret).length ? `[a file name, sha256 ${createHash('sha256').update(file).digest('hex').slice(0, 8)}]` : file);
  for (const row of stale) console.log(`STALE known occurrence ${named(row.file)} ${row.kind}${row.hash ? ` hash ${row.hash}` : ''}: listed ${row.count}, seen ${row.seen}`);
  console.log(`leak gate: ${secret.terms} protected terms, ${secret.canaries} canaries; ${result.texts} text files read, ${result.binaries} binary files counted; ${fresh.length} hits, ${covered} known occurrences, ${stale.length} stale rows.`);
  if (fresh.length || stale.length) return 1;
  if (page) {
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('leak gate: --page needs the commit (40 hex) the site was built from');
    const filled = fillPage(config(page, 'Leak screen page'), { terms: secret.terms, canaries: secret.canaries, scanned: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), commit, files: result.texts, hits: 0, known: covered });
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
