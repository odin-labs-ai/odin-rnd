// An MP4 (H.264) copy of every WebM film, for the browsers that cannot play WebM (older Safari, older iOS). The record
// site/data/labs/agent-space/film-fallbacks.json (odin-film-fallbacks v1, scripts/schemas/odin-film-fallbacks.schema.json)
// lists each copy: the WebM it was encoded from, by path and sha256, and the MP4 by path, sha256 and size. The build
// refuses the record, every reason listed, when it misses the schema, when a WebM on disk no longer hashes to the sha256
// its copy was made from (a changed film needs a new copy), when an MP4 is missing, a different size, does not hash to
// its sha256, is over its film's size limit, is not a progressive MP4 (ftyp first, moov before mdat, so it starts
// playing before it has fully loaded), is not one H.264 video track (Baseline, Main or High, level 4.0 or below) with an
// AAC sound track exactly when the record says it has sound, has a length other than the record's, or when its
// screening record does not match it or leaves part of it out. The record's length is checked against the WebM's by
// the tests where ffprobe is installed (scripts/film-fallbacks.test.mjs). Like the films themselves, the gate cannot
// read pixels: that a copy shows the same shots as its WebM is what its screening record states (one decoded frame every
// five seconds, each hashed, viewed by an AI agent before it was committed), not something the build can prove.
//
// The pages are not edited for this: after the build has written every page, addFilmFallbacks() puts a
// <source type="video/mp4"> right after each WebM <source> in dist/ (the committed pages, frozen pages included, stay
// byte for byte). It fails closed both ways: a page that plays a WebM with no listed copy stops the build, and so does a
// listed copy whose WebM no page plays.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix, relative, sep } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { MAX_FILM_BYTES, screeningProblems } from './lab-films.mjs';
import { MAX_CLIP_BYTES, screenTree } from './lab-dispatch-publish.mjs';

export const FALLBACKS_FILE = 'data/labs/agent-space/film-fallbacks.json';
export const FALLBACKS_SCHEMA_FILE = new URL('./schemas/odin-film-fallbacks.schema.json', import.meta.url);
// A dispatch's session clip has the dispatch clip limit; every other film has the film limit.
const CLIP = /^assets\/labs\/agent-space\/session-[0-9a-z-]+\/clip\.webm$/;
export const limitFor = webm => CLIP.test(webm) ? MAX_CLIP_BYTES : MAX_FILM_BYTES;

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Why `data` is not a progressive MP4: its top-level boxes must start with ftyp and hold moov before mdat. */
export function progressiveProblems(data) {
  const boxes = [];
  for (let at = 0; at + 8 <= data.length && boxes.length < 64;) {
    let size = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    if (size === 1 && at + 16 <= data.length) size = Number(data.readBigUInt64BE(at + 8));
    else if (size === 0) size = data.length - at;
    if (size < 8) return ['a box with an impossible size'];
    boxes.push(type);
    at += size;
  }
  const problems = [];
  if (boxes[0] !== 'ftyp') problems.push('the first box is not ftyp');
  const moov = boxes.indexOf('moov'), mdat = boxes.indexOf('mdat');
  if (moov < 0 || mdat < 0) problems.push('no moov or no mdat box');
  else if (moov > mdat) problems.push('moov comes after mdat (not faststart)');
  return problems;
}

// H.264 profiles every browser that plays MP4 decodes (Baseline, Main, High) and the highest level allowed (4.0).
export const AVC_PROFILES = new Set([66, 77, 100]);
export const MAX_AVC_LEVEL = 40;

function* children(data, start, end) {
  for (let at = start; at + 8 <= end;) {
    let size = data.readUInt32BE(at), head = 8;
    if (size === 1) { if (at + 16 > end) return; size = Number(data.readBigUInt64BE(at + 8)); head = 16; }
    else if (size === 0) size = end - at;
    if (size < head || at + size > end) return;
    yield { type: data.toString('latin1', at + 4, at + 8), start: at + head, end: at + size };
    at += size;
  }
}

/**
 * What an MP4 says about itself, read from its own boxes (no decoder): each track's handler (vide, soun), its first
 * sample entry (avc1, mp4a, …), for avc1 the profile and level from its avcC, and its length in seconds from mdhd.
 */
export function mp4Facts(data) {
  const tracks = [];
  const find = (start, end, type) => { for (const box of children(data, start, end)) if (box.type === type) return box; return null; };
  const moov = find(0, data.length, 'moov');
  if (!moov) return { tracks };
  for (const trak of children(data, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const track = { handler: null, codec: null, profile: null, level: null, seconds: null };
    const mdia = find(trak.start, trak.end, 'mdia');
    if (mdia) {
      const hdlr = find(mdia.start, mdia.end, 'hdlr');
      if (hdlr && hdlr.end - hdlr.start >= 12) track.handler = data.toString('latin1', hdlr.start + 8, hdlr.start + 12);
      const mdhd = find(mdia.start, mdia.end, 'mdhd');
      if (mdhd) {
        const v1 = data[mdhd.start] === 1;
        const scale = data.readUInt32BE(mdhd.start + (v1 ? 20 : 12));
        const length = v1 ? Number(data.readBigUInt64BE(mdhd.start + 24)) : data.readUInt32BE(mdhd.start + 16);
        if (scale > 0) track.seconds = length / scale;
      }
      let box = mdia;
      for (const type of ['minf', 'stbl', 'stsd']) box = box && find(box.start, box.end, type);
      if (box && box.end - box.start >= 16) {
        const entry = children(data, box.start + 8, box.end).next().value;
        if (entry) {
          track.codec = entry.type;
          // A visual sample entry has 78 bytes of fields before its child boxes; avcC opens with version, profile,
          // compatibility, level.
          const avcC = entry.type === 'avc1' && entry.end - entry.start > 78 ? find(entry.start + 78, entry.end, 'avcC') : null;
          if (avcC && avcC.end - avcC.start >= 4) { track.profile = data[avcC.start + 1]; track.level = data[avcC.start + 3]; }
        }
      }
    }
    tracks.push(track);
  }
  return { tracks };
}

/** Why an MP4 copy is not what its entry says: one H.264 video track a browser decodes, sound exactly when recorded, its length. */
export function trackProblems(data, entry) {
  const { tracks } = mp4Facts(data), problems = [];
  const video = tracks.filter(t => t.handler === 'vide'), sound = tracks.filter(t => t.handler === 'soun');
  if (video.length !== 1) problems.push(`${video.length} video tracks, not 1`);
  else {
    const [v] = video;
    if (v.codec !== 'avc1') problems.push(`the video track is ${v.codec ?? 'unreadable'}, not H.264 (avc1)`);
    else if (!AVC_PROFILES.has(v.profile) || !(v.level <= MAX_AVC_LEVEL)) problems.push(`H.264 profile ${v.profile} level ${v.level}, not Baseline, Main or High at level ${MAX_AVC_LEVEL / 10} or below`);
    if (v.seconds === null || Math.abs(v.seconds - entry.seconds) >= 1) problems.push(`the video track is ${v.seconds?.toFixed(2) ?? 'of unreadable length'} s, the record says ${entry.seconds} s`);
  }
  if (entry.audio && (sound.length !== 1 || sound[0].codec !== 'mp4a')) problems.push(`the record says it has sound, but it has ${sound.length} sound tracks${sound[0] ? ` (${sound[0].codec})` : ''}, not one AAC (mp4a) track`);
  if (!entry.audio && sound.length) problems.push(`the record says it has no sound, but it has ${sound.length} sound tracks`);
  if (tracks.length !== video.length + sound.length) problems.push(`${tracks.length - video.length - sound.length} other tracks`);
  return problems;
}

/** Everything that makes a fallbacks record unpublishable; with `root`, every file must exist there with its recorded bytes. */
export function fallbacksProblems(record, where = FALLBACKS_FILE, root = null) {
  const problems = validate(JSON.parse(readFileSync(FALLBACKS_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-film-fallbacks v1)`);
  if (problems.length) return problems;
  problems.push(...screenTree(record.encoder, `${where}#/encoder`));
  const seen = new Set();
  for (const [i, entry] of record.fallbacks.entries()) {
    const at = `${where}#/fallbacks/${i}`;
    if (seen.has(entry.webm)) problems.push(`${at}/webm: ${entry.webm} is listed twice`);
    seen.add(entry.webm);
    if (entry.mp4 !== entry.webm.replace(/\.webm$/, '.mp4')) problems.push(`${at}/mp4: must sit beside its WebM with the same name (${entry.webm.replace(/\.webm$/, '.mp4')})`);
    const { frames, srcSha256, ...screeningText } = entry.screening;
    problems.push(...screenTree(screeningText, `${at}/screening`));
    problems.push(...screeningProblems({ screening: entry.screening, sha256: { src: entry.sha256 }, seconds: entry.seconds }, `${at}/screening`));
    const limit = limitFor(entry.webm);
    if (entry.bytes > limit) problems.push(`${at}/bytes: ${entry.bytes} bytes, over the ${limit}-byte limit for this film`);
    if (!root) continue;
    const webm = join(root, entry.webm), mp4 = join(root, entry.mp4);
    if (!existsSync(webm)) problems.push(`${at}/webm: ${entry.webm} is missing`);
    else if (sha256(readFileSync(webm)) !== entry.webmSha256) problems.push(`${at}/webmSha256: ${entry.webm} has changed since this copy was made; encode a new copy`);
    if (!existsSync(mp4)) { problems.push(`${at}/mp4: ${entry.mp4} is missing`); continue; }
    const data = readFileSync(mp4);
    if (data.length !== entry.bytes) problems.push(`${at}/bytes: ${entry.mp4} is ${data.length} bytes on disk, the record says ${entry.bytes}`);
    if (sha256(data) !== entry.sha256) problems.push(`${at}/sha256: ${entry.mp4} does not match its recorded sha256`);
    for (const problem of progressiveProblems(data)) problems.push(`${at}/mp4: ${entry.mp4}: ${problem}`);
    for (const problem of trackProblems(data, entry)) problems.push(`${at}/mp4: ${entry.mp4}: ${problem}`);
  }
  return problems;
}

/** The committed fallbacks record, checked; null when there is none. */
export function readFallbacks(root = 'site') {
  if (!existsSync(join(root, FALLBACKS_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, FALLBACKS_FILE), 'utf8'));
  const problems = fallbacksProblems(record, FALLBACKS_FILE, root);
  if (problems.length) throw new Error(`Film fallbacks refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const isWebm = tag => /\.webm(?:[?#][^"]*)?$/i.test(attr(tag, 'src') ?? '') || /^video\/webm/i.test(attr(tag, 'type') ?? '');

/**
 * One page with an MP4 <source> after each WebM <source>. `page` is the page's path inside the site ('labs/x/index.html'),
 * `byWebm` maps a site path ('assets/…/film.webm') to its copy. Returns the new html, the WebMs it played and every
 * WebM it plays that has no copy. A page that already carries the copy right after the WebM is left as it is.
 */
export function pairPage(html, page, byWebm) {
  const used = new Set(), unpaired = [];
  const out = html.replace(/<source\b[^>]*>/gi, (tag, offset) => {
    if (!isWebm(tag)) return tag;
    const src = attr(tag, 'src');
    const resolved = src && !/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(src) ? posix.normalize(posix.join(posix.dirname(page), src.replace(/[?#].*$/, ''))) : null;
    const entry = resolved && byWebm.get(resolved);
    if (!entry) { unpaired.push(`${page}: ${src ?? '(no src)'}`); return tag; }
    used.add(entry.webm);
    const mp4Src = src.replace(/\.webm(?=$|[?#])/i, '.mp4');
    const insert = `<source src="${mp4Src}" type="video/mp4">`;
    return html.startsWith(insert, offset + tag.length) ? tag : tag + insert;
  });
  return { html: out, used, unpaired };
}

const htmlFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);

/** The dist pass: every built page gets its MP4 sources; fails closed on an unpaired WebM or an unused copy. */
export function addFilmFallbacks({ distDir = 'dist', root = 'site' } = {}) {
  const record = readFallbacks(root);
  const byWebm = new Map((record?.fallbacks ?? []).map(entry => [entry.webm, entry]));
  // The published copy, not only the source one, must be the recorded bytes.
  for (const entry of byWebm.values()) if (!existsSync(join(distDir, entry.mp4)) || sha256(readFileSync(join(distDir, entry.mp4))) !== entry.sha256) throw new Error(`Film fallbacks: ${entry.mp4} is not in ${distDir} with its recorded sha256`);
  const used = new Set(), unpaired = [];
  let pages = 0;
  for (const file of htmlFiles(distDir)) {
    const page = relative(distDir, file).split(sep).join('/');
    const before = readFileSync(file, 'utf8');
    const result = pairPage(before, page, byWebm);
    result.used.forEach(webm => used.add(webm));
    unpaired.push(...result.unpaired);
    if (result.html !== before) { writeFileSync(file, result.html); pages++; }
  }
  const unused = [...byWebm.keys()].filter(webm => !used.has(webm));
  if (unpaired.length || unused.length) throw new Error(`Film fallbacks refused:\n  ${[
    ...unpaired.map(line => `${line} plays a WebM with no MP4 copy in ${FALLBACKS_FILE}`),
    ...unused.map(webm => `${webm} has an MP4 copy but no page plays it`)].join('\n  ')}`);
  return { pages, films: used.size };
}
