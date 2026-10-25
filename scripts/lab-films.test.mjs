import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILMS_FILE, MAX_FILM_BYTES, filmsProblems, readFilms, renderFilms } from './lab-films.mjs';
import { renderLabs } from './labs.mjs';

// Lab 01's films gate (mission rnd-labs-human-first-1024): schema, the publisher's screen, and sha256 pinning.
const sha256 = data => createHash('sha256').update(data).digest('hex');
const reverse = text => [...text].reverse().join('');
const studio = reverse('tfolemag'), town = reverse('nrooH');

// A scratch site root holding one film and its poster (any bytes: the gate pins bytes, it does not decode them).
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'lab-films-'));
  const dir = join(root, 'assets/labs/agent-space/films');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, 'data/labs/agent-space'), { recursive: true });
  const film = Buffer.from('a film, as bytes'), poster = Buffer.from('a poster, as bytes'), original = Buffer.from('the original film');
  writeFileSync(join(dir, 'tour.webm'), film);
  writeFileSync(join(dir, 'tour-poster.jpg'), poster);
  const record = { format: 'odin-lab-films', version: 1, lab: 'agent-space', films: [{
    id: 'tour', title: 'A tour of the agent space', line: 'A visitor walks in and asks the agents questions.', real: 'A live session, recorded unedited.',
    src: 'assets/labs/agent-space/films/tour.webm', poster: 'assets/labs/agent-space/films/tour-poster.jpg', mime: 'video/webm;codecs=vp9',
    bytes: film.length, seconds: 83, sha256: { src: sha256(film), poster: sha256(poster) },
    source: { commit: 'a'.repeat(40), note: 'Recorded live and unedited in the agent space.', originalSha256: sha256(original), originalBytes: original.length, reencoded: true } }] };
  return { root, record };
}
const clone = value => JSON.parse(JSON.stringify(value));

test('a films record with every file present and pinned passes', () => {
  const { root, record } = scratch();
  try { assert.deepEqual(filmsProblems(record, FILMS_FILE, root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a film or poster whose bytes differ from the recorded sha256 is refused (one flipped byte is enough)', () => {
  const { root, record } = scratch();
  try {
    const file = join(root, record.films[0].src), bytes = readFileSync(file);
    const flipped = Buffer.from(bytes); flipped[0] ^= 0xff;
    writeFileSync(file, flipped);
    assert.match(filmsProblems(record, FILMS_FILE, root).join('\n'), /films\/0\/src: assets\/labs\/agent-space\/films\/tour\.webm does not match its recorded sha256/);
    writeFileSync(file, bytes);
    const posterHash = clone(record); posterHash.films[0].sha256.poster = '0'.repeat(64);
    assert.match(filmsProblems(posterHash, FILMS_FILE, root).join('\n'), /films\/0\/poster: .* does not match its recorded sha256/);
    rmSync(join(root, record.films[0].poster));
    assert.match(filmsProblems(record, FILMS_FILE, root).join('\n'), /films\/0\/poster: .* is missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a size that is not the recorded one, or over the limit, is refused', () => {
  const { root, record } = scratch();
  try {
    const wrong = clone(record); wrong.films[0].bytes += 1;
    assert.match(filmsProblems(wrong, FILMS_FILE, root).join('\n'), /films\/0\/bytes: .* bytes on disk, the record says/);
    const big = Buffer.alloc(MAX_FILM_BYTES + 1);
    writeFileSync(join(root, record.films[0].src), big);
    const over = clone(record); over.films[0].bytes = big.length; over.films[0].sha256.src = sha256(big);
    assert.match(filmsProblems(over, FILMS_FILE, root).join('\n'), new RegExp(`over the ${MAX_FILM_BYTES}-byte limit`));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('any text the gallery shows passes the publisher\'s screen: a restricted name, a place, a price or a link elsewhere is refused', () => {
  const { root, record } = scratch();
  try {
    const cases = [
      [f => { f.title = `A tour of the ${studio} build`; }, /films\/0#\/title: a restricted name/],
      [f => { f.line = `Filmed in ${town}.`; }, /films\/0#\/line: a place name/],
      [f => { f.source.note = 'It cost €4 to render.'; }, /films\/0#\/source\/note: a price or currency amount/],
      [f => { f.real = `Staged at ${studio}.`; }, /films\/0#\/real: a restricted name/],
      [f => { f.line = 'More at https://example.com/films'; }, /films\/0#\/line: a link to somewhere other than this lab/],
    ];
    for (const [edit, expected] of cases) {
      const bad = clone(record); edit(bad.films[0]);
      assert.match(filmsProblems(bad, FILMS_FILE, root).join('\n'), expected, String(expected));
    }
    const path = clone(record); path.films[0].src = `assets/labs/agent-space/films/${studio}.webm`;
    assert.match(filmsProblems(path, FILMS_FILE, root).join('\n'), /films\/0\/src: a restricted name/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the schema is closed: an extra field, a file outside the films folder or a missing hash is refused', () => {
  const { root, record } = scratch();
  try {
    const extra = clone(record); extra.films[0].owner = 'someone';
    assert.match(filmsProblems(extra, FILMS_FILE, root).join('\n'), /owner: not allowed/);
    const outside = clone(record); outside.films[0].src = 'assets/elsewhere/tour.webm';
    assert.match(filmsProblems(outside, FILMS_FILE, root).join('\n'), /films\/0\/src: does not match/);
    const noHash = clone(record); delete noHash.films[0].sha256.poster;
    assert.match(filmsProblems(noHash, FILMS_FILE, root).join('\n'), /sha256: .*poster/);
    const twice = clone(record); twice.films.push(clone(record.films[0]));
    assert.match(filmsProblems(twice, FILMS_FILE, root).join('\n'), /films\/1\/id: tour is listed twice/);
    const noCommit = clone(record); delete noCommit.films[0].source.commit;
    assert.match(filmsProblems(noCommit, FILMS_FILE, root).join('\n'), /films\/0\/source: missing commit/);
    const noReal = clone(record); delete noReal.films[0].real;
    assert.match(filmsProblems(noReal, FILMS_FILE, root).join('\n'), /films\/0: missing real/);
    const honest = clone(record); honest.films[0].source.reencoded = false;
    assert.match(filmsProblems(honest, FILMS_FILE, root).join('\n'), /reencoded must be true exactly when/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an empty listing is allowed, and the page then says the first films are being filmed', () => {
  const { root, record } = scratch();
  try {
    assert.deepEqual(filmsProblems({ ...record, films: [] }, FILMS_FILE, root), []);
    assert.match(renderFilms({ ...record, films: [] }), /The first films are being filmed in the live space/);
    assert.doesNotMatch(renderFilms({ ...record, films: [] }), /<video/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readFilms fails the build on a refused record, and finds none in a site without one', () => {
  const { root, record } = scratch();
  try {
    assert.equal(readFilms(root), null);
    const bad = clone(record); bad.films[0].sha256.src = '1'.repeat(64);
    writeFileSync(join(root, FILMS_FILE), JSON.stringify(bad));
    assert.throws(() => readFilms(root), /Lab films refused:[\s\S]*does not match its recorded sha256/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the committed films pass, stay under the limit, and load lazily on the lab page with a poster', () => {
  const films = readFilms('site');
  assert.ok(films && films.films.length >= 1, 'site/data/labs/agent-space/films.json is committed');
  const page = renderLabs()['labs/agent-space/index.html'];
  for (const film of films.films) {
    assert.ok(statSync(join('site', film.src)).size <= MAX_FILM_BYTES, film.id);
    assert.ok(page.includes(`<video controls preload="none" playsinline poster="../../${film.poster}"`), film.id);
    assert.ok(page.includes(`<source src="../../${film.src}" type="${film.mime}">`), film.id);
  }
  assert.match(renderFilms(null), /The first films are being filmed/);
  for (const film of films.films) assert.ok(page.includes(`<strong>What is real here:</strong> ${film.real}`), film.id);
});
