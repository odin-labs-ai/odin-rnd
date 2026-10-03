import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { classify, CURRENT_PIN, PRE_PIN, SOURCES } from '../experiments/composable-harness/baseline/run-baseline.mjs';

// EXP 009 (composable harness) bundle 3 WO-04: the real-filter baseline record. The filter is private, so CI
// cannot re-run it; `run-baseline.mjs --check` re-runs it locally and must reproduce these bytes. Here every
// derived field is recomputed from the committed raw rows and the committed corpus, so the record cannot claim
// more than its own rows show.

const ROOT = 'experiments/composable-harness';
const CORPUS = `${ROOT}/corpus/authored`;
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const outputs = read(`${ROOT}/baseline/outputs.json`);
const summary = read(`${ROOT}/baseline/summary.json`);
const source = read(`${ROOT}/baseline/SOURCE.json`);
const index = read(`${CORPUS}/index.json`);
const configs = new Map(index.configs.map(r => [r.id, read(`${CORPUS}/${r.file}`)]));

test('one row per corpus config, labels and classes copied faithfully', () => {
  assert.equal(outputs.length, 120);
  assert.deepEqual(outputs.map(o => o.id), index.configs.map(r => r.id));
  for (const o of outputs) {
    const cfg = configs.get(o.id);
    assert.equal(o.label, cfg.label, o.id);
    assert.equal(o.faultClass, cfg.faultClass, o.id);
    assert.equal(o.floorEpoch, cfg.floorEpoch, o.id);
    const names = cfg.registry.map(p => p.name);
    assert.deepEqual([...o.retained, ...o.dropped].sort(), [...names].sort(), `${o.id} partitions the registry`);
  }
});

test('every derived baseline field recomputes from the raw rows', () => {
  for (const o of outputs) assert.deepEqual(o.baseline, classify(configs.get(o.id), o), o.id);
});

test('the summary recomputes from the rows', () => {
  const faulty = outputs.filter(o => o.label === 'faulty'), clean = outputs.filter(o => o.label === 'clean');
  const n = (rows, f) => rows.filter(f).length;
  assert.equal(summary.configs, 120);
  assert.equal(summary.faulty, faulty.length);
  assert.equal(summary.clean, clean.length);
  assert.equal(summary.filterAgreesWithSpecEnabledAtBoot, n(outputs, o => o.baseline.agreesWithSpecEnabledAtBoot));
  assert.equal(summary.faultySignalled, n(faulty, o => o.baseline.signalled));
  assert.equal(summary.cleanSignalled, n(clean, o => o.baseline.signalled));
  assert.equal(summary.faultyWithSilentInert, n(faulty, o => o.baseline.silentInert.length > 0));
  assert.equal(summary.faultyWithSilentDropped, n(faulty, o => o.baseline.silentDropped.length > 0));
  for (const [k, v] of Object.entries(summary.byFaultClass)) {
    assert.equal(v.n, n(faulty, o => o.faultClass === k), k);
    assert.equal(v.signalled, n(faulty, o => o.faultClass === k && o.baseline.signalled), k);
  }
});

test('the historical case reproduces: on the pre-floor pin q is dropped with no diagnostic', () => {
  const drops = outputs.filter(o => o.faultClass === 'floor-epoch-drop');
  assert.ok(drops.length >= 8);
  for (const o of drops) {
    assert.equal(o.floorEpoch, 'pre', o.id);
    assert.ok(o.dropped.includes('q'), `${o.id} q dropped`);
    assert.deepEqual(o.diagnostics, [], `${o.id} no diagnostic`);
  }
});

test('the record names the pinned commits and the source digests, and vendors no source', () => {
  assert.equal(source.pins.pre.commit, PRE_PIN);
  assert.equal(source.pins.current.commit, CURRENT_PIN);
  for (const pin of ['pre', 'current']) assert.deepEqual(Object.keys(source.pins[pin].sha256), SOURCES);
  assert.equal(source.pins.pre.sha256[SOURCES[0]], source.pins.current.sha256[SOURCES[0]], 'the filter itself is the same at both pins');
  assert.notEqual(source.pins.pre.sha256[SOURCES[1]], source.pins.current.sha256[SOURCES[1]], 'only the floor differs');
  assert.equal(source.corpusIndexSha256, createHash('sha256').update(readFileSync(`${CORPUS}/index.json`)).digest('hex'));
  const digests = new Set(Object.values(source.pins).flatMap(p => Object.values(p.sha256)));
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const f of walk(ROOT)) {
    assert.ok(!digests.has(createHash('sha256').update(readFileSync(f)).digest('hex')), `${f} is a copy of a private source file`);
  }
});

test('outputs carry synthetic names only', () => {
  const ok = /^(core-(0[1-9]|1\d|2[0-5])|q|q-release|q-resume|x-[a-z]+(-[a-z]+)*)$/;
  for (const o of outputs) for (const name of [...o.retained, ...o.dropped]) assert.match(name, ok, `${o.id}: ${name}`);
});
