// EXP 010: validates the pre-registration, experiments/document-store/preregistration.json. The authored text lives in
// the record; every fact about committed files (their sha256, the corpus counts per operation class, the used/unused
// split) is recomputed from disk and must equal what the record states. Same pattern as blueprint-floor-prereg.mjs.
//   node scripts/document-store-prereg.mjs --check   validate; print the record's sha256
//   node scripts/document-store-prereg.mjs --write   re-derive the disk-derived fields
//   node scripts/document-store-prereg.mjs --pin     after review, pin the record's sha256 in preregistration.sha256
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const D = 'experiments/document-store';
export const recordPath = `${D}/preregistration.json`;
export const pinPath = `${D}/preregistration.sha256`;
export const corpusPath = `${D}/corpus/cases.json`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The files the counted run depends on. Never the record itself or this validator.
export const PINNED = [corpusPath, 'scripts/document-store-compare.mjs', `${D}/CLEAN-ROOM.md`];
export const DECISION = Object.freeze({ adopt: 0.95, adoptAndBuild: 0.80 });

const hex = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const str = v => typeof v === 'string' && v.trim().length > 0;
const int = v => Number.isInteger(v) && v >= 0;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export const required = {
  schemaVersion: v => v === 1,
  kind: v => v === 'odin-rnd.preregistration',
  'experiment.id': v => v === 'EXP 010', 'experiment.slug': v => v === 'document-store',
  'experiment.title': str, 'experiment.summary': str, 'experiment.statusText': v => v === 'Pre-registered — not yet run',
  'experiment.authoredOn': v => /^\d{4}-\d{2}-\d{2}$/.test(v), 'experiment.note': str,
  'freeze.status': v => v === 'draft' || v === 'frozen', 'freeze.rule': str, 'freeze.toFreeze': v => Array.isArray(v),
  question: str, 'cleanRoom.file': v => v === `${D}/CLEAN-ROOM.md`, 'cleanRoom.statement': str,
  operations: v => Array.isArray(v) && v.length === 26 && v.every(o => /^O\d{2}$/.test(o.id) && str(o.name) && typeof o.usedByOdin === 'boolean' && str(o.evidence) && ['measured', 'secondary', 'excluded'].includes(o.inExperiment)),
  'arms.reference.image': str, 'arms.reference.digest': v => digest.test(v), 'arms.reference.licence': str, 'arms.reference.topology': str,
  'arms.candidate.images': v => Array.isArray(v) && v.length === 2 && v.every(i => str(i.image) && digest.test(i.digest) && str(i.licence)),
  'arms.candidate.topology': str,
  'driver.package': v => v === 'mongodb', 'driver.version': v => /^\d+\.\d+\.\d+$/.test(v), 'driver.integrity': v => /^sha512-[A-Za-z0-9+/]+=*$/.test(v), 'driver.licence': v => v === 'Apache-2.0',
  'corpus.file': v => v === corpusPath, 'corpus.sha256': v => hex.test(v), 'corpus.cases': int, 'corpus.usedCases': int, 'corpus.byOperation': obj, 'corpus.authoring': str,
  'comparator.file': v => v === 'scripts/document-store-compare.mjs', 'comparator.sha256': v => hex.test(v), 'comparator.normalisation': v => Array.isArray(v) && v.length > 0 && v.every(str), 'comparator.teeth': str,
  'controls.positive': str, 'controls.negative': str, 'controls.calibrationBar': str,
  'primary.P1.claim': str, 'primary.P1.n': int, 'primary.P1.metric': str, 'primary.P1.interval': str,
  'decision.adopt': v => v === DECISION.adopt, 'decision.adoptAndBuild': v => v === DECISION.adoptAndBuild, 'decision.rule': str, 'decision.refutedBy': str,
  secondary: v => Array.isArray(v) && v.length > 0 && v.every(s => str(s.id) && str(s.what)),
  'execution.where': str, 'execution.runner': str, 'execution.notBefore': str, 'execution.attempts': v => v === 1, 'execution.environment': str,
  'spend.capUsd': v => v === 0, 'spend.statement': str,
  limits: v => Array.isArray(v) && v.length > 0 && v.every(str),
  files: v => obj(v) && Object.keys(v).sort().join() === [...PINNED].sort().join() && Object.values(v).every(h => hex.test(h)),
  sources: v => Array.isArray(v) && v.length > 0 && v.every(s => str(s.id) && str(s.url) && s.url.startsWith('https://') && str(s.claim)),
};

export const get = (record, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), record);

// Everything the record states about the disk, recomputed.
export function derive(root = '.') {
  const read = p => readFileSync(`${root}/${p}`);
  const corpus = JSON.parse(read(corpusPath));
  const byOperation = {};
  for (const c of corpus.cases) byOperation[c.op] = (byOperation[c.op] ?? 0) + 1;
  return {
    files: Object.fromEntries(PINNED.map(p => [p, sha256(read(p))])),
    corpus: { sha256: sha256(read(corpusPath)), cases: corpus.cases.length, usedCases: corpus.cases.filter(c => c.usedByOdin).length, byOperation },
    comparator: { sha256: sha256(read('scripts/document-store-compare.mjs')) },
  };
}

export function validate(record, root = '.') {
  for (const [path, ok] of Object.entries(required)) assert.ok(ok(get(record, path)), `preregistration field ${path}`);
  const d = derive(root);
  assert.deepEqual(record.files, d.files, 'files: pinned sha256 differ from disk');
  assert.equal(record.corpus.sha256, d.corpus.sha256, 'corpus.sha256');
  assert.equal(record.corpus.cases, d.corpus.cases, 'corpus.cases');
  assert.equal(record.corpus.usedCases, d.corpus.usedCases, 'corpus.usedCases');
  assert.deepEqual(record.corpus.byOperation, d.corpus.byOperation, 'corpus.byOperation');
  assert.equal(record.comparator.sha256, d.comparator.sha256, 'comparator.sha256');
  assert.equal(record.primary.P1.n, d.corpus.usedCases, 'P1 n is the used-case count');
  // Every corpus case names a measured or not-used operation that the record lists; used flags agree.
  const ops = new Map(record.operations.map(o => [o.id, o]));
  const corpus = JSON.parse(readFileSync(`${root}/${corpusPath}`));
  for (const c of corpus.cases) {
    assert.ok(ops.has(c.op), `case ${c.id} names an unlisted operation`);
    assert.equal(c.usedByOdin, ops.get(c.op).usedByOdin, `case ${c.id} used flag disagrees with ${c.op}`);
    assert.notEqual(ops.get(c.op).inExperiment, 'excluded', `case ${c.id} runs an excluded operation`);
  }
  if (record.freeze.status === 'frozen') assert.equal(record.freeze.toFreeze.length, 0, 'a frozen record has no TO-FREEZE field');
  return sha256(readFileSync(`${root}/${recordPath}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (mode === '--write') {
    const d = derive();
    record.files = d.files;
    Object.assign(record.corpus, d.corpus);
    record.comparator.sha256 = d.comparator.sha256;
    record.primary.P1.n = d.corpus.usedCases;
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  }
  const hash = validate(JSON.parse(readFileSync(recordPath, 'utf8')));
  if (mode === '--pin') writeFileSync(pinPath, `${hash}  ${recordPath}\n`);
  console.log(hash);
}
