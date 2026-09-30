// EXP 006 R2-3 / R3-5: three extra PRACTICE rows for the dry run (bundle 2). They are not corpus items (not in
// corpus/, manifest.json, labels.json, inputs.json or corpus.sha256), their ids are not corpus ids, and no result on
// them is a measurement: they exercise the change shapes the manipulation check must see —
//   p04 adds a file in a NEW directory (git diff shows nothing; only `?? src/reports/` and a Read reveal it);
//   p05 a rename (src/infra/mail/mailer.ts -> smtp-mailer.ts, with its one importer updated);
//   p06 mixed: a modified file plus an added one.
//   node experiments/nina-changes/practice/author-practice6.mjs          write practice-rows.json
//   node experiments/nina-changes/practice/author-practice6.mjs --check  rebuild and compare byte for byte
// Each patch is made by EXP 005's patchlib.diffFor (git, rename detection on, 3 lines of context) against the base app.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffFor } from '../../jev-gate/patchlib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JEV = join(HERE, '..', '..', 'jev-gate');
export const OUT = join(HERE, 'practice-rows.json');

const REVENUE = `import type { Invoice } from '../domain';
import { add, money, type Money } from '../domain';

/** Total revenue over a set of invoices, in one currency. */
export function totalRevenue(invoices: readonly Invoice[], currency = 'EUR'): Money {
  return invoices.reduce((sum, invoice) => add(sum, invoice.total), money(0, currency));
}
`;
const REFUND = `import { money, type Money } from './money';

/** A refund is never larger than what was paid. */
export function refundAmount(paid: Money, requestedCents: number): Money {
  return money(Math.min(paid.cents, Math.max(0, requestedCents)), paid.currency);
}
`;

export const ROWS = [
  { id: 'p04', intent: 'GREEN', edits: [{ path: 'src/reports/revenue.ts', content: REVENUE }] },
  { id: 'p05', intent: 'GREEN', edits: [
    { path: 'src/infra/mail/mailer.ts', renameTo: 'src/infra/mail/smtp-mailer.ts' },
    { path: 'src/infra/index.ts', replace: ["import { SmtpNotifier } from './mail/mailer';", "import { SmtpNotifier } from './mail/smtp-mailer';"] },
  ] },
  { id: 'p06', intent: 'GREEN', edits: [
    { path: 'src/domain/refund.ts', content: REFUND },
    { path: 'src/domain/index.ts', replace: ["export * from './order';", "export * from './order';\nexport * from './refund';"] },
  ] },
];

export function buildPractice6() {
  const corpusIds = new Set(JSON.parse(readFileSync(join(JEV, 'inputs.json'), 'utf8')).items.map(i => i.id));
  const items = ROWS.map(({ id, intent, edits }) => {
    if (corpusIds.has(id)) throw new Error(`${id} is a corpus id`);
    return { id, intent, patch: diffFor(join(JEV, 'base'), edits) };
  });
  return { schemaVersion: 1, kind: 'practice-rows', note: 'EXP 006 practice rows for the dry run (R2-3): a new directory, a rename, a mixed change. Not corpus items, never scored; intent is the author\'s, not a bce label.', items };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = `${JSON.stringify(buildPractice6(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) { console.error('practice-rows.json differs from a rebuild'); process.exit(1); }
    console.log('practice-rows.json rebuilds byte for byte');
  } else { writeFileSync(OUT, text); console.log('wrote practice-rows.json'); }
}
