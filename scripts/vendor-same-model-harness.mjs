#!/usr/bin/env node
// Lab 11's vendor: turns the runner's log (experiments/same-model-harness/runs/<date>/rows.jsonl, in this repository)
// into the published record, site/data/labs/same-model-harness/record.json, and its sha256 pin beside it. Every reply is
// scored again with the shared scorer (experiments/same-model-harness/score.mjs); the reply's text stays in the log and
// only its sha256 reaches the record. It refuses to write a record that scripts/lab-same-model-harness.mjs would refuse.
//
//   node scripts/vendor-same-model-harness.mjs --log runs/2026-11-12/rows.jsonl            write the record and its pin
//   node scripts/vendor-same-model-harness.mjs --log runs/2026-11-12/rows.jsonl --verify   check the committed bytes
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUND_FILES, EXPERIMENT, SMH_PIN, SMH_RECORD, callsFromRows, fixtureOf, machineText, sameModelHarnessProblems } from './lab-same-model-harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = b => createHash('sha256').update(b).digest('hex');

export function buildRecord(log, root = repo) {
  const dir = join(root, EXPERIMENT);
  const text = readFileSync(join(dir, log), 'utf8');
  const fx = fixtureOf(join(dir, 'fixture'));
  const { session, calls, refusedCells, end } = callsFromRows(text, fx.files);
  if (!end) throw new Error('the run log has no end row: the run did not finish');
  const bound = { fixture: fx.manifest };
  for (const [key, file] of Object.entries(BOUND_FILES)) bound[key] = sha256(readFileSync(join(dir, file)));
  bound.suiteOutput = session.suiteOutputSha256;
  bound.log = sha256(text);
  return {
    format: 'odin-lab-same-model-harness', version: 1, lab: 'same-model-harness', logDay: /^runs\/(\d{4}-\d{2}-\d{2})\/rows\.jsonl$/.exec(log)?.[1] ?? null,
    measured: { on: session.at.slice(0, 10), started: session.at, ended: end.at, machine: machineText(session), ollama: session.ollama },
    bound, suite: session.suite, fixtureFiles: fx.files.length, runsPerCell: session.runs, maxLoad: session.maxLoad,
    models: session.models, refusedCells, calls,
  };
}

function main() {
  const args = process.argv.slice(2);
  const log = args[args.indexOf('--log') + 1];
  if (!args.includes('--log') || !log) throw new Error('--log runs/<date>/rows.jsonl is required');
  const record = buildRecord(log);
  const problems = sameModelHarnessProblems(record, { repoRoot: repo });
  if (problems.length) throw new Error(`refused:\n  ${problems.join('\n  ')}`);
  const bytes = `${JSON.stringify(record, null, 1)}\n`;
  const pin = `${sha256(bytes)}  record.json\n`;
  const recordPath = join(repo, 'site', SMH_RECORD), pinPath = join(repo, 'site', SMH_PIN);
  if (args.includes('--verify')) {
    const same = existsSync(recordPath) && readFileSync(recordPath, 'utf8') === bytes && readFileSync(pinPath, 'utf8') === pin;
    console.log(same ? 'the committed record is the same bytes' : 'the committed record differs from the run log');
    process.exit(same ? 0 : 1);
  }
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, bytes);
  writeFileSync(pinPath, pin);
  console.log(`wrote ${SMH_RECORD} (${record.calls.length} calls) and its pin ${sha256(bytes)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
