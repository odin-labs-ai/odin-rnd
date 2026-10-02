// EXP 008 (latent-handoff) scorer, bundle 3 WO-04: the ONLY step that reads labels (runner/scorer split).
//
// Truth is bce: EXP 005 labels.json for c001..c060, corpus-x/labels-x.json for c061..c200. A RED item is answered
// correctly by REJECT, a GREEN item by ACCEPT. An abstention (OOM, NaN, a summary that fails the lint) counts as a
// wrong answer for its arm, never as a skip.
//
//   node experiments/latent-handoff/score.mjs <rows.jsonl>...   prints one JSON summary per (pair, stratum, arm)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const C1_KL_MAX = JSON.parse(readFileSync(join(HERE, 'readout.json'), 'utf8')).c1KlMax;

export function loadTruth({ exp005 = join(HERE, '..', 'jev-gate', 'labels.json'), exp008x = join(HERE, 'corpus-x', 'labels-x.json') } = {}) {
  const truth = new Map();
  for (const path of [exp005, exp008x]) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    for (const it of raw.items ?? raw) {
      if (!['RED', 'GREEN'].includes(it.label)) throw new Error(`${it.id}: label ${it.label} is not RED/GREEN`);
      if (truth.has(it.id)) throw new Error(`${it.id} is labelled twice`);
      truth.set(it.id, it.label);
    }
  }
  return truth;
}

export function score(rowsIn, truth) {
  // the latest timing attempt per (item, arm) counts; a re-queued item's earlier attempts are superseded
  const best = new Map();
  for (const r of rowsIn.filter(x => !x.kind)) {
    const k = `${r.pair}|${r.stratum}|${r.itemId}|${r.arm}`;
    if (!best.has(k) || (r.attempt ?? 0) > (best.get(k).attempt ?? 0)) best.set(k, r);
  }
  const rows = [...best.values()];
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.pair}|${r.stratum}|${r.arm}`;
    if (!groups.has(key)) groups.set(key, { pair: r.pair, stratum: r.stratum, arm: r.arm, n: 0, correct: 0, abstentions: 0, rejects: 0, missedRed: 0, falseReject: 0 });
    const g = groups.get(key);
    const want = truth.get(r.itemId);
    if (!want) throw new Error(`${r.itemId} has no label`);
    g.n += 1;
    if (r.abstain) { g.abstentions += 1; continue; }
    const reject = r.decision === 'REJECT';
    if (reject) g.rejects += 1;
    if ((want === 'RED') === reject) g.correct += 1;
    else if (want === 'RED') g.missedRed += 1;
    else g.falseReject += 1;
  }
  const out = [...groups.values()].map(g => ({ ...g, accuracy: Number((g.correct / g.n).toFixed(4)) }));
  // C1 is the plumbing control: it must agree with A0 item by item at KL < c1KlMax. A C1 abstention is a C1 FAILURE
  // (the plumbing did not deliver), never a skip; any failure makes the C1 gate fail (c1Pass false).
  for (const g of out.filter(x => x.arm === 'C1')) {
    const a0 = new Map(rows.filter(r => r.pair === g.pair && r.stratum === g.stratum && r.arm === 'A0').map(r => [r.itemId, r.decision]));
    const c1 = rows.filter(r => r.pair === g.pair && r.stratum === g.stratum && r.arm === 'C1');
    const ok = c1.filter(r => !r.abstain);
    const failures = c1.filter(r => r.abstain || !(r.klVsA0 < C1_KL_MAX) || a0.get(r.itemId) !== r.decision);
    g.decisionAgreementWithA0 = ok.filter(r => a0.get(r.itemId) === r.decision).length / Math.max(1, c1.length);
    g.maxKlVsA0 = ok.length ? Math.max(...ok.map(r => r.klVsA0)) : null;
    g.c1Failures = failures.map(r => ({ itemId: r.itemId, reason: r.abstain ? `abstain:${r.reason}` : !(r.klVsA0 < C1_KL_MAX) ? 'kl' : 'decision' }));
    g.c1Pass = failures.length === 0 && c1.length > 0;
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { process.stderr.write('usage: score.mjs <rows.jsonl>...\n'); process.exit(2); }
  const rows = files.flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
  for (const g of score(rows, loadTruth())) process.stdout.write(`${JSON.stringify(g)}\n`);
}
