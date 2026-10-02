// EXP 008 (latent-handoff) pair lock, bundle 4 WO-02: applies the pre-registration's pairLock rule to the rows of the
// lock run, mechanically. A0 for D1 on stratum L, practice set c001–c020; fewer than 15 of 20 right → D1′, else D1.
// Scoring is score.mjs (an abstention is a wrong answer); this file only checks the rows are the lock run's and counts.
//
//   node experiments/latent-handoff/pair_lock.mjs <rows.jsonl> [--note TEXT]... [--write]   prints (or writes) pair-lock.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTruth, score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const PRACTICE = Array.from({ length: 20 }, (_, i) => `c${String(i + 1).padStart(3, '0')}`);
export const BAR = 15;
// the run's code and inputs: each must hash to what the frozen record binds
const BOUND = ['runner.py', 'arms.mjs', 'score.mjs', 'readout.json', 'strata-manifest.json', 'models.json', 'mem-gate.mjs', 'timing.mjs']
  .map(f => `experiments/latent-handoff/${f}`);

export function decide(rows, truth) {
  const lock = rows.filter(r => !r.kind);
  for (const r of lock) {
    if (r.pair !== 'D1' || r.stratum !== 'L' || r.arm !== 'A0') throw new Error(`${r.itemId}: row is ${r.pair}/${r.stratum}/${r.arm}, not D1/L/A0`);
    if (!PRACTICE.includes(r.itemId)) throw new Error(`${r.itemId} is not in the practice set`);
  }
  const got = new Set(lock.map(r => r.itemId));
  const missing = PRACTICE.filter(id => !got.has(id));
  if (missing.length) throw new Error(`no row for ${missing.join(', ')}`);
  const [g] = score(lock, truth);
  return { correct: g.correct, of: g.n, abstentions: g.abstentions, accuracy: g.accuracy, locked: g.correct >= BAR ? 'D1' : 'D1p' };
}

export function build(rowsPath, notes = [], root = ROOT) {
  const raw = readFileSync(rowsPath);
  const rows = raw.toString('utf8').trim().split('\n').map(l => JSON.parse(l));
  const runIds = [...new Set(rows.map(r => r.runId))];
  if (runIds.length !== 1) throw new Error(`rows carry ${runIds.length} run ids`);
  const record = JSON.parse(readFileSync(join(root, 'experiments/latent-handoff/preregistration.json'), 'utf8'));
  for (const f of BOUND) {
    const have = sha256(readFileSync(join(root, f)));
    if (record.files[f] !== have) throw new Error(`${f} differs from the hash the frozen record binds`);
  }
  const truth = loadTruth();
  const d = decide(rows, truth);
  const latest = new Map();
  for (const r of rows.filter(x => !x.kind)) if (!latest.has(r.itemId) || r.attempt > latest.get(r.itemId).attempt) latest.set(r.itemId, r);
  return {
    rule: record.pairLock,
    record: { file: 'experiments/latent-handoff/preregistration.json', sha256: sha256(readFileSync(join(root, 'experiments/latent-handoff/preregistration.json'))) },
    run: { runId: runIds[0], rows: { file: relative(root, resolve(rowsPath)), sha256: sha256(raw), lines: rows.length }, code: Object.fromEntries(BOUND.map(f => [f, record.files[f]])) },
    bar: `${BAR} of ${PRACTICE.length}`,
    result: { correct: d.correct, of: d.of, abstentions: d.abstentions, accuracy: d.accuracy },
    alwaysAccept: `The practice set is ${PRACTICE.filter(id => truth.get(id) === 'GREEN').length} GREEN and ${PRACTICE.filter(id => truth.get(id) === 'RED').length} RED, so a receiver that always answers ACCEPT scores ${PRACTICE.filter(id => truth.get(id) === 'GREEN').length} of ${PRACTICE.length}. Computed here, after the lock run, not part of the frozen record.`,
    decision: d.locked,
    decisionText: d.locked === 'D1' ? `D1 stays: A0 got ${d.correct} of ${d.of} right, at or above the bar of ${BAR}.` : `D1′ replaces D1: A0 got ${d.correct} of ${d.of} right, below the bar of ${BAR}.`,
    notes,
    items: PRACTICE.map(id => { const r = latest.get(id); return { itemId: id, label: truth.get(id), decision: r.abstain ? null : r.decision, abstain: r.abstain, pYes: r.pYes == null ? null : Number(r.pYes.toFixed(6)), attempt: r.attempt, ts: r.ts }; }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rowsPath = process.argv[2];
  if (!rowsPath) { process.stderr.write('usage: pair_lock.mjs <rows.jsonl> [--write]\n'); process.exit(2); }
  const notes = process.argv.flatMap((a, i) => (a === '--note' ? [process.argv[i + 1]] : []));
  const out = `${JSON.stringify(build(rowsPath, notes), null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(join(HERE, 'pair-lock.json'), out);
  process.stdout.write(out);
}
