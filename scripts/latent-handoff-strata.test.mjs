// EXP 008 (latent-handoff) bundle 3 WO-02: the strata builder.
//   - two builds are byte-identical (manifest sha equal);
//   - every context passes the EXP 005 lint, and S is the EXP 005 gate state byte for byte;
//   - an L context outside 16K ±10% fails the build;
//   - a single mutated EXP 005 or EXP 008-X input byte fails the sha assertion.
// The CI tests use a deterministic stand-in counter (bytes / 3.5). With the pinned tokenizers in the local model cache,
// the committed manifest is also rebuilt for real and must hash identically.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { lintText } from '../experiments/jev-gate/lint.mjs';
import { assertCorpusX, assertExp005, build, CORPUS_X_DIR, JEV_DIR, MANIFEST_PATH, pythonCounter, sha256 } from '../experiments/latent-handoff/strata.mjs';

// Every temp dir this file makes is removed after the run (scripts/jev-gate-tempdirs.test.mjs).
const scratchDirs = [];
const scratch = prefix => { const d = mkdtempSync(join(tmpdir(), prefix)); scratchDirs.push(d); return d; };
after(() => { for (const d of scratchDirs) rmSync(d, { recursive: true, force: true }); });

const est = text => Math.round(Buffer.byteLength(text) / 3.5);
// `reportL` makes the stand-in report a fixed (wrong) L size, for the tolerance test.
function standIn(reportL = null) {
  return {
    meta: { qwen3: { model: 'stand-in' }, llama3: { model: 'stand-in' } },
    run(req) {
      const lines = req.distractor.split('\n');
      const items = req.items.map(it => {
        let lo = 0;
        let hi = lines.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (est(it.head + lines.slice(0, mid).join('\n') + it.tail) <= req.target) lo = mid; else hi = mid - 1;
        }
        const n = est(it.head + lines.slice(0, lo).join('\n') + it.tail);
        const bare = est(it.head + it.tail);
        return { id: it.id, lines: lo, tokens: { qwen3: n, llama3: n }, padTokens: { qwen3: n - bare, llama3: n - bare } };
      });
      if (reportL !== null) for (const i of items) i.tokens = { qwen3: reportL, llama3: reportL };
      return { items, counts: req.count.map(c => ({ id: c.id, tokens: { qwen3: est(c.text), llama3: est(c.text) } })) };
    },
  };
}

test('two builds are byte-identical', async () => {
  const a = await build({ counter: standIn(), lintText });
  const b = await build({ counter: standIn(), lintText });
  assert.equal(sha256(JSON.stringify(a.manifest)), sha256(JSON.stringify(b.manifest)));
  assert.equal(a.manifest.items.length, 200);
  assert.equal(a.manifest.items.filter(i => i.source === 'exp008x').length, 140);
  assert.equal(a.contexts.size, 600);
});

test('every context is lint-clean and S equals the EXP 005 gate state', async () => {
  const { manifest, contexts } = await build({ counter: standIn(), lintText });
  assert.equal(manifest.lint.findings, 0);
  for (const text of contexts.values()) assert.deepEqual(lintText(text, 'state:c001'), []);
  const inputs = JSON.parse(readFileSync(join(JEV_DIR, 'inputs.json'), 'utf8'));
  for (const item of inputs.items) assert.equal(contexts.get(`${item.id}.S`), item.state);
  for (const i of manifest.items) {
    assert.ok(i.strata.L.paddingShare.qwen3 > 0 && i.strata.L.paddingShare.qwen3 < 1);
    assert.equal(i.strata.M.paddingShare.qwen3, 0);
  }
});

test('an L context outside 16K ±10% fails the build', async () => {
  await assert.rejects(build({ counter: standIn(18000), lintText }), /outside 16K ±10%/);
});

test('a single mutated EXP 005 input byte fails the sha assertion', () => {
  for (const rel of ['corpus/c017.patch', 'base/src/domain/money.ts', 'rules.txt', 'inputs.json', 'corpus.sha256']) {
    const dir = scratch('lh-strata-');
    // never copy the answer key out of the tree
    cpSync(JEV_DIR, dir, { recursive: true, filter: src => !src.endsWith('labels.json') });
    const p = join(dir, rel);
    const b = readFileSync(p);
    b[Math.floor(b.length / 2)] ^= 0x01;
    writeFileSync(p, b);
    assert.throws(() => assertExp005(dir), /hashes to|bad line/, rel);
  }
  assert.doesNotThrow(() => assertExp005());
});

test('a single mutated EXP 008-X byte fails the sha assertion', () => {
  const rules = readFileSync(join(JEV_DIR, 'rules.txt'), 'utf8');
  for (const rel of ['corpus/c117.patch', 'corpus-x.json', 'corpus-x.sha256']) {
    const dir = scratch('lh-strata-x-');
    cpSync(CORPUS_X_DIR, dir, { recursive: true, filter: src => !/labels-x\.json$|manifest-x\.json$/.test(src) });
    const p = join(dir, rel);
    const b = readFileSync(p);
    b[Math.floor(b.length / 2)] ^= 0x01;
    writeFileSync(p, b);
    assert.throws(() => assertCorpusX(dir, rules), /hashes to|bad line|state sha/, rel);
  }
  assert.equal(assertCorpusX(CORPUS_X_DIR, rules).length, 140);
});

const MODELS = JSON.parse(readFileSync(new URL('../experiments/latent-handoff/models.json', import.meta.url), 'utf8'));
const haveTokenizers = existsSync(join(process.env.LH_MODEL_CACHE || join(homedir(), '.cache', 'odin-rnd', 'latent-handoff'), 'hf', 'llama-3.2-3b', 'tokenizer.json'));

test('with the pinned tokenizers: the committed manifest rebuilds byte-identically', { skip: !haveTokenizers && 'pinned tokenizers not in the local model cache' }, async () => {
  const { manifest } = await build({ counter: pythonCounter(MODELS), lintText });
  assert.equal(`${JSON.stringify(manifest, null, 2)}\n`, readFileSync(MANIFEST_PATH, 'utf8'));
});
