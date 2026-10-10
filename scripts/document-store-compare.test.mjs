// EXP 010: the comparator's teeth. Every planted divergence a client could observe must be caught; every change a
// client cannot observe (volatile envelope fields, envelope key order, errmsg text, an open cursor's id) must not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, compareTranscript, normalise, plantDivergence, sessionShape } from './document-store-compare.mjs';

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
test('ignored in P1: session metadata values and errmsg text', () => {
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

test('teeth: structured write-error fields (keyValue, keyPattern, errInfo) are compared', () => {
  const r = { n: int(1), writeErrors: [{ index: int(1), code: int(11000), codeName: 'DuplicateKey', keyPattern: { _id: int(1) }, keyValue: { _id: 'a' }, errmsg: 'x' }], ok: dbl(1.0) };
  const b = clone(r); b.writeErrors[0].keyValue = { _id: 'b' };
  assert.equal(compare(r, b).same, false);
  const c = clone(r); delete c.writeErrors[0].keyPattern;
  assert.equal(compare(r, c).same, false);
  const d = clone(r); d.writeErrors[0].errInfo = { details: {} };
  assert.equal(compare(r, d).same, false);
});

test('teeth: a malformed cursor id is a difference, a different open int64 id is not', () => {
  const a = findReply(); a.cursor.id = long(12);
  for (const bad of ['invalid', null, int(12), dbl(12)]) {
    const b = findReply(); b.cursor.id = bad;
    assert.equal(compare(a, b).same, false, JSON.stringify(bad));
  }
  const ok = findReply(); ok.cursor.id = long(98765);
  assert.deepEqual(compare(a, ok), { same: true });
});

test('unordered: canonically equal but byte-distinct strings do not produce a false divergence', () => {
  const batch = [{ _id: int(1), x: '\u00e9' }, { _id: int(2), x: 'e\u0301' }];
  const a = { cursor: { firstBatch: batch, id: long(0), ns: 'exp010.c' }, ok: dbl(1.0) };
  const b = { cursor: { firstBatch: [...batch].reverse(), id: long(0), ns: 'exp010.c' }, ok: dbl(1.0) };
  assert.deepEqual(compare(a, b, { unordered: true }), { same: true });
});

test('session metadata: shape records presence and types, never values (secondary S5)', () => {
  const a = findReply(), b = findReply();
  b.$clusterTime = { clusterTime: { $timestamp: { t: 9, i: 9 } } };
  assert.deepEqual(sessionShape(a), sessionShape(b));
  const none = findReply(); delete none.$clusterTime; delete none.operationTime;
  assert.notDeepEqual(sessionShape(a), sessionShape(none));
  assert.deepEqual(sessionShape(none), {});
});

const page = (docs, id, first) => ({ cursor: { [first ? 'firstBatch' : 'nextBatch']: docs, id, ns: 'exp010.c' }, ok: dbl(1.0) });
const d = n => ({ _id: int(n) });

test('transcript: a drained cursor is compared reply by reply', () => {
  const ref = [page([d(1), d(2)], long(7), true), page([d(3), d(4)], long(0), false)];
  assert.deepEqual(compareTranscript(ref, [page([d(1), d(2)], long(8), true), page([d(3), d(4)], long(0), false)]), { same: true });
  assert.equal(compareTranscript(ref, [page([d(1), d(2)], long(8), true)]).same, false, 'stopped early');
  assert.equal(compareTranscript(ref, [page([d(1), d(2)], long(8), true), page([d(3)], long(0), false)]).same, false, 'lost a document');
  assert.equal(compareTranscript(ref, [page([d(1), d(2)], long(8), true), page([d(3), d(4)], long(5), false)]).same, false, 'never exhausted');
});

test('transcript unordered: the same documents split differently across batches are the same', () => {
  const ref = [page([d(1), d(2)], long(7), true), page([d(3)], long(0), false)];
  assert.deepEqual(compareTranscript(ref, [page([d(3)], long(7), true), page([d(2), d(1)], long(0), false)], { unordered: true }), { same: true });
  assert.equal(compareTranscript(ref, [page([d(3)], long(7), true), page([d(2)], long(0), false)], { unordered: true }).same, false);
  assert.equal(compareTranscript(ref, [page([d(1), d(2), d(3)], long(4), true)], { unordered: true }).same, false, 'left open');
  const bad = [page([d(1), d(2)], long(7), true), { ...page([d(3)], long(0), false), ns: 'other' }];
  bad[1].cursor.ns = 'exp010.other';
  assert.equal(compareTranscript(ref, bad, { unordered: true }).same, false, 'envelope differs');
});

test('teeth r2: a malformed cursor id can never equal a valid one, even the literal token', () => {
  const a = findReply(); a.cursor.id = long(12);
  for (const bad of ['<open>', 0, { $malformedCursorId: '"x"' }]) {
    const b = findReply(); b.cursor.id = bad;
    assert.equal(compare(a, b).same, false, JSON.stringify(bad));
  }
});

test('teeth r2: field names inside keyValue, keyPattern and errInfo are data, never dropped; their key order counts', () => {
  const r = { n: int(0), writeErrors: [{ index: int(0), code: int(11000), codeName: 'DuplicateKey', keyPattern: { errmsg: int(1), $clusterTime: int(1) }, keyValue: { errmsg: 'a', $clusterTime: 'x' }, errmsg: 'E11000' }], ok: dbl(1.0) };
  const b = clone(r); b.writeErrors[0].keyValue.errmsg = 'b';
  assert.equal(compare(r, b).same, false, 'errmsg inside keyValue');
  const c = clone(r); c.writeErrors[0].keyValue.$clusterTime = 'y';
  assert.equal(compare(r, c).same, false, '$clusterTime inside keyValue');
  const d = clone(r); d.writeErrors[0].keyPattern = { $clusterTime: int(1), errmsg: int(1) };
  assert.equal(compare(r, d).same, false, 'compound key order');
  const e = clone(r); e.writeErrors[0].errmsg = 'other text';
  assert.deepEqual(compare(r, e), { same: true }, 'the entry errmsg is still free text');
  const f = { ...findReply(), cursor: { ...findReply().cursor, firstBatch: [{ _id: int(1), errmsg: 'a', operationTime: int(1) }] } };
  const g = clone(f); g.cursor.firstBatch[0].errmsg = 'b';
  assert.equal(compare(f, g).same, false, 'errmsg as a document field');
});

test('teeth r2: a transcript must be non-empty, well formed and end exhausted or in an error', () => {
  const done = [page([d(1)], long(0), true)];
  assert.equal(compareTranscript([], []).same, false, 'empty');
  assert.equal(compareTranscript([page([d(1)], long(5), true)], [page([d(1)], long(6), true)]).same, false, 'both unfinished');
  assert.equal(compareTranscript(done, [page([d(1)], long(0), false)]).same, false, 'nextBatch first');
  assert.equal(compareTranscript([page([d(1)], long(3), true), page([d(2)], long(0), false)], [page([d(1)], long(3), true), page([d(2)], long(0), true)]).same, false, 'firstBatch later');
  assert.equal(compareTranscript([page([d(1)], long(3), true), page([d(2)], long(0), false)], [page([d(1)], 'invalid', true), page([d(2)], long(0), false)], { unordered: true }).same, false, 'malformed intermediate id, unordered');
  assert.equal(compareTranscript([page([d(1)], long(0), true), page([], long(0), false)], [page([d(1)], long(0), true), page([], long(0), false)]).same, false, 'continues after exhaustion');
  const err = { ok: dbl(0.0), code: int(43), codeName: 'CursorNotFound', errmsg: 'x' };
  assert.deepEqual(compareTranscript([page([d(1)], long(3), true), err], [page([d(1)], long(4), true), { ...err, errmsg: 'y' }]), { same: true }, 'same error ending');
  assert.equal(compareTranscript([page([d(1)], long(3), true), err], [page([d(1)], long(4), true), { ...err, code: int(50) }]).same, false, 'different error ending');
});

test('teeth r2: S5 keeps a binary subtype', () => {
  const sig = sub => ({ ...findReply(), $clusterTime: { clusterTime: { $timestamp: { t: 1, i: 1 } }, signature: { hash: { $binary: { base64: 'AAAA', subType: sub } }, keyId: long(0) } } });
  assert.notDeepEqual(sessionShape(sig('00')), sessionShape(sig('04')));
  const other = sig('00'); other.$clusterTime.signature.hash.$binary.base64 = 'BBBB';
  assert.deepEqual(sessionShape(sig('00')), sessionShape(other));
});

test('negative control: the planted divergence applies to every reply shape and is always caught', () => {
  const idOnly = { cursor: { firstBatch: [{ _id: int(1) }, { _id: int(2) }], id: long(0), ns: 'exp010.c' }, ok: dbl(1.0) };
  const empty = { cursor: { firstBatch: [], id: long(0), ns: 'exp010.c' }, ok: dbl(1.0) };
  const transcript = [page([d(1)], long(3), true), page([d(2)], long(0), false)];
  for (const [name, reply, opts] of [['find', findReply()], ['id-only projection', idOnly], ['id-only unordered', idOnly, { unordered: true }], ['empty batch', empty],
    ['write', writeReply()], ['error', errorReply()], ['findAndModify', famReply()], ['findAndModify null value', { ...famReply(), value: null }]]) {
    const before = JSON.stringify(reply);
    assert.equal(compare(reply, plantDivergence(reply), opts).same, false, name);
    assert.equal(JSON.stringify(reply), before, `${name}: input untouched`);
  }
  assert.equal(compareTranscript(transcript, plantDivergence(transcript)).same, false, 'transcript');
  assert.equal(compareTranscript(transcript, plantDivergence(transcript), { unordered: true }).same, false, 'unordered transcript');
});
