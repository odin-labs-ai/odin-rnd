import assert from 'node:assert/strict';
import { test } from 'node:test';
import { money, orderTotal, placeOrder, type Order } from '../src/domain';

const order: Order = {
  id: 'o-1',
  customerId: 'c-1',
  status: 'open',
  lines: [{ sku: 'desk', quantity: 2, unitPrice: money(12_500) }],
};

test('order total multiplies quantity by unit price', () => {
  assert.equal(orderTotal(order).cents, 25_000);
});

test('placing an order changes its status', () => {
  assert.equal(placeOrder(order).status, 'placed');
});
