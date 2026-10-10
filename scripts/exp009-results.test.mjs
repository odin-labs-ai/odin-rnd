import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { adapt, buildResults, check, DIVERGENCE_DIAGNOSES, expected, k1k2, leaseHeld, nearestRank, render, RESULTS_PATH } from './composable-results.mjs';

// EXP 009 bundle 5 WO-02: the results adapter. Synthetic rows only, except the last two tests, which recompute the
// committed results record from the committed raw records and byte-compare. The frozen analyse.mjs is called, never
// re-implemented here.

const SHA = 'a'.repeat(64);
const KERNEL = 'b'.repeat(64);
const RECORD = {
  experiment: { id: 'EXP 009', slug: 'composable-harness', title: 'Unload leaves no trace' },
  corpus: { n: 200, sha256: 'c'.repeat(64) },
  schedule: { perTrialWallSeconds: 199 },
  primary: { P1: { claim: 'p1 claim', refutedBy: 'p1 rule' }, P2: { claim: 'p2 claim', refutedBy: 'p2 rule' } },
  p2Disclosure: { statement: 'seen once.', predictive: 'only P1.', seenOutcome: { kernelCorrect: 1, of: 1, mcnemar: { b: 0, c: 0 } } },
  memoryWindow: { breach: 'free < 50%' },
  validityRule: 'uninformative rule',
  analysis: { file: 'experiments/composable-harness/analysis/analyse.mjs' },
  files: { 'harness/kernel.mjs': KERNEL, 'experiments/composable-harness/analysis/analyse.mjs': 'd'.repeat(64) },
  limits: ['limit one', 'limit two'],
};
const CONFIG = { id: 'syn-1', label: 'clean', registry: [{ name: 'core-01' }], expected: { 'core-01': 'active' } };
const BASELINE = [{ id: 'syn-1', label: 'clean', baseline: { signalled: false, silentInert: [], silentDropped: [] } }];
const ctx = { record: RECORD, recordSha256: SHA, kernelSha256: KERNEL, configs: [CONFIG], baseline: BASELINE, rawFiles: [] };

const LEAKS = Array.from({ length: 12 }, (_, i) => `leak-${String(i).padStart(2, '0')}`);
/** One complete block (or a crashed one with complete: false), rows as scripts/composable-counted.mjs writes them. */
function block(b, { complete = true, attempt = 0, divergent = [], residue = [], kMiss = [], rerunIdentical = true, restartIdentical = true, label, close = { exitCode: 0 }, pinsVerified = true } = {}) {
  const attemptId = `b${String(b).padStart(2, '0')}-a${attempt}`;
  const runId = `run-${b}-${attempt}`;
  const startedAt = new Date(Date.UTC(2026, 9, 8, 13, b, 10)).toISOString();
  const row = x => ({ block: b, attemptId, ...x });
  const trials = [0, 1].map(i => b * 2 + i);
  return {
    attempts: [row({ event: 'start', startedAt, lease: { runId, label: label ?? `exp009-counted-b${String(b).padStart(2, '0')}`, startedAt: new Date(Date.parse(startedAt) - 5000).toISOString() }, preflight: { recordSha256: SHA, pinsVerified } }), ...(complete ? [row({ event: 'complete' })] : [row({ event: 'error', message: 'boom' })])],
    h1: trials.map(t => row({ arm: 'H1', trial: t, divergences: divergent.includes(t) ? [{ step: 1, kind: 'decision' }] : [], wallMs: 1000 * (t + 1) })),
    h2: trials.map(t => row({ arm: 'H2', trial: t, residue: residue.includes(t) ? ['outside.tmp'] : [], mismatches: 1, errors: [], divergences: [] })),
    prelude: b > 0 ? [row({ arm: 'H1-prelude', trial: `prelude-b${b}`, divergences: [] })] : [],
    k: LEAKS.map(leak => row({ leak, expected: 'x', k1Detected: !kMiss.includes(leak), k2Residue: [] })),
    rerun: [row({ key: `k${b}`, identical: rerunIdentical })],
    restart: [row({ key: `r${b}`, identical: restartIdentical })],
    memory: [], p2: b === 0 ? [row({ config: 'syn-1', boot: [], end: [{ name: 'core-01', status: 'active' }] })] : [], leases: [],
    sidecars: { [runId]: [{ ts: startedAt, kind: 'sample' }, ...(close ? [{ ts: new Date(Date.parse(startedAt) + 60000).toISOString(), kind: 'close', ...close }] : [])] },
  };
}
const merge = blocks => {
  const out = { sidecars: {} };
  for (const b of blocks) for (const [k, v] of Object.entries(b)) { if (k === 'sidecars') Object.assign(out.sidecars, v); else out[k] = [...(out[k] ?? []), ...v]; }
  return out;
};
const run = (...blocks) => buildResults(merge(blocks), ctx);
const gate = (r, id) => r.result.validity.gates.find(g => g.id === id).pass;

test('the adapter builds analyse()\'s documented input from synthetic rows', () => {
  const { input } = adapt(merge([block(0, { divergent: [1] }), block(1, { residue: [2] })]), ctx);
  assert.deepEqual(input.trials.filter(t => t.arm === 'H1').map(t => [t.trial, t.divergences.length]), [[0, 0], [1, 1], [2, 0], [3, 0]]);
  assert.deepEqual(input.trials.filter(t => t.arm === 'H2').map(t => [t.trial, t.residue.length, t.mismatches]), [[0, 0, 1], [1, 0, 1], [2, 1, 1], [3, 0, 1]]);
  assert.deepEqual(input.p2, [{ config: 'syn-1', faulty: false, kernel: 'correct', baseline: 'correct' }]);
  assert.deepEqual(input.gates, {
    k1: { detected: 12, of: 12 }, k2: { residueProbes: 0 }, r0Rerun: { sampled: 2, identical: 2 }, r0Restart: { identical: true },
    pins: { verified: true, kernelShaInPrereg: true }, leases: { blocks: 2, held: 2 },
  });
  assert.deepEqual(input.timings, [], 'S3 is not measured');
  const r = run(block(0, { divergent: [1] }), block(1, { residue: [2] }));
  assert.equal(r.result.P1.divergentTrials, 1);
  assert.equal(r.result.P1.verdict, 'refuted');
  assert.equal(r.result.S1.residueTrials, 1);
  assert.deepEqual(r.verdicts.P1, { claim: 'p1 claim', verdict: 'refuted', refutedBy: 'p1 rule' });
  assert.deepEqual(r.limits, RECORD.limits, 'the limits are the record\'s, verbatim');
  assert.deepEqual(r.p1Divergences, [{ block: 0, trial: 1, divergences: [{ step: 1, kind: 'decision' }] }]);
  assert.equal(r.result.S3.h1MedianReadyMs, null);
});

test('only rows of an attempt with an event:complete row count; a crashed attempt is kept on disk but excluded', () => {
  const crashed = block(1, { complete: false, divergent: [2, 3], residue: [2] });
  const retried = block(1, { attempt: 1 });
  const r = run(block(0), crashed, retried);
  assert.equal(r.result.P1.n, 4, 'the crashed attempt\'s two H1 trials are not counted');
  assert.equal(r.result.P1.divergentTrials, 0);
  assert.equal(r.result.S1.residueTrials, 0);
  assert.equal(gate(r, 'leases'), true);
  assert.match(r.disclosures.find(d => d.id === 'attempts').text, /3 started, 2 complete, 1 error/);
  // A block whose only attempt crashed contributes nothing at all.
  const only = adapt(merge([block(0), block(1, { complete: false })]), ctx);
  assert.equal(only.input.gates.leases.blocks, 1);
  assert.ok(only.kept.h1.every(t => t.block === 0));
});

test('any failing gate makes every primary verdict uninformative', () => {
  const ok = run(block(0), block(1));
  assert.equal(ok.result.validity.informative, true);
  assert.equal(ok.verdicts.P1.verdict, 'underpowered', 'n = 4 < 381');
  assert.equal(ok.verdicts.P2.verdict, 'supported');
  const failing = {
    'k1-teeth': [block(0, { kMiss: ['leak-00', 'leak-01'] }), block(1)],
    'r0-rerun': [block(0, { rerunIdentical: false }), block(1)],
    'r0-restart': [block(0), block(1, { restartIdentical: false })],
    pins: [block(0, { pinsVerified: false }), block(1)],
    'leases (no sidecar close)': [block(0, { close: null }), block(1)],
    'leases (wrong label)': [block(0, { label: 'exp009-counted-b07' }), block(1)],
    'leases (non-zero exit)': [block(0), block(1, { close: { exitCode: 1 } })],
  };
  for (const [name, blocks] of Object.entries(failing)) {
    const r = run(...blocks);
    assert.equal(r.result.validity.informative, false, `${name} fails a gate`);
    assert.equal(r.verdicts.P1.verdict, 'uninformative', `${name}: P1`);
    assert.equal(r.verdicts.P2.verdict, 'uninformative', `${name}: P2`);
    assert.equal(r.verdicts.informative, false);
  }
  // K1 is fail-closed across blocks: one block missing one leak still leaves 11 of 12, which passes.
  assert.equal(gate(run(block(0, { kMiss: ['leak-03'] }), block(1)), 'k1-teeth'), true);
  // A kernel sha that is not the record's fails the pins gate.
  assert.equal(adapt(merge([block(0)]), { ...ctx, kernelSha256: 'e'.repeat(64) }).input.gates.pins.kernelShaInPrereg, false);
  // A recorded preflight against another record fails it too.
  assert.equal(adapt(merge([block(0)]), { ...ctx, recordSha256: 'f'.repeat(64) }).input.gates.pins.verified, false);
});

test('the gate helpers: K1 per leak, the lease judged from its sidecar, nearest-rank p90', () => {
  const k = k1k2([{ leak: 'a', k1Detected: true, k2Residue: ['x'] }, { leak: 'a', k1Detected: false, k2Residue: [] }, { leak: 'b', k1Detected: true, k2Residue: [] }]);
  assert.deepEqual(k.k1, { detected: 1, of: 2 });
  assert.deepEqual(k.k2, { residueProbes: 1 });
  const b = block(3);
  assert.equal(leaseHeld(b.attempts[0], b.sidecars).held, true);
  assert.deepEqual(leaseHeld(b.attempts[0], {}).reasons.slice(0, 1), ['no committed sidecar']);
  const late = { ...b.attempts[0], startedAt: '2027-01-01T00:00:00.000Z' };
  assert.equal(leaseHeld(late, b.sidecars).held, false, 'an attempt that started outside its lease did not hold it');
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(nearestRank([5], 0.5), 5);
});

test('every divergent trial gets a divergence-diagnosis disclosure; the verdict is untouched', () => {
  const r = run(block(0, { divergent: [1] }), block(1));
  assert.equal(r.result.P1.divergentTrials, 1);
  const d = r.disclosures.filter(x => x.id === 'divergence-diagnosis');
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].block, d[0].trial], [0, 1]);
  assert.match(d[0].text, /not diagnosed\. The pre-registered verdict stands\./);
  assert.equal(run(block(0), block(1)).disclosures.filter(x => x.id === 'divergence-diagnosis').length, 0);
  assert.match(DIVERGENCE_DIAGNOSES['29/291'], /not a re-classification: the pre-registered verdict stands\./);
});

test('the build is deterministic: the same rows render the same bytes', () => {
  const rows = () => merge([block(0, { divergent: [0] }), block(1)]);
  assert.equal(render(buildResults(rows(), ctx)), render(buildResults(rows(), ctx)));
  const shuffled = rows();
  for (const k of ['h1', 'h2', 'k', 'attempts']) shuffled[k].reverse();
  assert.equal(render(buildResults(shuffled, ctx)), render(buildResults(rows(), ctx)), 'row order on disk does not change the record');
});

test('the committed results record recomputes byte for byte from the committed raw records', () => {
  const { results } = check();
  assert.equal(readFileSync(RESULTS_PATH, 'utf8'), expected());
  assert.equal(results.result.P1.n, 400);
  assert.equal(results.result.P2.n, 120);
  assert.equal(results.leases.length, 40);
  assert.ok(results.leases.every(l => l.held));
  assert.deepEqual(results.limits, JSON.parse(readFileSync('experiments/composable-harness/preregistration.json', 'utf8')).limits);
});

test('the CLI --check passes on the committed record and is stable across runs', () => {
  const a = spawnSync(process.execPath, ['scripts/composable-results.mjs', '--check'], { encoding: 'utf8' });
  const b = spawnSync(process.execPath, ['scripts/composable-results.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.match(a.stdout, /^PASS /);
});

test('the results page, data copy, home row and sitemap are current, and leave the pre-registration\'s byte-identical', async () => {
  const site = await import('./composable-results-site.mjs');
  const prereg = await import('./composable-site.mjs');
  const want = site.assertSiteCurrent();
  const page = want[site.notePath];
  assert.ok(page.includes(site.P2_LABEL));
  assert.ok(page.includes('our kernel implementing Cordis semantics'));
  assert.equal(readFileSync(site.publishedPath, 'utf8'), readFileSync(RESULTS_PATH, 'utf8'), 'the data copy is byte for byte');
  // Both pages' home and sitemap edits commute: re-applying either leaves the committed files unchanged.
  await prereg.assertSiteCurrent();
  const html = readFileSync('site/index.html', 'utf8'), xml = readFileSync('site/sitemap.xml', 'utf8');
  const record = JSON.parse(readFileSync('experiments/composable-harness/preregistration.json', 'utf8'));
  const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
  assert.equal(prereg.withHome(site.withHome(html, record, results), record), html);
  assert.equal(site.withSitemap(prereg.withSitemap(xml)), xml);
  assert.equal(html.indexOf(`href="journal/${site.noteSlug}.html"`) < html.indexOf(`href="journal/${prereg.noteSlug}.html"`), true, 'the results row sits above the pre-registration row');
  // A tampered raw record changes the manifest digest the page is bound to.
  const tampered = { ...results, raw: results.raw.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) };
  assert.notEqual(site.rawManifestSha256(tampered), site.RAW_MANIFEST_SHA256);
  assert.equal(site.rawManifestSha256(results), site.RAW_MANIFEST_SHA256);
});
