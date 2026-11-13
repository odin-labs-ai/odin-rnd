import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFilmFallbacks, fallbacksProblems, FALLBACKS_FILE, limitFor, mp4Facts, pairPage, progressiveProblems, readFallbacks, trackProblems } from './film-fallbacks.mjs';
import { execFileSync } from 'node:child_process';
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
/** A sequence parameter set NAL: High (or `profile`), level 4.0, the given chroma format, 8-bit. */
function sps(profile = 100, chroma = 1) {
  const bitsOf = { 1: '1' + '010' + '1' + '1', 3: '1' + '00100' + '0' + '1' + '1' }[chroma];
  const body = [100, 110, 122, 244].includes(profile) ? bitsOf + '1' : '1' + '1';
  const padded = body.padEnd(Math.ceil(body.length / 8) * 8, '0');
  return Buffer.concat([Buffer.from([0x67, profile, 0, 40]), Buffer.from(padded.match(/.{8}/g).map(b => parseInt(b, 2)))]);
}
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
function avcCBody({ profile = 100, level = 40, chroma = 1, pps = true } = {}) {
  const s = sps(profile, chroma), p = Buffer.from([0x68, 0xce, 0x38, 0x80]);
  return Buffer.concat([Buffer.from([1, profile, 0, level, 0xff, 0xe1]), u16(s.length), s, pps ? Buffer.concat([Buffer.from([1]), u16(p.length), p]) : Buffer.from([0])]);
}
// A track is described by its options; progressive() lays the file out and points each track's one sample into mdat.
const trak = (options = {}) => options;
const VIDEO_SAMPLE = Buffer.from([0, 0, 0, 3, 0x65, 0x88, 0x84]), AUDIO_SAMPLE = Buffer.alloc(4, 0x21);
function trakBox({ handler = 'vide', codec = 'avc1', profile = 100, level = 40, chroma = 1, pps = true, seconds = 4, oti = 0x40, aot = 2, withEsds = true, entries = 1, sample = null } = {}, offset = 0) {
  const avcC = box('avcC', avcCBody({ profile, level, chroma, pps }));
  const entry = codec === 'avc1' ? box('avc1', Buffer.concat([Buffer.alloc(78), avcC]))
    : codec === 'mp4a' ? box('mp4a', Buffer.concat([Buffer.alloc(28), withEsds ? esds(oti, aot) : Buffer.alloc(0)])) : box(codec, Buffer.alloc(28));
  const stsd = full('stsd', Buffer.concat([u32(entries), ...Array(entries).fill(entry)]));
  const size = (sample ?? (handler === 'soun' ? AUDIO_SAMPLE : VIDEO_SAMPLE)).length;
  const stbl = box('stbl', Buffer.concat([stsd, full('stsc', Buffer.concat([u32(1), u32(1), u32(1), u32(1)])), full('stsz', Buffer.concat([u32(0), u32(1), u32(size)])), full('stco', Buffer.concat([u32(1), u32(offset)]))]));
  const hdlr = full('hdlr', Buffer.concat([Buffer.alloc(4), Buffer.from(handler, 'latin1'), Buffer.alloc(12)]));
  const mdhd = full('mdhd', Buffer.concat([u32(0), u32(0), u32(1000), u32(Math.round(seconds * 1000)), Buffer.alloc(4)]));
  return box('trak', box('mdia', Buffer.concat([mdhd, hdlr, box('minf', stbl)])));
}
const FTYP = box('ftyp', Buffer.from('isom\0\0\x02\0isomavc1', 'latin1'));
/** A faststart MP4: ftyp, moov with the given tracks, then mdat holding each track's one sample. */
function progressive(fill = 1, tracks = [trak()]) {
  const samples = tracks.map(t => t.sample ?? (t.handler === 'soun' ? AUDIO_SAMPLE : VIDEO_SAMPLE));
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
  const home = pairPage('<source src="assets/labs/agent-space/films/a-film.webm" type="video/webm">', 'index.html', byWebm);
  assert.match(home.html, /<source src="assets\/labs\/agent-space\/films\/a-film\.mp4" type="video\/mp4">$/);
});

test('a WebM with no copy is reported, and a non-WebM source is left alone', () => {
  const byWebm = new Map();
  const r = pairPage('<source src="a/b.webm" type="video/webm"><source src="c.mp4" type="video/mp4"><source srcset="d.webp" type="image/webp">', 'x/index.html', byWebm);
  assert.deepEqual(r.unpaired, ['x/index.html: <source> src=a/b.webm']);
  assert.equal(r.html, '<source src="a/b.webm" type="video/webm"><source src="c.mp4" type="video/mp4"><source srcset="d.webp" type="image/webp">');
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
    assert.throws(() => addFilmFallbacks({ distDir: dist, root }), /index\.html: <source> src=assets\/other\.webm plays a WebM with no MP4 copy/);
    writeFileSync(join(dist, 'index.html'), '<video><source src="assets/labs/agent-space/films/a-film.webm" type="video/webm"></video>');
    assert.deepEqual(addFilmFallbacks({ distDir: dist, root }), { pages: 1, films: 1 });
    assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /a-film\.webm" type="video\/webm"><source src="assets\/labs\/agent-space\/films\/a-film\.mp4" type="video\/mp4">/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
});

test('a copy must be one H.264 video track a browser decodes, with sound exactly when recorded, of the recorded length', () => {
  const entry = { seconds: 4, audio: false };
  assert.deepEqual(trackProblems(progressive(), entry), []);
  const [facts] = mp4Facts(progressive()).tracks;
  assert.deepEqual({ ...facts, avcC: undefined, samples: facts.samples.length }, { handler: 'vide', codec: 'avc1', entries: 1, profile: 100, level: 40, seconds: 4, objectType: null, audioObjectType: null, avcC: undefined, samples: 1 });
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

// Where ffprobe is installed: each copy is as long as the WebM it was made from (the WebM's last video packet), and the
// WebM has sound exactly when the copy does. The build cannot run ffprobe; this is the check anyone can repeat.
let ffprobe = true;
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); } catch { ffprobe = false; }
test('each copy ends within half a second of its WebM and has sound exactly when the WebM does (ffprobe)', { skip: !ffprobe && 'ffprobe is not installed' }, () => {
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

// Where ffmpeg is installed: every screened frame's hash is recomputed from the copy itself, the way the record was made
// (ffmpeg -ss <t> -i <copy> -frames:v 1, raw rgb24), so the frame list is bound to the bytes, not only to the author.
// The YUV to RGB step is ffmpeg's default scaler, which is not promised to be bit-identical across ffmpeg builds: a
// mismatch on another build is a reason to compare decoders before suspecting the copy.
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
test('every screened frame of every copy hashes to its record (ffmpeg)', { skip: !ffmpeg && 'ffmpeg is not installed' }, () => {
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

test('pairing reads attributes the way a browser does, and reports every WebM it cannot pair', () => {
  const byWebm = new Map([['assets/f.webm', { webm: 'assets/f.webm' }]]);
  const paired = ["<source src='assets/f.webm' type='video/webm'>", '<source src=assets/f.webm type=video/webm>', '<SOURCE SRC="assets/f.webm" TYPE="video/webm">', '<source src = "assets/f.webm">'];
  for (const tag of paired) {
    const r = pairPage(tag, 'index.html', byWebm);
    assert.deepEqual(r.unpaired, [], tag);
    assert.equal(r.html, `${tag}<source src="assets/f.mp4" type="video/mp4">`, tag);
  }
  const reported = ['<video src="assets/f.webm" controls></video>', '<source data-src="assets/f.webm" type="video/webm">', '<source type="video/webm">', '<source src="assets/g.webm">', '<source src="assets/f.webm" data-alt="x.webm">'];
  for (const html of reported) {
    const r = pairPage(html, 'index.html', byWebm);
    assert.equal(r.unpaired.length, 1, html);
    assert.equal(r.html, html, `${html} is left as it is`);
  }
  assert.deepEqual(pairPage('<p>The films are WebM files (.webm) with an MP4 copy.</p>', 'index.html', byWebm).unpaired, [], 'text is not a tag');
  assert.deepEqual(pairPage('<a href="assets/f.webm">download the film</a>', 'index.html', byWebm).unpaired, [], 'a link is not a player');
  assert.equal(pairPage('<embed src="assets/f.webm">', 'index.html', byWebm).unpaired.length, 1, 'an embed is');
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
  has([trak({ shift: 100 })], /lies outside the media data/);
  has([trak({ entries: 2 })], /2 sample descriptions, not 1/);
  has([trak({ chroma: 3, profile: 244 })], /not 8-bit 4:2:0 \(chroma format 3/);
  has([trak({ pps: false })], /no picture parameter set/);
  assert.ok(trackProblems(progressive(1, [trak(), trak({ handler: 'soun', codec: 'mp4a', shift: 100 })]), { ...entry, audio: true }).some(p => /sound samples do not all lie inside/.test(p)));
  const data = progressive();
  assert.ok(progressiveProblems(Buffer.concat([data, Buffer.alloc(3)])).some(p => /3 stray bytes after the last box/.test(p)));
});

test('pairing resolves character references and ignores comments, scripts and styles', () => {
  const byWebm = new Map([['assets/f.webm', { webm: 'assets/f.webm' }]]);
  const entity = pairPage('<source src="assets/f&#46;webm">', 'index.html', byWebm);
  assert.deepEqual([[...entity.used], entity.unpaired], [['assets/f.webm'], []]);
  assert.match(entity.html, /<source src="assets\/f\.mp4" type="video\/mp4">$/);
  assert.equal(pairPage('<source src="assets/g&period;webm">', 'index.html', byWebm).unpaired.length, 1, 'an unlisted film behind a reference is reported');
  for (const inert of ['<!-- <source src="assets/f.webm"> -->', '<script>const t = "<source src=assets/f.webm>";</script>', '<style>/* <video src="x.webm"> */</style>']) {
    const r = pairPage(inert, 'index.html', byWebm);
    assert.deepEqual([r.html, r.used.size, r.unpaired], [inert, 0, []], inert);
  }
  assert.equal(pairPage("<source src='assets/f.webm?a=\"1\"'>", 'index.html', byWebm).unpaired.length, 1, 'a src that would need escaping is not written back');
});
