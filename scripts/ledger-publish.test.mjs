import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCopies, checkCopy, checkLedgerEntry, copies, pinned, sha256 } from './ledger-publish.mjs';

test('every committed site copy is the frozen record, and every pinned record still matches its .sha256', () => {
  const checked = checkCopies();
  assert.deepEqual([...new Set(checked.map(c => c.id))], ['EXP 012']);
  for (const c of checked) {
    assert.equal(c.sha256, sha256(readFileSync(c.site)));
    if (c.pin) assert.equal(c.sha256, pinned(readFileSync(c.pin, 'utf8')));
  }
});

test('a record that drifted from its pin, a stale site copy and a missing site copy each refuse', () => {
  const files = { rec: Buffer.from('{"a":1}'), pin: `${sha256(Buffer.from('{"a":1}'))}  rec\n`, site: Buffer.from('{"a":1}') };
  const read = (p, enc) => (enc ? String(files[p]) : files[p]);
  const c = { id: 'EXP 999', record: 'rec', pin: 'pin', site: 'site' };
  assert.equal(checkCopy(c, read, () => true), sha256(files.rec));
  files.site = Buffer.from('{"a":2}');
  assert.throws(() => checkCopy(c, read, () => true), /differs from rec/);
  files.site = files.rec;
  assert.throws(() => checkCopy(c, read, () => false), /is missing/);
  files.rec = Buffer.from('{"a":3}');
  assert.throws(() => checkCopy(c, read, () => true), /no longer matches its frozen pin/);
});

test('the copy list publishes pre-registrations under data/<slug>/ with the names the ledger reads', () => {
  for (const c of copies) assert.match(c.site, /^site\/data\/[a-z-]+\/(preregistration|amendment-\d{2}|results)\.json$/);
});

test('a not-pre-registered ledger entry must say so and carry a number, a title, a date and a source', () => {
  const ok = { experiment: { id: 'EXP 013', title: 't' }, preregistered: false, numberedOn: '2026-10-23', source: 'pr' };
  assert.equal(checkLedgerEntry(ok, 'w'), ok);
  assert.throws(() => checkLedgerEntry({ ...ok, preregistered: true }, 'w'), /needs record, pin and sha256/);
  assert.throws(() => checkLedgerEntry({ ...ok, preregistered: 'no' }, 'w'), /preregistered must be true/);
  assert.throws(() => checkLedgerEntry({ ...ok, experiment: { id: 'EXP 13', title: 't' } }, 'w'), /EXP 000/);
  assert.throws(() => checkLedgerEntry({ ...ok, numberedOn: 'today' }, 'w'), /numberedOn/);
  assert.throws(() => checkLedgerEntry({ ...ok, source: '' }, 'w'), /source/);
  for (const slug of ['temporal-document-fit', 'temporal-primitive-fit', 'document-store']) checkLedgerEntry(JSON.parse(readFileSync(`site/data/${slug}/ledger-entry.json`, 'utf8')), slug);
});

test('a pre-registration listed from the repository must match its pin, the sha256 it states, and its own id', () => {
  const rec = Buffer.from('{"experiment":{"id":"EXP 010"}}');
  const files = { rec, pin: `${sha256(rec)}  rec\n` };
  const read = (p, enc) => (enc ? String(files[p]) : files[p]);
  const ok = { experiment: { id: 'EXP 010', title: 't' }, preregistered: true, record: 'rec', pin: 'pin', sha256: sha256(rec) };
  assert.equal(checkLedgerEntry(ok, 'w', read), ok);
  assert.throws(() => checkLedgerEntry({ ...ok, sha256: '0'.repeat(64) }, 'w', read), /does not match its pin/);
  assert.throws(() => checkLedgerEntry({ ...ok, experiment: { id: 'EXP 011', title: 't' } }, 'w', read), /is not EXP 011/);
  assert.throws(() => checkLedgerEntry({ ...ok, pin: undefined }, 'w', read), /needs record, pin and sha256/);
  files.pin = `${'1'.repeat(64)}  rec\n`;
  assert.throws(() => checkLedgerEntry(ok, 'w', read), /does not match its pin/);
});
