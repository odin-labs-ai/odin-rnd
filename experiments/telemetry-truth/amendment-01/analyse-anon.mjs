// EXP 015 amendment 01: score the published (anonymised) rows with the frozen analysis, unchanged.
//
//   node experiments/telemetry-truth/amendment-01/analyse-anon.mjs           write results.json
//   node experiments/telemetry-truth/amendment-01/analyse-anon.mjs --check   exit 1 unless it equals the committed one
//
// Imports analyse() and readCapture() from the frozen experiments/telemetry-truth/analyse.mjs and changes nothing
// in them. The only difference from the frozen main() is the input and the broker names: it reads runs-anon/*.jsonl,
// whose rows carry a letter instead of a broker id, and gives the frozen analyse() the pre-registration with its
// broker list replaced by whichever letters the committed header row names (sorted) -- the letter assignment is
// never stored in this repository, not even as a derived value; the script only ever sees what the published
// header already carries.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, readCapture } from '../analyse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, '..');

export function letteredRecord(prereg, letters) {
  return { ...prereg, brokers: letters };
}

export function outputs() {
  const prereg = JSON.parse(readFileSync(join(EXP, 'preregistration.json'), 'utf8'));
  prereg.sha256 = readFileSync(join(EXP, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const rows = readCapture(join(EXP, 'runs-anon'));
  const headers = rows.filter(r => r._header);
  if (headers.length < 1 || !Array.isArray(headers[0].brokers) || headers[0].brokers.length !== prereg.brokers.length)
    throw new Error('EXP 015 amendment 01: runs-anon/ must hold headers naming one letter per broker; refusing to guess');
  const letters = [...headers[0].brokers].sort();
  const record = letteredRecord(prereg, letters);
  const pinned = readFileSync(join(HERE, 'amendment.sha256'), 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(join(HERE, 'amendment.json'))).digest('hex');
  if (pinned !== actual) throw new Error('EXP 015 amendment 01: amendment.json no longer matches amendment.sha256');
  const results = analyse(rows, null, record);
  // The frozen analyse()'s own field name for this cross-check names a broker; it is always {n:0, agreeWithin1Pct:0}
  // here anyway, since amendment-01's anonymise.mjs drops the cross-check's fields (see amendment.json). Renamed,
  // not deleted, so the shape stays self-explanatory without naming anyone.
  // analyse.mjs (frozen, unchanged, already public on main) names this field for the one broker whose API offers
  // it; renamed here so the published results.json does not carry that name next to its (always 0/0) value.
  const { openrouterInBandVsGenerationRecord: droppedCrossCheck, ...rest } = results;
  rest.crossCheckOfOneBroker = { ...droppedCrossCheck, note: 'dropped by amendment-01; always 0/0 here' };
  rest.amendment = { id: '01', file: 'experiments/telemetry-truth/amendment-01/amendment.json', sha256: actual, brokers: 'shown as letters' };
  return JSON.stringify(rest, null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = outputs();
  const out = join(EXP, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 015 amendment 01: results.json is not what the amended analysis computes from runs-anon/'); process.exit(1); }
    console.log('EXP 015 amendment 01: results.json recomputes exactly');
  } else {
    writeFileSync(out, text);
    console.log('EXP 015 amendment 01: wrote results.json');
  }
}
