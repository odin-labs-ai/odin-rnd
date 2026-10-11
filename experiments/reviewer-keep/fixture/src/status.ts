export const OrderStatus = {
  Draft: 'draft',
  Paid: 'paid',
  Shipped: 'shipped',
  Cancelled: 'cancelled',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

const allowed: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return allowed[from].includes(to);
}

export function isFinal(status: OrderStatus): boolean {
  return allowed[status].length === 0;
}
