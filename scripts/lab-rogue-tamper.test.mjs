import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASES, CHECK_WORDS, TAMPER_JOURNAL, TAMPER_PIN, TAMPER_RECORD, journalRows, readTamper, tamperProblems } from './lab-rogue-tamper.mjs';
import { readRogue, ROGUE_TEMPLATE } from './lab-rogue.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { renderLabs } from './labs.mjs';
import { namesRestricted } from './lab-dispatch-publish.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

// Lab 05's "Can you tamper with the record?" (scripts/lab-rogue-tamper.mjs, scripts/rogue_tamper.py). It closes Lab 05's
// first residual: the journal's rows are now re-hashed, each one, by the engine's own rule, in Python.
const rogue = readRogue();
const raw = readFileSync(join('site', TAMPER_RECORD), 'utf8');
const record = JSON.parse(raw);
const journal = readFileSync(join('site', TAMPER_JOURNAL));
const page = renderLabs()[ROGUE_TEMPLATE];
const section = page.slice(page.indexOf('<section class="company-section company-width" id="tamper"'), page.indexOf('id="boundary"'));
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const NOW = new Date();

// CI has python3 (ubuntu-latest); a machine without it skips locally, never in CI.
const python = spawnSync('python3', ['--version']).status === 0;
const runCheck = (site = 'site') => spawnSync('python3', ['scripts/rogue_tamper.py', '--check', '--site', site], { encoding: 'utf8' });

test('the Python check re-derives the committed tamper record byte for byte (in CI, every run)', { skip: !python && !process.env.CI && 'no python3 on this machine' }, () => {
  const r = runCheck();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SAME; 5 rows, head 0ededd3c46733b8c/);
});

test('the Python check fails on a tampered journal or a hand-edited record', { skip: !python && !process.env.CI && 'no python3 on this machine' }, () => {
  const site = mkdtempSync(join(tmpdir(), 'rogue-tamper-'));
  try {
    cpSync('site/data/labs/rogue', join(site, 'data/labs/rogue'), { recursive: true });
    assert.equal(runCheck(site).status, 0, 'a copy of the site checks');
    // One byte of the journal flipped: the engine's rule refuses it.
    writeFileSync(join(site, TAMPER_JOURNAL), String(journal).replace('wipe:main', 'wipe:Main'));
    const flipped = runCheck(site);
    assert.notEqual(flipped.status, 0);
    assert.match(flipped.stdout + flipped.stderr, /does not verify: \{'check': 'own-hash', 'position': 2, 'n': 2\}/);
    // The journal restored, the record edited by hand: DIFFERENT.
    writeFileSync(join(site, TAMPER_JOURNAL), journal);
    writeFileSync(join(site, TAMPER_RECORD), raw.replace('"check": "prev-link"', '"check": "own-hash"'));
    const edited = runCheck(site);
    assert.equal(edited.status, 1);
    assert.match(edited.stdout, /DIFFERENT/);
  } finally { rmSync(site, { recursive: true, force: true }); }
});

test('the vendored journal is every row in full, the bytes Lab 05\'s record cites, and its rows are the ones that page shows', () => {
  const cited = rogue.vendored.files.find(f => f.role === 'journal').sha256;
  assert.equal(cited, '13dc0a20f5aed5bff0fb9495ec5028e231945c5c05b1c2e57ade19840e72ba89');
  assert.equal(record.vendored.files[0].sha256, cited);
  const rows = journalRows(journal);
  assert.equal(rows.length, 5);
  for (const r of rows) for (const key of ['t', 'why', 'ok', 'repo'].filter(k => r.act === 'refused' || k !== 'why')) assert.ok(key in r || (r.act === 'verdict' && key === 'repo'), `row ${r.n} keeps ${key}`);
  assert.equal(typeof rows[0].t, 'number');
  assert.match(String(journal), /"t": 1793100004\.0,/, 'the time as Python wrote it, a float');
  assert.deepEqual(rows.map(r => r.hash), rogue.governed.journal.rows.map(r => r.hash));
  assert.equal(record.head, rogue.governed.journal.head);
  assert.deepEqual(tamperProblems(record, journal, rogue, { now: NOW }), []);
  assert.equal(readFileSync(join('site', TAMPER_PIN), 'utf8').split('  ')[1], 'tamper.json\n');
});

test('the page says the check ran in Python at vendor time and in CI, and that every row passes both checks', () => {
  const text = textOf(section);
  assert.match(text, /Can you tamper with the record\?/);
  assert.match(text, /The check ran in Python, when the journal was vendored, and runs again in every CI run of this site/);
  assert.match(text, /each row's time is a whole number of seconds, which Python writes with a trailing \.0 and JavaScript without it/);
  assert.match(text, /All 5 rows pass both checks\./);
  assert.ok(section.includes(`href="../../${TAMPER_JOURNAL}"`) && section.includes(`href="../../${TAMPER_RECORD}"`), 'the journal and the check are linked');
  assert.match(page.slice(page.indexOf('id="governed"')), /each row's own hash is recomputed too/);
  assert.ok(page.indexOf('id="check"') < page.indexOf('id="tamper"') && page.indexOf('id="tamper"') < page.indexOf('id="boundary"'));
});

test('the gallery is boxed as copies we made, and each copy names the check that catches it', () => {
  const gallery = section.match(/<div class="lab-panel rogue-tamper-gallery" id="tamper-gallery">[\s\S]*<\/article><\/div><\/div>/)[0];
  assert.match(gallery, /^<div class="lab-panel rogue-tamper-gallery" id="tamper-gallery"><p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US<\/p>/);
  assert.match(textOf(gallery), /We made each copy ourselves, from the real journal, and ran it through the same check\. Nobody tampered with the real one\./);
  const outside = page.replace(gallery, '');
  assert.doesNotMatch(outside, /class="lab-panel rogue-tamper-case"/, 'no tampered copy outside the box');
  assert.doesNotMatch(outside, /wipe:Main/);
  for (const [id, want] of Object.entries(CASES)) {
    const card = gallery.match(new RegExp(`<article class="lab-panel rogue-tamper-case" id="tamper-${id}">[\\s\\S]*?</article>`))[0];
    assert.ok(card.includes(`<h4>${want.title.replaceAll("'", '&#39;')}</h4>`) || card.includes(`<h4>${want.title}</h4>`), id);
    const outcome = textOf(card.match(/<p class="rogue-outcome">[\s\S]*?<\/p>/)[0]);
    assert.ok(outcome.includes(want.caughtBy === 'head' ? `Caught only by ${CHECK_WORDS.head}` : `Caught by ${CHECK_WORDS[want.caughtBy]}`), `${id}: ${outcome}`);
  }
  assert.deepEqual(record.cases.map(c => [c.id, c.caught.check]), Object.entries(CASES).map(([id, c]) => [id, c.caughtBy]));
});

test('the tamper record is refused when it would make the page say something untrue', () => {
  const refused = (change, re, bytes = journal) => { const r = clone(); change(r); const p = tamperProblems(r, bytes, rogue, { now: NOW }); assert.ok(p.some(x => re.test(x)), `${re}\n${p.join('\n')}`); };
  refused(() => {}, /its sha256 is .* not the journal Lab 05's record cites/, Buffer.from(String(journal).replace('wipe:main', 'wipe:Main')));
  refused(r => { r.rows[2].hash = r.rows[1].hash; }, /rows\/2: not the journal's row 3/);
  refused(r => { r.head = r.rows[0].hash; }, /head: not the journal's last hash/);
  refused(r => { r.cases[0].caught.check = 'head'; }, /caught by head; the page says own-hash/);
  refused(r => { r.cases[1].result[2].prevLink = 'OK'; }, /not what JavaScript finds for the same copy/);
  refused(r => { r.cases[1].result[0].ownHash = 'MISMATCH'; r.cases[1].caught = { check: 'prev-link', position: 1, n: 1 }; }, /not what JavaScript finds for the same copy/);
  // The review's case: the flipped copy's table says its own hash passed and its link broke, the outcome unchanged.
  refused(r => { r.cases[0].result[1].ownHash = 'OK'; r.cases[0].result[1].prevLink = 'BROKEN'; }, /not what JavaScript finds for the same copy[\s\S]*|the first failing check is prev-link, not own-hash/);
  refused(r => { r.cases[0].result[1].ownHash = 'OK'; r.cases[0].result[1].prevLink = 'BROKEN'; }, /the first failing check is prev-link, not own-hash/);
  refused(r => { r.cases[0].result[3].ownHash = 'MISMATCH'; }, /not what JavaScript finds for the same copy/);
  refused(r => { r.cases[2].result[1].n = 2; }, /not what JavaScript finds for the same copy/);
  refused(r => { r.cases[4].result[2].prevLink = 'BROKEN'; }, /the rewritten copy must show every check passing/);
  refused(r => { r.cases[1].did = 'row 2 removed, every other row kept byte for byte'; }, /cases\/1\/did: says/);
  refused(r => { r.cases[3].result[0].prevLink = 'BROKEN'; }, /a row check fails, but the page says only the head catches this copy/);
  refused(r => { r.cases[4].head = r.head; }, /the head is unchanged, so nothing would catch this copy/);
  refused(r => { r.cases[0].head = r.cases[4].head; }, /the head changed; the page says the head alone does not catch this copy/);
  refused(r => { r.cases[0].after = r.cases[0].after.replace('Main', 'MAIN'); }, /not one byte flipped/);
  refused(r => { r.cases[0].before = 'something else'; }, /before: not the journal's row 2 command/);
  refused(r => { r.cases[1].before = 'x'; }, /only the flipped copy names a changed field/);
  refused(r => { r.cases.reverse(); }, /not the five copies this page describes, in order/);
  refused(r => { r.cases.pop(); }, /does not match odin-lab-rogue-tamper v1/);
  refused(r => { r.checkedWith = 'checked by hand'; }, /must say the check ran in Python/);
  refused(r => { r.vendored.cites[0].commit = 'f'.repeat(40); }, /a commit only on a lane is never cited/);
  refused(r => { r.vendored.from = 'read from /Users/someone/hq'; }, /machine path|file path/);
  refused(r => { r.rows[0].ownHash = 'MISMATCH'; }, /does not match odin-lab-rogue-tamper v1/);
  // The journal rows must be the ones Lab 05's record shows.
  const other = structuredClone(rogue); other.governed.journal.rows[4].by = 'someone else';
  assert.ok(tamperProblems(clone(), journal, other, { now: NOW }).some(p => /row 5 is not the row Lab 05's record shows/.test(p)));
});

test('the section is fail-closed: a missing or unpinned tamper record refuses the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'rogue-tamper-'));
  try {
    cpSync('site/data/labs/rogue', join(root, 'data/labs/rogue'), { recursive: true });
    assert.equal(readTamper(root, rogue).head, record.head);
    writeFileSync(join(root, TAMPER_RECORD), raw.replace('"version": 1', '"version": 1 '));
    assert.throws(() => readTamper(root, rogue), /tamper\.sha256: does not pin the sha256/);
    rmSync(join(root, TAMPER_JOURNAL));
    writeFileSync(join(root, TAMPER_RECORD), raw);
    assert.throws(() => readTamper(root, rogue), /journal\.jsonl: missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('leak screen: the section, the journal and the tamper record', () => {
  assert.deepEqual(pageLeaks(page, [...recordHashes(rogue), ...recordHashes(record)]), []);
  for (const [name, text] of [['section', section], ['journal', String(journal)], ['record', raw]]) {
    for (const re of [/\/Users\//, /\/home\//, /localhost/i, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /\bghp_|\bsk-[A-Za-z0-9]|-----BEGIN/, /odin-labs-ai\/(?!odin-rnd)/, /[€$£]\s?\d/]) assert.doesNotMatch(text, re, `${name}: ${re}`);
    assert.ok(!namesRestricted(text), `${name}: a restricted name`);
  }
});
