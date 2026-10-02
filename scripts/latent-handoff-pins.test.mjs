// EXP 008 (latent-handoff) bundle 3 WO-01: the pins verifier, on a synthetic fixture cache (no real weights).
//   - a clean fixture verifies;
//   - a single flipped byte in ANY pinned file (source or converted) fails it;
//   - the vocab assertion throws on a pair that shares a vocabulary (the SmolLM3 <-> Llama-3.2 control shape);
//   - a geometry that disagrees with the FINAL-SHAPE table fails it;
//   - the CLI exits non-zero on a flipped byte.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  assertVocabDiffers, EXPECTED_GEOMETRY, hashTree, hfDir, mlxDir, verify, vocabHash,
} from '../experiments/latent-handoff/pins.mjs';

// Every temp dir this file makes is removed after the run (scripts/jev-gate-tempdirs.test.mjs).
const scratchDirs = [];
const scratch = prefix => { const d = mkdtempSync(join(tmpdir(), prefix)); scratchDirs.push(d); return d; };
after(() => { for (const d of scratchDirs) rmSync(d, { recursive: true, force: true }); });

const PINS = 'experiments/latent-handoff/pins.mjs';

function tokenizer(words) {
  return { model: { type: 'BPE', vocab: Object.fromEntries(words.map((w, i) => [w, i])) }, added_tokens: [] };
}

async function fixture() {
  const root = scratch('lh-pins-');
  const vocabs = {
    'qwen3-1.7b': ['a', 'b', 'c', 'qwen'],
    'llama-3.2-3b': ['a', 'b', 'c', 'llama'],
    'smollm3-3b': ['a', 'b', 'c', 'llama'], // same base vocab as llama: the control must throw
  };
  const models = { schemaVersion: 1, toolchain: { mlxLm: 'x', mlx: 'y' }, models: {}, pairs: { D1: { sender: 'qwen3-1.7b', receiver: 'llama-3.2-3b' } }, controls: { ctl: { sender: 'smollm3-3b', receiver: 'llama-3.2-3b' } } };
  for (const [key, words] of Object.entries(vocabs)) {
    const g = EXPECTED_GEOMETRY[key];
    const hd = hfDir(key, root);
    const md = mlxDir(key, root);
    mkdirSync(hd, { recursive: true });
    mkdirSync(md, { recursive: true });
    const config = { num_hidden_layers: g.layers, num_key_value_heads: g.kvHeads, head_dim: g.headDim, num_attention_heads: 16, hidden_size: 2048 };
    writeFileSync(join(hd, 'config.json'), JSON.stringify(config));
    writeFileSync(join(hd, 'tokenizer.json'), JSON.stringify(tokenizer(words)));
    writeFileSync(join(hd, 'model.safetensors'), Buffer.from(`weights-${key}-`.repeat(64)));
    writeFileSync(join(md, 'model.safetensors'), Buffer.from(`mlx-${key}-`.repeat(64)));
    writeFileSync(join(md, 'config.json'), JSON.stringify(config));
    models.models[key] = {
      files: await hashTree(hd), geometry: { ...g }, vocab: vocabHash(tokenizer(words)), convert: { files: await hashTree(md) },
    };
  }
  const path = join(root, 'models.json');
  writeFileSync(path, JSON.stringify(models));
  return { root, models, path };
}

function flip(path) {
  const b = readFileSync(path);
  b[Math.floor(b.length / 2)] ^= 0x01;
  writeFileSync(path, b);
}

test('a clean fixture verifies', async () => {
  const { root, models } = await fixture();
  assert.deepEqual(await verify(models, { root }), []);
});

test('a single flipped byte in any pinned file fails the verifier', async () => {
  const { models } = await fixture();
  let cases = 0;
  for (const [key, m] of Object.entries(models.models)) {
    for (const [dirOf, files] of [[hfDir, m.files], [mlxDir, m.convert.files]]) {
      for (const file of Object.keys(files)) {
        const fresh = await fixture(); // a fresh cache per case, so one flip never masks another
        flip(join(dirOf(key, fresh.root), file));
        const errors = await verify(fresh.models, { root: fresh.root });
        assert.ok(errors.some(e => e.includes(`${key}/`) || e.includes(`${key} vocab`)), `${key}/${file}: ${errors}`);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 15); // 3 models x (3 source + 2 converted files)
});

test('the vocab assertion throws on a shared-vocabulary control pair', async () => {
  const { models } = await fixture();
  assert.throws(() => assertVocabDiffers('ctl', models.models['smollm3-3b'], models.models['llama-3.2-3b']), /share vocab hash/);
  assert.doesNotThrow(() => assertVocabDiffers('D1', models.models['qwen3-1.7b'], models.models['llama-3.2-3b']));
});

test('a control pair that does NOT throw is itself a failure', async () => {
  const { root, models } = await fixture();
  models.controls.ctl.sender = 'qwen3-1.7b';
  assert.ok((await verify(models, { root })).some(e => /control pair was expected/.test(e)));
});

test('a geometry off the FINAL-SHAPE table fails', async () => {
  const { root, models } = await fixture();
  const cfgPath = join(hfDir('llama-3.2-3b', root), 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.num_key_value_heads = 4;
  writeFileSync(cfgPath, JSON.stringify(cfg));
  models.models['llama-3.2-3b'].files = await hashTree(hfDir('llama-3.2-3b', root));
  assert.ok((await verify(models, { root })).some(e => /kvHeads 4 != FINAL-SHAPE 8/.test(e)));
});

test('the D1 geometry is 28x8x128 on both sides and D1-prime is 36x8x128 / 32x8x128', () => {
  assert.deepEqual(EXPECTED_GEOMETRY['qwen3-1.7b'], { layers: 28, kvHeads: 8, headDim: 128 });
  assert.deepEqual(EXPECTED_GEOMETRY['llama-3.2-3b'], { layers: 28, kvHeads: 8, headDim: 128 });
  assert.deepEqual(EXPECTED_GEOMETRY['qwen3-4b'], { layers: 36, kvHeads: 8, headDim: 128 });
  assert.deepEqual(EXPECTED_GEOMETRY['llama-3.1-8b'], { layers: 32, kvHeads: 8, headDim: 128 });
});

test('the CLI exits 0 on a clean fixture and 1 on a flipped byte', async () => {
  const { root, path } = await fixture();
  const env = { ...process.env, LH_MODEL_CACHE: root };
  assert.equal(spawnSync(process.execPath, [PINS, '--models', path, '--verify'], { env }).status, 0);
  flip(join(mlxDir('qwen3-1.7b', root), 'model.safetensors'));
  assert.equal(spawnSync(process.execPath, [PINS, '--models', path, '--verify'], { env }).status, 1);
});
