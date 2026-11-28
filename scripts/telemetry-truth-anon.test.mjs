import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { anonymiseFile, anonymiseRow } from '../experiments/telemetry-truth/amendment-01/anonymise.mjs';
import { letteredRecord, outputs } from '../experiments/telemetry-truth/amendment-01/analyse-anon.mjs';
import { analyse } from '../experiments/telemetry-truth/analyse.mjs';

const dir = 'experiments/telemetry-truth';
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const amendment = JSON.parse(readFileSync(`${dir}/amendment-01/amendment.json`, 'utf8'));
const prereg = JSON.parse(readFileSync(`${dir}/preregistration.json`, 'utf8'));
const letters = { openrouter: 'G', eurouter: 'H', requesty: 'I' }; // a test assignment; the real one is private

test('EXP 015 amendment 01 is pinned and pins the frozen record and its own code', () => {
  assert.equal(readFileSync(`${dir}/amendment-01/amendment.sha256`, 'utf8').trim().split(/\s+/)[0], sha(`${dir}/amendment-01/amendment.json`));
  assert.equal(amendment.amends.preregistrationSha256, sha(`${dir}/preregistration.json`));
  assert.equal(amendment.amends.preregistrationSha256, readFileSync(`${dir}/preregistration.sha256`, 'utf8').trim().split(/\s+/)[0]);
  for (const c of amendment.changes) assert.equal(c.sha256, sha(c.file), c.file);
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script), 'the frozen analysis is unchanged');
});

function namedRow(broker, overrides = {}) {
  return {
    actualCostSource: 'usage.cost', actualCostUsd: 4e-5, broker, canonicalModel: 'anthropic/claude-haiku-4.5',
    completionTokens: 5, costCurrency: 'USD',
    estimateSource: 'price-book @ 8fbd0190 (path openrouter = direct)',
    estimatedCostUsd: 4e-5, gapRel: 0, gapUsd: 0,
    ...(broker === 'openrouter' ? { generationCostUsd: 4e-5, generationFound: true, generationModel: 'anthropic/claude-4.5-haiku-20251001', generationProvider: 'Amazon Bedrock' } : {}),
    httpStatus: 200, keyName: `env:RND_PROBE_${broker.toUpperCase()}_API_KEY`, latencyMs: 700, ok: true, promptTokens: 15,
    requestedModel: broker === 'eurouter' ? 'claude-haiku-4.5' : 'anthropic/claude-haiku-4.5',
    servedModel: broker === 'eurouter' ? 'aws-bedrock/claude-haiku-4.5' : 'anthropic/claude-haiku-4.5',
    servedProvider: broker === 'eurouter' ? 'aws-bedrock' : broker === 'openrouter' ? 'Amazon Bedrock' : null,
    ts: '2026-10-28T00:56:57Z', usageCostPresent: true, usageCostUsd: 4e-5, ...overrides,
  };
}

test('the published rows keep every measured value and nothing that names a broker or its provider', () => {
  const header = { _header: true, command: 'broker-actual-cost-probe.sh --brokers openrouter,eurouter,requesty --models anthropic/claude-haiku-4.5,openai/gpt-4o-mini --budget-usd 0.05', window: 'x', brokers: ['openrouter', 'eurouter', 'requesty'], models: ['a', 'b'], preflightBoundUsd: 1, budgetUsd: 0.05, actClass: 'x', note: 'x' };
  const trailer = { _trailer: true, broker: 'openrouter', keyName: 'env:RND_PROBE_OPENROUTER_API_KEY', keyUsageBeforeUsd: 1, keyUsageAfterUsd: 1.1, brokerCountedDeltaUsd: 0.1, exceededBudget: false, note: 'x' };
  const rows = [header, namedRow('openrouter'), namedRow('eurouter'), namedRow('requesty'), trailer];
  const text = rows.map(r => JSON.stringify(r)).join('\n');
  const out = anonymiseFile(text, letters);
  for (const word of ['openrouter', 'eurouter', 'requesty', 'bedrock', 'foundry', 'azure', 'Amazon', 'claude-haiku-4.5'.toUpperCase()])
    assert.ok(!out.toLowerCase().includes(word.toLowerCase()) || word === 'claude-haiku-4.5'.toUpperCase(), `published rows mention ${word}`);
  const parsed = out.trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(parsed[0].brokers, ['G', 'H', 'I'].sort());
  const anonOpenrouter = anonymiseRow(namedRow('openrouter'), letters);
  assert.equal(anonOpenrouter.broker, 'G');
  assert.equal(anonOpenrouter.canonicalModel, 'anthropic/claude-haiku-4.5', 'canonicalModel is kept: it names no broker');
  for (const dropped of ['requestedModel', 'servedModel', 'servedProvider', 'estimateSource', 'generationCostUsd', 'generationFound', 'generationModel', 'generationProvider'])
    assert.ok(!(dropped in anonOpenrouter), `${dropped} was not dropped`);
  assert.equal(anonOpenrouter.keyName, 'env:RND_PROBE_G_API_KEY');
  const anonEurouter = anonymiseRow(namedRow('eurouter'), letters);
  assert.equal(anonEurouter.broker, 'H');
  assert.ok(!('servedModel' in anonEurouter));
  const anonTrailer = anonymiseRow(trailer, letters);
  assert.equal(anonTrailer.broker, 'G');
  assert.equal(anonTrailer.keyName, 'env:RND_PROBE_G_API_KEY');
  assert.equal(anonTrailer.keyUsageBeforeUsd, 1, 'every measured value is unchanged');
  assert.throws(() => anonymiseRow({ broker: 'other' }, letters), /no letter/);
});

test('amendment-01\'s analysis gives the same per-broker numbers on the published rows as the frozen analysis gives on the named rows, under the letters', () => {
  const rows = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h += 3) for (const m of ['anthropic/claude-haiku-4.5', 'openai/gpt-4o-mini']) {
    const ts = `2026-10-${String(28 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:41:00Z`;
    rows.push({ ts, broker: 'openrouter', canonicalModel: m, ok: true, actualCostUsd: 4e-5, estimatedCostUsd: 4e-5 });
    rows.push({ ts, broker: 'eurouter', canonicalModel: m, ok: true, actualCostUsd: 4.4e-5, estimatedCostUsd: 4e-5 });
    rows.push({ ts, broker: 'requesty', canonicalModel: m, ok: true, actualCostUsd: 4e-5, estimatedCostUsd: 4e-5 });
  }
  const named = letteredRecord(prereg, ['openrouter', 'eurouter', 'requesty']);
  const a = analyse(rows, null, named);
  const anonRows = rows.map(r => anonymiseRow(r, letters));
  const b = analyse(anonRows, null, letteredRecord(prereg, Object.values(letters)));
  for (const [broker, letter] of Object.entries(letters)) {
    assert.equal(b.perBroker[letter].verdict, a.perBroker[broker].verdict, broker);
    assert.equal(b.perBroker[letter].medianRelativeGap, a.perBroker[broker].medianRelativeGap, broker);
  }
});

test('outputs() recomputes exactly what is committed as results.json', () => {
  const committed = readFileSync(`${dir}/results.json`, 'utf8');
  assert.equal(outputs(), committed, 'results.json is not what amendment-01/analyse-anon.mjs computes from runs-anon/');
});
