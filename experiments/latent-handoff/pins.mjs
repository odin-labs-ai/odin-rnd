// EXP 008 (latent-handoff) model pins, bundle 3 WO-01.
//
// models.json pins every model by HF revision and by the sha256 of every file, plus the BF16 MLX conversion command
// (with the pinned mlx-lm version) and the sha256 of every converted file. Weights are never committed: they live in
// the cache root (LH_MODEL_CACHE, default ~/.cache/odin-rnd/latent-handoff).
//
//   node experiments/latent-handoff/pins.mjs --fetch <key>...    download a pinned revision (memory gate first);
//                                                               every file is checked against the HF tree oid
//   node experiments/latent-handoff/pins.mjs --convert <key>...  BF16 MLX conversion (memory gate first)
//   node experiments/latent-handoff/pins.mjs --record <key>...   write the hashes, geometry and vocab hash into models.json
//   node experiments/latent-handoff/pins.mjs --verify            recompute every hash, assert the geometry table and that
//                                                               the vocab hashes differ within every pair; exit 0 / 1
//
// The vocab hash is sha256 of the JSON array of base-vocabulary tokens ordered by id (tokenizer.json model.vocab;
// added/special tokens are excluded, so two tokenizers that share the BPE vocabulary hash equal).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitUntilClear } from './mem-gate.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const MODELS_PATH = join(HERE, 'models.json');
export const CACHE_ROOT = process.env.LH_MODEL_CACHE || join(homedir(), '.cache', 'odin-rnd', 'latent-handoff');
const PYTHON = process.env.LH_PYTHON || join(homedir(), 'ai-env', 'bin', 'python');

// The cache-geometry table of council FINAL-SHAPE (layers x KV heads x head dim). The verifier asserts each pinned
// model's config.json against it; a model absent from this table cannot be pinned.
export const EXPECTED_GEOMETRY = Object.freeze({
  'qwen3-1.7b': { layers: 28, kvHeads: 8, headDim: 128 },
  'llama-3.2-3b': { layers: 28, kvHeads: 8, headDim: 128 },
  'qwen3-4b': { layers: 36, kvHeads: 8, headDim: 128 },
  'llama-3.1-8b': { layers: 32, kvHeads: 8, headDim: 128 },
  'gemma-3-1b': { layers: 26, kvHeads: 1, headDim: 256 },
  'smollm3-3b': { layers: 36, kvHeads: 4, headDim: 128 }, // control only (shares Llama-3 ids)
});

export const INCLUDE = /(\.json|\.safetensors|\.txt|\.jinja|^tokenizer\.model|^LICENSE)$/;

export const sha256File = path => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(path).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', fail);
});
const gitBlobSha1 = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export const loadModels = (path = MODELS_PATH) => JSON.parse(readFileSync(path, 'utf8'));
const saveModels = (m, path = MODELS_PATH) => {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(m, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
};

export const hfDir = (key, root = CACHE_ROOT) => join(root, 'hf', key);
export const mlxDir = (key, root = CACHE_ROOT) => join(root, 'mlx', key);

export function geometryOf(config) {
  const c = config.text_config ?? config;
  return {
    layers: c.num_hidden_layers,
    kvHeads: c.num_key_value_heads ?? c.num_attention_heads,
    headDim: c.head_dim ?? c.hidden_size / c.num_attention_heads,
  };
}

/** Attention-layer count: every layer unless the config names non-attention layer types. */
export function attentionLayers(config) {
  const c = config.text_config ?? config;
  const types = c.layer_types ?? c.layers_block_type ?? c.hybrid_override_pattern;
  if (Array.isArray(types)) return types.filter(t => /attention/.test(t)).length;
  if (typeof types === 'string') return [...types].filter(t => t === '*').length;
  return c.num_hidden_layers;
}

export function vocabHash(tokenizerJson) {
  const v = tokenizerJson?.model?.vocab;
  let tokens;
  if (Array.isArray(v)) tokens = v.map(e => (Array.isArray(e) ? e[0] : e)); // unigram: index is the id
  else if (v && typeof v === 'object') {
    tokens = [];
    for (const [tok, id] of Object.entries(v)) tokens[id] = tok;
  } else throw new Error('tokenizer.json has no model.vocab');
  return { size: tokens.length, sha256: createHash('sha256').update(JSON.stringify(tokens)).digest('hex') };
}

export async function hashTree(dir) {
  const out = {};
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => {
    if (e.name.startsWith('.')) return [];
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  for (const p of walk(dir).sort()) out[relative(dir, p)] = await sha256File(p);
  return out;
}

// A pinned JSON file that no longer parses is a verification failure, never a crash.
const readJson = (errors, path, what) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { errors.push(`${what}: unreadable (${e.message})`); return null; }
};

const mismatch = (errors, what, want, got) => { if (want !== got) errors.push(`${what}: pinned ${want}, found ${got}`); };

/** Throws unless the two vocab hashes differ (the cross-tokenizer premise of every pair). */
export function assertVocabDiffers(pairName, a, b) {
  if (!a?.vocab?.sha256 || !b?.vocab?.sha256) throw new Error(`${pairName}: a vocab hash is missing`);
  if (a.vocab.sha256 === b.vocab.sha256) {
    throw new Error(`${pairName}: sender and receiver share vocab hash ${a.vocab.sha256.slice(0, 12)} — not a cross-tokenizer pair`);
  }
}

/** Recompute everything models.json claims. Returns the error list (empty = verified). */
export async function verify(models, { root = CACHE_ROOT } = {}) {
  const errors = [];
  for (const [key, m] of Object.entries(models.models)) {
    const want = EXPECTED_GEOMETRY[key];
    if (!want) { errors.push(`${key}: not in the FINAL-SHAPE geometry table`); continue; }
    const hd = hfDir(key, root);
    for (const [file, pinned] of Object.entries(m.files ?? {})) {
      const p = join(hd, file);
      if (!existsSync(p)) { errors.push(`${key}/${file}: missing from ${hd}`); continue; }
      mismatch(errors, `${key}/${file}`, pinned, await sha256File(p));
    }
    if (!m.files || Object.keys(m.files).length === 0) errors.push(`${key}: no pinned files`);
    const md = mlxDir(key, root);
    for (const [file, pinned] of Object.entries(m.convert?.files ?? {})) {
      const p = join(md, file);
      if (!existsSync(p)) { errors.push(`${key}/mlx/${file}: missing from ${md}`); continue; }
      mismatch(errors, `${key}/mlx/${file}`, pinned, await sha256File(p));
    }
    if (!m.convert?.files || Object.keys(m.convert.files).length === 0) errors.push(`${key}: no converted files pinned`);
    if (existsSync(join(hd, 'config.json'))) {
      const config = readJson(errors, join(hd, 'config.json'), `${key}/config.json`);
      const g = config ? geometryOf(config) : {};
      for (const k of ['layers', 'kvHeads', 'headDim']) {
        if (g[k] !== want[k]) errors.push(`${key}: ${k} ${g[k]} != FINAL-SHAPE ${want[k]}`);
        if (m.geometry?.[k] !== want[k]) errors.push(`${key}: models.json ${k} ${m.geometry?.[k]} != FINAL-SHAPE ${want[k]}`);
      }
    } else errors.push(`${key}: config.json missing from ${hd}`);
    if (existsSync(join(hd, 'tokenizer.json'))) {
      const tok = readJson(errors, join(hd, 'tokenizer.json'), `${key}/tokenizer.json`);
      if (tok) mismatch(errors, `${key} vocab hash`, m.vocab?.sha256, vocabHash(tok).sha256);
    } else errors.push(`${key}: tokenizer.json missing from ${hd}`);
  }
  for (const [name, p] of Object.entries(models.pairs)) {
    try { assertVocabDiffers(name, models.models[p.sender], models.models[p.receiver]); } catch (e) { errors.push(e.message); }
  }
  for (const [name, p] of Object.entries(models.controls ?? {})) {
    let threw = false;
    try { assertVocabDiffers(name, models.models[p.sender], models.models[p.receiver]); } catch { threw = true; }
    if (!threw) errors.push(`${name}: control pair was expected to fail the vocab assertion and did not`);
  }
  return errors;
}

// ---- fetch / convert / record (operator steps; their outputs are what --verify re-checks) -------------------------

async function hfTree(repo, revision) {
  const r = await fetch(`https://huggingface.co/api/models/${repo}/tree/${revision}?recursive=true`);
  if (!r.ok) throw new Error(`${repo}@${revision}: tree API ${r.status}`);
  return (await r.json()).filter(e => e.type === 'file' && INCLUDE.test(e.path.split('/').pop()) && !e.path.includes('/'));
}

export async function fetchModel(key, models, { root = CACHE_ROOT } = {}) {
  const m = models.models[key];
  const dir = hfDir(key, root);
  mkdirSync(dir, { recursive: true });
  const gate = await waitUntilClear({ untimed: true });
  if (!gate.ok) throw new Error(`memory gate not clear: ${gate.failures.join('; ')}`);
  for (const e of await hfTree(m.repo, m.revision)) {
    const dest = join(dir, e.path);
    const want = e.lfs?.oid;
    if (existsSync(dest) && statSync(dest).size === (e.lfs?.size ?? e.size)) {
      if (want ? (await sha256File(dest)) === want : gitBlobSha1(readFileSync(dest)) === e.oid) continue;
    }
    const url = `https://huggingface.co/${m.repo}/resolve/${m.revision}/${e.path}`;
    const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', `${dest}.part`, url], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${key}/${e.path}: curl exit ${r.status}`);
    if (want) {
      const got = await sha256File(`${dest}.part`);
      if (got !== want) throw new Error(`${key}/${e.path}: sha256 ${got} != HF lfs oid ${want}`);
    } else if (gitBlobSha1(readFileSync(`${dest}.part`)) !== e.oid) {
      throw new Error(`${key}/${e.path}: git blob oid mismatch`);
    }
    renameSync(`${dest}.part`, dest);
    process.stderr.write(`fetched ${key}/${e.path}\n`);
  }
}

export function convertArgv(key, root = CACHE_ROOT) {
  return [PYTHON, '-m', 'mlx_lm', 'convert', '--hf-path', hfDir(key, root), '--mlx-path', mlxDir(key, root), '--dtype', 'bfloat16'];
}

export async function convertModel(key, { root = CACHE_ROOT } = {}) {
  if (existsSync(mlxDir(key, root))) throw new Error(`${mlxDir(key, root)} exists; never overwrite a converted pin`);
  const gate = await waitUntilClear({ untimed: true });
  if (!gate.ok) throw new Error(`memory gate not clear: ${gate.failures.join('; ')}`);
  const [cmd, ...args] = convertArgv(key, root);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${key}: convert exit ${r.status}`);
}

export async function recordModel(key, models, { root = CACHE_ROOT, path = MODELS_PATH } = {}) {
  const m = models.models[key];
  const hd = hfDir(key, root);
  m.files = await hashTree(hd);
  const config = JSON.parse(readFileSync(join(hd, 'config.json'), 'utf8'));
  m.geometry = geometryOf(config);
  m.attentionLayers = attentionLayers(config);
  m.vocab = vocabHash(JSON.parse(readFileSync(join(hd, 'tokenizer.json'), 'utf8')));
  m.vocab.configVocabSize = (config.text_config ?? config).vocab_size;
  const md = mlxDir(key, root);
  if (existsSync(md)) {
    const files = await hashTree(md);
    const bytes = Object.keys(files).filter(f => f.endsWith('.safetensors')).reduce((s, f) => s + statSync(join(md, f)).size, 0);
    m.convert = {
      argv: ['python', '-m', 'mlx_lm', 'convert', '--hf-path', `<cache>/hf/${key}`, '--mlx-path', `<cache>/mlx/${key}`, '--dtype', 'bfloat16'],
      mlxLm: models.toolchain.mlxLm,
      files,
      weightsGB: Number((bytes / 2 ** 30).toFixed(3)),
    };
  }
  saveModels(models, path);
}

export function toolchain() {
  const r = spawnSync(PYTHON, ['-c', 'import mlx_lm, mlx.core as mx; print(mlx_lm.__version__, mx.__version__)'], { encoding: 'utf8' });
  const [mlxLm, mlx] = r.stdout.trim().split(' ');
  return { mlxLm, mlx };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--models'); // tests only: a fixture models.json (with LH_MODEL_CACHE as its cache root)
  const modelsPath = mi === -1 ? MODELS_PATH : resolve(argv.splice(mi, 2)[1]);
  const [verb, ...keys] = argv;
  const models = loadModels(modelsPath);
  try {
    if (verb === '--verify') {
      const errors = await verify(models);
      for (const e of errors) process.stdout.write(`FAIL ${e}\n`);
      process.stdout.write(errors.length ? `pins: ${errors.length} failure(s)\n` : `pins: verified ${Object.keys(models.models).length} models, ${Object.keys(models.pairs).length} pairs, ${Object.keys(models.controls ?? {}).length} controls\n`);
      process.exit(errors.length ? 1 : 0);
    }
    if (!['--fetch', '--convert', '--record'].includes(verb) || keys.length === 0) {
      process.stderr.write('usage: pins.mjs --verify | --fetch|--convert|--record <key>...\n');
      process.exit(2);
    }
    if (verb === '--record') {
      const tc = toolchain();
      if (tc.mlxLm !== models.toolchain.mlxLm || tc.mlx !== models.toolchain.mlx) {
        throw new Error(`toolchain ${JSON.stringify(tc)} != pinned ${JSON.stringify(models.toolchain)}`);
      }
    }
    for (const key of keys) {
      if (!models.models[key]) throw new Error(`unknown model key ${key}`);
      if (verb === '--fetch') await fetchModel(key, models);
      if (verb === '--convert') await convertModel(key);
      if (verb === '--record') await recordModel(key, models, { path: modelsPath });
    }
  } catch (e) {
    process.stderr.write(`pins: ${e.message}\n`);
    process.exit(1);
  }
}
