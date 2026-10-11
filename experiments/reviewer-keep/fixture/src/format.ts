import { formatCents, sum } from './money.ts';
import type { Order } from './types.ts';

export function orderTotal(order: Order): number {
  return sum(order.lines.map((line) => line.quantity * line.unitPrice));
}

export function summary(order: Order): string {
  const items = order.lines.reduce((count, line) => count + line.quantity, 0);
  return `${order.id}: ${items} item(s), ${formatCents(orderTotal(order), order.currency)}, ${order.status}`;
}
