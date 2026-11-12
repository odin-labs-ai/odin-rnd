import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFilmFallbacks, fallbacksProblems, FALLBACKS_FILE, limitFor, pairPage, progressiveProblems, readFallbacks } from './film-fallbacks.mjs';
import { MAX_FILM_BYTES } from './lab-films.mjs';
import { MAX_CLIP_BYTES } from './lab-dispatch-publish.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const box = (type, body = Buffer.alloc(0)) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]); };
const progressive = (fill = 1) => Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isomavc1', 'latin1')), box('moov', Buffer.alloc(16)), box('mdat', Buffer.alloc(32, fill))]);
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
  const late = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0', 'latin1')), box('mdat', Buffer.alloc(32)), box('moov', Buffer.alloc(16))]);
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
  assert.deepEqual(r.unpaired, ['x/index.html: a/b.webm']);
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
    assert.throws(() => addFilmFallbacks({ distDir: dist, root }), /index\.html: assets\/other\.webm plays a WebM with no MP4 copy/);
    writeFileSync(join(dist, 'index.html'), '<video><source src="assets/labs/agent-space/films/a-film.webm" type="video/webm"></video>');
    assert.deepEqual(addFilmFallbacks({ distDir: dist, root }), { pages: 1, films: 1 });
    assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /a-film\.webm" type="video\/webm"><source src="assets\/labs\/agent-space\/films\/a-film\.mp4" type="video\/mp4">/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); }
});
