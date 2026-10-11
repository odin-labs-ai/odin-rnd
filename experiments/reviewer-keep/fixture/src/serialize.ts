import { parseId } from './ids.ts';
import { assertCents } from './money.ts';
import { OrderStatus } from './status.ts';
import type { Order } from './types.ts';

export interface OrderJson {
  id: string;
  customerId: string;
  status: string;
  lines: { sku: string; quantity: number; unitPrice: number }[];
  currency: string;
  createdAt: string;
  paidAt?: string;
  shippedAt?: string;
  note?: string;
}

export function toJson(order: Order): OrderJson {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    lines: order.lines.map((line) => ({ ...line })),
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString(),
    shippedAt: order.shippedAt?.toISOString(),
    note: order.note,
  };
}

const statuses: readonly string[] = Object.values(OrderStatus);

function parseStatus(value: string): OrderStatus {
  if (!statuses.includes(value)) throw new Error(`unknown status: ${value}`);
  return value as OrderStatus;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${value}`);
  return date;
}

export function fromJson(json: OrderJson): Order {
  const order: Order = {
    id: parseId('ord', json.id),
    customerId: parseId('cus', json.customerId),
    status: parseStatus(json.status),
    lines: json.lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: assertCents(line.unitPrice),
    })),
    currency: json.currency,
    createdAt: parseDate(json.createdAt),
  };
  if (json.paidAt !== undefined) order.paidAt = parseDate(json.paidAt);
  if (json.shippedAt !== undefined) order.shippedAt = parseDate(json.shippedAt);
  if (json.note !== undefined) order.note = json.note;
  return order;
}
