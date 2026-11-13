// An MP4 (H.264) copy of every WebM film, for the browsers that cannot play WebM (older Safari, older iOS). The record
// site/data/labs/agent-space/film-fallbacks.json (odin-film-fallbacks v1, scripts/schemas/odin-film-fallbacks.schema.json)
// lists each copy: the WebM it was encoded from, by path and sha256, and the MP4 by path, sha256 and size.
//
// WHAT THE BUILD ENFORCES (no decoder; the build machine has none): it refuses the record, every reason listed, when it
// misses the schema; when a WebM on disk no longer hashes to the sha256 its copy was made from; when an MP4 is missing,
// a different size, does not hash to its sha256 or is over its film's size limit; when it is not a progressive MP4 (ftyp
// first, moov before mdat, nothing after the last box); when it is not exactly one H.264 video track (one sample
// description, Baseline, Main or High at level 4.0 or below, a readable avcC whose sequence parameter set says 8-bit
// 4:2:0 and which carries a picture parameter set) whose every sample lies in mdat and is a whole sequence of valid
// length-prefixed NAL units holding a picture slice, the first an IDR frame; when it has sound other than one AAC LC
// track (read from its esds) exactly when the record says so, or sound samples outside mdat; when a track's length is
// not the record's; or when its screening record does not match it or leaves part of it out.
//
// WHAT A DECODER SHOWS is in scripts/film-fallbacks.test.mjs, and the Film copies workflow
// (.github/workflows/film-copies.yml) installs ffmpeg and runs it on every pull request and on the default branch with
// FILM_DECODER_REQUIRED set, so there a missing decoder fails instead of skipping: every copy decodes start to end with
// no error, to exactly as many frames as it has samples, ends within half a second of its WebM, and its screened frames,
// decoded as raw yuv420p (the decoder's own output, the same on every platform), hash to the screening record's
// yuv420pSha256. The per-frame rgb24 hashes go through ffmpeg's default scaler, which differs across versions and CPUs,
// so they are recomputed only with the ffmpeg version the record names. That a copy shows the same shots as its WebM is
// what its screening record states (one frame every five seconds, viewed by an AI agent); a decoder shows the copy
// plays and which frames were screened, not what they show.
//
// The pages are not edited for this: after the build has written every page, addFilmFallbacks() puts a
// <source type="video/mp4"> right after each WebM <source> in dist/ (the committed pages, frozen pages included, stay
// byte for byte). It fails closed both ways: a page that names a WebM in a tag, a comment or a script outside the
// paired forms stops the build (see pairPage), and so does a listed copy whose WebM no page plays. Only built .html
// pages are read; an inline script naming a WebM is refused, and no page of this site loads a script from elsewhere.
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
  let at = 0;
  for (; at + 8 <= data.length;) {
    let size = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    if (size === 1 && at + 16 <= data.length) size = Number(data.readBigUInt64BE(at + 8));
    else if (size === 0) size = data.length - at;
    if (size < 8) return ['a box with an impossible size'];
    if (at + size > data.length) return [`the ${type} box runs past the end of the file`];
    boxes.push(type);
    at += size;
  }
  const problems = [];
  if (at !== data.length) problems.push(`${data.length - at} stray bytes after the last box`);
  if (boxes[0] !== 'ftyp') problems.push('the first box is not ftyp');
  const moov = boxes.indexOf('moov'), mdat = boxes.indexOf('mdat');
  if (moov < 0 || mdat < 0) problems.push('no moov or no mdat box');
  else if (moov > mdat) problems.push('moov comes after mdat (not faststart)');
  return problems;
}

// H.264 profiles every browser that plays MP4 decodes (Baseline, Main, High) and the highest level allowed (4.0).
export const AVC_PROFILES = new Set([66, 77, 100]);
export const MAX_AVC_LEVEL = 40;
// A film plays at least this many frames a second (every film here is 15 to 30): a copy whose header claims a length its
// frames do not fill is refused.
export const MIN_FPS = 5;

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
 * The decoder an esds names (ISO 14496-1 descriptors after the version and flags): the DecoderConfigDescriptor's
 * objectTypeIndication (0x40 is MPEG-4 audio; MP3 is 0x69 or 0x6b) and, inside it, the AudioSpecificConfig's first five
 * bits, the audio object type (2 is AAC LC).
 */
export function esdsFacts(body) {
  const facts = { objectType: null, audioObjectType: null };
  const descriptor = at => { // tag, then a length of up to four 7-bit bytes
    if (at >= body.length) return null;
    let length = 0, i = at + 1;
    for (let n = 0; n < 4 && i < body.length; n++, i++) { length = (length << 7) | (body[i] & 0x7f); if (!(body[i] & 0x80)) { i++; break; } }
    return { tag: body[at], start: i, end: Math.min(body.length, i + length) };
  };
  const es = descriptor(0);
  if (!es || es.tag !== 0x03 || es.end - es.start < 3) return facts;
  const flags = body[es.start + 2];
  let at = es.start + 3;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) at += 1 + (body[at] ?? 0);
  if (flags & 0x20) at += 2;
  const config = descriptor(at);
  if (!config || config.tag !== 0x04 || config.end - config.start < 13) return facts;
  facts.objectType = body[config.start];
  const specific = descriptor(config.start + 13);
  if (specific && specific.tag === 0x05 && specific.end > specific.start) facts.audioObjectType = body[specific.start] >> 3;
  return facts;
}

/**
 * Where each sample of a track sits in the file, from its own sample tables (stsz sizes, stsc samples per chunk, stco or
 * co64 chunk offsets): a list of [offset, size], or null when a table is missing or does not add up.
 */
export function sampleRanges(data, stbl, find) {
  const stsz = find(stbl.start, stbl.end, 'stsz'), stsc = find(stbl.start, stbl.end, 'stsc');
  const stco = find(stbl.start, stbl.end, 'stco'), co64 = find(stbl.start, stbl.end, 'co64');
  if (!stsz || !stsc || !(stco || co64) || stsz.end - stsz.start < 12 || stsc.end - stsc.start < 8) return null;
  const fixed = data.readUInt32BE(stsz.start + 4), count = data.readUInt32BE(stsz.start + 8);
  if (!fixed && stsz.start + 12 + 4 * count > stsz.end) return null;
  const sizes = Array.from({ length: count }, (_, i) => fixed || data.readUInt32BE(stsz.start + 12 + 4 * i));
  const co = stco || co64, wide = !stco, chunks = data.readUInt32BE(co.start + 4);
  if (co.start + 8 + (wide ? 8 : 4) * chunks > co.end) return null;
  const offsets = Array.from({ length: chunks }, (_, i) => wide ? Number(data.readBigUInt64BE(co.start + 8 + 8 * i)) : data.readUInt32BE(co.start + 8 + 4 * i));
  const runs = data.readUInt32BE(stsc.start + 4);
  if (!runs || stsc.start + 8 + 12 * runs > stsc.end) return null;
  const run = i => [data.readUInt32BE(stsc.start + 8 + 12 * i), data.readUInt32BE(stsc.start + 12 + 12 * i)];
  const ranges = [];
  for (let r = 0, sample = 0; r < runs; r++) {
    const [first, perChunk] = run(r), next = r + 1 < runs ? run(r + 1)[0] : chunks + 1;
    if (first < 1 || next <= first) return null;
    for (let chunk = first; chunk < next; chunk++) {
      if (chunk > chunks) return null;
      let at = offsets[chunk - 1];
      for (let k = 0; k < perChunk && sample < count; k++, sample++) { ranges.push([at, sizes[sample]]); at += sizes[sample]; }
    }
  }
  return ranges.length === count ? ranges : null;
}

/** A track's own sample durations (stts): their sum in seconds, or null when the table does not cover exactly `count` samples. */
export function sampleTiming(data, stbl, find, scale, count) {
  const stts = find(stbl.start, stbl.end, 'stts');
  if (!stts || stts.end - stts.start < 8) return null;
  const runs = data.readUInt32BE(stts.start + 4);
  if (stts.start + 8 + 8 * runs > stts.end) return null;
  let samples = 0, ticks = 0;
  for (let i = 0; i < runs; i++) { const n = data.readUInt32BE(stts.start + 8 + 8 * i); samples += n; ticks += n * data.readUInt32BE(stts.start + 12 + 8 * i); }
  return samples === count ? { seconds: ticks / scale } : null;
}

/** The emulation-prevention bytes (00 00 03) taken out of a NAL unit, and its bits read as ue(v) and u(n). */
function bits(nal) {
  const raw = [];
  for (let i = 0; i < nal.length; i++) { if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue; raw.push(nal[i]); }
  let pos = 0;
  const u = n => { let v = 0; for (let k = 0; k < n; k++, pos++) { if (pos >= raw.length * 8) throw new Error('short'); v = v * 2 + ((raw[pos >> 3] >> (7 - (pos & 7))) & 1); } return v; };
  const ue = () => { let zeros = 0; while (u(1) === 0) if (++zeros > 31) throw new Error('bad ue'); return 2 ** zeros - 1 + u(zeros); };
  return { u, ue };
}

/**
 * The H.264 configuration a browser needs to know before it decodes (avcC): the NAL length size, and from the first
 * sequence parameter set its profile, chroma format (1 is 4:2:0) and bit depths; null when it cannot be read.
 */
export function avcConfig(avcC) {
  try {
    if (!avcC || avcC.length < 7 || avcC[0] !== 1) return null;
    const lengthSize = (avcC[4] & 3) + 1, sps = avcC[5] & 31;
    if (!sps) return null;
    const spsLength = avcC.readUInt16BE(6), nal = avcC.subarray(8, 8 + spsLength);
    if (nal.length !== spsLength || (nal[0] & 31) !== 7) return null;
    const b = bits(nal.subarray(1));
    const profile = b.u(8); b.u(8); const level = b.u(8); b.ue();
    let chroma = 1, lumaBits = 8, chromaBits = 8;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      chroma = b.ue(); if (chroma === 3) b.u(1);
      lumaBits = b.ue() + 8; chromaBits = b.ue() + 8;
    }
    let at = 8 + spsLength;
    const pps = avcC[at++] ?? 0;
    // The first picture parameter set: present, longer than its header, and a PPS NAL unit (type 8).
    const ppsLength = pps && at + 2 <= avcC.length ? avcC.readUInt16BE(at) : 0;
    const ppsOk = ppsLength > 1 && at + 2 + ppsLength <= avcC.length && (avcC[at + 2] & 31) === 8 && !(avcC[at + 2] & 0x80);
    return { lengthSize, profile, level, chroma, lumaBits, chromaBits, pps: ppsOk ? pps : 0 };
  } catch { return null; }
}

/**
 * Every video sample, read as H.264 frames are carried in an MP4: inside the file's mdat, tiled exactly by
 * length-prefixed NAL units whose header is valid (forbidden bit clear, a slice or parameter type), with the first sample
 * an IDR frame. No decoder runs; this proves the stream is framed as H.264 from the first byte to the last.
 */
export function avcSampleProblems(data, samples, lengthSize, mdat) {
  if (!samples || !samples.length) return ['no video samples, or sample tables that do not add up'];
  const problems = [];
  for (const [i, [offset, size]] of samples.entries()) {
    if (offset < mdat.start || offset + size > mdat.end) { problems.push(`video sample ${i} lies outside the media data`); break; }
    let at = offset, types = [];
    while (at < offset + size) {
      if (at + lengthSize > offset + size) { at = -1; break; }
      const length = data.readUIntBE(at, lengthSize);
      if (!length || at + lengthSize + length > offset + size) { at = -1; break; }
      const header = data[at + lengthSize];
      if (header & 0x80 || !(header & 31) || (header & 31) > 23) { at = -1; break; }
      types.push(header & 31);
      at += lengthSize + length;
    }
    if (at !== offset + size) { problems.push(`video sample ${i} is not a whole sequence of H.264 NAL units`); break; }
    if (!types.some(t => t >= 1 && t <= 5)) { problems.push(`video sample ${i} holds no picture slice`); break; }
    if (i === 0 && !types.includes(5)) problems.push('the first video sample is not an IDR frame');
  }
  return problems;
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
    const track = { handler: null, codec: null, entries: 0, profile: null, level: null, seconds: null, scale: 0, objectType: null, audioObjectType: null, avcC: null, samples: null, timing: null };
    const mdia = find(trak.start, trak.end, 'mdia');
    if (mdia) {
      const hdlr = find(mdia.start, mdia.end, 'hdlr');
      if (hdlr && hdlr.end - hdlr.start >= 12) track.handler = data.toString('latin1', hdlr.start + 8, hdlr.start + 12);
      const mdhd = find(mdia.start, mdia.end, 'mdhd');
      if (mdhd && mdhd.end - mdhd.start >= (data[mdhd.start] === 1 ? 32 : 20)) {
        const v1 = data[mdhd.start] === 1;
        const scale = data.readUInt32BE(mdhd.start + (v1 ? 20 : 12));
        const length = v1 ? Number(data.readBigUInt64BE(mdhd.start + 24)) : data.readUInt32BE(mdhd.start + 16);
        if (scale > 0) { track.seconds = length / scale; track.scale = scale; }
      }
      const minf = find(mdia.start, mdia.end, 'minf'), stbl = minf && find(minf.start, minf.end, 'stbl');
      const box = stbl && find(stbl.start, stbl.end, 'stsd');
      if (stbl) track.samples = sampleRanges(data, stbl, find);
      if (stbl && track.scale) track.timing = sampleTiming(data, stbl, find, track.scale, track.samples?.length ?? -1);
      if (box && box.end - box.start >= 16) {
        track.entries = data.readUInt32BE(box.start + 4);
        const entry = children(data, box.start + 8, box.end).next().value;
        if (entry) {
          track.codec = entry.type;
          // A visual sample entry has 78 bytes of fields before its child boxes; avcC opens with version, profile,
          // compatibility, level.
          const avcC = entry.type === 'avc1' && entry.end - entry.start > 78 ? find(entry.start + 78, entry.end, 'avcC') : null;
          if (avcC && avcC.end - avcC.start >= 4) { track.profile = data[avcC.start + 1]; track.level = data[avcC.start + 3]; track.avcC = data.subarray(avcC.start, avcC.end); }
          // An audio sample entry has 28 bytes of fields before its child boxes; its esds names the decoder.
          const esds = entry.type === 'mp4a' && entry.end - entry.start > 28 ? find(entry.start + 28, entry.end, 'esds') : null;
          if (esds) Object.assign(track, esdsFacts(data.subarray(esds.start + 4, esds.end)));
        }
      }
    }
    tracks.push(track);
  }
  return { tracks };
}

/** A top-level box, by type. */
function topBox(data, type) { for (const box of children(data, 0, data.length)) if (box.type === type) return box; return null; }

/** Why an MP4 copy is not what its entry says: one H.264 video track a browser decodes, sound exactly when recorded, its length. */
export function trackProblems(data, entry) {
  const { tracks } = mp4Facts(data), problems = [];
  const video = tracks.filter(t => t.handler === 'vide'), sound = tracks.filter(t => t.handler === 'soun');
  if (video.length !== 1) problems.push(`${video.length} video tracks, not 1`);
  else {
    const [v] = video;
    if (v.codec !== 'avc1') problems.push(`the video track is ${v.codec ?? 'unreadable'}, not H.264 (avc1)`);
    else if (!AVC_PROFILES.has(v.profile) || !(v.level <= MAX_AVC_LEVEL)) problems.push(`H.264 profile ${v.profile} level ${v.level}, not Baseline, Main or High at level ${MAX_AVC_LEVEL / 10} or below`);
    if (v.entries !== 1) problems.push(`the video track has ${v.entries} sample descriptions, not 1`);
    if (v.codec === 'avc1') {
      const config = avcConfig(v.avcC);
      if (!config) problems.push('the H.264 configuration (avcC) cannot be read');
      else {
        if (config.profile !== v.profile) problems.push(`the sequence parameter set says profile ${config.profile}, the avcC ${v.profile}`);
        if (config.chroma !== 1 || config.lumaBits !== 8 || config.chromaBits !== 8) problems.push(`the picture is not 8-bit 4:2:0 (chroma format ${config.chroma}, ${config.lumaBits}/${config.chromaBits} bits)`);
        if (!config.pps) problems.push('the avcC carries no readable picture parameter set');
        if (!(config.level <= MAX_AVC_LEVEL)) problems.push(`the sequence parameter set says level ${config.level}, over ${MAX_AVC_LEVEL / 10}`);
        if (!v.timing) problems.push('the video sample durations (stts) cannot be read or do not cover every sample');
        else {
          if (Math.abs(v.timing.seconds - entry.seconds) >= 1) problems.push(`the video samples last ${v.timing.seconds.toFixed(2)} s, the record says ${entry.seconds} s`);
          if (v.samples && v.samples.length / Math.max(v.timing.seconds, 1e-9) < MIN_FPS) problems.push(`${v.samples?.length} video frames in ${v.timing.seconds.toFixed(2)} s, under ${MIN_FPS} frames a second`);
        }
        const mdat = topBox(data, 'mdat');
        problems.push(...(mdat ? avcSampleProblems(data, v.samples, config.lengthSize, mdat) : ['no media data']));
      }
    }
    if (v.seconds === null || Math.abs(v.seconds - entry.seconds) >= 1) problems.push(`the video track is ${v.seconds?.toFixed(2) ?? 'of unreadable length'} s, the record says ${entry.seconds} s`);
  }
  if (entry.audio && (sound.length !== 1 || sound[0].codec !== 'mp4a')) problems.push(`the record says it has sound, but it has ${sound.length} sound tracks${sound[0] ? ` (${sound[0].codec})` : ''}, not one AAC (mp4a) track`);
  else if (entry.audio) {
    const [a] = sound;
    if (a.objectType !== 0x40 || a.audioObjectType !== 2) problems.push(`the sound track is not AAC LC (object type ${a.objectType ?? 'unreadable'}, audio object type ${a.audioObjectType ?? 'unreadable'})`);
    if (a.seconds === null || Math.abs(a.seconds - entry.seconds) >= 1) problems.push(`the sound track is ${a.seconds?.toFixed(2) ?? 'of unreadable length'} s, the record says ${entry.seconds} s`);
    if (a.entries !== 1) problems.push(`the sound track has ${a.entries} sample descriptions, not 1`);
    const mdat = topBox(data, 'mdat');
    if (!a.samples || !a.samples.length || !mdat || a.samples.some(([offset, size]) => offset < mdat.start || offset + size > mdat.end)) problems.push('the sound samples do not all lie inside the media data');
  }
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
    const { frames, srcSha256, yuv420pSha256, ...screeningText } = entry.screening;
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

// Character references, resolved the way a browser does before it reads text or fetches a URL (&#46;webm is .webm); a
// code point a browser would not accept becomes U+FFFD, as it does there.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", period: '.', sol: '/', colon: ':', num: '#', quest: '?', equals: '=', tab: '\t', newline: '\n' };
const codePoint = n => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�');
export const decodeValue = value => value.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));?/g, (whole, dec, hex, name) =>
  dec ? codePoint(Number(dec)) : hex ? codePoint(parseInt(hex, 16)) : NAMED[name.toLowerCase()] ?? whole);

// The one form a WebM film is played in on this site, as every generator and the home page write it: a <source> with a
// plain double-quoted src ending in .webm and a video/webm type, as a live tag inside an open <video>. Only this form is
// paired. A tag must be exactly this text, start to end.
const PLAYED = /^<source src="([^"<>&\s]+\.webm)" type="video\/webm[^"<>&]*">$/;
// The one form a page may otherwise name a WebM in markup: a plain link to the file, which opens it and plays nothing.
const LINKED = /^<a href="[^"<>&\s]+\.webm"(?: [a-z-]+="[^"<>&]*")*>$/;
// Elements whose content is not live markup: raw text (script, style, textarea, title, xmp, noscript, plaintext) and
// <template>, whose content is parsed but never rendered. A WebM named anywhere inside one stops the build.
const OPAQUE = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'plaintext', 'template', 'noembed', 'noframes', 'iframe']);
// What a browser strips from a URL before it fetches it (tab, line feed, carriage return), and white space generally:
// a WebM is found whatever is written between its letters.
const named = text => /webm/i.test(decodeValue(text).replace(/[\s\u0000-\u001f]+/g, ''));

/**
 * The page cut into tokens the way a browser's tokenizer does, as far as it matters here: text; a comment (through -->
 * or --!>, or <!--> and <!--->, or the end); a tag (through the first > outside a quoted attribute value), with its name;
 * and the content of an opaque element (through its end tag, or the end of the page).
 */
export function tokens(html) {
  const out = [];
  let i = 0;
  const push = (kind, start, end, name = '') => { if (end > start) out.push({ kind, start, end, name, text: html.slice(start, end) }); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { push('text', i, html.length); break; }
    push('text', i, lt);
    if (html.startsWith('<!--', lt)) {
      const short = /^<!--->?|^<!-->/.exec(html.slice(lt, lt + 5));
      if (short) { push('comment', lt, lt + short[0].length); i = lt + short[0].length; continue; }
      const m = /--!?>/g; m.lastIndex = lt + 4;
      const close = m.exec(html);
      const end = close ? close.index + close[0].length : html.length;
      push('comment', lt, end); i = end; continue;
    }
    const name = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (!name) {
      // <! , <? and </ not followed by a letter are bogus comments through the next >; a lone < is text.
      if (/^<[!?]|^<\/[^a-zA-Z]/.test(html.slice(lt, lt + 3))) { const gt = html.indexOf('>', lt); const end = gt < 0 ? html.length : gt + 1; push('comment', lt, end); i = end; continue; }
      push('text', lt, lt + 1); i = lt + 1; continue;
    }
    // Through the first > outside a quoted value; a quote only opens a value right after "=" (with optional space).
    let j = lt + name[0].length, quote = null;
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '>') break;
      if ((c === '"' || c === "'") && /=\s*$/.test(html.slice(Math.max(lt, j - 16), j))) quote = c;
    }
    const end = Math.min(html.length, j + 1);
    const tagName = name[1].toLowerCase(), closing = html[lt + 1] === '/';
    push(closing ? 'endtag' : 'tag', lt, end, tagName);
    i = end;
    if (!closing && OPAQUE.has(tagName)) {
      const close = new RegExp(`</${tagName}[\\s/>]`, 'gi'); close.lastIndex = i;
      const m = close.exec(html);
      const stop = m ? m.index : html.length;
      push('opaque', i, stop, tagName); i = stop;
    }
  }
  return out;
}

/**
 * One page with an MP4 <source> after each WebM <source>. `page` is the page's path inside the site ('labs/x/index.html'),
 * `byWebm` maps a site path ('assets/…/film.webm') to its copy. Returns the new html, the WebMs it played and every
 * WebM mention it could not account for.
 *
 * Fail closed: the page is tokenized (tokens()); a live tag that is exactly the PLAYED form, inside an open <video>,
 * whose src resolves to a listed film, is paired, and a live tag that is exactly the LINKED form is a link. Every other
 * tag, every comment and the content of every opaque element is read for a WebM, with character references resolved and
 * white space and control characters taken out (what a browser strips from a URL); any one stops the build. Text between
 * tags (prose, link text) plays nothing and is not read. A page that already carries the copy right after the WebM is
 * left as it is.
 */
export function pairPage(html, page, byWebm) {
  const used = new Set(), unpaired = [];
  const all = tokens(html);
  let videos = 0, out = '', last = 0;
  for (const [n, t] of all.entries()) {
    if (t.kind === 'tag' && t.name === 'video') videos++;
    if (t.kind === 'endtag' && t.name === 'video') videos = Math.max(0, videos - 1);
    if (t.kind === 'text' || t.kind === 'endtag' && !named(t.text)) continue;
    const played = t.kind === 'tag' ? PLAYED.exec(t.text) : null;
    if (played) {
      const src = played[1];
      const resolved = !/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(src) ? posix.normalize(posix.join(posix.dirname(page), src)) : null;
      const entry = resolved && byWebm.get(resolved);
      if (!videos || !entry) { unpaired.push(`${page}: <source src="${src}">${!videos ? ' outside a <video>' : ' is not a listed film'}`); continue; }
      used.add(entry.webm);
      const insert = `<source src="${src.replace(/\.webm$/, '.mp4')}" type="video/mp4">`;
      const next = all[n + 1];
      if (!(next && next.text === insert)) { out += html.slice(last, t.end) + insert; last = t.end; }
      continue;
    }
    if (t.kind === 'tag' && LINKED.test(t.text)) continue;
    if (named(t.text)) unpaired.push(`${page}: "${t.text.slice(0, 80).replace(/\s+/g, ' ')}" names a WebM in ${t.kind === 'tag' || t.kind === 'endtag' ? 'a tag' : t.kind === 'comment' ? 'a comment' : `<${t.name}>`} outside the paired forms`);
  }
  out += html.slice(last);
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
    ...unpaired.map(line => `${line}: no MP4 copy can be paired (${FALLBACKS_FILE})`),
    ...unused.map(webm => `${webm} has an MP4 copy but no page plays it`)].join('\n  ')}`);
  return { pages, films: used.size };
}
