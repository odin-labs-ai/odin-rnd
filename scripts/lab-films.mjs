// Lab 01's films (mission rnd-labs-human-first-1024): the "Watch it work" gallery on /labs/agent-space/, from
// site/data/labs/agent-space/films.json (odin-lab-films v1, scripts/schemas/odin-lab-films.schema.json). The build
// refuses the file, every reason listed, when it misses the schema, when any text it shows fails the dispatch
// publisher's screen (scripts/lab-dispatch-publish.mjs), or when any film or poster on disk is missing, over
// MAX_FILM_BYTES, a different size than recorded or does not hash to its recorded sha256 (the same pinning
// dispatches use). A film is only ever a real recording of the live space: each names the commit it was recorded at
// and says in one line what is real in it. Like the publisher, the gate cannot read pixels: every film carries a
// screening record bound to its sha256 (one decoded frame every five seconds, each hashed, viewed by an AI agent before
// it is committed), and the gate refuses a record that does not match the film, did not pass or leaves part of it out. With no film listed, the
// page says the first films are being filmed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { pinnedAssetProblems, screenTree } from './lab-dispatch-publish.mjs';

export const FILMS_FILE = 'data/labs/agent-space/films.json';
export const FILMS_SCHEMA_FILE = new URL('./schemas/odin-lab-films.schema.json', import.meta.url);
export const MAX_FILM_BYTES = 6 * 1024 * 1024;
const FILM_DIR = 'assets/labs/agent-space/films/';

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * The screening record is bound to the film's bytes: it names the sha256 it screened (the film's own), says it passed,
 * and lists one decoded frame (ffmpeg, raw rgb24, sha256 per frame, so anyone can re-extract and compare) at least every
 * SCREEN_STEP_S seconds from the first second to within SCREEN_STEP_S of the end. Who viewed the frames is stated in
 * `method`, in plain words; the gate cannot read pixels, so it checks the record covers the whole film and matches it.
 */
export const SCREEN_STEP_S = 5;
export function screeningProblems(film, at) {
  const { screening } = film, out = [];
  if (screening.srcSha256 !== film.sha256.src) out.push(`${at}/srcSha256: screened ${screening.srcSha256.slice(0, 12)}, but the film is ${film.sha256.src.slice(0, 12)}`);
  if (screening.result !== 'pass') out.push(`${at}/result: "${screening.result}", not "pass"`);
  const ts = screening.frames.map(f => f.t);
  if (!ts.length) out.push(`${at}/frames: no frame`);
  else {
    if (ts[0] !== 0) out.push(`${at}/frames: the first frame is at ${ts[0]} s, not 0 s`);
    for (let i = 1; i < ts.length; i++) if (ts[i] <= ts[i - 1] || ts[i] - ts[i - 1] > SCREEN_STEP_S) out.push(`${at}/frames/${i}: ${ts[i - 1]} s to ${ts[i]} s is not a step of 1 to ${SCREEN_STEP_S} s`);
    if (ts.at(-1) < film.seconds - SCREEN_STEP_S) out.push(`${at}/frames: the last frame is at ${ts.at(-1)} s of a ${film.seconds} s film`);
    if (ts.at(-1) > film.seconds) out.push(`${at}/frames: a frame at ${ts.at(-1)} s is past the ${film.seconds} s film`);
  }
  return out;
}

/** Everything that makes a films record unpublishable; with `root`, every file must exist there with its recorded bytes. */
export function filmsProblems(record, where = FILMS_FILE, root = null) {
  const problems = validate(JSON.parse(readFileSync(FILMS_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-lab-films v1)`);
  if (problems.length) return problems;
  const ids = new Set();
  for (const [i, film] of record.films.entries()) {
    const at = `${where}#/films/${i}`;
    if (ids.has(film.id)) problems.push(`${at}/id: ${film.id} is listed twice`);
    ids.add(film.id);
    // Every shown string is page text; the file paths and hashes are checked as pinned assets below.
    const { src, poster, sha256, source: { originalSha256, commit, ...source }, screening: { srcSha256, frames, ...screening }, ...text } = film;
    problems.push(...screenTree({ ...text, source, screening }, `${at}`));
    problems.push(...screeningProblems(film, `${at}/screening`));
    problems.push(...pinnedAssetProblems(src, `${at}/src`, { under: FILM_DIR, root, sha: sha256.src }));
    problems.push(...pinnedAssetProblems(poster, `${at}/poster`, { under: FILM_DIR, root, sha: sha256.poster }));
    if (root && existsSync(join(root, src))) {
      const bytes = statSync(join(root, src)).size;
      if (bytes !== film.bytes) problems.push(`${at}/bytes: ${src} is ${bytes} bytes on disk, the record says ${film.bytes}`);
      if (bytes > MAX_FILM_BYTES) problems.push(`${at}/bytes: ${src} is ${bytes} bytes, over the ${MAX_FILM_BYTES}-byte limit`);
    }
    if (film.source.reencoded === (film.source.originalSha256 === sha256.src)) problems.push(`${at}/source: reencoded must be true exactly when the film's bytes differ from the original's`);
  }
  return problems;
}

/** The committed films record, checked; null when there is none. */
export function readFilms(root = 'site') {
  if (!existsSync(join(root, FILMS_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, FILMS_FILE), 'utf8'));
  const problems = filmsProblems(record, FILMS_FILE, root);
  if (problems.length) throw new Error(`Lab films refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const duration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The gallery: one lazy-loaded film per card (preload="none", a poster), with its plain line and where it came from. */
export function renderFilms(record, up = '../../') {
  if (!record || !record.films.length) return '<p class="lab-none">The first films are being filmed in the live space. They appear here when they have been watched frame by frame.</p>';
  return `<div class="lab-films">${record.films.map(film => `<figure class="lab-film" id="film-${escape(film.id)}"><video controls preload="none" playsinline poster="${up}${escape(film.poster)}" aria-label="${escape(film.title)}: ${escape(film.line)}"><source src="${up}${escape(film.src)}" type="${escape(film.mime)}"></video><figcaption><h3>${escape(film.title)}</h3><p>${escape(film.line)}</p><p class="lab-film-meta"><span>${duration(film.seconds)}</span> · <span>no sound</span> · <code title="sha256 of the file">${escape(film.sha256.src.slice(0, 12))}</code></p><p class="lab-film-real"><strong>What is real here:</strong> ${escape(film.real)}</p><p class="lab-film-source">${escape(film.source.note)} Source commit <code>${escape(film.source.commit.slice(0, 8))}</code>.</p><p class="lab-film-screened">Screened: a frame every ${SCREEN_STEP_S} s (${film.screening.frames.length} frames, each listed with its hash in the films record), viewed by an AI agent.</p></figcaption></figure>`).join('')}</div>`;
}
