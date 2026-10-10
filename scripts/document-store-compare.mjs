// EXP 010: the differential comparator. Given the reply a reference server and a candidate server returned for the
// same command (both as canonical Extended JSON, parsed), decide whether a client could tell them apart.
// Frozen by the pre-registration (sha256 in experiments/document-store/preregistration.json); a change is an amendment.
//
// What counts as the same (the pre-registered normalisation, nothing else):
//   - SESSION_METADATA (cluster time, operation time, replication op times, election id) is split off the reply.
//     Its values identify the server's clock and topology. P1 compares the rest of the reply; the metadata's
//     presence and shape are compared separately (secondary S5), never pooled into P1.
//   - `errmsg` is free text and is dropped everywhere. Every other error field (code, codeName, errorLabels,
//     keyPattern, keyValue, errInfo) is compared.
//   - A cursor id that is a canonical int64 ({"$numberLong": digits}) becomes 0 when it is zero and "<open>"
//     otherwise; any other cursor id value is compared as it is (a malformed id is a difference).
//   - Reply envelopes are compared as maps (drivers read fields by name). DOCUMENTS the server returns
//     (cursor batches, findAndModify `value`) are compared with key order significant: BSON documents are ordered.
//   - Types are compared exactly: canonical EJSON keeps {"$numberInt": "1"} and {"$numberDouble": "1.0"} distinct.
//   - A batch is compared as a multiset only when the case declares `unordered: true` (a query with no sort).
//   - A case that declares `drain: true` is compared as a transcript: the first reply and every getMore reply
//     until the cursor is exhausted. Equal length and pairwise equality, or it differs.
import assert from 'node:assert/strict';

export const SESSION_METADATA = Object.freeze(['$clusterTime', 'operationTime', 'electionId', 'opTime',
  'lastCommittedOpTime', '$configTime', '$topologyTime']);
export const DROPPED = Object.freeze(['errmsg']);
export const DOCUMENT_KEYS = Object.freeze(['firstBatch', 'nextBatch']);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = v => JSON.stringify(v);
// Code-unit order: a total order on distinct strings (localeCompare is not; it ties canonically equal Unicode).
const byCodeUnit = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

const cursorId = v => {
  if (isObj(v) && Object.keys(v).length === 1 && typeof v.$numberLong === 'string' && /^-?\d+$/.test(v.$numberLong)) {
    return /^-?0+$/.test(v.$numberLong) ? 0 : '<open>';
  }
  return v;
};

// Envelope: unordered map, session metadata and errmsg dropped. Inside a document payload: ordered, nothing dropped.
export function normalise(reply, path = []) {
  if (Array.isArray(reply)) return reply.map((v, i) => normalise(v, [...path, i]));
  if (!isObj(reply)) return reply;
  const out = {};
  for (const key of Object.keys(reply).sort()) {
    if (SESSION_METADATA.includes(key) || DROPPED.includes(key)) continue;
    const value = reply[key];
    if (key === 'id' && path[path.length - 1] === 'cursor') { out.id = cursorId(value); continue; }
    if (DOCUMENT_KEYS.includes(key) && Array.isArray(value)) { out[key] = value.map(document); continue; }
    if (key === 'value' && (isObj(value) || value === null) && 'lastErrorObject' in reply) { out.value = document(value); continue; }
    out[key] = normalise(value, [...path, key]);
  }
  return out;
}

// The session metadata's shape: which fields are present and the EJSON type of every leaf, never the values.
export function sessionShape(reply) {
  const shape = v => (Array.isArray(v) ? v.map(shape) : isObj(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, k.startsWith('$') && !isObj(v[k]) ? `<${k}>` : shape(v[k])]))
    : `<${v === null ? 'null' : typeof v}>`);
  return Object.fromEntries(SESSION_METADATA.filter(k => isObj(reply) && k in reply).map(k => [k, shape(reply[k])]));
}

// A returned document keeps its key order; wrap it so the envelope sort cannot touch it.
const document = doc => ({ $orderedDocument: doc === null ? null : JSON.stringify(doc) });

// Returns { same: true } or { same: false, reason } where reason names the first difference found.
export function compare(reference, candidate, { unordered = false } = {}) {
  const a = normalise(reference), b = normalise(candidate);
  if (unordered) for (const key of DOCUMENT_KEYS) {
    const pa = a.cursor?.[key], pb = b.cursor?.[key];
    if (Array.isArray(pa) && Array.isArray(pb)) {
      a.cursor[key] = [...pa].sort((x, y) => byCodeUnit(canonical(x), canonical(y)));
      b.cursor[key] = [...pb].sort((x, y) => byCodeUnit(canonical(x), canonical(y)));
    }
  }
  try {
    assert.deepStrictEqual(b, a);
    return { same: true };
  } catch (error) {
    return { same: false, reason: firstDifference(a, b, '') ?? String(error.message).split('\n')[0] };
  }
}

// A drained cursor: the replies to the command and to each getMore, in order. Unordered batches are compared as one
// multiset across the whole transcript (a server may split an unsorted result differently), the rest pairwise.
export function compareTranscript(reference, candidate, { unordered = false } = {}) {
  if (!Array.isArray(reference) || !Array.isArray(candidate)) return { same: false, reason: 'transcript is not a list' };
  if (unordered) {
    const docs = t => t.flatMap(r => normalise(r).cursor?.firstBatch ?? normalise(r).cursor?.nextBatch ?? []).map(canonical).sort(byCodeUnit);
    const da = docs(reference), db = docs(candidate);
    if (canonical(da) !== canonical(db)) return { same: false, reason: `drained documents differ (${da.length} vs ${db.length})` };
    // Everything but the batches and the cursor id (ns, ok, any error) must be the same set of envelopes.
    const envelopes = t => [...new Set(t.map(r => { const n = normalise(r); if (n.cursor) n.cursor = { ...n.cursor, firstBatch: undefined, nextBatch: undefined, id: undefined }; return canonical(n); }))].sort(byCodeUnit);
    if (canonical(envelopes(reference)) !== canonical(envelopes(candidate))) return { same: false, reason: 'drained reply envelopes differ' };
    const last = t => (t.length ? normalise(t[t.length - 1]).cursor?.id : undefined);
    return last(reference) === 0 && last(candidate) === 0 ? { same: true } : { same: false, reason: 'cursor not exhausted at the end of the transcript' };
  }
  if (reference.length !== candidate.length) return { same: false, reason: `transcript length ${reference.length} vs ${candidate.length}` };
  for (let i = 0; i < reference.length; i++) {
    const verdict = compare(reference[i], candidate[i]);
    if (!verdict.same) return { same: false, reason: `reply ${i}: ${verdict.reason}` };
  }
  return { same: true };
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
