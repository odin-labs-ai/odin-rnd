import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, attempted, brokerVerdict } from './analyse.mjs';

const PREREG = {
  experiment: { id: 'EXP 024' },
  window: { from: '2026-11-04T00:00:00Z', to: '2026-11-11T00:00:00Z' },
  brokers: ['openrouter', 'eurouter', 'requesty'],
  decision: { rule: { minCalls: 20, reliableMaxFailureRate: 0, marginalMaxFailureRate: 0.05 } },
};

function row(overrides = {}) {
  return { broker: 'openrouter', ok: true, ts: '2026-11-05T00:00:00Z', httpStatus: 200, ...overrides };
}

test('brokerVerdict: exact boundaries of the three classes plus not-enough-calls', () => {
  const rule = PREREG.decision.rule;
  assert.equal(brokerVerdict(19, 0, rule), 'not enough calls');
  assert.equal(brokerVerdict(20, 0, rule), 'reliable');
  assert.equal(brokerVerdict(20, 0.05, rule), 'marginal', 'exactly at the marginal ceiling counts as marginal, not unreliable');
  assert.equal(brokerVerdict(20, 0.0500001, rule), 'unreliable', 'just over the ceiling is unreliable');
  assert.equal(brokerVerdict(20, 0.02, rule), 'marginal');
  assert.equal(brokerVerdict(20, 1, rule), 'unreliable');
});

test('attempted: window is half-open — from included, to excluded', () => {
  const fromMs = Date.parse(PREREG.window.from), toMs = Date.parse(PREREG.window.to);
  assert.equal(attempted(row({ ts: '2026-11-04T00:00:00Z' }), 'openrouter', fromMs, toMs), true);
  assert.equal(attempted(row({ ts: '2026-11-10T23:59:59Z' }), 'openrouter', fromMs, toMs), true);
  assert.equal(attempted(row({ ts: '2026-11-11T00:00:00Z' }), 'openrouter', fromMs, toMs), false, 'to is excluded');
  assert.equal(attempted(row({ ts: '2026-11-03T23:59:59Z' }), 'openrouter', fromMs, toMs), false, 'before from is excluded');
});

test('attempted: a failed call still counts as attempted — only header/trailer rows (no ok field) do not', () => {
  const fromMs = Date.parse(PREREG.window.from), toMs = Date.parse(PREREG.window.to);
  assert.equal(attempted(row({ ok: false }), 'openrouter', fromMs, toMs), true, 'failures are attempts, not excluded from the denominator');
  assert.equal(attempted({ _header: true, broker: 'openrouter', ts: '2026-11-05T00:00:00Z' }, 'openrouter', fromMs, toMs), false);
  assert.equal(attempted({ _trailer: true, broker: 'openrouter', ts: '2026-11-05T00:00:00Z' }, 'openrouter', fromMs, toMs), false);
  assert.equal(attempted(row({ broker: 'eurouter' }), 'openrouter', fromMs, toMs), false, 'a different broker is not attempted for this one');
});

test('analyse: a clean broker (0 failures) classifies reliable, with 0 failureDetail entries', () => {
  const rows = Array.from({ length: 56 }, () => row());
  const result = analyse(rows, PREREG);
  const b = result.perBroker.openrouter;
  assert.equal(b.callsAttempted, 56);
  assert.equal(b.callsFailed, 0);
  assert.equal(b.failureRate, 0);
  assert.equal(b.verdict, 'reliable');
  assert.deepEqual(b.failureDetail, []);
});

test('analyse: 1 failure of 56 (~1.8%) is marginal, and the failed row is captured in failureDetail', () => {
  const rows = [...Array.from({ length: 55 }, () => row()), row({ ok: false, httpStatus: 503, ts: '2026-11-06T12:00:00Z' })];
  const result = analyse(rows, PREREG);
  const b = result.perBroker.openrouter;
  assert.equal(b.callsAttempted, 56);
  assert.equal(b.callsFailed, 1);
  assert.ok(b.failureRate > 0 && b.failureRate <= 0.05);
  assert.equal(b.verdict, 'marginal');
  assert.equal(b.failureDetail.length, 1);
  assert.equal(b.failureDetail[0].httpStatus, 503);
  assert.equal(b.failureDetail[0].ts, '2026-11-06T12:00:00Z');
});

test('analyse: 5 failures of 56 (~8.9%) is unreliable', () => {
  const rows = [...Array.from({ length: 51 }, () => row()), ...Array.from({ length: 5 }, () => row({ ok: false }))];
  const result = analyse(rows, PREREG);
  assert.equal(result.perBroker.openrouter.verdict, 'unreliable');
});

test('analyse: brokers are independent — one broker\'s failures never affect another\'s verdict', () => {
  const rows = [
    ...Array.from({ length: 56 }, () => row({ broker: 'openrouter' })),
    ...Array.from({ length: 50 }, () => row({ broker: 'eurouter', ok: false })),
  ];
  const result = analyse(rows, PREREG);
  assert.equal(result.perBroker.openrouter.verdict, 'reliable');
  assert.equal(result.perBroker.eurouter.verdict, 'unreliable');
  assert.equal(result.perBroker.requesty.verdict, 'not enough calls');
});

test('analyse: preregistrationSha256 passes through and every pre-registered broker always appears', () => {
  const prereg = { ...PREREG, sha256: 'deadbeef' };
  const result = analyse([], prereg);
  assert.equal(result.preregistrationSha256, 'deadbeef');
  for (const broker of prereg.brokers) assert.equal(result.perBroker[broker].verdict, 'not enough calls');
});
