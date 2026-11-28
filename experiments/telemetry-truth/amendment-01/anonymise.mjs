// EXP 015 amendment 01: turn the probe's counted rows into the rows this repository publishes.
//
//   node experiments/telemetry-truth/amendment-01/anonymise.mjs <named-dir> <letters.json> <out-dir>
//
// Run privately, once, over the capture artifacts. <letters.json> maps each broker id to a letter
// ({"letters": {"<broker>": "<letter>", ...}}); it stays in the lab's private ledger, never committed, not even
// as a hash (with three brokers there are only six possible assignments, so a hash would reveal it). Every
// measured value is copied unchanged. Fields that would say which broker, or which broker's own spelling, a row
// belongs to are dropped or reduced:
//   broker           -> its letter
//   keyName          -> the env-var name with the broker name replaced by its letter
//   requestedModel, servedModel, servedProvider -> dropped (each broker spells/serves these differently;
//                       canonicalModel is kept: it is the one field every broker's row normalises to the same
//                       string for the same requested model, so it names no broker)
//   estimateSource   -> dropped (names the private price-book repository and, for one broker, the broker itself
//                       by name in a "(path <broker> = direct)" suffix)
//   generationFound, generationCostUsd, generationModel, generationProvider -> dropped. These four fields are
//                       present only on the one broker whose API offers a generation-record cross-check; their
//                       mere presence on a row, even after the broker field is lettered, would say which letter
//                       that broker is. The cross-check itself is not published in this amendment (see its
//                       limits); it remains in the private, named record.
// The header's brokers list is lettered and sorted (so file order says nothing about which letter was which
// position in the pre-registration's own list) and its command string's --brokers value is replaced by a count.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DROP_CALL_FIELDS = ['requestedModel', 'servedModel', 'servedProvider', 'estimateSource',
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
  const out = { broker: letters[row.broker] };
  for (const [k, v] of Object.entries(row)) {
    if (k === 'broker' || DROP_CALL_FIELDS.includes(k)) continue;
    if (k === 'keyName') { out.keyName = v ? v.replace(/_[A-Z]+_API_KEY$/, `_${letters[row.broker]}_API_KEY`) : v; continue; }
    out[k] = v;
  }
  return out;
}

export function anonymiseFile(text, letters) {
  return text.split('\n').filter(l => l.trim()).map(l => JSON.stringify(anonymiseRow(JSON.parse(l), letters))).join('\n') + '\n';
}

export function anonymiseDir(namedDir, letters, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(namedDir).filter(f => f.endsWith('.jsonl')).sort()) {
    writeFileSync(join(outDir, basename(file)), anonymiseFile(readFileSync(join(namedDir, file), 'utf8'), letters));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [namedDir, mapFile, outDir] = process.argv.slice(2);
  if (!outDir) { console.error('usage: anonymise.mjs <named-dir> <letters.json> <out-dir>'); process.exit(1); }
  const { letters } = JSON.parse(readFileSync(mapFile, 'utf8'));
  anonymiseDir(namedDir, letters, outDir);
  console.log(`wrote ${outDir}`);
}
