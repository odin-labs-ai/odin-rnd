import type { Id } from './ids.ts';
import type { Order } from './types.ts';

export interface OrderStore {
  get(id: Id<'ord'>): Promise<Order | undefined>;
  put(order: Order): Promise<void>;
  list(): Promise<Order[]>;
}

export class MemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, Order>();

  async get(id: Id<'ord'>): Promise<Order | undefined> {
    const order = this.orders.get(id);
    return order === undefined ? undefined : structuredClone(order);
  }

  async put(order: Order): Promise<void> {
    this.orders.set(order.id, structuredClone(order));
  }

  async list(): Promise<Order[]> {
    return [...this.orders.values()].map((order) => structuredClone(order));
  }
}
