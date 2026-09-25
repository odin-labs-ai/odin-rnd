import type { CustomerRepository, InvoiceRepository, Notifier, OrderRepository } from '../app';
import { PgCustomerRepository } from './db/customer-repository';
import { PgInvoiceRepository } from './db/invoice-repository';
import { PgOrderRepository } from './db/order-repository';
import { createPool } from './db/pool';
import { SmtpNotifier } from './mail/mailer';

export interface Services {
  orders: OrderRepository;
  customers: CustomerRepository;
  invoices: InvoiceRepository;
  notifier: Notifier;
}

export function createServices(settings: {
  databaseUrl: string;
  smtpHost: string;
  smtpFrom: string;
  invoicePrefix: string;
}): Services {
  const pool = createPool(settings.databaseUrl);
  return {
    orders: new PgOrderRepository(pool),
    customers: new PgCustomerRepository(pool),
    invoices: new PgInvoiceRepository(pool, settings.invoicePrefix),
    notifier: new SmtpNotifier(settings.smtpHost, settings.smtpFrom),
  };
}

export { createHttpServer } from './http/routes';
