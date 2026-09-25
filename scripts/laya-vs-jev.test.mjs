import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
// The laya-vs-jev recording runs on Apple silicon, not in CI. CI checks what was recorded: the corpus is intact,
// the output contract other pages read is kept, parity passed, and no credential-shaped text was committed.
const dir = new URL('../experiments/laya-vs-jev/', import.meta.url);
const corpusBytes = readFileSync(new URL('corpus.json', dir));
const corpus = JSON.parse(corpusBytes);
const resultsDir = new URL('results/', dir);
const results = readdirSync(resultsDir).filter(f => /^laya-mlx-\d{4}-\d{2}-\d{2}\.json$/.test(f));

test('laya-vs-jev corpus is balanced and every row has an expected answer', () => {
  assert(corpus.rows.length >= 45);
  const counts = {};
  for (const r of corpus.rows) counts[r.question.type] = (counts[r.question.type] || 0) + 1;
  assert.deepEqual(Object.keys(counts).sort(), ['choice', 'noul', 'score']);
  assert.equal(new Set(Object.values(counts)).size, 1, JSON.stringify(counts));
  for (const r of corpus.rows) assert.notEqual(r.expected, undefined, r.id);
});

test('laya-vs-jev recorded results keep the output contract', () => {
  assert(results.length > 0, 'no recorded results');
  const sha = createHash('sha256').update(corpusBytes).digest('hex');
  for (const file of results) {
    const raw = readFileSync(new URL(file, resultsDir), 'utf8');
    const d = JSON.parse(raw);
    for (const k of ['schemaVersion', 'measuredAt', 'machine', 'models', 'corpus', 'perModel', 'agreement', 'notes']) assert(k in d, `${file}: ${k}`);
    assert.equal(d.corpus.sha256, sha, `${file}: corpus changed after recording`);
    assert.equal(d.corpus.rows, corpus.rows.length);
    for (const m of d.models) for (const k of ['id', 'source', 'sha', 'license', 'backend']) assert(k in m, `${file}: models.${k}`);
    for (const [id, v] of Object.entries(d.perModel))
      for (const k of ['accuracy', 'calibratedAccuracy', 'p50Ms', 'p90Ms', 'maxMs', 'coldLoadS', 'costPer1kUsd']) assert(k in v, `${file}: ${id}.${k}`);
    assert('laya_vs_jev' in d.agreement);
    assert.equal(d.parity.passed, true, `${file}: parity did not pass`);
    assert.equal(d.parity.sameDecision, corpus.rows.length);
    assert(d.parity.maxTopProbDelta <= 0.01);
    assert.doesNotMatch(raw, /Bearer |sk_[A-Za-z0-9_-]{8,}|\/Users\//, `${file}: credential or local path`);
  }
});
