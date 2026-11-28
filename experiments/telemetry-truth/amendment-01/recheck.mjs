// Amendment-01 recheck driver. Imports analyse()/readCapture() UNCHANGED from ../analyse.mjs (sha256
// 72194455990c86294b29e6e05b9a665c50e7024b077552ab47816770e0b707e0, same as EXP 015) — this file never
// edits that script. Only amendment.json's window/brokers/decision.rule differ from EXP 015's own.
//
//   node experiments/telemetry-truth/amendment-01/recheck.mjs           read capture/*.jsonl, write results.json
//   node experiments/telemetry-truth/amendment-01/recheck.mjs --check  recompute and exit 1 unless it equals results.json
//
// Inputs: amendment.json + amendment.sha256 (this amendment's frozen window/rule) and capture/*.jsonl
// (the same scheduled probe's rows, for this amendment's window). fleet.json is intentionally absent —
// this lane has no private routing-log access, so the fleet half reports 'not measurable', honestly.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, readCapture } from '../analyse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function main() {
  const amendment = JSON.parse(readFileSync(join(HERE, 'amendment.json'), 'utf8'));
  const amendmentSha256 = readFileSync(join(HERE, 'amendment.sha256'), 'utf8').trim().split(/\s+/)[0];
  const preregSha256 = readFileSync(join(HERE, '..', 'preregistration.sha256'), 'utf8').trim().split(/\s+/)[0];
  const prereg = {
    experiment: { id: `EXP 015 ${amendment.amendment.slug}` },
    window: amendment.window,
    brokers: amendment.brokers,
    decision: { rule: amendment.decision.rule },
    sha256: preregSha256,
  };
  const rows = readCapture(join(HERE, 'capture'));
  const result = analyse(rows, null, prereg);
  result.amends = amendment.amendment.amends;
  result.amendmentNumber = amendment.amendment.number;
  result.amendmentSha256 = amendmentSha256;
  const text = JSON.stringify(result, null, 2) + '\n';
  const out = join(HERE, 'results.json');
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error('amendment-01: results.json is not what the frozen recheck computes from the committed inputs'); return 1; }
    console.log('amendment-01: results.json recomputes exactly'); return 0;
  }
  writeFileSync(out, text);
  console.log(`amendment-01: wrote ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
