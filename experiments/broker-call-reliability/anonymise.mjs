// EXP 024: turn the probe's own capture rows into the rows this repository publishes.
//
//   node experiments/broker-call-reliability/anonymise.mjs <named-dir> <letters.json> <out-dir>
//
// Run privately, once. <letters.json> maps each broker id to a letter (the same assignment EXP 015's amendment-01
// uses); it stays in the lab's private ledger, never committed. Same reduction as amendment-01's own anonymise.mjs:
// broker -> its letter; keyName's broker name -> the same letter; requestedModel, servedModel, servedProvider,
// estimateSource and the one-broker generation-record cross-check fields dropped (this record's own metric never
// reads any of them, and publishing them would say which letter is which broker). Every measured value this
// record's metric actually uses (ok, httpStatus, ts) is copied unchanged.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DROP_FIELDS = ['requestedModel', 'servedModel', 'servedProvider', 'estimateSource', 'canonicalModel',
  'generationFound', 'generationCostUsd', 'generationModel', 'generationProvider'];

export function anonymiseRow(row, letters) {
  if (row._header) {
    const brokers = row.brokers.map(b => letters[b]).sort();
    return { ...row, command: row.command.replace(/--brokers\s+\S+/, `--brokers <${brokers.length} letters>`), brokers };
  }
  if (row._trailer) {
    if (!(row.broker in letters)) throw new Error(`no letter for broker ${row.broker}`);
    return { ...row, broker: letters[row.broker], keyName: row.keyName ? row.keyName.replace(/_[A-Z]+_API_KEY$/, `_${letters[row.broker]}_API_KEY`) : row.keyName };
  }
  if (!(row.broker in letters)) throw new Error(`no letter for broker ${row.broker}`);
  const letter = letters[row.broker];
  const out = { broker: letter };
  for (const [k, v] of Object.entries(row)) {
    if (k === 'broker' || DROP_FIELDS.includes(k)) continue;
    if (k === 'keyName') { out.keyName = v ? v.replace(/_[A-Z]+_API_KEY$/, `_${letter}_API_KEY`) : v; continue; }
    out[k] = v;
  }
  return out;
}

export function anonymiseDir(namedDir, letters, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(namedDir).filter(f => f.endsWith('.jsonl')).sort()) {
    const text = readFileSync(join(namedDir, file), 'utf8');
    const out = text.split('\n').filter(l => l.trim()).map(l => JSON.stringify(anonymiseRow(JSON.parse(l), letters))).join('\n') + '\n';
    writeFileSync(join(outDir, basename(file)), out);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [namedDir, mapFile, outDir] = process.argv.slice(2);
  if (!outDir) { console.error('usage: anonymise.mjs <named-dir> <letters.json> <out-dir>'); process.exit(1); }
  const { letters } = JSON.parse(readFileSync(mapFile, 'utf8'));
  anonymiseDir(namedDir, letters, outDir);
  console.log(`wrote ${outDir}`);
}
