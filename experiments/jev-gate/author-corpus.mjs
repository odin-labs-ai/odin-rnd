// WO-03: author the seeded change corpus against base/, under the quotas fixed in corpus-spec.json.
//
// This file is the author's intent. It is NOT a gate input: gates see only rules.txt and the
// patch text. Each item names its family and, for drift, the rule it was written to break;
// labels.json (bce) decides the truth. Items get neutral ids c001..c060 through a seeded shuffle,
// so the id order does not follow the family order below.
//
//   node experiments/jev-gate/author-corpus.mjs            write corpus/*.patch and manifest.json
//   node experiments/jev-gate/author-corpus.mjs --check    regenerate in memory and compare
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERE } from './bce-contract.mjs';
import { diffsFor } from './patchlib.mjs';

export const BASE = join(HERE, 'base');
export const CORPUS = join(HERE, 'corpus');
export const MANIFEST = join(HERE, 'manifest.json');
export const SEED = 5005;

const r = (path, from, to) => ({ path, replace: [from, to] });
const after = (path, anchor, text) => r(path, anchor, anchor + text);
const before = (path, anchor, text) => r(path, anchor, text + anchor);
const file = (path, content) => ({ path, content });

const ORDER_IMPORTS = "import { add, money, multiply, type Money } from './money';\n";
const CUSTOMER_IMPORTS = "import { DomainError } from './errors';\n";
const INVOICE_IMPORTS = "import { orderTotal, type Order } from './order';\n";

// ------------------------------------------------------------------------------------------ drift
const drift = [
  // reverse-layer-import
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    after('src/domain/order.ts', ORDER_IMPORTS, "import type { OrderRepository } from '../app/ports';\n"),
    after('src/domain/order.ts', "  return { ...order, status: 'placed' };\n}\n", "\nexport async function reloadOrder(repository: OrderRepository, id: string): Promise<Order> {\n  const order = await repository.get(id);\n  if (!order) throw new DomainError('order.missing', `order ${id} not found`);\n  return order;\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    after('src/domain/order.ts', ORDER_IMPORTS, "import type { CustomerRepository } from '../app';\n"),
    after('src/domain/order.ts', "  return { ...order, status: 'placed' };\n}\n", '\nexport async function withinCreditLimit(order: Order, customers: CustomerRepository): Promise<boolean> {\n  const customer = await customers.get(order.customerId);\n  return customer !== undefined && orderTotal(order).cents <= customer.creditLimitCents;\n}\n'),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    r('src/domain/invoice.ts', "import type { Money } from './money';\n", "import type { Settings } from '../config/settings';\nimport type { Money } from './money';\n"),
    after('src/domain/invoice.ts', '  return { number, orderId: order.id, amount: orderTotal(order), dueDays };\n}\n', "\nexport function invoiceNumber(settings: Pick<Settings, 'invoicePrefix'>, sequence: number): string {\n  return `${settings.invoicePrefix}-${String(sequence).padStart(6, '0')}`;\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    after('src/domain/customer.ts', CUSTOMER_IMPORTS, "import { loadSettings } from '../config/settings';\n"),
    after('src/domain/customer.ts', "  return { id, name: name.trim(), email: email.toLowerCase(), creditLimitCents: 50_000 };\n}\n", '\nexport function welcomeSender(): string {\n  return loadSettings().smtpFrom;\n}\n'),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    file('src/domain/order-events.ts', "import type { OrderRepository } from '../app';\nimport type { Order } from './order';\n\nexport interface OrderPlaced {\n  readonly orderId: string;\n  readonly at: Date;\n}\n\nexport async function replay(events: OrderPlaced[], orders: OrderRepository): Promise<Order[]> {\n  const found = await Promise.all(events.map(event => orders.get(event.orderId)));\n  return found.filter((order): order is Order => order !== undefined);\n}\n"),
    after('src/domain/index.ts', "export * from './order';\n", "export * from './order-events';\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    before('src/app/issue-invoice.ts', 'export async function issueInvoiceUseCase(', 'export const PAYMENT_TERMS_DAYS = 14;\n\n'),
    r('src/domain/invoice.ts', "import type { Money } from './money';\n", "import { PAYMENT_TERMS_DAYS } from '../app/issue-invoice';\nimport type { Money } from './money';\n"),
    r('src/domain/invoice.ts', 'dueDays = 30): Invoice {', 'dueDays = PAYMENT_TERMS_DAYS): Invoice {'),
  ] },
  // infra-leak
  { family: 'infra-leak', targets: ['domain-no-infra'], edits: [
    after('src/domain/order.ts', ORDER_IMPORTS, "import type { PgOrderRepository } from '../infra/db/order-repository';\n"),
    after('src/domain/order.ts', "  return { ...order, status: 'placed' };\n}\n", '\nexport async function placeAndStore(order: Order, repository: PgOrderRepository): Promise<Order> {\n  const placed = placeOrder(order);\n  await repository.save(placed);\n  return placed;\n}\n'),
  ] },
  { family: 'infra-leak', targets: ['domain-no-infra'], edits: [
    after('src/domain/customer.ts', CUSTOMER_IMPORTS, "import { createPool } from '../infra/db/pool';\n"),
    after('src/domain/customer.ts', "  return { id, name: name.trim(), email: email.toLowerCase(), creditLimitCents: 50_000 };\n}\n", "\nexport async function emailTaken(databaseUrl: string, email: string): Promise<boolean> {\n  const result = await createPool(databaseUrl).query(\"select 1 from customers where body->>'email' = $1\", [email]);\n  return result.rowCount !== 0;\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['core-no-pg'], edits: [
    before('src/domain/money.ts', 'export interface Money {', 'import pg from "pg";\n\n// numeric columns arrive as strings; parse them as cents\npg.types.setTypeParser(1700, value => Math.round(Number(value) * 100));\n\n'),
  ] },
  { family: 'infra-leak', targets: ['core-no-pg'], edits: [
    r('src/app/issue-invoice.ts', "import { DomainError, invoiceFor } from '../domain';\n", "import type pg from 'pg';\nimport { DomainError, invoiceFor } from '../domain';\n"),
    r('src/app/issue-invoice.ts', 'notifier: Notifier },', 'notifier: Notifier; pool?: pg.Pool },'),
    r('src/app/issue-invoice.ts', '  await deps.invoices.save(invoice);\n', "  await deps.pool?.query('begin');\n  await deps.invoices.save(invoice);\n  await deps.pool?.query('commit');\n"),
  ] },
  { family: 'infra-leak', targets: ['app-no-infra-internals'], edits: [
    file('src/app/health.ts', "import { createPool } from '../infra/db/pool';\n\nexport async function databaseReachable(databaseUrl: string): Promise<boolean> {\n  const pool = createPool(databaseUrl);\n  try {\n    await pool.query('select 1');\n    return true;\n  } catch {\n    return false;\n  } finally {\n    await pool.end();\n  }\n}\n"),
    before('src/app/index.ts', "export { issueInvoiceUseCase } from './issue-invoice';\n", "export { databaseReachable } from './health';\n"),
  ] },
  // forbidden-config-key
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    r('src/config/settings.ts', '\nexport function loadSettings(): Settings {', '\n// Payment keys are not loaded here: the billing worker reads process.env.STRIPE_SECRET_KEY on its own.\nexport function loadSettings(): Settings {'),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    r('src/config/settings.ts', '  invoicePrefix: string;\n}', '  invoicePrefix: string;\n  redisUrl: string;\n}'),
    r('src/config/settings.ts', "    invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',\n", "    invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',\n    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    file('src/config/features.ts', "export interface Features {\n  fastCheckout: boolean;\n  pdfInvoices: boolean;\n}\n\nexport function loadFeatures(): Features {\n  return {\n    fastCheckout: process.env.FEATURE_FAST_CHECKOUT === '1',\n    pdfInvoices: process.env.FEATURE_PDF_INVOICES === '1',\n  };\n}\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    r('src/domain/customer.ts', 'creditLimitCents: 50_000 };', "creditLimitCents: Number(process.env.CREDIT_LIMIT_CENTS ?? 50_000) };"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    r('src/domain/invoice.ts', 'export function invoiceFor(', '/** dueDays is the payment term in days; callers pass the value src/config reads from process.env. */\nexport function invoiceFor('),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    r('src/app/place-order.ts', '  if (orderTotal(order).cents > customer.creditLimitCents) {', "  const skipCreditCheck = process.env.SKIP_CREDIT_CHECK === '1';\n  if (!skipCreditCheck && orderTotal(order).cents > customer.creditLimitCents) {"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    r('src/app/issue-invoice.ts', '  await deps.notifier.invoiceIssued(customer, invoice);\n', '  // A mail failure is not retried here; the SMTP host comes from process.env through loadSettings().\n  await deps.notifier.invoiceIssued(customer, invoice);\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    r('src/infra/db/pool.ts', 'max: 10 });', "max: Number(process.env.PG_POOL_MAX ?? 10) });"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    r('src/infra/mail/mailer.ts', '  constructor(host: string, private readonly from: string) {', '  // host and from are passed in by createServices, which gets them from process.env via loadSettings().\n  constructor(host: string, private readonly from: string) {'),
  ] },
  // reexport-from-governed-file
  { family: 'reexport-from-governed-file', targets: ['domain-no-infra'], edits: [
    after('src/domain/index.ts', "export * from './order';\n", "export { createPool } from '../infra/db/pool';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-app'], edits: [
    after('src/domain/index.ts', "export * from './order';\n", "export type { CustomerRepository, OrderRepository } from '../app/ports';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['app-no-infra-internals'], edits: [
    after('src/app/index.ts', "export { registerCustomerUseCase } from './register-customer';\n", "export { PgCustomerRepository } from '../infra/db/customer-repository';\nexport { PgOrderRepository } from '../infra/db/order-repository';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-config'], edits: [
    after('src/domain/index.ts', "export * from './order';\n", "export * from '../config/settings';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['core-no-pg'], edits: [
    before('src/app/ports.ts', "import type { Customer, Invoice, Order } from '../domain';\n", "export type { Pool, PoolClient } from 'pg';\n"),
  ] },
  // dynamic-import
  { family: 'dynamic-import', targets: ['domain-no-infra'], edits: [
    after('src/domain/invoice.ts', '  return { number, orderId: order.id, amount: orderTotal(order), dueDays };\n}\n', "\nexport async function sendReminder(invoice: Invoice, to: { email: string; name: string }): Promise<void> {\n  const { SmtpNotifier } = await import('../infra/mail/mailer');\n  const customer = { id: '-', name: to.name, email: to.email, creditLimitCents: 0 };\n  await new SmtpNotifier('localhost', 'no-reply').invoiceIssued(customer, invoice);\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['app-no-infra-internals'], edits: [
    file('src/infra/files/csv.ts', "export function toCsv(rows: readonly (readonly string[])[]): string {\n  return rows.map(row => row.map(cell => `\"${cell.replace(/\"/g, '\"\"')}\"`).join(',')).join('\\n');\n}\n"),
    file('src/app/export-invoices.ts', "import type { Invoice } from '../domain';\n\nexport async function invoicesCsv(invoices: readonly Invoice[]): Promise<string> {\n  const { toCsv } = await import('../infra/files/csv');\n  return toCsv([\n    ['number', 'order', 'amount'],\n    ...invoices.map(invoice => [invoice.number, invoice.orderId, (invoice.amount.cents / 100).toFixed(2)]),\n  ]);\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-config'], edits: [
    after('src/domain/invoice.ts', '  return { number, orderId: order.id, amount: orderTotal(order), dueDays };\n}\n', "\nexport async function invoiceReference(invoice: Invoice): Promise<string> {\n  const { loadSettings } = await import('../config/settings');\n  return `${loadSettings().invoicePrefix}/${invoice.orderId}`;\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-infra'], edits: [
    after('src/domain/customer.ts', "  return { id, name: name.trim(), email: email.toLowerCase(), creditLimitCents: 50_000 };\n}\n", "\nexport async function repositoryFor(kind: 'customer' | 'order') {\n  return import(`../infra/db/${kind}-repository`);\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['core-no-pg'], edits: [
    after('src/app/issue-invoice.ts', '  return invoice.number;\n}\n', "\nexport async function invoiceExists(databaseUrl: string, number: string): Promise<boolean> {\n  const { default: pg } = await import('pg');\n  const client = new pg.Client({ connectionString: databaseUrl });\n  await client.connect();\n  try {\n    const result = await client.query('select 1 from invoices where number = $1', [number]);\n    return result.rowCount !== 0;\n  } finally {\n    await client.end();\n  }\n}\n"),
  ] },
];

// ------------------------------------------------------------------------------------------ clean
const clean = [
  // feature-add
  { family: 'feature-add', edits: [
    file('src/jobs/purge-orders.ts', "import { loadSettings } from '../config/settings';\nimport { createPool } from '../infra/db/pool';\n\nexport async function purgeCancelledOrders(): Promise<number> {\n  const pool = createPool(loadSettings().databaseUrl);\n  try {\n    const result = await pool.query(\"delete from orders where body->>'status' = 'cancelled'\");\n    return result.rowCount ?? 0;\n  } finally {\n    await pool.end();\n  }\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/config/log-level.ts', "export type LogLevel = 'debug' | 'info' | 'warn';\n\nexport function logLevel(): LogLevel {\n  const level = process.env.LOG_LEVEL ?? 'info';\n  return level === 'debug' || level === 'warn' ? level : 'info';\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/app/cancel-order.ts', "import { cancelOrder, DomainError } from '../domain';\nimport type { OrderRepository } from './ports';\n\nexport async function cancelOrderUseCase(orders: OrderRepository, orderId: string): Promise<void> {\n  const order = await orders.get(orderId);\n  if (!order) throw new DomainError('order.missing', `order ${orderId} not found`);\n  await orders.save(cancelOrder(order));\n}\n"),
    after('src/domain/order.ts', "  return { ...order, status: 'placed' };\n}\n", "\nexport function cancelOrder(order: Order): Order {\n  return { ...order, status: 'cancelled' };\n}\n"),
    before('src/app/index.ts', "export { issueInvoiceUseCase } from './issue-invoice';\n", "export { cancelOrderUseCase } from './cancel-order';\n"),
  ] },
  { family: 'feature-add', edits: [
    after('src/infra/db/order-repository.ts', "    return result.rows[0]?.body as Order | undefined;\n  }\n", "\n  async listByCustomer(customerId: string): Promise<Order[]> {\n    const result = await this.pool.query(\"select body from orders where body->>'customerId' = $1\", [customerId]);\n    return result.rows.map(row => row.body as Order);\n  }\n"),
  ] },
  { family: 'feature-add', edits: [
    r('src/infra/http/routes.ts', "    const match = /^\\/orders\\/([\\w-]+)\\/(place|invoice)$/.exec(req.url ?? '');\n", "    if (req.method === 'GET' && req.url === '/health') {\n      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');\n      return;\n    }\n    const match = /^\\/orders\\/([\\w-]+)\\/(place|invoice)$/.exec(req.url ?? '');\n"),
  ] },
  { family: 'feature-add', edits: [
    after('src/domain/customer.ts', "  return { id, name: name.trim(), email: email.toLowerCase(), creditLimitCents: 50_000 };\n}\n", "\nexport function raiseCreditLimit(customer: Customer, byCents: number): Customer {\n  if (byCents <= 0) throw new DomainError('customer.credit', 'the increase must be positive');\n  return { ...customer, creditLimitCents: customer.creditLimitCents + byCents };\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/domain/discount.ts', "import { money, type Money } from './money';\n\nexport function applyDiscount(amount: Money, percent: number): Money {\n  if (percent < 0 || percent > 100) throw new RangeError('percent must be between 0 and 100');\n  return money(Math.round((amount.cents * (100 - percent)) / 100), amount.currency);\n}\n"),
    after('src/domain/index.ts', "export * from './customer';\n", "export * from './discount';\n"),
  ] },
  { family: 'feature-add', edits: [
    r('src/app/place-order.ts', '  const customer = await customers.get(order.customerId);\n', "  if (order.lines.some(line => line.quantity <= 0)) {\n    throw new DomainError('order.quantity', 'every line needs a positive quantity');\n  }\n  const customer = await customers.get(order.customerId);\n"),
  ] },
  // refactor-rename
  { family: 'refactor-rename', edits: [
    { path: 'src/domain/errors.ts', renameTo: 'src/domain/domain-error.ts' },
    r('src/domain/customer.ts', "from './errors';", "from './domain-error';"),
    r('src/domain/order.ts', "from './errors';", "from './domain-error';"),
    r('src/domain/index.ts', "export * from './errors';\n", "export * from './domain-error';\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/domain/order.ts', 'export function orderTotal(order: Order): Money {', 'export function totalOf(order: Order): Money {'),
    r('src/domain/invoice.ts', "import { orderTotal, type Order } from './order';", "import { totalOf, type Order } from './order';"),
    r('src/domain/invoice.ts', 'amount: orderTotal(order)', 'amount: totalOf(order)'),
    r('src/app/place-order.ts', 'import { DomainError, orderTotal, placeOrder }', 'import { DomainError, placeOrder, totalOf }'),
    r('src/app/place-order.ts', 'if (orderTotal(order).cents', 'if (totalOf(order).cents'),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/db/invoice-repository.ts', "    return `${this.prefix}-${String(result.rows[0].n).padStart(6, '0')}`;\n", '    return formatInvoiceNumber(this.prefix, Number(result.rows[0].n));\n'),
    r('src/infra/db/invoice-repository.ts', '\nexport class PgInvoiceRepository', "\nfunction formatInvoiceNumber(prefix: string, sequence: number): string {\n  return `${prefix}-${String(sequence).padStart(6, '0')}`;\n}\n\nexport class PgInvoiceRepository"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/db/order-repository.ts', "import type pg from 'pg';\n", "import type { Pool } from 'pg';\n"),
    r('src/infra/db/order-repository.ts', 'private readonly pool: pg.Pool', 'private readonly pool: Pool'),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/config/settings.ts', 'function required(name: string, value: string | undefined): string {', 'function requireSetting(name: string, value: string | undefined): string {'),
    r('src/config/settings.ts', "databaseUrl: required('DATABASE_URL',", "databaseUrl: requireSetting('DATABASE_URL',"),
    r('src/config/settings.ts', "smtpHost: required('SMTP_HOST',", "smtpHost: requireSetting('SMTP_HOST',"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/app/issue-invoice.ts', "  const order = await deps.orders.get(orderId);\n  if (!order || order.status !== 'placed') throw new DomainError('invoice.order', 'order is not placed');\n  const customer = await deps.customers.get(order.customerId);\n  if (!customer) throw new DomainError('customer.missing', 'customer not found');\n  const invoice = invoiceFor(order, await deps.invoices.nextNumber());\n  await deps.invoices.save(invoice);\n  await deps.notifier.invoiceIssued(customer, invoice);\n", "  const { orders, customers, invoices, notifier } = deps;\n  const order = await orders.get(orderId);\n  if (!order || order.status !== 'placed') throw new DomainError('invoice.order', 'order is not placed');\n  const customer = await customers.get(order.customerId);\n  if (!customer) throw new DomainError('customer.missing', 'customer not found');\n  const invoice = invoiceFor(order, await invoices.nextNumber());\n  await invoices.save(invoice);\n  await notifier.invoiceIssued(customer, invoice);\n"),
  ] },
  // allowed-import-near-forbidden
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/app/place-order.ts', "import type { CustomerRepository, OrderRepository } from './ports';\n", "import type { Services } from '../infra/index';\nimport type { CustomerRepository, OrderRepository } from './ports';\n"),
    after('src/app/place-order.ts', '  await orders.save(placeOrder(order));\n}\n', '\nexport function placeOrderWith(services: Services, orderId: string): Promise<void> {\n  return placeOrderUseCase(services.orders, services.customers, orderId);\n}\n'),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/infra/http/routes.ts', "import { issueInvoiceUseCase, placeOrderUseCase } from '../../app';", "import { issueInvoiceUseCase, placeOrderUseCase, registerCustomerUseCase } from '../../app';"),
    r('src/infra/http/routes.ts', "    const match = /^\\/orders\\/([\\w-]+)\\/(place|invoice)$/.exec(req.url ?? '');\n", "    if (req.method === 'POST' && req.url === '/customers') {\n      const chunks: Buffer[] = [];\n      for await (const chunk of req) chunks.push(chunk as Buffer);\n      await registerCustomerUseCase(services.customers, JSON.parse(Buffer.concat(chunks).toString('utf8')));\n      res.writeHead(201).end();\n      return;\n    }\n    const match = /^\\/orders\\/([\\w-]+)\\/(place|invoice)$/.exec(req.url ?? '');\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/main.ts', 'const services = createServices(settings);\n', "if (process.argv.includes('--check-db')) {\n  const { createPool } = await import('./infra/db/pool');\n  await createPool(settings.databaseUrl).query('select 1');\n  process.exit(0);\n}\nconst services = createServices(settings);\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/infra/db/transaction.ts', "import type pg from 'pg';\n\nexport async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {\n  const client = await pool.connect();\n  try {\n    await client.query('begin');\n    const result = await work(client);\n    await client.query('commit');\n    return result;\n  } catch (error) {\n    await client.query('rollback');\n    throw error;\n  } finally {\n    client.release();\n  }\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    after('src/config/settings.ts', "    invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',\n  };\n}\n", "\nexport function isDebug(): boolean {\n  return process.env.LOG_LEVEL === 'debug';\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/app/invoice-number.ts', "import type { Settings } from '../config/settings';\n\nexport function invoiceNumber(settings: Pick<Settings, 'invoicePrefix'>, sequence: number): string {\n  return `${settings.invoicePrefix}-${String(sequence).padStart(6, '0')}`;\n}\n"),
    before('src/app/index.ts', "export { placeOrderUseCase } from './place-order';\n", "export { invoiceNumber } from './invoice-number';\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/infra/mail/mailer.ts', "import type { Customer, Invoice } from '../../domain';\n", "import type { Settings } from '../../config/settings';\nimport type { Customer, Invoice } from '../../domain';\n"),
    after('src/infra/mail/mailer.ts', '    });\n  }\n}\n', "\nexport function notifierFrom(settings: Pick<Settings, 'smtpHost' | 'smtpFrom'>): SmtpNotifier {\n  return new SmtpNotifier(settings.smtpHost, settings.smtpFrom);\n}\n"),
  ] },
  // test-only-change
  { family: 'test-only-change', nearMiss: true, edits: [
    after('test/order.test.ts', "test('placing an order changes its status', () => {\n  assert.equal(placeOrder(order).status, 'placed');\n});\n", "\ntest('an order without lines cannot be placed', () => {\n  assert.throws(() => placeOrder({ ...order, lines: [] }), /at least one line/);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/order-repository.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport type pg from 'pg';\nimport { PgOrderRepository } from '../src/infra/db/order-repository';\n\ntest('get returns undefined when no row matches', async () => {\n  const pool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;\n  assert.equal(await new PgOrderRepository(pool).get('missing'), undefined);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/settings.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { loadSettings } from '../src/config/settings';\n\ntest('settings fall back to defaults', () => {\n  process.env.DATABASE_URL = 'postgres://localhost/ledger';\n  process.env.SMTP_HOST = 'localhost';\n  process.env.STRIPE_SECRET_KEY = 'unused-in-tests';\n  assert.equal(loadSettings().port, 8080);\n  assert.equal(loadSettings().invoicePrefix, 'INV');\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/helpers/db.ts', "import { createPool } from '../../src/infra/db/pool';\n\nexport function testPool() {\n  return createPool(process.env.TEST_DATABASE_URL ?? 'postgres://localhost/ledger_test');\n}\n"),
  ] },
  // comment-or-doc-mention
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    before('src/domain/order.ts', 'export interface Order {', '/** Orders are stored by PgOrderRepository in src/infra/db/order-repository.ts. */\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/app/ports.ts', '  save(order: Order): Promise<void>;\n', '  save(order: Order): Promise<void>; // an upsert in the Postgres adapter (../infra/db/order-repository.ts)\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    file('docs/architecture.md', "# Architecture\n\n- `src/domain`: orders, customers, invoices and money. Plain functions and types.\n- `src/app`: use cases. They talk to storage and mail through the ports in `src/app/ports.ts`.\n- `src/infra`: Postgres (`pg`) repositories, the SMTP mailer and the HTTP routes. `src/infra/index.ts` wires them.\n- `src/config`: reads the environment once, in `loadSettings()`.\n\nA use case never builds a `PgOrderRepository` or calls `createPool` itself; `src/main.ts` does.\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/domain/money.ts', '  readonly cents: number;\n', "  readonly cents: number; // numeric columns from 'pg' are parsed to cents in the repositories\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/app/issue-invoice.ts', '  await deps.notifier.invoiceIssued(customer, invoice);\n', '  // Mail goes out through the Notifier port (SMTP lives in src/infra/mail/mailer.ts).\n  await deps.notifier.invoiceIssued(customer, invoice);\n'),
  ] },
];

export const ITEMS = [
  ...drift.map(it => ({ ...it, intent: 'drift', nearMiss: false })),
  ...clean.map(it => ({ ...it, intent: 'clean', nearMiss: Boolean(it.nearMiss), targets: [] })),
];

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic neutral ids: a seeded Fisher-Yates shuffle of the authored order. */
export function assignIds(items, seed = SEED) {
  const order = items.map((_, i) => i);
  const rand = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((itemIndex, k) => ({ id: 'c' + String(k + 1).padStart(3, '0'), item: items[itemIndex] }));
}

export function build() {
  const assigned = assignIds(ITEMS);
  const patches = {};
  const manifest = { schemaVersion: 1, note: 'Author intent only; NOT a gate input. Ground truth is labels.json.', seed: SEED, items: [] };
  const diffs = diffsFor(BASE, assigned.map(a => a.item.edits));
  for (const [k, { id, item }] of assigned.entries()) {
    patches[id] = diffs[k];
    manifest.items.push({ id, family: item.family, intent: item.intent, nearMiss: item.nearMiss, targets: item.targets });
  }
  return { patches, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { patches, manifest } = build();
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const [id, text] of Object.entries(patches)) {
      if (readFileSync(join(CORPUS, id + '.patch'), 'utf8') !== text) { console.error('differs: ' + id); bad++; }
    }
    if (readFileSync(MANIFEST, 'utf8') !== JSON.stringify(manifest, null, 2) + '\n') { console.error('differs: manifest.json'); bad++; }
    console.log(bad ? `${bad} file(s) differ` : `corpus reproduces: ${Object.keys(patches).length} patches`);
    process.exitCode = bad ? 1 : 0;
  } else {
    rmSync(CORPUS, { recursive: true, force: true });
    mkdirSync(CORPUS);
    for (const [id, text] of Object.entries(patches)) writeFileSync(join(CORPUS, id + '.patch'), text);
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote ${Object.keys(patches).length} patches and manifest.json`);
    console.log(readdirSync(CORPUS).length + ' files in corpus/');
  }
}
