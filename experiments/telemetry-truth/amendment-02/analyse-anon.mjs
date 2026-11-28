// EXP 015 amendment 02: score the published (anonymised) rechecked rows with the frozen analysis, unchanged.
//
//   node experiments/telemetry-truth/amendment-02/analyse-anon.mjs           write results.json
//   node experiments/telemetry-truth/amendment-02/analyse-anon.mjs --check   exit 1 unless it equals the committed one
//
// Imports analyse() and readCapture() from the frozen experiments/telemetry-truth/analyse.mjs, unchanged, the same
// way amendment-01/analyse-anon.mjs does. Reads amendment-02/runs-anon/*.jsonl (this checkpoint's own window) and
// gives the frozen analyse() this amendment's own window/brokers/decision.rule with the broker list replaced by
// whichever letters the published header row names (sorted). The letter assignment itself is never stored here.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, readCapture } from '../analyse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, '..');

export function outputs() {
  const amendment = JSON.parse(readFileSync(join(HERE, 'amendment.json'), 'utf8'));
  const amendmentSha256 = readFileSync(join(HERE, 'amendment.sha256'), 'utf8').trim().split(/\s+/)[0];
  const preregSha256 = readFileSync(join(EXP, 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const rows = readCapture(join(HERE, 'runs-anon'));
  const headers = rows.filter(r => r._header);
  if (headers.length < 1 || !Array.isArray(headers[0].brokers))
    throw new Error('EXP 015 amendment 02: runs-anon/ must hold headers naming the published letters; refusing to guess');
  const letters = [...headers[0].brokers].sort();
  const pinned = readFileSync(join(HERE, 'amendment.sha256'), 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(join(HERE, 'amendment.json'))).digest('hex');
  if (pinned !== actual) throw new Error('EXP 015 amendment 02: amendment.json no longer matches amendment.sha256');
  const record = { experiment: { id: `${amendment.experiment} amendment ${amendment.amendment}` }, window: amendment.window, brokers: letters, decision: { rule: amendment.decision.rule }, sha256: preregSha256 };
  const results = analyse(rows, null, record);
  const { openrouterInBandVsGenerationRecord: droppedCrossCheck, ...rest } = results;
  rest.crossCheckOfOneBroker = { ...droppedCrossCheck, note: 'dropped by amendment-01; always 0/0 here' };
  rest.amends = amendment.experiment;
  rest.amendmentNumber = amendment.amendment;
  rest.amendmentSha256 = amendmentSha256;
  return JSON.stringify(rest, null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = outputs();
  const out = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('EXP 015 amendment 02: results.json is not what the amended analysis computes from runs-anon/'); process.exit(1); }
    console.log('EXP 015 amendment 02: results.json recomputes exactly');
  } else {
    writeFileSync(out, text);
    console.log('EXP 015 amendment 02: wrote results.json');
  }
}
