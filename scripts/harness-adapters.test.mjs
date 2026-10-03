import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, defineComponent, loadHarness } from '../harness/kernel.mjs';
import pins from '../harness/services/pins.mjs';
import clock from '../harness/services/clock.mjs';
import corpus from '../harness/services/corpus.mjs';
import fence from '../harness/services/fence.mjs';
import mlxMemory from '../harness/services/mlxMemory.mjs';
import spend from '../harness/services/spend.mjs';
import ffr from '../harness/services/ffr.mjs';
import { decideFence6 } from '../experiments/nina-changes/fence6.mjs';
import { rngFor, armOrder } from '../experiments/latent-handoff/timing.mjs';
import { validator } from '../experiments/latent-handoff/ffr8.mjs';

// Bundle 2 WO-03: seven import-only service adapters over the frozen EXP 005/006/008 modules. Each is a kernel
// component; none edits what it imports (the census test holds every bound byte), and the one module-private symbol
// set they need is vendored byte-identically (slice test below).

const ADAPTERS = ['pins', 'clock', 'corpus', 'fence', 'mlxMemory', 'spend', 'ffr'];
const STUB = { freePct: 74, totalGB: 128, swapUsedMB: 100, load1: 3, mlxServerPids: [] };
const tmp = prefix => mkdtempSync(join(tmpdir(), prefix));
const sha256 = b => createHash('sha256').update(b).digest('hex');
const KEYS = { 'ffr-event': 'emission', 'spend-line': 'emission' };

test('all seven adapters load from a harness.json under the kernel, strict, with their declared provides', async t => {
  const dir = tmp('harness-adapters-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const doc = {
    schema: 'odin-rnd.harness.v1', keys: KEYS,
    components: ADAPTERS.map(n => ({ module: `harness/services/${n}.mjs`, name: n, config: {
      clock: { mode: 'fixed', at: '2026-10-03T00:00:00Z', seed: 9 }, mlxMemory: { stub: STUB }, spend: { experiment: 'exp008', ledger: join(dir, 'ledger.jsonl') },
    }[n] ?? {} })),
  };
  writeFileSync(join(dir, 'harness.json'), JSON.stringify(doc));
  const dry = await loadHarness(join(dir, 'harness.json'), { root: process.cwd(), dryRun: true });
  assert.deepEqual(dry.plan, { order: ADAPTERS, unsatisfied: {}, illTyped: [] });
  const { kernel } = await loadHarness(join(dir, 'harness.json'), { root: process.cwd(), strict: true });
  assert.deepEqual(kernel.census().map(r => `${r.name}:${r.status}:${r.provides}`), ADAPTERS.map(n => `${n}:active:${n}`));
  await kernel.dispose();
  assert.deepEqual(kernel.snapshot(), new Kernel().snapshot());
});

test('mlxMemory: the gate reads through EXP 008 mem-gate, and its withdrawal deactivates an MLX-dependent component first', async () => {
  const log = [];
  const k = new Kernel();
  const model = defineComponent({ name: 'mlx.model', inject: ['mlxMemory'], async apply(ctx) {
    assert.equal(ctx.inject.mlxMemory.check().ok, true);
    await ctx.effect(() => log.push('model up'), () => log.push('model down'));
  } });
  await k.load(model);
  assert.equal(k.census()[0].status, 'inactive: missing mlxMemory');
  await k.load(mlxMemory, { stub: STUB });
  const m = k.service('mlxMemory');
  assert.deepEqual(m.check().failures, []);
  assert.deepEqual(m.judge({ ...m.read(), freePct: 30, load1: 20 }).failures, ['free 30% < 50%', 'load1 20 >= 12']);
  await k.unload('mlxMemory');
  assert.deepEqual(log, ['model up', 'model down']);
  assert.equal(k.census()[0].status, 'inactive: missing mlxMemory');
  await k.load(mlxMemory, { stub: { ...STUB, mlxServerPids: ['123'] }, gate: { minFreePct: 80 } });
  assert.deepEqual(k.service('mlxMemory').check().failures, ['free 74% < 80%', 'mlx_lm.server resident (1)']);
  await k.dispose();
});

test('pins: EXP 008 models.json and the frozen census, read through the published modules', async () => {
  const k = new Kernel();
  await k.load(pins);
  const p = k.service('pins');
  assert.ok(Object.keys(p.models.models).length >= 2);
  assert.deepEqual(p.geometry['qwen3-1.7b'], { layers: 28, kvHeads: 8, headDim: 128 });
  assert.deepEqual(p.frozen().violations, []);
  await k.dispose();
});

test('clock: a fixed clock steps, not-before reads the published EXP 005 freeze times, and the stream is EXP 008 timing', async () => {
  const k = new Kernel();
  await k.load(clock, { mode: 'fixed', at: '2026-09-28T18:36:48Z', stepMs: 1000, seed: 'x' });
  const c = k.service('clock');
  assert.equal(c.iso(), '2026-09-28T18:36:48.000Z');
  assert.equal(c.notBefore('exp005-amendment-02'), true, 'the second reading (18:36:50) is past 18:36:49');
  assert.equal(c.rng('c001')(), rngFor('x', 'c001')());
  assert.deepEqual(c.armOrder(['A0', 'A1', 'C1'], 'c001'), armOrder(['A0', 'A1', 'C1'], 'x', 'c001'));
  await k.reconfigure('clock', { mode: 'system' });
  assert.throws(() => k.service('clock').rng('c001'), /no seed configured/);
  const k2 = new Kernel();
  await k2.load(clock, { mode: 'fixed' });
  assert.match(k2.census()[0].status, /failed: a fixed clock needs an ISO `at`/);
  await k.dispose();
});

test('corpus: EXP 005 (60) plus EXP 008-X (140) = 200 label-free states, each asserted by its sha256', async () => {
  const k = new Kernel();
  await k.load(corpus);
  const c = k.service('corpus');
  assert.equal(c.items.length, 200);
  assert.equal(c.items.filter(i => i.set === 'exp005').length, 60);
  assert.equal(c.items.filter(i => i.set === 'exp008x').length, 140);
  for (const i of c.items) assert.equal(sha256(i.state), i.stateSha256);
  assert.match(c.sha256, /^[0-9a-f]{64}$/);
  await k.reconfigure('corpus', { sets: ['exp005'] });
  assert.equal(k.service('corpus').items.length, 60);
  const src = readFileSync('harness/services/corpus.mjs', 'utf8');
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ''), /labels|label\b/, 'the corpus adapter never opens a labels file');
  await k.dispose();
});

test('fence: decisions are EXP 006 fence6\'s own', async () => {
  const k = new Kernel();
  await k.load(fence);
  const f = k.service('fence');
  for (const cmd of ['git diff', 'git status && git diff', 'cat /etc/passwd', 'git diff > out.txt']) assert.deepEqual(f.decide(cmd), decideFence6(cmd));
  assert.equal(f.decide('git -C /w/repo diff', '/w/repo').allowed, true);
  assert.equal(f.decide('git -C /other/repo diff', '/w/repo').allowed, false);
  assert.equal(f.decide('cat x').allowed, false);
  await k.dispose();
});

test('spend: each experiment keeps its own guard and ledger; every line it writes is mirrored as an append-only emission', async t => {
  const dir = tmp('harness-spend-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = [];
  const k8 = new Kernel({ keys: KEYS, sinks: { 'spend-line': r => rows.push(r) } });
  await k8.load(spend, { experiment: 'exp008', ledger: join(dir, 'l8.jsonl') });
  const s8 = k8.service('spend');
  const rid = await s8.reserve(2, 'b2', 'test');
  await s8.settle(rid, 1.25);
  await assert.rejects(s8.reserve(0, 'b2', 'zero'), /never a \$0 line/);
  assert.deepEqual(s8.state(), { totalUsd: 1.25, largestUsd: 1.25 });
  assert.deepEqual(rows.map(r => `${r.experiment}:${r.kind}`), ['exp008:reserve', 'exp008:actual']);
  assert.ok(!existsSync('experiments/latent-handoff/spend-ledger.jsonl') || !readFileSync('experiments/latent-handoff/spend-ledger.jsonl', 'utf8').includes(rid), 'no mirror into the experiment tree');
  await k8.unload('spend');
  assert.equal(readFileSync(join(dir, 'l8.jsonl'), 'utf8').trim().split('\n').length, 2, 'unload never removes a ledger line');
  assert.equal(k8.emissions.get('spend-line').length, 2, 'nor an emission');

  const k6 = new Kernel({ keys: KEYS });
  await k6.load(spend, { experiment: 'exp006', ledger: join(dir, 'l6.jsonl') });
  const s6 = k6.service('spend');
  assert.equal(s6.check('practice').ok, true);
  const line = s6.record({ ts: '2026-10-03T00:00:00Z', kind: 'practice', id: 'p', run: 1, reportedCostUsd: 0.1234567 });
  assert.equal(line.costUsd, 0.1234567);
  assert.equal(s6.total(), 0.1234567);
  assert.equal(k6.emissions.get('spend-line')[0].experiment, 'exp006');
  assert.ok(!('state' in s6) && !('reserve' in s6), 'spend6 and spend8 semantics are never merged');
  const bad = new Kernel({ keys: KEYS });
  await bad.load(spend, { experiment: 'exp006' });
  assert.match(bad.census()[0].status, /a ledger path is required/);
  await k6.dispose();
});

test('ffr: every event the adapter records validates against the vendored ffr.v1 schema, unchanged', async () => {
  const k = new Kernel({ keys: KEYS });
  await k.load(ffr);
  const f = k.service('ffr');
  assert.equal(f.schemaId, 'ffr.v1@ad3aec7c87bc');
  await f.step({ runId: 'exp009-practice-1', itemId: 'c001', step: 'h1.eval.3', ts: '2026-10-03T00:00:00Z', model: null, taskType: 'gate-eval', durationMs: 12.5, tags: ['arm-h1'] });
  await f.handoff({ runId: 'r1', itemId: 'c061', stratum: 'S', arm: 'A0', fromModel: 'a', toModel: 'b', ts: '2026-10-03T00:00:01Z', usage: { prefillTok: 10, prefillMs: 1, ttftMs: 2, peakMemGB: 3 } });
  await assert.rejects(f.step({ runId: 'r', itemId: 'i', step: 's', ts: 'not-a-time' }), /ffr.v1 refused/);
  await assert.rejects(f.step({ runId: 'r', itemId: 'i', step: 's', ts: '2026-10-03T00:00:00Z', tags: ['Bad Tag'] }), /ffr tag/);
  const events = k.emissions.get('ffr-event');
  assert.equal(events.length, 2, 'nothing is recorded for a refused event');
  const { validate } = await validator();
  for (const ev of events) assert.deepEqual(validate(ev), { ok: true, errors: [] });
  assert.equal(events[0].usage.costUsd, null);
  assert.equal(events[0].quality.nullReasons.costUsd, 'local-unpriced');
  const vendor = JSON.parse(readFileSync('experiments/latent-handoff/vendor/ffr/vendor.json', 'utf8'));
  assert.equal(sha256(readFileSync('experiments/latent-handoff/vendor/ffr/ffr.v1.schema.json')), vendor.files['ffr.v1.schema.json']);
  await k.dispose();
});

// ------------------------------------------------------------------ vendored module-private symbols (slice tests)

/** A top-level declaration's text: one line ending in `;`, or through the first following line that is `}` / `};`. */
function sliceDeclaration(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex(l => new RegExp(`^(?:export )?(?:async )?(?:function ${name}\\(|const ${name} = )`).test(l));
  if (start < 0) return null;
  if (lines[start].endsWith(';')) return { line: start + 1, text: lines[start] };
  let end = start + 1;
  while (end < lines.length && !/^\};?$/.test(lines[end])) end += 1;
  return { line: start + 1, text: lines.slice(start, end + 1).join('\n') };
}
const FFR8 = 'experiments/latent-handoff/ffr8.mjs';
const VENDORED = readFileSync('harness/services/vendored-exp008.mjs', 'utf8');
const SYMBOLS = [['ID', FFR8, 50], ['safeId', FFR8, 51]];

test('the vendored source is EXP 008\'s pre-registered ffr8.mjs', () => {
  const prereg = JSON.parse(readFileSync('experiments/latent-handoff/preregistration.json', 'utf8'));
  assert.equal(sha256(readFileSync(FFR8)), prereg.files[FFR8]);
});
for (const [name, file, line] of SYMBOLS) {
  test(`vendored ${name} is byte-identical to ${file}:${line}`, () => {
    const want = sliceDeclaration(readFileSync(file, 'utf8'), name);
    assert.ok(want, `${name} is declared in ${file}`);
    assert.equal(want.line, line);
    assert.doesNotMatch(want.text, /^export /, `${name} is module-private in ${file} (else import it)`);
    assert.equal(sliceDeclaration(VENDORED, name)?.text, want.text);
  });
}
test('the vendored file declares exactly the sliced symbols and exports them', () => {
  const declared = [...VENDORED.matchAll(/^(?:function (\w+)\(|const (\w+) = )/gm)].map(m => m[1] ?? m[2]).sort();
  assert.deepEqual(declared, SYMBOLS.map(s => s[0]).sort());
  assert.deepEqual(/^export \{ ([^}]+) \};$/m.exec(VENDORED)[1].split(', ').sort(), declared);
});

test('adapters are import-only: they import the frozen modules and never write into experiments/', () => {
  for (const f of readdirSync('harness/services')) {
    const src = readFileSync(join('harness/services', f), 'utf8');
    assert.doesNotMatch(src, /\b(writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync)\b/, `${f} writes no file itself`);
  }
});
