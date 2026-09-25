import { DomainError, invoiceFor } from '../domain';
import type { CustomerRepository, InvoiceRepository, Notifier, OrderRepository } from './ports';

export async function issueInvoiceUseCase(
  deps: { orders: OrderRepository; customers: CustomerRepository; invoices: InvoiceRepository; notifier: Notifier },
  orderId: string,
): Promise<string> {
  const order = await deps.orders.get(orderId);
  if (!order || order.status !== 'placed') throw new DomainError('invoice.order', 'order is not placed');
  const customer = await deps.customers.get(order.customerId);
  if (!customer) throw new DomainError('customer.missing', 'customer not found');
  const invoice = invoiceFor(order, await deps.invoices.nextNumber());
  await deps.invoices.save(invoice);
  await deps.notifier.invoiceIssued(customer, invoice);
  return invoice.number;
}
