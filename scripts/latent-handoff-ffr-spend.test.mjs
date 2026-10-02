// EXP 008 (latent-handoff) bundle 3 WO-07: the ffr.v1 emitter, the spend guard, and the zero-prefill counter.
//   - every emitted row validates against the vendored schema sha; a vendored byte change refuses to load;
//   - the ledger refuses at the boundary ($95.01 spent + a $5 reserve), refuses a $0 line, and charges a simulated
//     timeout at its upper bound;
//   - the stdlib counter tests (experiments/latent-handoff/test_counter.py) pass under python3.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { assertVendor, CHANNEL, emit, handoffEvent, SCHEMA_ID } from '../experiments/latent-handoff/ffr8.mjs';
import { paid, readLedger, reserve, settle, SpendRefused, state } from '../experiments/latent-handoff/spend8.mjs';

// Python children inherit this: no __pycache__ is written into the source tree (the publish gate seals it).
process.env.PYTHONDONTWRITEBYTECODE = '1';

// Every temp dir this file makes is removed after the run (scripts/jev-gate-tempdirs.test.mjs).
const scratchDirs = [];
const scratch = prefix => { const d = mkdtempSync(join(tmpdir(), prefix)); scratchDirs.push(d); return d; };
after(() => { for (const d of scratchDirs) rmSync(d, { recursive: true, force: true }); });

const VENDOR = new URL('../experiments/latent-handoff/vendor/ffr/', import.meta.url).pathname;

const row = (arm, over = {}) => ({
  runId: 'practice-001', itemId: 'c001', stratum: 'S', arm, ts: '2026-10-01T19:00:00Z',
  fromModel: 'Qwen/Qwen3-1.7B', toModel: 'unsloth/Llama-3.2-3B-Instruct',
  usage: { prefillTok: 23, prefillMs: 12.5, ttftMs: 40.1, peakMemGB: 9.8 }, ...over,
});

test('the vendored files hash to vendor.json and the schema is ffr.v1@ad3aec7c87bc', () => {
  const pins = assertVendor();
  assert.equal(pins.schemaId, SCHEMA_ID);
});

test('a single changed vendored byte refuses to load', () => {
  const dir = scratch('lh-vendor-');
  cpSync(VENDOR, dir, { recursive: true });
  const p = join(dir, 'ffr.v1.schema.json');
  writeFileSync(p, readFileSync(p, 'utf8').replace('"ffr.v1"', '"ffr.v2"'));
  assert.throws(() => assertVendor(dir), /hashes to/);
});

test('every arm emits a valid handoff event on its channel (100% of rows validate)', async () => {
  const out = join(scratch('lh-ffr-'), 'events.jsonl');
  for (const arm of Object.keys(CHANNEL)) {
    const ev = await emit(out, row(arm));
    assert.equal(ev.handoff.channel, CHANNEL[arm]);
  }
  const lines = readFileSync(out, 'utf8').trim().split('\n');
  assert.equal(lines.length, Object.keys(CHANNEL).length);
  const validator = join(VENDOR, 'validate.mjs');
  // the vendored CLI resolves its own default paths, so validate through the module with the vendored paths
  const { makeValidator } = await import(validator);
  const v = makeValidator({ schemaPath: join(VENDOR, 'ffr.v1.schema.json'), familyPath: join(VENDOR, 'ffr-model-family.json') });
  for (const l of lines) assert.deepEqual(v(JSON.parse(l)).errors, []);
  assert.ok(lines.some(l => JSON.parse(l).handoff.channel === 'kv-transferred'));
});

test('cost is never a silent zero; a null usage needs a reason', async () => {
  const ev = await handoffEvent(row('A2a'));
  assert.equal(ev.usage.costUsd, null);
  assert.equal(ev.quality.nullReasons.costUsd, 'local-unpriced');
  await assert.rejects(handoffEvent(row('A0', { usage: { prefillTok: 10, prefillMs: null, ttftMs: 1, peakMemGB: 1 } })), /without a reason/);
  const ok = await handoffEvent(row('A0', { usage: { prefillTok: 10, prefillMs: null, ttftMs: 1, peakMemGB: 1 }, nullReasons: { prefillMs: 'oom-abstention' } }));
  assert.equal(ok.quality.nullReasons.prefillMs, 'oom-abstention');
});

test('an unknown arm or a schema-invalid row writes nothing', async () => {
  const out = join(scratch('lh-ffr-'), 'events.jsonl');
  await assert.rejects(emit(out, row('Z9')), /no ffr channel/);
  await assert.rejects(emit(out, row('A0', { ts: 'yesterday' })), /ffr.v1 refused/);
  assert.equal(existsSync(out), false);
});

function ledgerWith(lines) {
  const dir = scratch('lh-spend-');
  const ledger = join(dir, 'spend.jsonl');
  const mirror = join(dir, 'mirror.jsonl');
  writeFileSync(ledger, lines.map(l => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  return { ledger, mirror };
}

test('the ledger refuses at the boundary: $95.01 spent + a $5 reserve', () => {
  const at = ledgerWith([{ kind: 'reserve', rid: 'a', upperUsd: 95.01, bundle: 'B3', label: 'x' }, { kind: 'actual', rid: 'a', usd: 3.01 }, { kind: 'reserve', rid: 'b', upperUsd: 92, bundle: 'B3', label: 'y' }]);
  assert.equal(state(readLedger(at.ledger)).totalUsd, 95.01);
  assert.throws(() => reserve(1, 'B3', 'gpu', at), SpendRefused);
  const under = ledgerWith([{ kind: 'reserve', rid: 'a', upperUsd: 3, bundle: 'B3', label: 'x' }, { kind: 'reserve', rid: 'b', upperUsd: 2, bundle: 'B3', label: 'y' }, { kind: 'reserve', rid: 'c', upperUsd: 90, bundle: 'B3', label: 'z' }, { kind: 'actual', rid: 'c', usd: 0.01 }]);
  // total 5.01, largest 3: 5.01 + 5 fits; the boundary case is only the 95.01 one
  assert.match(reserve(5, 'B3', 'gpu', under), /^[0-9a-f]{10}$/);
});

test('the ledger refuses a $0 line, both as a reservation and as an actual', () => {
  const l = ledgerWith([]);
  assert.throws(() => reserve(0, 'B3', 'x', l), /never a \$0 line/);
  const rid = reserve(2, 'B3', 'x', l);
  assert.throws(() => settle(rid, 0, l), /never a \$0 line/);
  assert.throws(() => settle('nope', 1, l), /unknown reservation/);
});

test('a simulated timeout is charged at the upper bound; a known cost settles; every line is mirrored', async () => {
  const l = ledgerWith([]);
  await assert.rejects(paid(7, 'B3', 'gpu calibration', async () => { throw new Error('ETIMEDOUT'); }, l), /ETIMEDOUT/);
  assert.equal(state(readLedger(l.ledger)).totalUsd, 7);
  await paid(4, 'B3', 'refute', async () => ({ costUsd: 1.25 }), l);
  assert.equal(state(readLedger(l.ledger)).totalUsd, 8.25);
  await paid(2, 'B3', 'unknown cost', async () => ({}), l);
  assert.equal(state(readLedger(l.ledger)).totalUsd, 10.25);
  assert.equal(readFileSync(l.mirror, 'utf8'), readFileSync(l.ledger, 'utf8'));
});

test('with no ledger configured, every paid call is refused', () => {
  assert.throws(() => reserve(1, 'B3', 'x', { ledger: null, mirror: null }), /no ledger/);
});

test('a corrupt ledger line fails closed', () => {
  const l = ledgerWith([{ kind: 'actual', rid: 'a', usd: 0 }]);
  assert.throws(() => reserve(1, 'B3', 'x', l), /fail closed/);
});

test('the zero-prefill counter tests pass (python3, stdlib)', () => {
  const r = spawnSync('python3', ['experiments/latent-handoff/test_counter.py'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /OK/);
});
