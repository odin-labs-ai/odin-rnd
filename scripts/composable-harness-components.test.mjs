import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, loadHarness } from '../harness/kernel.mjs';
import corpusAdapter from '../harness/services/corpus.mjs';
import mlxMemory from '../harness/services/mlxMemory.mjs';
import mlxModel from '../experiments/composable-harness/components/mlx-model.mjs';

// EXP 009 bundle 3 WO-01: the six components (lint, grep, mlx.model, yesno-gate, memo-cache, spend-counter) on the
// harness kernel. mlx.model runs the fake child (fixtures/fake-mlx.mjs, same protocol, no MLX): these tests never load
// a model. Real MLX runs happen only inside a held memory window (WO-05).

const DIR = 'experiments/composable-harness';
const FAKE = [process.execPath, `${DIR}/fixtures/fake-mlx.mjs`];
const STUB = { freePct: 74, totalGB: 128, swapUsedMB: 100, load1: 3, mlxServerPids: [] };
const NAMES = ['mlxMemory', 'lint', 'grep', 'mlx.model', 'memo-cache', 'yesno-gate', 'spend-counter'];
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function harnessDoc(pin = 'qwen3-practice-a') {
  return {
    schema: 'odin-rnd.harness.v1',
    components: [
      { module: 'harness/services/mlxMemory.mjs', config: { stub: STUB } },
      { module: `${DIR}/components/lint.mjs` },
      { module: `${DIR}/components/grep.mjs` },
      { module: `${DIR}/components/mlx-model.mjs`, config: { modelKey: pin, command: [...FAKE, '--model-key', pin, '--prefix-cache', '4'], prefixCache: 4 } },
      { module: `${DIR}/components/memo-cache.mjs` },
      { module: `${DIR}/components/yesno-gate.mjs` },
      { module: `${DIR}/components/spend-counter.mjs` },
    ],
  };
}
async function load(t) {
  const dir = mkdtempSync(join(tmpdir(), 'exp009-components-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'harness.json'), JSON.stringify(harnessDoc()));
  const { kernel } = await loadHarness(join(dir, 'harness.json'), { root: process.cwd(), strict: true });
  t.after(() => kernel.dispose());
  return kernel;
}
async function practiceItems(n = 20) {
  const k = new Kernel();
  await k.load(corpusAdapter);
  const items = k.service('corpus').items.filter((_, i) => i % 10 === 3).slice(0, n); // a fixed practice spread, both sets
  await k.dispose();
  return items;
}
async function evaluateAll(k, items) {
  const rows = [];
  for (const item of items) {
    const y = await k.service('yesno').decide(item);
    k.service('spend-counter').charge('yesno');
    rows.push({ id: item.id, lint: k.service('lint').decide(item).decision, grep: k.service('grep').decide(item).decision, yesno: y.decision, p: y.p });
  }
  return rows;
}

test('all six components load from harness.json and evaluate the 20 practice items; decisions are deterministic across two runs', async t => {
  const items = await practiceItems();
  assert.equal(items.length, 20);
  assert.ok(items.some(i => i.set === 'exp005') && items.some(i => i.set === 'exp008x'));
  const k1 = await load(t);
  assert.deepEqual(k1.census().map(r => `${r.name}:${r.status}`), NAMES.map(n => `${n}:active`));
  const a = await evaluateAll(k1, items);
  const k2 = await load(t);
  const b = await evaluateAll(k2, items);
  assert.deepEqual(a, b);
  assert.ok(a.every(r => /^\d+(\.\d{1,6})?$/.test(String(r.p))), 'p is rounded to 6 decimals');
  // A second pass in the same kernel is served by the memo, with the same decisions.
  const again = [];
  for (const item of items) again.push(await k1.service('yesno').decide(item));
  assert.ok(again.every(r => r.cached));
  assert.deepEqual(again.map(r => r.p), a.map(r => r.p));
  assert.deepEqual(k1.service('spend-counter').counts(), { yesno: 20 });
});

test('unloading mlx.model kills its own child (and only it), withdraws memo-cache and yesno-gate first, and leaves no key', async t => {
  const k = await load(t);
  const { pid } = k.service('mlx');
  assert.ok(alive(pid));
  await k.service('yesno').decide((await practiceItems(1))[0]);
  const order = [];
  const before = k.lifecycle.length;
  await k.unload('mlx.model');
  for (const l of k.lifecycle.slice(before)) if (l.op === 'deactivate') order.push(l.component);
  assert.deepEqual(order, ['yesno-gate', 'memo-cache', 'mlx.model']);
  assert.ok(!alive(pid), 'the child is gone');
  assert.ok(!k.services.has('mlx') && !k.services.has('memo') && !k.services.has('yesno'));
  assert.deepEqual(k.census().filter(r => r.status !== 'active').map(r => `${r.name}:${r.status}`).sort(), ['memo-cache:inactive: missing mlx', 'yesno-gate:inactive: missing mlx, missing memo']);
  assert.ok(alive(process.pid), 'the inverse never touched another process');
});

test('a pin swap through reconfigure drops every prefix-cache and memo key of the old pin', async t => {
  const k = await load(t);
  const items = await practiceItems(6);
  for (const i of items) await k.service('yesno').decide(i);
  const oldPid = k.service('mlx').pid;
  assert.equal(k.service('mlx').prefixKeys().length, 4, 'the mirror is the child\'s LRU (4)');
  assert.deepEqual(k.service('mlx').prefixKeys(), await k.service('mlx').childPrefixKeys());
  assert.ok(k.service('memo').keys().every(key => key.startsWith('qwen3-practice-a:')));
  const pin = 'llama-practice-b';
  await k.reconfigure('mlx.model', { modelKey: pin, command: [...FAKE, '--model-key', pin, '--prefix-cache', '4'], prefixCache: 4 });
  assert.ok(!alive(oldPid));
  assert.deepEqual(k.service('mlx').prefixKeys(), []);
  assert.deepEqual(k.service('memo').keys(), []);
  const r = await k.service('yesno').decide(items[0]);
  assert.equal(r.cached, false);
  assert.ok(k.service('mlx').prefixKeys().every(key => key.startsWith(`${pin}:`)));
  assert.ok(k.service('memo').keys().every(key => key.startsWith(`${pin}:`)));
});

test('mlx.model refuses to start when the memory gate is not clear, and names why', async () => {
  const k = new Kernel();
  await k.load(mlxMemory, { stub: { ...STUB, load1: 20 } });
  await k.load(mlxModel, { modelKey: 'x', command: [...FAKE, '--model-key', 'x'] });
  assert.match(k.census()[1].status, /^failed: memory gate not clear: load1 20 >= 12/);
  await k.dispose();
});

test('no component reads a labels file, and spend-counter has no network access', () => {
  const files = readdirSync(`${DIR}/components`);
  for (const f of files) {
    const src = readFileSync(`${DIR}/components/${f}`, 'utf8').replace(/^\s*(\/\/|#).*$/gm, '');
    assert.doesNotMatch(src, /labels[\w-]*\.json/, `${f} names a labels file`);
  }
  const spend = readFileSync(`${DIR}/components/spend-counter.mjs`, 'utf8');
  assert.doesNotMatch(spend, /\bimport\b[^;]*\b(node:https?|node:net|node:dgram|undici)\b|fetch\(/);
  // The MLX child installs EXP 008's audit-hook guard, which refuses to open any labels*.json.
  assert.match(readFileSync(`${DIR}/components/mlx_gate.py`, 'utf8'), /^install_guard\(\)$/m);
});
