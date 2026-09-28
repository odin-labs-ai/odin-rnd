// EXP 005 WO-02: the base tree, its blueprint, rules.txt and the per-rule teeth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BCE_CLI } from '../experiments/jev-gate/bce-contract.mjs';
import { BLUEPRINT, runTeeth } from '../experiments/jev-gate/teeth.mjs';

const dir = new URL('../experiments/jev-gate/', import.meta.url);
const blueprint = JSON.parse(readFileSync(BLUEPRINT, 'utf8'));

test('bce validate accepts the blueprint', () => {
  const r = spawnSync(process.execPath, [BCE_CLI, 'validate', '--blueprint', BLUEPRINT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /blueprint VALID: ledger-service-layering@1\.0\.0 \(9 constraint\(s\)\)/);
});

test('rules.txt maps 1:1 onto the blueprint constraints (README table)', () => {
  const rules = readFileSync(new URL('rules.txt', dir), 'utf8').trim().split('\n');
  const readme = readFileSync(new URL('README.md', dir), 'utf8');
  const rows = [...readme.matchAll(/^\| (\d) \| ([^|]+) \| ([^|]+) \|$/gm)].map(m => ({ line: Number(m[1]), text: m[2].trim(), ids: m[3].split(',').map(s => s.replace(/`/g, '').trim()) }));
  assert.equal(rows.length, rules.length - 1, 'one table row per rule line (line 1 is the scope preamble)');
  for (const row of rows) assert.equal(row.text, rules[row.line - 1], `README row ${row.line} quotes rules.txt verbatim`);
  const mapped = rows.flatMap(r => r.ids).sort();
  assert.deepEqual(mapped, blueprint.constraints.map(c => c.id).sort(), 'every constraint is mapped exactly once');
  for (const id of mapped) assert.ok(!rules.join('\n').includes(id), `rules.txt must not carry the rule id ${id}`);
});

test('base is GREEN; each rule has a discriminating RED mutation; probes match the recorded report', async () => {
  const report = await runTeeth();
  assert.deepEqual(report.base, { label: 'GREEN', score: 100, violations: 0 });
  assert.deepEqual(report.rulesWithoutTeeth, []);
  for (const t of report.teeth) assert.ok(t.discriminating, `${t.rule}: ${t.label} ${t.rules}`);
  const recorded = JSON.parse(readFileSync(new URL('teeth-report.json', dir), 'utf8'));
  assert.deepEqual(report, recorded, 'teeth-report.json reproduces');
});
