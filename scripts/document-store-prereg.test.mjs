// EXP 010: the pre-registration validator accepts the committed record and refuses every tampering that would change
// what is measured: a pinned file, the corpus counts, a decision threshold, an operation's used flag, the pin itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PINNED, corpusPath, pinPath, recordPath, sha256, validate } from './document-store-prereg.mjs';

const record = () => JSON.parse(readFileSync(recordPath, 'utf8'));

// A private copy of the files the validator reads, so a test can tamper with disk without touching the tree.
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'document-store-prereg-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const p of [...PINNED, recordPath]) cpSync(p, join(root, p), { recursive: true });
  return root;
}

test('the committed record validates and is pinned', () => {
  const hash = validate(record());
  assert.equal(readFileSync(pinPath, 'utf8'), `${hash}  ${recordPath}\n`);
});

test('the record is frozen and the decision rule is the pre-registered one', () => {
  const r = record();
  assert.equal(r.freeze.status, 'frozen');
  assert.deepEqual([r.decision.adopt, r.decision.adoptAndBuild], [0.95, 0.8]);
  assert.equal(r.primary.P1.n, r.corpus.usedCases);
  assert.equal(r.spend.capUsd, 0);
});

test('refuses a changed corpus file', t => {
  const root = sandbox(t);
  writeFileSync(join(root, corpusPath), readFileSync(corpusPath, 'utf8').replace('"usedByOdin":false', '"usedByOdin":true'));
  assert.throws(() => validate(record(), root));
});

test('refuses a changed comparator', t => {
  const root = sandbox(t);
  writeFileSync(join(root, 'scripts/document-store-compare.mjs'), readFileSync('scripts/document-store-compare.mjs', 'utf8') + '\n// changed\n');
  assert.throws(() => validate(record(), root), /files|comparator/);
});

test('refuses a moved decision threshold', () => {
  const r = record(); r.decision.adopt = 0.9;
  assert.throws(() => validate(r), /decision.adopt/);
});

test('refuses an operation whose used flag disagrees with its cases', () => {
  const r = record(); r.operations.find(o => o.id === 'O11').usedByOdin = true;
  assert.throws(() => validate(r), /used flag/);
});

test('refuses a case that runs an excluded operation', () => {
  const r = record(); r.operations.find(o => o.id === 'O05').inExperiment = 'excluded';
  assert.throws(() => validate(r), /excluded/);
});

test('refuses a P1 n that is not the used-case count', () => {
  const r = record(); r.primary.P1.n += 1;
  assert.throws(() => validate(r), /P1 n/);
});

test('refuses a frozen record that still carries a TO-FREEZE field', () => {
  const r = record(); r.freeze.toFreeze = ['execution.runner'];
  assert.throws(() => validate(r), /TO-FREEZE/);
});

test('the corpus has no server-generated identifiers and every case names its documentation page', () => {
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
  const ids = corpus.cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of corpus.cases) {
    assert.ok(c.docs.startsWith('https://www.mongodb.com/docs/manual/reference/'), c.id);
    for (const command of [...c.setup, c.command]) {
      const text = JSON.stringify(command);
      assert.ok(!text.includes('"$C"'), `${c.id} kept a collection placeholder`);
      assert.ok(!text.includes('$oid'), `${c.id} would depend on a generated ObjectId`);
      if ('insert' in command) for (const doc of command.documents) assert.ok('_id' in doc, `${c.id} inserts without an explicit _id`);
    }
  }
  assert.equal(sha256(readFileSync(corpusPath)), record().corpus.sha256);
});
