import type { Id } from './ids.ts';
import type { Cents } from './money.ts';
import type { OrderStatus } from './status.ts';

export interface OrderLine {
  sku: string;
  quantity: number;
  unitPrice: Cents;
}

export interface Order {
  id: Id<'ord'>;
  customerId: Id<'cus'>;
  status: OrderStatus;
  lines: OrderLine[];
  currency: string;
  createdAt: Date;
  paidAt?: Date;
  shippedAt?: Date;
  note?: string;
}

export interface OrderEvent {
  id: Id<'evt'>;
  orderId: Id<'ord'>;
  type: 'created' | 'paid' | 'shipped' | 'cancelled';
  at: Date;
}
