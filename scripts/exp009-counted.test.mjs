import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../harness/kernel.mjs';
import corpusAdapter from '../harness/services/corpus.mjs';
import {
  ARM_FILES, BLOCK_SIZE, runP2, BLOCKS, NOT_BEFORE, OUT_ROOT, SEED, TRIALS, attemptState, blockRange, deriveSeed,
  leaseGate, nextBlock, notBeforeGate, pinsExist, rerunSampled, runBlock, seedGate,
} from './composable-counted.mjs';

// EXP 009 bundle 5 WO-01: the counted-run driver's gates, partitioning and append-only output. Every run here uses
// the fake MLX child; nothing is measured, no weight is loaded, and nothing is written outside a temp directory.

const MERGE = '91de325de980493291d17237387aac6d2c656b7c';
const ENV = { pins: { A: { modelKey: 'qwen3-fake-a', fake: true }, B: { modelKey: 'llama-fake-b', fake: true } }, memory: { stub: { freePct: 74, totalGB: 128, swapUsedMB: 100, load1: 3 } }, untimed: true };
const temp = t => { const d = mkdtempSync(join(tmpdir(), 'exp009-counted-test-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('the seed is sha256 of the 40-char merge id, and only the published merge id passes', () => {
  assert.equal(deriveSeed(MERGE), createHash('sha256').update(MERGE, 'utf8').digest('hex'));
  assert.equal(deriveSeed(MERGE), SEED);
  assert.deepEqual(seedGate(MERGE), { ok: true, gate: 'seed', seed: SEED });
  const wrong = `${MERGE.slice(0, 39)}d`; // one character off
  const r = seedGate(wrong);
  assert.equal(r.ok, false);
  assert.equal(r.gate, 'seed');
  assert.notEqual(deriveSeed(wrong), SEED);
  for (const bad of [undefined, '', MERGE.toUpperCase(), MERGE.slice(0, 7), `${MERGE}0`, ` ${MERGE}`]) assert.equal(seedGate(bad).ok, false, `refuses ${bad}`);
});

test('the CLI refuses a wrong merge id before anything else, and writes nothing', () => {
  const r = spawnSync(process.execPath, ['scripts/composable-counted.mjs', '--merge-commit', `${MERGE.slice(0, 39)}d`, '--block', '00'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /REFUSED \(seed\)/);
  assert.ok(!existsSync(OUT_ROOT), 'no counted output directory was created');
});

test('the CLI has no override flag: an unknown flag changes nothing and the gates still refuse', () => {
  // MMW_RUN_ID / MMW_RUN_SIDECAR are overridden so the test refuses even when the suite itself runs under a lease.
  const r = spawnSync(process.execPath, ['scripts/composable-counted.mjs', '--merge-commit', MERGE, '--block', '00', '--force', '--fake', '--now', '2030-01-01T00:00:00Z'], { encoding: 'utf8', env: { ...process.env, MMW_RUN_ID: 'x', MMW_RUN_SIDECAR: '/x/x.jsonl' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /REFUSED \((not-before|lease)\)/);
  assert.ok(!existsSync(OUT_ROOT));
});

test('gate (a): refuses at and before the not-before, passes strictly after', () => {
  assert.equal(NOT_BEFORE, '2026-10-08T11:34:15Z');
  assert.equal(notBeforeGate(new Date('2026-10-07T12:00:00Z')).ok, false);
  assert.equal(notBeforeGate(new Date(NOT_BEFORE)).ok, false);
  assert.equal(notBeforeGate(new Date(Date.parse(NOT_BEFORE) - 1)).ok, false);
  assert.equal(notBeforeGate(new Date(Date.parse(NOT_BEFORE) + 1000)).ok, true);
  assert.equal(notBeforeGate(new Date('garbage')).ok, false);
  assert.equal(notBeforeGate(undefined).ok, false);
});

test('gate (b) is dropped: the driver reads nothing of EXP 008\'s state, so it can neither block nor unblock a block', () => {
  // Supervisor 2026-10-07: the one memory-window lease serialises EXP 008 and EXP 009. The driver reads no EXP 008
  // ledger, runner process list or run artifact.
  const src = readFileSync(new URL('./composable-counted.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  for (const needle of ['mission-rnd-exp008', 'STATUS.md', 'latent-handoff/runs', 'COUNTED RUN', 'runner.py', "'-axo'", 'exp008Gate']) {
    assert.ok(!code.includes(needle), `the driver code mentions ${needle}`);
  }
  assert.match(src, /supervisor 2026-10-07: gate dropped; lease serialises/);
});

test('gate (b) is dropped: an absent EXP 008 world leaves the CLI refusing only on not-before or the lease', () => {
  // HOME points at an empty directory, so no EXP 008 ledger or cache exists; the refusal is still a remaining gate.
  const home = mkdtempSync(join(tmpdir(), 'exp009-counted-home-'));
  try {
    const r = spawnSync(process.execPath, ['scripts/composable-counted.mjs', '--merge-commit', MERGE, '--block', '00'], { encoding: 'utf8', env: { ...process.env, HOME: home, MMW_RUN_ID: 'x', MMW_RUN_SIDECAR: '/x/x.jsonl' } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /REFUSED \((not-before|lease)\)/);
    assert.doesNotMatch(r.stderr, /EXP 008|exp008/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('gate (c): refuses without a lease, with another run\'s lease, and when the holder is not an ancestor', t => {
  const d = temp(t), lease = join(d, 'lease');
  const tree = { 500: 400, 400: 300, 300: 1 }; // 500 -> 400 -> 300 -> init
  const parentOf = p => tree[p] ?? null;
  const env = { MMW_RUN_ID: '20261009T000000Z-exp009-counted-b00-300', MMW_RUN_SIDECAR: '/s/runs/20261009T000000Z-exp009-counted-b00-300.jsonl' };
  const gate = (over = {}) => leaseGate({ block: 0, leaseDir: lease, pid: 500, env, parentOf, ...over });
  assert.match(gate().reason, /no memory-window lease/);
  mkdirSync(lease);
  writeFileSync(join(lease, 'runId'), `${env.MMW_RUN_ID}\n`);
  assert.match(gate().reason, /holder pid is unreadable/);
  writeFileSync(join(lease, 'pid'), '300\n');
  writeFileSync(join(lease, 'label'), 'exp008-roi-fix-push\n');
  assert.match(gate().reason, /not this block/, 'another job\'s lease cannot carry a block');
  writeFileSync(join(lease, 'label'), 'exp009-counted-b00\n');
  assert.match(gate({ block: 1 }).reason, /not this block/);
  assert.match(gate({ block: undefined }).reason, /not this block/);
  writeFileSync(join(lease, 'startedAt'), '2026-10-09T00:00:00Z\n');
  assert.match(gate({ env: { ...env, MMW_RUN_ID: 'other' } }).reason, /not this run/);
  assert.match(gate({ env: { MMW_RUN_SIDECAR: env.MMW_RUN_SIDECAR } }).reason, /not this run/);
  assert.match(gate({ env: { ...env, MMW_RUN_SIDECAR: '/s/runs/other.jsonl' } }).reason, /sidecar/);
  assert.match(gate({ pid: 300 }).reason, /not an ancestor/, 'the holder itself is not its own ancestor');
  writeFileSync(join(lease, 'pid'), '777\n');
  assert.match(gate().reason, /not an ancestor/);
  writeFileSync(join(lease, 'pid'), '300\n');
  assert.deepEqual(gate(), { ok: true, gate: 'lease', lease: { runId: env.MMW_RUN_ID, label: 'exp009-counted-b00', startedAt: '2026-10-09T00:00:00Z' } });
  // a ppid cycle cannot loop forever
  assert.equal(leaseGate({ block: 0, leaseDir: lease, pid: 1, env, parentOf: p => (p === 1 ? 2 : 1) }).ok, false);
});

test('gate (c) on the live host refuses for a block this test is not running under', () => {
  // A test may itself run under some lease (a governed push); none is labelled with a counted block AND this test's run.
  assert.equal(leaseGate({ block: 0, env: { MMW_RUN_ID: 'not-a-run', MMW_RUN_SIDECAR: '/x/not-a-run.jsonl' } }).ok, false);
});

test('the counted weights are checked for existence only, never loaded', t => {
  const d = temp(t);
  assert.equal(pinsExist({ cacheRoot: d }).ok, false);
  for (const key of ['llama-3.2-3b', 'qwen3-1.7b']) {
    mkdirSync(join(d, 'mlx', key), { recursive: true });
    writeFileSync(join(d, 'mlx', key, 'config.json'), '{}');
  }
  assert.match(pinsExist({ cacheRoot: d }).reason, /llama-3.2-3b, qwen3-1.7b/, 'config without weights is not a model');
  for (const key of ['llama-3.2-3b', 'qwen3-1.7b']) writeFileSync(join(d, 'mlx', key, 'model.safetensors'), '');
  assert.equal(pinsExist({ cacheRoot: d }).ok, true);
});

test('blocks partition the 400 trials exactly once, in seed order', () => {
  assert.equal(TRIALS, 400);
  assert.equal(BLOCK_SIZE, 10);
  assert.equal(BLOCKS, 40);
  const seen = [];
  for (let k = 0; k < BLOCKS; k += 1) {
    const { first, end } = blockRange(k);
    assert.equal(end - first, BLOCK_SIZE);
    for (let i = first; i < end; i += 1) seen.push(i);
  }
  assert.deepEqual(seen, Array.from({ length: TRIALS }, (_, i) => i));
  for (const bad of [-1, 40, 1.5, NaN, '3']) assert.throws(() => blockRange(bad));
});

test('the R0 re-run sample is a function of (seed, key) alone, about 10%', () => {
  const keys = Array.from({ length: 4000 }, (_, i) => createHash('sha256').update(String(i)).digest('hex'));
  const share = keys.filter(k => rerunSampled(SEED, k)).length / keys.length;
  assert.ok(share > 0.08 && share < 0.12, `share ${share}`);
  assert.deepEqual(keys.map(k => rerunSampled(SEED, k)), keys.map(k => rerunSampled(SEED, k)));
});

test('a block on the fake child: arms recorded, append-only, a completed block refused, a re-queue is a new attempt', { timeout: 1_800_000 }, async t => {
  const out = temp(t);
  const k = new Kernel();
  await k.load(corpusAdapter);
  const items = k.service('corpus').items.filter((_, i) => i % 10 === 3).slice(0, 20);
  await k.dispose();
  const shape = { trials: 4, blockSize: 2 };
  // an earlier attempt of block 1 that never completed (as a crash would leave it)
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, ARM_FILES.attempts), `${JSON.stringify({ block: 1, attemptId: 'b01-a0-x', event: 'start' })}\n`);
  const prefix = readFileSync(join(out, ARM_FILES.attempts), 'utf8');

  const r = await runBlock({ block: 1, seed: SEED, env: ENV, items, outRoot: out, p2: false, ...shape });
  assert.match(r.attemptId, /^b01-a1-/, 'the re-queued block is attempt 1, with its own id');
  assert.deepEqual([r.first, r.end], [2, 4]);
  const rows = f => readFileSync(join(out, ARM_FILES[f]), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.ok(readFileSync(join(out, ARM_FILES.attempts), 'utf8').startsWith(prefix), 'earlier rows are kept byte for byte');
  assert.deepEqual(rows('h1').map(x => x.trial), [2, 3]);
  assert.ok(rows('h1').every(x => x.arm === 'H1' && x.attemptId === r.attemptId && x.block === 1));
  assert.deepEqual(rows('h1').flatMap(x => x.divergences), [], 'no divergence on the fake child across the block boundary');
  assert.equal(rows('prelude').length, 1, 'block 1 enters with a non-empty set: one boundary prelude');
  assert.ok(rows('prelude').every(x => x.arm === 'H1-prelude' && x.ops > 0 && x.divergences.length === 0));
  assert.deepEqual(rows('h2').map(x => x.trial), [2, 3]);
  assert.equal(rows('k').length, 12);
  assert.equal(rows('restart').length, 1);
  assert.equal(rows('restart')[0].identical, true);
  assert.ok(rows('rerun').every(x => x.identical === true));
  assert.equal(rows('memory').length, 1);
  assert.equal(rows('memory')[0].spend.costUsd, null);
  assert.ok(!existsSync(join(out, ARM_FILES.p2)));
  assert.deepEqual([...attemptState(out).complete], [1]);
  assert.equal(nextBlock(out, shape), 0);

  // refusing to overwrite: the completed block is refused and no file changes
  const snapshot = Object.fromEntries(Object.values(ARM_FILES).filter(f => existsSync(join(out, f))).map(f => [f, readFileSync(join(out, f), 'utf8')]));
  await assert.rejects(runBlock({ block: 1, seed: SEED, env: ENV, items, outRoot: out, p2: false, ...shape }), /already has a complete attempt/);
  for (const [f, bytes] of Object.entries(snapshot)) assert.equal(readFileSync(join(out, f), 'utf8'), bytes, `${f} unchanged`);
});

test('P2 runs every one of the 120 blind configurations once', async () => {
  const rows = [];
  assert.equal(await runP2(r => rows.push(r)), 120);
  assert.equal(new Set(rows.map(r => r.config)).size, 120);
  assert.ok(rows.every(r => Array.isArray(r.boot) && Array.isArray(r.end) && !('label' in r) && !('expected' in r)));
});

test('the driver source has no gate override and no truncating write', () => {
  const src = readFileSync(new URL('./composable-counted.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /writeFileSync/, 'output is appendFileSync only');
  assert.doesNotMatch(src, /--(force|fake|now|skip|override|out)\b/);
  assert.doesNotMatch(src, /process\.env\.(?!MMW_RUN_SIDECAR\b)[A-Z_]+/, 'no env knob besides the lease sidecar');
});
