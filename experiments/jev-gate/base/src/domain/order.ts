import { DomainError } from './errors';
import { add, money, multiply, type Money } from './money';

export interface OrderLine {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: Money;
}

export interface Order {
  readonly id: string;
  readonly customerId: string;
  readonly lines: readonly OrderLine[];
  readonly status: 'open' | 'placed' | 'cancelled';
}

export function orderTotal(order: Order): Money {
  return order.lines.reduce((sum, line) => add(sum, multiply(line.unitPrice, line.quantity)), money(0));
}

export function placeOrder(order: Order): Order {
  if (order.lines.length === 0) throw new DomainError('order.empty', 'an order needs at least one line');
  if (order.status !== 'open') throw new DomainError('order.status', 'only open orders can be placed');
  return { ...order, status: 'placed' };
}
