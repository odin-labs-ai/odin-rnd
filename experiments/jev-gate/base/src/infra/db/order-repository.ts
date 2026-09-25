import type pg from 'pg';
import type { OrderRepository } from '../../app/ports';
import type { Order } from '../../domain';

export class PgOrderRepository implements OrderRepository {
  constructor(private readonly pool: pg.Pool) {}

  async get(id: string): Promise<Order | undefined> {
    const result = await this.pool.query('select body from orders where id = $1', [id]);
    return result.rows[0]?.body as Order | undefined;
  }

  async save(order: Order): Promise<void> {
    await this.pool.query(
      'insert into orders (id, body) values ($1, $2) on conflict (id) do update set body = $2',
      [order.id, order],
    );
  }
}
