// EXP 016 amendment 01: score the published (anonymised) rows with the frozen analysis, unchanged.
//
//   node experiments/broker-same-model/amendment-01/analyse-anon.mjs           write results.json + spend-ledger.jsonl
//   node experiments/broker-same-model/amendment-01/analyse-anon.mjs --check   exit 1 unless both equal the committed ones
//
// It imports analyse(), spendLedger() and readRuns() from the frozen experiments/broker-same-model/analyse.mjs and
// changes nothing in them. The only difference from the frozen main() is the input and the broker names: it reads
// runs-anon/*.jsonl, whose rows carry a letter instead of a broker id, and gives the frozen analyse() the record with
// its broker list replaced by those letters. Every decision rule, price and threshold comes from the frozen record.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, readRuns, spendLedger } from '../analyse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, '..');

export function letteredRecord(prereg, letters) {
  return { ...prereg, brokers: letters };
}

export function outputs() {
  const prereg = JSON.parse(readFileSync(join(EXP, 'preregistration.json'), 'utf8'));
  prereg.sha256 = readFileSync(join(EXP, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const rows = readRuns(join(EXP, 'runs-anon'));
  const headers = rows.filter(r => r._header);
  if (headers.length !== 1 || !Array.isArray(headers[0].brokers) || headers[0].brokers.length !== prereg.brokers.length)
    throw new Error('EXP 016: runs-anon/ must hold exactly one header naming one letter per broker; refusing to guess');
  const record = letteredRecord(prereg, headers[0].brokers);
  const pinned = readFileSync(join(HERE, 'amendment.sha256'), 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(join(HERE, 'amendment.json'))).digest('hex');
  if (pinned !== actual) throw new Error('EXP 016: amendment.json no longer matches amendment.sha256');
  const results = analyse(rows, record);
  results.amendment = { id: '01', file: 'experiments/broker-same-model/amendment-01/amendment.json', sha256: actual, brokers: 'shown as letters' };
  return { 'results.json': JSON.stringify(results, null, 2) + '\n', 'spend-ledger.jsonl': spendLedger(rows, record) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = outputs();
  if (process.argv.includes('--check')) {
    for (const [name, text] of Object.entries(out)) {
      const p = join(EXP, name);
      if (!existsSync(p) || readFileSync(p, 'utf8') !== text) { console.error(`EXP 016: ${name} is not what the amended analysis computes from runs-anon/`); process.exit(1); }
    }
    console.log('EXP 016: results.json and spend-ledger.jsonl recompute exactly (amendment 01)');
  } else {
    for (const [name, text] of Object.entries(out)) writeFileSync(join(EXP, name), text);
    console.log('EXP 016: wrote results.json and spend-ledger.jsonl (amendment 01)');
  }
}
