// EXP 010: the comparator's teeth. Every planted divergence a client could observe must be caught; every change a
// client cannot observe (volatile envelope fields, envelope key order, errmsg text, an open cursor's id) must not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalise } from './document-store-compare.mjs';

const int = n => ({ $numberInt: String(n) });
const long = n => ({ $numberLong: String(n) });
const dbl = n => ({ $numberDouble: String(n) });
const clone = v => structuredClone(v);

const findReply = () => ({
  cursor: { firstBatch: [{ _id: int(1), a: { b: int(2) }, tags: ['x', 'y'] }, { _id: int(2), a: { b: int(3) }, tags: [] }], id: long(0), ns: 'exp010.c' },
  ok: dbl(1.0),
  $clusterTime: { clusterTime: { $timestamp: { t: 1, i: 1 } } },
  operationTime: { $timestamp: { t: 1, i: 1 } },
});
const writeReply = () => ({ n: int(1), writeErrors: [{ index: int(1), code: int(11000), codeName: 'DuplicateKey', errmsg: 'E11000 duplicate key' }], ok: dbl(1.0) });
const errorReply = () => ({ ok: dbl(0.0), errmsg: 'some text', code: int(2), codeName: 'BadValue' });
const famReply = () => ({ lastErrorObject: { n: int(1), updatedExisting: true }, value: { _id: int(1), v: int(2), s: 'a' }, ok: dbl(1.0) });

// Planted divergences: each must make compare() report a difference.
const planted = {
  'int32 became double in a returned document': r => { r.cursor.firstBatch[0].a.b = dbl(2); },
  'returned document key order changed': r => { const d = r.cursor.firstBatch[0]; r.cursor.firstBatch[0] = { a: d.a, _id: d._id, tags: d.tags }; },
  'field dropped from a returned document': r => { delete r.cursor.firstBatch[1].tags; },
  'extra field in a returned document': r => { r.cursor.firstBatch[1].extra = null; },
  'document missing from the batch': r => { r.cursor.firstBatch.pop(); },
  'array element order changed inside a document': r => { r.cursor.firstBatch[0].tags.reverse(); },
  'batch order changed (sorted query)': r => { r.cursor.firstBatch.reverse(); },
  'cursor left open instead of exhausted': r => { r.cursor.id = long(424242); },
  'namespace differs': r => { r.cursor.ns = 'exp010.other'; },
  'ok flag differs': r => { r.ok = dbl(0.0); },
  'null instead of missing': r => { r.cursor.firstBatch[1].a.c = null; },
  'int64 instead of int32': r => { r.cursor.firstBatch[0]._id = long(1); },
};

for (const [name, mutate] of Object.entries(planted)) {
  test(`teeth: ${name}`, () => {
    const candidate = findReply(); mutate(candidate);
    const verdict = compare(findReply(), candidate);
    assert.equal(verdict.same, false, name);
    assert.ok(verdict.reason.length > 0);
  });
}

test('teeth: a different error code or codeName is caught', () => {
  assert.equal(compare(errorReply(), { ...errorReply(), code: int(9) }).same, false);
  assert.equal(compare(errorReply(), { ...errorReply(), codeName: 'FailedToParse' }).same, false);
  assert.equal(compare(errorReply(), { ok: dbl(1.0) }).same, false);
});

test('teeth: per-document write errors compare index, code and codeName', () => {
  const r = writeReply();
  assert.equal(compare(r, { ...clone(r), writeErrors: [{ ...r.writeErrors[0], index: int(0) }] }).same, false);
  assert.equal(compare(r, { ...clone(r), writeErrors: [{ ...r.writeErrors[0], code: int(11001) }] }).same, false);
  assert.equal(compare(r, { ...clone(r), n: int(2) }).same, false);
});

test('teeth: findAndModify value keeps key order and type', () => {
  const r = famReply();
  assert.equal(compare(r, { ...clone(r), value: { v: int(2), _id: int(1), s: 'a' } }).same, false);
  assert.equal(compare(r, { ...clone(r), value: { _id: int(1), v: dbl(2), s: 'a' } }).same, false);
  assert.equal(compare(r, { ...clone(r), value: null }).same, false);
});

// Unobservable differences: none may be reported.
test('ignored: volatile envelope fields and errmsg text', () => {
  const b = findReply(); b.$clusterTime = { clusterTime: { $timestamp: { t: 9, i: 9 } } }; b.operationTime = { $timestamp: { t: 9, i: 9 } }; b.electionId = { $oid: '7fffffff0000000000000001' };
  assert.deepEqual(compare(findReply(), b), { same: true });
  assert.deepEqual(compare(errorReply(), { ...errorReply(), errmsg: 'other words' }), { same: true });
  assert.deepEqual(compare(writeReply(), { ...writeReply(), writeErrors: [{ ...writeReply().writeErrors[0], errmsg: 'E11000 other' }] }), { same: true });
});

test('ignored: envelope key order', () => {
  const a = findReply(), b = { ok: a.ok, cursor: { ns: a.cursor.ns, id: a.cursor.id, firstBatch: a.cursor.firstBatch } };
  assert.deepEqual(compare(a, b), { same: true });
});

test('ignored: the value of an open cursor id, but not open vs exhausted', () => {
  const a = findReply(), b = findReply();
  a.cursor.id = long(11); b.cursor.id = long(99);
  assert.deepEqual(compare(a, b), { same: true });
  b.cursor.id = long(0);
  assert.equal(compare(a, b).same, false);
});

test('unordered: batch order is ignored only when the case declares it, documents stay ordered', () => {
  const a = findReply(), b = findReply(); b.cursor.firstBatch.reverse();
  assert.deepEqual(compare(a, b, { unordered: true }), { same: true });
  const c = findReply(); c.cursor.firstBatch[0] = { a: c.cursor.firstBatch[0].a, _id: int(1), tags: ['x', 'y'] };
  assert.equal(compare(a, c, { unordered: true }).same, false);
});

test('normalise is deterministic and does not mutate its input', () => {
  const a = findReply(), before = JSON.stringify(a);
  assert.deepEqual(normalise(a), normalise(findReply()));
  assert.equal(JSON.stringify(a), before);
});
