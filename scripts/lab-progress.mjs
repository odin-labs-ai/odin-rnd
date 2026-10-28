// Lab 01's progress (lane showcase, 2026-10-28): the hero film on /labs/agent-space/ and the home page, and the "How far
// it came" steps, from site/data/labs/agent-space/progress.json (odin-lab-progress v1,
// scripts/schemas/odin-lab-progress.schema.json). The films record (scripts/lab-films.mjs) holds live sessions only; a
// film here may be a cut of a published cinematic, so it says in one line what in it is rendered and what is captured,
// and the page says so beside it. The build refuses the record, every reason listed, when it misses the schema, when any
// text it shows fails the dispatch publisher's screen, when a file on disk is missing, a different size than recorded,
// over MAX_FILM_BYTES or does not hash to its sha256, when a screening record does not cover its film or still, when a
// source commit is not one the record shows as part of the engine's private main, or when a step names a film the films
// record does not carry. The first step is where the space started; it stays on the page.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema-lite.mjs';
import { pinnedAssetProblems, screenTree } from './lab-dispatch-publish.mjs';
import { MAX_FILM_BYTES, SCREEN_STEP_S, screeningProblems } from './lab-films.mjs';
import { cite, escape, onMainCommits } from './lab-kit.mjs';

export const PROGRESS_FILE = 'data/labs/agent-space/progress.json';
export const PROGRESS_SCHEMA_FILE = new URL('./schemas/odin-lab-progress.schema.json', import.meta.url);
const PROGRESS_DIR = 'assets/labs/agent-space/progress/';

/** A file pinned under the progress directory: present, the recorded size, the recorded sha256, under the size limit. */
function pinned(path, at, { root, sha, bytes, limit = MAX_FILM_BYTES }) {
  const problems = pinnedAssetProblems(path, at, { under: PROGRESS_DIR, root, sha });
  if (root && existsSync(join(root, path))) {
    const size = statSync(join(root, path)).size;
    if (bytes !== undefined && size !== bytes) problems.push(`${at}: ${path} is ${size} bytes on disk, the record says ${bytes}`);
    if (size > limit) problems.push(`${at}: ${path} is ${size} bytes, over the ${limit}-byte limit`);
  }
  return problems;
}

/** A source commit must be one the record shows as part of the engine's private main: a lane commit is never cited. */
function commitProblems(commit, engineMain, at) {
  return onMainCommits(engineMain).includes(commit) ? [] : [`${at}: ${commit.slice(0, 8)} is not shown as part of the engine's private main ${engineMain.main.slice(0, 8)}`];
}

function filmProblems(film, engineMain, at, root) {
  // Every shown string is page text; paths, hashes and the commit are checked as pinned values below.
  const { src, poster, sha256, source: { originalSha256, commit, kept, ...source }, screening: { srcSha256, frames, ...screening }, ...text } = film;
  const problems = screenTree({ ...text, source, screening }, at);
  problems.push(...screeningProblems(film, `${at}/screening`));
  problems.push(...pinned(src, `${at}/src`, { root, sha: sha256.src, bytes: film.bytes }));
  problems.push(...pinned(poster, `${at}/poster`, { root, sha: sha256.poster }));
  problems.push(...commitProblems(commit, engineMain, `${at}/source/commit`));
  if (film.source.reencoded === (originalSha256 === sha256.src)) problems.push(`${at}/source: reencoded must be true exactly when the film's bytes differ from the original's`);
  for (const [i, span] of kept.entries()) {
    if (span.to <= span.from) problems.push(`${at}/source/kept/${i}: ${span.from} s to ${span.to} s is empty`);
    if (i && span.from < kept[i - 1].to) problems.push(`${at}/source/kept/${i}: starts before the span it follows ends`);
  }
  const keptSeconds = kept.reduce((sum, span) => sum + span.to - span.from, 0);
  if (Math.abs(keptSeconds - film.seconds) >= 1) problems.push(`${at}/source/kept: the kept spans last ${keptSeconds.toFixed(2)} s, the film ${film.seconds} s`);
  return problems;
}

function stillProblems(step, engineMain, at, root) {
  const { src, sha256, source: { originalSha256, commit, ...source }, screening: { srcSha256, ...screening }, ...text } = step;
  const problems = screenTree({ ...text, source, screening }, at);
  problems.push(...pinned(src, `${at}/src`, { root, sha: sha256, bytes: step.bytes }));
  problems.push(...commitProblems(commit, engineMain, `${at}/source/commit`));
  if (srcSha256 !== sha256) problems.push(`${at}/screening/srcSha256: screened ${srcSha256.slice(0, 12)}, but the still is ${sha256.slice(0, 12)}`);
  if (screening.result !== 'pass') problems.push(`${at}/screening/result: "${screening.result}", not "pass"`);
  return problems;
}

/** Everything that makes a progress record unpublishable; with `root`, every file must exist there with its recorded bytes. */
export function progressProblems(record, where = PROGRESS_FILE, root = null, films = null) {
  const problems = validate(JSON.parse(readFileSync(PROGRESS_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-lab-progress v1)`);
  if (problems.length) return problems;
  const { engineMain } = record;
  problems.push(...screenTree({ how: engineMain.how }, `${where}#/engineMain`));
  problems.push(...filmProblems(record.hero, engineMain, `${where}#/hero`, root));
  const ids = new Set([record.hero.id]);
  for (const [i, step] of record.steps.entries()) {
    const at = `${where}#/steps/${i}`;
    problems.push(...screenTree({ label: step.label, line: step.line }, at));
    if (i && step.when < record.steps[i - 1].when) problems.push(`${at}/when: ${step.when} comes before the step above it (${record.steps[i - 1].when})`);
    if (step.kind === 'film-ref' && !(films?.films ?? []).some(film => film.id === step.film)) problems.push(`${at}/film: ${step.film} is not in the films record`);
    if (step.kind === 'still') problems.push(...stillProblems(step, engineMain, at, root));
    if (step.kind === 'film') {
      if (ids.has(step.film.id)) problems.push(`${at}/film/id: ${step.film.id} is listed twice`);
      ids.add(step.film.id);
      problems.push(...filmProblems(step.film, engineMain, `${at}/film`, root));
    }
  }
  if (record.steps[0].kind !== 'film-ref') problems.push(`${where}#/steps/0: the first step is where the space started, a film from the films record`);
  return problems;
}

/** The committed progress record, checked against the films record; null when there is none. */
export function readProgress(root = 'site', films = null) {
  if (!existsSync(join(root, PROGRESS_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, PROGRESS_FILE), 'utf8'));
  const problems = progressProblems(record, PROGRESS_FILE, root, films);
  if (problems.length) throw new Error(`Lab progress refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const duration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const engineCite = (commit, engineMain) => `In the engine's private repository: ${cite({ commit }, engineMain)}`;
const video = (film, up, cls = '') => `<video${cls} controls preload="none" playsinline width="${film.width}" height="${film.height}" poster="${up}${escape(film.poster)}" aria-label="${escape(film.title)}: ${escape(film.line)}"><source src="${up}${escape(film.src)}" type="${escape(film.mime)}"></video>`;
const filmSourceLine = (film, engineMain) => `${escape(film.source.note)} ${engineCite(film.source.commit, engineMain)}`;
const screened = film => `Screened: a frame every ${SCREEN_STEP_S} s (${film.screening.frames.length} frames, each listed with its hash in the progress record), viewed by an AI agent; every frame at 2 per second read for text.`;

/** The hero: Lab 01's top figure, the film with what is real in it and where it came from. */
export function renderProgressHero(record, up = '../../') {
  const film = record.hero;
  return `<figure class="lab-hero-media" id="film-${escape(film.id)}">${video(film, up)}<figcaption><strong>${escape(film.title)}.</strong> ${escape(film.line)} <span>${duration(film.seconds)}</span> · <span>${escape(film.sound)}</span>. <strong>What is real here:</strong> ${escape(film.real)} <a href="#progress">How far it came</a>.</figcaption></figure>`;
}

function renderStep(step, record, films, up) {
  const head = `<span class="technical">${escape(step.label)} · <time datetime="${escape(step.when)}">${escape(step.when)}</time></span>`;
  if (step.kind === 'film-ref') {
    const film = films.films.find(f => f.id === step.film);
    return `<li class="lab-film lab-progress-step">${head}<video controls preload="none" playsinline poster="${up}${escape(film.poster)}" aria-label="${escape(film.title)}: ${escape(film.line)}"><source src="${up}${escape(film.src)}" type="${escape(film.mime)}"></video><h3>${escape(film.title)}</h3><p>${escape(step.line)}</p><p class="lab-film-source"><a href="#film-${escape(film.id)}">Its record, with the frames it was screened on.</a></p></li>`;
  }
  if (step.kind === 'still') {
    return `<li class="lab-film lab-progress-step">${head}<img src="${up}${escape(step.src)}" width="${step.width}" height="${step.height}" loading="lazy" alt="${escape(step.alt)}"><p>${escape(step.line)}</p><p class="lab-film-source">${escape(step.source.note)} ${engineCite(step.source.commit, record.engineMain)} <code title="sha256 of the file">${escape(step.sha256.slice(0, 12))}</code></p></li>`;
  }
  const film = step.film;
  return `<li class="lab-film lab-progress-step" id="film-${escape(film.id)}">${head}${video(film, up, film.width / film.height > 2 ? ' class="lab-progress-wide"' : '')}<h3>${escape(film.title)}</h3><p>${escape(step.line)}</p><p class="lab-film-meta"><span>${duration(film.seconds)}</span> · <span>${escape(film.sound)}</span> · <code title="sha256 of the file">${escape(film.sha256.src.slice(0, 12))}</code></p><p class="lab-film-real"><strong>What is real here:</strong> ${escape(film.real)}</p><p class="lab-film-source">${filmSourceLine(film, record.engineMain)}</p><p class="lab-film-screened">${screened(film)}</p></li>`;
}

/** "How far it came": the steps in order, then the hero's own record (its source, cuts and screening). */
export function renderProgress(record, films, up = '../../') {
  const film = record.hero;
  return `<ol class="lab-films lab-progress">${record.steps.map(step => renderStep(step, record, films, up)).join('')}</ol><div class="lab-progress-record"><h3>Where the film at the top came from</h3><p class="lab-film-meta"><span>${duration(film.seconds)}</span> · <span>${escape(film.sound)}</span> · <code title="sha256 of the file">${escape(film.sha256.src.slice(0, 12))}</code></p><p class="lab-film-source">${filmSourceLine(film, record.engineMain)} ${escape(film.source.dropped)}</p><p class="lab-film-screened">${screened(film)}</p></div>`;
}
