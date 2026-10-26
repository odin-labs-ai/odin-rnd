import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_QUOTE_WORDS, MILESTONES_FILE, PUBLIC_REPOS, STORY_PAGE, isPublicUrl, milestonesProblems, pinFor, pinProblems, readMilestones, renderBeats, renderMoments, renderStoryLink, tierOf } from './lab-milestones.mjs';
import { renderLabs } from './labs.mjs';

// Lab 01's story gate (founder plans 1 and 2): evidence in one of two tiers, short screened quotes, date order, AI
// reviewers labelled in the same sentence, counts reconciled, bytes pinned. These run against a hand-made fixture
// (scripts/fixtures/milestones/), in the producer's shape, not the real record.
const FIXTURE = JSON.parse(readFileSync('scripts/fixtures/milestones/milestones.json', 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-10-26T12:00:00Z');
const problems = record => milestonesProblems(record, { root: 'site', now: NOW }).join('\n');
const reverse = text => [...text].reverse().join('');
const at = i => fn => { const r = clone(FIXTURE); fn(r.records[i], r); return problems(r); };
const tier2 = at(0), dispatch = at(1), moment = at(2), correction = at(3), films = at(4);

test('the fixture passes: both tiers, screened words, date order, AI reviews labelled', () => {
  assert.equal(problems(FIXTURE), '');
});

test('tier 1 evidence must be public and resolve here: a private repo, a link naming another PR, an unknown proof, a missing page are refused', () => {
  assert.match(dispatch(r => { r.evidence = [{ type: 'pr', number: 3, url: 'https://github.com/odin-labs-ai/private-engine/pull/3' }]; }), /is not a public repository or this site/);
  assert.match(dispatch(r => { r.evidence[0].number = 79; }), /the link is not PR #79 of odin-labs-ai\/odin-rnd/);
  assert.match(dispatch(r => { r.evidence = [{ type: 'commit', sha: 'a'.repeat(40), url: 'https://github.com/odin-labs-ai/odin-rnd/commit/' + 'b'.repeat(40) }]; }), /the link is not commit a{40}/);
  assert.match(dispatch(r => { r.evidence[1].id = 'odin-000000-9'; }), /proof odin-000000-9 is not shown by any published dispatch/);
  assert.match(films(r => { r.evidence[1].url = 'https://odin-labs-ai.github.io/odin-rnd/assets/labs/agent-space/films/staged-demo.webm'; }), /does not resolve to anything this site or repository publishes/);
  assert.match(films(r => { r.evidence[1].url = 'https://github.com/odin-labs-ai/odin-rnd/blob/main/scripts/no-such-file.mjs'; }), /does not resolve/);
  assert.match(films(r => { r.evidence[1].url = 'https://example.com/proof'; }), /is not a public repository or this site/);
  assert.match(dispatch(r => { r.evidence = []; }), /evidence: /);
  for (const url of ['https://github.com/odin-labs-ai/odin-rnd/pull/81', 'https://odin-labs-ai.github.io/odin-rnd/labs/agent-space/']) assert.equal(isPublicUrl(url), true, url);
  for (const url of ['http://github.com/odin-labs-ai/odin-rnd', 'https://github.com/odin-labs-ai/odin-rnd-private', 'https://github.com/odin-labs-ai/odin-rnd/../x', 'https://odin-labs-ai.github.io/other/']) assert.equal(isPublicUrl(url), false, url);
});

test('every public repository counted as evidence is one the site already exports publicly', () => {
  const check = readFileSync('scripts/check.mjs', 'utf8');
  for (const repo of PUBLIC_REPOS) assert.ok(check.includes(`'${repo}'`), repo);
});

test('tier 2: a private commit is cited by hash only with a full sha and the checked main head, and never with a repo name or path', () => {
  assert.equal(tierOf(FIXTURE.records[0]), 2);
  assert.equal(tierOf(FIXTURE.records[1]), 1);
  assert.match(tier2(r => { r.evidence[0].sha = 'f'.repeat(8); }), /does not match/);
  assert.match(tier2(r => { r.evidence[0].repo = 'odin-labs-ai/private-engine'; }), /does not match|not allowed/);
  assert.match(tier2(r => { r.evidence[0].path = 'engine/agents/space.py'; }), /does not match|not allowed/);
  assert.match(tier2(r => { r.evidence[0].onMain = 'd'.repeat(40); }), /onMain: a private commit must name the main head it was checked against/);
  assert.match(tier2((r, rec) => { delete rec.mainCheck; }), /a private commit is cited by hash, but the record has no mainCheck/);
  const html = renderBeats(FIXTURE);
  assert.ok(html.includes(`Private commit <code>${'f'.repeat(8)}</code>, cited by hash; this page cannot check it, anyone with access can.`));
  assert.match(html, /<span class="story-tier story-tier-2">Cited by hash<\/span>/);
  assert.match(html, /<span class="story-tier story-tier-1">Checkable here<\/span>/);
});

test('an internal field is refused by name, anywhere', () => {
  assert.match(dispatch(r => { r.postId = 'abc123'; }), /postId: not allowed/);
  assert.match(dispatch((r, rec) => { rec.channel = 'odin-orq'; }), /channel: not allowed/);
  assert.match(dispatch(r => { r.evidence[0].author = 'someone'; }), /does not match|not allowed/);
});

test('quotes are at most 25 words, and every word passes the publisher screen and the world terms', () => {
  assert.match(moment(r => { r.quote = Array.from({ length: MAX_QUOTE_WORDS + 1 }, (_, i) => `word${i}`).join(' '); }), /quote: 26 words, over 25/);
  assert.match(moment(r => { r.quote = `Built at ${reverse('tfolemag')}.`; }), /quote: a restricted name/);
  assert.match(dispatch(r => { r.body = `We met in ${reverse('nrooH')} that week.`; }), /body: a place name/);
  assert.match(dispatch(r => { r.title = 'It cost €40 to run'; }), /title: a price or currency amount/);
  assert.match(moment(r => { r.body = 'Logged at /Users/someone/notes.md for later.'; }), /body: a file path or file name/);
});

test('records run in date order, inside the window, and none is dated after the build', () => {
  assert.match(dispatch(r => { r.at = '2026-10-23T00:00:00Z'; }), /comes before the record above it|outside the record's window/);
  assert.match(films(r => { r.at = '2026-10-27T00:00:00Z'; }), /is after this build/);
  assert.match(films(r => { r.at = '2026-10-26T00:00:00Z'; }), /outside the record's window/);
  assert.match(dispatch(r => { r.at = '25 Oct 08:40'; }), /at: does not match/);
});

test('a review, reviewer, jury, judge or advocate is called AI in the same sentence', () => {
  assert.match(correction(r => { r.body = 'The review caught an overstated headline.'; }), /without saying, in the same sentence, that it is AI/);
  assert.match(moment(r => { r.quote = 'Neither reviewer opened the files.'; }), /quote: a review, reviewer/);
  assert.match(dispatch(r => { r.body = 'The jury picked this build. It was AI.'; }), /without saying, in the same sentence/);
  assert.equal(correction(r => { r.body = 'The AI review caught it. Both AI model advocates agreed.'; }), '');
});

test('the counts reconcile with the records, and the page states the tally plainly', () => {
  assert.match(dispatch((r, rec) => { rec.counts.beat = 4; }), /counts\/beat: 4, but the record holds 3/);
  assert.match(dispatch((r, rec) => { delete rec.counts.leftOut; }), /missing leftOut/);
  assert.match(renderBeats(FIXTURE), /<p class="story-tally">3 steps checkable here, 1 cited by hash, 1 left out for having no evidence\.<\/p>/);
  assert.match(renderMoments(FIXTURE), /<p class="story-tally">1 moments checkable here, 0 cited by hash, 0 left out/);
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
  assert.match(dispatch(r => { r.visual = 'assets/labs/agent-space/films/missing.png'; }), /visual: .* is not published/);
  assert.match(dispatch(r => { r.visual = 'assets/odin-logo.png'; }), /visual: not under this lab's published assets/);
});

test('with a record, Lab 01 links its story page, and the page shows every record with its evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-story-'));
  try {
    cpSync('site', root, { recursive: true });
    const bytes = readFileSync('scripts/fixtures/milestones/milestones.json');
    writeFileSync(join(root, MILESTONES_FILE), bytes);
    mkdirSync(join(root, 'labs/agent-space/story'), { recursive: true });
    if (!existsSync(join(root, STORY_PAGE))) writeFileSync(join(root, STORY_PAGE), readFileSync('scripts/fixtures/milestones/story-index.html'));
    const pin = pinFor(bytes, { sourceSha256: 'b'.repeat(64), commit: 'c'.repeat(40) });
    assert.ok(readMilestones(root, { now: NOW, pin }));
    assert.throws(() => readMilestones(root, { now: NOW, pin: { ...pin, fileSha256: '0'.repeat(64) } }), /Lab 01 story refused:[\s\S]*edited after it was produced/);
    const html = renderBeats(FIXTURE) + renderMoments(FIXTURE);
    for (const r of FIXTURE.records) assert.ok(html.includes(`id="${r.id}"`), r.id);
    assert.match(html, /<span class="story-correction">Correction<\/span>/);
    assert.match(html, /<blockquote><p>How do you know\?<\/p><\/blockquote>/);
    assert.match(html, /<a href="https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/pull\/81">odin-rnd #81<\/a>/);
    assert.match(html, /proof <code>odin-381dbb-1<\/code>/);
    assert.match(renderStoryLink(FIXTURE), /<a class="button" href="story\/">Read the story<\/a>/);
    assert.equal(renderStoryLink(null), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the story page template never ships without its record', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-story-none-'));
  try {
    cpSync('site', root, { recursive: true });
    rmSync(join(root, MILESTONES_FILE), { force: true });
    mkdirSync(join(root, 'labs/agent-space/story'), { recursive: true });
    writeFileSync(join(root, STORY_PAGE), readFileSync('scripts/fixtures/milestones/story-index.html'));
    assert.throws(() => renderLabs(root), /the story page ships without its record/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
