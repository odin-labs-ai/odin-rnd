// The byte-parity witness (bundle 2 WO-04): replay committed EXP 005 and EXP 006 run records through the frozen code,
// once directly and once from inside the harness, and compare bytes with what is committed. $0: no model is called;
// the replays read the records the fake clients (fixtures/) and the measured runs already wrote.
//
//   exp005Calls   the reviewer fixture (fixtures/gate-runs/reviewer.fixture.json, written by fake-claude.mjs) and the
//                 counted reviewer run: each call's decision, verdict line and result sha256, re-derived from its raw
//                 `result` text by EXP 005's own parseVerdict.
//   exp005Results results/results.json, recomputed by EXP 005's own computeResults from the committed runs (scored
//                 under the runner code the run recorded, exactly as the published site check does).
//   exp006DiffSeen each replayable EXP 006 run record's calls (the counted run; see replayable6): diffSeen re-derived
//                 from the recorded tool calls by EXP 006's own classifyDiffSeen.
//   exp006Results results/results.json, recomputed by EXP 006's own check6.
// Each replay returns canonical bytes; the committed side is the same fields read straight out of the record.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineComponent } from './kernel.mjs';
import { parseVerdict } from '../experiments/jev-gate/run_reviewer.mjs';
import { computeResults, loadRecords } from '../experiments/jev-gate/results.mjs';
import { classifyDiffSeen } from '../experiments/nina-changes/diff-seen.mjs';
import { check6 } from '../experiments/nina-changes/write-results6.mjs';
import { assertLiveCodeAllowed } from '../scripts/jev-gate-results-site.mjs';
import { fingerprintsFor } from './vendored-exp006.mjs';

const J5 = 'experiments/jev-gate';
const N6 = 'experiments/nina-changes';
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const lines = rows => rows.map(r => `${JSON.stringify(r)}\n`).join('');
export const EXP005_CALL_RECORDS = [`${J5}/fixtures/gate-runs/reviewer.fixture.json`, `${J5}/results/reviewer.json`];
// Every committed EXP 006 run record. Only those the live code can replay are replayed (replayable6): the record's own
// `code` must name the live diff-seen.mjs, and every call must have fingerprints on the tree. practice-a/b were judged
// by the pre-amendment-01 diff-seen.mjs (c032517d…), and practice-recheck-a01's p01/p02 rows are not in
// practice-rows.json, so the witness covers the counted run (180 calls) and discloses the rest.
export const EXP006_RECORDS = [`${N6}/dry-run/practice-a.json`, `${N6}/dry-run/practice-b.json`, `${N6}/dry-run/practice-recheck-a01.json`, `${N6}/results/reviewer.json`];
export function replayable6(path) {
  const r = json(path);
  const live = sha256(readFileSync(`${N6}/diff-seen.mjs`));
  if (r.code?.[`${N6}/diff-seen.mjs`] !== live) return { ok: false, reason: `judged by diff-seen.mjs ${String(r.code?.[`${N6}/diff-seen.mjs`]).slice(0, 8)}, live is ${live.slice(0, 8)}` };
  const fps = json(`${N6}/change-fingerprints.json`).items;
  const practice = new Set(json(`${N6}/practice/practice-rows.json`).items.map(p => p.id));
  const missing = [...new Set(r.calls.map(c => c.id))].filter(id => !fps[id] && !practice.has(id));
  return missing.length ? { ok: false, reason: `no fingerprints on the tree for ${missing.join(', ')}` } : { ok: true, reason: null };
}
export const EXP006_CALL_RECORDS = EXP006_RECORDS.filter(p => replayable6(p).ok);

/** The committed side: the named fields of every call, as written. */
export const committedCalls = (path, fields) => lines(json(path).calls.map(c => Object.fromEntries(['id', 'run', ...fields].map(f => [f, c[f] ?? null]))));

/** EXP 005: decision, verdictLine and resultSha256 re-derived from each call's raw result. `perturb` is the teeth hook. */
export function exp005Calls(path, { perturb = s => s } = {}) {
  const { prereg } = loadRecords();
  return lines(json(path).calls.map(c => {
    const result = c.result === null || c.result === undefined ? null : perturb(c.result);
    const v = result === null ? { decision: null, verdictLine: null } : parseVerdict(prereg, result);
    return { id: c.id, run: c.run, decision: v.decision, verdictLine: v.verdictLine, resultSha256: result === null ? c.resultSha256 ?? null : sha256(result) };
  }));
}
export const EXP005_FIELDS = ['decision', 'verdictLine', 'resultSha256'];

/** EXP 005 results/results.json, recomputed from the committed runs, as the bytes the frozen record was written in. */
export function exp005Results() {
  const runs = Object.fromEntries(['jev', 'laya', 'reviewer'].map(g => [g, json(`${J5}/results/${g}.json`)]));
  const records = loadRecords();
  assertLiveCodeAllowed(records.stamp.code, runs.reviewer.code);
  const record = computeResults({ ...records, stamp: { ...records.stamp, code: runs.reviewer.code }, runs, preflight: json(`${J5}/results/preflight.json`) });
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * EXP 006: every call's diffSeen re-derived from its recorded tool calls. Fingerprints come as the runner made them:
 * a corpus item's from the frozen change-fingerprints.json, a practice row's from its patch (fingerprintsFor, vendored).
 */
export function exp006DiffSeen(path, { fingerprints = json(`${N6}/change-fingerprints.json`) } = {}) {
  const { calls } = json(path);
  const practice = json(`${N6}/practice/practice-rows.json`).items;
  const items = [...new Set(calls.map(c => c.id))].map(id => practice.find(p => p.id === id) ?? { id });
  const fps = fingerprintsFor(items, fingerprints);
  return lines(calls.map(c => {
    const fp = fps[c.id];
    return { id: c.id, run: c.run, diffSeen: fp ? classifyDiffSeen({ calls: c.toolCalls ?? [], fp, harnessFailure: c.harnessFailure }) : null };
  }));
}

/** EXP 006 results/results.json, recomputed by check6 (which itself refuses unless the bytes are equal). */
export const exp006Results = () => check6().bytes.toString('utf8');

/**
 * The replay as a harness component. It injects the corpus (every replayed call names an item the corpus serves, by
 * id) and the pins (the frozen census must be clean before anything is replayed), and provides the four replays.
 */
export const replay = defineComponent({
  name: 'replay',
  inject: ['corpus', 'pins'],
  provides: ['replay'],
  apply(ctx, { perturb = null } = {}) {
    const { corpus, pins } = ctx.inject;
    const v = pins.frozen().violations;
    if (v.length) throw new Error(`frozen census not clean: ${v.map(x => x.path).join(', ')}`);
    const ids = new Set(corpus.items.map(i => i.id));
    const known = path => {
      for (const c of json(path).calls) if (!ids.has(c.id) && !/^p\d+$/.test(c.id)) throw new Error(`${path}: call ${c.id} is not a corpus item`);
      return path;
    };
    // The teeth hook: a configured perturbation appends to every raw result before it is parsed.
    const p = perturb === null ? undefined : s => `${s}${perturb}`;
    ctx.provide('replay', Object.freeze({
      exp005Calls: path => exp005Calls(known(path), p ? { perturb: p } : {}),
      exp005Results,
      exp006DiffSeen: path => exp006DiffSeen(known(path)),
      exp006Results,
    }));
  },
});
