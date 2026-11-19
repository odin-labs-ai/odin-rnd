import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderFactoryReceipts } from './factory-receipts.mjs';

const record = JSON.parse(readFileSync(new URL('../site/data/witnesses/test-witness.json', import.meta.url)));

test('the scene compares test outcomes and evidence decisions from the same recorded invoice case', () => {
  const html = renderFactoryReceipts(record);
  assert.doesNotMatch(html, /\sid=/);
  const boundary = record.observations.find(o => o.id === 'rounding-strong').actual.assertions.find(a => a.id === 'rounding');
  const invoice = html.match(/data-studio-result="invoice">(.*?)<\/article>/s)[1];
  assert.match(invoice, /<h3[^>]*>Invoice total<\/h3>/);
  const readouts = [...invoice.matchAll(/<dt>([^<]+)<\/dt>\s*<dd>([^<]+)<\/dd>/g)].map(match => match.slice(1));
  assert.deepEqual(readouts, [['Returned', boundary.actual], ['Expected', boundary.expected]]);
  for (const [key, id] of [['ordinary', 'rounding-weak'], ['boundary', 'rounding-strong'], ['always', 'rounding-always-pass']]) {
    const observation = record.observations.find(o => o.id === id);
    const checks = observation.actual.assertions;
    const tests = html.match(new RegExp(`data-studio-observation="${key}"[^>]*>(.*?)</div>`, 's'))[1];
    assert.ok(tests.includes(`${checks.filter(c => c.status === 'PASS').length} of ${checks.length} checks passed`));
    const decision = html.match(new RegExp(`data-studio-decision="${key}"[^>]*>(.*?)</div>`, 's'))[1];
    assert.ok(decision.includes(`Test evidence ${observation.verdict}`));
    for (const panel of [tests, decision]) assert.ok(panel.includes(`projects/test-witness/#observation-${id}`));
  }
  assert.match(html, /href="data\/witnesses\/test-witness\.json"/);
  assert.ok(html.includes(record.completedAt.slice(0, 10)));
});

test('conflicting command output, suite identity and observation values fail before publication', () => {
  for (const alter of [
    (row, cmd) => { cmd.stdout = cmd.stdout.replace('1.00|1.01', '1.01|1.01'); },
    (row, cmd) => { cmd.args[cmd.args.length - 1] = 'weak'; },
    row => { row.actual.assertions.find(a => a.id === 'rounding').actual = '9.99'; },
    row => { row.verdict = 'rejected'; },
  ]) {
    const copy = structuredClone(record);
    const row = copy.observations.find(o => o.id === 'rounding-strong');
    alter(row, copy.commands.find(cmd => cmd.id === row.commandIds.at(-1)));
    assert.throws(() => renderFactoryReceipts(copy));
  }
});
