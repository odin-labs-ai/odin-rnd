// The dist pass for the films' MP4 copies (mission rnd-nightshift-1112, follow-on #243 to #221): which built files may
// name a WebM, which WebM-then-MP4 <source> pairs count, and the count of pairs per page against the pairs the build
// wrote. The copies and their record are in scripts/film-fallbacks.mjs; filmSources() is in scripts/film-sources.mjs.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix, relative, sep } from 'node:path';
import { readFallbacks } from './film-fallbacks.mjs';
import { FALLBACKS_FILE, WEBM_TYPE } from './film-sources.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Character references, resolved the way a browser does before it reads text or fetches a URL (&#46;webm is .webm); a
// code point a browser would not accept becomes U+FFFD, as it does there.
// Every named reference that stands for an ASCII character (no named reference stands for an ASCII letter or digit).
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", period: '.', sol: '/', bsol: '\\', colon: ':', semi: ';', num: '#',
  quest: '?', equals: '=', percnt: '%', excl: '!', dollar: '$', lpar: '(', rpar: ')', ast: '*', midast: '*', plus: '+', comma: ',',
  commat: '@', lsqb: '[', lbrack: '[', rsqb: ']', rbrack: ']', hat: '^', lowbar: '_', grave: '`', lcub: '{', lbrace: '{',
  rcub: '}', rbrace: '}', verbar: '|', vert: '|', tab: '\t', newline: '\n' };
const codePoint = n => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�');
export const decodeValue = value => value.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));?/g, (whole, dec, hex, name) =>
  dec ? codePoint(Number(dec)) : hex ? codePoint(parseInt(hex, 16)) : NAMED[name.toLowerCase()] ?? whole);

// What may name a WebM besides that: a plain link to the file (an href and nothing else) with plain link text, which
// opens the file and plays nothing here, and the English word "WebM" in running text (a separate word, not after ".",
// "/", "\" or "%" even across white space, judged after the text is spelled out, so never part of a file name).
const LINKED = /<a href="[A-Za-z0-9._/:-]+\.webm">[^<>&]*<\/a>/g;
const isWord = (text, at) => {
  let k = at - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  return !(k >= 0 && /[./\\%\w]/.test(text[k]) && (k === at - 1 || /[./\\%]/.test(text[k]))) && !/\w/.test(text[at + 4] ?? '');
};
// Before looking for "webm": character references resolved, %XX escapes decoded, and tab, line feed, carriage return
// and other control characters removed (what a browser strips from a URL), so no spelling of a file name hides it.
const percent = text => text.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
// JavaScript escapes (\xHH, \uHHHH, \u{H...}) and CSS escapes (\ and 1 to 6 hex digits, then an optional white space)
// are spelled out too, since every built file is read, scripts and style sheets included.
const scriptEscapes = text => text.replace(/\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\([0-9a-fA-F]{1,6})[ \t\n\f\r]?/g,
  (whole, x, braced, u, css) => codePoint(parseInt(x ?? braced ?? u ?? css, 16)));
const spelled = text => percent(scriptEscapes(text)).replace(/[\u0000-\u001f\u007f]+/g, '');
// Kept from main (one change: ASCII lower case, so no offset shifts), as an extra refusal and never as a proof of where
// a pair plays: a counted pair whose start lies in one of these stretches is refused, so this PR refuses at least what
// main refused (comments, raw text and template content, including a stretch that never ends). It is not a parser;
// what it misses is the OUT limit.
// The stretches of a page that never play: comments (through --> or --!>), the content of raw-text and other inert
// elements through their end tag, and template content (nested templates counted), found by one scan from the start.
const RAW = ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noscript', 'noembed', 'noframes', 'plaintext'];
export function inertRanges(html) {
  // ASCII lower case, one character for one (main's String#toLowerCase lengthens some letters, such as U+0130, and
  // would shift every range after them).
  const lower = html.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32)), ranges = [];
  let i = 0;
  while (i < lower.length) {
    const lt = lower.indexOf('<', i);
    if (lt < 0) break;
    if (lower.startsWith('<!--', lt)) {
      const short = /^<!--->|^<!-->/.exec(lower.slice(lt, lt + 6));
      const m = short ? null : /--!?>/g; if (m) m.lastIndex = lt + 4;
      const close = m && m.exec(lower);
      const end = short ? lt + short[0].length : close ? close.index + close[0].length : lower.length;
      ranges.push([lt, end]); i = end; continue;
    }
    const name = /^<([a-z][a-z0-9-]*)/.exec(lower.slice(lt, lt + 32))?.[1];
    if (name && (RAW.includes(name) || name === 'template')) {
      let end;
      if (name === 'template') {
        let depth = 0, j = lt;
        const re = /<(\/?)template[\s/>]/g; re.lastIndex = lt;
        for (let m; (m = re.exec(lower));) { depth += m[1] ? -1 : 1; if (!depth) { j = m.index; break; } }
        end = depth ? lower.length : j;
      } else {
        const re = new RegExp(`</${name}[\\s/>]`, 'g'); re.lastIndex = lt + 1;
        const m = re.exec(lower);
        end = name === 'plaintext' || !m ? lower.length : m.index;
      }
      ranges.push([lt, end]); i = end + 1; continue;
    }
    i = lt + 1;
  }
  return ranges;
}

// WHO WRITES A PLAYER. Nothing searches a page to decide where a copy goes.
//
// Generated pages: every generator that plays a film (lab-films.mjs, lab-progress.mjs, lab-outage.mjs, labs.mjs) writes
// its <source> elements through filmSources() (scripts/film-sources.mjs), which writes the WebM <source> and, when the
// record lists a copy, the MP4 <source> right after it, in one call. While the build renders the pages, a ledger
// (startFilmLedger) counts the pairs filmSources() wrote, and pagePairs() binds them to the page they were written on.
//
// The home page (site/index.html) is written by hand, stays byte for byte as committed, and carries one player. Its
// exact text through the end of the WebM <source> is pinned below (HOME). The dist pass inserts the MP4 <source> after
// that text, only when the text is on the page exactly once, and counts it as the home page's one pair. It inserts
// nowhere else.
//
// A pair, the home pin included, that starts inside a comment, raw text or template content (inertRanges, main's scan,
// kept) is not counted and is refused. What this does not judge beyond that scan: where else hand-written markup puts
// a pair. A hand edit that wraps the home player, or a generator's marker in a page template, in an svg, a
// non-rendering parent, a quoted attribute or another place the scan does not model keeps its count and passes; that
// needs a real HTML parser (follow-on, odin-labs-ai/odin-rnd#228). Copies, and moves to another page, are caught.
//
// Then every file in dist that is not media, a font or an archive (archives download, they do not render) is read.
// Each WebM-then-MP4 <source> pair of a listed film in an .html page is counted, and for every file and film the pairs
// found must equal the pairs the build wrote there (pagePairs, plus the home page's one). A copied player, in a comment,
// script, template, attribute, svg, another page or any other file, adds a pair the build did not write and stops the
// build; so does a pair in a file that is not an .html page. What is left after the counted pairs, plain
// links and the English word "WebM" is spelled out (character references, %XX escapes, control characters), and any
// "webm" in it stops the build too. JSON files are data, not markup: there a string may name a WebM only as a plain
// path or URL to the file, as a WebM type, or as the English word, and a key also as a field name.

// The home page's one hand-written player, exactly as site/index.html carries it, through the end of its WebM <source>.
export const HOME = {
  page: 'index.html',
  webm: 'assets/labs/agent-space/progress/hq-on-duty.webm',
  player: '<figure class="agent-space-media"><video controls preload="none" playsinline width="1280" height="720" poster="assets/labs/agent-space/progress/hq-on-duty-poster.jpg" aria-label="The HQ on duty: the Odin Labs HQ at dawn, the Engineering floor, the review wall, the trust wall and the outbox that waits for the founder’s click"><source src="assets/labs/agent-space/progress/hq-on-duty.webm" type="video/webm;codecs=vp9,opus">',
};

/** The home page with the MP4 <source> after its pinned player, or why not (the pin missing or on the page twice). */
export function pairHome(html, home, byWebm) {
  const at = html.indexOf(home.player), entry = byWebm.get(home.webm), where = `${home.page}: the pinned home player (HOME in scripts/film-pairs.mjs)`;
  if (!entry) return { html, problems: [`${where} plays ${home.webm}, which has no MP4 copy`] };
  const last = home.player.lastIndexOf('<source ');
  if (last < 0) return { html, problems: [`${where} does not end with the WebM source of ${home.webm}`] };
  const tail = home.player.slice(last);
  if (!tail.startsWith(`<source src="${home.webm}" type="`) || !WEBM_TYPE.test(tail.slice(`<source src="${home.webm}" type="`.length, -2)) || !tail.endsWith('">')) return { html, problems: [`${where} does not end with the WebM source of ${home.webm}`] };
  if (at < 0) return { html, problems: [`${where} is not on the page; when the player changes, change the pin with it`] };
  if (html.indexOf(home.player, at + 1) >= 0) return { html, problems: [`${where} is on the page more than once`] };
  if (inertRanges(html).some(([a, b]) => at >= a && at < b)) return { html, problems: [`${where} sits inside a comment, raw text or template content`] };
  const end = at + home.player.length, insert = `<source src="${entry.mp4}" type="video/mp4">`;
  return { html: html.startsWith(insert, end) ? html : html.slice(0, end) + insert + html.slice(end), problems: [] };
}

// A pair counts only in the one form a film is played in on this site, as main's PLAYED had it: the generators' and the
// home page's exact <video> start tag (controls preload="none" playsinline, an optional class and size, a plain poster
// path and an aria-label), after ">", white space or the page start, followed directly by a WebM <source> and then an
// MP4 <source>, the form filmSources() and the home pass write. Only the two sources are taken out before the net: the
// <video> tag itself stays in the searched text, so a src or any other WebM on it is refused.
const PAIR = /(?<=^|[>\s])(<video(?: class="[a-z0-9 -]*")? controls preload="none" playsinline(?: width="\d+" height="\d+")? poster="[A-Za-z0-9._/-]+" aria-label="[^"<>]*">)<source src="([A-Za-z0-9._/-]+\.webm)" type="(video\/webm[^"<>&]*)"><source src="([A-Za-z0-9._/-]+\.mp4)" type="video\/mp4">/g;
const near = (text, at) => text.slice(Math.max(0, at - 50), at + 12).replace(/\s+/g, ' ');

/**
 * One text file of the built site (`file` is its path inside dist, 'labs/x/index.html'): the pairs of listed films it
 * carries, film by film, and every WebM mention left once those pairs, plain links and the English word are taken out.
 */
export function textMentions(text, file, byWebm) {
  const found = new Map(), unpaired = [], dir = posix.dirname(file);
  // Only an .html page plays; a pair in any other file is left in the text and refused below.
  const page = /\.html$/i.test(file);
  const inert = page && new RegExp(PAIR.source).test(text) ? inertRanges(text) : [];
  const rest = text.replace(PAIR, (whole, video, webmSrc, type, mp4Src, offset) => {
    const entry = byWebm.get(posix.normalize(posix.join(dir, webmSrc)));
    if (!page || !entry || webmSrc.startsWith('/') || !WEBM_TYPE.test(type) || mp4Src !== `${webmSrc.slice(0, -'.webm'.length)}.mp4`) return whole;
    if (inert.some(([a, b]) => offset >= a && offset < b)) return whole;
    found.set(entry.webm, (found.get(entry.webm) ?? 0) + 1);
    return `${video} `;
  });
  const spelledRest = spelled(decodeValue(rest.replace(LINKED, ' '))).replace(/WebM/g, (word, at, all) => (isWord(all, at) ? '    ' : word));
  for (const m of spelledRest.matchAll(/webm/gi)) unpaired.push(`${file}: "${near(spelledRest, m.index)}" names a WebM outside the paired forms`);
  return { found, unpaired };
}

// In JSON a string may name a WebM only as a plain path or URL to the file, as a WebM type, or as the English word; a
// key may also be a field name (letters and digits, such as webmSha256).
const DATA_WEBM = /^(?:https:\/\/[A-Za-z0-9.-]+\/)?[A-Za-z0-9._/-]+\.webm$/;
/** Every string (key or value) in a JSON or JSON Lines file of the built site that names a WebM in any other way. */
export function jsonMentions(text, file) {
  let values;
  try { values = /\.jsonl$/i.test(file) ? text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)) : [JSON.parse(text)]; } catch {
    return /webm/i.test(spelled(decodeValue(text))) ? [`${file}: names a WebM but is not readable JSON`] : [];
  }
  const strings = [];
  const walk = value => { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) { if (!Array.isArray(value) && !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) strings.push(key); walk(inner); } };
  values.forEach(walk);
  const unpaired = [];
  for (const string of strings) {
    if (DATA_WEBM.test(string) || WEBM_TYPE.test(string)) continue;
    const left = spelled(decodeValue(string)).replace(/WebM/g, (word, at, all) => (isWord(all, at) ? '    ' : word));
    for (const m of left.matchAll(/webm/gi)) unpaired.push(`${file}: "${near(left, m.index)}" names a WebM outside a plain path, a type or the word`);
  }
  return unpaired;
}

/**
 * The pairs the build wrote, file by file (dist path -> film -> pairs), from the pages the generators rendered and the
 * ledger kept while they did. Refuses when a film's pairs on the rendered pages are not the ledger's (a pair in a
 * template or other text that did not come from filmSources()).
 */
export function pagePairs(pages, ledger, root = 'site') {
  const byWebm = new Map((readFallbacks(root)?.fallbacks ?? []).map(entry => [entry.webm, entry]));
  const written = new Map(), total = new Map();
  for (const [file, html] of Object.entries(pages)) {
    const { found } = textMentions(html, file, byWebm);
    if (found.size) written.set(file, found);
    for (const [webm, n] of found) total.set(webm, (total.get(webm) ?? 0) + n);
  }
  const off = [...new Set([...total.keys(), ...ledger.keys()])].filter(webm => (total.get(webm) ?? 0) !== (ledger.get(webm) ?? 0));
  if (off.length) throw new Error(`Film fallbacks refused: the rendered pages carry pairs filmSources() did not write:\n  ${off.map(webm => `${webm}: ${total.get(webm) ?? 0} on the pages, ${ledger.get(webm) ?? 0} written`).join('\n  ')}`);
  return written;
}

// Media, fonts and archives hold no markup a browser renders (an archive downloads); every other file in dist is read as text.
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|webm|mp4|m4v|mov|mkv|ogg|ogv|mp3|wav|flac|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|tar|bz2|xz|7z)$/i;
const JSON_FILE = /\.(json|jsonl|webmanifest|map)$/i;
const allFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)]);

/**
 * The dist pass: the MP4 <source> after the home page's pinned player (the one insertion), then every built file read. Fails closed on any WebM
 * mention outside a counted pair, on a film whose pairs in dist are not the pairs the build wrote, and on a copy no page
 * plays. `written` is pagePairs() of the rendered pages (dist path -> film -> pairs the generators wrote there).
 */
export function addFilmFallbacks({ distDir = 'dist', root = 'site', written = new Map(), home = HOME } = {}) {
  const record = readFallbacks(root);
  const byWebm = new Map((record?.fallbacks ?? []).map(entry => [entry.webm, entry]));
  // The published copy, not only the source one, must be the recorded bytes.
  for (const entry of byWebm.values()) if (!existsSync(join(distDir, entry.mp4)) || sha256(readFileSync(join(distDir, entry.mp4))) !== entry.sha256) throw new Error(`Film fallbacks: ${entry.mp4} is not in ${distDir} with its recorded sha256`);
  const expected = new Map([...written].map(([file, films]) => [file, new Map(films)])), problems = [];
  const homeFile = join(distDir, home.page);
  const before = existsSync(homeFile) ? readFileSync(homeFile, 'utf8') : '';
  const paired = pairHome(before, home, byWebm);
  problems.push(...paired.problems);
  if (!paired.problems.length) {
    if (paired.html !== before) writeFileSync(homeFile, paired.html);
    if (!expected.has(home.page)) expected.set(home.page, new Map());
    expected.get(home.page).set(home.webm, (expected.get(home.page).get(home.webm) ?? 0) + 1);
  }
  const found = new Map();
  for (const path of allFiles(distDir)) {
    if (BINARY.test(path)) continue;
    const file = relative(distDir, path).split(sep).join('/'), text = readFileSync(path, 'utf8');
    if (JSON_FILE.test(file)) { problems.push(...jsonMentions(text, file)); continue; }
    const result = textMentions(text, file, byWebm);
    if (result.found.size) found.set(file, result.found);
    problems.push(...result.unpaired);
  }
  const played = new Set();
  for (const file of new Set([...expected.keys(), ...found.keys()])) {
    const want = expected.get(file) ?? new Map(), got = found.get(file) ?? new Map();
    for (const webm of new Set([...want.keys(), ...got.keys()])) {
      if (want.get(webm)) played.add(webm);
      if ((want.get(webm) ?? 0) !== (got.get(webm) ?? 0)) problems.push(`${file}: ${got.get(webm) ?? 0} WebM-then-MP4 <source> pairs of ${webm}, but the build wrote ${want.get(webm) ?? 0} there (a copied, moved or hand-written player)`);
    }
  }
  for (const webm of byWebm.keys()) if (!played.has(webm)) problems.push(`${webm} has an MP4 copy but no page plays it`);
  if (problems.length) throw new Error(`Film fallbacks refused (${FALLBACKS_FILE}):\n  ${problems.join('\n  ')}`);
  const pairs = [...expected.values()].flatMap(films => [...films.values()]);
  return { films: played.size, pairs: pairs.reduce((a, b) => a + b, 0) };
}
