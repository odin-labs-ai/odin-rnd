import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ARMS, family, reportedCostUsd, requestBody, servedMatches } from '../experiments/broker-same-model/lib.mjs';
import { changeIds, verdictOf, WORST_CASE_USD } from '../experiments/broker-same-model/run.mjs';
import { analyse, listUsd, medianCi95, quantile, spendLedger, spread, wilson } from '../experiments/broker-same-model/analyse.mjs';

const dir = 'experiments/broker-same-model';
const prereg = JSON.parse(readFileSync(`${dir}/preregistration.json`, 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('EXP 016 is frozen: the record matches its pin and pins the runner, the shared module and the analysis', () => {
  assert.equal(readFileSync(`${dir}/preregistration.sha256`, 'utf8').trim().split(/\s+/)[0], sha(`${dir}/preregistration.json`));
  assert.equal(prereg.experiment.id, 'EXP 016');
  assert.equal(prereg.code.runner.sha256, sha(prereg.code.runner.file));
  assert.equal(prereg.code.shared.sha256, sha(prereg.code.shared.file));
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script));
  assert.ok(Number.isFinite(Date.parse(prereg.notBefore)), 'notBefore is a time');
  assert.equal(changeIds('all').length, prereg.changes.count);
  const h = createHash('sha256');
  for (const id of changeIds('all')) h.update(readFileSync(`experiments/jev-gate/corpus/${id}.patch`));
  assert.equal(h.digest('hex'), prereg.changes.concatenatedPatchesSha256, 'the 60 changes are the frozen EXP 005 corpus');
  assert.equal(sha('experiments/jev-gate/corpus.sha256'), prereg.changes.corpusSha256File);
});

test('the record and the code agree on arms, ids and prices', () => {
  for (const [arm, spec] of Object.entries(prereg.arms)) {
    assert.equal(ARMS[arm].family, spec.family);
    assert.deepEqual(ARMS[arm].ids, spec.ids);
    for (const b of prereg.brokers) assert.equal(family(spec.ids[b]), spec.family, `${b}'s id names the arm's model`);
  }
});

test('the request is identical across brokers except the model id and the provider pin', () => {
  const a = requestBody('sonnet', 'eurouter', 'DIFF'), b = requestBody('sonnet', 'requesty', 'DIFF'), c = requestBody('sonnet', 'openrouter', 'DIFF');
  assert.deepEqual({ ...a, model: 'x' }, { ...b, model: 'x' });
  assert.deepEqual(c.provider, { order: ['anthropic'], allow_fallbacks: false });
  delete c.provider;
  assert.deepEqual({ ...a, model: 'x' }, { ...c, model: 'x' });
  assert.equal(a.temperature, undefined, 'no temperature on the sonnet arm');
  assert.equal(requestBody('mini', 'requesty', 'D').temperature, 0);
  assert.ok(a.messages[0].content.endsWith('DIFF'));
});

test('the served-model rule: broker spellings of the same model match, another model never does', () => {
  for (const id of ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5', 'aws-bedrock/claude-sonnet-5-5', 'anthropic.claude-sonnet-5-5-20260928-v1:0', 'claude-sonnet-5-5-20260928', 'bedrock/claude-sonnet-5-5@eu-west-1', 'anthropic/claude-sonnet-5.5:batch'])
    assert.ok(servedMatches('sonnet', id), id);
  for (const id of ['gpt-4o-mini-2024-07-18', 'microsoft-foundry/gpt-4o-mini', 'openai/gpt-4o-mini'])
    assert.ok(servedMatches('mini', id), id);
  for (const id of ['anthropic/claude-sonnet-5', 'claude-haiku-4-5', 'claude-sonnet-4-5-20250929', 'openai/gpt-4o', 'gpt-4o-2024-08-06', '', null, undefined])
    assert.ok(!servedMatches('sonnet', id) && !servedMatches('mini', id), String(id));
});

test('cost reading: USD only, a declared currency fills an absent one, never an assumed zero', () => {
  assert.deepEqual(reportedCostUsd('openrouter', { cost: 0.002 }), { usd: 0.002, why: null });
  assert.deepEqual(reportedCostUsd('eurouter', { cost: 0.002, cost_currency: 'USD' }), { usd: 0.002, why: null });
  assert.equal(reportedCostUsd('eurouter', { cost: 0.002 }).usd, null, 'EUrouter declares no default currency');
  assert.equal(reportedCostUsd('requesty', { cost: 0.002, cost_currency: 'EUR' }).usd, null);
  assert.equal(reportedCostUsd('requesty', {}).why, 'no-usage-cost');
  assert.equal(reportedCostUsd('requesty', null).why, 'no-usage');
});

test('verdict parsing, the worst case used by the spend stop, and the default cap is the pre-registered bound', () => {
  assert.match(readFileSync(`${dir}/run.mjs`, 'utf8'), /arg\('cap-usd', '3'\)/);
  assert.equal(verdictOf('VERDICT: SHIP\nREASON: fine'), 'SHIP');
  assert.equal(verdictOf('verdict: fix-needed'), 'FIX-NEEDED');
  assert.equal(verdictOf('no idea'), null);
  assert.ok(WORST_CASE_USD.sonnet > 0.0025 * 2, 'the worst case is above the calibrated cost');
});

test('statistics helpers', () => {
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.equal(medianCi95([1, 2, 3]), null);
  const ci = medianCi95(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.ok(ci[0] < 50.5 && ci[1] > 50.5);
  const w = wilson(0, 120);
  assert.equal(w[0], 0);
  assert.ok(w[1] > 0.02 && w[1] < 0.04);
  assert.equal(spread([1, 1.1, 1]), 0.10000000000000009);
  assert.equal(spread([1, null]), null);
  assert.equal(listUsd({ promptTokens: 264, completionTokens: 158 }, prereg.arms.sonnet.listPrice), 0.002108);
});

function synthetic() {
  const rows = [{ _header: true }];
  const mult = { openrouter: 1, eurouter: 1.1, requesty: 1 };
  for (const rep of [1, 2]) for (let c = 1; c <= 60; c++) for (const arm of ['sonnet', 'mini']) for (const broker of prereg.brokers) {
    const p = prereg.arms[arm].listPrice, pt = 300, ct = 150;
    const list = (pt * p.inputPer1mUsd + ct * p.outputPer1mUsd) / 1e6;
    const fail = broker === 'requesty' && arm === 'mini' && c === 7 && rep === 1;
    rows.push({ ts: '2026-10-23T09:00:00.000Z', kind: 'counted', rep, broker, arm, change: `c${String(c).padStart(3, '0')}`, requestedModel: prereg.arms[arm].ids[broker],
      ok: !fail, status: fail ? 503 : 200, latencyMs: broker === 'openrouter' ? 1000 + c : 3000 + c, servedModel: broker === 'eurouter' && arm === 'sonnet' && c === 3 ? 'claude-sonnet-5' : prereg.arms[arm].ids[broker],
      servedMatches: !(broker === 'eurouter' && arm === 'sonnet' && c === 3), promptTokens: pt, completionTokens: ct, costUsd: fail ? null : list * mult[broker], costWhy: fail ? 'no-usage' : null });
  }
  rows.push({ ts: '2026-10-23T07:59:59.000Z', kind: 'counted', rep: 1, broker: 'openrouter', arm: 'sonnet', ok: true, costUsd: 99 });
  rows.push({ ts: '2026-10-23T09:00:00.000Z', kind: 'calibration', rep: 1, broker: 'openrouter', arm: 'sonnet', ok: true, costUsd: 99 });
  rows.push({ _trailer: true });
  return rows;
}

test('end to end on synthetic rows: a +10% broker is a measured spread, a failure is counted, a swap is reported', () => {
  const r = analyse(synthetic(), prereg);
  assert.equal(r.window.calls, 720, 'practice rows and early rows are not counted');
  assert.equal(r.expectedCalls, 720);
  const s = r.perArm.sonnet, m = r.perArm.mini;
  assert.equal(s.perBroker.eurouter.billedToListMedian, 1.1);
  assert.equal(s.perBroker.openrouter.billedToListMedian, 1);
  assert.equal(s.rate.verdict, 'measured price spread');
  assert.equal(s.rate.spread, 0.1);
  assert.equal(s.silentSubstitutions, 2);
  assert.deepEqual(s.perBroker.eurouter.mismatches, ['claude-sonnet-5']);
  assert.equal(m.perBroker.requesty.errors, 1);
  assert.deepEqual(m.perBroker.requesty.statuses, { 200: 119, 503: 1 });
  assert.equal(m.perBroker.requesty.completeReplicates, 1);
  assert.equal(m.perBroker.requesty.billedUsdPer60Changes, m.perBroker.openrouter.billedUsdPer60Changes, 'a replicate with a failed call is left out of $ per 60 changes, so it cannot look cheaper');
  assert.ok(s.latency.fasterAtP50.includes('openrouter < eurouter'));
  const ledger = spendLedger(synthetic(), prereg).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(ledger.length, 720);
  assert.equal(ledger.filter(l => l.costUsd === null).length, 1);
  assert.equal(ledger.find(l => l.costUsd === null).costMissing, 'no-usage');
});

test('equal billing is price-equivalent; too few priced calls is not enough calls', () => {
  const rows = synthetic().map(r => (r.broker === 'eurouter' && typeof r.costUsd === 'number' ? { ...r, costUsd: r.costUsd / 1.1 * 1.04 } : r));
  assert.equal(analyse(rows, prereg).perArm.sonnet.rate.verdict, 'price-equivalent');
  const sparse = synthetic().filter(r => !(r.broker === 'requesty' && r.rep === 2));
  assert.equal(analyse(sparse, prereg).perArm.sonnet.rate.verdict, 'not enough calls');
});
