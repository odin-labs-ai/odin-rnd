import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, counted, pairVerdict } from './analyse.mjs';

const PREREG = {
  experiment: { id: 'EXP 022' },
  window: { from: '2026-11-11T00:00:00Z', to: '2026-11-18T00:00:00Z' },
  brokers: ['openrouter', 'eurouter', 'requesty'],
  models: ['anthropic/claude-haiku-4.5', 'openai/gpt-4o-mini'],
  decision: { rule: { minCalls: 20 } },
};

function row(overrides = {}) {
  return {
    broker: 'openrouter',
    canonicalModel: 'anthropic/claude-haiku-4.5',
    requestedModel: 'anthropic/claude-haiku-4.5',
    servedModel: 'anthropic/claude-haiku-4.5',
    ok: true,
    ts: '2026-11-12T00:00:00Z',
    ...overrides,
  };
}

test('pairVerdict: stable, unstable and not-enough-calls at the exact minCalls boundary', () => {
  assert.equal(pairVerdict(19, ['a'], 20), 'not enough calls');
  assert.equal(pairVerdict(20, ['a'], 20), 'stable');
  assert.equal(pairVerdict(20, ['a', 'b'], 20), 'unstable');
  assert.equal(pairVerdict(100, ['a', 'b', 'c'], 20), 'unstable');
});

test('counted: window is half-open — from is included, to is excluded', () => {
  const fromMs = Date.parse('2026-11-11T00:00:00Z'), toMs = Date.parse('2026-11-18T00:00:00Z');
  assert.equal(counted(row({ ts: '2026-11-11T00:00:00Z' }), fromMs, toMs), true);
  assert.equal(counted(row({ ts: '2026-11-17T23:59:59Z' }), fromMs, toMs), true);
  assert.equal(counted(row({ ts: '2026-11-18T00:00:00Z' }), fromMs, toMs), false, 'to is excluded');
  assert.equal(counted(row({ ts: '2026-11-10T23:59:59Z' }), fromMs, toMs), false, 'before from is excluded');
});

test('counted: a failed call, a missing servedModel, and a header/trailer row are never counted', () => {
  const fromMs = Date.parse('2026-11-11T00:00:00Z'), toMs = Date.parse('2026-11-18T00:00:00Z');
  assert.equal(counted(row({ ok: false }), fromMs, toMs), false);
  assert.equal(counted(row({ servedModel: undefined }), fromMs, toMs), false);
  assert.equal(counted(row({ servedModel: '' }), fromMs, toMs), false, 'an empty string is not a served identity');
  assert.equal(counted({ _header: true, broker: 'openrouter', ok: true, servedModel: 'x', ts: '2026-11-12T00:00:00Z' }, fromMs, toMs), false);
});

test('analyse: a stable pair — one servedModel across every counted call', () => {
  const rows = Array.from({ length: 25 }, () => row());
  const result = analyse(rows, PREREG);
  const pair = result.perPair.openrouter['anthropic/claude-haiku-4.5'];
  assert.equal(pair.n, 25);
  assert.deepEqual(pair.distinctServedModels, ['anthropic/claude-haiku-4.5']);
  assert.equal(pair.verdict, 'stable');
});

test('analyse: an unstable pair — the exact amendment-01 shape (one model, two served identifiers)', () => {
  const rows = [
    ...Array.from({ length: 30 }, () => row({ broker: 'eurouter', canonicalModel: 'openai/gpt-4o-mini', servedModel: 'microsoft-foundry/gpt-4o-mini' })),
    ...Array.from({ length: 25 }, () => row({ broker: 'eurouter', canonicalModel: 'openai/gpt-4o-mini', servedModel: 'microsoft-foundry-2/gpt-4o-mini' })),
  ];
  const result = analyse(rows, PREREG);
  const pair = result.perPair.eurouter['openai/gpt-4o-mini'];
  assert.equal(pair.n, 55);
  assert.deepEqual(pair.distinctServedModels, ['microsoft-foundry-2/gpt-4o-mini', 'microsoft-foundry/gpt-4o-mini']);
  assert.deepEqual(pair.servedModelCounts, { 'microsoft-foundry/gpt-4o-mini': 30, 'microsoft-foundry-2/gpt-4o-mini': 25 });
  assert.equal(pair.verdict, 'unstable');
});

test('analyse: below minCalls is "not enough calls", never guessed as stable or unstable', () => {
  const rows = Array.from({ length: 5 }, () => row({ broker: 'requesty', canonicalModel: 'anthropic/claude-haiku-4.5' }));
  const result = analyse(rows, PREREG);
  assert.equal(result.perPair.requesty['anthropic/claude-haiku-4.5'].verdict, 'not enough calls');
});

test('analyse: matches by canonicalModel, not by each broker\'s own differently-spelled requestedModel', () => {
  // The exact bug this record's own fix commit (6b95632) addressed: eurouter drops the provider prefix,
  // requesty uses a dash. If analyse() ever regressed to matching on requestedModel, these rows would show n=0.
  const rows = [
    ...Array.from({ length: 22 }, () => row({ broker: 'eurouter', requestedModel: 'claude-haiku-4.5', canonicalModel: 'anthropic/claude-haiku-4.5', servedModel: 'aws-bedrock/claude-haiku-4.5' })),
    ...Array.from({ length: 22 }, () => row({ broker: 'requesty', requestedModel: 'anthropic/claude-haiku-4-5', canonicalModel: 'anthropic/claude-haiku-4.5', servedModel: 'anthropic/claude-haiku-4-5' })),
  ];
  const result = analyse(rows, PREREG);
  assert.equal(result.perPair.eurouter['anthropic/claude-haiku-4.5'].n, 22);
  assert.equal(result.perPair.requesty['anthropic/claude-haiku-4.5'].n, 22);
});

test('analyse: a call for an unrelated model never leaks into another pair\'s count', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => row({ canonicalModel: 'anthropic/claude-haiku-4.5' })),
    ...Array.from({ length: 20 }, () => row({ canonicalModel: 'openai/gpt-4o-mini', servedModel: 'openai/gpt-4o-mini' })),
  ];
  const result = analyse(rows, PREREG);
  assert.equal(result.perPair.openrouter['anthropic/claude-haiku-4.5'].n, 20);
  assert.equal(result.perPair.openrouter['openai/gpt-4o-mini'].n, 20);
});

test('analyse: shape matches preregistrationSha256 passthrough and covers every broker x model pair', () => {
  const prereg = { ...PREREG, sha256: 'deadbeef' };
  const result = analyse([], prereg);
  assert.equal(result.preregistrationSha256, 'deadbeef');
  for (const broker of prereg.brokers) {
    for (const model of prereg.models) {
      assert.ok(result.perPair[broker]?.[model], `${broker}/${model} missing from result`);
      assert.equal(result.perPair[broker][model].verdict, 'not enough calls');
    }
  }
});
