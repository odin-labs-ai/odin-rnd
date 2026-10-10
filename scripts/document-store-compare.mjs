// EXP 010: the differential comparator. Given the reply a reference server and a candidate server returned for the
// same command (both as canonical Extended JSON, parsed), decide whether a client could tell them apart.
// Frozen by the pre-registration (sha256 in experiments/document-store/preregistration.json); a change is an amendment.
//
// What counts as the same (the pre-registered normalisation, nothing else):
//   - Volatile envelope fields are dropped: see VOLATILE. They identify the server, the clock or the session, not
//     the answer to the command.
//   - An error is compared by `ok`, `code` and `codeName`; `errmsg` is free text and is dropped. Per-document write
//     errors are compared by `index`, `code` and `codeName`.
//   - A non-zero cursor id becomes the token "<open>"; 0 stays 0 (exhausted is observable, the value is not).
//   - Reply envelopes are compared as maps (drivers read fields by name). DOCUMENTS the server returns
//     (cursor batches, findAndModify `value`) are compared with key order significant: BSON documents are ordered.
//   - Types are compared exactly: canonical EJSON keeps {"$numberInt": "1"} and {"$numberDouble": "1.0"} distinct.
//   - A batch is compared as a multiset only when the case declares `unordered: true` (a query with no sort).
import assert from 'node:assert/strict';

export const VOLATILE = Object.freeze(['$clusterTime', 'operationTime', 'electionId', 'opTime', 'lastCommittedOpTime',
  '$configTime', '$topologyTime', 'readOnly', 'errmsg']);
export const DOCUMENT_KEYS = Object.freeze(['firstBatch', 'nextBatch']);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = v => JSON.stringify(v);

// Envelope: unordered map, volatile keys dropped. Inside a document payload: ordered, nothing dropped.
export function normalise(reply, path = []) {
  if (Array.isArray(reply)) return reply.map((v, i) => normalise(v, [...path, i]));
  if (!isObj(reply)) return reply;
  const out = {};
  for (const key of Object.keys(reply).sort()) {
    if (VOLATILE.includes(key)) continue;
    const value = reply[key];
    if (key === 'id' && path[path.length - 1] === 'cursor') { out.id = isZero(value) ? 0 : '<open>'; continue; }
    if (DOCUMENT_KEYS.includes(key) && Array.isArray(value)) { out[key] = value.map(document); continue; }
    if (key === 'value' && (isObj(value) || value === null) && 'lastErrorObject' in reply) { out.value = document(value); continue; }
    if (key === 'writeErrors' && Array.isArray(value)) { out.writeErrors = value.map(e => ({ index: e.index, code: e.code, codeName: e.codeName })); continue; }
    out[key] = normalise(value, [...path, key]);
  }
  return out;
}

const isZero = v => v === 0 || (isObj(v) && ['$numberLong', '$numberInt'].some(k => v[k] === '0'));

// A returned document keeps its key order; wrap it so the envelope sort cannot touch it.
const document = doc => ({ $orderedDocument: doc === null ? null : JSON.stringify(doc) });

// Returns { same: true } or { same: false, reason } where reason names the first difference found.
export function compare(reference, candidate, { unordered = false } = {}) {
  const a = normalise(reference), b = normalise(candidate);
  if (unordered) for (const key of DOCUMENT_KEYS) {
    const pa = a.cursor?.[key], pb = b.cursor?.[key];
    if (Array.isArray(pa) && Array.isArray(pb)) {
      a.cursor[key] = [...pa].sort((x, y) => canonical(x).localeCompare(canonical(y)));
      b.cursor[key] = [...pb].sort((x, y) => canonical(x).localeCompare(canonical(y)));
    }
  }
  try {
    assert.deepStrictEqual(b, a);
    return { same: true };
  } catch (error) {
    return { same: false, reason: firstDifference(a, b, '') ?? String(error.message).split('\n')[0] };
  }
}

function firstDifference(a, b, at) {
  if (canonical(a) === canonical(b)) return null;
  if (isObj(a) && isObj(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in b)) return `missing ${at}.${key}`;
      if (!(key in a)) return `extra ${at}.${key}`;
      const d = firstDifference(a[key], b[key], `${at}.${key}`);
      if (d) return d;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `length ${at}: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDifference(a[i], b[i], `${at}[${i}]`); if (d) return d; }
  }
  return `value ${at || '.'}`;
}
