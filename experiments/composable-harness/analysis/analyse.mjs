// EXP 009 analysis. Pure: records in, one result record out; frozen in the pre-registration with its synthetic-row
// tests (an analysis amendment resets the not-before clock). It never reads labels and never calls a model.
//
// Input { trials, p2, gates, timings }:
//   trials  [{ arm: 'H1'|'H2', trial, divergences: [...], residue?: [...], mismatches?: n }]   (one row per trial)
//   p2      [{ config, faulty: bool, kernel: 'silent-inert'|'false-inactive'|'mislabelled'|'correct',
//             baseline: 'silent-inert'|'silent-dropped'|'false-inactive'|'correct' }]   (built by p2Rows)
//   gates   { k1: { detected, of }, k2: { residueProbes }, r0Rerun: { sampled, identical }, r0Restart: { identical },
//             pins: { verified, kernelShaInPrereg }, leases: { blocks, held } }
//   timings [{ arm: 'H1'|'R0', readyMs, breach: bool }]
// Output: validity (every gate, pass/fail, and `informative`), P1, P2, S1, S2, S3. When any gate fails the record is
// published as uninformative: every claim's verdict becomes 'uninformative', never a pass.
export const P1_MIN_N = 381; // 0 failures in n >= 381 puts the 95% Wilson upper bound at <= 1%
export const K1_MIN = 11;
export const Z95 = 1.959963984540054;

/** The Wilson score interval's upper bound for k successes in n (95%). */
export function wilsonUpper(k, n, z = Z95) {
  if (n === 0) return 1;
  const p = k / n, z2 = z * z;
  return (p + z2 / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** Exact two-sided McNemar (binomial on the discordant pairs, p = 0.5). */
export function mcnemar(b, c) {
  const n = b + c;
  if (n === 0) return { b, c, p: 1 };
  const k = Math.min(b, c);
  let tail = 0, coef = 1;
  for (let i = 0; i <= k; i += 1) { if (i > 0) coef = (coef * (n - i + 1)) / i; tail += coef; }
  return { b, c, p: Math.min(1, (2 * tail) / 2 ** n) };
}

// ---------------------------------------------------------------------------------------------- P2 mapping

/**
 * The census-to-corpus mapping (analysis/SPEC.md §P2). The corpus spec reports a plugin that is not enabled, or is
 * withdrawn, as `excluded`; the kernel never loads such a plugin (or has unloaded it), so it is ABSENT from the census.
 * absent <=> excluded, explicitly: every registered name gets a status, `excluded` when the census does not list it.
 */
export function censusMap(census, registry) {
  const listed = new Map(census.map(r => [r.name, r.status]));
  for (const name of listed.keys()) if (!registry.includes(name)) throw new Error(`census lists ${name}, which the config does not register`);
  return Object.fromEntries(registry.map(n => [n, listed.has(n) ? listed.get(n) : 'excluded']));
}

/** Per config: the worst plugin outcome of the kernel's map against the spec's `expected`. */
export function classifyKernel(expected, kernelMap) {
  let worst = 'correct';
  const rank = { correct: 0, mislabelled: 1, 'false-inactive': 2, 'silent-inert': 3 };
  for (const [name, e] of Object.entries(expected)) {
    const k = kernelMap[name];
    const out = k === e ? 'correct' : k === 'active' ? 'silent-inert' : e === 'active' ? 'false-inactive' : 'mislabelled';
    if (rank[out] > rank[worst]) worst = out;
  }
  return worst;
}

/** The real-filter baseline row (baseline/outputs.json) as a P2 outcome. */
export function classifyBaseline(row) {
  const b = row.baseline;
  if (row.label === 'clean') return b.signalled ? 'false-inactive' : 'correct';
  if (b.signalled) return 'correct';
  if (b.silentInert.length) return 'silent-inert';
  if (b.silentDropped.length) return 'silent-dropped';
  return 'correct';
}

/** P2 rows from the corpus configs, the kernel's end-of-schedule census per config, and the baseline outputs. */
export function p2Rows({ configs, kernelCensus, baseline }) {
  const base = new Map(baseline.map(r => [r.id, r]));
  return configs.map(c => {
    const census = kernelCensus[c.id];
    if (!census) throw new Error(`no kernel census for ${c.id}`);
    const b = base.get(c.id);
    if (!b) throw new Error(`no baseline row for ${c.id}`);
    return { config: c.id, faulty: c.label === 'faulty', kernel: classifyKernel(c.expected, censusMap(census, c.registry.map(p => p.name))), baseline: classifyBaseline(b) };
  });
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round6 = x => (x === null ? null : Number(x.toFixed(6)));

export function validity(gates) {
  const g = [
    { id: 'k1-teeth', pass: gates.k1?.of === 12 && gates.k1.detected >= K1_MIN, detail: `K1 detected ${gates.k1?.detected ?? '?'}/${gates.k1?.of ?? '?'} (needs >= ${K1_MIN}/12)` },
    { id: 'r0-rerun', pass: gates.r0Rerun?.sampled > 0 && gates.r0Rerun.identical === gates.r0Rerun.sampled, detail: `seeded R0 re-run: ${gates.r0Rerun?.identical ?? '?'}/${gates.r0Rerun?.sampled ?? '?'} byte-identical` },
    { id: 'r0-restart', pass: gates.r0Restart?.identical === true, detail: 'R0 self-equivalent across a restart' },
    { id: 'pins', pass: gates.pins?.verified === true && gates.pins.kernelShaInPrereg === true, detail: 'pins verified and the kernel sha in the prereg file map' },
    { id: 'leases', pass: gates.leases?.blocks > 0 && gates.leases.held === gates.leases.blocks, detail: `${gates.leases?.held ?? '?'}/${gates.leases?.blocks ?? '?'} measured blocks held a window lease` },
  ];
  return { gates: g, informative: g.every(x => x.pass) };
}

export function analyse({ trials = [], p2 = [], gates = {}, timings = [] }) {
  const v = validity(gates);
  const gate = verdict => (v.informative ? verdict : 'uninformative');

  const h1 = trials.filter(t => t.arm === 'H1');
  const divergent = h1.filter(t => t.divergences.length > 0).length;
  const P1 = {
    n: h1.length, divergentTrials: divergent, wilsonUpper95: round6(wilsonUpper(divergent, h1.length)),
    verdict: gate(divergent > 0 ? 'refuted' : h1.length >= P1_MIN_N ? 'supported' : 'underpowered'),
  };

  const count = (who, what) => p2.filter(r => r[who] === what).length;
  const kernelOk = r => r.kernel === 'correct', baseOk = r => r.baseline === 'correct';
  const P2 = {
    n: p2.length, faulty: p2.filter(r => r.faulty).length,
    kernel: { silentInert: count('kernel', 'silent-inert'), falseInactive: count('kernel', 'false-inactive') },
    kernelMislabelled: count('kernel', 'mislabelled'),
    baseline: { silentInert: count('baseline', 'silent-inert'), silentDropped: count('baseline', 'silent-dropped'), falseInactive: count('baseline', 'false-inactive') },
    mcnemar: mcnemar(p2.filter(r => kernelOk(r) && !baseOk(r)).length, p2.filter(r => !kernelOk(r) && baseOk(r)).length),
  };
  P2.verdict = gate(p2.length === 0 ? 'underpowered' : P2.kernel.silentInert + P2.kernel.falseInactive === 0 ? 'supported' : 'refuted');
  P2.kernelCorrect = p2.filter(kernelOk).length;
  P2.baselineCorrect = p2.filter(baseOk).length;

  const h2 = trials.filter(t => t.arm === 'H2');
  // S1 is residue only: probes that differ after an H2 trial's full teardown. H2's decision mismatches against R0 are
  // reported beside it and decide nothing (H2's registry has no cascade by design, so they are expected).
  const h2Residue = h2.filter(t => (t.residue ?? []).length > 0).length;
  const S1 = { n: h2.length, residueTrials: h2Residue, mismatchTrials: h2.filter(t => (t.mismatches ?? 0) > 0).length, share: h2.length ? round6(h2Residue / h2.length) : null, statement: h2.length === 0 ? 'no H2 trials' : h2Residue / h2.length >= 0.1 ? 'H2 leaves residue in >= 10% of trials' : 'H2 leaves residue in < 10% of trials' };
  const S2 = { k1Detected: gates.k1?.detected ?? null, k1Of: gates.k1?.of ?? null, k2ResidueProbes: gates.k2?.residueProbes ?? null };
  const kept = timings.filter(t => !t.breach);
  const S3 = {
    h1MedianReadyMs: median(kept.filter(t => t.arm === 'H1').map(t => t.readyMs)),
    r0MedianReadyMs: median(kept.filter(t => t.arm === 'R0').map(t => t.readyMs)),
    excludedBreachSamples: timings.length - kept.length,
  };
  return { validity: v, P1, P2, S1, S2, S3, decides: 'P1 and P2 only; S1-S3 decide nothing' };
}
