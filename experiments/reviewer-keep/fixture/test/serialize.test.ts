import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromJson, toJson } from '../src/serialize.ts';
import type { Order } from '../src/types.ts';

const order: Order = {
  id: 'ord_000000000001',
  customerId: 'cus_000000000001',
  status: 'paid',
  lines: [{ sku: 'A-1', quantity: 2, unitPrice: 1250 }],
  currency: 'EUR',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  paidAt: new Date('2026-01-02T03:05:00.000Z'),
  note: 'leave at the door',
};

test('an order survives a JSON round trip unchanged', () => {
  const back = fromJson(JSON.parse(JSON.stringify(toJson(order))));
  assert.deepEqual(back, order);
});

test('an unknown status is refused', () => {
  assert.throws(() => fromJson({ ...toJson(order), status: 'lost' }));
});
