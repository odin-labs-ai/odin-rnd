import type { OrderStatus } from './status.ts';

export class OrderNotFound extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`order ${orderId} not found`);
    this.name = 'OrderNotFound';
    this.orderId = orderId;
  }
}

export class InvalidTransition extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus) {
    super(`an order cannot move from ${from} to ${to}`);
    this.name = 'InvalidTransition';
    this.from = from;
    this.to = to;
  }
}
