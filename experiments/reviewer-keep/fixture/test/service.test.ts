import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedClock } from '../src/clock.ts';
import { InvalidTransition, OrderNotFound } from '../src/errors.ts';
import { EventBus } from '../src/events.ts';
import { OrderService } from '../src/service.ts';
import { MemoryOrderStore } from '../src/store.ts';
import type { OrderEvent } from '../src/types.ts';

function setup() {
  const events: OrderEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => {
    events.push(e);
  });
  const service = new OrderService(
    new MemoryOrderStore(),
    bus,
    fixedClock(new Date('2026-01-01T00:00:00.000Z')),
  );
  return { service, events };
}

const lines = [{ sku: 'A-1', quantity: 1, unitPrice: 500 }];

test('an order moves from draft to paid to shipped', async () => {
  const { service, events } = setup();
  const order = await service.create('cus_000000000001', lines, 'EUR');
  assert.equal((await service.pay(order.id)).status, 'paid');
  assert.equal((await service.ship(order.id)).status, 'shipped');
  assert.deepEqual(
    events.map((e) => e.type),
    ['created', 'paid', 'shipped'],
  );
});

test('a shipped order cannot be cancelled', async () => {
  const { service } = setup();
  const order = await service.create('cus_000000000001', lines, 'EUR');
  await service.pay(order.id);
  await service.ship(order.id);
  await assert.rejects(service.cancel(order.id), InvalidTransition);
});

test('an unknown order is reported', async () => {
  const { service } = setup();
  await assert.rejects(service.pay('ord_zzzzzzzzzzzz'), OrderNotFound);
});

test('an order needs at least one line and whole quantities', async () => {
  const { service } = setup();
  await assert.rejects(service.create('cus_000000000001', [], 'EUR'));
  await assert.rejects(
    service.create('cus_000000000001', [{ sku: 'A-1', quantity: 0.5, unitPrice: 500 }], 'EUR'),
  );
});
