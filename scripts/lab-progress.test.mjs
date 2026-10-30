import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFilms } from './lab-films.mjs';
import { PROGRESS_FILE, progressProblems, readProgress, renderProgress, renderProgressHero } from './lab-progress.mjs';
import { renderLabs } from './labs.mjs';

// Lab 01's progress record (lane showcase): the committed record, then one broken copy per rule.
const films = readFilms('site');
const committed = JSON.parse(readFileSync(join('site', PROGRESS_FILE), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const problems = record => progressProblems(record, PROGRESS_FILE, 'site', films).join('\n');

test('the committed progress record passes, with every file on disk pinned', () => {
  assert.equal(problems(committed), '');
  assert.equal(readProgress('site', films).hero.id, committed.hero.id);
});

test('a hero whose bytes differ from the recorded sha256 is refused (one flipped byte is enough)', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-progress-'));
  try {
    cpSync(join('site', 'assets/labs/agent-space/progress'), join(root, 'assets/labs/agent-space/progress'), { recursive: true });
    const file = join(root, committed.hero.src), bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(file, bytes);
    assert.match(progressProblems(committed, PROGRESS_FILE, root, films).join('\n'), /hero\/src: .* does not match its recorded sha256/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a source commit the record does not show as part of the engine\'s private main is refused', () => {
  const lane = clone(committed); lane.hero.source.commit = 'b'.repeat(40);
  assert.match(problems(lane), /hero\/source\/commit: bbbbbbbb is not shown as part of the engine's private main/);
  const still = clone(committed); still.steps[1].source.commit = 'c'.repeat(40);
  assert.match(problems(still), /steps\/1\/source\/commit: cccccccc is not shown/);
});

test('kept spans that do not add up to the film, or run backwards, are refused', () => {
  const short = clone(committed); short.hero.source.kept = [{ from: 0, to: 20 }];
  assert.match(problems(short), /hero\/source\/kept: the kept spans last 20\.00 s, the film 44 s/);
  const back = clone(committed); back.hero.source.kept = [{ from: 34.45, to: 54.8 }, { from: 0, to: 23.95 }];
  assert.match(problems(back), /kept\/1: starts before the span it follows ends/);
});

test('a screening record that does not cover the film, or did not pass, is refused', () => {
  const gap = clone(committed); gap.hero.screening.frames = gap.hero.screening.frames.slice(0, 3);
  assert.match(problems(gap), /hero\/screening\/frames: the last frame is at 10 s of a 44 s film/);
  const failed = clone(committed); failed.steps[1].screening.result = 'fail';
  assert.match(problems(failed), /steps\/1\/screening\/result: "fail", not "pass"/);
});

test('the first step is where the space started, and a step names only a film the films record carries', () => {
  const unknown = clone(committed); unknown.steps[0].film = 'no-such-film';
  assert.match(problems(unknown), /steps\/0\/film: no-such-film is not in the films record/);
  const first = clone(committed); first.steps = [first.steps[1], first.steps[0]]; first.steps[1].when = first.steps[0].when;
  assert.match(problems(first), /steps\/0: the first step is where the space started/);
});

test('page text is screened like a dispatch: a file path in a line is refused', () => {
  const path = clone(committed); path.hero.line = 'Rendered from /home/someone/films/cut.webm.';
  assert.match(problems(path), /hero/);
});

test('the hero says what in it is real and where it came from; the steps keep the first build first', () => {
  const hero = renderProgressHero(committed), steps = renderProgress(committed, films);
  assert.match(hero, new RegExp(`<source src="\\.\\./\\.\\./${committed.hero.src}"`));
  assert.match(hero, /What is real here:<\/strong> Each shot is labelled in the frame/);
  assert.match(steps, /^<ol class="lab-films lab-progress"><li class="lab-film lab-progress-step"><span class="technical">Where it started/);
  assert.match(steps, /In the engine's private repository: Private commit <code>d18c8237<\/code>/);
});

test('the published Lab 01 page and the home page play the record\'s hero', () => {
  const page = renderLabs('site')['labs/agent-space/index.html'];
  assert.match(page, /id="film-hq-on-duty"/);
  assert.match(page, /id="progress"/);
  const home = readFileSync('site/index.html', 'utf8');
  assert.ok(home.includes(`<source src="${committed.hero.src}"`), 'the home page plays the hero film');
  assert.ok(home.includes(`poster="${committed.hero.poster}"`), 'the home page shows the hero poster');
});
