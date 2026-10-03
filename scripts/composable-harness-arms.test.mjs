import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, loadHarness } from '../harness/kernel.mjs';
import corpusAdapter from '../harness/services/corpus.mjs';
import { COMPONENTS, SHAPE, schedule, trial } from '../experiments/composable-harness/arms/schedule.mjs';
import { HARNESS_JSON, INFRASTRUCTURE, REPO_ROOT, SPECS } from '../experiments/composable-harness/arms/harness-set.mjs';
import { baseKernel, r0Client, runH1 } from '../experiments/composable-harness/arms/run.mjs';
import { GREP_PATTERN, H2, makeDeps, runH2 } from '../experiments/composable-harness/arms/h2.mjs';
import { predict as lintPredict } from './jev-gate-heuristic-lint.mjs';

// EXP 009 bundle 3 WO-05: the seeded schedule and the H1-vs-R0 comparison, on the fake MLX child (no model).

const ITEMS = Array.from({ length: 20 }, (_, i) => `i${i}`);
const ENV = { pins: { A: { modelKey: 'qwen3-fake-a', fake: true }, B: { modelKey: 'llama-fake-b', fake: true } }, memory: { stub: { freePct: 74, totalGB: 128, swapUsedMB: 100, load1: 3 } }, untimed: true };

test('a schedule is a pure function of (seed, trial): 20 ops, 40 evaluations, at least 25% reconfigures, pin swaps', () => {
  const a = schedule({ seed: 'practice-t', trials: 30, items: ITEMS, pins: ['A', 'B'] });
  assert.deepEqual(a, schedule({ seed: 'practice-t', trials: 30, items: ITEMS, pins: ['A', 'B'] }));
  assert.notDeepEqual(a, schedule({ seed: 'practice-u', trials: 30, items: ITEMS, pins: ['A', 'B'] }));
  let swaps = 0;
  for (const t of a) {
    const ops = t.steps.filter(s => s.kind === 'op');
    assert.equal(ops.length, SHAPE.ops);
    assert.equal(t.steps.filter(s => s.kind === 'eval').length, SHAPE.evals);
    assert.ok(ops.filter(o => o.op === 'reconfigure').length / ops.length >= SHAPE.reconfigureShare);
    swaps += ops.filter(o => o.pinSwap).length;
  }
  assert.ok(swaps > 0, 'pin swaps occur');
});

test('every scheduled op is valid against the loaded set it is generated for', () => {
  for (const seed of ['practice-v1', 'practice-v2']) {
    const loaded = new Set();
    for (const t of schedule({ seed, trials: 40, items: ITEMS, pins: ['A', 'B'] })) {
      for (const s of t.steps.filter(x => x.kind === 'op')) {
        if (s.op === 'load') { assert.ok(!loaded.has(s.name), `${seed}: load of loaded ${s.name}`); loaded.add(s.name); }
        else { assert.ok(loaded.has(s.name), `${seed}: ${s.op} of unloaded ${s.name}`); if (s.op === 'unload') loaded.delete(s.name); }
      }
    }
  }
});

test('the dry run refuses a seed that is not a practice seed', () => {
  const r = spawnSync(process.execPath, ['experiments/composable-harness/arms/dry-run.mjs', '--seed', 'counted-1', '--out', join(tmpdir(), 'never')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /counted seeds are refused/);
});

test('H1 against R0 on the fake child: no divergence over a short schedule, and R0 is cached by key', { timeout: 600_000 }, async t => {
  const k = new Kernel();
  await k.load(corpusAdapter);
  const items = k.service('corpus').items.filter((_, i) => i % 10 === 3).slice(0, 20);
  await k.dispose();
  const dir = mkdtempSync(join(tmpdir(), 'exp009-arms-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stats = { hits: 0, runs: 0 };
  const sched = [trial({ seed: 'practice-arms', index: 0, items, pins: ['A', 'B'], shape: { ops: 8, evals: 6, reconfigureShare: 0.25 } })].map(x => ({ index: 0, steps: x.steps }));
  const rows = await runH1({ schedule: sched, env: ENV, r0: r0Client({ env: ENV, cacheDir: dir, stats }), world: { scratch: null, baseGlobals: Object.keys(globalThis) } });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].divergences, []);
  assert.equal(rows[0].ops + rows[0].evals, 14);
  assert.ok(stats.runs > 0);
  assert.ok(Object.keys(JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8'))).length === stats.runs);
});

test('H2 (the frozen blind registry) runs on the same schedule through harness-supplied deps, and every trial is torn down and observed', { timeout: 900_000 }, async t => {
  const k = new Kernel();
  await k.load(corpusAdapter);
  const items = k.service('corpus').items.filter((_, i) => i % 10 === 3).slice(0, 20);
  await k.dispose();
  const dir = mkdtempSync(join(tmpdir(), 'exp009-h2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The deps are EXP 005's heuristics, the same functions the kernel's lint and grep components call.
  const deps = makeDeps();
  for (const it of items) assert.equal(deps.lintRun(it), lintPredict(it.state) ? 'REJECT' : 'ACCEPT');
  assert.equal(typeof GREP_PATTERN, 'string');
  const tmpBefore = process.env.TMPDIR;
  const sched = schedule({ seed: 'practice-h2t', trials: 1, items, pins: ['A', 'B'] }).map(x => ({ ...x, steps: x.steps.slice(0, 16) }));
  const rows = await runH2({ schedule: sched, env: ENV, r0: r0Client({ env: ENV, cacheDir: join(dir, 'r0'), stats: { hits: 0, runs: 0 } }), scratchRoot: join(dir, 'h2') });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].arm, 'H2');
  assert.ok(Array.isArray(rows[0].residue) && Number.isInteger(rows[0].mismatches) && Array.isArray(rows[0].errors));
  assert.equal(process.env.TMPDIR, tmpBefore, 'TMPDIR is restored after the H2 arm');
});

test('H2 and H1 are observed alike: the model child\'s runtime cache stays out of H2\'s scratch (practice-run-1 outside.scratch artifact)', { timeout: 300_000 }, async t => {
  // The fake child, like mlx_gate.py (`import mlx_lm` -> $TMPDIR/torchinductor_<user>), creates a per-user runtime
  // cache directory in its TMPDIR on start and never removes it. H1's and R0's children run with the ordinary TMPDIR;
  // H2's model child must too, while H2's own Node temp directories still land in the observed scratch root.
  const k = new Kernel();
  await k.load(corpusAdapter);
  const items = k.service('corpus').items.slice(0, 2);
  await k.dispose();
  const dir = mkdtempSync(join(tmpdir(), 'exp009-h2tmp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runtime = join(dir, 'runtime');
  mkdirSync(runtime);
  const steps = [
    { kind: 'op', op: 'load', name: 'mlx.model', config: { pin: 'A' } },
    { kind: 'op', op: 'load', name: 'yesno-gate', config: {} },
    ...items.map(item => ({ kind: 'eval', item })),
    { kind: 'op', op: 'reconfigure', name: 'mlx.model', config: { pin: 'B' }, pinSwap: true },
    { kind: 'op', op: 'unload', name: 'yesno-gate' },
    { kind: 'op', op: 'unload', name: 'mlx.model' },
  ];
  const sched = [{ index: 0, startState: {}, steps }];
  const tmpBefore = process.env.TMPDIR;
  process.env.TMPDIR = runtime; // the ordinary TMPDIR of this run: H1's and R0's children use it
  try {
    const r0 = r0Client({ env: ENV, cacheDir: join(dir, 'r0'), stats: { hits: 0, runs: 0 } });
    const fixed = await runH2({ schedule: sched, env: ENV, r0, scratchRoot: join(dir, 'fixed') });
    assert.deepEqual(fixed[0].errors, []);
    assert.deepEqual(fixed[0].residue, [], 'no residue once the child runs with the ordinary TMPDIR');
    assert.deepEqual(readdirSync(join(dir, 'fixed', 'h2-0', 'scratch')), []);
    assert.ok(existsSync(join(runtime, 'fake-mlx-runtime-cache')), 'the child did create its runtime cache, outside the scratch root');
    // Negative control: the pre-fix wiring (the child inherits the scratch TMPDIR) reproduces the practice artifact.
    const broken = await runH2({ schedule: sched, env: ENV, r0, scratchRoot: join(dir, 'broken'), childTmp: scratch => scratch });
    assert.deepEqual(broken[0].residue, ['outside.scratch']);
    assert.deepEqual(readdirSync(join(dir, 'broken', 'h2-0', 'scratch')), ['fake-mlx-runtime-cache']);
  } finally {
    if (tmpBefore === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = tmpBefore;
  }
});

test('the arms load exactly the active set harness.json declares, through the kernel loader', async () => {
  const doc = JSON.parse(readFileSync(HARNESS_JSON, 'utf8'));
  const declared = doc.components.map(c => c.name);
  // The kernel's own loader accepts the document: activation order is the declared order, nothing unsatisfied.
  const { plan } = await loadHarness(HARNESS_JSON, { root: REPO_ROOT, dryRun: true });
  assert.deepEqual(plan, { order: declared, unsatisfied: {}, illTyped: [] });
  // The arms' set IS that document: infrastructure first, then the schedulable components, as the same spec objects.
  assert.equal(INFRASTRUCTURE.spec.name, declared[0]);
  assert.deepEqual(Object.keys(SPECS), declared.slice(1));
  assert.deepEqual(COMPONENTS, declared.slice(1));
  for (const c of doc.components.slice(1)) assert.equal(SPECS[c.name], (await import(join(REPO_ROOT, c.module))).default, `${c.name} is ${c.module}`);
  // The schedule draws only from it, and H2 has a frozen counterpart for every schedulable component.
  const used = new Set(schedule({ seed: 'practice-set', trials: 20, items: ITEMS, pins: ['A', 'B'] }).flatMap(t => t.steps.filter(s => s.kind === 'op').map(s => s.name)));
  assert.deepEqual([...used].sort(), [...COMPONENTS].sort());
  assert.deepEqual(Object.keys(H2).sort(), [...COMPONENTS].sort());
  const k = await baseKernel(ENV);
  assert.deepEqual(k.census().map(r => `${r.name}:${r.status}`), [`${declared[0]}:active`]);
  await k.dispose();
});
