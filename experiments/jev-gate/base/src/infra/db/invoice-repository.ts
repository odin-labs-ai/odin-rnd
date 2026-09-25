import type pg from 'pg';
import type { InvoiceRepository } from '../../app/ports';
import type { Invoice } from '../../domain';

export class PgInvoiceRepository implements InvoiceRepository {
  constructor(private readonly pool: pg.Pool, private readonly prefix: string) {}

  async nextNumber(): Promise<string> {
    const result = await this.pool.query("select nextval('invoice_seq') as n");
    return `${this.prefix}-${String(result.rows[0].n).padStart(6, '0')}`;
  }

  async save(invoice: Invoice): Promise<void> {
    await this.pool.query('insert into invoices (number, body) values ($1, $2)', [invoice.number, invoice]);
  }
}
