import type { Customer, Invoice, Order } from '../domain';

export interface OrderRepository {
  get(id: string): Promise<Order | undefined>;
  save(order: Order): Promise<void>;
}

export interface CustomerRepository {
  get(id: string): Promise<Customer | undefined>;
  save(customer: Customer): Promise<void>;
}

export interface InvoiceRepository {
  nextNumber(): Promise<string>;
  save(invoice: Invoice): Promise<void>;
}

export interface Notifier {
  invoiceIssued(customer: Customer, invoice: Invoice): Promise<void>;
}
