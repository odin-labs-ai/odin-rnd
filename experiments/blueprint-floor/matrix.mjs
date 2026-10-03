// EXP 007 refute r8: the engine-behaviour matrix. Every sentence in contract.md, whitelist.json, protocol.md and the
// pre-registration limits that says what bce-engine 0.3.1 does or does not detect cites rows of engine-matrix.json, and every
// row runs through this adapter and the installed engine (scripts/blueprint-floor-matrix.test.mjs), so no engine sentence can
// be prose alone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapLimit } from '../jev-gate/bce-contract.mjs';
import { buildBlueprint, runFloor, validateBlueprint } from './adapter.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const matrixPath = 'experiments/blueprint-floor/engine-matrix.json';
export const loadMatrix = () => JSON.parse(readFileSync(join(HERE, 'engine-matrix.json'), 'utf8'));

/** One row: REFUSED when the engine's validation refuses it, RED when the report names the row's constraint, GREEN when the engine passes; anything else is reported. */
export async function runRow(row) {
  const v = validateBlueprint(buildBlueprint({ ruleId: row.id, constraints: row.constraints, inputKind: row.inputKind, minFiles: 1 }));
  if (!v.ok) return { id: row.id, label: v.engineLimit ? 'REFUSED' : `INVALID(${v.message.split('\n')[0]})`, refs: [] };
  const r = await runFloor({ ruleId: row.id, constraints: row.constraints, inputKind: row.inputKind, input: row.input, flags: row.flags ?? null });
  const ids = new Set(row.constraints.map(c => c.id));
  const fired = r.violations.some(v => ids.has(v.rule));
  return { id: row.id, label: fired ? 'RED' : r.label === 'GREEN' ? 'GREEN' : `RED(${r.violations.map(v => v.rule).join(',')})`, refs: r.violations.map(v => v.ref) };
}
export const runMatrix = (rows = loadMatrix().rows, limit = 4) => mapLimit(rows, limit, runRow);

/** Every [mNN] citation in a text. */
export const citations = text => [...text.matchAll(/\[(m\d{2}(?:, m\d{2})*)\]/g)].flatMap(m => m[1].split(', '));
