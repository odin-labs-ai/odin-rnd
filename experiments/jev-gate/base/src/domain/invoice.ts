import type { Money } from './money';
import { orderTotal, type Order } from './order';

export interface Invoice {
  readonly number: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly dueDays: number;
}

export function invoiceFor(order: Order, number: string, dueDays = 30): Invoice {
  return { number, orderId: order.id, amount: orderTotal(order), dueDays };
}
