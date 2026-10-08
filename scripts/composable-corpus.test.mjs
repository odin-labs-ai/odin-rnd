import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeFreeze } from '../experiments/composable-harness/freeze.mjs';
import { scanTree } from './latent-handoff-private-terms.mjs';

// EXP 009 (composable harness) bundle 3 WO-03: the blind-authored P2 corpus and the blind H2 implementation.
// Both were written by history-free agents from corpus/SPEC.md and h2/SPEC.md alone (fence/author-*.json).
// This file does NOT trust the author's own verify.mjs: it re-derives every expected status from the spec
// rules with an independent implementation, so a label is correct by construction, not by the author's say-so.

const ROOT = 'experiments/composable-harness';
const DIR = `${ROOT}/corpus/authored`;
const FLOOR_PRE = Array.from({ length: 25 }, (_, i) => `core-${String(i + 1).padStart(2, '0')}`);
const FLOOR_CURRENT = [...FLOOR_PRE, 'q', 'q-release', 'q-resume'];
const Q_WIRING = { q: { needs: ['q.release', 'q.resume'], provides: [] }, 'q-release': { needs: [], provides: ['q.release'] }, 'q-resume': { needs: [], provides: ['q.resume'] } };
const CLASSES = ['floor-epoch-drop', 'missing-dependency-pair', 'missing-dependency', 'transitive-missing', 'provider-withdrawn', 'profile-typo'];

const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const configs = index.configs.map(row => ({ row, bytes: readFileSync(`${DIR}/${row.file}`), cfg: JSON.parse(readFileSync(`${DIR}/${row.file}`, 'utf8')) }));

// The spec's resolution rule: enabled = (profile null) ? all : floor(epoch) ∪ profile; active = least fixpoint of
// "enabled, every need provided by an active plugin". A withdrawn plugin is "as if it had been removed"; the spec
// did not name the status a removed plugin reports, and the author's documented reading (verify.mjs line 2) is
// `excluded`. That reading is adopted here and disclosed in NOTES.md; it changes no frozen byte.
function resolve(cfg, withdrawn) {
  const floor = new Set(cfg.floorEpoch === 'pre' ? FLOOR_PRE : FLOOR_CURRENT);
  const enabled = new Set(cfg.registry.filter(p => !withdrawn.has(p.name)
    && (cfg.profile === null || floor.has(p.name) || cfg.profile.enabledExtensions.includes(p.name))).map(p => p.name));
  const active = new Set();
  for (let changed = true; changed;) {
    changed = false;
    const provided = new Set(cfg.registry.filter(p => active.has(p.name) && !withdrawn.has(p.name)).flatMap(p => p.provides));
    for (const p of cfg.registry) {
      if (active.has(p.name) || !enabled.has(p.name)) continue;
      if (p.needs.every(k => provided.has(k))) { active.add(p.name); changed = true; }
    }
  }
  const provided = new Set(cfg.registry.filter(p => active.has(p.name) && !withdrawn.has(p.name)).flatMap(p => p.provides));
  const status = {};
  for (const p of cfg.registry) {
    if (!enabled.has(p.name)) status[p.name] = 'excluded';
    else if (active.has(p.name)) status[p.name] = 'active';
    else status[p.name] = `inactive: ${p.needs.filter(k => !provided.has(k)).sort().map(k => `missing ${k}`).join(', ')}`;
  }
  return status;
}

function finalStatus(cfg) {
  const withdrawn = new Set();
  for (const ev of [...cfg.schedule].sort((a, b) => a.step - b.step)) {
    if (ev.op === 'withdraw') withdrawn.add(ev.name); else if (ev.op === 'restore') withdrawn.delete(ev.name);
    else throw new Error(`${cfg.id}: unknown op ${ev.op}`);
  }
  return resolve(cfg, withdrawn);
}

test('exactly 120 configs, every index hash matches the file bytes', () => {
  const files = readdirSync(DIR).filter(f => /^cfg-\d{3}\.json$/.test(f));
  assert.equal(files.length, 120);
  assert.equal(configs.length, 120);
  for (const { row, bytes, cfg } of configs) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.id);
    assert.equal(cfg.id, row.id);
    assert.equal(cfg.label, row.label, row.id);
  }
});

test('expectedAtBoot and expected re-derive from the spec rules (independent oracle)', () => {
  for (const { cfg } of configs) {
    assert.deepEqual(cfg.expectedAtBoot, resolve(cfg, new Set()), `${cfg.id} expectedAtBoot`);
    assert.deepEqual(cfg.expected, finalStatus(cfg), `${cfg.id} expected`);
  }
});

test('every label follows from intended vs expected', () => {
  for (const { cfg } of configs) {
    const broken = cfg.intended.filter(n => cfg.expected[n] !== 'active');
    assert.equal(cfg.label, broken.length ? 'faulty' : 'clean', `${cfg.id}: broken intended = ${broken}`);
    assert.equal(cfg.faultClass === 'none', cfg.label === 'clean', cfg.id);
  }
});

test('60 faulty / 60 clean, every fault class used at least 8 times, the minimal historical shape at least 3 times', () => {
  assert.equal(configs.filter(c => c.cfg.label === 'faulty').length, 60);
  assert.equal(configs.filter(c => c.cfg.label === 'clean').length, 60);
  for (const k of CLASSES) assert.ok(configs.filter(c => c.cfg.faultClass === k).length >= 8, k);
  const minimal = configs.filter(({ cfg }) => cfg.faultClass === 'floor-epoch-drop'
    && cfg.registry.length === 28 && FLOOR_CURRENT.every(n => cfg.registry.some(p => p.name === n))
    && cfg.profile.enabledExtensions.every(n => !FLOOR_CURRENT.includes(n)));
  assert.ok(minimal.length >= 3, `minimal historical shape: ${minimal.length}`);
});

test('the q trio keeps its fixed wiring and the historical shape is what the class says', () => {
  for (const { cfg } of configs) {
    for (const p of cfg.registry) if (Q_WIRING[p.name]) {
      assert.deepEqual([...p.needs].sort(), Q_WIRING[p.name].needs, `${cfg.id} ${p.name} needs`);
      assert.deepEqual([...p.provides].sort(), Q_WIRING[p.name].provides, `${cfg.id} ${p.name} provides`);
    }
    if (cfg.faultClass === 'floor-epoch-drop') {
      assert.equal(cfg.floorEpoch, 'pre', cfg.id);
      assert.ok(cfg.intended.includes('q') && cfg.expected.q === 'excluded', cfg.id);
    }
  }
});

test('names are synthetic: core-NN, the q trio, or x-<word>; unique per registry', () => {
  const ok = /^(core-(0[1-9]|1\d|2[0-5])|q|q-release|q-resume|x-[a-z]+(-[a-z]+)*)$/;
  for (const { cfg } of configs) {
    const names = cfg.registry.map(p => p.name);
    assert.equal(new Set(names).size, names.length, `${cfg.id} duplicate`);
    for (const n of names) assert.match(n, ok, `${cfg.id}: ${n}`);
    assert.ok(names.length >= 6 && names.length <= 40, `${cfg.id} registry size ${names.length}`);
  }
});

test('the restricted-term tripwire finds nothing in the composable-harness tree', () => {
  assert.deepEqual(scanTree('.', undefined, [ROOT]), []);
});

test('both blind-author fences held', () => {
  for (const who of ['a', 'b']) {
    const log = JSON.parse(readFileSync(`${ROOT}/fence/author-${who}.json`, 'utf8'));
    assert.equal(log.verdict, 'FENCE-HELD', who);
    assert.equal(log.pathsOutsideFence, 0, who);
    assert.equal(log.forbiddenTermCalls, 0, who);
    assert.equal(log.tools.Read, 1, `${who} read only its SPEC.md`);
  }
});

test('the frozen digests match the committed FREEZE.json', () => {
  assert.deepEqual(JSON.parse(readFileSync(`${ROOT}/FREEZE.json`, 'utf8')), computeFreeze());
});
