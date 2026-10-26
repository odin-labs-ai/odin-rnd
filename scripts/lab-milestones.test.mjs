import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_QUOTE_WORDS, MILESTONES_FILE, PUBLIC_REPOS, STORY_PAGE, isPublicUrl, milestonesProblems, pinFor, pinProblems, readMilestones, renderBeats, renderMoments, renderStoryLink } from './lab-milestones.mjs';
import { renderLabs } from './labs.mjs';

// Lab 01's story gate (founder plans 1 and 2): public evidence only, short screened quotes, date order, AI reviewers
// labelled, bytes pinned. These run against a hand-made fixture (scripts/fixtures/milestones/), not the real record.
const FIXTURE = JSON.parse(readFileSync('scripts/fixtures/milestones/milestones.json', 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-10-26T12:00:00Z');
const problems = record => milestonesProblems(record, { root: 'site', now: NOW }).join('\n');
const reverse = text => [...text].reverse().join('');
const withBeat = fn => { const r = clone(FIXTURE); fn(r.beats[0], r); return problems(r); };
const withMoment = fn => { const r = clone(FIXTURE); fn(r.moments[0], r); return problems(r); };

test('the fixture passes: public evidence, screened words, date order, an AI reviewer labelled', () => {
  assert.equal(problems(FIXTURE), '');
});

test('evidence must be public: a private repository, an unknown proof id, a film moment past its end, a link elsewhere are refused', () => {
  assert.match(withBeat(b => { b.evidence = [{ kind: 'commit', repo: 'odin-labs-ai/private-engine', sha: 'a'.repeat(40) }]; }), /is not a public repository/);
  assert.match(withBeat(b => { b.evidence = [{ kind: 'pr', repo: 'odin-labs-ai/private-engine', number: 3 }]; }), /is not a public repository/);
  assert.match(withBeat(b => { b.evidence = [{ kind: 'proof', id: 'odin-000000-9', record: 'data/labs/agent-space/dispatches/session-2026-10-25-b.json' }]; }), /proof odin-000000-9 is not in/);
  assert.match(withBeat(b => { b.evidence = [{ kind: 'proof', id: 'odin-381dbb-1', record: 'data/labs/agent-space/dispatches/session-2026-01-01.json' }]; }), /is not a published dispatch/);
  assert.match(withBeat(b => { b.evidence = [{ kind: 'film', film: 'agent-space-tour', atSeconds: 9999 }]; }), /past the end of agent-space-tour/);
  assert.match(withBeat(b => { b.evidence = [{ kind: 'film', film: 'a-staged-demo', atSeconds: 1 }]; }), /is not a published film/);
  assert.match(withBeat(b => { b.evidence = [{ kind: 'url', url: 'https://example.com/proof' }]; }), /is not a public repository or this site/);
  assert.match(withBeat(b => { b.evidence = []; }), /evidence: shorter than|evidence: .*minItems|fewer than/i);
  for (const url of ['https://github.com/odin-labs-ai/odin-rnd/pull/81', 'https://odin-labs-ai.github.io/odin-rnd/labs/agent-space/']) assert.equal(isPublicUrl(url), true, url);
  for (const url of ['http://github.com/odin-labs-ai/odin-rnd', 'https://github.com/odin-labs-ai/odin-rnd-private', 'https://github.com/odin-labs-ai/odin-rnd/../x', 'https://odin-labs-ai.github.io/other/']) assert.equal(isPublicUrl(url), false, url);
});

test('every public repository counted as evidence is one the site already exports publicly', () => {
  const check = readFileSync('scripts/check.mjs', 'utf8');
  for (const repo of PUBLIC_REPOS) assert.ok(check.includes(`'${repo}'`), repo);
});

test('an internal field is refused by name, anywhere', () => {
  assert.match(withBeat(b => { b.postId = 'abc123'; }), /postId: not allowed/);
  assert.match(withMoment(m => { m.who.userId = 'u1'; }), /userId: not allowed/);
  assert.match(withBeat((b, r) => { r.producer.channel = 'odin-orq'; }), /channel: not allowed/);
  assert.match(withBeat(b => { b.evidence[0].lensRun = 'x'; }), /does not match|not allowed/);
});

test('quotes are at most 25 words, and every word passes the publisher screen and the world terms', () => {
  assert.match(withMoment(m => { m.quote = Array.from({ length: MAX_QUOTE_WORDS + 1 }, (_, i) => `word${i}`).join(' '); }), /quote: 26 words, over 25/);
  assert.match(withMoment(m => { m.quote = `Built at ${reverse('tfolemag')}.`; }), /quote: a restricted name/);
  assert.match(withBeat(b => { b.line = `We met in ${reverse('nrooH')} that week.`; }), /line: a place name/);
  assert.match(withBeat(b => { b.title = 'It cost €40 to run'; }), /title: a price or currency amount/);
  assert.match(withMoment(m => { m.why = 'Logged at /Users/someone/notes.md for later.'; }), /why: a file path or file name/);
});

test('beats and moments run in date order, and none is dated after the build', () => {
  assert.match(withBeat((b, r) => { r.beats[1].at = '2026-10-20T00:00:00Z'; }), /beats\/1\/at: .* comes before the beat above it/);
  assert.match(withBeat(b => { b.at = '2026-10-27T00:00:00Z'; }), /is after this build/);
  assert.match(withMoment(m => { m.at = '2027-01-01T00:00:00Z'; }), /moments\/0\/at: .* is after this build/);
  assert.match(withBeat(b => { b.at = '23 Oct 03:38'; }), /at: does not match/);
});

test('a review, reviewer, jury or judge is always labelled an AI model', () => {
  assert.match(withBeat(b => { b.line = 'The jury picked this build.'; }), /does not say it was an AI model/);
  assert.match(withBeat((b, r) => { delete r.beats[1].review; }), /beats\/1: it mentions|beats\/1: .*AI model/);
  assert.match(withMoment(m => { m.who = { label: 'the reviewer', kind: 'human' }; m.review = { by: 'a model', kind: 'ai-model' }; }), /who: a reviewer, jury or judge is an AI model here/);
  assert.match(withBeat((b, r) => { r.beats[1].review.kind = 'human'; }), /review\/kind: must be "ai-model"/);
  const html = renderBeats(FIXTURE);
  assert.match(html, /Reviewed by an AI model \(an adversarial code reviewer\), not a human\./);
});

test('the bytes are pinned: an edit after production, or a pin without its sources, is refused', () => {
  const bytes = Buffer.from(JSON.stringify(FIXTURE));
  const pin = pinFor(bytes, { sourceSha256: 'b'.repeat(64), commit: 'c'.repeat(40) });
  assert.deepEqual(pinProblems(bytes, pin), []);
  assert.match(pinProblems(Buffer.from(`${bytes} `), pin).join(), /the file was edited after it was produced/);
  assert.match(pinProblems(bytes, { ...pin, commit: 'main' }).join(), /commit is not a 40-hex commit/);
  assert.match(pinProblems(bytes, null).join(), /missing, or not odin-milestones-pin v1/);
});

test('a picture must be one this lab already publishes', () => {
  assert.match(withBeat(b => { b.asset = 'assets/labs/agent-space/films/missing.png'; }), /asset: .* is not published/);
  assert.match(withBeat(b => { b.asset = 'assets/odin-logo.png'; }), /asset: not under this lab's published assets/);
});

// A site root holding the real site plus the fixture record, its pin and the story page template.
function storySite() {
  const root = mkdtempSync(join(tmpdir(), 'lab-story-'));
  cpSync('site', root, { recursive: true });
  const bytes = readFileSync('scripts/fixtures/milestones/milestones.json');
  writeFileSync(join(root, MILESTONES_FILE), bytes);
  mkdirSync(join(root, 'labs/agent-space/story'), { recursive: true });
  writeFileSync(join(root, STORY_PAGE), readFileSync('scripts/fixtures/milestones/story-index.html'));
  return { root, pin: pinFor(bytes, { sourceSha256: 'b'.repeat(64), commit: 'c'.repeat(40) }) };
}

test('with a record, Lab 01 links its story page, and the page shows every beat and moment with its evidence', () => {
  const { root, pin } = storySite();
  try {
    assert.ok(readMilestones(root, { now: NOW, pin }));
    assert.throws(() => readMilestones(root, { now: NOW, pin: { ...pin, fileSha256: '0'.repeat(64) } }), /Lab 01 story refused:[\s\S]*edited after it was produced/);
    const html = renderMoments(FIXTURE) + renderBeats(FIXTURE);
    for (const b of FIXTURE.beats) assert.ok(html.includes(`id="beat-${b.id}"`), b.id);
    for (const m of FIXTURE.moments) assert.ok(html.includes(`<blockquote><p>${m.quote}</p></blockquote>`), m.id);
    assert.match(html, /<a href="https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/pull\/81">odin-rnd #81<\/a>/);
    assert.match(html, /<a href="\.\.\/#session-2026-10-25-b">proof <code>odin-381dbb-1<\/code><\/a>/);
    assert.match(html, /<a href="\.\.\/#film-agent-space-tour">the film, at 0:20<\/a>/);
    assert.match(renderStoryLink(FIXTURE), /<a class="button" href="story\/">Read the story<\/a>/);
    assert.equal(renderStoryLink(null), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the story page template never ships without its record', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-story-none-'));
  try {
    cpSync('site', root, { recursive: true });
    mkdirSync(join(root, 'labs/agent-space/story'), { recursive: true });
    writeFileSync(join(root, STORY_PAGE), readFileSync('scripts/fixtures/milestones/story-index.html'));
    assert.throws(() => renderLabs(root), /the story page ships without its record/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
