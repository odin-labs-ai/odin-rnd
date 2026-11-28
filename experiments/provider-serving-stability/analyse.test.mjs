import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse, counted, pairVerdict, readCapture } from './analyse.mjs';
import { anonymiseRow, tokeniser } from './anonymise.mjs';

const PREREG = {
  experiment: { id: 'EXP 022' },
  window: { from: '2026-11-11T00:00:00Z', to: '2026-11-18T00:00:00Z' },
  brokers: ['X', 'Y', 'Z'],
  models: ['anthropic/claude-haiku-4.5', 'openai/gpt-4o-mini'],
  decision: { rule: { minCalls: 20 } },
};

function row(overrides = {}) {
  return { broker: 'X', canonicalModel: 'anthropic/claude-haiku-4.5', servedModel: 'identity-1', ok: true, ts: '2026-11-12T00:00:00Z', ...overrides };
}

test('pairVerdict: stable, unstable and not-enough-calls at the exact minCalls boundary', () => {
  assert.equal(pairVerdict(19, ['a'], 20), 'not enough calls');
  assert.equal(pairVerdict(20, ['a'], 20), 'stable');
  assert.equal(pairVerdict(20, ['a', 'b'], 20), 'unstable');
});

test('counted: window is half-open, and a failed/missing-servedModel/header row is never counted', () => {
  const fromMs = Date.parse(PREREG.window.from), toMs = Date.parse(PREREG.window.to);
  assert.equal(counted(row({ ts: '2026-11-11T00:00:00Z' }), fromMs, toMs), true);
  assert.equal(counted(row({ ts: '2026-11-18T00:00:00Z' }), fromMs, toMs), false, 'to is excluded');
  assert.equal(counted(row({ ok: false }), fromMs, toMs), false);
  assert.equal(counted(row({ servedModel: undefined }), fromMs, toMs), false);
  assert.equal(counted({ _header: true, ...row() }, fromMs, toMs), false);
});

test('analyse: a stable pair -- one token across every counted call', () => {
  const rows = Array.from({ length: 25 }, () => row());
  const result = analyse(rows, PREREG);
  const pair = result.perPair.X['anthropic/claude-haiku-4.5'];
  assert.equal(pair.n, 25);
  assert.deepEqual(pair.distinctServedModels, ['identity-1']);
  assert.equal(pair.verdict, 'stable');
});

test('analyse: an unstable pair -- two tokens, counted separately, nothing in the shape names a provider', () => {
  const rows = [
    ...Array.from({ length: 30 }, () => row({ broker: 'X', canonicalModel: 'openai/gpt-4o-mini', servedModel: 'identity-1' })),
    ...Array.from({ length: 25 }, () => row({ broker: 'X', canonicalModel: 'openai/gpt-4o-mini', servedModel: 'identity-2' })),
  ];
  const result = analyse(rows, PREREG);
  const pair = result.perPair.X['openai/gpt-4o-mini'];
  assert.equal(pair.n, 55);
  assert.deepEqual(pair.distinctServedModels, ['identity-1', 'identity-2']);
  assert.deepEqual(pair.servedModelCounts, { 'identity-1': 30, 'identity-2': 25 });
  assert.equal(pair.verdict, 'unstable');
});

test('tokeniser: the same raw value gets the same token within a (letter, model) group; a different raw value gets a new token; groups never leak into each other', () => {
  const tokenOf = tokeniser();
  assert.equal(tokenOf('X', 'anthropic/claude-haiku-4.5', 'aws-bedrock/claude-haiku-4.5'), 'identity-1');
  assert.equal(tokenOf('X', 'anthropic/claude-haiku-4.5', 'aws-bedrock/claude-haiku-4.5'), 'identity-1', 'same raw value, same token, repeated calls');
  assert.equal(tokenOf('X', 'anthropic/claude-haiku-4.5', 'microsoft-foundry/claude-haiku-4.5'), 'identity-2', 'a second distinct raw value gets a new token');
  assert.equal(tokenOf('Y', 'anthropic/claude-haiku-4.5', 'aws-bedrock/claude-haiku-4.5'), 'identity-1', 'a different broker letter starts its own count, even for the identical raw string');
  assert.equal(tokenOf('X', 'openai/gpt-4o-mini', 'aws-bedrock/claude-haiku-4.5'), 'identity-1', 'a different model starts its own count too, same raw string');
});

test('anonymiseRow: drops every identifying field, letters the broker and keyName, tokenises servedModel, keeps canonicalModel and every other measured value', () => {
  const letters = { openrouter: 'G', eurouter: 'H', requesty: 'I' };
  const tokenOf = tokeniser();
  const named = {
    broker: 'eurouter', canonicalModel: 'anthropic/claude-haiku-4.5', requestedModel: 'claude-haiku-4.5',
    servedModel: 'aws-bedrock/claude-haiku-4.5', servedProvider: 'aws-bedrock',
    estimateSource: 'price-book local-agents packages/model-price-book/src/price-book.ts:287 @ 8fbd0190',
    httpStatus: 200, keyName: 'env:RND_PROBE_EUROUTER_API_KEY', latencyMs: 700, ok: true,
    actualCostUsd: 4e-5, estimatedCostUsd: 4e-5, ts: '2026-11-12T00:00:00Z',
  };
  const anon = anonymiseRow(named, letters, tokenOf);
  assert.equal(anon.broker, 'H');
  assert.equal(anon.keyName, 'env:RND_PROBE_H_API_KEY');
  assert.equal(anon.canonicalModel, 'anthropic/claude-haiku-4.5');
  assert.equal(anon.servedModel, 'identity-1');
  assert.equal(anon.actualCostUsd, 4e-5, 'measured values are unchanged');
  for (const dropped of ['requestedModel', 'servedProvider', 'estimateSource'])
    assert.ok(!(dropped in anon), `${dropped} was not dropped`);
  assert.throws(() => anonymiseRow({ broker: 'other' }, letters, tokenOf), /no letter/);
});

test('readCapture + analyse round trip over the real committed runs-anon/ matches results.json', () => {
  const prereg = JSON.parse(readFileSync('experiments/provider-serving-stability/preregistration.json', 'utf8'));
  prereg.sha256 = readFileSync('experiments/provider-serving-stability/preregistration.sha256', 'utf8').trim().split(/\s+/)[0];
  const rows = readCapture('experiments/provider-serving-stability/runs-anon');
  const result = analyse(rows, prereg);
  const committed = JSON.parse(readFileSync('experiments/provider-serving-stability/results.json', 'utf8'));
  assert.deepEqual(result, committed);
});
