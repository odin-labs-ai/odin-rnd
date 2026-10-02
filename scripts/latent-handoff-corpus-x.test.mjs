// EXP 008-X corpus (WO-03): 140 new gate items against the EXP 005 base app. No model is called. bce is slow, so the
// full labels come from labels-x.json and a deterministic sample of 10 items is re-scored to prove they reproduce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE, CORPUS, EXPECTED_QUOTAS, HERE, RULES, TOTAL, MAX_DIFF_BYTES, assertPinned, loadExp005, scaledQuotas, stateOf,
} from '../experiments/latent-handoff/corpus-x/author-x.mjs';
import { BLUEPRINT, pinnedFiles } from '../experiments/latent-handoff/corpus-x/label-x.mjs';
import { overlap } from '../experiments/latent-handoff/corpus-x/overlap-x.mjs';
import { scoreX } from '../experiments/latent-handoff/corpus-x/baselines-x.mjs';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const json = name => JSON.parse(readFileSync(join(HERE, name), 'utf8'));
const manifest = json('manifest-x.json');
const index = json('corpus-x.json');
const labels = json('labels-x.json');
const patchFiles = readdirSync(CORPUS).filter(f => f.endsWith('.patch')).sort();
const expectedIds = Array.from({ length: TOTAL }, (_, k) => 'c' + String(61 + k).padStart(3, '0'));
const patchOf = id => readFileSync(join(CORPUS, id + '.patch'), 'utf8');

test('the EXP 005 modules the corpus depends on hash to their pins', () => {
  assert.doesNotThrow(() => assertPinned());
});

test('exactly 140 items, ids c061..c200, in every file', () => {
  assert.deepEqual(patchFiles, expectedIds.map(id => id + '.patch'));
  assert.deepEqual(manifest.items.map(i => i.id), expectedIds);
  assert.deepEqual(index.items.map(i => i.id), expectedIds);
  assert.deepEqual(labels.items.map(i => i.id), expectedIds);
  assert.equal(manifest.seed, 8008);
});

test('the quota table is corpus-spec.json scaled to 140, and the corpus meets it', () => {
  assert.deepEqual(scaledQuotas(), EXPECTED_QUOTAS);
  assert.deepEqual(index.quotas, EXPECTED_QUOTAS);
  const counts = {};
  for (const i of manifest.items) counts[i.family] = (counts[i.family] ?? 0) + 1;
  assert.deepEqual(counts, EXPECTED_QUOTAS);
  assert.equal(manifest.items.filter(i => i.intent === 'drift').length, 70);
  assert.equal(manifest.items.filter(i => i.nearMiss).length, 16 + 9 + 12);
});

test('every blueprint constraint is the target of at least 4 drift items', () => {
  const blueprint = JSON.parse(readFileSync(BLUEPRINT, 'utf8'));
  for (const c of blueprint.constraints) {
    const n = manifest.items.filter(i => i.intent === 'drift' && i.targets.includes(c.id)).length;
    assert.ok(n >= 4, `${c.id}: ${n}`);
  }
});

test('every patch applies to base/, is lint-clean and within the size cap; corpus-x.json hashes match', async () => {
  const { patchlib, lint } = await loadExp005();
  const rules = readFileSync(RULES, 'utf8');
  const cfg = lint.lintConfig();
  const byId = Object.fromEntries(index.items.map(i => [i.id, i]));
  for (const id of expectedIds) {
    const patch = patchOf(id);
    assert.ok(patchlib.appliesTo(BASE, patch), `${id} does not apply`);
    assert.deepEqual(lint.lintText(patch, `${id}.patch`, cfg), [], `${id} lint`);
    assert.ok(Buffer.byteLength(patch) <= MAX_DIFF_BYTES, `${id} size`);
    assert.equal(byId[id].patchSha256, sha256(patch));
    assert.equal(byId[id].stateSha256, sha256(stateOf(rules, patch)));
  }
});

test('corpus-x.sha256 verifies every pinned file', () => {
  const lines = readFileSync(join(HERE, 'corpus-x.sha256'), 'utf8').trim().split('\n');
  assert.deepEqual(lines.map(l => l.split('  ')[1]), pinnedFiles());
  for (const line of lines) {
    const [want, rel] = line.split('  ');
    assert.equal(sha256(readFileSync(join(HERE, rel))), want, rel);
  }
});

test('the overlap fence finds 0 shared fingerprints with EXP 005 and within 008-X', () => {
  const result = overlap();
  assert.equal(result.exp005Items, 60);
  assert.equal(result.xItems, 140);
  assert.deepEqual(result.collisions, []);
});

test('author-x.mjs --check regenerates the corpus byte for byte', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../experiments/latent-handoff/corpus-x/author-x.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.match(out, /corpus-x reproduces: 140 patches/);
});

test('labels-x.json: 70 RED, 70 GREEN, 0 EXCLUDED, 0 intent/bce disagreements', () => {
  assert.equal(labels.engine.version, '0.3.1');
  assert.equal(labels.blueprintSha256, sha256(readFileSync(BLUEPRINT)));
  assert.deepEqual({ RED: labels.counts.RED, GREEN: labels.counts.GREEN, EXCLUDED: labels.counts.EXCLUDED, disagree: labels.counts.disagree }, { RED: 70, GREEN: 70, EXCLUDED: 0, disagree: 0 });
  const intent = Object.fromEntries(manifest.items.map(i => [i.id, i.intent]));
  for (const l of labels.items) {
    assert.equal(l.label, intent[l.id] === 'drift' ? 'RED' : 'GREEN', l.id);
    assert.equal(l.disagree, false, l.id);
  }
});

test('a deterministic sample of 10 labels reproduces under bce', { timeout: 300_000 }, async () => {
  const { bce } = await loadExp005();
  const sample = expectedIds.filter((_, k) => k % 14 === 0);
  assert.equal(sample.length, 10);
  const byId = Object.fromEntries(labels.items.map(l => [l.id, l]));
  const scored = await bce.mapLimit(sample, 4, id => bce.scoreTree({ blueprint: BLUEPRINT, tree: BASE, patch: patchOf(id) }));
  sample.forEach((id, k) => {
    const r = scored[k];
    assert.deepEqual(
      { label: r.label, score: r.score, rules: r.rules, violations: r.violations.map(v => ({ rule: v.rule, ref: v.ref })) },
      { label: byId[id].label, score: byId[id].score, rules: byId[id].rules, violations: byId[id].violations }, id);
  });
});

test('the EXP 005 keyword grep stays well below 0.9 on 008-X', () => {
  const res = scoreX();
  assert.equal(res['heuristic-grep'].scored, 140);
  assert.ok(res['heuristic-grep'].accuracy < 0.9, `grep ${res['heuristic-grep'].accuracy}`);
});
