import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUESTION_SET_PIN, QUESTION_SET_RECORD, questionSetProblems, readQuestionSet } from './lab-fit-map.mjs';
import { renderLabs } from './labs.mjs';

// Lab 04's row on the Labs page carries one more line: its agent-query experiment's frozen question set, by counts and
// sha256s, and that its pre-registration is not yet frozen. The fit map itself is vendored and pinned; it is not
// touched. These tests hold the line to its record and keep the fit map's bytes as they were.
const raw = readFileSync(join('site', QUESTION_SET_RECORD), 'utf8');
const record = JSON.parse(raw);
const index = renderLabs()['labs/index.html'];
const row = index.match(/<h3 id="fit-2">Lab 04:[\s\S]*?<\/p>/)[0];
const sha256 = s => createHash('sha256').update(s).digest('hex');
const clone = () => JSON.parse(raw);

test('Lab 04\'s row carries the frozen question set: 131 questions, 9 categories, its sha256 and the gold answers\'', () => {
  assert.equal(record.questions, 131);
  assert.equal(record.categories, 9);
  const file = role => record.vendored.files.find(f => f.role === role).sha256;
  assert.ok(file('questions').startsWith('ec18314a'));
  assert.ok(file('gold').startsWith('395666a6'));
  assert.match(row, /Its agent-query experiment has a frozen question set: 131 questions in 9 categories, sha256 <code title="ec18314a[0-9a-f]{56}">ec18314a<\/code>, with gold answers, sha256 <code title="395666a6[0-9a-f]{56}">395666a6<\/code>\./);
  assert.match(row, /Private commit <code>e31fdc52<\/code>, cited by hash, checked as part of the private main <code>aa35e6db<\/code>/);
});

test('nothing claims a pre-registration: the line says it is not yet frozen, and the Lab 04 row has no new tile', () => {
  assert.match(row, /Its pre-registration is not yet frozen\./);
  assert.doesNotMatch(row, /pre-registered|pre-registration (is )?frozen/i);
  assert.doesNotMatch(index, /lab-tile-company-store|lab-tile-question/);
  const r = clone(); r.preregistration = 'frozen';
  assert.ok(questionSetProblems(r).some(p => /does not match odin-lab-question-set v1/.test(p)));
});

test('the fit map and its pin are unchanged, byte for byte', () => {
  assert.equal(sha256(readFileSync('site/data/labs/fit-map.json')), 'd35f6ee7cf2293469a47cea151a345600b5118971836e6537f740ae4458e38e0');
  assert.equal(JSON.parse(readFileSync('scripts/fit-map.pin.json', 'utf8')).fileSha256, 'd35f6ee7cf2293469a47cea151a345600b5118971836e6537f740ae4458e38e0');
});

test('the record holds counts and hashes only, and is refused when it would make the line untrue', () => {
  assert.deepEqual(questionSetProblems(record), []);
  assert.doesNotMatch(raw, /"text"|"template"|Atlas|lab02|\.json"|\.md"/, 'no question, no answer, no private path');
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(questionSetProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.questions = 130; }, /the categories do not add up to it/);
  refused(r => { r.categories = 8; }, /not the number of categories counted/);
  refused(r => { r.vendored.files = r.vendored.files.filter(f => f.role !== 'gold'); }, /no gold file|does not match/);
  refused(r => { r.vendored.files = r.vendored.files.filter(f => f.role !== 'prereg'); }, /no prereg file|does not match/);
  refused(r => { r.vendored.cites[0].commit = 'f'.repeat(40); }, /a commit only on a lane is never cited/);
  refused(r => { r.questionText = 'At a company, what is the title of an agent?'; }, /does not match odin-lab-question-set v1/);
  refused(r => { r.vendored.from = 'read from /Users/someone/repo'; }, /machine path/);
});

test('on the published site the line is required: a missing record refuses, it never just disappears', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-question-set-missing-'));
  try {
    assert.equal(readQuestionSet(root), null, 'a fixture without the record renders no line');
    assert.throws(() => readQuestionSet(root, { required: true }), /company-store-questions\/record\.json is missing/);
    assert.equal(readQuestionSet('site').questions, 131, 'the repository\'s own site requires it by default');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-question-set-'));
  try {
    for (const file of [QUESTION_SET_RECORD, QUESTION_SET_PIN]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readQuestionSet(root).questions, 131);
    writeFileSync(join(root, QUESTION_SET_RECORD), raw.replace('"questions": 131', '"questions": 131 '));
    assert.throws(() => readQuestionSet(root), /record\.sha256: does not pin the sha256/);
    assert.equal(readFileSync(join('site', QUESTION_SET_PIN), 'utf8'), `${sha256(raw)}  record.json\n`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
