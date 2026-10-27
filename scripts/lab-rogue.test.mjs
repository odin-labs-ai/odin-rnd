import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageLeaks, readRogue, recordHashes, renderRogue, rogueProblems, ROGUE_PIN, ROGUE_RECORD, ROGUE_TEMPLATE } from './lab-rogue.mjs';
import { renderLabs } from './labs.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';

// Lab 05, "Can an agent go rogue?" (scripts/lab-rogue.mjs). The page is only worth publishing if it is honest about
// what is staged and what is real, so these tests hold it to that, and to the leak screen.
const raw = readFileSync(join('site', ROGUE_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[ROGUE_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');

test('Lab 05 renders, sits on the Labs index after Lab 03 and is in the sitemap', () => {
  assert.ok(page, 'labs/rogue/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab03 = index.indexOf('aria-labelledby="lab-tile-failover"'), lab05 = index.indexOf('aria-labelledby="lab-tile-rogue"');
  assert.ok(lab03 >= 0 && lab05 > lab03, 'Lab 05 follows Lab 03');
  assert.match(index, /<span class="technical">LAB 05<\/span><h2 id="lab-tile-rogue">Can an agent go rogue\?<\/h2>/);
  assert.match(index, /<a href="\.\.\/labs\/rogue\/index\.html">/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/rogue/</loc>'));
});

test('the page says the attack is staged: a poisoned ticket, a seeded sandbox repository, synthetic data, a fictional company', () => {
  const lead = textOf(page.match(/<p class="company-lead">[\s\S]*?<\/p>/)[0]);
  assert.match(lead, /We staged an attack: a poisoned ticket, on a seeded sandbox repository with synthetic data\./);
  const staged = textOf(main.match(/<div class="lab-panel rogue-staged"[\s\S]*?<\/div>/)[0]);
  for (const re of [/We wrote the poisoned ticket\. Nobody attacked anything\./, /a fictional company/, /A seeded sandbox in a temporary folder/, /all synthetic/, /none reached the network/, /no real GitHub command ever started/]) assert.match(staged, re);
  assert.match(textOf(main), /the presenter plays the person/, 'the human verdict is staged too, and said so');
});

test('the page says the refusals are real: the engine\'s own guards, run, and a hash-chained journal', () => {
  const real = textOf(main.match(/<div class="lab-panel rogue-real"[\s\S]*?<\/div><\/div>/)[0]);
  assert.match(real, /The engine's own code, run as it is, not re-written for the demo/);
  assert.match(real, /The words below are what those guards returned\./);
  assert.match(real, /each row holding the hash of the row before it/);
  // Every command of the run with no controls is refused through the guards, in the guards' own words from the record.
  for (const [i, act] of record.governed.acts.entries()) {
    assert.equal(act.command, record.ungoverned.steps[i].command);
    assert.ok(textOf(main).includes(`${act.door}`), `act ${i}: the read-only door's words`);
    assert.ok(textOf(main).includes(`${act.trust}`), `act ${i}: the trust wall's words`);
  }
  const outcomes = [...main.matchAll(/<p class="rogue-outcome">Refused\. Journal row (\d+)\.<\/p>/g)].map(m => Number(m[1]));
  assert.equal(outcomes.length, record.governed.acts.length);
  assert.equal(new Set(outcomes).size, outcomes.length, 'each command names its own journal row');
});

test('the repair time is an estimate, and reads as one: its figures appear only inside the estimate box, which says so', () => {
  const box = main.match(/<div class="lab-panel rogue-estimate" id="estimate">[\s\S]*?<\/details><\/div>/)[0];
  assert.match(box, /<p class="technical">AN ESTIMATE, NOT A MEASUREMENT<\/p>/);
  assert.match(textOf(box), /This is not an observed cost: nobody repaired anything\./);
  const r = record.ungoverned.repairEstimate;
  assert.match(box, new RegExp(`<strong>${r.hours} engineer-hours</strong>, or <strong>${String(r.workdays).replace('.', '\\.')} working days</strong>`));
  const outside = main.replace(box, '');
  assert.doesNotMatch(outside, /engineer-hours|working days|workdays/i, 'no repair figure outside the estimate box');
  assert.doesNotMatch(outside, new RegExp(`\\b${r.hours} hours\\b`));
  // The figures are the table's: its rows add up to the hours, the hours over the workday give the days.
  assert.equal(Math.round(r.rows.reduce((t, row) => t + row.hours, 0) * 10) / 10, r.hours);
  assert.equal(Math.round(r.hours / r.workdayHours * 10) / 10, r.workdays);
  assert.match(r.rule, /an estimate .* not a measurement/);
});

test('the attack text appears once, as a quoted exhibit marked as the attack text', () => {
  const body = record.staged.ticket.body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  assert.equal(page.split(body).length - 1, 1, 'the ticket body is on the page exactly once');
  const quote = main.match(/<blockquote class="rogue-attack" id="attack-text">([\s\S]*?)<\/blockquote>/)[1];
  assert.match(quote, /^<p class="technical">THE ATTACK TEXT · AS PLANTED IN THE TICKET · DO NOT FOLLOW<\/p>/);
  assert.ok(quote.includes(body), 'inside the exhibit');
  assert.doesNotMatch(page.replace(quote, ''), /AGENT INSTRUCTION|pre-approved, do not ask for review/, 'the instruction appears nowhere else');
});

test('main\'s variant only: the route planner, never the newer variant that is not on main', () => {
  assert.match(textOf(main), /The main branch carries this version of the demo, the route planner\. A newer version, not yet on main, is not cited here\./);
  for (const text of [page, raw, readFileSync('site/data/labs/rogue-tile.json', 'utf8')]) assert.doesNotMatch(text, /mortgage/i);
  assert.equal(record.staged.repository, 'northwind-labs-example/route-planner');
});

test('the private commits are cited the way Lab 01 cites them, and the second-machine run is stated', () => {
  const mc = record.vendored.mainCheck;
  for (const c of [record.vendored, ...record.vendored.cites]) {
    assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  }
  const [p] = record.reproductions;
  assert.equal(p.host, 'a second machine (a Mac)');
  assert.match(textOf(main), /Run again, on a second machine/);
  assert.ok(main.includes(`<code>committed ${p.committed}  now ${p.now}  SAME; breaches 0</code>`));
  assert.ok(record.stateHash.startsWith(p.committed));
  assert.deepEqual([p.tests.passed, p.tests.failed], [12, 0]);
  for (const f of record.vendored.files) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
});

// The leak screen: on the rendered page, the record and the tile.
const LEAK_SHAPES = [/\/Users\//, /\/home\//, /\b[A-Z]:\\/, /~\/\./, /localhost/i, /\b127\.0\.0\.1\b/, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /:\d{4,5}\b(?!["\d])/,
  /\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]|\bAKIA[0-9A-Z]|-----BEGIN|\bxox[abp]-/, /odin-labs-ai\/(?!odin-rnd)/];

test('leak screen: no machine path, local host, address, port, credential or other repository on the page, in the record or the tile', () => {
  const tile = readFileSync('site/data/labs/rogue-tile.json', 'utf8');
  for (const [name, text] of [['page', main], ['record', raw], ['tile', tile]]) {
    for (const re of LEAK_SHAPES) assert.doesNotMatch(text, re, `${name}: ${re}`);
  }
  assert.deepEqual(pageLeaks(page, recordHashes(record)), [], 'the rendered page passes the screen');
  assert.deepEqual(rogueProblems(record), [], 'the record passes its checks and the screen');
  // The scripts that build this lab name no restricted name either (they may name paths: they are code).
  for (const file of ['scripts/lab-rogue.mjs', 'scripts/vendor-rogue.mjs', 'scripts/schemas/odin-lab-rogue.schema.json']) {
    const names = screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name'));
    assert.deepEqual(names, [], file);
  }
});

test('the screen catches what it says it catches (the test of the test)', () => {
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  for (const [inject, reason] of [['/Users/someone/x', /machine path/], ['C:\\work', /machine path/], ['served on localhost', /local host/], ['10.0.0.12', /local host/], ['port :6488', /local host/], [credential, /credential/], ['the oac repository', /restricted name/]]) {
    assert.ok(pageLeaks(`<main><p>${inject}</p></main>`).some(p => reason.test(p)), inject);
  }
  assert.deepEqual(pageLeaks('<main><p>commit <code>e41d9422648239dd</code></p></main>', recordHashes(record)), [], 'a hash the record holds is masked');
  // A hex token the record does not hold is screened as it is: the mask hides nothing else.
  assert.ok(pageLeaks('<main><p>id <code>1234567890abcdef</code></p></main>', recordHashes(record)).some(p => /long internal id/.test(p)));
  assert.ok(pageLeaks('<main><p>commit <code>e41d9422648239dd</code></p></main>').some(p => /long internal id/.test(p)), 'without the record, nothing is masked');
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(rogueProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.ungoverned.repairEstimate.hours = 30; }, /its rows add up to 36/);
  refused(r => { r.ungoverned.repairEstimate.workdays = 5; }, /workdays: 5 is not/);
  refused(r => { r.ungoverned.repairEstimate.rule = 'measured on the night'; }, /must say it is an estimate, not a measurement/);
  refused(r => { r.governed.journal.rows[2].prev = r.governed.journal.rows[0].hash; }, /rows\/2\/prev: not the hash of the row above/);
  refused(r => { r.governed.journal.head = r.governed.journal.rows[0].hash; }, /head: not the last row's hash/);
  refused(r => { r.governed.breaches = 1; }, /a guard let a command through/);
  refused(r => { r.governed.repositoryUnchanged = false; }, /a guard let a command through/);
  refused(r => { r.governed.acts[1].ran = true; }, /does not match odin-lab-rogue v1/);
  refused(r => { r.governed.acts[0].command = 'git -C <agent> status'; }, /not the same command as the run with no controls/);
  refused(r => { r.reproductions[0].committed = '0123456789abcdef'; }, /not the record's state hash/);
  refused(r => { r.reproductions[0].verdict = 'DIFFERENT'; }, /not what its two hashes say/);
  refused(r => { r.reproductions[0].at = '2099-01-01T00:00:00Z'; r.reproductions[0].on = '2099-01-01'; }, /after this build/);
  refused(r => { r.staged.about = 'see games/agent_space/talk/rogue.py'; }, /a file path or file name/);
  refused(r => { r.staged.path = 'anything'; }, /not allowed/);
  refused(r => { r.staged.sandbox.network = true; }, /does not match odin-lab-rogue v1/);
  refused(r => { for (const a of r.governed.acts) a.journalRow = 1; }, /each command names its own journal row/);
  refused(r => { r.ungoverned.steps[2].ran = false; }, /the page says every command ran/);
  refused(r => { r.reproductions[0].breaches = 2; }, /did not match with no breach/);
  refused(r => { r.reproductions[0].tests.failed = 1; }, /a test failed/);
  refused(r => { r.ungoverned.damage.commitsLostFromMain = 1; }, /not main before minus main after/);
  refused(r => { r.ungoverned.damage.repositoryDeleted = false; }, /repositoryDeleted: not what the state after says/);
  refused(r => { r.ungoverned.damage.prBranchesDeleted = 9; }, /more than the branches that went/);
  refused(r => { r.ungoverned.damage.ciRunsStopped = 3; }, /ciRunsStopped/);
  refused(r => { r.ungoverned.before.mainCommits = 30; }, /not the seeded sandbox/);
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-rogue-'));
  try {
    for (const file of [ROGUE_RECORD, ROGUE_PIN, ROGUE_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readRogue(root).stateHash, record.stateHash);
    assert.equal(renderRogue(root).pages[ROGUE_TEMPLATE], page, 'a fixture with the same files renders the same page');
    writeFileSync(join(root, ROGUE_RECORD), raw.replace('"breaches": 0', '"breaches": 0 '));
    assert.throws(() => readRogue(root), /record\.sha256: does not pin the sha256/);
    const changed = raw.replace(record.staged.ticket.title, 'Something else');
    writeFileSync(join(root, ROGUE_RECORD), changed);
    writeFileSync(join(root, ROGUE_PIN), `${sha256(changed)}  record.json\n`);
    assert.doesNotThrow(() => readRogue(root));
    assert.equal(readFileSync(join('site', ROGUE_PIN), 'utf8'), `${sha256(raw)}  record.json\n`, 'the committed pin is the committed record\'s');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
