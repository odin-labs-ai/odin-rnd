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
  // A script, a style or a comment is not shown: dropped with nothing in its place, so the text on either side reads
  // as one (a comment first, whole, so a ">" inside it cannot leave text behind).
  const body = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  // A character reference this screen does not decode is refused, never read as something else (fail closed): only
  // numeric references and the named ones in NAMED_REFS are decoded, and those are all the pages use.
  for (const m of stripTags(body, '\n').matchAll(/&([A-Za-z][A-Za-z0-9]*);?/g)) if (!(Object.hasOwn(NAMED_REFS, m[1]) && m[0].endsWith(';'))) problems.push(`a character reference this screen does not decode (${m[0]})`);
  const leak = (where, text) => { for (const [pattern, reason] of LEAKS) { const m = pattern.exec(text); if (m) problems.push(`${reason}${where}: ${JSON.stringify(text.slice(Math.max(0, m.index - 40), m.index + 40))}`); } };
  // The markup as written, and with percent-encoded slashes decoded (a link's path).
  leak('', body);
  leak(' (percent-decoded)', body.replace(/%2f/gi, '/'));
  // What a browser shows, character references decoded (numeric ones too, so "&#47;" is a slash; &amp; last, so an
  // escaped reference is never decoded twice), screened twice more through LEAKS: once with every tag dropped and
  // nothing in its place, so text split by any tag at all (<wbr>, <label>, a made-up one) reads as one; and once with
  // block tags as line breaks. A leak in any of the three refuses the page.
  const shown = decode(stripTags(body, ''));
  leak(' (as shown, every tag dropped)', shown);
  // As a reader sees it: invisible format and combining characters removed and look-alike letters from other scripts
  // folded to the Latin ones they imitate (the publisher's fold), so "local\u200bhost" or a Cyrillic "o" is caught too.
  leak(' (as shown, folded)', fold(shown));
  // Text direction controls reorder what is shown (a reversed word reads forwards), so none is allowed at all.
  if (/[\u202a-\u202e\u2066-\u2069]/.test(shown)) problems.push('a text direction control character');
  // The lines a reader sees: a block tag ends one; any other tag (inline, or one this list does not know) joins the
  // text on either side.
  const text = decode(stripTags(body.replace(BLOCK_TAGS, '\n'), ''));
  leak(' (as shown)', text.replace(/\n+/g, ' '));
  // A cite sentence names a commit; when the caller says which commits are part of main, any other is refused.
  if (onMain) for (const m of text.matchAll(/Private commit\s+([0-9a-f]{7,40})\s*,\s*cited by hash/g)) if (!onMain.some(c => c.startsWith(m[1]))) problems.push(`a cited commit not shown as part of the private main (${m[1]})`);
  for (const line of text.split('\n').map(t => t.trim()).filter(Boolean)) {
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
  do { prev = out; out = out.replace(/<[^<>]*>/g, by); } while (out !== prev);
  return out;
}

// Tags that end a line of text as a reader sees it. Any other tag is taken as inline: dropped, joining its neighbours.
const BLOCK_TAGS = /<\/?(?:address|article|aside|blockquote|br|caption|dd|desc|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|img|li|main|nav|ol|option|p|pre|section|summary|svg|table|tbody|td|text|tfoot|th|thead|title|tr|ul)\b[^>]*>/gi;

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
