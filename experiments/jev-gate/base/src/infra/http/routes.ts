import { createServer, type Server } from 'node:http';
import { issueInvoiceUseCase, placeOrderUseCase } from '../../app';
import type { Services } from '../index';

export function createHttpServer(services: Services): Server {
  return createServer(async (req, res) => {
    const match = /^\/orders\/([\w-]+)\/(place|invoice)$/.exec(req.url ?? '');
    if (req.method !== 'POST' || !match) {
      res.writeHead(404).end();
      return;
    }
    const [, orderId, action] = match;
    if (action === 'place') {
      await placeOrderUseCase(services.orders, services.customers, orderId);
      res.writeHead(204).end();
      return;
    }
    const number = await issueInvoiceUseCase(services, orderId);
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ number }));
  });
}
