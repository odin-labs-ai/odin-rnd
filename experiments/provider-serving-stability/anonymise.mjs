// EXP 022: turn the probe's own capture rows into the rows this repository publishes.
//
//   node experiments/provider-serving-stability/anonymise.mjs <named-dir> <letters.json> <out-dir>
//
// Run privately, once. <letters.json> maps each broker id to a letter (the same assignment EXP 015's amendment-01
// uses); it stays in the lab's private ledger, never committed. Fields that would name a broker, or that would
// publish a broker's serving-provider identity in the clear, are dropped or tokenised:
//   broker                              -> its letter
//   keyName                             -> the env-var name with the broker name replaced by its letter
//   requestedModel, servedProvider, estimateSource, generationFound, generationCostUsd, generationModel,
//   generationProvider                  -> dropped (same reasons amendment-01 drops them)
//   servedModel                         -> replaced by a token (identity-1, identity-2, ...) assigned in order of
//                                          first appearance within each (letter, canonicalModel) group, across
//                                          the whole file set -- this is exactly what this experiment's own metric
//                                          needs (how many distinct served identities per pair, and which calls
//                                          share one), published without the literal provider string.
// canonicalModel is kept unchanged: every broker's row already normalises it to the same string.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DROP_FIELDS = ['requestedModel', 'servedProvider', 'estimateSource', 'generationFound', 'generationCostUsd', 'generationModel', 'generationProvider'];

/** Assigns identity-N tokens to raw servedModel strings, first-seen order, scoped per (letter, canonicalModel). */
export function tokeniser() {
  const seen = new Map(); // "letter\u0000canonicalModel\u0000rawValue" -> token
  const counters = new Map(); // "letter\u0000canonicalModel" -> next index
  return (letter, canonicalModel, rawValue) => {
    const groupKey = `${letter}\u0000${canonicalModel}`;
    const valueKey = `${groupKey}\u0000${rawValue}`;
    if (!seen.has(valueKey)) {
      const next = (counters.get(groupKey) ?? 0) + 1;
      counters.set(groupKey, next);
      seen.set(valueKey, `identity-${next}`);
    }
    return seen.get(valueKey);
  };
}

export function anonymiseRow(row, letters, tokenOf) {
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
    if (k === 'servedModel') { out.servedModel = v ? tokenOf(letter, row.canonicalModel, v) : v; continue; }
    out[k] = v;
  }
  return out;
}

export function anonymiseDir(namedDir, letters, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const tokenOf = tokeniser(); // one tokeniser shared across every file, so identical raw values anywhere in the
  // window get the same token and a changing value within one group is visible as a second, distinct token
  for (const file of readdirSync(namedDir).filter(f => f.endsWith('.jsonl')).sort()) {
    const text = readFileSync(join(namedDir, file), 'utf8');
    const out = text.split('\n').filter(l => l.trim()).map(l => JSON.stringify(anonymiseRow(JSON.parse(l), letters, tokenOf))).join('\n') + '\n';
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
