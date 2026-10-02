// EXP 008-X, WO-03: author 140 NEW gate items against the EXP 005 base app, quota-matched to EXP 005, so EXP 008 runs
// on n = 200 (the 60 EXP 005 items + these 140).
//
// This file is the author's intent. It is NOT a gate input: gates see only rules.txt and the patch text. Each item names
// its family and, for drift, the rule it was written to break; labels-x.json (bce, via label-x.mjs) decides the truth.
// Items get neutral ids c061..c200 through a seeded shuffle (seed 8008, the same mulberry32 Fisher-Yates as EXP 005's
// assignIds), so the id order does not follow the family order below.
//
// The EXP 005 modules this file uses are asserted by sha256 BEFORE they are loaded (fail closed). The quotas are read
// from corpus-spec.json (invoked by sha, unmodified) and scaled 60 -> 140 by largest remainder, per intended split,
// ties in spec order; the resulting table is asserted. Families follow the spec descriptions as widened by the two
// 2026-09-26 amendments: GREEN items use rule keywords in allowed places, RED items break rules with few keywords.
//
//   node experiments/latent-handoff/corpus-x/author-x.mjs            write corpus/*.patch, manifest-x.json, corpus-x.json
//   node experiments/latent-handoff/corpus-x/author-x.mjs --check    regenerate in memory and compare byte for byte
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const JEV = resolve(HERE, '..', '..', 'jev-gate');
export const BASE = join(JEV, 'base');
export const RULES = join(JEV, 'rules.txt');
export const CORPUS = join(HERE, 'corpus');
export const MANIFEST = join(HERE, 'manifest-x.json');
export const INDEX = join(HERE, 'corpus-x.json');
export const SEED = 8008;
export const TOTAL = 140;
export const FIRST_ID = 61;
export const MAX_DIFF_BYTES = 2800;

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** The EXP 005 files this corpus depends on, pinned by sha256. */
export const PINNED = {
  'author-corpus.mjs': '25378b396bd8c68474aeece16338cd9fee72d8bd4b2553330eb91bbc784f7c9c',
  'corpus-spec.json': '64f7ebc2d5450b6393bfbdcb9dd80b55743302d8d413216bc6e8ee1d4d0bd7e0',
  'patchlib.mjs': '90caf6f690d94513fe151a67427112c68eaca7fc3fbff7a7a367c243d491f60e',
  'bce-contract.mjs': 'ca9ea8860b5fe5502c32b102c3db5fcc19e3474bdde9cc4104d3da89364f2004',
  'lint.mjs': 'df4485c7c7c7f515c5a484ec10df3400c59e2558c9cc67d1956aa6d40f9f38c9',
};

/** Fail closed: every pinned EXP 005 file must hash to its pin before anything of EXP 005 is loaded. */
export function assertPinned() {
  for (const [name, want] of Object.entries(PINNED)) {
    const got = sha256(readFileSync(join(JEV, name)));
    if (got !== want) throw new Error(`EXP 005 ${name} is ${got}, pinned ${want}: refusing to run`);
  }
}

/** Load the pinned EXP 005 modules, after the sha256 check. */
export async function loadExp005() {
  assertPinned();
  const [patchlib, lint, authorCorpus, bce] = await Promise.all([
    import(join(JEV, 'patchlib.mjs')), import(join(JEV, 'lint.mjs')), import(join(JEV, 'author-corpus.mjs')), import(join(JEV, 'bce-contract.mjs')),
  ]);
  return { patchlib, lint, authorCorpus, bce };
}

// ------------------------------------------------------------------------------------------------------------ quotas
/** Largest remainder of `weights` scaled to `total`; ties go to the earlier entry. */
function largestRemainder(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => (w * total) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) { if (left-- <= 0) break; out[i]++; }
  return out;
}

/** The EXP 005 quotas scaled to TOTAL: the intended split first, then each half by largest remainder in spec order. */
export function scaledQuotas() {
  assertPinned();
  const spec = JSON.parse(readFileSync(join(JEV, 'corpus-spec.json'), 'utf8'));
  const intents = Object.keys(spec.intendedSplit);
  const split = largestRemainder(intents.map(k => spec.intendedSplit[k]), TOTAL);
  const table = {};
  intents.forEach((intent, k) => {
    const fams = spec.families.filter(f => f.intent === intent);
    largestRemainder(fams.map(f => f.quota), split[k]).forEach((q, j) => { table[fams[j].family] = q; });
  });
  return table;
}

export const EXPECTED_QUOTAS = {
  'reverse-layer-import': 14, 'infra-leak': 12, 'forbidden-config-key': 21, 'reexport-from-governed-file': 12, 'dynamic-import': 11,
  'feature-add': 19, 'refactor-rename': 14, 'allowed-import-near-forbidden': 16, 'test-only-change': 9, 'comment-or-doc-mention': 12,
};

// ------------------------------------------------------------------------------------------------------------- edits
const r = (path, from, to) => ({ path, replace: [from, to] });
const after = (path, anchor, text) => r(path, anchor, anchor + text);
const before = (path, anchor, text) => r(path, anchor, text + anchor);
const file = (path, content) => ({ path, content });
const move = (path, renameTo) => ({ path, renameTo });

// base anchors
const ORDER_ERR = "import { DomainError } from './errors';\n";
const ORDER_IMPORTS = "import { add, money, multiply, type Money } from './money';\n";
const ORDER_END = "  return { ...order, status: 'placed' };\n}\n";
const ORDER_EMPTY = "  if (order.lines.length === 0) throw new DomainError('order.empty', 'an order needs at least one line');\n";
const CUSTOMER_IMPORTS = "import { DomainError } from './errors';\n";
const CUSTOMER_END = "  return { id, name: name.trim(), email: email.toLowerCase(), creditLimitCents: 50_000 };\n}\n";
const INVOICE_MONEY = "import type { Money } from './money';\n";
const INVOICE_ORDER = "import { orderTotal, type Order } from './order';\n";
const INVOICE_END = '  return { number, orderId: order.id, amount: orderTotal(order), dueDays };\n}\n';
const MONEY_START = 'export interface Money {';
const MONEY_END = '  return money(Math.round(a.cents * factor), a.currency);\n}\n';
const ERRORS_END = "    this.name = 'DomainError';\n  }\n}\n";
const PLACE_PORTS = "import type { CustomerRepository, OrderRepository } from './ports';\n";
const PLACE_END = '  await orders.save(placeOrder(order));\n}\n';
const ISSUE_DOMAIN = "import { DomainError, invoiceFor } from '../domain';\n";
const ISSUE_PORTS = "import type { CustomerRepository, InvoiceRepository, Notifier, OrderRepository } from './ports';\n";
const ISSUE_END = '  return invoice.number;\n}\n';
const REGISTER_DOMAIN = "import { createCustomer } from '../domain';\n";
const REGISTER_END = '  await customers.save(createCustomer(input.id, input.name, input.email));\n}\n';
const PORTS_DOMAIN = "import type { Customer, Invoice, Order } from '../domain';\n";
const PORTS_END = '  invoiceIssued(customer: Customer, invoice: Invoice): Promise<void>;\n}\n';
const APP_INDEX_PORTS = "export type { CustomerRepository, InvoiceRepository, Notifier, OrderRepository } from './ports';\n";
const APP_INDEX_REGISTER = "export { registerCustomerUseCase } from './register-customer';\n";
const SETTINGS_PREFIX = "    invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',\n";
const SETTINGS_IFACE_END = '  invoicePrefix: string;\n}\n';
const INFRA_POOL_IMPORT = "import { createPool } from './db/pool';\n";
const INFRA_END = "export { createHttpServer } from './http/routes';\n";
const ROUTES_MATCH = "    const match = /^\\/orders\\/([\\w-]+)\\/(place|invoice)$/.exec(req.url ?? '');\n";
const MAILER_END = '    });\n  }\n}\n';
const MAIN_SETTINGS = 'const settings = loadSettings();\n';
const MAIN_SERVICES = 'const services = createServices(settings);\n';
const TEST_END = "test('placing an order changes its status', () => {\n  assert.equal(placeOrder(order).status, 'placed');\n});\n";

// ------------------------------------------------------------------------------------------------------------- drift
const drift = [
  // ---------------------------------------------------------------- reverse-layer-import (14)
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    before('src/domain/invoice.ts', INVOICE_MONEY, "import type { InvoiceRepository } from '../app/ports';\n"),
    after('src/domain/invoice.ts', INVOICE_END, '\nexport async function draftInvoice(order: Order, numbers: InvoiceRepository): Promise<Invoice> {\n  return invoiceFor(order, await numbers.nextNumber());\n}\n'),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    after('src/domain/customer.ts', CUSTOMER_IMPORTS, "import type { CustomerRepository } from '../app/index';\n"),
    after('src/domain/customer.ts', CUSTOMER_END, '\nexport async function isKnownCustomer(customers: CustomerRepository, id: string): Promise<boolean> {\n  return (await customers.get(id)) !== undefined;\n}\n'),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    file('src/domain/pricing/lifetime.ts', "import type { OrderRepository } from '../../app/ports';\nimport { add, money, type Money } from '../money';\nimport { orderTotal } from '../order';\n\nexport async function lifetimeSpend(orders: OrderRepository, orderIds: readonly string[]): Promise<Money> {\n  let spent = money(0);\n  for (const orderId of orderIds) {\n    const found = await orders.get(orderId);\n    if (found?.status === 'placed') spent = add(spent, orderTotal(found));\n  }\n  return spent;\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    before('src/app/place-order.ts', 'export async function placeOrderUseCase(', 'export const MAX_ORDER_LINES = 50;\n\n'),
    before('src/domain/order.ts', ORDER_ERR, "import { MAX_ORDER_LINES } from '../app/place-order';\n"),
    after('src/domain/order.ts', ORDER_EMPTY, "  if (order.lines.length > MAX_ORDER_LINES) throw new DomainError('order.size', `at most ${MAX_ORDER_LINES} lines per order`);\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    file('src/domain/order-summary.ts', "import type { InvoiceRepository, OrderRepository } from '../app';\nimport { orderTotal, type Order } from './order';\n\nexport interface OrderSummary {\n  readonly orderId: string;\n  readonly lineCount: number;\n  readonly totalCents: number;\n}\n\nexport async function summarise(orders: OrderRepository, _invoices: InvoiceRepository, orderId: string): Promise<OrderSummary | undefined> {\n  const found: Order | undefined = await orders.get(orderId);\n  if (!found) return undefined;\n  return { orderId, lineCount: found.lines.length, totalCents: orderTotal(found).cents };\n}\n"),
    after('src/domain/index.ts', "export * from './order';\n", "export * from './order-summary';\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    file('src/domain/order.spec.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { placeOrderUseCase } from '../app';\nimport { DomainError } from './errors';\n\ntest('an unknown order cannot be placed', async () => {\n  const nothing = { get: async () => undefined, save: async () => undefined };\n  await assert.rejects(placeOrderUseCase(nothing, nothing, 'o-404'), DomainError);\n});\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-app'], edits: [
    before('src/domain/invoice.ts', INVOICE_MONEY, "import type {\n  CustomerRepository,\n  OrderRepository,\n} from '../app';\n"),
    after('src/domain/invoice.ts', INVOICE_END, "\nexport async function recipientOf(invoice: Invoice, orders: OrderRepository, customers: CustomerRepository): Promise<string | undefined> {\n  const placed = await orders.get(invoice.orderId);\n  return placed ? (await customers.get(placed.customerId))?.email : undefined;\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    before('src/domain/order.ts', ORDER_ERR, "import type { Settings as ServiceSettings } from '../config/settings';\n"),
    after('src/domain/order.ts', ORDER_END, "\nexport function orderReference(order: Order, settings: Pick<ServiceSettings, 'invoicePrefix'>): string {\n  return `${settings.invoicePrefix}/O/${order.id}`;\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    after('src/domain/customer.ts', CUSTOMER_IMPORTS, "import { loadSettings as currentSettings } from '../config/settings';\n"),
    after('src/domain/customer.ts', CUSTOMER_END, '\nexport function senderLine(customer: Customer): string {\n  return `${currentSettings().smtpFrom} on behalf of ${customer.name}`;\n}\n'),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    before('src/domain/invoice.ts', INVOICE_MONEY, "import * as config from '../config/settings';\n"),
    after('src/domain/invoice.ts', INVOICE_END, '\nexport function prefixedNumber(sequence: number): string {\n  return `${config.loadSettings().invoicePrefix}${sequence}`;\n}\n'),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    file('src/domain/reminders/schedule.ts', "import { loadSettings } from '../../config/settings';\nimport type { Invoice } from '../invoice';\n\nexport function reminderDays(invoice: Invoice): number[] {\n  const days = [invoice.dueDays - 7, invoice.dueDays, invoice.dueDays + 14].filter(day => day > 0);\n  return loadSettings().logLevel === 'debug' ? days.map(() => 0) : days;\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    file('src/domain/errors.ts', "import type { Settings as Config } from '../config/settings';\n\nexport class DomainError extends Error {\n  constructor(readonly code: string, message: string) {\n    super(message);\n    this.name = 'DomainError';\n  }\n}\n\nexport function missingSetting(key: keyof Config): DomainError {\n  return new DomainError('setting.missing', `no value for ${String(key)}`);\n}\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    after('src/domain/customer.ts', CUSTOMER_IMPORTS, "import type * as ConfigModule from '../config/settings';\n"),
    after('src/domain/customer.ts', CUSTOMER_END, "\nexport type CustomerDefaults = Pick<ReturnType<typeof ConfigModule.loadSettings>, 'smtpFrom'>;\n"),
  ] },
  { family: 'reverse-layer-import', targets: ['domain-no-config'], edits: [
    before('src/domain/money.ts', MONEY_START, "import { loadSettings, type Settings } from '../config/settings';\n\n"),
    after('src/domain/money.ts', MONEY_END, "\nexport function formatAmount(amount: Money, settings: Pick<Settings, 'logLevel'> = loadSettings()): string {\n  const text = (amount.cents / 100).toFixed(2);\n  return settings.logLevel === 'debug' ? `${text} ${amount.currency} (${amount.cents})` : `${text} ${amount.currency}`;\n}\n"),
  ] },

  // ---------------------------------------------------------------- infra-leak (12)
  { family: 'infra-leak', targets: ['domain-no-infra'], edits: [
    before('src/domain/order.ts', ORDER_ERR, "import type { Services } from '../infra';\n"),
    after('src/domain/order.ts', ORDER_END, "\nexport async function reopen(services: Pick<Services, 'orders'>, orderId: string): Promise<void> {\n  const current = await services.orders.get(orderId);\n  if (current && current.status === 'cancelled') await services.orders.save({ ...current, status: 'open' });\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['domain-no-infra'], edits: [
    file('src/domain/invoice-mail.ts', "import { SmtpNotifier } from '../infra/mail/mailer';\nimport type { Customer } from './customer';\nimport type { Invoice } from './invoice';\n\nexport function mailInvoice(customer: Customer, invoice: Invoice, relay: string): Promise<void> {\n  return new SmtpNotifier(relay, 'billing').invoiceIssued(customer, invoice);\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['domain-no-infra'], edits: [
    after('src/domain/customer.ts', CUSTOMER_IMPORTS, "import type { PgCustomerRepository } from '../infra/db/customer-repository';\n"),
    after('src/domain/customer.ts', CUSTOMER_END, "\nexport async function storeCustomer(store: PgCustomerRepository, customer: Customer): Promise<Customer> {\n  if (customer.creditLimitCents < 0) throw new DomainError('customer.credit', 'credit limit below zero');\n  await store.save(customer);\n  return customer;\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['domain-no-infra'], edits: [
    before('src/domain/invoice.ts', INVOICE_MONEY, "import { PgInvoiceRepository } from '../infra/db/invoice-repository';\n"),
    after('src/domain/invoice.ts', INVOICE_END, "\nexport const invoiceStore = (pool: ConstructorParameters<typeof PgInvoiceRepository>[0]) => new PgInvoiceRepository(pool, 'INV');\n"),
  ] },
  { family: 'infra-leak', targets: ['core-no-pg'], edits: [
    before('src/domain/money.ts', MONEY_START, 'import { types } from "pg";\n\n'),
    after('src/domain/money.ts', MONEY_END, '\nexport const NUMERIC_TYPE_ID = types.builtins.NUMERIC;\n'),
  ] },
  { family: 'infra-leak', targets: ['core-no-pg'], edits: [
    r('src/app/place-order.ts', PLACE_PORTS, 'import type { PoolClient } from "pg";\n' + PLACE_PORTS),
    after('src/app/place-order.ts', PLACE_END, "\nexport async function lockOrderRow(client: PoolClient, orderId: string): Promise<void> {\n  await client.query('select id from orders where id = $1 for update', [orderId]);\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['core-no-pg'], edits: [
    move('src/infra/db/pool.ts', 'src/app/pool.ts'),
    r('src/infra/index.ts', INFRA_POOL_IMPORT, "import { createPool } from '../app/pool';\n"),
  ] },
  { family: 'infra-leak', targets: ['core-no-pg'], edits: [
    after('src/app/register-customer.ts', REGISTER_DOMAIN, "import { prepareValue } from 'pg/lib/utils';\n"),
    after('src/app/register-customer.ts', REGISTER_END, '\nexport function customerRow(input: { id: string; name: string }): unknown[] {\n  return [input.id, prepareValue(input.name)];\n}\n'),
  ] },
  { family: 'infra-leak', targets: ['app-no-infra-internals'], edits: [
    r('src/app/issue-invoice.ts', ISSUE_PORTS, ISSUE_PORTS + "import type { SmtpNotifier } from '../infra/mail/mailer';\n"),
    after('src/app/issue-invoice.ts', ISSUE_END, "\nexport function mailerFor(deps: { notifier: Notifier }): SmtpNotifier | undefined {\n  return deps.notifier.constructor.name === 'SmtpNotifier' ? (deps.notifier as SmtpNotifier) : undefined;\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['app-no-infra-internals'], edits: [
    r('src/app/register-customer.ts', REGISTER_DOMAIN, REGISTER_DOMAIN + "import { PgCustomerRepository } from '../infra/db/customer-repository';\n"),
    after('src/app/register-customer.ts', REGISTER_END, '\nexport function registerInto(pool: ConstructorParameters<typeof PgCustomerRepository>[0], input: { id: string; name: string; email: string }): Promise<void> {\n  return registerCustomerUseCase(new PgCustomerRepository(pool), input);\n}\n'),
  ] },
  { family: 'infra-leak', targets: ['app-no-infra-internals'], edits: [
    file('src/app/reports/daily-count.ts', "import { createPool } from '../../infra/db/pool';\n\nexport async function ordersToday(databaseUrl: string): Promise<number> {\n  const handle = createPool(databaseUrl);\n  const rows = await handle.query(\"select count(*)::int as n from orders where body->>'status' = 'placed'\");\n  await handle.end();\n  return rows.rows[0].n;\n}\n"),
  ] },
  { family: 'infra-leak', targets: ['app-no-infra-internals'], edits: [
    r('src/app/place-order.ts', PLACE_PORTS, "import { PgOrderRepository as OrderStore } from '../infra/db/order-repository';\n" + PLACE_PORTS),
    after('src/app/place-order.ts', PLACE_END, '\nexport const ordersFrom = (pool: ConstructorParameters<typeof OrderStore>[0]): OrderRepository => new OrderStore(pool);\n'),
  ] },

  // ---------------------------------------------------------------- forbidden-config-key (21)
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    move('src/config/settings.ts', 'src/domain/settings.ts'),
    r('src/main.ts', "import { loadSettings } from './config/settings';\n", "import { loadSettings } from './domain/settings';\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    before('src/domain/order.ts', 'export function placeOrder(order: Order): Order {', '/**\n * Places an open order. The line cap that used to come from process.env.ORDER_LINE_CAP is gone;\n * an order is limited only by the customer credit check in the use case.\n */\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    before('src/domain/money.ts', MONEY_START, "const DEFAULT_CURRENCY = process.env.CURRENCY ?? 'EUR';\n\n"),
    r('src/domain/money.ts', "export function money(cents: number, currency = 'EUR'): Money {", 'export function money(cents: number, currency = DEFAULT_CURRENCY): Money {'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    r('src/domain/customer.ts', "  if (!email.includes('@')) throw new DomainError('customer.email', 'email is not valid');\n", "  if (!email.includes('@')) throw new DomainError('customer.email', 'email is not valid');\n  if (name.trim() === '') throw new DomainError('customer.name', 'a name is required (it is never filled from process.env)');\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-domain'], edits: [
    before('src/domain/errors.ts', 'export class DomainError extends Error {', '// Error codes are stable strings such as order.empty. Never derive them from process.env at runtime.\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    r('src/app/register-customer.ts', REGISTER_DOMAIN, "import { createCustomer, DomainError } from '../domain';\n"),
    r('src/app/register-customer.ts', REGISTER_END, "  if (process.env.REGISTRATION_CLOSED === 'true') throw new DomainError('customer.closed', 'registration is closed');\n" + REGISTER_END),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    before('src/app/ports.ts', 'export interface OrderRepository {', '/** Adapters get their connection string from process.env.DATABASE_URL by way of loadSettings(). */\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    r('src/app/place-order.ts', "  if (orderTotal(order).cents > customer.creditLimitCents) {\n    throw new DomainError('order.credit', 'order exceeds the credit limit');\n", "  const graceCents = Number(process.env['CREDIT_GRACE_CENTS'] ?? 0);\n  if (orderTotal(order).cents > customer.creditLimitCents + graceCents) {\n    throw new DomainError('order.credit', 'order exceeds the credit limit plus grace');\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    before('src/app/index.ts', "export { issueInvoiceUseCase } from './issue-invoice';\n", '// Wiring happens in src/main.ts; nothing in this folder reads process.env.\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-app'], edits: [
    file('src/app/clock.ts', 'export function now(): Date {\n  const pinned = process.env.FIXED_NOW;\n  return pinned ? new Date(pinned) : new Date();\n}\n'),
    after('src/app/index.ts', APP_INDEX_REGISTER, "export { now } from './clock';\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    r('src/infra/mail/mailer.ts', '    this.transport = nodemailer.createTransport({ host, port: 587 });\n', '    this.transport = nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT ?? 587) });\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    after('src/infra/http/routes.ts', '  return createServer(async (req, res) => {\n', '    // CORS stays off for now; the origin list would come from process.env.CORS_ORIGINS.\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    r('src/infra/index.ts', '  const pool = createPool(settings.databaseUrl);\n', '  const pool = createPool(process.env.DATABASE_URL ?? settings.databaseUrl);\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    before('src/infra/db/invoice-repository.ts', '  async nextNumber(): Promise<string> {', '  /* The sequence name may later be set with process.env.INVOICE_SEQUENCE; it is fixed for now. */\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['env-not-in-infra'], edits: [
    r('src/infra/db/customer-repository.ts', '  async save(customer: Customer): Promise<void> {\n', "  async save(customer: Customer): Promise<void> {\n    if (process.env.READ_ONLY === '1') throw new Error('customers are read-only on this instance');\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    r('src/config/settings.ts', '  port: number;\n', '  port: number;\n  adminPort: number;\n'),
    r('src/config/settings.ts', "    port: Number(process.env.PORT ?? '8080'),\n", "    port: Number(process.env.PORT ?? '8080'),\n    adminPort: Number(process.env.PORT_ADMIN ?? '9090'),\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    r('src/config/settings.ts', "    logLevel: (process.env.LOG_LEVEL ?? 'info') as Settings['logLevel'],\n", "    logLevel: (process.env['LOG_LEVEL'] ?? 'info') as Settings['logLevel'],\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    file('src/config/replica.ts', "export function replicaUrl(): string | undefined {\n  return process.env.DATABASE_URL_REPLICA ?? process.env.DATABASE_URL;\n}\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    before('src/config/settings.ts', 'export function loadSettings(): Settings {', '// SMTP credentials stay out of Settings: the relay reads process.env.SMTP_PASSWORD itself.\n'),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    file('src/config/env.ts', "export type KnownName = 'PORT' | 'LOG_LEVEL' | 'INVOICE_PREFIX';\n\nexport function readKnown(name: KnownName): string | undefined {\n  return process.env[name];\n}\n"),
  ] },
  { family: 'forbidden-config-key', targets: ['config-env-allowlist'], edits: [
    r('src/config/settings.ts', SETTINGS_IFACE_END, '  invoicePrefix: string;\n  timeZone: string;\n}\n'),
    after('src/config/settings.ts', SETTINGS_PREFIX, "    timeZone: process.env.TZ ?? 'UTC',\n"),
  ] },

  // ---------------------------------------------------------------- reexport-from-governed-file (12)
  { family: 'reexport-from-governed-file', targets: ['domain-no-app'], edits: [
    after('src/domain/index.ts', "export * from './money';\n", "export type { Notifier } from '../app/ports';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-app'], edits: [
    after('src/domain/order.ts', ORDER_END, "\nexport { placeOrderUseCase as submitOrder } from '../app/place-order';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-infra'], edits: [
    after('src/domain/index.ts', "export * from './invoice';\n", "export * from '../infra/mail/mailer';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-infra'], edits: [
    after('src/domain/customer.ts', CUSTOMER_END, "\nexport type { Services as CustomerServices } from '../infra';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-config'], edits: [
    after('src/domain/index.ts', "export * from './customer';\n", "export { loadSettings } from '../config/settings';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-config'], edits: [
    after('src/domain/invoice.ts', INVOICE_ORDER, "\nexport type { Settings as InvoiceSettings } from '../config/settings';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['domain-no-config'], edits: [
    file('src/domain/config.ts', "export * as settings from '../config/settings';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['core-no-pg'], edits: [
    after('src/app/index.ts', APP_INDEX_PORTS, 'export type { QueryResult } from "pg";\n'),
  ] },
  { family: 'reexport-from-governed-file', targets: ['core-no-pg'], edits: [
    after('src/domain/index.ts', "export * from './errors';\n", "export { types as columnTypes } from 'pg';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['app-no-infra-internals'], edits: [
    after('src/app/index.ts', APP_INDEX_PORTS, "export { SmtpNotifier } from '../infra/mail/mailer';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['app-no-infra-internals'], edits: [
    after('src/app/ports.ts', PORTS_DOMAIN, "export type { PgInvoiceRepository } from '../infra/db/invoice-repository';\n"),
  ] },
  { family: 'reexport-from-governed-file', targets: ['app-no-infra-internals'], edits: [
    file('src/app/http.ts', "// The HTTP entry point, next to the use cases it serves.\nexport * from '../infra/http/routes';\n"),
  ] },

  // ---------------------------------------------------------------- dynamic-import (11)
  { family: 'dynamic-import', targets: ['domain-no-infra'], edits: [
    after('src/domain/order.ts', ORDER_END, "\nexport async function persistPlaced(order: Order, connectionString: string): Promise<Order> {\n  const [{ createPool }, { PgOrderRepository }] = await Promise.all([import('../infra/db/pool'), import('../infra/db/order-repository')]);\n  const next = placeOrder(order);\n  await new PgOrderRepository(createPool(connectionString)).save(next);\n  return next;\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-app'], edits: [
    after('src/domain/customer.ts', CUSTOMER_END, "\nexport async function signUp(store: { get(id: string): Promise<Customer | undefined>; save(c: Customer): Promise<void> }, id: string, name: string, email: string): Promise<void> {\n  const { registerCustomerUseCase } = await import('../app');\n  await registerCustomerUseCase(store, { id, name, email });\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-config'], edits: [
    after('src/domain/order.ts', ORDER_END, "\nexport async function debugTotals(order: Order): Promise<string | undefined> {\n  const settingsModule = await import('../config/settings');\n  if (settingsModule.loadSettings().logLevel !== 'debug') return undefined;\n  return order.lines.map(line => `${line.sku} x${line.quantity}`).join(', ');\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['core-no-pg'], edits: [
    after('src/domain/money.ts', MONEY_END, '\nexport async function parseNumericColumn(raw: string): Promise<Money> {\n  const { types } = await import("pg");\n  const parse = types.getTypeParser(types.builtins.NUMERIC);\n  return money(Math.round(Number(parse(raw)) * 100));\n}\n'),
  ] },
  { family: 'dynamic-import', targets: ['core-no-pg'], edits: [
    after('src/app/register-customer.ts', REGISTER_END, "\nexport async function emailInUse(connectionString: string, email: string): Promise<boolean> {\n  const driver = await import('pg');\n  const db = new driver.default.Client({ connectionString });\n  await db.connect();\n  const found = await db.query(\"select id from customers where lower(body->>'email') = lower($1)\", [email]);\n  await db.end();\n  return (found.rowCount ?? 0) > 0;\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['app-no-infra-internals'], edits: [
    r('src/app/issue-invoice.ts', '  await deps.notifier.invoiceIssued(customer, invoice);\n', "  await deps.notifier.invoiceIssued(customer, invoice).catch(async () => {\n    const mailer = await import('../infra/mail/mailer');\n    await new mailer.SmtpNotifier('localhost', 'billing').invoiceIssued(customer, invoice);\n  });\n"),
  ] },
  { family: 'dynamic-import', targets: ['app-no-infra-internals'], edits: [
    file('src/app/admin/reset-sequence.ts', "export async function resetInvoiceSequence(connectionString: string): Promise<void> {\n  const { createPool } = await import('../../infra/db/pool');\n  const db = createPool(connectionString);\n  await db.query('alter sequence invoice_seq restart with 1');\n  await db.end();\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-infra'], edits: [
    after('src/domain/invoice.ts', INVOICE_END, "\nexport async function deliveryAdapter(channel: 'mail' | 'http'): Promise<unknown> {\n  const parts = ['..', 'infra', channel === 'mail' ? 'mail/mailer' : 'http/routes'];\n  return import(parts.join('/'));\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['app-no-infra-internals'], edits: [
    after('src/app/place-order.ts', PLACE_END, "\nexport async function repositoryModule(table: 'order' | 'customer' | 'invoice'): Promise<Record<string, unknown>> {\n  return import(`../infra/db/${table}-repository`);\n}\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-config'], edits: [
    after('src/domain/order.ts', "  readonly status: 'open' | 'placed' | 'cancelled';\n}\n", "\nexport type TraceLevel = import('../config/settings').Settings['logLevel'];\n"),
  ] },
  { family: 'dynamic-import', targets: ['domain-no-app'], edits: [
    after('src/domain/invoice.ts', INVOICE_END, "\nexport const useCases = () => import('../app');\n"),
  ] },
];

// ------------------------------------------------------------------------------------------------------------- clean
const clean = [
  // ---------------------------------------------------------------- feature-add (19)
  { family: 'feature-add', edits: [
    file('src/jobs/overdue-invoices.ts', "import { loadSettings as readSettings } from '../config/settings';\nimport { createPool as openPool } from '../infra/db/pool';\n\nexport async function overdueInvoiceNumbers(today: Date): Promise<string[]> {\n  const db = openPool(readSettings().databaseUrl);\n  const rows = await db.query(\"select number from invoices where (body->>'dueAt')::date < $1\", [today.toISOString().slice(0, 10)]);\n  await db.end();\n  return rows.rows.map(row => String(row.number));\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/config/logging.ts', "export const verbose = (): boolean => process.env.LOG_LEVEL === 'debug';\n"),
  ] },
  { family: 'feature-add', edits: [
    after('src/domain/order.ts', ORDER_END, "\nexport function addLine(order: Order, line: OrderLine): Order {\n  if (order.status !== 'open') throw new DomainError('order.status', 'lines can only be added to an open order');\n  if (line.quantity <= 0) throw new DomainError('order.quantity', 'quantity must be positive');\n  return { ...order, lines: [...order.lines, line] };\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    after('src/domain/money.ts', MONEY_END, '\nexport function subtract(a: Money, b: Money): Money {\n  if (a.currency !== b.currency) throw new RangeError(\'currencies differ\');\n  return money(a.cents - b.cents, a.currency);\n}\n'),
  ] },
  { family: 'feature-add', edits: [
    after('src/domain/invoice.ts', INVOICE_END, '\nexport function isOverdue(invoice: Invoice, issuedOn: Date, today: Date): boolean {\n  const due = new Date(issuedOn.getTime() + invoice.dueDays * 86_400_000);\n  return today.getTime() > due.getTime();\n}\n'),
  ] },
  { family: 'feature-add', edits: [
    after('src/domain/customer.ts', CUSTOMER_END, "\nexport function renameCustomer(customer: Customer, name: string): Customer {\n  if (name.trim() === '') throw new DomainError('customer.name', 'name must not be blank');\n  return { ...customer, name: name.trim() };\n}\n"),
    file('src/app/rename-customer.ts', "import { DomainError, renameCustomer } from '../domain';\nimport type { CustomerRepository } from './ports';\n\nexport async function renameCustomerUseCase(customers: CustomerRepository, id: string, name: string): Promise<void> {\n  const existing = await customers.get(id);\n  if (!existing) throw new DomainError('customer.missing', `no customer ${id}`);\n  await customers.save(renameCustomer(existing, name));\n}\n"),
    after('src/app/index.ts', APP_INDEX_REGISTER, "export { renameCustomerUseCase } from './rename-customer';\n"),
  ] },
  { family: 'feature-add', edits: [
    before('src/infra/db/invoice-repository.ts', '  async save(invoice: Invoice): Promise<void> {', "  async findByOrder(orderId: string): Promise<Invoice | undefined> {\n    const found = await this.pool.query(\"select body from invoices where body->>'orderId' = $1 limit 1\", [orderId]);\n    return found.rows[0]?.body as Invoice | undefined;\n  }\n\n"),
  ] },
  { family: 'feature-add', edits: [
    before('src/infra/http/routes.ts', ROUTES_MATCH, "    const lookup = /^\\/orders\\/([\\w-]+)$/.exec(req.url ?? '');\n    if (req.method === 'GET' && lookup) {\n      const found = await services.orders.get(lookup[1]);\n      res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(found ?? null));\n      return;\n    }\n"),
  ] },
  { family: 'feature-add', edits: [
    r('src/infra/mail/mailer.ts', MAILER_END, "    });\n  }\n\n  async customerWelcomed(customer: Customer): Promise<void> {\n    await this.transport.sendMail({ from: this.from, to: customer.email, subject: 'Welcome', text: `Hello ${customer.name}` });\n  }\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    after('src/app/ports.ts', '  save(order: Order): Promise<void>;\n', '  remove(id: string): Promise<void>;\n'),
    before('src/infra/db/order-repository.ts', '  async save(order: Order): Promise<void> {', "  async remove(id: string): Promise<void> {\n    await this.pool.query('delete from orders where id = $1', [id]);\n  }\n\n"),
  ] },
  { family: 'feature-add', edits: [
    r('src/main.ts', "createHttpServer(services).listen(settings.port, () => {\n  console.log(`ledger-service listening on ${settings.port}`);\n});\n", "const server = createHttpServer(services).listen(settings.port, () => {\n  if (process.env.NODE_ENV !== 'production') console.log(`ledger-service listening on ${settings.port}`);\n});\nprocess.once('SIGTERM', () => server.close());\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/jobs/send-reminders.ts', "import * as settingsModule from '../config/settings';\nimport type { Customer, Invoice } from '../domain';\nimport { SmtpNotifier } from '../infra/mail/mailer';\n\nexport async function remind(pairs: ReadonlyArray<[Customer, Invoice]>): Promise<number> {\n  const settings = settingsModule.loadSettings();\n  const mail = new SmtpNotifier(settings.smtpHost, settings.smtpFrom);\n  for (const [customer, invoice] of pairs) await mail.invoiceIssued(customer, invoice);\n  return pairs.length;\n}\n"),
  ] },
  { family: 'feature-add', edits: [
    after('src/infra/db/pool.ts', '  return new pg.Pool({ connectionString, max: 10 });\n}\n', '\nexport function createReportingPool(connectionString: string): pg.Pool {\n  return new pg.Pool({ connectionString, max: 2, statement_timeout: 30_000 });\n}\n'),
  ] },
  { family: 'feature-add', edits: [
    r('src/config/settings.ts', SETTINGS_IFACE_END, '  invoicePrefix: string;\n  behindTls: boolean;\n}\n'),
    after('src/config/settings.ts', SETTINGS_PREFIX, "    behindTls: process.env.PORT === '443',\n"),
  ] },
  { family: 'feature-add', edits: [
    r('src/app/register-customer.ts', REGISTER_DOMAIN, "import { createCustomer, DomainError } from '../domain';\n"),
    r('src/app/register-customer.ts', REGISTER_END, "  if (await customers.get(input.id)) throw new DomainError('customer.exists', `customer ${input.id} already exists`);\n" + REGISTER_END),
  ] },
  { family: 'feature-add', edits: [
    r('src/infra/index.ts', '  notifier: Notifier;\n}\n', '  notifier: Notifier;\n  close(): Promise<void>;\n}\n'),
    r('src/infra/index.ts', '    notifier: new SmtpNotifier(settings.smtpHost, settings.smtpFrom),\n', '    notifier: new SmtpNotifier(settings.smtpHost, settings.smtpFrom),\n    close: () => pool.end(),\n'),
  ] },
  { family: 'feature-add', edits: [
    file('src/cli/issue.ts', "import { issueInvoiceUseCase } from '../app';\nimport { type Settings, loadSettings } from '../config/settings';\nimport { createServices } from '../infra';\n\nconst [orderId] = process.argv.slice(2);\nif (!orderId) {\n  console.error('usage: issue <order-id>');\n  process.exit(2);\n}\nconst settings: Settings = loadSettings();\nconsole.log(await issueInvoiceUseCase(createServices(settings), orderId));\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/domain/tax.ts', "import { type Money, money } from './money';\n\nexport function vatOn(amount: Money, ratePercent: number): Money {\n  if (ratePercent < 0) throw new RangeError('a tax rate cannot be negative');\n  return money(Math.round((amount.cents * ratePercent) / 100), amount.currency);\n}\n"),
    after('src/domain/index.ts', "export * from './order';\n", "export * from './tax';\n"),
  ] },
  { family: 'feature-add', edits: [
    file('src/infra/db/schema.ts', "import type pg from 'pg';\n\nexport async function ensureSchema(pool: pg.Pool): Promise<void> {\n  await pool.query('create table if not exists orders (id text primary key, body jsonb not null)');\n  await pool.query('create table if not exists customers (id text primary key, body jsonb not null)');\n  await pool.query('create table if not exists invoices (number text primary key, body jsonb not null)');\n  await pool.query('create sequence if not exists invoice_seq');\n}\n"),
  ] },

  // ---------------------------------------------------------------- refactor-rename (14)
  { family: 'refactor-rename', edits: [
    move('src/domain/money.ts', 'src/domain/amount.ts'),
    r('src/domain/order.ts', "from './money';", "from './amount';"),
    r('src/domain/invoice.ts', "import type { Money } from './money';", "import type { Money } from './amount';"),
    r('src/domain/index.ts', "export * from './money';\n", "export * from './amount';\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/domain/order.ts', 'export function placeOrder(order: Order): Order {', 'export function markPlaced(order: Order): Order {'),
    r('src/app/place-order.ts', "import { DomainError, orderTotal, placeOrder } from '../domain';", "import { DomainError, markPlaced, orderTotal } from '../domain';"),
    r('src/app/place-order.ts', PLACE_END, '  await orders.save(markPlaced(order));\n}\n'),
    r('test/order.test.ts', "import { money, orderTotal, placeOrder, type Order } from '../src/domain';", "import { markPlaced, money, orderTotal, type Order } from '../src/domain';"),
    r('test/order.test.ts', "  assert.equal(placeOrder(order).status, 'placed');", "  assert.equal(markPlaced(order).status, 'placed');"),
  ] },
  { family: 'refactor-rename', edits: [
    file('src/infra/db/pool.ts', "import { Pool } from 'pg';\n\nexport function createPool(connectionString: string): Pool {\n  return new Pool({ connectionString, max: 10 });\n}\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/db/customer-repository.ts', "import type pg from 'pg';\n", "import type { Pool as PgPool } from 'pg';\n"),
    r('src/infra/db/customer-repository.ts', 'private readonly pool: pg.Pool', 'private readonly pool: PgPool'),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/mail/mailer.ts', 'export class SmtpNotifier implements Notifier {', 'export class MailNotifier implements Notifier {'),
    r('src/infra/index.ts', "import { SmtpNotifier } from './mail/mailer';\n", "import { MailNotifier } from './mail/mailer';\n"),
    r('src/infra/index.ts', '    notifier: new SmtpNotifier(settings.smtpHost, settings.smtpFrom),\n', '    notifier: new MailNotifier(settings.smtpHost, settings.smtpFrom),\n'),
  ] },
  { family: 'refactor-rename', edits: [
    move('src/app/register-customer.ts', 'src/app/register.ts'),
    r('src/app/index.ts', APP_INDEX_REGISTER, "export { registerCustomerUseCase } from './register';\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/http/routes.ts', '    const [, orderId, action] = match;\n    if (action === \'place\') {\n', '    const [, orderId, verb] = match;\n    if (verb === \'place\') {\n'),
  ] },
  { family: 'refactor-rename', edits: [
    before('src/config/settings.ts', 'export function loadSettings(): Settings {', "function withDefault(value: string | undefined, fallback: string): string {\n  return value === undefined || value === '' ? fallback : value;\n}\n\n"),
    r('src/config/settings.ts', "    smtpFrom: process.env.SMTP_FROM ?? 'no-reply',\n    invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',\n", "    smtpFrom: withDefault(process.env.SMTP_FROM, 'no-reply'),\n    invoicePrefix: withDefault(process.env.INVOICE_PREFIX, 'INV'),\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/domain/index.ts', "export * from './customer';\nexport * from './errors';\n", "export { createCustomer, type Customer } from './customer';\nexport { DomainError } from './errors';\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/app/issue-invoice.ts', "  const order = await deps.orders.get(orderId);\n  if (!order || order.status !== 'placed') throw new DomainError('invoice.order', 'order is not placed');\n", '  const order = await placedOrder(deps.orders, orderId);\n'),
    after('src/app/issue-invoice.ts', ISSUE_END, "\nasync function placedOrder(orders: OrderRepository, orderId: string) {\n  const found = await orders.get(orderId);\n  if (!found || found.status !== 'placed') throw new DomainError('invoice.order', 'order is not placed');\n  return found;\n}\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/domain/order.ts', 'export interface OrderLine {', 'export interface LineItem {'),
    r('src/domain/order.ts', '  readonly lines: readonly OrderLine[];', '  readonly lines: readonly LineItem[];'),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/index.ts', 'export function createServices(settings: {', 'export function buildServices(settings: {'),
    r('src/main.ts', "import { createHttpServer, createServices } from './infra';\n", "import { buildServices, createHttpServer } from './infra';\n"),
    r('src/main.ts', MAIN_SERVICES, 'const services = buildServices(settings);\n'),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/app/place-order.ts', "  if (orderTotal(order).cents > customer.creditLimitCents) {\n    throw new DomainError('order.credit', 'order exceeds the credit limit');\n  }\n", "  const overLimit = orderTotal(order).cents > customer.creditLimitCents;\n  if (overLimit) throw new DomainError('order.credit', 'order exceeds the credit limit');\n"),
  ] },
  { family: 'refactor-rename', edits: [
    r('src/infra/mail/mailer.ts', "import nodemailer from 'nodemailer';\n", "import { createTransport } from 'nodemailer';\n"),
    r('src/infra/mail/mailer.ts', '    this.transport = nodemailer.createTransport({ host, port: 587 });\n', '    this.transport = createTransport({ host, port: 587 });\n'),
  ] },

  // ---------------------------------------------------------------- allowed-import-near-forbidden (16)
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/app/issue-invoice.ts', ISSUE_PORTS, "import type { Services } from '../infra';\n" + ISSUE_PORTS),
    after('src/app/issue-invoice.ts', ISSUE_END, '\nexport const issueWith = (services: Services, orderId: string): Promise<string> => issueInvoiceUseCase(services, orderId);\n'),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/app/register-customer.ts', REGISTER_DOMAIN, REGISTER_DOMAIN + "import { loadSettings as settingsNow } from '../config/settings';\n"),
    after('src/app/register-customer.ts', REGISTER_END, "\nexport function welcomeFrom(): string {\n  return settingsNow().smtpFrom;\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/infra/db/locks.ts', "import type { PoolClient } from 'pg';\n\nexport async function withAdvisoryLock<T>(client: PoolClient, key: number, work: () => Promise<T>): Promise<T> {\n  await client.query('select pg_advisory_lock($1)', [key]);\n  return work().finally(() => client.query('select pg_advisory_unlock($1)', [key]));\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    before('src/main.ts', MAIN_SERVICES, "if (process.argv.includes('--mail-check')) {\n  const mailer = await import('./infra/mail/mailer');\n  new mailer.SmtpNotifier(settings.smtpHost, settings.smtpFrom);\n  console.log('mail settings accepted');\n  process.exit(Number(!settings.smtpHost));\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/infra/queue/consumer.ts', "import { placeOrderUseCase } from '../../app/place-order';\nimport type { Services } from '../index';\n\nexport async function handlePlaceMessage(services: Services, body: string): Promise<void> {\n  const { orderId } = JSON.parse(body) as { orderId: string };\n  await placeOrderUseCase(services.orders, services.customers, orderId);\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/config/smtp.ts', "export interface SmtpSettings {\n  host: string;\n  from: string;\n}\n\nexport function smtpSettings(): SmtpSettings {\n  return { host: process.env.SMTP_HOST ?? 'localhost', from: process.env.SMTP_FROM ?? 'billing' };\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/app/invoice-terms.ts', "import type { Settings as ServiceConfig } from '../config/settings';\n\nexport function termsLine(config: Pick<ServiceConfig, 'invoicePrefix'>, dueDays: number): string {\n  return `${config.invoicePrefix} invoices are due in ${dueDays} days`;\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/app/bootstrap.ts', "import { createServices, type Services } from '../infra/index';\n\nexport function servicesFor(settings: Parameters<typeof createServices>[0]): Services {\n  return createServices(settings);\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/infra/db/listen.ts', "import pg from 'pg';\n\nexport async function onInvoiceIssued(connectionString: string, handler: (payload: string) => void): Promise<pg.Client> {\n  const listener = new pg.Client({ connectionString });\n  await listener.connect();\n  listener.on('notification', message => handler(message.payload ?? ''));\n  await listener.query('listen invoice_issued');\n  return listener;\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    after('src/domain/invoice.ts', INVOICE_END, "\nexport async function invoiceForLater(order: Order, number: string): Promise<Invoice> {\n  const { orderTotal: totalOf } = await import('./order');\n  return { number, orderId: order.id, amount: totalOf(order), dueDays: 60 };\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/infra/http/plugins.ts', "export async function loadPlugin(name: string): Promise<unknown> {\n  if (!/^[a-z-]+$/.test(name)) throw new Error(`bad plugin name ${name}`);\n  return import(`./plugins/${name}`);\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/jobs/run-job.ts', "import { loadSettings as jobSettings } from '../config/settings';\n\nexport async function runJob(name: 'overdue' | 'reminders'): Promise<void> {\n  const job = await import(`../infra/jobs/${name}`);\n  await job.run(jobSettings());\n}\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/config/settings.ts', "    logLevel: (process.env.LOG_LEVEL ?? 'info') as Settings['logLevel'],\n", "    // LOG_LEVEL is read once, as process.env.LOG_LEVEL; an unknown value is passed through unchanged.\n    logLevel: (process.env.LOG_LEVEL ?? 'info') as Settings['logLevel'],\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    after('src/app/index.ts', APP_INDEX_PORTS, "export type { Services } from '../infra';\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    r('src/infra/index.ts', "import { SmtpNotifier } from './mail/mailer';\n", "import { SmtpNotifier } from './mail/mailer';\nimport type { Settings as RuntimeSettings } from '../config/settings';\n"),
    r('src/infra/index.ts', "export function createServices(settings: {\n  databaseUrl: string;\n  smtpHost: string;\n  smtpFrom: string;\n  invoicePrefix: string;\n}): Services {\n", "export function createServices(settings: Pick<RuntimeSettings, 'databaseUrl' | 'smtpHost' | 'smtpFrom' | 'invoicePrefix'>): Services {\n"),
  ] },
  { family: 'allowed-import-near-forbidden', nearMiss: true, edits: [
    file('src/domain/rates.js', "// Plain JavaScript seed data for local runs.\nimport { createPool as poolFor } from '../infra/db/pool';\n\nexport async function seedRates(url) {\n  const db = poolFor(url);\n  await db.query(\"insert into rates (code, percent) values ('std', 21) on conflict do nothing\");\n  await db.end();\n}\n"),
  ] },

  // ---------------------------------------------------------------- test-only-change (9)
  { family: 'test-only-change', nearMiss: true, edits: [
    after('test/order.test.ts', TEST_END, "\ntest('a cancelled order stays unplaced', () => {\n  assert.throws(() => placeOrder({ ...order, status: 'cancelled' }), /only open orders/);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/money.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add, money } from '../src/domain';\n\ntest('adding two amounts keeps the currency', () => {\n  assert.deepEqual(add(money(150), money(250)), { cents: 400, currency: 'EUR' });\n});\n\ntest('mixed currencies are refused', () => {\n  assert.throws(() => add(money(1, 'EUR'), money(1, 'USD')), RangeError);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/config.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport * as config from '../src/config/settings';\n\ntest('a missing database url is reported', () => {\n  delete process.env.DATABASE_URL;\n  process.env.SMTP_HOST = 'mail.local';\n  process.env.REDIS_URL = 'redis://cache.local:6379';\n  assert.throws(() => config.loadSettings(), /DATABASE_URL/);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/routes.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { createHttpServer } from '../src/infra/http/routes';\nimport type { Services } from '../src/infra';\n\ntest('an unknown path answers 404', async () => {\n  const server = createHttpServer({} as Services).listen(0);\n  const { port } = server.address() as { port: number };\n  const res = await fetch(`http://127.0.0.1:${port}/nowhere`, { method: 'POST' });\n  server.close();\n  assert.equal(res.status, 404);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/place-order.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { placeOrderUseCase } from '../src/app';\nimport { money, type Customer, type Order } from '../src/domain';\n\ntest('an order over the credit limit is refused', async () => {\n  const big: Order = { id: 'o-7', customerId: 'c-7', status: 'open', lines: [{ sku: 'sofa', quantity: 1, unitPrice: money(90_000) }] };\n  const buyer: Customer = { id: 'c-7', name: 'Buyer', email: 'buyer', creditLimitCents: 50_000 };\n  const orders = { get: async () => big, save: async () => undefined };\n  const customers = { get: async () => buyer, save: async () => undefined };\n  await assert.rejects(placeOrderUseCase(orders, customers, 'o-7'), /credit limit/);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/helpers/env.ts', "export function withEnv<T>(vars: Record<string, string>, run: () => T): T {\n  const saved = { ...process.env };\n  Object.assign(process.env, vars);\n  try { return run(); } finally { process.env = saved; }\n}\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/mailer.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { SmtpNotifier } from '../src/infra/mail/mailer';\n\ntest('the notifier exposes invoiceIssued', () => {\n  const notifier = new SmtpNotifier('localhost', 'billing');\n  assert.equal(typeof notifier.invoiceIssued, 'function');\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/invoice.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { invoiceFor, money, type Order } from '../src/domain';\n\nconst placed: Order = { id: 'o-2', customerId: 'c-2', status: 'placed', lines: [{ sku: 'lamp', quantity: 3, unitPrice: money(2_000) }] };\n\ntest('an invoice defaults to thirty days', () => {\n  const invoice = invoiceFor(placed, 'INV-000001');\n  assert.equal(invoice.dueDays, 30);\n  assert.equal(invoice.amount.cents, 6_000);\n});\n"),
  ] },
  { family: 'test-only-change', nearMiss: true, edits: [
    file('test/pool.test.ts', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport pg from 'pg';\nimport { createPool } from '../src/infra/db/pool';\n\ntest('createPool returns a pg pool', async () => {\n  const made = createPool('postgres://localhost:5432/ledger_test');\n  assert.ok(made instanceof pg.Pool);\n  await made.end();\n});\n"),
  ] },

  // ---------------------------------------------------------------- comment-or-doc-mention (12)
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    before('src/domain/invoice.ts', 'export interface Invoice {', '// Invoices are persisted by PgInvoiceRepository in src/infra/db/invoice-repository.ts.\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/app/place-order.ts', PLACE_END, "  await orders.save(placeOrder(order)); // one upsert statement in the 'pg' adapter\n}\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    file('docs/runbook.md', "# Runbook\n\n## Configuration\n\nThe service reads `process.env.PORT`, `process.env.DATABASE_URL`, `process.env.LOG_LEVEL`,\n`process.env.SMTP_HOST`, `process.env.SMTP_FROM` and `process.env.INVOICE_PREFIX` in `src/config/settings.ts`.\nA cache would need `process.env.REDIS_URL`; it is not wired yet.\n\n## Database\n\n`src/infra/db/pool.ts` opens a `pg` pool of ten connections. Restart the service after a failover.\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/app/ports.ts', 'export interface Notifier {\n', '/** Implemented by SmtpNotifier in ../infra/mail/mailer.ts; use cases only see this port. */\nexport interface Notifier {\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    before('src/domain/money.ts', "export function money(cents: number, currency = 'EUR'): Money {", '// The currency default is fixed here on purpose: ../config/settings has no currency field.\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    file('src/domain/README.md', "# Domain\n\nPlain types and functions. Nothing here reads `process.env` or imports from `../infra`, `../app` or `../config`.\nPersistence lives in `src/infra/db` (the `pg` package); use cases live in `src/app`.\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    before('src/infra/db/pool.ts', 'export function createPool(connectionString: string): pg.Pool {', '// The pool size is fixed at ten; making it configurable starts in src/config/settings.ts.\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/app/issue-invoice.ts', '  const invoice = invoiceFor(order, await deps.invoices.nextNumber());\n', '  const invoice = invoiceFor(order, await deps.invoices.nextNumber()); // the number is drawn in ../infra/db/invoice-repository\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    before('src/domain/order.ts', 'export interface Order {', "// Use cases depend on the domain, never the reverse: no import('../app') belongs in this folder.\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/config/settings.ts', '  databaseUrl: string;\n', "  databaseUrl: string; // handed to createPool in src/infra/db/pool.ts ('pg')\n"),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    r('src/main.ts', MAIN_SETTINGS, 'const settings = loadSettings(); // the only place process.env is read is src/config\n'),
  ] },
  { family: 'comment-or-doc-mention', nearMiss: true, edits: [
    file('docs/decisions/0002-ports.md', "# 0002: use cases talk to storage through ports\n\nA use case in `src/app` imports `../infra` only through `src/infra/index.ts`. It never imports\n`../infra/db/order-repository` or the `pg` package, and it never calls `import('../infra/db/pool')`.\nThe composition root, `src/main.ts`, is the one place that builds `PgOrderRepository`.\n"),
  ] },
];

export const ITEMS = [
  ...drift.map(it => ({ ...it, intent: 'drift', nearMiss: false })),
  ...clean.map(it => ({ ...it, intent: 'clean', nearMiss: Boolean(it.nearMiss), targets: [] })),
];

/** The authored family counts. */
export const familyCounts = (items = ITEMS) => items.reduce((acc, it) => ({ ...acc, [it.family]: (acc[it.family] ?? 0) + 1 }), {});

/** Per blueprint constraint, how many drift items target it. */
export function coverage(items = ITEMS) {
  const blueprint = JSON.parse(readFileSync(join(JEV, 'blueprint.json'), 'utf8'));
  const out = Object.fromEntries(blueprint.constraints.map(c => [c.id, 0]));
  for (const it of items) for (const t of it.targets) { if (!(t in out)) throw new Error(`unknown target ${t}`); out[t]++; }
  return out;
}

export const stateOf = (rules, diff) => rules + '\n\n' + diff;

/** Build everything in memory: patches, manifest-x, corpus-x index. Validates quotas, coverage, size, apply, lint. */
export async function build() {
  const { patchlib, lint, authorCorpus } = await loadExp005();
  const quotas = scaledQuotas();
  assert.deepEqual(quotas, EXPECTED_QUOTAS, 'the spec-scaled quota table');
  assert.equal(ITEMS.length, TOTAL);
  assert.deepEqual(familyCounts(), quotas, 'authored family counts match the scaled quotas');
  for (const [rule, n] of Object.entries(coverage())) assert.ok(n >= 4, `${rule} is the target of ${n} drift items (< 4)`);

  // The same seeded Fisher-Yates (mulberry32) as EXP 005, with seed 8008; ids renumbered to start at c061.
  const assigned = authorCorpus.assignIds(ITEMS, SEED).map(({ id, item }) => ({ id: 'c' + String(Number(id.slice(1)) + FIRST_ID - 1).padStart(3, '0'), item }));
  const diffs = patchlib.diffsFor(BASE, assigned.map(a => a.item.edits));
  const rules = readFileSync(RULES, 'utf8');
  const lintCfg = lint.lintConfig();
  const patches = {};
  const manifest = { schemaVersion: 1, note: 'EXP 008-X author intent only; NOT a gate input. Ground truth is labels-x.json (bce).', seed: SEED, items: [] };
  const index = { schemaVersion: 1, note: 'EXP 008-X gate-facing index: every state is rules.txt + "\\n\\n" + the patch. No family or label here.', seed: SEED, quotas, items: [] };
  for (const [k, { id, item }] of assigned.entries()) {
    const diff = diffs[k];
    const bytes = Buffer.byteLength(diff);
    if (bytes > MAX_DIFF_BYTES) throw new Error(`${id} diff is ${bytes} bytes > ${MAX_DIFF_BYTES}`);
    const findings = lint.lintText(diff, `${id}.patch`, lintCfg);
    if (findings.length) throw new Error(`${id} lint: ${JSON.stringify(findings)}`);
    patches[id] = diff;
    manifest.items.push({ id, family: item.family, intent: item.intent, nearMiss: item.nearMiss, targets: item.targets });
    index.items.push({ id, patchSha256: sha256(diff), stateSha256: sha256(stateOf(rules, diff)) });
  }
  return { patches, manifest, index, patchlib };
}

export const renderJson = obj => JSON.stringify(obj, null, 2) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { patches, manifest, index, patchlib } = await build();
  const notApplying = Object.entries(patches).filter(([, text]) => !patchlib.appliesTo(BASE, text)).map(([id]) => id);
  if (notApplying.length) throw new Error(`patches that do not apply to base/: ${notApplying.join(' ')}`);
  const sizes = Object.values(patches).map(p => Buffer.byteLength(p));
  if (process.argv.includes('--check')) {
    let bad = 0;
    const onDisk = readdirSync(CORPUS).filter(f => f.endsWith('.patch')).sort();
    if (JSON.stringify(onDisk) !== JSON.stringify(Object.keys(patches).sort().map(id => id + '.patch'))) { console.error('differs: the set of patch files'); bad++; }
    for (const [id, text] of Object.entries(patches)) {
      let disk = null;
      try { disk = readFileSync(join(CORPUS, id + '.patch'), 'utf8'); } catch { /* reported below */ }
      if (disk !== text) { console.error('differs: ' + id); bad++; }
    }
    if (readFileSync(MANIFEST, 'utf8') !== renderJson(manifest)) { console.error('differs: manifest-x.json'); bad++; }
    if (readFileSync(INDEX, 'utf8') !== renderJson(index)) { console.error('differs: corpus-x.json'); bad++; }
    console.log(bad ? `${bad} file(s) differ` : `corpus-x reproduces: ${Object.keys(patches).length} patches, all apply, lint clean, max diff ${Math.max(...sizes)} bytes`);
    process.exitCode = bad ? 1 : 0;
  } else {
    rmSync(CORPUS, { recursive: true, force: true });
    mkdirSync(CORPUS);
    for (const [id, text] of Object.entries(patches)) writeFileSync(join(CORPUS, id + '.patch'), text);
    writeFileSync(MANIFEST, renderJson(manifest));
    writeFileSync(INDEX, renderJson(index));
    console.log(`wrote ${Object.keys(patches).length} patches, manifest-x.json, corpus-x.json; all apply, lint clean`);
    console.log(`quotas ${JSON.stringify(familyCounts())}`);
    console.log(`coverage ${JSON.stringify(coverage())}`);
    console.log(`max diff ${Math.max(...sizes)} bytes`);
  }
}
