import { formatCents } from './money.ts';
import type { Order } from './types.ts';

// The CSV export of the first release. Nothing calls it any more.
export function toCsvRow(order: Order): string {
  const total = order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return [order.id, order.customerId, order.status, formatCents(total, order.currency)].join(',');
}
