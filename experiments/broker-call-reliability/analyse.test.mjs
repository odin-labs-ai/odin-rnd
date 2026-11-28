import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse, attempted, brokerVerdict, readCapture } from './analyse.mjs';
import { anonymiseRow } from './anonymise.mjs';

const PREREG = {
  experiment: { id: 'EXP 024' },
  window: { from: '2026-11-04T00:00:00Z', to: '2026-11-11T00:00:00Z' },
  brokers: ['X', 'Y', 'Z'],
  decision: { rule: { minCalls: 20, reliableMaxFailureRate: 0, marginalMaxFailureRate: 0.05 } },
};

function row(overrides = {}) {
  return { broker: 'X', ok: true, ts: '2026-11-05T00:00:00Z', httpStatus: 200, ...overrides };
}

test('brokerVerdict: exact boundaries of the three classes plus not-enough-calls', () => {
  const rule = PREREG.decision.rule;
  assert.equal(brokerVerdict(19, 0, rule), 'not enough calls');
  assert.equal(brokerVerdict(20, 0, rule), 'reliable');
  assert.equal(brokerVerdict(20, 0.05, rule), 'marginal');
  assert.equal(brokerVerdict(20, 0.0500001, rule), 'unreliable');
  assert.equal(brokerVerdict(20, 1, rule), 'unreliable');
});

test('attempted: window is half-open, a failed call still counts as attempted, header/trailer rows do not', () => {
  const fromMs = Date.parse(PREREG.window.from), toMs = Date.parse(PREREG.window.to);
  assert.equal(attempted(row({ ts: '2026-11-04T00:00:00Z' }), 'X', fromMs, toMs), true);
  assert.equal(attempted(row({ ts: '2026-11-11T00:00:00Z' }), 'X', fromMs, toMs), false, 'to is excluded');
  assert.equal(attempted(row({ ok: false }), 'X', fromMs, toMs), true, 'failures are attempts');
  assert.equal(attempted({ _header: true, broker: 'X', ts: '2026-11-05T00:00:00Z' }, 'X', fromMs, toMs), false);
  assert.equal(attempted(row({ broker: 'Y' }), 'X', fromMs, toMs), false);
});

test('analyse: a clean broker is reliable; brokers are independent', () => {
  const rows = [
    ...Array.from({ length: 56 }, () => row({ broker: 'X' })),
    ...Array.from({ length: 50 }, () => row({ broker: 'Y', ok: false })),
  ];
  const result = analyse(rows, PREREG);
  assert.equal(result.perBroker.X.verdict, 'reliable');
  assert.equal(result.perBroker.Y.verdict, 'unreliable');
  assert.equal(result.perBroker.Z.verdict, 'not enough calls');
});

test('analyse: 1 of 112 (~0.89%) is marginal, with the failed row captured in failureDetail', () => {
  const rows = [...Array.from({ length: 111 }, () => row()), row({ ok: false, httpStatus: 503, ts: '2026-11-05T09:44:06Z' })];
  const result = analyse(rows, PREREG);
  const b = result.perBroker.X;
  assert.equal(b.callsAttempted, 112);
  assert.equal(b.callsFailed, 1);
  assert.equal(b.verdict, 'marginal');
  assert.equal(b.failureDetail[0].httpStatus, 503);
});

test('anonymiseRow: letters the broker and keyName, drops every identifying field, keeps ok/httpStatus/ts unchanged', () => {
  const letters = { openrouter: 'G', eurouter: 'H', requesty: 'I' };
  const named = {
    broker: 'eurouter', canonicalModel: 'anthropic/claude-haiku-4.5', requestedModel: 'claude-haiku-4.5',
    servedModel: 'aws-bedrock/claude-haiku-4.5', servedProvider: 'aws-bedrock',
    estimateSource: 'price-book local-agents packages/model-price-book/src/price-book.ts:287',
    httpStatus: 200, keyName: 'env:RND_PROBE_EUROUTER_API_KEY', ok: true, ts: '2026-11-05T00:00:00Z',
  };
  const anon = anonymiseRow(named, letters);
  assert.equal(anon.broker, 'H');
  assert.equal(anon.keyName, 'env:RND_PROBE_H_API_KEY');
  assert.equal(anon.httpStatus, 200);
  assert.equal(anon.ok, true);
  for (const dropped of ['requestedModel', 'servedModel', 'servedProvider', 'estimateSource', 'canonicalModel'])
    assert.ok(!(dropped in anon), `${dropped} was not dropped`);
  assert.throws(() => anonymiseRow({ broker: 'other' }, letters), /no letter/);
});

test('readCapture + analyse round trip over the real committed runs-anon/ matches results.json', () => {
  const prereg = JSON.parse(readFileSync('experiments/broker-call-reliability/preregistration.json', 'utf8'));
  prereg.sha256 = readFileSync('experiments/broker-call-reliability/preregistration.sha256', 'utf8').trim().split(/\s+/)[0];
  const rows = readCapture('experiments/broker-call-reliability/runs-anon');
  const result = analyse(rows, prereg);
  const committed = JSON.parse(readFileSync('experiments/broker-call-reliability/results.json', 'utf8'));
  assert.deepEqual(result, committed);
});
