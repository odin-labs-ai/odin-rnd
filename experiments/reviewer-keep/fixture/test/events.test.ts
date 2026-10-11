import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventBus } from '../src/events.ts';
import type { OrderEvent } from '../src/types.ts';

const event = (n: number): OrderEvent => ({
  id: `evt_00000000000${n}`,
  orderId: 'ord_000000000001',
  type: 'created',
  at: new Date(0),
});

test('events are delivered in the order they were published', async () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.subscribe(async (e) => {
    await new Promise((resolve) => setTimeout(resolve, e.id.endsWith('1') ? 20 : 0));
    seen.push(e.id);
  });
  await Promise.all([bus.publish(event(1)), bus.publish(event(2))]);
  assert.deepEqual(seen, ['evt_000000000001', 'evt_000000000002']);
});

test('a failing subscriber does not stop the others', async () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.subscribe(() => {
    throw new Error('boom');
  });
  bus.subscribe((e) => {
    seen.push(e.id);
  });
  await bus.publish(event(3));
  assert.deepEqual(seen, ['evt_000000000003']);
});
