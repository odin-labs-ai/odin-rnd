import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../harness/kernel.mjs';
import corpusAdapter from '../harness/services/corpus.mjs';
import { SPEC, observe, serialise } from '../experiments/composable-harness/probes/observe.mjs';
import { LEAKS, cleanupPlanted, detect } from '../experiments/composable-harness/probes/leaks.mjs';

// EXP 009 bundle 3 WO-02: the frozen observation set O and the teeth controls. K1 (12 planted leaks) must be seen by
// at least 11 of 12 probes on practice items; K2 (the same changes reified through ctx.effect) must leave no residue;
// two identical observations serialise byte-identically. Runs on the fake MLX child: no model is loaded.

const DIR = 'experiments/composable-harness/probes';
let items;
test.before(async () => {
  const k = new Kernel();
  await k.load(corpusAdapter);
  items = k.service('corpus').items.filter((_, i) => i % 10 === 3).slice(0, 20); // the practice spread (WO-01)
  await k.dispose();
});

test('O is one JSON spec with a sha256 for the prereg file map, and observe() reads exactly its probes', async () => {
  const bytes = readFileSync(`${DIR}/observation-set.json`);
  assert.match(createHash('sha256').update(bytes).digest('hex'), /^[0-9a-f]{64}$/);
  const scratch = mkdtempSync(join(tmpdir(), 'exp009-o-'));
  try {
    const o = await observe(new Kernel(), { scratch, baseGlobals: Object.keys(globalThis) });
    assert.deepEqual(Object.keys(o.inside).sort(), Object.keys(SPEC.inside).sort());
    assert.deepEqual(Object.keys(o.outside).sort(), Object.keys(SPEC.outside).sort());
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('probe output is byte-stable across two identical runs (no pid, no time)', async () => {
  const run = async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'exp009-o-'));
    mkdirSync(join(scratch, 'sub'));
    try { return serialise(await observe(new Kernel(), { scratch, baseGlobals: Object.keys(globalThis) })); } finally { rmSync(scratch, { recursive: true, force: true }); }
  };
  const a = await run(), b = await run();
  assert.equal(a, b);
  assert.doesNotMatch(a, new RegExp(`\\b${process.pid}\\b`));
});

test('K1: the probes see at least 11 of the 12 planted leaks, each on its pre-registered probe', { timeout: 300_000 }, async () => {
  assert.equal(LEAKS.length, 12);
  const seen = [];
  for (const leak of LEAKS) {
    const r = await detect(leak, { reified: false, items });
    await cleanupPlanted();
    if (r.residue.some(p => p === r.expected || p.startsWith(`${r.expected}.`))) seen.push(leak.id);
    else console.log(`K1 ${leak.id}: not seen on ${r.expected}; residue ${JSON.stringify(r.residue)}`);
  }
  assert.ok(seen.length >= 11, `K1 detected ${seen.length}/12: ${seen.join(', ')}`);
  console.log(`K1 detected ${seen.length}/12`);
});

test('K2: the same twelve changes routed through ctx.effect leave no residue on any probe', { timeout: 300_000 }, async () => {
  for (const leak of LEAKS) {
    const r = await detect(leak, { reified: true, items });
    assert.deepEqual(r.residue, [], `K2 ${leak.id}`);
  }
});
