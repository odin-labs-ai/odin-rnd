// EXP 008 (latent-handoff) confirmatory analysis, added by amendment 01 (experiments/latent-handoff/amendment-01.json)
// and rebound by amendment 02 (experiments/latent-handoff/amendment-02.json): the fixed runner.py, the -02 run ids and
// amendment 02's not-before. Every statistical clause is amendment 01's, unchanged.
//
// The pre-registration's `analysis` field calls for this script: written after the record, before the not-before,
// implementing exactly the record's definitions (the exclusions, the Wilson interval, the paired bootstrap, A2b-vs-A0
// agreement, the validity gates and the re-run comparison). Every free detail those definitions leave open is fixed
// here, as a constant, and stated in the amendment. It scores through score.mjs (the only step that reads labels) and
// never changes a row.
//
// Before it analyses anything it checks that the pre-registration, the amendment and every file they bind hash to what
// they say (runner.py at the hash amendment 02 rebinds) and that the rows are amendment 02's run ids on the locked pair. A run is analysed once, when it has
// finished or stopped (a paused run is resumed first): a gap, such as a run the runner stopped on a C1 mismatch, fails
// the global gate `complete` and the result is uninformative. A failed gate is never reported as a pass.
//
//   node experiments/latent-handoff/analyse.mjs --counted <S,M,L rows.jsonl> --rerun <S,M,L rows.jsonl> \
//        --amendment-merged-at <ISO mergedAt of the odin-rnd PR that published amendment 02> [--out <file>]
//
// The record's 60-item fallback (corpus.fallback) is not implemented: the pre-registration's refute did not trigger it,
// so only a dated amendment before the not-before can, and that amendment would carry its own analysis.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS, STAGE1_ARMS, latestRows } from './arms.mjs';
import { C1_KL_MAX, loadTruth, score } from './score.mjs';
import { median } from './timing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const L = 'experiments/latent-handoff';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export const PREREG = { file: `${L}/preregistration.json`, sha256: '638d1dda53e8ae6c9c129d34e6b83fa6642f7ef60b30de8da71e7660082f7f6c' };
export const AMENDMENT = { id: 'amendment-02', file: `${L}/amendment-02.json`, pin: `${L}/amendment-02.sha256` };
/** The amendments before it, as published; amendment 02 names each by sha256. */
export const PRIOR_AMENDMENTS = [{ id: 'amendment-01', file: `${L}/amendment-01.json`, pin: `${L}/amendment-01.sha256`, sha256: 'cf96ee3871282fdbf1a6b6d3b4ab1381dcc4305ac992e0a366f6f044bfb49f83' }];
export const SELF = `${L}/analyse.mjs`;
/** The one record.files binding amendment 02 rebinds, with its exact hashes: the fixed runner. No other bound file may be rebound. */
export const RUNNER_REBIND = Object.freeze({ file: `${L}/runner.py`, from: '95152adafb736193692443a54aed0c168322be31f5a66ec902608fddf88b27fd', to: '6d41e10b9670de8604ad709270a2d80c1cb322bae397facf7442531dd96ea044' });
export const STRATA = ['S', 'M', 'L'];
export const KV_ARMS = STAGE1_ARMS.filter(a => ARMS[a].kind === 'kv');
/** The arms a claim can be made on, each with its per-arm gates: the two mappers and the sender summary. */
export const CLAIM_ARMS = ['A1', 'A2a', 'A2b'];
/** The run ids of a harness version: -02 (amendment 02, the fixed runner) unless another is named; -01 rows are refused. */
export const runIds = (pair, version = '02') => ({
  counted: Object.fromEntries(STRATA.map(s => [s, `counted-${pair.toLowerCase()}-${s}-${version}`])),
  rerun: Object.fromEntries(STRATA.map(s => [s, `rerun-${pair.toLowerCase()}-${s}-${version}`])),
});
// Every bar is the record's; the comparisons are done in integers (percent × n) so no bar is missed by rounding.
export const BARS = Object.freeze({
  a0MinPct: 75, agreementLower: 0.9, ttftUpper: 0.5, ttftExcludedMaxPct: 10,
  manipulationMinPct: 15, c2c3MaxPct: 10, s1Speedup: 1.2, s3MinDisagreements: 15, r1Band: 0.03,
});
export const Z95 = 1.959963984540054;
// The paired percentile bootstrap: 10,000 resamples of the included items with replacement, the same draw for both
// arms; mulberry32 seeded with 8008; index = floor(u × m). The 95% interval is the 251st and 9,750th of the sorted
// resampled ratios (0-based 250 and 9749).
export const BOOT = Object.freeze({ resamples: 10000, seed: 8008, lowerIndex: 250, upperIndex: 9749 });
export const NOT_BEFORE_MS = 24 * 3600 * 1000;
export const DP = 6;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two-sided Wilson score interval for k of n. */
export function wilson(k, n, z = Z95) {
  assert(n > 0 && k >= 0 && k <= n, `wilson(${k}, ${n})`);
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/** median(arm) / median(base) over paired items, with its paired percentile-bootstrap interval. */
export function bootstrapRatio(pairs, boot = BOOT) {
  assert(pairs.length > 0, 'no items to resample');
  const ratio = xs => median(xs.map(x => x.arm)) / median(xs.map(x => x.base));
  const rng = mulberry32(boot.seed), m = pairs.length, out = new Float64Array(boot.resamples);
  for (let b = 0; b < boot.resamples; b += 1) {
    const sample = new Array(m);
    for (let i = 0; i < m; i += 1) sample[i] = pairs[Math.floor(rng() * m)];
    out[b] = ratio(sample);
  }
  out.sort();
  return { point: ratio(pairs), lower: out[boot.lowerIndex], upper: out[boot.upperIndex] };
}

const round = x => (x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(DP)));
const fixed = x => (x === null || x === undefined ? 'null' : x.toFixed(DP));

/** The analysed items: every labelled item minus the record's exposed items (175). */
export function analysedIds(record, truth) {
  const exposed = new Set(record.corpus.exposedItems);
  const all = [...truth.keys()].sort();
  assert.equal(all.length, record.corpus.n, `the labels hold ${all.length} items, the record runs ${record.corpus.n}`);
  const ids = all.filter(id => !exposed.has(id));
  assert.match(record.corpus.analysed, new RegExp(`\\b${ids.length} `), 'the analysed count differs from the record');
  return ids;
}

/** The seeded re-run set: the analysed items with the smallest sha256("8008:" + id); checked against the record's list. */
export function rerunIds(record, analysed) {
  const fence = record.leakageFences.find(f => f.startsWith('A seeded 10% re-run'));
  const lists = [...fence.matchAll(/\((c\d{3}(?:, c\d{3})*)\)/g)].map(m => m[1].split(', '));
  assert.equal(lists.length, 2, 'the record states the re-run set and its fallback set');
  const want = lists[0];
  const got = [...analysed].sort((a, b) => sha256(`8008:${a}`).localeCompare(sha256(`8008:${b}`))).slice(0, want.length).sort();
  assert.deepEqual(got, want, 'the re-run set differs from the record');
  return got;
}

export const parseRows = text => text.split('\n').filter(Boolean).map(l => JSON.parse(l));

/**
 * One run (counted or re-run): per stratum its run id, latest-attempt rows, timing-unstable items and its gaps (every
 * (item, arm) without a row). Refuses rows of another pair, stratum or run id, a duplicate attempt and an extra row.
 */
export function prepare(rows, { pair, ids: wantIds, items }) {
  const out = {};
  for (const s of STRATA) {
    const mine = rows.filter(r => r.runId === wantIds[s]);
    const data = mine.filter(r => !r.kind);
    for (const r of data) {
      assert.equal(r.pair, pair, `${r.runId} ${r.itemId} ${r.arm}: pair ${r.pair}, not the locked ${pair}`);
      assert.equal(r.stratum, s, `${r.runId} ${r.itemId}: stratum ${r.stratum}`);
    }
    const seen = new Set();
    for (const r of data) {
      const k = `${r.itemId}|${r.arm}|${r.attempt ?? 0}`;
      assert(!seen.has(k), `${r.runId}: two rows for ${k}`);
      seen.add(k);
    }
    const latest = latestRows(data);
    const have = new Set(latest.map(r => `${r.itemId}|${r.arm}`));
    const want = items.flatMap(id => STAGE1_ARMS.map(a => `${id}|${a}`));
    const wanted = new Set(want), missing = want.filter(k => !have.has(k)), extra = [...have].filter(k => !wanted.has(k));
    assert.deepEqual(extra, [], `${wantIds[s]}: rows for items outside the run: ${extra.slice(0, 5).join(', ')}`);
    const unstable = new Set(mine.filter(r => r.kind === 'timing-unstable').flatMap(r => r.items));
    // `all` keeps every timing attempt: a superseded attempt still had to start after the not-before
    out[s] = { runId: wantIds[s], rows: latest, all: data, unstable, missing };
  }
  for (const r of rows) assert(Object.values(wantIds).includes(r.runId), `a row of run ${r.runId}, which is not one of ${Object.values(wantIds).join(', ')}`);
  return out;
}

const pick = (run, s, ids) => { const keep = new Set(ids); return run[s].rows.filter(r => keep.has(r.itemId)); };
const byItem = (rows, arm) => new Map(rows.filter(r => r.arm === arm).map(r => [r.itemId, r]));
const accuracyTable = (run, ids, truth) => STRATA.flatMap(s => score(pick(run, s, ids), truth))
  .map(({ pair, stratum, arm, n, correct, abstentions, accuracy }) => ({ stratum, arm, n, correct, abstentions, accuracy }))
  .sort((a, b) => STRATA.indexOf(a.stratum) - STRATA.indexOf(b.stratum) || STAGE1_ARMS.indexOf(a.arm) - STAGE1_ARMS.indexOf(b.arm));
const acc = (table, s, arm) => table.find(g => g.stratum === s && g.arm === arm);

/** Items where both arms answered and the item is not timing-unstable on that stratum, with their TTFT pairs. */
function timedPairs(run, s, ids, arm) {
  const rows = pick(run, s, ids), base = byItem(rows, 'A0'), other = byItem(rows, arm);
  const included = ids.filter(id => !base.get(id).abstain && !other.get(id).abstain && !run[s].unstable.has(id));
  return { included, pairs: included.map(id => ({ itemId: id, arm: other.get(id).ttftMs, base: base.get(id).ttftMs, senderMs: other.get(id).senderMs ?? null })) };
}

export function analyse({ record, lock, truth, counted, rerun, mergedAt }) {
  const pair = lock.decision;
  assert.equal(pair, 'D1p', 'this amendment analyses the locked pair D1′ only (S2 on D1 would need the D2 rows)');
  const ids = analysedIds(record, truth);
  const n = ids.length;
  const all = [...truth.keys()].sort();
  const run = prepare(counted, { pair, ids: runIds(pair).counted, items: all });
  const reIds = rerunIds(record, ids);
  const re = prepare(rerun, { pair, ids: runIds(pair).rerun, items: reIds });
  const gaps = [run, re].flatMap(x => STRATA.map(s => ({ runId: x[s].runId, missing: x[s].missing.length, first: x[s].missing[0] ?? null }))).filter(g => g.missing);
  const complete = { id: 'complete', pass: gaps.length === 0, detail: { gaps } };
  if (gaps.length) {
    return { pair, analysed: { n, items: ids }, rerunItems: reIds, globalGates: [complete], P1: { on: 'A2b, stratum L', verdict: 'uninformative', why: 'global gate failed: complete (the run has gaps; nothing else is computed)' } };
  }
  const table = accuracyTable(run, ids, truth);

  // ---- global gates ----
  const notBefore = new Date(Date.parse(mergedAt) + NOT_BEFORE_MS).toISOString();
  const starts = [run, re].flatMap(x => STRATA.flatMap(s => x[s].all.map(r => r.gate?.ts))).filter(Boolean);
  const firstStart = starts.sort()[0];
  const early = [run, re].flatMap(x => STRATA.flatMap(s => x[s].all.filter(r => !(Date.parse(r.gate?.ts) > Date.parse(notBefore))).map(r => `${r.runId}/${r.itemId}/${r.arm}/attempt-${r.attempt ?? 0}`)));
  const a0L = acc(table, 'L', 'A0');
  const c1 = STRATA.flatMap(s => score(pick(run, s, ids).filter(r => ['A0', 'C1'].includes(r.arm)), truth).filter(g => g.arm === 'C1').map(g => ({ stratum: s, ...g })));
  const c1Failures = c1.flatMap(g => g.c1Failures.map(f => ({ stratum: g.stratum, ...f })));
  const kvRows = STRATA.flatMap(s => pick(run, s, ids).filter(r => KV_ARMS.includes(r.arm)));
  const prefillViolations = kvRows.filter(r => !r.abstain && r.forwardCalls.reduce((a, b) => a + b, 0) !== r.suffixLen).map(r => `${r.stratum}/${r.itemId}/${r.arm}`);
  const rerunDiffs = STRATA.flatMap(s => re[s].rows.flatMap(r => {
    const c = run[s].rows.find(x => x.itemId === r.itemId && x.arm === r.arm);
    const key = x => [Boolean(x.abstain), x.abstain ? null : x.decision, x.abstain ? null : fixed(x.pYes), x.abstain ? null : fixed(x.pYesBin)].join('|');
    return key(c) === key(r) ? [] : [{ stratum: s, itemId: r.itemId, arm: r.arm, counted: key(c), rerun: key(r) }];
  }));
  const globalGates = [
    complete,
    { id: 'not-before', pass: early.length === 0, detail: { notBefore, firstItemStart: firstStart ?? null, early: early.length } },
    { id: 'a0-accuracy', pass: 100 * a0L.correct >= BARS.a0MinPct * a0L.n, detail: { stratum: 'L', correct: a0L.correct, n: a0L.n, accuracy: round(a0L.correct / a0L.n), bar: BARS.a0MinPct / 100 } },
    { id: 'c1-matches-a0', pass: c1.length === 3 && c1.every(g => g.c1Pass), detail: { klMax: C1_KL_MAX, items: c1.reduce((a, g) => a + g.n, 0), failures: c1Failures, maxKl: c1.every(g => g.maxKlVsA0 !== null) ? round(Math.max(...c1.map(g => g.maxKlVsA0))) : null } },
    { id: 'zero-prefill', pass: prefillViolations.length === 0, detail: { kvRows: kvRows.length, abstained: kvRows.filter(r => r.abstain).length, violations: prefillViolations } },
    { id: 'rerun-identical', pass: rerunDiffs.length === 0, detail: { items: reIds.length, rows: STRATA.reduce((a, s) => a + re[s].rows.length, 0), differences: rerunDiffs } },
  ];
  const globalPass = globalGates.every(g => g.pass);

  // ---- per-arm gates, on every stratum ----
  const parity = record.mappers.pairs[pair]?.parityBinding ?? {};
  const perArm = CLAIM_ARMS.flatMap(arm => STRATA.map(s => {
    const a = acc(table, s, arm), c2 = acc(table, s, 'C2'), c3 = acc(table, s, 'C3');
    const manip = 100 * (a.correct - c2.correct) >= BARS.manipulationMinPct * n && 100 * Math.abs(c2.correct - c3.correct) <= BARS.c2c3MaxPct * n;
    const par = ARMS[arm].kind === 'kv' ? { pass: parity[arm]?.pass === true, agree: parity[arm]?.agree ?? null, items: parity[arm]?.items ?? null, maxDp: parity[arm]?.maxDp ?? null } : { pass: null, note: 'not applicable: a text arm has no ported mapper' };
    return {
      arm, stratum: s, parity: par,
      manipulation: { pass: manip, armMinusC2: round((a.correct - c2.correct) / n), c2MinusC3: round((c2.correct - c3.correct) / n), arm: round(a.correct / n), c2: round(c2.correct / n), c3: round(c3.correct / n) },
      pass: manip && par.pass !== false,
    };
  }));
  const a2bL = perArm.find(g => g.arm === 'A2b' && g.stratum === 'L');

  // ---- P1 ----
  const Lrows = pick(run, 'L', ids), a0 = byItem(Lrows, 'A0'), a2b = byItem(Lrows, 'A2b');
  const agree = ids.filter(id => !a0.get(id).abstain && !a2b.get(id).abstain && a0.get(id).decision === a2b.get(id).decision).length;
  const w = wilson(agree, n);
  const agreement = { k: agree, n, rate: round(agree / n), wilson95: { lower: round(w.lower), upper: round(w.upper) }, bar: BARS.agreementLower, holds: w.lower >= BARS.agreementLower };
  const t = timedPairs(run, 'L', ids, 'A2b');
  const excluded = n - t.included.length;
  const ttftInformative = 100 * excluded <= BARS.ttftExcludedMaxPct * n && t.pairs.length > 0;
  const boot = t.pairs.length ? bootstrapRatio(t.pairs) : null;
  const ttft = {
    included: t.included.length, excluded, excludedItems: ids.filter(id => !t.included.includes(id)),
    informative: ttftInformative,
    ratio: boot ? round(boot.point) : null, bootstrap95: boot ? { lower: round(boot.lower), upper: round(boot.upper) } : null,
    medianA0Ms: t.pairs.length ? round(median(t.pairs.map(p => p.base))) : null,
    medianA2bReceiverMs: t.pairs.length ? round(median(t.pairs.map(p => p.arm))) : null,
    medianA2bSenderMs: t.pairs.length ? round(median(t.pairs.map(p => p.senderMs))) : null,
    bar: BARS.ttftUpper, holds: ttftInformative ? boot.upper <= BARS.ttftUpper : null,
  };
  let verdict, why;
  const a0Failed = !globalGates.find(g => g.id === 'a0-accuracy').pass;
  if (!globalPass) [verdict, why] = ['uninformative', `global gate failed: ${globalGates.filter(g => !g.pass).map(g => g.id).join(', ')}${a0Failed ? ' (the record\'s reading: small receivers cannot do this gate, not a test of transfer)' : ''}`];
  else if (!a2bL.pass) [verdict, why] = ['uninformative', 'an A2b per-arm gate failed on stratum L'];
  else if (!agreement.holds || ttft.holds === false) [verdict, why] = ['refuted', [!agreement.holds && 'agreement', ttft.holds === false && 'ttft'].filter(Boolean).join(' and ') + ' criterion failed'];
  else if (!ttftInformative) [verdict, why] = ['uninformative', 'agreement held; the TTFT criterion is uninformative (more than 10% of analysed items excluded)'];
  else [verdict, why] = ['holds', 'both criteria hold and every gate passes'];
  // validityRule: a failed gate makes the results it covers uninformative, so no criterion reads as met under one
  if (!globalPass || !a2bL.pass) for (const c of [agreement, ttft]) Object.assign(c, { holds: null, note: 'not in force: a gate failed (see why)' });
  /** Informative only when every global gate passes and, for a claim arm, its per-arm gate on that stratum passes. */
  const informative = (arm, s) => globalPass && (!CLAIM_ARMS.includes(arm) || perArm.find(g => g.arm === arm && g.stratum === s).pass);

  // ---- secondaries (directional, decide nothing) and R1 ----
  const s1 = ['A2a', 'A2b'].map(arm => {
    const x = timedPairs(run, 'S', ids, arm);
    const speedup = x.pairs.length ? median(x.pairs.map(p => p.base)) / median(x.pairs.map(p => p.arm)) : null;
    return { arm, informative: informative(arm, 'S'), included: x.included.length, speedup: round(speedup), below: speedup === null ? null : speedup < BARS.s1Speedup };
  });
  const s1Informative = s1.every(x => x.informative);
  const disagreements = n - agree;
  const secondary = {
    S1: { stratum: 'S', bar: BARS.s1Speedup, arms: s1, holds: s1Informative ? s1.every(x => x.below === true) : null, ...(s1Informative ? {} : { note: 'uninformative: a global gate, or the per-arm gate of A2a or A2b on stratum S, failed' }) },
    S2: { estimable: false, reason: 'not estimable: the locked pair is D1′, whose reverse is not pinned' },
    S3: { estimable: false, disagreements, reason: `not estimable: the frozen runner records none of the three intrinsic signals (next-token KL, cycle-consistency error, attention-output cosine) nor KV cosine for a mapper arm (for a mapper arm it records only the YES and NO log-probabilities, lpYes and lpNo, not a next-token distribution)${disagreements < BARS.s3MinDisagreements ? `; there are also fewer than ${BARS.s3MinDisagreements} disagreements` : ''}` },
  };
  const r1 = ['A2a', 'A2b'].flatMap(arm => STRATA.map(s => {
    const rows = pick(run, s, ids).filter(r => r.arm === arm && !r.abstain);
    return { arm, stratum: s, informative: informative(arm, s), answered: rows.length, withinBand: rows.filter(r => Math.abs(r.pYesBin - 0.5) <= BARS.r1Band).length, band: BARS.r1Band };
  }));
  const timings = STRATA.flatMap(s => STAGE1_ARMS.map(arm => {
    const rows = pick(run, s, ids).filter(r => r.arm === arm && !r.abstain);
    const sender = rows.map(r => r.senderMs).filter(x => typeof x === 'number');
    return { stratum: s, arm, informative: informative(arm, s), answered: rows.length, unstableItems: [...run[s].unstable].filter(id => ids.includes(id)).length, medianTtftMs: rows.length ? round(median(rows.map(r => r.ttftMs))) : null, medianSenderMs: sender.length ? round(median(sender)) : null };
  }));
  const seenIds = all.filter(id => !ids.includes(id));
  return {
    pair, analysed: { n, items: ids }, rerunItems: reIds, notBefore,
    globalGates, perArmGates: perArm,
    P1: { on: 'A2b, stratum L', agreement, ttft, verdict, why },
    informative: globalPass,
    secondary, descriptive: { R1: r1 }, accuracy: table.map(g => ({ ...g, informative: informative(g.arm, g.stratum) })), timings,
    seenItems: { n: seenIds.length, note: 'run, excluded from every claim and gate, reported separately', accuracy: accuracyTable(run, seenIds, truth) },
  };
}

/** Every file the pre-registration and the amendment bind by sha256, as [path, sha256]; a file the amendment rebinds at its new hash. */
export function boundFiles(record, amendment) {
  const e5 = record.corpus.exp005, J = 'experiments/jev-gate';
  const rebound = new Map((amendment.rebinds ?? []).filter(r => r.file in record.files).map(r => [r.file, r]));
  for (const r of rebound.values()) {
    assert.equal(r.file, RUNNER_REBIND.file, `the amendment may rebind only ${RUNNER_REBIND.file}, not ${r.file}`);
    assert.deepEqual([r.from, r.to], [RUNNER_REBIND.from, RUNNER_REBIND.to], `the amendment rebinds ${r.file} from or to another hash`);
    assert.equal(record.files[r.file], RUNNER_REBIND.from, `the record does not bind ${r.file} at ${RUNNER_REBIND.from}`);
  }
  return [
    ...Object.entries(record.files).map(([f, d]) => [f, rebound.get(f)?.to ?? d]), ...Object.entries(record.mappers.code),
    [`${J}/corpus.sha256`, e5.corpusSumsSha256], [`${J}/inputs.json`, e5.inputsSha256], [`${J}/labels.json`, e5.labelsSha256], [`${J}/rules.txt`, e5.rulesSha256],
    [record.corpus.exp008x.sumsFile, record.corpus.exp008x.sumsSha256],
    [record.strata.manifest.file, record.strata.manifest.sha256], [record.pins.file, record.pins.sha256], [record.readout.file, record.readout.sha256],
    [record.pairLockResult.rows.file, record.pairLockResult.rows.sha256],
    ...record.corpus.exposureEvidence.map(x => [x.file, x.sha256]),
    ...record.descriptive.flatMap(x => x.evidence.map(e => [e.file, e.sha256])),
    [amendment.analysis.file, amendment.analysis.sha256], [amendment.analysis.tests.file, amendment.analysis.tests.sha256],
  ];
}

/** Every hash the analysis depends on, checked against disk; returns the inputs for analyse(). */
export function loadInputs(root = ROOT) {
  const read = f => readFileSync(join(root, f));
  const recordBytes = read(PREREG.file);
  assert.equal(sha256(recordBytes), PREREG.sha256, 'preregistration.json is not the published record');
  const record = JSON.parse(recordBytes);
  const amendmentBytes = read(AMENDMENT.file);
  assert.equal(read(AMENDMENT.pin).toString().split(/\s+/)[0], sha256(amendmentBytes), 'amendment-02.json differs from its pin');
  const amendment = JSON.parse(amendmentBytes);
  assert.equal(amendment.id, AMENDMENT.id, 'the amendment is not amendment 02');
  assert.equal(amendment.parent.sha256, PREREG.sha256, 'the amendment amends another record');
  for (const p of PRIOR_AMENDMENTS) {
    const bytes = read(p.file);
    assert.equal(sha256(bytes), p.sha256, `${p.file} is not the published ${p.id}`);
    assert.equal(read(p.pin).toString().split(/\s+/)[0], p.sha256, `${p.file} differs from its pin`);
    assert.equal(JSON.parse(bytes).parent.sha256, PREREG.sha256, `${p.id} amends another record`);
  }
  assert.deepEqual(amendment.priorAmendments.map(p => [p.id, p.sha256]), PRIOR_AMENDMENTS.map(p => [p.id, p.sha256]), 'the amendment names other prior amendments');
  assert.equal(amendment.analysis.file, SELF, 'the amendment binds another script');
  for (const [f, d] of boundFiles(record, amendment)) assert.equal(sha256(read(f)), d, `${f} differs from the sha256 the pre-registration or the amendment binds`);
  const lock = JSON.parse(read(`${L}/pair-lock.json`));
  assert.equal(lock.record.sha256, PREREG.sha256, 'pair-lock.json describes another record');
  assert.equal(lock.decision, record.pairLockResult.decision, 'pair-lock.json and the record disagree on the locked pair');
  return { record, lock, amendment: { id: AMENDMENT.id, file: AMENDMENT.file, sha256: sha256(amendmentBytes) } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = f => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  if (!get('--counted') || !get('--rerun') || !get('--amendment-merged-at')) {
    process.stderr.write('usage: analyse.mjs --counted a,b,c --rerun a,b,c --amendment-merged-at ISO [--out file]\n');
    process.exit(2);
  }
  assert.match(get('--amendment-merged-at'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, '--amendment-merged-at is a GitHub mergedAt (UTC, seconds)');
  const { record, lock, amendment } = loadInputs();
  const files = k => get(k).split(',');
  const rowsOf = fs => fs.flatMap(f => parseRows(readFileSync(f, 'utf8')));
  const result = analyse({ record, lock, truth: loadTruth(), counted: rowsOf(files('--counted')), rerun: rowsOf(files('--rerun')), mergedAt: get('--amendment-merged-at') });
  const out = {
    schemaVersion: 1, kind: 'analysis', experiment: 'EXP 008',
    preregistration: PREREG, amendment, analysis: { file: SELF, sha256: sha256(readFileSync(join(ROOT, SELF))) },
    amendmentMergedAt: get('--amendment-merged-at'),
    rows: [...files('--counted'), ...files('--rerun')].map(f => ({ file: relative(ROOT, resolve(f)), sha256: sha256(readFileSync(f)) })),
    ...result,
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (get('--out')) writeFileSync(get('--out'), text);
  process.stdout.write(get('--out') ? `${result.P1.verdict}: ${result.P1.why} -> ${get('--out')}\n` : text);
}
