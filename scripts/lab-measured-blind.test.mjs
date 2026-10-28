import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLIND_PIN, BLIND_RECORD, BLIND_TEMPLATE, blindProblems, pageLeaks, readMeasuredBlind, recordHashes, recount, renderIntro, renderMeasuredBlind } from './lab-measured-blind.mjs';
import { renderLabs } from './labs.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';
import { addScreenNames, namesRestricted } from './lab-dispatch-publish.mjs';
// Synthetic restricted names, added to the screen for these tests: a real one is never spelled in this public repo.
addScreenNames('zarquon', 'zarquonbank', 'zarquonbanks');

// Lab 13, "Does an agent company get better, measured blind?" (scripts/lab-measured-blind.mjs). The page is only worth
// publishing if it says who judged (an AI), what one side of a set is (18 verdicts, not 9 items), and recounts what was
// committed rather than claiming more; these tests hold it to that, and to the leak screen.
const raw = readFileSync(join('site', BLIND_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[BLIND_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');
const set = id => record.sets.find(s => s.id === id);

test('Lab 13 renders, sits on the Labs index after Lab 05 and is in the sitemap', () => {
  assert.ok(page, 'labs/measured-blind/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab05 = index.indexOf('aria-labelledby="lab-tile-rogue"'), lab13 = index.indexOf('aria-labelledby="lab-tile-measured-blind"');
  assert.ok(lab05 >= 0 && lab13 > lab05, 'Lab 13 follows Lab 05');
  assert.match(index, /<span class="technical">LAB 13<\/span><h2 id="lab-tile-measured-blind">Does an agent company get better, measured blind\?<\/h2>/);
  assert.match(index, /<a href="\.\.\/labs\/measured-blind\/index\.html">/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/measured-blind/</loc>'));
});

test('the recount reproduces the committed summary: useful 2 to 10, 3 to 5 and 4 to 12, each side 18 verdicts', () => {
  // The committed summary's counts (the vendor refuses unless the per-item labels, the verdict files and the summary
  // agree; scripts/vendor-measured-blind.mjs --verify re-derives the record from the private main).
  const summary = {
    tuning: { before: { useful: 2, partly: 10, wrong: 5, stuck: 1 }, after: { useful: 10, partly: 5, wrong: 1, stuck: 2 } },
    heldout1: { before: { useful: 3, partly: 10, wrong: 5, stuck: 0 }, after: { useful: 5, partly: 9, wrong: 4, stuck: 0 } },
    heldout2: { before: { useful: 4, partly: 12, wrong: 2, stuck: 0 }, after: { useful: 12, partly: 4, wrong: 2, stuck: 0 } },
  };
  for (const [id, arms] of Object.entries(summary)) {
    for (const [arm, counts] of Object.entries(arms)) {
      assert.deepEqual(recount(set(id), arm), counts, `${id} ${arm}: recounted from the per-item labels`);
      assert.deepEqual(set(id).counts[arm], counts, `${id} ${arm}: the record's counts`);
      assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 18, `${id} ${arm}: 18 verdicts`);
    }
    assert.equal(set(id).items.length, 9);
    assert.ok(set(id).items.every(item => item.before.length === 2 && item.after.length === 2), `${id}: two runs per item and arm`);
  }
  const text = textOf(main);
  assert.match(text, /useful answers went from 2 of 18 to 10 of 18\. On nine items held out from the fixing, from 3 of 18 to 5 of 18; on nine fresh ones, judged on the next version, from 4 of 18 to 12 of 18\./);
});

test('the denominator is printed: 18 verdicts a side, nine items answered twice, never nine', () => {
  const text = textOf(main);
  assert.match(text, /Each side of a set is 18 verdicts, not 9: nine items, each answered twice\./);
  assert.match(text, /Each row is 18 verdicts: nine items, each answered twice\./);
  assert.doesNotMatch(text, /useful (on|in) \d of 9 items/, 'no count is given over nine items');
});

test('the page says the tuning set gained more than held-out set one, and that sentence follows the record', () => {
  assert.match(textOf(main), /The set the fixes were made on gained more than the first held-out set: 8 useful answers against 2\./);
  assert.match(textOf(main), /Tuning against held-out set one\. The set the fixes were made on gained more than the first held-out set: 8 against 2\./);
  // The comparison is computed, never the record's: a record where held-out one gained more reads that way.
  const r = clone();
  r.sets[1].counts.after.useful = 13;
  assert.match(textOf(renderIntro(r)), /gained less than the first held-out set: 8 useful answers against 10/);
});

test('the judge is an AI and the page says so, in the marked box; the blinding is partial and said', () => {
  const judge = main.match(/<div class="lab-panel blind-judge" id="judge">[\s\S]*?<\/div>/)[0];
  assert.match(judge, /<p class="technical">A SEPARATE AI REVIEWER, NOT A HUMAN<\/p>/);
  assert.match(textOf(judge), /a separate Claude session, which judged every answer against its own source\. It is not a human's verdict\./);
  assert.match(textOf(judge), /the blinding is partial, because the shape of a tool's reply can show which arm wrote it/);
  assert.match(textOf(main), /The judge is an AI, not a person, and the blinding is partial/);
  assert.doesNotMatch(textOf(main), /judged by (a )?(human|person|people)|human review(er)?s? (judged|found)/i);
});

test('nothing is unblinded here: the page recounts the committed labels and says the key stayed local by design', () => {
  assert.match(textOf(main), /Nothing here was unblinded for this page\. The evaluation's own runner keeps the blind key and the raw answers local, by design: the reviewer's reasons quote private repositories\./);
  assert.doesNotMatch(raw, /blind_key|"key"|reason/i, 'the record carries no key and no reviewer reason');
});

test('the live run is the write-up\'s summary only, inside its marked box', () => {
  const live = main.match(/<div class="lab-panel blind-live" id="live">[\s\S]*?<\/div>/)[0];
  assert.match(live, /<p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE<\/p>/);
  assert.match(textOf(live), /The same reviewer judged 15 of their answers: 2 useful , 11 partly, 2 wrong\./);
  assert.doesNotMatch(main.replace(live, ''), /\b15 of their answers|11 partly/, 'the live figures appear only in the box');
});

test('no private id: no item key, no CI run id, no repository name, on the page, in the record or the tile', () => {
  const tile = readFileSync('site/data/labs/measured-blind-tile.json', 'utf8');
  for (const [name, text] of [['page', main], ['record', raw], ['tile', tile]]) {
    assert.doesNotMatch(text, /\bwi-[a-z]|\bho-(ci|pr|issue)/, `${name}: an item key`);
    assert.doesNotMatch(text.replace(/\b[0-9a-f]{40,64}\b/g, ''), /\d{8,}/, `${name}: a run id or another long number`);
    assert.doesNotMatch(text, /odin-(next|labs|website|sales)|wo06|hq_eval|agent_space/i, `${name}: a private repository, path or file name`);
    assert.ok(!namesRestricted(text), `${name}: a restricted name`);
  }
  assert.deepEqual(record.sets.flatMap(s => s.items.map(i => i.label)), ['T', 'A', 'B'].flatMap(p => Array.from({ length: 9 }, (_, k) => `${p}${k + 1}`)));
});

test('every private commit is cited the kit\'s way, as part of the private main', () => {
  const mc = record.vendored.mainCheck;
  for (const c of record.vendored.cites) {
    assert.ok(mc.commits.includes(c.commit));
    assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  }
  for (const f of record.vendored.files) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
});

// The leak screen: on the rendered page, the record and the tile, with a planted value per class that it must catch.
test('leak screen: the page, the record and the tile pass; the scripts name no restricted name', () => {
  assert.deepEqual(pageLeaks(page, recordHashes(record)), [], 'the rendered page passes the screen');
  assert.deepEqual(blindProblems(record), [], 'the record passes its checks and the screen');
  for (const file of ['scripts/lab-measured-blind.mjs', 'scripts/vendor-measured-blind.mjs', 'scripts/schemas/odin-lab-measured-blind.schema.json', 'site/data/labs/measured-blind-tile.json']) {
    assert.deepEqual(screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name')), [], file);
  }
});

test('the screen catches each class it guards, on the page and in the record (the test of the test)', () => {
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  const classes = [
    ['a local path', '/Users/someone/x', /machine path/],
    ['a host, port or IP', 'served on localhost:8080', /local host/],
    ['an IP address', 'from 10.0.0.12', /local host/],
    ['a client name (the talk theme)', 'a zarquonbank lender', /restricted name/],
    ['a private repository name', 'odin-labs-ai/some-private-repo', /another repository/],
    ['a credential', credential, /credential/],
    ['a money figure', 'it cost €40', /price or currency/],
  ];
  for (const [what, inject, reason] of classes) {
    assert.ok(pageLeaks(`<main><p>${inject}</p></main>`).some(p => reason.test(p)), `page: ${what}`);
    const r = clone();
    r.sets[0].about = `The nine items, ${inject}.`;
    assert.ok(blindProblems(r).some(p => reason.test(p) || /restricted|file path|link/.test(p)), `record: ${what}`);
  }
  // A hash the record does not hold (a commit only on a lane) is refused on the page.
  assert.ok(pageLeaks('<main><p>commit <code>d07e761d1234abcd</code></p></main>', recordHashes(record)).some(p => /hash the record does not hold|long internal id/.test(p)));
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(blindProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.sets[0].counts.after.useful = 11; }, /the labels recount to useful 10/);
  refused(r => { r.sets[1].items[0].after[0] = 'useful'; }, /the labels recount to/);
  refused(r => { r.sets[2].items[3].before.push('partly'); }, /not one label per run/);
  refused(r => { r.sets[0].items.pop(); }, /not nine items/);
  refused(r => { r.sets[0].items[0].label = 'T9'; }, /not labelled T1 to T9, in order/);
  refused(r => { r.sets.reverse(); }, /not the tuning set, held-out set one and held-out set two, in that order/);
  refused(r => { r.sets[0].items[0].key = 'wi-ops-ci-run'; }, /does not match odin-lab-measured-blind v1/);
  refused(r => { r.sets[0].items[0].kind = 'repo'; }, /does not match odin-lab-measured-blind v1/);
  refused(r => { r.setup.blinding = 'fully blind'; }, /the blinding is partial/);
  refused(r => { r.setup.blinding = 'the blinding is not partial; it is fully blind'; }, /the blinding is partial/);
  refused(r => { r.setup.blinding = 'each answer judged impartially; the blinding is partial in name only, it is impartial'; }, /the blinding is partial/);
  refused(r => { r.setup.blinding = 'the blinding is partially undone'; }, /the blinding is partial/);
  refused(r => { r.sets[2].about = 'Nine fresh items.'; }, /whether the fixes had seen the set/);
  refused(r => { r.live.useful = 5; }, /do not add up to its 15 answers/);
  refused(r => { r.vendored.cites[0].commit = 'f'.repeat(40); }, /a commit only on a lane is never cited/);
  refused(r => { r.vendored.mainCheck.checked = '2099-01-01'; }, /after this build/);
  refused(r => { r.vendored.files[0].sha256 = 'not a hash'; }, /does not match odin-lab-measured-blind v1/);
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-measured-blind-'));
  try {
    for (const file of [BLIND_RECORD, BLIND_PIN, BLIND_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readMeasuredBlind(root).sets.length, 3);
    assert.equal(renderMeasuredBlind(root).pages[BLIND_TEMPLATE], page, 'a fixture with the same files renders the same page');
    writeFileSync(join(root, BLIND_RECORD), raw.replace('"runs": 2', '"runs": 2 '));
    assert.throws(() => readMeasuredBlind(root), /record\.sha256: does not pin the sha256/);
    const changed = raw.replace('"model": "qwen2.5:7b"', '"model": "qwen2.5:7b-instruct"');
    writeFileSync(join(root, BLIND_RECORD), changed);
    writeFileSync(join(root, BLIND_PIN), `${sha256(changed)}  record.json\n`);
    assert.doesNotThrow(() => readMeasuredBlind(root));
    assert.equal(readFileSync(join('site', BLIND_PIN), 'utf8'), `${sha256(raw)}  record.json\n`, 'the committed pin is the committed record\'s');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
