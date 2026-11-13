import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFilmFallbacks, fallbacksProblems, FALLBACKS_FILE, limitFor, mp4Facts, pairPage, progressiveProblems, readFallbacks, trackProblems } from './film-fallbacks.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { MAX_FILM_BYTES } from './lab-films.mjs';
import { MAX_CLIP_BYTES } from './lab-dispatch-publish.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const box = (type, body = Buffer.alloc(0)) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]); };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const full = (type, body) => box(type, Buffer.concat([Buffer.alloc(4), body]));
/** One track: its handler, its first sample entry and, for avc1, the avcC's profile and level; `seconds` at timescale 1000. */
const desc = (tag, body) => Buffer.concat([Buffer.from([tag, body.length]), body]);
/** An esds naming `oti` (0x40 MPEG-4 audio) and audio object type `aot` (2 AAC LC). */
const esds = (oti = 0x40, aot = 2) => full('esds', desc(0x03, Buffer.concat([Buffer.from([0, 1, 0]),
  desc(0x04, Buffer.concat([Buffer.from([oti, 0x15]), Buffer.alloc(11), desc(0x05, Buffer.from([(aot << 3) | 1, 0x10]))])), desc(0x06, Buffer.from([2]))])));
/** A sequence parameter set NAL: High (or `profile`), at `level`, the given chroma format, 8-bit. */
function sps(profile = 100, chroma = 1, level = 40) {
  const bitsOf = { 1: '1' + '010' + '1' + '1', 3: '1' + '00100' + '0' + '1' + '1' }[chroma];
  const body = [100, 110, 122, 244].includes(profile) ? bitsOf + '1' : '1' + '1';
  const padded = body.padEnd(Math.ceil(body.length / 8) * 8, '0');
  return Buffer.concat([Buffer.from([0x67, profile, 0, level]), Buffer.from(padded.match(/.{8}/g).map(b => parseInt(b, 2)))]);
}
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
function avcCBody({ profile = 100, level = 40, spsLevel = level, chroma = 1, pps = true, ppsNal = Buffer.from([0x68, 0xce, 0x38, 0x80]) } = {}) {
  const s = sps(profile, chroma, spsLevel), p = ppsNal;
  return Buffer.concat([Buffer.from([1, profile, 0, level, 0xff, 0xe1]), u16(s.length), s, pps ? Buffer.concat([Buffer.from([1]), u16(p.length), p]) : Buffer.from([0])]);
}
// A track is described by its options; progressive() lays the file out and points each track's samples into mdat.
const trak = (options = {}) => options;
const VIDEO_SAMPLE = Buffer.from([0, 0, 0, 3, 0x65, 0x88, 0x84]), AUDIO_SAMPLE = Buffer.alloc(4, 0x21);
// Each track holds `frames` samples, all the same bytes, one after another in mdat, each lasting seconds / frames (stts);
// 20 frames over the default 4 s is 5 a second, the floor.
function trakBox({ handler = 'vide', codec = 'avc1', profile = 100, level = 40, spsLevel = level, chroma = 1, pps = true, ppsNal, seconds = 4, sampleSeconds = seconds, frames = 20, oti = 0x40, aot = 2, withEsds = true, entries = 1, sample = null, stts = true } = {}, offset = 0) {
  const avcC = box('avcC', avcCBody({ profile, level, spsLevel, chroma, pps, ...(ppsNal ? { ppsNal } : {}) }));
  const entry = codec === 'avc1' ? box('avc1', Buffer.concat([Buffer.alloc(78), avcC]))
    : codec === 'mp4a' ? box('mp4a', Buffer.concat([Buffer.alloc(28), withEsds ? esds(oti, aot) : Buffer.alloc(0)])) : box(codec, Buffer.alloc(28));
  const stsd = full('stsd', Buffer.concat([u32(entries), ...Array(entries).fill(entry)]));
  const size = (sample ?? (handler === 'soun' ? AUDIO_SAMPLE : VIDEO_SAMPLE)).length;
  const delta = Math.round(sampleSeconds * 1000 / frames);
  const stbl = box('stbl', Buffer.concat([stsd, ...(stts ? [full('stts', Buffer.concat([u32(1), u32(frames), u32(delta)]))] : []),
    full('stsc', Buffer.concat([u32(1), u32(1), u32(frames), u32(1)])), full('stsz', Buffer.concat([u32(size), u32(frames)])), full('stco', Buffer.concat([u32(1), u32(offset)]))]));
  const hdlr = full('hdlr', Buffer.concat([Buffer.alloc(4), Buffer.from(handler, 'latin1'), Buffer.alloc(12)]));
  const mdhd = full('mdhd', Buffer.concat([u32(0), u32(0), u32(1000), u32(Math.round(seconds * 1000)), Buffer.alloc(4)]));
  return box('trak', box('mdia', Buffer.concat([mdhd, hdlr, box('minf', stbl)])));
}
const FTYP = box('ftyp', Buffer.from('isom\0\0\x02\0isomavc1', 'latin1'));
/** A faststart MP4: ftyp, moov with the given tracks, then mdat holding each track's samples. */
function progressive(fill = 1, tracks = [trak()]) {
  const samples = tracks.map(t => Buffer.concat(Array(t.frames ?? 20).fill(t.sample ?? (t.handler === 'soun' ? AUDIO_SAMPLE : VIDEO_SAMPLE))));
  const moovAt = offsets => box('moov', Buffer.concat(tracks.map((t, i) => trakBox(t, offsets[i]))));
  const start = FTYP.length + moovAt(tracks.map(() => 0)).length + 8;
  const offsets = samples.map((_, i) => start + samples.slice(0, i).reduce((n, b) => n + b.length, 0) + (tracks[i].shift ?? 0));
  return Buffer.concat([FTYP, moovAt(offsets), box('mdat', Buffer.concat([...samples, Buffer.alloc(32, fill)]))]);
}
const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [];

/** A site root with one film, its copy and a record for it; returns the root and the record. */
function fixture({ mp4 = progressive(), webm = Buffer.from('\x1aE\xdf\xa3 a webm', 'latin1') } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'film-fallbacks-'));
  const dir = join(root, 'assets/labs/agent-space/films');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, 'data/labs/agent-space'), { recursive: true });
  writeFileSync(join(dir, 'a-film.webm'), webm);
  writeFileSync(join(dir, 'a-film.mp4'), mp4);
  const record = JSON.parse(readFileSync(join('site', FALLBACKS_FILE), 'utf8'));
  record.fallbacks = [{ ...record.fallbacks[0], webm: 'assets/labs/agent-space/films/a-film.webm', webmSha256: sha256(webm), mp4: 'assets/labs/agent-space/films/a-film.mp4',
    sha256: sha256(mp4), bytes: mp4.length, seconds: 4, audio: false, screening: { ...record.fallbacks[0].screening, srcSha256: sha256(mp4), frames: [{ t: 0, rgb24Sha256: 'a'.repeat(64) }] } }];
  writeFileSync(join(root, FALLBACKS_FILE), JSON.stringify(record));
  return { root, record };
}

test('the committed record passes, and every WebM film under site/assets/labs has exactly one hash-pinned MP4 copy', () => {
  const record = readFallbacks('site');
  assert.ok(record, 'site/data/labs/agent-space/film-fallbacks.json exists');
  const webms = walk('site/assets/labs').filter(f => f.endsWith('.webm')).map(f => f.slice('site/'.length)).sort();
  assert.deepEqual(record.fallbacks.map(f => f.webm).sort(), webms);
  for (const entry of record.fallbacks) {
    assert.ok(entry.bytes <= limitFor(entry.webm), `${entry.mp4} is within its limit`);
    assert.equal(entry.screening.result, 'pass');
  }
});

test('a dispatch clip has the clip limit and every other film the film limit', () => {
  assert.equal(limitFor('assets/labs/agent-space/session-2026-11-08/clip.webm'), MAX_CLIP_BYTES);
  assert.equal(limitFor('assets/labs/agent-space/films/agent-space-tour.webm'), MAX_FILM_BYTES);
  assert.equal(limitFor('assets/labs/agent-space/progress/hq-on-duty.webm'), MAX_FILM_BYTES);
});

test('a well-formed copy passes the fixture checks', () => {
  const { root, record } = fixture();
  try { assert.deepEqual(fallbacksProblems(record, FALLBACKS_FILE, root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('one flipped byte in a copy is refused', () => {
  const { root, record } = fixture();
  try {
    const file = join(root, record.fallbacks[0].mp4), data = readFileSync(file);
    data[data.length - 1] ^= 1;
    writeFileSync(file, data);
    assert.ok(fallbacksProblems(record, FALLBACKS_FILE, root).some(p => /does not match its recorded sha256/.test(p)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a WebM that changed after its copy was made is refused', () => {
  const { root, record } = fixture();
  try {
    writeFileSync(join(root, record.fallbacks[0].webm), 'another film');
    assert.ok(fallbacksProblems(record, FALLBACKS_FILE, root).some(p => /has changed since this copy was made/.test(p)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a copy with moov after mdat (not faststart) is refused', () => {
  const late = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0', 'latin1')), box('mdat', Buffer.alloc(32)), box('moov', trakBox())]);
  assert.deepEqual(progressiveProblems(progressive()), []);
  assert.ok(progressiveProblems(late).some(p => /not faststart/.test(p)));
  assert.ok(progressiveProblems(Buffer.from('not an mp4 at all')).length > 0);
  const { root, record } = fixture({ mp4: late });
  try { assert.ok(fallbacksProblems(record, FALLBACKS_FILE, root).some(p => /not faststart/.test(p))); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a copy over its limit, a copy not beside its WebM and a screening record that misses the end are refused', () => {
  const { root, record } = fixture();
  try {
    const entry = record.fallbacks[0];
    const over = { ...record, fallbacks: [{ ...entry, bytes: MAX_FILM_BYTES + 1 }] };
    assert.ok(fallbacksProblems(over).some(p => /over the \d+-byte limit/.test(p)));
    const moved = { ...record, fallbacks: [{ ...entry, mp4: 'assets/labs/agent-space/films/other.mp4' }] };
    assert.ok(fallbacksProblems(moved).some(p => /must sit beside its WebM/.test(p)));
    const short = { ...record, fallbacks: [{ ...entry, seconds: 30 }] };
    assert.ok(fallbacksProblems(short).some(p => /the last frame is at 0 s of a 30 s film/.test(p)));
    const extra = { ...record, fallbacks: [{ ...entry, note: 'x' }] };
    assert.ok(fallbacksProblems(extra).some(p => /does not match odin-film-fallbacks v1/.test(p)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a page gets the MP4 source right after the WebM one, with the same relative path, once', () => {
  const byWebm = new Map([['assets/labs/agent-space/films/a-film.webm', { webm: 'assets/labs/agent-space/films/a-film.webm' }]]);
  const html = '<video controls><source src="../../assets/labs/agent-space/films/a-film.webm" type="video/webm;codecs=vp9"><img src="x.jpg" alt=""></video>';
  const first = pairPage(html, 'labs/agent-space/index.html', byWebm);
  assert.equal(first.html, '<video controls><source src="../../assets/labs/agent-space/films/a-film.webm" type="video/webm;codecs=vp9"><source src="../../assets/labs/agent-space/films/a-film.mp4" type="video/mp4"><img src="x.jpg" alt=""></video>');
  assert.deepEqual([...first.used], ['assets/labs/agent-space/films/a-film.webm']);
  assert.deepEqual(first.unpaired, []);
  assert.equal(pairPage(first.html, 'labs/agent-space/index.html', byWebm).html, first.html, 'a second pass changes nothing');
  const home = pairPage('<video><source src="assets/labs/agent-space/films/a-film.webm" type="video/webm"></video>', 'index.html', byWebm);
  assert.match(home.html, /<source src="assets\/labs\/agent-space\/films\/a-film\.mp4" type="video\/mp4"><\/video>$/);
});

test('a WebM with no copy is reported, and other sources are left alone', () => {
  const byWebm = new Map();
  const r = pairPage('<video><source src="a/b.webm" type="video/webm"><source src="c.mp4" type="video/mp4"></video><picture><source srcset="d.webp" type="image/webp"></picture>', 'x/index.html', byWebm);
  assert.ok(r.unpaired.length >= 1);
  for (const line of r.unpaired) assert.match(line, /^x\/index\.html: ".*" names a WebM outside the paired forms$/);
  assert.equal(r.html, '<video><source src="a/b.webm" type="video/webm"><source src="c.mp4" type="video/mp4"></video><picture><source srcset="d.webp" type="image/webp"></picture>');
});

test('the dist pass fails closed on an unpaired WebM and on a copy no page plays', () => {
  const { root } = fixture();
  const dist = mkdtempSync(join(tmpdir(), 'film-fallbacks-dist-'));
  try {
    mkdirSync(join(dist, 'assets/labs/agent-space/films'), { recursive: true });
    writeFileSync(join(dist, 'assets/labs/agent-space/films/a-film.mp4'), readFileSync(join(root, 'assets/labs/agent-space/films/a-film.mp4')));
    writeFileSync(join(dist, 'index.html'), '<p>no film</p>');
    assert.throws(() => addFilmFallbacks({ distDir: dist, root }), /has an MP4 copy but no page plays it/);
    writeFileSync(join(dist, 'index.html'), '<video><source src="assets/labs/agent-space/films/a-film.webm" type="video/webm"><source src="assets/other.webm" type="video/webm"></video>');
    assert.throws(() => addFilmFallbacks({ distDir: dist, root }), /index\.html: ".*other\.webm.*" names a WebM outside the paired forms: no MP4 copy can be paired/);
    writeFileSync(join(dist, 'index.html'), '<video><source src="assets/labs/agent-space/films/a-film.webm" type="video/webm"></video>');
    assert.deepEqual(addFilmFallbacks({ distDir: dist, root }), { pages: 1, films: 1 });
    assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /a-film\.webm" type="video\/webm"><source src="assets\/labs\/agent-space\/films\/a-film\.mp4" type="video\/mp4">/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
});

test('a copy must be one H.264 video track a browser decodes, with sound exactly when recorded, of the recorded length', () => {
  const entry = { seconds: 4, audio: false };
  assert.deepEqual(trackProblems(progressive(), entry), []);
  const [facts] = mp4Facts(progressive()).tracks;
  assert.deepEqual({ ...facts, avcC: undefined, samples: facts.samples.length }, { handler: 'vide', codec: 'avc1', entries: 1, profile: 100, level: 40, seconds: 4, scale: 1000, objectType: null, audioObjectType: null, avcC: undefined, samples: 20, timing: { seconds: 4 } });
  const refused = (tracks, e, pattern) => assert.ok(trackProblems(progressive(1, tracks), { ...entry, ...e }).some(p => pattern.test(p)), String(pattern));
  refused([trak({ codec: 'hvc1' })], {}, /is hvc1, not H\.264/);
  refused([trak({ codec: 'av01' })], {}, /is av01, not H\.264/);
  refused([trak({ profile: 244 })], {}, /profile 244 level 40/);
  refused([trak({ level: 51 })], {}, /profile 100 level 51/);
  refused([trak({ seconds: 9 })], {}, /9\.00 s, the record says 4 s/);
  refused([trak(), trak()], {}, /2 video tracks/);
  refused([], {}, /0 video tracks/);
  refused([trak(), trak({ handler: 'soun', codec: 'mp4a' })], {}, /no sound, but it has 1 sound tracks/);
  refused([trak()], { audio: true }, /has sound, but it has 0 sound tracks/);
  refused([trak(), trak({ handler: 'soun', codec: 'Opus' })], { audio: true }, /\(Opus\), not one AAC/);
  refused([trak(), trak({ handler: 'text', codec: 'tx3g' })], {}, /1 other tracks/);
  assert.deepEqual(trackProblems(progressive(1, [trak(), trak({ handler: 'soun', codec: 'mp4a' })]), { ...entry, audio: true }), []);
  refused([trak(), trak({ handler: 'soun', codec: 'mp4a', oti: 0x6b })], { audio: true }, /not AAC LC \(object type 107/);
  refused([trak(), trak({ handler: 'soun', codec: 'mp4a', aot: 5 })], { audio: true }, /audio object type 5/);
  refused([trak(), trak({ handler: 'soun', codec: 'mp4a', withEsds: false })], { audio: true }, /not AAC LC \(object type unreadable/);
  refused([trak(), trak({ handler: 'soun', codec: 'mp4a', seconds: 300 })], { audio: true }, /sound track is 300\.00 s/);
  const { root, record } = fixture({ mp4: progressive(1, [trak({ codec: 'hvc1' })]) });
  try { assert.ok(fallbacksProblems(record, FALLBACKS_FILE, root).some(p => /not H\.264/.test(p))); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every committed copy is H.264 High at level 4.0 or below, with sound only for the film that has it', () => {
  for (const entry of readFallbacks('site').fallbacks) {
    const [video, ...rest] = mp4Facts(readFileSync(join('site', entry.mp4))).tracks;
    assert.equal(video.codec, 'avc1', entry.mp4);
    assert.equal(video.profile, 100, `${entry.mp4} is High profile`);
    assert.equal(video.level, 40, `${entry.mp4} is level 4.0`);
    assert.deepEqual(rest.map(t => t.codec), entry.audio ? ['mp4a'] : [], entry.mp4);
  }
});

// The decoder tests. Where ffmpeg and ffprobe are installed they run; with FILM_DECODER_REQUIRED set (the Film copies
// workflow, which installs ffmpeg) a missing decoder is a failure, not a skip. The build cannot run a decoder; these
// are the checks the description's "decoded" claims rest on.
const has = tool => { try { execFileSync(tool, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const required = process.env.FILM_DECODER_REQUIRED === '1';
const ffmpeg = has('ffmpeg'), ffprobe = has('ffprobe');
const decoderSkip = tool => !required && !(tool === 'ffmpeg' ? ffmpeg : ffprobe) && `${tool} is not installed`;

test('a decoder is present wherever one is required', () => {
  if (required) assert.ok(ffmpeg && ffprobe, 'FILM_DECODER_REQUIRED is set but ffmpeg or ffprobe is missing');
});

test('every copy decodes start to end with no error, to exactly as many video frames as it has samples, and its screened frames hash to the record (ffmpeg, ffprobe)', { skip: decoderSkip('ffmpeg') || decoderSkip('ffprobe') }, () => {
  for (const entry of readFallbacks('site').fallbacks) {
    const file = join('site', entry.mp4);
    const run = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', file, '-map', '0', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${entry.mp4}: ffmpeg exited ${run.status}`);
    assert.equal(run.stderr.trim(), '', `${entry.mp4}: decode errors`);
    const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
    const [video] = mp4Facts(readFileSync(file)).tracks;
    assert.equal(frames, video.samples.length, `${entry.mp4}: decoded frames vs samples`);
    assert.ok(frames >= entry.seconds * 14, `${entry.mp4}: ${frames} frames for ${entry.seconds} s`);
    // The screened frames, as the decoder outputs them (raw yuv420p, no scaler: the same bytes on every platform).
    const digest = createHash('sha256');
    for (const frame of entry.screening.frames) {
      const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(frame.t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], { maxBuffer: 16 * 1024 * 1024 });
      assert.equal(raw.length, 1280 * 720 * 3 / 2, `${entry.mp4} at ${frame.t} s decodes to one whole 1280x720 frame`);
      digest.update(raw);
    }
    assert.equal(digest.digest('hex'), entry.screening.yuv420pSha256, `${entry.mp4}: the screened frames`);
  }
});

test('each copy ends within half a second of its WebM and has sound exactly when the WebM does (ffprobe)', { skip: decoderSkip('ffprobe') }, () => {
  for (const entry of readFallbacks('site').fallbacks) {
    const webm = join('site', entry.webm);
    const lastPacket = file => Math.max(...execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf8' })
      .split('\n').map(line => parseFloat(line)).filter(Number.isFinite));
    const last = lastPacket(webm), copy = lastPacket(join('site', entry.mp4));
    assert.ok(Math.abs(last - entry.seconds) < 1.5, `${entry.webm}: its last frame is at ${last} s, the record says ${entry.seconds} s`);
    // The copy's own packets, not its header: its last frame is within half a second of the WebM's.
    assert.ok(Math.abs(copy - last) < 0.5, `${entry.mp4}: its last frame is at ${copy} s, the WebM's at ${last} s`);
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', webm], { encoding: 'utf8' });
    assert.equal(/audio/.test(streams), entry.audio, `${entry.webm}: sound`);
  }
});

// The copy against its WebM, picture by picture: at every screened time the two decoded frames are compared with SSIM.
// A re-encode scores near 1; another shot scores far lower. The median over a film must be at least 0.9 and no frame
// under 0.6 (a frame of motion can land a few milliseconds apart in the two files: measured 0.73 at worst, 2026-11-13).
const SSIM_MEDIAN = 0.9, SSIM_FLOOR = 0.6;
test('every copy shows its WebM: SSIM at every screened time (ffmpeg)', { skip: decoderSkip('ffmpeg') }, () => {
  for (const entry of readFallbacks('site').fallbacks) {
    const scores = entry.screening.frames.map(frame => {
      const t = String(frame.t);
      const run = spawnSync('ffmpeg', ['-nostdin', '-v', 'info', '-ss', t, '-i', join('site', entry.webm), '-ss', t, '-i', join('site', entry.mp4), '-frames:v', '1',
        '-lavfi', '[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim', '-f', 'null', '-'], { encoding: 'utf8' });
      const m = /All:([0-9.]+)/.exec(run.stderr);
      assert.ok(m, `${entry.mp4} at ${t} s: no SSIM`);
      return Number(m[1]);
    }).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];
    assert.ok(median >= SSIM_MEDIAN, `${entry.mp4}: median SSIM ${median} against its WebM`);
    assert.ok(scores[0] >= SSIM_FLOOR, `${entry.mp4}: a screened frame scores ${scores[0]} against its WebM`);
  }
});

// Every screened frame's hash, recomputed from the copy itself the way the record was made (ffmpeg -ss <t> -i <copy>
// -frames:v 1, raw rgb24). The YUV to RGB step is ffmpeg's default scaler, which is not bit-identical across ffmpeg
// versions and CPUs, so this runs only with the ffmpeg version the record names (encoder.tool); elsewhere it says so.
const recordTool = JSON.parse(readFileSync(join('site', FALLBACKS_FILE), 'utf8')).encoder.tool;
const localTool = ffmpeg ? `ffmpeg ${execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split(/\s+/)[2]}` : null;
test('every screened frame of every copy hashes to its record (ffmpeg, the version the record names)', { skip: localTool !== recordTool && `the record's frames were hashed with ${recordTool}; here is ${localTool ?? 'no ffmpeg'}` }, () => {
  for (const entry of readFallbacks('site').fallbacks) {
    for (const frame of entry.screening.frames) {
      const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(frame.t), '-i', join('site', entry.mp4), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
      assert.equal(raw.length, 1280 * 720 * 3, `${entry.mp4} at ${frame.t} s decodes to one whole 1280x720 frame`);
      assert.equal(sha256(raw), frame.rgb24Sha256, `${entry.mp4} at ${frame.t} s`);
    }
  }
});

test('a missing copy, a missing WebM, a copy of another size, a WebM listed twice and a screening of other bytes are refused', () => {
  const { root, record } = fixture();
  try {
    const entry = record.fallbacks[0];
    const has = (rec, pattern) => assert.ok(fallbacksProblems(rec, FALLBACKS_FILE, root).some(p => pattern.test(p)), String(pattern));
    has({ ...record, fallbacks: [{ ...entry, bytes: entry.bytes + 1 }] }, /is \d+ bytes on disk, the record says/);
    has({ ...record, fallbacks: [entry, entry] }, /is listed twice/);
    has({ ...record, fallbacks: [{ ...entry, screening: { ...entry.screening, srcSha256: 'b'.repeat(64) } }] }, /screened bbbbbbbbbbbb/);
    has({ ...record, fallbacks: [{ ...entry, screening: { ...entry.screening, result: 'fail' } }] }, /"fail", not "pass"/);
    rmSync(join(root, entry.mp4));
    has(record, /a-film\.mp4 is missing/);
    rmSync(join(root, entry.webm));
    has(record, /a-film\.webm is missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a box that runs past the end of the file is refused', () => {
  const data = progressive();
  assert.ok(progressiveProblems(data.subarray(0, data.length - 4)).some(p => /runs past the end/.test(p)));
});

test('anything that names a WebM outside the paired forms stops the build, in any markup or spelling', () => {
  const byWebm = new Map([['assets/f.webm', { webm: 'assets/f.webm' }]]);
  const ok = '<video controls><source src="assets/f.webm" type="video/webm"></video>';
  const reported = [
    "<video><source src='assets/f.webm' type='video/webm'></video>", '<video><source src=assets/f.webm type=video/webm></video>',
    '<video><SOURCE SRC="assets/f.webm" TYPE="video/webm"></video>', '<video><source src = "assets/f.webm"></video>',
    '<video src="assets/f.webm" controls></video>', '<video><source data-src="assets/f.webm" type="video/webm"></video>',
    '<video><source type="video/webm"></video>', '<video><source src="assets/f&#46;webm" type="video/mp4"></video>',
    '<video><source src="assets/f.web&#109;" type="video/mp4"></video>', '<embed src="assets/f.webm">',
    '<!-- <source src="assets/f.webm" type="video/webm"> -->', '<script>const t = "<source src=assets/f.webm>";</script>',
    '<script-x></script-x><video><source src="assets/f.WEBM" type="video/mp4"></video>',
    '<video title="a > b" src="assets/u.webm" controls></video>', '<video aria-label="Lab 01 &gt; tour" src="assets/u.webm"></video>',
    '<video><source title="A > B" src="assets/u.webm" type="video/webm"></video>', `<button onclick="if(n>0)v.src='assets/u.webm'">x</button>`,
    '<video src="assets/u.we&#9;bm"></video>', '<video src="assets/u.we&Tab;bm"></video>', '<video src="assets/u.we\nbm"></video>',
    '<video><!-- <source src="assets/f.webm" type="video/webm"> --></video>', '<template><video><source src="assets/f.webm" type="video/webm"></video></template>',
    `<script>const t = '<video controls><source src="assets/f.webm" type="video/webm"></video>';</script>`,
    `<video title=${' '.repeat(16)}"a > b" src="assets/u.webm" controls></video>`, '<p data-x=a="q><video title="x>y" src="assets/u.webm" controls></video>',
    `<!--- <i a=' --><video title="it's>" src="assets/u.webm" controls></video>`, '<!--- <video controls><source src="assets/f.webm" type="video/webm"></video> --->',
    `<script><!-- x='<script>'; y='</script>'; document.querySelector('video').src = 'assets/u.webm';</script>`,
    '<template><template></template><video controls><source src="assets/f.webm" type="video/webm"></video></template>',
    '<video><picture><source src="assets/f.webm" type="video/webm"></picture></video>', '<video src="assets/u.%77ebm"></video>',
    '<p>x.WebM</p>', '<a href="assets/f.webm"><b>the film</b></a>',
    '<picture><source src="assets/f.webm" type="video/webm"></picture>', '<video></video><source src="assets/f.webm" type="video/webm">',
    '<p title="&#99999999;">x</p><video src=v=1/f.webm></video>'];
  for (const html of reported) {
    const r = pairPage(html, 'index.html', byWebm);
    assert.ok(r.unpaired.length >= 1, html);
    assert.equal(r.used.size, 0, `${html}: nothing inert or unlisted counts as played`);
  }
  const r = pairPage(ok, 'index.html', byWebm);
  assert.deepEqual([[...r.used], r.unpaired], [['assets/f.webm'], []]);
  assert.deepEqual(pairPage('<a href="assets/f.webm">download the film</a>', 'index.html', byWebm).unpaired, [], 'a plain link is not a player');
  assert.deepEqual(pairPage('<p>The films are WebM files: <a href="https://example.org/f.webm">https://example.org/f.webm</a></p>', 'index.html', byWebm).unpaired, [], 'a plain link and its text play nothing');
  assert.deepEqual(pairPage('<p>The films are recorded as WebM, with an MP4 copy.</p>', 'index.html', byWebm).unpaired, [], 'the English word');
  assert.equal(pairPage('<p>A tag in prose: &lt;video src=x.webm&gt;</p>', 'index.html', byWebm).unpaired.length, 1, 'a file name in text is read too');
  assert.deepEqual(pairPage('<p title="&#99999999;">a code point no browser accepts</p>', 'index.html', byWebm).unpaired, [], 'it does not throw');
});

test('the dist pass refuses a published copy whose bytes are not the record\'s', () => {
  const { root } = fixture();
  const dist = mkdtempSync(join(tmpdir(), 'film-fallbacks-dist-'));
  try {
    mkdirSync(join(dist, 'assets/labs/agent-space/films'), { recursive: true });
    const good = readFileSync(join(root, 'assets/labs/agent-space/films/a-film.mp4')), bad = Buffer.from(good);
    bad[bad.length - 1] ^= 1;
    writeFileSync(join(dist, 'assets/labs/agent-space/films/a-film.mp4'), bad);
    writeFileSync(join(dist, 'index.html'), '<video><source src="assets/labs/agent-space/films/a-film.webm" type="video/webm"></video>');
    assert.throws(() => addFilmFallbacks({ distDir: dist, root }), /is not in .* with its recorded sha256/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
});

test('every video sample must lie in the media data and be a whole sequence of H.264 NAL units, the first an IDR frame', () => {
  const entry = { seconds: 4, audio: false };
  const has = (tracks, pattern) => assert.ok(trackProblems(progressive(1, tracks), entry).some(p => pattern.test(p)), String(pattern));
  has([trak({ sample: Buffer.from([0, 0, 0, 3, 0x41, 0x9a, 0x02]) })], /first video sample is not an IDR frame/);
  has([trak({ sample: Buffer.from([0, 0, 0, 9, 0x65, 0x88, 0x84]) })], /not a whole sequence of H\.264 NAL units/);
  has([trak({ sample: Buffer.from([0, 0, 0, 3, 0xe5, 0x88, 0x84]) })], /not a whole sequence/);
  has([trak({ sample: Buffer.from([0, 0, 0, 3, 0x67, 0x88, 0x84]) })], /holds no picture slice/);
  has([trak({ shift: 1000 })], /lies outside the media data/);
  has([trak({ entries: 2 })], /2 sample descriptions, not 1/);
  has([trak({ chroma: 3, profile: 244 })], /not 8-bit 4:2:0 \(chroma format 3/);
  has([trak({ pps: false })], /no readable picture parameter set/);
  has([trak({ ppsNal: Buffer.from([0x67, 0x42]) })], /no readable picture parameter set/);
  has([trak({ ppsNal: Buffer.from([0x68]) })], /no readable picture parameter set/);
  has([trak({ spsLevel: 51 })], /sequence parameter set says level 51/);
  has([trak({ stts: false })], /durations \(stts\) cannot be read/);
  has([trak({ sampleSeconds: 9 })], /video samples last 9\.00 s, the record says 4 s/);
  has([trak({ frames: 1, seconds: 300, sampleSeconds: 300 })], /1 video frames in 300\.00 s, under 5 frames a second/);
  assert.ok(trackProblems(progressive(1, [trak(), trak({ handler: 'soun', codec: 'mp4a', shift: 100 })]), { ...entry, audio: true }).some(p => /sound samples do not all lie inside/.test(p)));
  const data = progressive();
  assert.ok(progressiveProblems(Buffer.concat([data, Buffer.alloc(3)])).some(p => /3 stray bytes after the last box/.test(p)));
});
