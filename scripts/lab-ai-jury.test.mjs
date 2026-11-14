import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changes, JURY_PIN, JURY_RECORD, JURY_TEMPLATE, juryProblems, median, pageLeaks, readAiJury, recordHashes, renderAbout, renderAiJury, renderIntro, score, words } from './lab-ai-jury.mjs';
import { renderLabs } from './labs.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';
import { namesRestricted } from './lab-dispatch-publish.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

// Lab 14, "Can an AI jury judge how a room looks?" (scripts/lab-ai-jury.mjs). DATA ONLY: the page is worth publishing
// only if its medians are the jurors', its jurors are named as AI, its gate is the rubric's rule, and it shows no
// picture, no money and no word of the talk's client theme; these tests hold it to that, and to the leak screen.
const raw = readFileSync(join('site', JURY_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[JURY_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');

test('Lab 14 renders, sits on the Labs index right after Lab 13 and is in the sitemap', () => {
  assert.ok(page, 'labs/ai-jury/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab13 = index.indexOf('aria-labelledby="lab-tile-measured-blind"'), lab14 = index.indexOf('aria-labelledby="lab-tile-ai-jury"');
  assert.ok(lab13 >= 0 && lab14 > lab13, 'Lab 14 follows Lab 13');
  assert.doesNotMatch(index.slice(lab13, lab14), /aria-labelledby="lab-tile-(?!measured-blind)/, 'no other tile between them');
  assert.match(index, /<span class="technical">LAB 14<\/span><h2 id="lab-tile-ai-jury">Can an AI jury judge how a room looks\?<\/h2>/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/ai-jury/</loc>'));
});

test('the medians reproduce: 3.857 with four jurors, then 4.0 with three, each the median of the rooms\' medians', () => {
  const [a, b] = record.rounds;
  assert.equal(a.median, 3.857);
  assert.equal(b.median, 4);
  assert.deepEqual([a.jury.length, b.jury.length], [4, 3]);
  for (const round of record.rounds) {
    assert.equal(round.rooms.length, 11);
    assert.equal(Math.round(median(round.rooms.map(r => r.median)) * 1000) / 1000, round.median);
    for (const room of round.rooms) {
      assert.ok(Math.abs(median(Object.values(room.by)) - room.median) <= 0.0011, `${round.round} ${room.label}: the median of its jurors`);
      assert.equal(room.n, Object.keys(room.by).length);
    }
  }
  const text = textOf(main);
  assert.match(text, /the jury's median was 3\.857 out of 10 the first time and 4\.0 the second, with four jurors and then three\./);
  assert.match(text, /The median of the rooms 3\.857 4\.0 \+0\.143/);
  assert.equal(Math.max(...changes(record).map(Math.abs)), 0.572);
  assert.match(text, /Every juror that could score our calibration pair told a good picture from a deliberately ruined one\./);
  // That sentence is computed: a record where a scoring juror failed the gate reads otherwise.
  const r = clone(); const x = r.rounds[0].reviewers[2]; x.bad = 4.5; x.margin = 0.643; x.passes = false; r.rounds[0].jury = r.rounds[0].jury.filter(id => id !== x.id);
  assert.doesNotMatch(textOf(renderIntro(r)), /Every juror that could score/);
});

test('the calibration gate: a juror passes exactly when good minus bad is at least 1.5; the dropped juror and why', () => {
  for (const round of record.rounds) for (const r of round.reviewers) assert.equal(r.passes, r.margin !== null && r.margin >= record.rubric.minMargin, `${round.round} ${r.id}`);
  const d = record.rounds[1].reviewers.find(r => r.id === 'jury-d');
  assert.deepEqual([d.good, d.margin, d.passes, d.unreadable], [null, null, false, [{ picture: 'good', replies: 2 }]]);
  // The two round-1 rooms scored by three of four jurors name the juror whose replies were unreadable.
  assert.deepEqual(record.rounds[0].rooms.filter(r => r.n === 3).map(r => [r.label, r.unreadable.length]), [['room 5', 1], ['room 9', 1]]);
  assert.ok(record.rounds[0].jury.includes('jury-d') && !record.rounds[1].jury.includes('jury-d'));
  assert.match(textOf(main), /In round 2, Qwen3\.8 Flash \(Qwen\) was out\. It gave no usable score for the good picture: its two replies on it could not be read, so it had no margin, and the gate took it off the jury\./);
  const fixture = main.match(/<div class="lab-panel jury-fixture" id="calibration-pair">[\s\S]*?<\/div>/)[0];
  assert.match(fixture, /<p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US<\/p>/);
  assert.match(textOf(fixture), /The calibration pair is ours: a known-good reference picture we rendered, and the same picture deliberately ruined\./);
});

test('the jurors are AI models, said in the marked box', () => {
  const judge = main.match(/<div class="lab-panel jury-judge" id="judge">[\s\S]*?<\/div>/)[0];
  assert.match(judge, /<p class="technical">A SEPARATE AI REVIEWER, NOT A HUMAN<\/p>/);
  assert.match(textOf(judge), /Every score on this page is an AI model's\. No person scored a picture\./);
  for (const r of record.rounds[0].reviewers) assert.ok(judge.includes(r.model), r.model);
});

test('data only: no picture, no money, no spend field, no client-theme word, no reason or rubric wording', () => {
  assert.doesNotMatch(main, /<(img|picture|video|svg|source|iframe)\b|\.(png|jpe?g|webp|gif)\b|url\(/i, 'no picture in the page content');
  for (const [name, text] of [['page', main], ['record', raw], ['tile', readFileSync('site/data/labs/ai-jury-tile.json', 'utf8')]]) {
    assert.doesNotMatch(text, /usd|spend|\$|€|cost (of|was) \d/i, `${name}: money`);
    assert.doesNotMatch(text, /bank|lender|hypothe/i, `${name}: the client theme`);
    assert.ok(!namesRestricted(text), `${name}: a restricted name (the client theme)`);
    assert.doesNotMatch(text, /talk-s\d|deck-s\d|The Arrival|The Rogue Agent|\bseed\b|blind_key|"reasons?"|fix_first/i, `${name}: a room name, a shot id, a seed, a key or a reason`);
  }
  assert.doesNotMatch(raw, /"usd"|"seed"|"raw"|"fix_list"|"prompt"/);
});

test('the lane-only rounds are named as left out, and the rooms as not reworked but photographed again', () => {
  assert.deepEqual(record.excluded.map(e => e.round), ['2b', '2c']);
  assert.match(textOf(main), /Round 2b: run on a lane only, never on the private main\. Not shown, not counted\./);
  assert.match(textOf(main), /Round 2c: run on a lane only, never on the private main\. Not shown, not counted\./);
  assert.match(textOf(main), /none was reworked between the rounds, but each was photographed again for round two/);
  assert.doesNotMatch(textOf(main), /plateau/i, 'the multi-round plateau is lane-only and never claimed');
});

test('every private commit is cited the kit\'s way, as part of the private main', () => {
  const mc = record.vendored.mainCheck;
  for (const c of record.vendored.cites) assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  for (const f of record.vendored.files) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
});

test('leak screen: the page, the record and the tile pass; the scripts name no restricted name', () => {
  assert.deepEqual(pageLeaks(page, recordHashes(record)), []);
  assert.deepEqual(juryProblems(record), []);
  for (const file of ['scripts/lab-ai-jury.mjs', 'scripts/vendor-ai-jury.mjs', 'scripts/schemas/odin-lab-ai-jury.schema.json', 'site/data/labs/ai-jury-tile.json']) {
    assert.deepEqual(screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name')), [], file);
  }
});

test('the screen catches each class it guards, on the page and in the record (the test of the test)', () => {
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  for (const [what, inject, reason] of [
    ['a local path', '/Users/someone/x', /machine path/],
    ['a host and port', 'served on localhost:8080', /local host/],
    ['an IP address', 'from 10.0.0.12', /local host/],
    ['a client name (the talk theme)', `a ${SYN_THEME} lender`, /restricted name/],
    ['a private repository name', 'odin-labs-ai/some-private-repo', /another repository/],
    ['a credential', credential, /credential/],
    ['a money figure', 'it cost €40', /price or currency/],
  ]) {
    assert.ok(pageLeaks(`<main><p>${inject}</p></main>`).some(p => reason.test(p)), `page: ${what}`);
    const r = clone();
    r.rooms = `${r.rooms}, ${inject}`;
    assert.ok(juryProblems(r).some(p => reason.test(p) || /restricted|file path|link/.test(p)), `record: ${what}`);
  }
  // A picture smuggled into the template is refused by the build.
  const root = mkdtempSync(join(tmpdir(), 'lab-ai-jury-img-'));
  try {
    for (const file of [JURY_RECORD, JURY_PIN, JURY_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    writeFileSync(join(root, JURY_TEMPLATE), readFileSync(join('site', JURY_TEMPLATE), 'utf8').replace('<!--JURY_ROOMS-->', '<!--JURY_ROOMS--><img src="room.jpg" alt="">'));
    assert.throws(() => renderAiJury(root), /carries a picture/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(juryProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.rounds[0].rooms[0].median = 4.5; }, /not the median of its jurors' scores/);
  refused(r => { r.rounds[1].median = 3.9; }, /not the median of its rooms' medians/);
  refused(r => { r.rounds[0].rooms[0].n = 2; }, /not the number of jurors' scores/);
  refused(r => { r.rounds[1].rooms[0].by['jury-d'] = 9; }, /a score by a model outside this round's jury/);
  refused(r => { r.rounds[1].reviewers.find(x => x.id === 'jury-d').passes = true; }, /not the rubric's rule/);
  refused(r => { r.rounds[1].jury.push('jury-d'); }, /not the cloud reviewers that passed the calibration/);
  refused(r => { r.rounds[1].reviewers.find(x => x.id === 'jury-d').unreadable = []; }, /a missing calibration score must have unreadable replies behind it/);
  refused(r => { r.rounds[0].reviewers[0].margin = 9; }, /not good minus bad/);
  refused(r => { r.rounds[0].valid = false; }, /valid rounds only/);
  refused(r => { r.rounds[1].rooms.pop(); }, /not the same rooms as round 1/);
  refused(r => { r.rooms = 'eleven rooms, reworked between the rounds'; }, /not reworked but photographed again/);
  refused(r => { r.calibrationPair = 'two pictures found online'; }, /a fixture we made/);
  refused(r => { r.blinding = 'each juror saw the room name; not blind'; }, /judged blind/);
  refused(r => { r.rounds[0].usd = 0.2; }, /does not match odin-lab-ai-jury v1/);
  refused(r => { r.rounds[0].rooms[0].name = 'The Arrival'; }, /does not match odin-lab-ai-jury v1/);
  refused(r => { r.vendored.cites[0].commit = 'f'.repeat(40); }, /a commit only on a lane is never cited/);
  refused(r => { r.rounds[0].on = '2099-01-01'; }, /after this build/);
  refused(r => { r.excluded = r.excluded.slice(0, 1); }, /must name exactly those/);
  refused(r => { r.excluded[1].why = 'not interesting'; }, /must name exactly those/);
  refused(r => { r.excluded = []; }, /does not match odin-lab-ai-jury v1/);
  refused(r => { r.rounds[0].rooms[4].unreadable = []; }, /not exactly the round's jury/);
  refused(r => { r.rounds[0].rooms[0].unreadable = ['jury-d']; }, /not exactly the round's jury/);
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-ai-jury-'));
  try {
    for (const file of [JURY_RECORD, JURY_PIN, JURY_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readAiJury(root).rounds.length, 2);
    assert.equal(renderAiJury(root).pages[JURY_TEMPLATE], page, 'a fixture with the same files renders the same page');
    writeFileSync(join(root, JURY_RECORD), raw.replace('"minJury": 3', '"minJury": 3 '));
    assert.throws(() => readAiJury(root), /record\.sha256: does not pin the sha256/);
    const changed = raw.replace('"minJury": 3', '"minJury": 2');
    writeFileSync(join(root, JURY_RECORD), changed);
    writeFileSync(join(root, JURY_PIN), `${sha256(changed)}  record.json\n`);
    assert.doesNotThrow(() => readAiJury(root));
    assert.equal(readFileSync(join('site', JURY_PIN), 'utf8'), `${sha256(raw)}  record.json\n`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('"What it is." opens the page right after the hero: plain words, then how it works, every count the record\'s, the jurors AI', () => {
  const about = main.match(/<section[^>]*id="about"[\s\S]*?<\/section>/)?.[0];
  assert.ok(about, 'the page has a What it is section');
  const hero = main.indexOf('</section>'), at = main.indexOf('id="about"'), next = main.indexOf('<section', hero);
  assert.ok(at > hero && main.lastIndexOf('<section', at) === next, 'the first section after the hero');
  assert.ok(at < main.indexOf('id="jurors"'), 'before the jurors');
  assert.match(about, /<figure class="lab-flow">/);
  const text = textOf(about), rooms = record.rounds[0].rooms.length;
  assert.ok(text.includes(`How it works: ${rooms} rooms, scored blind by an AI jury in ${record.rounds.length} rounds`));
  assert.ok(text.includes(`One rubric, ${record.rubric.criteria.length} criteria`));
  assert.ok(text.includes(`by at least ${score(record.rubric.minMargin)} points`));
  assert.ok(text.includes(`single rooms moved by up to ${score(Math.max(...changes(record).map(Math.abs)))}`));
  for (const round of record.rounds) {
    const asked = round.reviewers.filter(r => r.kind === 'cloud');
    assert.ok(text.includes(`Round ${round.round}: ${asked.length} AI models tried for the jury`), `round ${round.round}: tried`);
    assert.ok(text.includes(`${round.jury.length} of ${asked.length} passed`), `round ${round.round}: passed`);
    assert.ok(text.includes(`${round.jury.length} jurors score the ${rooms} rooms`), `round ${round.round}: jurors`);
    assert.ok(text.includes(`The median of the rooms: ${score(round.median)} out of 10`), `round ${round.round}: median`);
    // The verdict a reader takes away: the round counts, by the jury's own margin on the pair, in the good tone.
    assert.ok(text.includes(`the jury ranked the pair by ${score(round.juryMargin)}, so the round counts`), `round ${round.round}: the verdict sentence`);
    assert.ok(about.includes(`lab-flow-good"><strong>The median of the rooms: ${score(round.median)} out of 10</strong><span>the jury ranked the pair by ${score(round.juryMargin)}, so the round counts`), `round ${round.round}: the verdict box is good`);
    // A juror taken off for a missing score: the box names the picture the record says it could not read, and only it.
    for (const r of asked.filter(r => !round.jury.includes(r.id) && r.margin === null)) {
      const pictures = ['good', 'bad'].filter(k => r[k] === null).map(k => (k === 'good' ? 'good' : 'ruined'));
      assert.ok(pictures.length && r.unreadable.length === pictures.length, `${r.model}: the record names the unread picture`);
      assert.ok(text.includes(`${r.model} gave no usable score for the ${pictures.join(' and the ')} picture${pictures.length > 1 ? 's' : ''} and was taken off`), `${r.model}: the unread picture`);
      for (const k of ['good', 'bad'].filter(k => r[k] !== null)) assert.ok(!text.includes(`${r.model} gave no usable score for the ${k === 'good' ? 'good' : 'ruined'}`), `${r.model} did score the ${k} picture`);
    }
  }
  // The prose: every number a reader takes away, recomputed from the record.
  const [a, b] = [record.rounds[0], record.rounds.at(-1)];
  assert.ok(text.includes(`The rooms are ${words(rooms)} rooms of a 3D presentation space`), 'rooms in words');
  assert.ok(text.includes(`on one rubric of ${words(record.rubric.criteria.length)} criteria`), 'criteria in words');
  assert.ok(text.includes(`We did this in ${words(record.rounds.length)} rounds`), 'rounds in words');
  assert.ok(text.includes(`The median of the rooms was ${score(a.median)} out of 10 the first time and ${score(b.median)} the second, with ${words(a.jury.length)} jurors and then ${words(b.jury.length)};`), 'medians and jury sizes, in order');
  assert.ok(text.includes(`Only these ${words(record.rounds.length)} rounds are shown.`), 'rounds shown');
  const left = record.excluded.map(e => e.round).join(' and ');
  assert.ok(text.includes(`${words(record.excluded.length)[0].toUpperCase()}${words(record.excluded.length).slice(1)} more rounds, ${left}, are left out: they ran on a lane only, never on the private main.`), 'the left-out rounds, named');
  assert.match(text, /the jurors are AI models, not people: no person scored a picture\./);
  assert.match(text, /a pair we made ourselves/);
  // The jurors are never people, and the lane-only rounds and the plateau are never counted or claimed.
  assert.doesNotMatch(text, /\bhuman (juror|judge|panel|review)|\b(judged|scored|rated) by (a person|people|humans?)\b|plateau/i);
  assert.doesNotMatch(text.replaceAll('not people', '').replaceAll('no person scored a picture', ''), /\b(person|people|human)/i, 'people appear only to say none scored');
  // The outcome tone comes from the record and fails closed: break ONE condition at a time; each alone makes the round
  // void, in the bad tone, and the box names that condition and no other. The untouched round still counts.
  const voided = (mutate, reason) => {
    const r = clone(); mutate(r);
    const flow = renderAbout(r), last = r.rounds[1], first = r.rounds[0];
    const box = `<strong>The median of the rooms: ${score(last.median)} out of 10</strong><span>`;
    assert.ok(flow.includes(`lab-flow-bad">${box}${reason}, so the round is void</span>`), `void for: ${reason}`);
    assert.ok(!flow.includes(`lab-flow-good">${box}`), `not good when: ${reason}`);
    assert.ok(flow.includes(`lab-flow-good"><strong>The median of the rooms: ${score(first.median)} out of 10</strong><span>the jury ranked the pair by ${score(first.juryMargin)}, so the round counts`), 'the other round still counts');
    return textOf(flow);
  };
  voided(r => { r.rounds[1].juryMargin = 1; }, `the jury ranked the pair by only ${score(1)}, less than the ${score(record.rubric.minMargin)} needed`);
  voided(r => { r.rounds[1].valid = false; }, 'the record marks the round as not valid');
  voided(r => { r.rounds[1].juryMargin = null; }, 'the jury has no margin on the pair');
  const short = voided(r => { r.rounds[1].reviewers[2].margin = 1.2; r.rounds[1].jury = r.rounds[1].jury.filter(id => id !== 'jury-c'); }, `only ${words(record.rounds[1].jury.length - 1)} jurors passed, fewer than the ${words(record.rubric.minJury)} needed`);
  assert.match(short, /Gemini 3\.8 Flash \(Google\) ranked the pair by only 1\.2 and was taken off/);
  assert.doesNotMatch(about, /<(img|picture|svg|video)\b|€|\$/);
});
