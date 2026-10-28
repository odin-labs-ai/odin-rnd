// The lab kit: what every results lab (Lab 01's engine history, Lab 05 and the labs after it) builds on, in one place,
// so a new lab cannot cite, pin, date or screen a record differently from the last one.
//
//   cite(c, mainCheck)        the one sentence a private commit is cited with (Lab 01's, word for word)
//   realInstant(iso)          a timestamp that is a real calendar instant, or null
//   parsePin / pinProblems    one pin, committed as a sha256sum line ("<hex>  <file name>\n", Lab 05) or as a JSON pin
//                             naming the file, its sha256, the sha256 of its private source and the private main head
//                             (Lab 01's engine history); either way the record's bytes must be the pinned ones, and a
//                             JSON pin must name the record's own main head and source digest
//   readPinned(...)           a committed record: pinned, parsed, checked; null when absent; throws with every reason
//   vendoredProblems(...)     the kit record contract for a new lab: dated, main-checked cites (a commit not shown as
//                             part of the private main, a lane-only commit, is refused), files by sha256
//   screenRecord(...)         every string of a record through the publisher's screen (hashes and commits excepted)
//   pageLeaks(html, known)    a rendered page through the publisher's screen and LEAKS (paths, hosts, credentials,
//                             other repositories), with only the record's own hashes masked; any other hash is refused
//   box(kind, ...)            the marked boxes: staged, real, an estimate, summary only, an authored fixture, an AI judge
//
// The publisher's screen itself (screenHits: restricted names and places, hashed in scripts/lab-screen-terms.json, money,
// emails, long ids, paths, links) stays in scripts/lab-dispatch-publish.mjs; the kit re-exports it, and validate.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { fold, screenHits } from './lab-dispatch-publish.mjs';

export { validate, screenHits };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const HEX40 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-f]{64}$/;

/** A timestamp that is a real calendar instant (2026-02-30 or 24:00 is refused), or null. */
export function realInstant(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s ? date : null;
}

/** Why a timestamp (or a YYYY-MM-DD date) may not be shown: not real, or after the build. Empty when it may. */
export function instantProblems(iso, at, now = new Date()) {
  const d = realInstant(/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? `${iso}T00:00:00Z` : iso);
  if (!d) return [`${at}: ${iso} is not a real date`];
  return d > now ? [`${at}: ${iso} is after this build`] : [];
}

// Every private commit is cited with this sentence: by hash, with the private main head it was checked to be part of,
// and when; the page cannot check it, and says so. When the record lists the commits shown to be part of main
// (mainCheck.commits, the kit record contract), a commit that is neither one of them nor the main head itself is never
// cited: it throws.
export const onMainCommits = mainCheck => [mainCheck.main, ...(Array.isArray(mainCheck.commits) ? mainCheck.commits : [])];
export const cite = (p, mainCheck) => {
  if (Array.isArray(mainCheck.commits) && !onMainCommits(mainCheck).includes(p.commit)) throw new Error(`cite: ${String(p.commit).slice(0, 8)} is not shown as part of the private main ${mainCheck.main.slice(0, 8)}; a commit only on a lane is never cited`);
  return citeText(p, mainCheck);
};
const citeText = (p, mainCheck) => `Private commit <code>${escape(p.commit.slice(0, 8))}</code>, cited by hash, checked as part of the private main <code>${escape(mainCheck.main.slice(0, 8))}</code> on <time datetime="${escape(mainCheck.checked)}">${escape(mainCheck.checked)}</time>; this page cannot check it, anyone with access can.`;

/**
 * One pin, from the bytes it is committed as: a sha256sum line ("<hex>  <file name>\n") or a JSON pin (an object, or
 * its text) { format, version: 1, file, fileSha256, sourceSha256, commit }. Returns { pin, problems }: the pin as
 * { fileSha256, name?, file?, sourceSha256?, commit? }, null when it cannot be read at all.
 */
export function parsePin(raw, { pinFile, format, file } = {}) {
  if (raw === null || raw === undefined) return { pin: null, problems: [`${pinFile}: missing${format ? `, or not ${format} v1` : ''}`] };
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    const text = String(raw);
    const line = /^([0-9a-f]{64}) {2}([^\s/]+)\n$/.exec(text);
    if (line) return { pin: { fileSha256: line[1], name: line[2] }, problems: [] };
    try { raw = JSON.parse(text); } catch { return { pin: null, problems: [`${pinFile}: not a sha256sum line ("<sha256>  <file name>") or a JSON pin`] }; }
  }
  if (!raw || typeof raw !== 'object' || raw.format !== format || raw.version !== 1) return { pin: null, problems: [`${pinFile}: missing, or not ${format} v1`] };
  const problems = [];
  if (raw.file !== file) problems.push(`${pinFile}: file is not ${file}`);
  if (!HEX64.test(raw.sourceSha256 ?? '')) problems.push(`${pinFile}: sourceSha256 is not a sha256`);
  if (!HEX40.test(raw.commit ?? '')) problems.push(`${pinFile}: commit is not a 40-hex commit`);
  return { pin: { fileSha256: raw.fileSha256, file: raw.file, sourceSha256: raw.sourceSha256, commit: raw.commit }, problems };
}

/**
 * Why a record's committed bytes are not the pinned ones. A pin is a second, separately reviewed file: the record's
 * sha256 must be the pinned one, a sha256sum line must name the record's own file, and a pin that names a private
 * source and main head must name the ones the record itself carries (vendored.sourceSha256, vendored.mainCheck.main),
 * so neither can be edited alone.
 */
export function pinProblems(bytes, pin, { pinFile, file, vendor }) {
  if (!pin) return [`${pinFile}: missing`];
  const problems = [];
  const actual = sha256(bytes);
  if (pin.name !== undefined && pin.name !== file.split('/').at(-1)) problems.push(`${pinFile}: names ${pin.name}, not ${file.split('/').at(-1)}`);
  if (pin.fileSha256 !== actual) problems.push(`${pinFile}: does not pin the sha256 of ${file} (${actual}); the pin says ${pin.fileSha256}; re-vendor with ${vendor}`);
  let record = null;
  try { record = JSON.parse(bytes); } catch { problems.push(`${file}: not JSON`); }
  const v = record?.vendored;
  if (v && pin.commit !== undefined && pin.commit !== v.mainCheck?.main) problems.push(`${pinFile}: commit ${pin.commit} is not the main head the record was checked against (${v.mainCheck?.main})`);
  if (v && pin.sourceSha256 !== undefined && pin.sourceSha256 !== v.sourceSha256) problems.push(`${pinFile}: sourceSha256 ${pin.sourceSha256} is not the record's (${v.sourceSha256})`);
  return problems;
}

/**
 * A committed record, fail-closed: null when its file is absent; otherwise its bytes through `pin(bytes)` and the
 * parsed record through `check(record)`, and when either has a problem it throws "<refused>:" with every reason.
 */
export function readPinned({ root = 'site', file, pin, check, refused }) {
  const path = join(root, file);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const problems = [...pin(bytes)];
  let record = null, parsed = false;
  try { record = JSON.parse(bytes); parsed = true; } catch { if (!problems.some(p => p === `${file}: not JSON`)) problems.push(`${file}: not JSON`); }
  // A present record is always checked: a parsed value that is not an object (null, a number, a list) is refused here,
  // never taken for an absent record.
  if (parsed && (record === null || typeof record !== 'object' || Array.isArray(record))) problems.push(`${file}: not a JSON object`);
  else if (parsed) problems.push(...check(record));
  if (problems.length) throw new Error(`${refused}:\n  ${problems.join('\n  ')}`);
  return record;
}

/** A pin committed as a sha256sum line beside its record, read and checked (the shape a new lab uses). */
export function sidecarPinProblems(root, bytes, { pinFile, file, vendor }) {
  const raw = existsSync(join(root, pinFile)) ? readFileSync(join(root, pinFile), 'utf8') : null;
  const { pin, problems } = parsePin(raw, { pinFile });
  return pin ? [...problems, ...pinProblems(bytes, pin, { pinFile, file, vendor })] : problems;
}

/**
 * Every string of a record through the publisher's screen and LEAKS (below); a hash or commit (16 to 64 hex) is the
 * schema's to check.
 */
export function screenRecord(value, where, at = '') {
  if (typeof value === 'string') return /^[0-9a-f]{16,64}$/.test(value) ? [] : [...screenHits(value).map(hit => hit.reason), ...LEAKS.filter(([re]) => re.test(value) || re.test(fold(value))).map(([, reason]) => reason)].map(reason => `${where}#${at}: ${reason}`);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => screenRecord(v, where, `${at}/${k}`));
  return [];
}

/**
 * The kit record contract (a new lab's `vendored` block): where it was read from, the private main head it was checked
 * against { main, how, checked, commits }, every private commit it cites { commit, at, what }, and every file it was
 * built from { role, what, sha256 }. A cited commit must be the main head or one of mainCheck.commits, the commits
 * shown to be part of it: a commit only on a lane is never cited.
 */
export function vendoredProblems(v, { where, now = new Date() }) {
  if (!v || typeof v !== 'object') return [`${where}#/vendored: missing`];
  const problems = [];
  const mc = v.mainCheck ?? {};
  const said = (value, at) => { if (typeof value !== 'string' || !value.trim()) problems.push(`${where}#${at}: missing (it must say it in words)`); };
  said(v.from, '/vendored/from');
  said(mc.how, '/vendored/mainCheck/how');
  if (!HEX40.test(mc.main ?? '')) problems.push(`${where}#/vendored/mainCheck/main: not a 40-hex commit`);
  if (!Array.isArray(mc.commits) || mc.commits.some(c => !HEX40.test(c))) problems.push(`${where}#/vendored/mainCheck/commits: not a list of 40-hex commits`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mc.checked ?? '')) problems.push(`${where}#/vendored/mainCheck/checked: not a date`);
  else problems.push(...instantProblems(mc.checked, `${where}#/vendored/mainCheck/checked`, now));
  const onMain = new Set([mc.main, ...(Array.isArray(mc.commits) ? mc.commits : [])]);
  for (const [i, c] of (Array.isArray(v.cites) ? v.cites : []).entries()) {
    const at = `${where}#/vendored/cites/${i}`;
    said(c.what, `/vendored/cites/${i}/what`);
    if (!HEX40.test(c.commit ?? '')) problems.push(`${at}/commit: not a 40-hex commit`);
    else if (!onMain.has(c.commit)) problems.push(`${at}/commit: ${c.commit.slice(0, 8)} is not shown as part of the private main ${String(mc.main).slice(0, 8)}; a commit only on a lane is never cited`);
    problems.push(...instantProblems(c.at, `${at}/at`, now));
  }
  if (!Array.isArray(v.cites) || !v.cites.length) problems.push(`${where}#/vendored/cites: no cited commit`);
  const roles = (Array.isArray(v.files) ? v.files : []).map(f => f.role);
  if (!roles.length || new Set(roles).size !== roles.length) problems.push(`${where}#/vendored/files: each source file once, by role`);
  for (const [i, f] of (Array.isArray(v.files) ? v.files : []).entries()) {
    said(f.role, `/vendored/files/${i}/role`);
    said(f.what, `/vendored/files/${i}/what`);
    if (!HEX64.test(f.sha256 ?? '')) problems.push(`${where}#/vendored/files/${i}/sha256: not a sha256`);
  }
  return problems;
}

// Shapes that never belong on a public page, beyond the publisher's screen: machine paths, local hosts, credentials,
// and a repository other than this lab's own (a private one is named by a salted anonymous label instead).
export const LEAKS = [
  [/\/Users\/|\/home\/|~\/\.|\b[A-Z]:\\/, 'a machine path'],
  [/localhost|\b127\.0\.0\.1\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\[::1\]|:\d{4,5}\b/, 'a local host, address or port'],
  [/\bghp_|\bgithub_pat_|\bgh[osu]_[A-Za-z0-9]|\bsk-[A-Za-z0-9]|\bAKIA[0-9A-Z]|-----BEGIN|\bxox[abp]-|\bBearer\s+\w/, 'a credential'],
  [/odin-labs-ai\/(?!odin-rnd(?![\w.-]))[\w.-]/i, 'another repository'],
];

/** Every commit and sha256 the record holds: the only hex tokens pageLeaks masks (a token must be a prefix of one). */
export function recordHashes(record) {
  const out = [];
  (function walk(v) { if (typeof v === 'string' && /^[0-9a-f]{16,64}$/.test(v)) out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(record);
  return out;
}

/**
 * Why a rendered page may not be published: every visible text through the publisher's screen and the LEAKS above, and
 * the markup itself through LEAKS. Before the screen, a hex token of 8 or more characters is masked only when it is a
 * prefix of a hash the record holds (`known`, from recordHashes): any other token is screened as it is, and one that
 * looks like a hash (digits and letters a-f) is refused outright: it is a commit or digest the record does not hold,
 * such as one only on a lane.
 */
export function pageLeaks(html, known = [], { onMain } = {}) {
  const problems = [];
  const seen = new Set();
  const add = p => { if (!seen.has(p)) { seen.add(p); problems.push(p); } };
  const leak = (where, text) => { for (const [pattern, reason] of LEAKS) { const m = pattern.exec(text); if (m) add(`${reason}${where}: ${JSON.stringify(text.slice(Math.max(0, m.index - 40), m.index + 40))}`); } };
  // The text a browser shows comes from shownText(), a tokenizer that reads markup the way HTML does (quoted
  // attributes, comments, scripts and styles as raw text), so no attribute, comment or tag can hide displayed text or
  // swallow it. Every other view is extra, and only ever adds a refusal: the markup as written, the markup with every
  // character reference decoded, percent-encoded slashes decoded, and the old tag-dropping views.
  const shown = decode(shownText(html));
  const lines = decode(shownText(html, { breaks: true }));
  // A character reference this screen does not decode is refused, never read as something else (fail closed): only
  // numeric references and the named ones in NAMED_REFS are decoded, and those are all the pages use.
  for (const src of [shownText(html), html]) for (const m of src.matchAll(/&([A-Za-z][A-Za-z0-9]*);?/g)) if (!(Object.hasOwn(NAMED_REFS, m[1]) && m[0].endsWith(';'))) add(`a character reference this screen does not decode (${m[0]})`);
  leak('', html);
  leak(' (markup, references decoded)', decode(html));
  leak(' (percent-decoded)', html.replace(/%2f/gi, '/'));
  leak(' (as shown)', shown);
  // As a reader sees it: invisible format and combining characters removed and look-alike letters from other scripts
  // folded to the Latin ones they imitate (the publisher's fold).
  leak(' (as shown, folded)', fold(shown));
  leak(' (as shown, by line)', lines.replace(/\n+/g, ' '));
  leak(' (every tag dropped)', decode(stripTags(html, '')));
  // Text direction controls reorder what is shown (a reversed word reads forwards), so none is allowed at all.
  if (/[\u202a-\u202e\u2066-\u2069]/.test(shown) || /[\u202a-\u202e\u2066-\u2069]/.test(decode(html))) add('a text direction control character');
  // The lines a reader sees, for the publisher's screen and the hash rules: a block element ends one.
  const text = lines;
  // The publisher's screen once more over a second reading of the text, with every tag a line break and scripts,
  // styles and comments dropped by pattern: it only ever adds a refusal, should the tokenizer ever lose a piece.
  let hidden = html, before;
  do { before = hidden; hidden = hidden.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style)(?=[\t\n\f\r />])[\s\S]*?<\/\1[\t\n\f\r ]*>/gi, ''); } while (hidden !== before);
  // And the whole shown text as one string, blocks as spaces, so the screen also sees across the lines it is cut into.
  for (const hit of screenHits(lines.replace(/\n+/g, ' ').replace(/\b[0-9a-f]{8,64}\b/g, token => (known.some(h => h.startsWith(token)) ? 'HASH' : token)))) add(`${hit.reason} (as shown, whole page)`);
  // And a third, with nothing dropped at all but the tags themselves (script and style text included).
  const readings = [decode(stripTags(hidden, '\n')), decode(stripTags(html, '\n'))];
  for (const line of new Set(readings.flatMap(r => r.split('\n')).map(l => l.trim()).filter(Boolean))) {
    const masked = line.replace(/\b[0-9a-f]{8,64}\b/g, token => (known.some(h => h.startsWith(token)) ? 'HASH' : token));
    for (const hit of screenHits(masked)) add(`${hit.reason} (second reading): ${JSON.stringify(line.slice(0, 100))}`);
  }
  // A cite sentence names a commit; when the caller says which commits are part of main, any other is refused.
  if (onMain) for (const m of text.matchAll(/Private commit\s+([0-9a-f]{7,40})\s*,\s*cited by hash/g)) if (!onMain.some(c => c.startsWith(m[1]))) problems.push(`a cited commit not shown as part of the private main (${m[1]})`);
  for (const line of [...new Set(text.split('\n').map(l => l.trim()).filter(Boolean))]) {
    const unknown = [];
    const masked = line.replace(/\b[0-9a-f]{8,64}\b/g, token => {
      if (known.some(h => h.startsWith(token))) return 'HASH';
      if (/\d/.test(token) && /[a-f]/.test(token)) unknown.push(token);
      return token;
    });
    for (const token of unknown) problems.push(`a hash the record does not hold (${token.slice(0, 12)}): ${JSON.stringify(line.slice(0, 100))}`);
    problems.push(...screenHits(masked).map(hit => `${hit.reason}: ${JSON.stringify(line.slice(0, 100))}`));
  }
  return problems;
}

/** Every tag replaced by `by`, again and again until none is left (a tag rebuilt by removing an inner one is removed too). */
export function stripTags(html, by = '') {
  let out = html, prev;
  // A tag opens only with a letter, "/", "!" or "?" after the "<", as in HTML: "a < b > c" is text, and is kept.
  do { prev = out; out = out.replace(/<[A-Za-z/!?][^<>]*>/g, by); } while (out !== prev);
  return out;
}

/**
 * The text a browser shows, from the markup, by HTML's own tokenizing rules (a subset, enough for these pages): a "<"
 * opens a tag only before an ASCII letter, "/", "!" or "?"; a tag name ends at HTML whitespace, "/" or ">"; inside a
 * tag, attribute values (quoted, or unquoted to whitespace or ">") may hold "<", ">" and "<!--" and are never shown; a
 * comment runs from "<!--" to the first "-->" or "--!>" ("<!-->" and "<!--->" close at once); "<!", "<?" and "</" not
 * before a letter open a bogus comment to the first ">"; script and style text is dropped to its real end tag, other
 * raw-text elements keep their text (any "<" in it literal); a tag cut off by the end of the page is dropped, as a
 * browser drops it. Character references are left as they are (decode() reads them). With `breaks`, a block element's
 * tag becomes a line break; any other tag joins.
 */
const asciiLower = text => text.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));

// HTML's whitespace in a tag: tab, line feed, form feed, carriage return and space only (never U+00A0 or other \s).
const HTML_WS = new Set(['\t', '\n', '\f', '\r', ' ']);

export function shownText(html, { breaks = false } = {}) {
  let out = '', i = 0;
  const n = html.length;
  // ASCII-only lowercase, as HTML matches tag names: it keeps every offset (String#toLowerCase does not: U+0130 grows).
  const lower = asciiLower(html);
  // Raw text, by HTML's rules: script and style text is not shown; textarea and title (RCDATA) and xmp, iframe,
  // noembed, noframes and noscript (RAWTEXT) hold text to their end tag with any "<" in it literal, and are screened
  // as shown (whether or not a browser shows them: screening more is the safe side); plaintext runs to the end.
  const HIDDEN_RAW = new Set(['script', 'style']);
  const SHOWN_RAW = new Set(['textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
  while (i < n) {
    const ch = html[i];
    if (ch !== '<') { out += ch; i++; continue; }
    const next = html[i + 1] ?? '';
    if (html.startsWith('<!--', i)) {
      // "<!-->" and "<!--->" close at once; otherwise the first "-->" or "--!>" closes it.
      if (html.startsWith('<!-->', i)) { i += 5; continue; }
      if (html.startsWith('<!--->', i)) { i += 6; continue; }
      const ends = [html.indexOf('-->', i + 4), html.indexOf('--!>', i + 4)].filter(k => k >= 0).map((k, x) => k + (html.startsWith('-->', k) ? 3 : 4));
      i = ends.length ? Math.min(...ends) : n;
      continue;
    }
    if (next === '!' || next === '?') { const end = html.indexOf('>', i + 2); i = end < 0 ? n : end + 1; continue; }
    const closing = next === '/';
    if (!/[A-Za-z]/.test(closing ? html[i + 2] ?? '' : next)) {
      if (closing) { const end = html.indexOf('>', i + 2); i = end < 0 ? n : end + 1; continue; } // "</" + not a letter: a bogus comment
      out += ch; i++; continue; // "<" before anything else is text
    }
    // A tag: its name, then attributes with their quoted values, to the first ">" outside a quote.
    let j = i + (closing ? 2 : 1);
    let name = '';
    while (j < n && !HTML_WS.has(html[j]) && html[j] !== '/' && html[j] !== '>') name += html[j++];
    // Attributes, by HTML's attribute states: a name (to whitespace, "/", ">" or "="; a leading "=" is part of it),
    // then optionally "=" and a value: quoted (to the same quote) or unquoted (to whitespace or ">"; a quote inside an
    // unquoted value is just a character of it).
    const ws = c => HTML_WS.has(c);
    for (;;) {
      while (j < n && (ws(html[j]) || html[j] === '/')) j++;
      if (j >= n || html[j] === '>') break;
      j++; // the attribute name's first character, whatever it is
      while (j < n && !ws(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j++;
      let k = j;
      while (k < n && ws(html[k])) k++;
      if (html[k] !== '=') { j = k; continue; }
      j = k + 1;
      while (j < n && ws(html[j])) j++;
      if (html[j] === '"' || html[j] === "'") { const close = html.indexOf(html[j], j + 1); j = close < 0 ? n : close + 1; }
      else while (j < n && !ws(html[j]) && html[j] !== '>') j++;
    }
    if (j >= n) break; // cut off by the end of the page: dropped
    const tag = asciiLower(name);
    i = j + 1;
    if (breaks && BLOCK_NAMES.has(tag)) out += '\n';
    if (!closing && tag === 'plaintext') { out += html.slice(i); break; }
    if (!closing && (HIDDEN_RAW.has(tag) || SHOWN_RAW.has(tag))) {
      // Raw text runs to "</name" followed by HTML whitespace, "/" or ">" (so "</scriptx>" does not end it).
      let end = lower.indexOf(`</${tag}`, i);
      while (end >= 0 && !(HTML_WS.has(html[end + tag.length + 2]) || html[end + tag.length + 2] === '/' || html[end + tag.length + 2] === '>')) end = lower.indexOf(`</${tag}`, end + 1);
      if (SHOWN_RAW.has(tag)) out += html.slice(i, end < 0 ? n : end);
      if (end < 0) { i = n; break; }
      const close = html.indexOf('>', end);
      i = close < 0 ? n : close + 1;
    }
  }
  return out;
}

// Elements that end a line of text as a reader sees it. Any other tag is taken as inline: dropped, joining its neighbours.
const BLOCK_NAMES = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'desc', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'img', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'summary', 'svg', 'table', 'tbody', 'td', 'text', 'tfoot', 'th', 'thead', 'tr', 'ul']);

// The named character references the screen decodes (pageLeaks refuses any other): what escape() writes, and a few
// common ones. Adding one here is how a page may use it.
export const NAMED_REFS = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '\u00b7', mdash: '\u2014', ndash: '\u2013', rarr: '\u2192', hellip: '\u2026', amp: '&' };

/** Character references decoded as a browser decodes them: numeric (decimal, hex) and NAMED_REFS, &amp; last. */
export function decode(text) {
  const char = n => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd');
  return text.replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, h) => char(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => char(Number(d)))
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (ref, name) => (name !== 'amp' && Object.hasOwn(NAMED_REFS, name) ? NAMED_REFS[name] : ref)).replaceAll('&amp;', '&');
}

// The marked boxes. What is staged, an estimate, a summary that cannot be reproduced here, a fixture we wrote, or a
// verdict by an AI is said in the box's own label, so a test can find the box and check nothing of it leaks outside.
export const BOX_LABELS = {
  staged: '<h3>Staged</h3>',
  real: '<h3>Real</h3>',
  estimate: '<p class="technical">AN ESTIMATE, NOT A MEASUREMENT</p>',
  summary: '<p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE</p>',
  fixture: '<p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US</p>',
  judge: '<p class="technical">A SEPARATE AI REVIEWER, NOT A HUMAN</p>',
};

/** A marked box: <div class="lab-panel <cls>" id="<id>">, its kind's label, then the body. */
export function box(kind, { cls, id, body }) {
  if (!(kind in BOX_LABELS)) throw new Error(`box: no such kind ${kind}`);
  if (!/^[a-z][a-z0-9 -]*$/.test(cls) || (id !== undefined && !/^[a-z][a-z0-9-]*$/.test(id))) throw new Error('box: a class and id are plain names');
  return `<div class="lab-panel ${cls}"${id === undefined ? '' : ` id="${id}"`}>${BOX_LABELS[kind]}${body}</div>`;
}
