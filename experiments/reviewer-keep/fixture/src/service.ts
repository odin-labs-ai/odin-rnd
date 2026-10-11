import { type Clock, systemClock } from './clock.ts';
import { InvalidTransition, OrderNotFound } from './errors.ts';
import type { EventBus } from './events.ts';
import { type Id, newId } from './ids.ts';
import { assertCents } from './money.ts';
import { canMove, type OrderStatus } from './status.ts';
import type { OrderStore } from './store.ts';
import type { Order, OrderEvent, OrderLine } from './types.ts';

export class OrderService {
  private readonly store: OrderStore;
  private readonly events: EventBus;
  private readonly clock: Clock;

  constructor(store: OrderStore, events: EventBus, clock: Clock = systemClock) {
    this.store = store;
    this.events = events;
    this.clock = clock;
  }

  async create(customerId: Id<'cus'>, lines: OrderLine[], currency: string): Promise<Order> {
    if (lines.length === 0) throw new Error('an order needs at least one line');
    for (const line of lines) {
      assertCents(line.unitPrice);
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new Error(`invalid quantity for ${line.sku}: ${line.quantity}`);
      }
    }
    const order: Order = {
      id: newId('ord'),
      customerId,
      status: 'draft',
      lines,
      currency,
      createdAt: this.clock.now(),
    };
    await this.store.put(order);
    await this.emit(order, 'created');
    return order;
  }

  async pay(id: Id<'ord'>): Promise<Order> {
    const order = await this.move(id, 'paid');
    order.paidAt = this.clock.now();
    await this.store.put(order);
    await this.emit(order, 'paid');
    return order;
  }

  async ship(id: Id<'ord'>): Promise<Order> {
    const order = await this.move(id, 'shipped');
    order.shippedAt = this.clock.now();
    await this.store.put(order);
    await this.emit(order, 'shipped');
    return order;
  }

  async cancel(id: Id<'ord'>): Promise<Order> {
    const order = await this.move(id, 'cancelled');
    await this.store.put(order);
    await this.emit(order, 'cancelled');
    return order;
  }

  private async move(id: Id<'ord'>, to: OrderStatus): Promise<Order> {
    const order = await this.store.get(id);
    if (order === undefined) throw new OrderNotFound(id);
    if (!canMove(order.status, to)) throw new InvalidTransition(order.status, to);
    order.status = to;
    return order;
  }

  private async emit(order: Order, type: OrderEvent['type']): Promise<void> {
    await this.events.publish({ id: newId('evt'), orderId: order.id, type, at: this.clock.now() });
  }
}
