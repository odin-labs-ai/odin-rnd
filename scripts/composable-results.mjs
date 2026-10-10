#!/usr/bin/env node
// EXP 009 results (bundle 5 WO-02): the counted run's raw records in, results/composable-harness/results.json out.
//
//   node scripts/composable-results.mjs --write   write the results record
//   node scripts/composable-results.mjs --check   recompute from the raw records and byte-compare
//
// This is the adapter only. The confirmatory analysis is the FROZEN experiments/composable-harness/analysis/analyse.mjs,
// called unchanged: this script builds its input { trials, p2, gates, timings } exactly as its header documents, from
// runs/composable-harness/counted/ (written append-only by scripts/composable-counted.mjs), and copies its output
// verbatim. Every gate input is computed from committed records, never asserted:
//   - only rows whose attemptId has an event:'complete' row in attempts.jsonl count (a crashed attempt is kept on disk
//     and excluded here);
//   - k1: of = the distinct planted leaks; a leak is detected only if every complete block detected it (fail-closed);
//   - r0Rerun: every re-run row is sampled; only identical === true counts as identical (a skipped row does not);
//   - r0Restart: every complete block's restart pair is identical;
//   - pins: every complete attempt's recorded preflight (recordSha256 == the committed record's sha256, pinsVerified),
//     and the committed harness/kernel.mjs hashes to its entry in the record's file map;
//   - leases: a block held its lease only if its committed sidecar leases/<runId>.jsonl exists, the lease label is the
//     block's, the sidecar closed with exit 0, and the attempt started inside [lease start, close].
// Pure functions take the rows; only the CLI touches the file system. No clock is read: --check is byte-stable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, p2Rows } from '../experiments/composable-harness/analysis/analyse.mjs';
import { ARM_FILES, COUNTED_MODELS, deriveSeed, NOT_BEFORE, PINS, PUBLISHED_AT, SEED } from './composable-counted.mjs';

export const C = 'experiments/composable-harness';
export const RECORD_PATH = `${C}/preregistration.json`;
export const KERNEL_PATH = 'harness/kernel.mjs';
export const RAW_ROOT = 'runs/composable-harness/counted';
export const RESULTS_PATH = 'results/composable-harness/results.json';
/** odin-rnd #28, the pull request that published the record as frozen. */
export const MERGE_COMMIT = '91de325de980493291d17237387aac6d2c656b7c';

// The read-only diagnosis of each recorded P1 divergence, keyed "<block>/<trial>". It quotes R0's content-addressed
// cache (runs/composable-harness/counted/r0-cache/), which is a rewritable index and not part of the record, so the
// evidence is inlined here. It re-classifies nothing: the verdict is the frozen analysis's.
export const DIVERGENCE_DIAGNOSES = Object.freeze({
  '29/291': [
    'Diagnosis of the one divergent trial (block 29, trial 291), not a re-classification: the pre-registered verdict stands.',
    'What the records show. Reconstructed from the seed, trial 291 enters with memo-cache (maxEntries 256), yesno-gate and mlx.model on pin B, in that load order; step 5 swaps mlx.model to pin A; steps 6, 7 and 8 evaluate c024, c058 and c021 on that unchanged set. H1 answered all three through yesno-gate. For c024, R0\'s fresh process (cache key 3f0dfcf0c8aa…, written 01:03:50.79Z) had every loaded component active and answered REJECT, p = 0.651355, matching H1. For c058 (e12c56e6e725…, 01:03:51.98Z) and c021 (b99d4a820b1f…, 01:03:52.24Z), on the same loaded set, R0\'s fresh process ended with mlx.model not active, memo-cache and yesno-gate inactive behind it (both inject mlx), no mlxPin and no decisions; that is the recorded R0 output of {}. H1 had passed its own activation of mlx.model at the step-5 swap. So the two arms judged activation at different instants and only R0\'s attempt failed: on these two steps R0 is not a valid reference, rather than H1 carrying a state a fresh process would not.',
    'Bounded. Over the whole run, 10 of the 13,627 cached R0 outputs with mlx.model in the loaded set have it not active, all inside block 29 between 01:03:18Z and 01:04:52Z. The other 8 had no yesno-gate loaded, so their decisions (lint and grep only) could not differ, and eval steps compare decisions only. None of the 10 keys fell in the seeded 10% R0 re-run or the restart pick (a fact of the draw, not a gate failure).',
    'Why it failed is inferred, not recorded: R0 prints the kernel projection, which reports a failed component as inactive and drops its reason, and exits 0, so the failure was cached as an answer. The failed outputs were written 0.13 to 0.25 s apart, against a median of 2.7 s (n = 8,008) before a fresh R0 output for an evaluation through yesno-gate and mlx.model, which puts the failure before the MLX child started. All 10 are on pin A (llama-3.2-3b, the larger model), and each of the three clusters (01:03:18Z, 01:03:51Z, 01:04:52Z) begins right after a fresh R0 process had loaded pin A successfully and exited. That is most consistent with the memory gate in mlx.model\'s apply refusing while the memory of the previous R0 process\'s child was not yet reclaimed, beside H1\'s own resident pin-A child. Block 29\'s lease sidecar (21 samples, 0 breaches) read 53%, 56% and 56% free at 01:01:59Z, 01:03:01Z and 01:04:03Z, near the gate\'s 50% floor. Undetermined from the records: the gate\'s reading and its refusal at those instants, which no record kept.',
  ].join(' '),
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const nn = k => String(k).padStart(2, '0');
const parseJsonl = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));
const within = r => r.trial ?? r.leak ?? r.key ?? r.config ?? r.event ?? '';
/** Disk order never reaches the record: rows sort by block, attempt, then trial (or leak, key, config, event). */
const byBlock = (a, b) => a.block - b.block || String(a.attemptId).localeCompare(String(b.attemptId))
  || (typeof within(a) === 'number' && typeof within(b) === 'number' ? within(a) - within(b) : String(within(a)).localeCompare(String(within(b))));

// ---- the adapter (pure) -------------------------------------------------------------------------------------------

/** The attempt ids with an event:'complete' row, and per-event counts. */
export function attemptSummary(attempts) {
  const complete = new Set(attempts.filter(r => r.event === 'complete').map(r => r.attemptId));
  const count = event => attempts.filter(r => r.event === event).length;
  return { complete, starts: count('start'), completes: count('complete'), errors: count('error') };
}

/** Keep only rows whose attempt completed. */
export const completeOnly = (rows, complete) => rows.filter(r => complete.has(r.attemptId));

/** K1 / K2 over every complete block: a leak is detected only when every block detected it. */
export function k1k2(kRows) {
  const leaks = [...new Set(kRows.map(r => r.leak))].sort();
  const perLeak = leaks.map(leak => {
    const rows = kRows.filter(r => r.leak === leak);
    return { leak, blocks: rows.length, k1DetectedBlocks: rows.filter(r => r.k1Detected === true).length, k2ResidueProbes: rows.reduce((n, r) => n + (r.k2Residue ?? []).length, 0) };
  });
  return {
    k1: { detected: perLeak.filter(l => l.blocks > 0 && l.k1DetectedBlocks === l.blocks).length, of: leaks.length },
    k2: { residueProbes: perLeak.reduce((n, l) => n + l.k2ResidueProbes, 0) },
    perLeak,
  };
}

/** One block's lease, judged from its committed sidecar. */
export function leaseHeld(start, sidecars) {
  const lease = start.lease ?? {};
  const rows = lease.runId ? sidecars[lease.runId] : undefined;
  const reasons = [];
  if (!rows) reasons.push('no committed sidecar');
  if (lease.label !== `exp009-counted-b${nn(start.block)}`) reasons.push('lease label is not this block\'s');
  const close = (rows ?? []).filter(r => r.kind === 'close');
  if (close.length !== 1 || close[0].exitCode !== 0) reasons.push('sidecar has no single close row with exit 0');
  const at = Date.parse(start.startedAt), from = Date.parse(lease.startedAt), to = close.length ? Date.parse(close[0].ts) : NaN;
  if (!(at >= from && at <= to)) reasons.push('the attempt did not start inside the lease');
  return { block: start.block, runId: lease.runId ?? null, held: reasons.length === 0, reasons };
}

/** Breach samples per block, counted from the committed sidecars. */
export function breaches(starts, sidecars) {
  return starts.map(s => ({ block: s.block, breaches: (sidecars[s.lease?.runId] ?? []).filter(r => r.kind === 'breach').length })).filter(b => b.breaches > 0);
}

/**
 * analyse()'s input from the raw rows. `raw` holds the parsed arm files (keys of ARM_FILES) and `sidecars`
 * ({ runId: rows }); `ctx` holds the record, its committed sha256, the kernel file's sha256, the P2 configs and the
 * baseline outputs.
 */
export function adapt(raw, ctx) {
  const { complete } = attemptSummary(raw.attempts);
  const keep = rows => completeOnly(rows ?? [], complete).sort(byBlock);
  const starts = keep(raw.attempts.filter(r => r.event === 'start'));
  const h1 = keep(raw.h1), h2 = keep(raw.h2), k = keep(raw.k), rerun = keep(raw.rerun), restart = keep(raw.restart), p2 = keep(raw.p2);

  const trials = [
    ...h1.map(t => ({ arm: 'H1', trial: t.trial, divergences: t.divergences })),
    ...h2.map(t => ({ arm: 'H2', trial: t.trial, divergences: t.divergences ?? [], residue: t.residue ?? [], mismatches: t.mismatches ?? 0 })),
  ];
  const kernelCensus = Object.fromEntries(p2.map(r => [r.config, r.end]));
  const p2rows = p2.length ? p2Rows({ configs: ctx.configs, kernelCensus, baseline: ctx.baseline }) : [];
  const { k1, k2 } = k1k2(k);
  const leases = starts.map(s => leaseHeld(s, raw.sidecars));
  const gates = {
    k1, k2,
    r0Rerun: { sampled: rerun.length, identical: rerun.filter(r => r.identical === true).length },
    r0Restart: { identical: restart.length > 0 && restart.length === starts.length && restart.every(r => r.identical === true) },
    pins: {
      verified: starts.length > 0 && starts.every(s => s.preflight?.pinsVerified === true && s.preflight?.recordSha256 === ctx.recordSha256),
      kernelShaInPrereg: ctx.record.files?.[KERNEL_PATH] === ctx.kernelSha256,
    },
    leases: { blocks: new Set(starts.map(s => s.block)).size, held: leases.filter(l => l.held).length },
  };
  // S3 is not measured: the frozen arms record only wallMs, not a per-arm time-to-ready (disclosed).
  return { input: { trials, p2: p2rows, gates, timings: [] }, kept: { starts, h1, h2, k, rerun, restart, p2, prelude: keep(raw.prelude) }, leases };
}

/** The p-th percentile by nearest rank (the record's practice rule for perTrialWallSeconds). */
export const nearestRank = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.ceil(p * s.length) - 1] : null; };

/** The full results record: the frozen analysis output, a verdict per primary claim, the limits and the disclosures. */
export function buildResults(raw, ctx) {
  const { input, kept, leases } = adapt(raw, ctx);
  const result = analyse(input);
  const { record } = ctx;
  const summary = attemptSummary(raw.attempts);
  const startTimes = raw.attempts.filter(r => r.event === 'start').map(r => r.startedAt).sort();
  const firstComplete = kept.starts.map(s => s.startedAt).sort()[0] ?? null;
  const wallS = kept.h1.map(t => t.wallMs / 1000);
  const frozenP90 = record.schedule.perTrialWallSeconds;
  const breachBlocks = breaches(kept.starts, raw.sidecars);
  const h2WithErrors = kept.h2.filter(t => (t.errors ?? []).length > 0).length;
  const preludeBlocks = new Set(kept.prelude.map(r => r.block));
  const startedEmpty = kept.starts.map(s => s.block).filter(b => !preludeBlocks.has(b));
  const kk = k1k2(kept.k);
  const verdict = (id, r) => ({ claim: record.primary[id].claim, verdict: r.verdict, refutedBy: record.primary[id].refutedBy });

  const disclosures = [
    { id: 'prelude', text: `Each block's long-lived kernel first loads the set its first trial enters with, as a prelude compared with R0 like any step and never counted as a trial: ${kept.prelude.length} preludes (${kept.prelude.filter(r => r.divergences.length > 0).length} with a divergence); ${startedEmpty.length} block(s) (${startedEmpty.map(nn).join(', ') || 'none'}) entered with an empty set and needed none.` },
    { id: 'items-and-pins', text: `Items: the record's ${record.corpus.n}-item corpus (sha256 ${record.corpus.sha256}). Pins ${PINS.join(' and ')}: ${PINS.map(p => `${p} = ${COUNTED_MODELS[p]}`).join(', ')}, the record's mlx.model swapped by reconfigure.` },
    { id: 'attempts', text: `Attempts: ${summary.starts} started, ${summary.completes} complete, ${summary.errors} error. A crashed attempt would be kept on disk and excluded from the analysis; there were ${summary.errors}.` },
    { id: 's3-not-measured', text: 'S3 (time to ready) is not measured. The frozen arms record only a trial\'s wall time, not a per-arm time-to-ready, and no instrumentation was added after the freeze: an instrument gap, disclosed. S3 decides nothing.' },
    { id: 'p2-pre-computed', text: `P2 pre-computed before registration: a disclosure, not a prediction. ${record.p2Disclosure.statement} Seen then: kernel correct on ${record.p2Disclosure.seenOutcome.kernelCorrect} of ${record.p2Disclosure.seenOutcome.of}, McNemar b = ${record.p2Disclosure.seenOutcome.mcnemar.b}, c = ${record.p2Disclosure.seenOutcome.mcnemar.c}. Measured in the counted run: kernel correct on ${result.P2.kernelCorrect} of ${result.P2.n}, McNemar b = ${result.P2.mcnemar.b}, c = ${result.P2.mcnemar.c}. ${record.p2Disclosure.predictive}` },
    { id: 'breaches', text: `Memory-window breaches (${record.memoryWindow.breach}), counted from the committed lease sidecars: ${breachBlocks.reduce((n, b) => n + b.breaches, 0)} breach sample(s) in ${breachBlocks.length} block(s) (${breachBlocks.map(b => `b${nn(b.block)}: ${b.breaches}`).join(', ') || 'none'}). They exclude S3 timings only, and S3 is not measured.` },
    { id: 'wall-time', text: `Wall time per counted H1 trial (as arms/run.mjs records it): median ${nearestRank(wallS, 0.5)} s, p90 (nearest rank) ${nearestRank(wallS, 0.9)} s, max ${nearestRank(wallS, 1)} s over ${wallS.length} trials, against the frozen practice p90 of ${frozenP90} s; ${wallS.filter(s => s > frozenP90).length} trial(s) took longer than ${frozenP90} s.` },
    { id: 'not-before', text: `${startTimes.every(t => Date.parse(t) > Date.parse(NOT_BEFORE)) ? 'Not-before honoured' : 'Not-before NOT honoured'}: the record was published at ${PUBLISHED_AT} (odin-rnd #28, merge ${MERGE_COMMIT}), so no attempt could start before ${NOT_BEFORE}; the first attempt started at ${startTimes[0]} and the first complete one at ${firstComplete}, and ${startTimes.filter(t => Date.parse(t) <= Date.parse(NOT_BEFORE)).length} of ${startTimes.length} attempts started at or before it.` },
    { id: 'leases', text: `${leases.length > 0 && leases.every(l => l.held) ? 'Every block held its memory-window lease' : 'Not every block held its memory-window lease'}: ${leases.filter(l => l.held).length} of ${leases.length} complete blocks, each with its committed sidecar (${Object.keys(raw.sidecars).length} sidecars), the block's own label, a close with exit 0, and the attempt's start inside the lease.` },
    { id: 'gate-aggregation', text: `Gate aggregation over ${kept.starts.length} blocks: K1 counts a planted leak as detected only if every block detected it (${kk.perLeak.filter(l => l.k1DetectedBlocks === l.blocks).length} of ${kk.perLeak.length} leaks in all blocks); K2 sums residue probes over every block; the R0 re-run counts a skipped key as not identical (${kept.rerun.filter(r => r.identical !== true && r.identical !== false).length} skipped); the restart gate needs every block's pair identical.` },
    { id: 'h2-evaluation-errors', text: `${h2WithErrors} of ${kept.h2.length} H2 trials recorded at least one evaluation error. S1 counts residue only, as the frozen analysis defines it; H2 is secondary and decides nothing.` },
    ...kept.h1.filter(t => t.divergences.length > 0).map(t => ({ id: 'divergence-diagnosis', block: t.block, trial: t.trial,
      text: DIVERGENCE_DIAGNOSES[`${t.block}/${t.trial}`] ?? `Divergent trial (block ${t.block}, trial ${t.trial}): not diagnosed. The pre-registered verdict stands.` })),
  ];

  return {
    schemaVersion: 1,
    kind: 'odin-rnd.results',
    experiment: { id: record.experiment.id, slug: record.experiment.slug, title: record.experiment.title },
    record: { path: RECORD_PATH, sha256: ctx.recordSha256, mergeCommit: MERGE_COMMIT, publishedAt: PUBLISHED_AT, notBefore: NOT_BEFORE, seed: SEED },
    run: {
      blocks: kept.starts.length, firstStartedAt: firstComplete,
      lastEndedAt: raw.attempts.filter(r => r.event === 'complete' && summary.complete.has(r.attemptId)).map(r => r.endedAt).filter(Boolean).sort().at(-1) ?? null,
    },
    analysis: { file: record.analysis.file, sha256: record.files[record.analysis.file] },
    raw: ctx.rawFiles,
    result,
    verdicts: { P1: verdict('P1', result.P1), P2: verdict('P2', result.P2), validityRule: record.validityRule, informative: result.validity.informative },
    p1Divergences: kept.h1.filter(t => t.divergences.length > 0).map(t => ({ block: t.block, trial: t.trial, divergences: t.divergences })),
    k1PerLeak: kk.perLeak,
    leases,
    limits: record.limits,
    disclosures,
  };
}

export const render = results => `${JSON.stringify(results, null, 2)}\n`;

// ---- the file system edge -------------------------------------------------------------------------------------------

/** Every raw record and frozen input, read from `root`. */
export function load(root = '.') {
  const read = f => readFileSync(join(root, f));
  const raw = {};
  const rawFiles = [];
  for (const [arm, file] of Object.entries(ARM_FILES)) {
    const bytes = read(`${RAW_ROOT}/${file}`);
    raw[arm] = parseJsonl(bytes.toString('utf8'));
    rawFiles.push({ path: `${RAW_ROOT}/${file}`, sha256: sha256(bytes), rows: raw[arm].length });
  }
  raw.sidecars = {};
  for (const f of readdirSync(join(root, RAW_ROOT, 'leases')).filter(x => x.endsWith('.jsonl')).sort()) {
    const bytes = read(`${RAW_ROOT}/leases/${f}`);
    raw.sidecars[f.slice(0, -'.jsonl'.length)] = parseJsonl(bytes.toString('utf8'));
    rawFiles.push({ path: `${RAW_ROOT}/leases/${f}`, sha256: sha256(bytes), rows: raw.sidecars[f.slice(0, -'.jsonl'.length)].length });
  }
  const recordBytes = read(RECORD_PATH);
  const record = JSON.parse(recordBytes.toString('utf8'));
  assert.equal(deriveSeed(MERGE_COMMIT), SEED, 'the merge commit does not derive the published seed');
  const dir = `${C}/corpus/authored`;
  const configs = readdirSync(join(root, dir)).filter(f => /^cfg-\d{3}\.json$/.test(f)).sort().map(f => JSON.parse(read(`${dir}/${f}`).toString('utf8')));
  const baseline = JSON.parse(read(`${C}/baseline/outputs.json`).toString('utf8'));
  return { raw, ctx: { record, recordSha256: sha256(recordBytes), kernelSha256: sha256(read(KERNEL_PATH)), configs, baseline, rawFiles } };
}

export function expected(root = '.') {
  const { raw, ctx } = load(root);
  return render(buildResults(raw, ctx));
}

export function check(root = '.') {
  const want = expected(root);
  const file = join(root, RESULTS_PATH);
  assert.ok(existsSync(file), `${RESULTS_PATH} is missing; run node scripts/composable-results.mjs --write`);
  assert.equal(readFileSync(file, 'utf8'), want, `${RESULTS_PATH} is not current; run node scripts/composable-results.mjs --write`);
  return { sha256: sha256(want), results: JSON.parse(want) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === '--write') {
    const body = expected();
    mkdirSync(dirname(RESULTS_PATH), { recursive: true });
    writeFileSync(RESULTS_PATH, body);
    console.log(`Wrote ${RESULTS_PATH} (sha256 ${sha256(body)})`);
  } else if (command === '--check') {
    const { sha256: digest, results } = check();
    const { P1, P2 } = results.result;
    console.log(`PASS ${RESULTS_PATH} is current (sha256 ${digest}): P1 ${P1.divergentTrials}/${P1.n} ${P1.verdict}; P2 ${P2.verdict}; informative ${results.result.validity.informative}`);
  } else {
    console.error('usage: node scripts/composable-results.mjs --write | --check');
    process.exit(2);
  }
}
