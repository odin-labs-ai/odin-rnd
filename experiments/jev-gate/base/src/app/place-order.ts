import { DomainError, orderTotal, placeOrder } from '../domain';
import type { CustomerRepository, OrderRepository } from './ports';

export async function placeOrderUseCase(
  orders: OrderRepository,
  customers: CustomerRepository,
  orderId: string,
): Promise<void> {
  const order = await orders.get(orderId);
  if (!order) throw new DomainError('order.missing', `order ${orderId} not found`);
  const customer = await customers.get(order.customerId);
  if (!customer) throw new DomainError('customer.missing', `customer ${order.customerId} not found`);
  if (orderTotal(order).cents > customer.creditLimitCents) {
    throw new DomainError('order.credit', 'order exceeds the credit limit');
  }
  await orders.save(placeOrder(order));
}
