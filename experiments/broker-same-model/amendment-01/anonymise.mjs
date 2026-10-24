// EXP 016 amendment 01: turn the counted rows run.mjs wrote into the rows this repository publishes.
//
//   node experiments/broker-same-model/amendment-01/anonymise.mjs <named-rows.jsonl> <letters.json> <out.jsonl>
//
// Run privately, once, on the counted run's output. <letters.json> maps each broker id to a letter
// ({"letters": {"<broker>": "A", ...}}); it stays in the lab's private ledger. Every measured field is copied
// unchanged. Fields that would say which broker a row belongs to are dropped or reduced:
//   broker           -> its letter
//   requestedModel   -> dropped (each broker spells the model id differently)
//   servedModel      -> dropped; servedFamily and servedMatches (computed by the frozen lib.mjs) are kept
//   servedProvider   -> dropped
//   error            -> errorClass: 'http-<status>' for a non-200 status, 'empty-answer' for a 200 without text,
//                       'transport' for no HTTP response (the broker's own error wording is identifying)
// The header keeps its counts and times; its command and brokers are rewritten to the letters.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const KEEP = ['ts', 'kind', 'rep', 'slot', 'arm', 'change', 'latencyMs', 'status', 'ok', 'servedFamily', 'servedMatches',
  'promptTokens', 'completionTokens', 'costUsd', 'costWhy', 'finishReason', 'answerChars', 'answerSha256', 'verdict'];

export function errorClass(row) {
  if (row.ok !== true && row.ok !== false) throw new Error(`row without a boolean ok (slot ${row.slot}, ${row.broker})`);
  if (row.ok) return null;
  if (row.status == null) return 'transport';
  if (row.status !== 200) return `http-${row.status}`;
  return 'empty-answer';
}

export function anonymiseRow(row, letters) {
  if (row._header) {
    return { _header: true, experiment: row.experiment, kind: row.kind, startedAt: row.startedAt,
      command: 'node experiments/broker-same-model/run.mjs --kind counted --cap-usd 3 (output anonymised by amendment-01/anonymise.mjs)',
      // sorted, so the header's order says nothing about which letter was which position in the record's list
      changes: row.changes, replicates: row.replicates, arms: row.arms, brokers: row.brokers.map(b => letters[b]).sort(), capUsd: row.capUsd };
  }
  if (row._trailer) return row;
  if (!(row.broker in letters)) throw new Error(`no letter for broker ${row.broker}`);
  if (!Number.isInteger(row.slot) || typeof row.arm !== 'string') throw new Error(`counted row without a slot or arm (${row.broker})`);
  const out = { broker: letters[row.broker] };
  for (const k of KEEP) if (k in row) out[k] = row[k];
  const e = errorClass(row);
  if (e) out.errorClass = e;
  return out;
}

export function anonymise(text, letters) {
  const lines = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const rows = lines.map(r => anonymiseRow(r, letters));
  if (rows.filter(r => r._header).length !== 1) throw new Error('expected exactly one header row');
  const body = rows.filter(r => !r._header && !r._trailer);
  // keep the run's own order for the header and trailer; sort the calls so file order says nothing about which
  // broker answered first in a slot
  body.sort((a, b) => a.slot - b.slot || a.arm.localeCompare(b.arm) || a.broker.localeCompare(b.broker));
  return [rows.find(r => r._header), ...body, rows.find(r => r._trailer)].filter(Boolean).map(r => JSON.stringify(r)).join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [inFile, mapFile, outFile] = process.argv.slice(2);
  if (!outFile) { console.error('usage: anonymise.mjs <named-rows.jsonl> <letters.json> <out.jsonl>'); process.exit(1); }
  writeFileSync(outFile, anonymise(readFileSync(inFile, 'utf8'), JSON.parse(readFileSync(mapFile, 'utf8')).letters));
}
