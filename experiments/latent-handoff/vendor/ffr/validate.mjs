#!/usr/bin/env node
// ffr.v1 validator — the gate every ffr.v1 producer must pass (factory-intelligence
// bundle-2 WO-01).
//
// The schema file (.claude/schemas/ffr.v1.schema.json) is interpreted directly
// by a small JSON Schema 2020-12 subset evaluator (the keywords the schema uses;
// an unsupported keyword is a hard error, never silently ignored), so the schema
// stays the single declarative source. On top of it, the rules JSON Schema
// cannot express:
//   NULL_REASON_MISSING      a null usage field without quality.nullReasons[<field>]
//   NULL_REASON_ORPHAN       a nullReason for a field that carries a number
//   ZERO_COST_NOT_MEASURED   costUsd 0 is valid only with costProvenance measured
//   COST_PROVENANCE_INCOHERENT  costUsd null <-> costProvenance unknown, both ways
//   FAMILY_UNKNOWN_STRING    modelFamily not declared in ffr-model-family.json
//   FAMILY_GUESS             modelFamily disagrees with the lookup (an unlisted
//                            model must be `unknown`, never a guessed family)
//
// The frozen identifier is ffr.v1@<sha12> of the schema file bytes. --self-test
// asserts the file still hashes to FROZEN_SCHEMA_SHA256: an edit to the schema
// fails the self-test until it ships as ffr.v1.x with a changelog entry.
//
// Usage:
//   node .claude/scripts/ffr/validate.mjs --self-test
//   node .claude/scripts/ffr/validate.mjs --id
//   node .claude/scripts/ffr/validate.mjs <rows.jsonl | ->   [--json]
// Exit: 0 every row valid | 1 one or more rows invalid, or self-test failure |
//       2 usage / IO / unreadable schema or lookup | 3 ZERO rows read (no data
//       is not a pass).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
export const SCHEMA_PATH = resolve(REPO, '.claude/schemas/ffr.v1.schema.json');
export const FAMILY_PATH = resolve(REPO, '.claude/config/ffr-model-family.json');
export const FROZEN_SCHEMA_SHA256 = 'ad3aec7c87bc43fef79d2e9fd8ae91b8df2898a5bb177e8064f4f7b72b48a8fe';
export const USAGE_NUMERIC = ['prefillTok', 'prefillMs', 'ttftMs', 'peakMemGB', 'costUsd'];

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function loadSchema(path = SCHEMA_PATH) {
  const bytes = readFileSync(path);
  return { schema: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
}

export function schemaId(path = SCHEMA_PATH) {
  return `ffr.v1@${loadSchema(path).sha256.slice(0, 12)}`;
}

export function loadFamilies(path = FAMILY_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw.families) || !raw.families.includes('unknown') || typeof raw.models !== 'object') {
    throw new Error(`${path}: families[] must include "unknown" and models{} must exist`);
  }
  for (const [m, f] of Object.entries(raw.models)) {
    if (!raw.families.includes(f)) throw new Error(`${path}: model ${m} maps to undeclared family ${f}`);
  }
  return { families: new Set(raw.families), models: raw.models };
}

// Exact lookup only. Absent -> "unknown". Never a prefix/substring guess.
export function familyFor(model, lookup) {
  if (model == null) return 'unknown';
  return Object.prototype.hasOwnProperty.call(lookup.models, model) ? lookup.models[model] : 'unknown';
}

// ---- JSON Schema 2020-12 subset evaluator ---------------------------------------------
const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'required',
  'properties', 'additionalProperties', 'propertyNames', 'minimum', 'minLength', 'maxLength',
  'items', 'uniqueItems', 'allOf', 'if', 'then', 'format',
]);
const DATE_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

export function evalSchema(s, v, path, errors) {
  for (const k of Object.keys(s)) {
    if (!SUPPORTED.has(k)) throw new Error(`schema keyword "${k}" at ${path || '/'} is not supported by this evaluator`);
  }
  const err = (code, msg) => errors.push({ code, path: path || '/', msg });
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(v, t))) { err('SCHEMA_TYPE', `expected ${types.join('|')}, got ${typeOf(v)}`); return; }
  }
  if ('const' in s && v !== s.const) err('SCHEMA_CONST', `expected ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) err('SCHEMA_ENUM', `${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`);
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) err('SCHEMA_PATTERN', `does not match ${s.pattern}`);
    if (s.minLength !== undefined && [...v].length < s.minLength) err('SCHEMA_LENGTH', `shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && [...v].length > s.maxLength) err('SCHEMA_LENGTH', `longer than ${s.maxLength}`);
    if (s.format === 'date-time' && (!DATE_TIME.test(v) || Number.isNaN(Date.parse(v)))) err('SCHEMA_FORMAT', 'not an RFC 3339 date-time');
  }
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) err('SCHEMA_MINIMUM', `below ${s.minimum}`);
  if (typeof v === 'number' && !Number.isFinite(v)) err('SCHEMA_TYPE', 'non-finite number');
  if (Array.isArray(v)) {
    if (s.items) v.forEach((x, i) => evalSchema(s.items, x, `${path}/${i}`, errors));
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) err('SCHEMA_UNIQUE', 'duplicate items');
  }
  if (typeOf(v) === 'object') {
    for (const r of s.required || []) if (!(r in v)) errors.push({ code: 'SCHEMA_REQUIRED', path: `${path}/${r}`, msg: 'required' });
    const props = s.properties || {};
    for (const [k, x] of Object.entries(v)) {
      if (s.propertyNames) evalSchema(s.propertyNames, k, `${path}/${k}`, errors);
      if (k in props) evalSchema(props[k], x, `${path}/${k}`, errors);
      else if (s.additionalProperties === false) errors.push({ code: 'SCHEMA_ADDITIONAL', path: `${path}/${k}`, msg: 'property not allowed' });
      else if (typeof s.additionalProperties === 'object') evalSchema(s.additionalProperties, x, `${path}/${k}`, errors);
    }
  }
  for (const sub of s.allOf || []) evalSchema(sub, v, path, errors);
  if (s.if) {
    const probe = [];
    evalSchema(s.if, v, path, probe);
    if (probe.length === 0 && s.then) evalSchema(s.then, v, path, errors);
  }
}

// ---- semantic rules ---------------------------------------------------------------------
function semantic(ev, lookup, errors) {
  const err = (code, path, msg) => errors.push({ code, path, msg });
  const reasons = (ev.quality && ev.quality.nullReasons) || {};
  const u = ev.usage;
  if (u && typeof u === 'object') {
    for (const f of USAGE_NUMERIC) {
      if (u[f] === null && !reasons[f]) err('NULL_REASON_MISSING', `/usage/${f}`, `null ${f} needs quality.nullReasons.${f}`);
      if (typeof u[f] === 'number' && reasons[f]) err('NULL_REASON_ORPHAN', `/quality/nullReasons/${f}`, `${f} is a number but has a nullReason`);
    }
    if (u.costUsd === 0 && u.costProvenance !== 'measured') err('ZERO_COST_NOT_MEASURED', '/usage/costUsd', `costUsd 0 with costProvenance ${u.costProvenance} (zero never means unknown)`);
    if (u.costUsd === null && u.costProvenance !== 'unknown') err('COST_PROVENANCE_INCOHERENT', '/usage/costProvenance', 'costUsd null requires costProvenance unknown');
    if (typeof u.costUsd === 'number' && u.costProvenance === 'unknown') err('COST_PROVENANCE_INCOHERENT', '/usage/costProvenance', 'a costUsd number cannot have costProvenance unknown');
  } else {
    for (const f of Object.keys(reasons)) err('NULL_REASON_ORPHAN', `/quality/nullReasons/${f}`, 'nullReason without a usage block');
  }
  const a = ev.actor;
  if (a && typeof a === 'object' && typeof a.modelFamily === 'string') {
    if (!lookup.families.has(a.modelFamily)) err('FAMILY_UNKNOWN_STRING', '/actor/modelFamily', `${a.modelFamily} is not a declared family`);
    else if (a.modelFamily !== familyFor(a.model, lookup)) err('FAMILY_GUESS', '/actor/modelFamily', `lookup says ${familyFor(a.model, lookup)} for model ${JSON.stringify(a.model)}`);
  }
}

export function makeValidator({ schemaPath = SCHEMA_PATH, familyPath = FAMILY_PATH } = {}) {
  const { schema } = loadSchema(schemaPath);
  const lookup = loadFamilies(familyPath);
  return function validateEvent(ev) {
    const errors = [];
    if (typeOf(ev) !== 'object') return { ok: false, errors: [{ code: 'SCHEMA_TYPE', path: '/', msg: 'row is not an object' }] };
    evalSchema(schema, ev, '', errors);
    semantic(ev, lookup, errors);
    return { ok: errors.length === 0, errors };
  };
}

// ---- self-test fixtures -------------------------------------------------------------------
const H = 'sha256:' + 'a'.repeat(64);
const SHA40 = 'b'.repeat(40);
function base(kind, extra = {}) {
  return {
    schemaVersion: 'ffr.v1', eventId: `fx-${kind}`, ts: '2026-10-01T07:00:00Z', source: 'fixture',
    sourceRowHash: H, runId: 'run-1', stepId: 'step-1', parentStepId: null, tier: 'T2', kind,
    actor: { model: 'claude-sonnet-5', modelFamily: 'claude' }, quality: { nullReasons: {} }, ...extra,
  };
}
const usage = (o = {}) => ({ prefillTok: 1200, prefillMs: 340, ttftMs: 410, peakMemGB: 12.5, costUsd: 0.012, costProvenance: 'measured', ...o });

export const FIXTURES = [
  { name: 'valid agent_step', expect: null, ev: base('agent_step', { agentStep: { taskType: 'code', durationMs: 5000 }, usage: usage() }) },
  { name: 'valid handoff kv-transferred', expect: null, ev: base('handoff', { handoff: { channel: 'kv-transferred', fromModel: 'Qwen3-Coder-Next-4bit', toModel: 'Qwen3.6-35B-A3B-4bit' }, actor: { model: 'Qwen3.6-35B-A3B-4bit', modelFamily: 'qwen' }, usage: usage({ costUsd: 0, costProvenance: 'measured' }) }) },
  { name: 'valid verdict', expect: null, ev: base('verdict', { actor: { model: null, modelFamily: 'unknown' }, verdict: { repo: 'odin-labs-ai/odin-labs', pr: 5204, headSha: SHA40, verdict: 'SHIP' } }) },
  { name: 'valid cost (upper-bound)', expect: null, ev: base('cost', { usage: usage({ prefillTok: null, prefillMs: null, ttftMs: null, peakMemGB: null, costUsd: 9, costProvenance: 'upper-bound' }), quality: { nullReasons: { prefillTok: 'not-recorded', prefillMs: 'not-recorded', ttftMs: 'not-recorded', peakMemGB: 'not-recorded' } } }) },
  { name: 'valid outcome', expect: null, ev: base('outcome', { actor: { model: null, modelFamily: 'unknown' }, outcome: { repo: 'odin-labs-ai/odin-labs', pr: 5204, headSha: SHA40, state: 'MERGED', mergedAt: '2026-10-01T08:00:00Z', headIsMergedHead: true } }) },
  { name: 'valid unlisted model maps to unknown', expect: null, ev: base('agent_step', { actor: { model: 'some/new-model', modelFamily: 'unknown' }, agentStep: { taskType: null }, usage: usage({ costUsd: null, costProvenance: 'unknown' }), quality: { nullReasons: { costUsd: 'not-recorded' } } }) },
  { name: 'zero-for-unknown cost', expect: 'ZERO_COST_NOT_MEASURED', ev: base('cost', { usage: usage({ costUsd: 0, costProvenance: 'unknown' }) }) },
  { name: 'zero cost marked estimated', expect: 'ZERO_COST_NOT_MEASURED', ev: base('cost', { usage: usage({ costUsd: 0, costProvenance: 'estimated' }) }) },
  { name: 'missing nullReason', expect: 'NULL_REASON_MISSING', ev: base('agent_step', { agentStep: { taskType: 'code' }, usage: usage({ ttftMs: null }) }) },
  { name: 'unknown kind', expect: 'SCHEMA_ENUM', path: '/kind', ev: base('thought', {}) },
  { name: 'unknown family string', expect: 'FAMILY_UNKNOWN_STRING', ev: base('verdict', { actor: { model: null, modelFamily: 'llama-ish' }, verdict: { repo: 'a/b', pr: 1, headSha: SHA40, verdict: 'SHIP' } }) },
  { name: 'guessed family for an unlisted model', expect: 'FAMILY_GUESS', ev: base('verdict', { actor: { model: 'anthropic/claude-unreleased', modelFamily: 'claude' }, verdict: { repo: 'a/b', pr: 1, headSha: SHA40, verdict: 'SHIP' } }) },
  { name: 'bad handoff.channel', expect: 'SCHEMA_ENUM', path: '/handoff/channel', ev: base('handoff', { handoff: { channel: 'telepathy', fromModel: null, toModel: null }, usage: usage() }) },
  { name: 'kind payload missing', expect: 'SCHEMA_REQUIRED', path: '/verdict', ev: base('verdict', {}) },
  { name: 'undeclared property', expect: 'SCHEMA_ADDITIONAL', path: '/prompt', ev: base('cost', { usage: usage(), prompt: 'free text is not allowed' }) },
  { name: 'cost number with provenance unknown', expect: 'COST_PROVENANCE_INCOHERENT', ev: base('cost', { usage: usage({ costUsd: 1.5, costProvenance: 'unknown' }) }) },
  { name: 'null cost marked measured', expect: 'COST_PROVENANCE_INCOHERENT', ev: base('cost', { usage: usage({ costUsd: null, costProvenance: 'measured' }), quality: { nullReasons: { costUsd: 'not-recorded' } } }) },
  { name: 'nullReason on a number', expect: 'NULL_REASON_ORPHAN', path: '/quality/nullReasons/ttftMs', ev: base('cost', { usage: usage(), quality: { nullReasons: { ttftMs: 'not-recorded' } } }) },
  { name: 'payload of another kind', expect: 'SCHEMA_CONST', path: '/kind', ev: base('cost', { usage: usage(), verdict: { repo: 'a/b', pr: 1, headSha: SHA40, verdict: 'SHIP' } }) },
  { name: 'MERGED outcome without mergedAt', expect: 'SCHEMA_TYPE', path: '/outcome/mergedAt', ev: base('outcome', { outcome: { repo: 'a/b', pr: 1, headSha: SHA40, state: 'MERGED', mergedAt: null, headIsMergedHead: null } }) },
  { name: 'tier outside the ladder', expect: 'SCHEMA_PATTERN', path: '/tier', ev: base('cost', { tier: 'T-router', usage: usage() }) },
];

export function selfTest({ log = console.log } = {}) {
  let failures = 0;
  const { sha256: actual } = loadSchema();
  if (actual !== FROZEN_SCHEMA_SHA256) {
    failures++;
    log(`FAIL frozen-sha: ${SCHEMA_PATH} hashes to ${actual}, frozen ${FROZEN_SCHEMA_SHA256}. A schema edit ships as ffr.v1.x with a changelog entry.`);
  } else log(`ok   frozen-sha ${schemaId()}`);
  const validate = makeValidator();
  if (FIXTURES.length < 12) { failures++; log(`FAIL fixture population ${FIXTURES.length} < 12`); }
  for (const fx of FIXTURES) {
    const r = validate(fx.ev);
    if (fx.expect === null) {
      if (r.ok) log(`ok   ${fx.name}`);
      else { failures++; log(`FAIL ${fx.name}: expected valid, got ${JSON.stringify(r.errors)}`); }
    } else {
      const hit = r.errors.find((e) => e.code === fx.expect && (!fx.path || e.path === fx.path));
      if (!r.ok && hit) log(`ok   ${fx.name} -> refused ${hit.code} ${hit.path}`);
      else { failures++; log(`FAIL ${fx.name}: expected ${fx.expect}${fx.path ? ' at ' + fx.path : ''}, got ${JSON.stringify(r.errors)}`); }
    }
  }
  log(failures === 0 ? `PASS self-test (${FIXTURES.length} fixtures)` : `FAIL self-test: ${failures} failure(s)`);
  return failures;
}

// ---- CLI ----------------------------------------------------------------------------------
function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--self-test')) return selfTest() === 0 ? 0 : 1;
  if (args.includes('--id')) { console.log(schemaId()); return 0; }
  const json = args.includes('--json');
  const files = args.filter((a) => a !== '--json');
  if (files.length !== 1) { console.error('usage: validate.mjs --self-test | --id | <rows.jsonl|-> [--json]'); return 2; }
  let text;
  try { text = readFileSync(files[0] === '-' ? 0 : files[0], 'utf8'); } catch (e) { console.error(`ERROR cannot read ${files[0]}: ${e.message}`); return 2; }
  let validate;
  try { validate = makeValidator(); } catch (e) { console.error(`ERROR ${e.message}`); return 2; }
  let n = 0; let bad = 0; const byCode = {};
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    n++;
    let ev;
    try { ev = JSON.parse(line); } catch { bad++; byCode.PARSE = (byCode.PARSE || 0) + 1; if (!json) console.log(`line ${i + 1}: PARSE not JSON`); return; }
    const r = validate(ev);
    if (!r.ok) {
      bad++;
      for (const e of r.errors) byCode[e.code] = (byCode[e.code] || 0) + 1;
      if (!json) console.log(`line ${i + 1}: ${r.errors.map((e) => `${e.code} ${e.path}`).join('; ')}`);
    }
  });
  const summary = { schema: schemaId(), rows: n, valid: n - bad, invalid: bad, byCode };
  console.log(json ? JSON.stringify(summary) : `${summary.schema}: ${n} rows, ${n - bad} valid, ${bad} invalid`);
  if (n === 0) { console.error('NO-DATA: zero rows read; no data is not a pass'); return 3; }
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
