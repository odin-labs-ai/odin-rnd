import type pg from 'pg';
import type { CustomerRepository } from '../../app/ports';
import type { Customer } from '../../domain';

export class PgCustomerRepository implements CustomerRepository {
  constructor(private readonly pool: pg.Pool) {}

  async get(id: string): Promise<Customer | undefined> {
    const result = await this.pool.query('select body from customers where id = $1', [id]);
    return result.rows[0]?.body as Customer | undefined;
  }

  async save(customer: Customer): Promise<void> {
    await this.pool.query('insert into customers (id, body) values ($1, $2)', [customer.id, customer]);
  }
}
