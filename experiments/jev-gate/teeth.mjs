// WO-02 T-4: blueprint teeth and drift-family probes.
//
// Teeth: every blueprint constraint is reddened by one hand mutation of the base tree, and that
// mutation reddens ONLY its own constraint (a discriminating negative per clause).
// Probes: the drift families the plan called risky (a re-export and a dynamic import()) are run
// through bce before the corpus spec is fixed. A family bce cannot see is removed from the spec.
//
//   node experiments/jev-gate/teeth.mjs          prints the table and writes teeth-report.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERE, mapLimit, scoreTree } from './bce-contract.mjs';
import { diffFor } from './patchlib.mjs';

export const BASE = join(HERE, 'base');
export const BLUEPRINT = join(HERE, 'blueprint.json');

export const TEETH = [
  { rule: 'domain-no-app', edits: [{ path: 'src/domain/order.ts', replace: ["import { DomainError } from './errors';", "import { DomainError } from './errors';\nimport type { OrderRepository } from '../app/ports';"] }] },
  { rule: 'domain-no-infra', edits: [{ path: 'src/domain/invoice.ts', replace: ["import type { Money } from './money';", "import type { Money } from './money';\nimport type { Services } from '../infra';"] }] },
  { rule: 'domain-no-config', edits: [{ path: 'src/domain/customer.ts', replace: ["import { DomainError } from './errors';", "import { DomainError } from './errors';\nimport type { Settings } from '../config/settings';"] }] },
  // pg in app/ (not domain/) so only core-no-pg fires; the import targets a package, not a module under src/infra.
  { rule: 'core-no-pg', edits: [{ path: 'src/app/register-customer.ts', replace: ["import { createCustomer } from '../domain';", "import type pg from 'pg';\nimport { createCustomer } from '../domain';"] }] },
  { rule: 'app-no-infra-internals', edits: [{ path: 'src/app/place-order.ts', replace: ["import type { CustomerRepository, OrderRepository } from './ports';", "import type { PgOrderRepository } from '../infra/db/order-repository';\nimport type { CustomerRepository, OrderRepository } from './ports';"] }] },
  { rule: 'env-not-in-domain', edits: [{ path: 'src/domain/customer.ts', replace: ['creditLimitCents: 50_000', "creditLimitCents: Number(process.env.CREDIT_LIMIT ?? '50000')"] }] },
  { rule: 'env-not-in-app', edits: [{ path: 'src/app/issue-invoice.ts', replace: ['invoiceFor(order, await deps.invoices.nextNumber())', "invoiceFor(order, await deps.invoices.nextNumber(), Number(process.env.DUE_DAYS ?? '30'))"] }] },
  { rule: 'env-not-in-infra', edits: [{ path: 'src/infra/mail/mailer.ts', replace: ['port: 587', "port: Number(process.env.SMTP_PORT ?? '587')"] }] },
  { rule: 'config-env-allowlist', edits: [{ path: 'src/config/settings.ts', replace: ["invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',", "invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',\n    stripeKey: process.env.STRIPE_SECRET_KEY ?? '',"] }] },
];

// Each probe states what bce must report for the family to stay in the corpus spec.
export const PROBES = [
  {
    id: 'reexport-in-governed-file',
    family: 'reexport',
    note: 'a domain file re-exports an infra module (export ... from): the edge starts in a governed file',
    edits: [{ path: 'src/domain/index.ts', replace: ["export * from './order';", "export * from './order';\nexport { createPool } from '../infra/db/pool';"] }],
  },
  {
    id: 'star-reexport-in-governed-file',
    family: 'reexport',
    note: 'a domain file star-re-exports an infra module (export * from)',
    edits: [{ path: 'src/domain/index.ts', replace: ["export * from './order';", "export * from './order';\nexport * from '../infra/db/pool';"] }],
  },
  {
    id: 'transitive-via-ungoverned-barrel',
    family: 'reexport',
    note: 'a domain file imports an ungoverned barrel (src/shared) that re-exports infra: only a transitive path reaches infra',
    edits: [
      { path: 'src/shared/index.ts', content: "export { createPool } from '../infra/db/pool';\n" },
      { path: 'src/domain/order.ts', replace: ["import { DomainError } from './errors';", "import { DomainError } from './errors';\nimport type { createPool } from '../shared';"] },
    ],
  },
  {
    id: 'transitive-via-sanctioned-infra-barrel',
    family: 'reexport',
    note: 'app imports the sanctioned src/infra/index.ts, which re-exports an infra/db internal',
    edits: [
      { path: 'src/infra/index.ts', replace: ["export { createHttpServer } from './http/routes';", "export { createHttpServer } from './http/routes';\nexport { PgOrderRepository } from './db/order-repository';"] },
      { path: 'src/app/place-order.ts', replace: ["import type { CustomerRepository, OrderRepository } from './ports';", "import type { PgOrderRepository } from '../infra';\nimport type { CustomerRepository, OrderRepository } from './ports';"] },
    ],
  },
  {
    id: 'dynamic-import-literal',
    family: 'dynamic-import',
    note: 'a domain function loads an infra module with a string-literal import()',
    edits: [{ path: 'src/domain/invoice.ts', replace: ['export function invoiceFor(', "export async function mailerModule() {\n  return import('../infra/mail/mailer');\n}\n\nexport function invoiceFor("] }],
  },
  {
    id: 'dynamic-import-computed',
    family: 'dynamic-import',
    note: 'a domain function loads a module whose specifier is computed at run time',
    edits: [{ path: 'src/domain/invoice.ts', replace: ['export function invoiceFor(', "export async function load(name: string) {\n  return import(`../infra/${name}`);\n}\n\nexport function invoiceFor("] }],
  },
];

export async function runTeeth() {
  const base = await scoreTree({ blueprint: BLUEPRINT, tree: BASE });
  const teeth = await mapLimit(TEETH, 6, async t => {
    const r = await scoreTree({ blueprint: BLUEPRINT, tree: BASE, patch: diffFor(BASE, t.edits) });
    return { rule: t.rule, label: r.label, score: r.score, rules: r.rules, discriminating: r.label === 'RED' && r.rules.length === 1 && r.rules[0] === t.rule };
  });
  const probes = await mapLimit(PROBES, 6, async p => {
    const r = await scoreTree({ blueprint: BLUEPRINT, tree: BASE, patch: diffFor(BASE, p.edits) });
    return { id: p.id, family: p.family, note: p.note, label: r.label, score: r.score, rules: r.rules };
  });
  const bp = JSON.parse(readFileSync(BLUEPRINT, 'utf8'));
  const ruleIds = bp.constraints.map(c => c.id).sort();
  const missing = ruleIds.filter(id => !teeth.some(t => t.rule === id && t.discriminating));
  return { base: { label: base.label, score: base.score, violations: base.violations.length }, teeth, probes, rulesWithoutTeeth: missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runTeeth();
  console.log(`base: ${report.base.label} score ${report.base.score}`);
  for (const t of report.teeth) console.log(`tooth ${t.rule}: ${t.label} score ${t.score} [${t.rules.join(', ')}] discriminating=${t.discriminating}`);
  for (const p of report.probes) console.log(`probe ${p.id}: ${p.label} score ${p.score} [${p.rules.join(', ')}]`);
  writeFileSync(join(HERE, 'teeth-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.base.label !== 'GREEN' || report.rulesWithoutTeeth.length) process.exitCode = 1;
}
