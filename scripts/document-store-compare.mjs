// EXP 010: the differential comparator. Given the reply a reference server and a candidate server returned for the
// same command (both as canonical Extended JSON, parsed), decide whether a client could tell them apart.
// Frozen by the pre-registration (sha256 in experiments/document-store/preregistration.json); a change is an amendment.
//
// What counts as the same (the pre-registered normalisation, nothing else):
//   - SESSION_METADATA (cluster time, operation time, replication op times, election id) is split off the reply.
//     Its values identify the server's clock and topology. P1 compares the rest of the reply; the metadata's
//     presence and shape are compared separately (secondary S5), never pooled into P1.
//   - Both are dropped only where they are server-written envelope fields: session metadata at the reply's top
//     level, `errmsg` (free text) there and in each writeErrors entry and the writeConcernError. Inside a returned
//     document, keyPattern, keyValue or errInfo every field is compared, whatever its name.
//   - Every other error field (code, codeName, errorLabels, index, keyPattern, keyValue, errInfo) is compared;
//     keyPattern, keyValue and errInfo are documents, so their key order is significant.
//   - A cursor id that is a canonical int64 ({"$numberLong": digits}) becomes 0 when it is zero and "<open>"
//     otherwise; any other cursor id becomes {"$malformedCursorId": <its JSON>}, which equals no valid id.
//   - Reply envelopes are compared as maps (drivers read fields by name). DOCUMENTS the server returns
//     (cursor batches, findAndModify `value`) are compared with key order significant: BSON documents are ordered.
//   - Types are compared exactly: canonical EJSON keeps {"$numberInt": "1"} and {"$numberDouble": "1.0"} distinct.
//   - A batch is compared as a multiset only when the case declares `unordered: true` (a query with no sort).
//   - A case that declares `drain: true` is compared as a transcript: the first reply and every getMore reply
//     until the cursor is exhausted. Each transcript must be non-empty and well formed (firstBatch first, nextBatch
//     after, valid open ids before the end, and it ends exhausted or with an error reply); then equal length and
//     pairwise equality, or for an unordered case the same documents, envelopes and ending.
import assert from 'node:assert/strict';

export const SESSION_METADATA = Object.freeze(['$clusterTime', 'operationTime', 'electionId', 'opTime',
  'lastCommittedOpTime', '$configTime', '$topologyTime']);
export const DROPPED = Object.freeze(['errmsg']);
export const DOCUMENT_KEYS = Object.freeze(['firstBatch', 'nextBatch']);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = v => JSON.stringify(v);
// Code-unit order: a total order on distinct strings (localeCompare is not; it ties canonically equal Unicode).
const byCodeUnit = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

const validId = v => isObj(v) && Object.keys(v).length === 1 && typeof v.$numberLong === 'string' && /^-?\d+$/.test(v.$numberLong);
const cursorId = v => (validId(v) ? (/^-?0+$/.test(v.$numberLong) ? 0 : '<open>') : { $malformedCursorId: canonical(v) ?? 'undefined' });

// Where a server-written envelope field may be dropped: the reply's top level, a writeErrors entry, writeConcernError.
const isEnvelope = path => path.length === 0 || (path.length === 2 && path[0] === 'writeErrors') ||
  (path.length === 1 && path[0] === 'writeConcernError');
const ERROR_DOCUMENTS = Object.freeze(['keyPattern', 'keyValue', 'errInfo']);

// Envelope: unordered map, session metadata and errmsg dropped. Inside a document payload: ordered, nothing dropped.
export function normalise(reply, path = []) {
  if (Array.isArray(reply)) return reply.map((v, i) => normalise(v, [...path, i]));
  if (!isObj(reply)) return reply;
  const out = {};
  for (const key of Object.keys(reply).sort()) {
    if (path.length === 0 && SESSION_METADATA.includes(key)) continue;
    if (isEnvelope(path) && DROPPED.includes(key)) continue;
    const value = reply[key];
    if (ERROR_DOCUMENTS.includes(key) && path.length === 2 && path[0] === 'writeErrors') { out[key] = document(value); continue; }
    if (key === 'id' && path[path.length - 1] === 'cursor') { out.id = cursorId(value); continue; }
    if (DOCUMENT_KEYS.includes(key) && Array.isArray(value)) { out[key] = value.map(document); continue; }
    if (key === 'value' && (isObj(value) || value === null) && 'lastErrorObject' in reply) { out.value = document(value); continue; }
    out[key] = normalise(value, [...path, key]);
  }
  return out;
}

// The session metadata's shape: which fields are present and the EJSON type of every leaf, never the values.
export function sessionShape(reply) {
  // A binary's subType is a BSON type discriminator, not a value: it is kept.
  const shape = (v, parent) => (Array.isArray(v) ? v.map(x => shape(x)) : isObj(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, parent === '$binary' && k === 'subType' ? v[k]
      : k.startsWith('$') && !isObj(v[k]) ? `<${k}>` : shape(v[k], k)]))
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
// Why a transcript is not a well-formed drained cursor, or null when it is.
export function transcriptDefect(t) {
  if (!Array.isArray(t) || t.length === 0) return 'empty transcript';
  for (let i = 0; i < t.length; i++) {
    const r = t[i], last = i === t.length - 1;
    if (!isObj(r)) return `reply ${i} is not a document`;
    if (!isObj(r.cursor)) { if (last && 'code' in r) return null; return `reply ${i} has no cursor`; }
    const batch = i === 0 ? 'firstBatch' : 'nextBatch', other = i === 0 ? 'nextBatch' : 'firstBatch';
    if (!Array.isArray(r.cursor[batch]) || other in r.cursor) return `reply ${i} has no ${batch}`;
    if (!validId(r.cursor.id)) return `reply ${i} has a malformed cursor id`;
    const exhausted = cursorId(r.cursor.id) === 0;
    if (last && !exhausted) return 'cursor not exhausted at the end of the transcript';
    if (!last && exhausted) return `cursor exhausted at reply ${i} but the transcript continues`;
  }
  return null;
}

export function compareTranscript(reference, candidate, { unordered = false } = {}) {
  const ra = transcriptDefect(reference), rb = transcriptDefect(candidate);
  if (ra) return { same: false, reason: `reference transcript: ${ra}` };
  if (rb) return { same: false, reason: `candidate transcript: ${rb}` };
  if (unordered) {
    const docs = t => t.flatMap(r => normalise(r).cursor?.firstBatch ?? normalise(r).cursor?.nextBatch ?? []).map(canonical).sort(byCodeUnit);
    const da = docs(reference), db = docs(candidate);
    if (canonical(da) !== canonical(db)) return { same: false, reason: `drained documents differ (${da.length} vs ${db.length})` };
    // Everything but the batches and the cursor id (ns, ok, any error) must be the same set of envelopes.
    const envelopes = t => [...new Set(t.map(r => { const n = normalise(r); if (n.cursor) n.cursor = { ...n.cursor, firstBatch: undefined, nextBatch: undefined, id: undefined }; return canonical(n); }))].sort(byCodeUnit);
    if (canonical(envelopes(reference)) !== canonical(envelopes(candidate))) return { same: false, reason: 'drained reply envelopes differ' };
    const ending = t => canonical(isObj(t[t.length - 1].cursor) ? 'exhausted' : normalise(t[t.length - 1]));
    return ending(reference) === ending(candidate) ? { same: true } : { same: false, reason: 'transcripts end differently' };
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
