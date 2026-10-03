// EXP 009 (composable-harness) pre-registration, bundle 4 WO-01: experiments/composable-harness/preregistration.json.
// The authored text lives below. Every fact about committed files (sha256s, the corpus identity, the blind-author
// freeze, the baseline pins, the Wilson bound) is recomputed from them, so the record cannot drift from the harness it
// freezes. The format follows EXP 008's builder (scripts/latent-handoff-prereg.mjs): a draft may carry TO-FREEZE
// fields and names no not-before time; only a record with freeze.status "frozen" and no TO-FREEZE field is the
// pre-registration.
//
// Two kinds of TO-FREEZE:
//   - PRACTICE values, measured in the practice window run (memory tolerance, block size, per-trial wall time). They are
//     written into experiments/composable-harness/practice-freeze.json from that run's committed record; until then
//     they stay TO-FREEZE.
//   - REQUIRED files not yet committed (analyse.mjs and its test, harness.json, the probe observation set). Each
//     becomes its sha256 the moment it is tracked.
//
//   node scripts/composable-prereg.mjs --write   build the record from the files
//   node scripts/composable-prereg.mjs --pin     pin its sha256 in preregistration.sha256
//   node scripts/composable-prereg.mjs --check   validate; print its sha256 and the open TO-FREEZE fields
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const C = 'experiments/composable-harness';
export const recordPath = `${C}/preregistration.json`;
export const pinPath = `${C}/preregistration.sha256`;
export const publishedPath = 'site/data/composable-harness/preregistration.json';
export const practiceFreezePath = `${C}/practice-freeze.json`;
export const TO_FREEZE = 'TO-FREEZE';
export const AUTHORED_ON = '2026-10-03';
export const KERNEL_WORDING = 'our kernel implementing Cordis semantics';
export const STATUS = { draft: 'Draft pre-registration — not yet frozen, not yet run', frozen: 'Pre-registered — not yet run' };
export const NOTE = {
  draft: 'A draft, shown before it is frozen. It changes only to fill its TO-FREEZE fields; it is then frozen, refuted and published, and only the frozen record binds the results.',
  frozen: 'Written, hashed and published before the counted run. Nothing in this record may change after publication; a later change is a new, dated amendment, refuted and published first, and it resets the not-before.',
};

// Files that must be in the file map before the record can freeze. Missing or untracked => TO-FREEZE.
export const REQUIRED = [
  'harness/kernel.mjs',
  `${C}/harness.json`,
  `${C}/analysis/analyse.mjs`,
  `${C}/analysis/SPEC.md`,
  'scripts/composable-harness-analyse.test.mjs',
  `${C}/arms/schedule.mjs`,
  `${C}/probes/observation-set.json`,
  `${C}/FREEZE.json`,
  `${C}/baseline/outputs.json`,
  `${C}/baseline/SOURCE.json`,
];
// Pinned by sha256: every tracked file under these roots, plus REQUIRED. Never this builder, the site renderer, the
// pre-refute lint, the record's own files or the narrative notes (results must be able to add pages without an
// amendment).
export const PIN_ROOTS = ['harness/', `${C}/`];
export const PIN_SCRIPTS = /^scripts\/(composable-(?!prereg|site)[a-z-]+|harness-[a-z-]+)\.test\.mjs$/;
export const NOT_PINNED = [
  'scripts/composable-prereg.mjs', 'scripts/composable-site.mjs', 'scripts/composable-prereg-lint.mjs',
  recordPath, pinPath, `${C}/NOTES.md`, practiceFreezePath,
];
// Paths the record may never pin: anything a counted run or its analysis writes.
export const OUTCOME_PATHS = /(^|\/)(runs|results|counted|outcomes?)(\/|\.|-)/;

// The three values that only the practice window run can measure.
export const PRACTICE_FIELDS = {
  mxMemoryToleranceGB: 'after unloading mlx.model, active MLX memory must return to its pre-load baseline within this many GB (outside-boundary probe, S2 and the unload check)',
  blockSize: 'trials per window-held block of the counted run',
  perTrialWallSeconds: 'p90 (nearest rank) wall time of one H1 trial plus its R0 references in the practice window run, used to size blocks against the 12 h max-wait',
};

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Upper bound of the 95% Wilson interval for x successes in n (z = 1.959964). */
export function wilsonUpper(x, n, z = 1.959964) {
  const p = x / n, z2 = z * z;
  return (p + z2 / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

const trackedFiles = root => execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

/** The file map: every pinned, tracked path → its sha256. It holds sha256s only, because the frozen-path census
 *  (harness/frozen-census.mjs) reads every preregistration's `files` as pins. A REQUIRED path not yet tracked goes to
 *  pendingFiles as TO-FREEZE instead. */
export function fileMaps(root = '.') {
  const tracked = new Set(trackedFiles(root));
  const present = f => tracked.has(f) && existsSync(join(root, f));
  const pinned = [...tracked].filter(f => (PIN_ROOTS.some(r => f.startsWith(r)) || PIN_SCRIPTS.test(f)) && !NOT_PINNED.includes(f));
  const paths = [...new Set([...pinned, ...REQUIRED])].sort();
  return {
    files: Object.fromEntries(paths.filter(present).map(f => [f, sha256(readFileSync(join(root, f)))])),
    pendingFiles: Object.fromEntries(paths.filter(f => !present(f)).map(f => [f, TO_FREEZE])),
  };
}

/** The corpus identity, computed by the harness's own corpus adapter (no labels are opened). */
export async function corpusIdentity(root = '.') {
  const { Kernel } = await import(join(process.cwd(), root, 'harness/kernel.mjs'));
  const { default: corpus } = await import(join(process.cwd(), root, 'harness/services/corpus.mjs'));
  const kernel = new Kernel();
  await kernel.load(corpus, { sets: ['exp005', 'exp008x'] });
  const svc = kernel.service('corpus');
  const identity = { n: svc.items.length, sets: { exp005: svc.items.filter(i => i.set === 'exp005').length, exp008x: svc.items.filter(i => i.set === 'exp008x').length }, sha256: svc.sha256 };
  await kernel.dispose();
  return identity;
}

/** The record, built from the files under `root`. */
export async function buildRecord(root = '.') {
  const read = file => readFileSync(join(root, file));
  const json = file => JSON.parse(read(file));
  const practice = existsSync(join(root, practiceFreezePath)) && trackedFiles(root).includes(practiceFreezePath) ? json(practiceFreezePath) : {};
  const pv = key => (practice.values && practice.values[key] !== undefined ? practice.values[key] : TO_FREEZE);
  const freeze = json(`${C}/FREEZE.json`);
  const fence = who => json(`${C}/fence/author-${who}.json`);
  const baselineSource = json(`${C}/baseline/SOURCE.json`), baselineSummary = json(`${C}/baseline/summary.json`);
  const corpus = await corpusIdentity(root);
  const P1_N = 400, P1_MIN_N = 381;
  const bound400 = wilsonUpper(0, P1_N), bound381 = wilsonUpper(0, P1_MIN_N);
  assert.ok(bound381 <= 0.01 && wilsonUpper(0, P1_MIN_N - 1) > 0.01, 'n = 381 is the smallest n whose 0-failure Wilson upper bound is ≤ 1%');

  const record = {
    schemaVersion: 1,
    kind: 'odin-rnd.preregistration',
    experiment: {
      id: 'EXP 009', slug: 'composable-harness', title: 'Unload leaves no trace',
      statusText: STATUS.draft, note: NOTE.draft, authoredOn: AUTHORED_ON,
      summary: 'Does hot load, unload and reconfigure of research components leave the harness indistinguishable from a fresh process, and does every unmet need show up as a named inactive component instead of silently doing nothing?',
      inspiredBy: 'arXiv 2608.25512',
    },
    freeze: {
      status: 'draft',
      rule: 'A draft may carry TO-FREEZE fields and names no not-before. Every TO-FREEZE field is filled from committed records (the practice window run for the three practice values; the committed file for every file-map entry) before the record is cut for publication; only a record with status "frozen" and no TO-FREEZE field is the pre-registration.',
      toFreeze: [],
    },
    question: {
      temporal: 'When components route every runtime mutation through ctx.effect, does hot load, unload and reconfigure leave the harness observationally equivalent to a fresh process with the same active set?',
      spatial: 'Does an unmet need always surface as `inactive: missing <key>`, and never as silent inertness?',
    },
    framing: `The kernel is ${KERNEL_WORDING}: a small subset, written here, that uses Cordis (github.com/cordiverse/cordis) as the semantic reference only. It is not a dependency, and nothing here claims Cordis's guarantees. The kernel is pinned by sha256 in the file map.`,
    components: [
      { name: 'lint', role: 'EXP 005\'s lint, as a component' },
      { name: 'grep', role: 'a pattern search service' },
      { name: 'mlx.model', role: 'a local model server child process: Llama-3.2-3B, swapped by reconfigure to Qwen3-1.7B; EXP 008\'s pinned weights, read only; its prefix cache is an internal effect' },
      { name: 'yesno-gate', role: 'EXP 008\'s readout at stratum S' },
      { name: 'memo-cache', role: 'decisions keyed by item sha256' },
      { name: 'spend-counter', role: 'a stub with no network access' },
    ],
    corpus: {
      sets: ['EXP 005 (60 items)', 'EXP 008-X (140 items)'],
      n: corpus.n, bySet: corpus.sets,
      sha256: corpus.sha256,
      identityRule: 'sha256 over the ordered "set\\tid\\tstateSha256\\n" lines, computed by harness/services/corpus.mjs, which asserts every item state by its committed sha256.',
      statement: 'The study measures equivalence, not accuracy: the runner never opens a labels file, and earlier exposure to these items cannot bias an equality.',
    },
    arms: [
      { id: 'R0', what: 'A fresh process per (active set, pin, item), cached: the reference.' },
      { id: 'H1', what: 'One long-lived kernel. Each trial runs 20 seeded operations (at least 25% of them reconfigures, including pin swaps) with 40 evaluations interleaved.' },
      { id: 'H2', what: 'The same component specs on a plain registry with hand-written register and unregister, written by a blind author (secondary).', freeze: { tree: freeze.h2, spec: freeze.specs['h2/SPEC.md'] } },
      { id: 'K1', what: 'H1 plus 12 pre-registered planted leaks (for example a raw setInterval, a listener outside ctx, a stale prefix cache after a pin swap, an MLX child that was never reified): the teeth.' },
      { id: 'K2', what: 'The K1 effects routed through reifying coeffects.' },
    ],
    schedule: {
      seedRule: 'seed = sha256 of the merge commit id of the odin-rnd pull request that publishes this record as frozen (the 40-character lower-case hex string, UTF-8). The seed is unknowable when the record is frozen.',
      trials: P1_N, opsPerTrial: 20, minReconfigureShare: 0.25, evaluationsPerTrial: 40,
      blockSize: pv('blockSize'), perTrialWallSeconds: pv('perTrialWallSeconds'),
      rule: 'Trials run in window-held blocks of blockSize, in seed order. A block that cannot start within the max-wait is retried; the trials themselves never change.',
    },
    primary: {
      P1: {
        claim: `H1 diverges from R0 in 0 of n = ${P1_N} trials.`,
        divergence: 'Any difference, after any operation, in a decision, in p to 6 decimal places, or in any inside-boundary snapshot field: the component registry and statuses, provided services, listeners, timers, memo keys and prefix-cache keys.',
        n: P1_N,
        wilsonUpper95AtZero: Number(bound400.toFixed(6)),
        minNForOnePercent: P1_MIN_N,
        refutedBy: 'Any single divergence.',
      },
      P2: {
        claim: 'On the blind-authored corpus of 120 configurations, the kernel\'s census shows 0 silent-inert components and 0 false-inactive components.',
        corpus: {
          configs: 120, faulty: 60, clean: 60, tree: freeze.corpus, spec: freeze.specs['corpus/SPEC.md'],
          authoring: `Written by a history-free agent from the spec alone; fence audit ${fence('a').verdict} (author A) and ${fence('b').verdict} (author B).`,
        },
        silentInert: 'A component the census reports active although, by the corpus construction, a need it has is unmet (or its provider was withdrawn).',
        falseInactive: 'A component the census reports inactive although, by construction, every need it has is met.',
        mapping: 'absent ⇔ excluded: the kernel never loads a plugin that is not enabled and unloads a withdrawn one, so either is absent from the census, which the corpus calls "excluded". Every other status compares one to one (analysis/SPEC.md §P2).',
        mislabelled: 'Any other mismatch (for example different missing keys) is counted and reported; it does not by itself refute the claim, which is about silent inertness.',
        refutedBy: 'Any silent-inert or false-inactive kernel configuration among the 120.',
        baseline: {
          what: 'odin-agent\'s real extension filter and its proven-core floor, run unchanged at pinned odin-suite commits. Only its outputs and the source sha256s are published; the source is private.',
          pins: Object.fromEntries(Object.entries(baselineSource.pins).map(([k, v]) => [k, { commit: v.commit, sha256: v.sha256 }])),
          atFreeze: { faultySignalled: baselineSummary.faultySignalled, cleanSignalled: baselineSummary.cleanSignalled, agreesWithSpecEnabledAtBoot: baselineSummary.filterAgreesWithSpecEnabledAtBoot },
          comparison: 'An exact two-sided McNemar test on kernel-correct against baseline-correct per configuration: the binomial test on the discordant pairs (b, c). Secondary; it decides nothing.',
        },
      },
    },
    p2Disclosure: {
      computedBeforeRegistration: true,
      statement: 'P2 has no seed and is deterministic, so its outcome was computable before this record. It was computed once, before registration: while validating the pipeline on the real corpus, the instrument author ran it a single time, with output to the terminal only and nothing committed.',
      seenOutcome: { kernelCorrect: 120, of: 120, silentInert: 0, falseInactive: 0, mcnemar: { b: 60, c: 0 } },
      weight: 'P2 is registered for the record. Its evidential weight rests on the blind authorship of the 120 configurations (written by a history-free agent from the corpus spec alone, fence audit above) and on the real, unmodified filter baseline, not on any claim about an unseen outcome.',
      predictive: 'Only P1 (seeded from the merge commit of this record) and the validity gates are predictive: they test outcomes that are unknown when this record is frozen.',
      source: `${C}/analysis/SPEC.md §P2 "Disclosure"`,
    },
    secondary: [
      { id: 'S1', statement: 'H2 leaves residue (any inside- or outside-boundary difference from R0) in at least 10% of trials.' },
      { id: 'S2', statement: 'The outside-boundary probes (active handles, child pids, open files, MLX active memory, the temp directory) catch K1\'s unreified leaks and show 0 in K2.' },
      { id: 'S3', statement: 'H1 and R0 time-to-ready. A block that recorded a memory-window breach has its S3 timings excluded and counted; nothing else is excluded for a breach.' },
    ],
    secondaryRule: 'Secondary results decide nothing; they are reported as they come out.',
    validityGates: [
      'K1 detects at least 11 of its 12 planted leaks.',
      'A seeded 10% re-run of R0 is byte-identical.',
      'R0 is self-equivalent across a process restart.',
      'pins.mjs --verify passes, and the kernel sha256 is in this record\'s file map.',
      'Every measured block held a memory-window lease (its sidecar is committed with the run).',
    ],
    validityRule: 'If any gate fails, the result is published as uninformative, never as a pass.',
    analysis: {
      file: `${C}/analysis/analyse.mjs`,
      spec: `${C}/analysis/SPEC.md`,
      tests: 'scripts/composable-harness-analyse.test.mjs',
      rule: 'The confirmatory analysis is the pinned analyse.mjs, frozen in this record with its synthetic-row tests. No analysis is added after freeze; a change to it is a dated amendment that resets the not-before.',
      definitions: [
        `P1: count trials with any divergence (definition above); report x of ${P1_N} and the 95% Wilson upper bound (z = 1.959964).`,
        'P2: per configuration, map the census onto every registered name (absent ⇔ excluded) and compare with the corpus "expected"; a configuration\'s outcome is its worst plugin outcome, silent-inert > false-inactive > mislabelled > correct (analysis/SPEC.md §P2).',
        'McNemar: kernel-correct against baseline-correct per configuration; exact two-sided binomial on the discordant pairs (b, c). The baseline row is correct when a clean configuration is not signalled and a faulty one is.',
        'S1: share of H2 trials with any residue. S2: per planted leak, detected in K1 and absent in K2. S3: median time-to-ready per arm, breach blocks excluded and counted.',
        'Gates: evaluated first; any failure makes the run uninformative before P1 or P2 is read.',
      ],
    },
    fences: [
      'Seed: sha256(prereg merge commit), as above.',
      'One counted run: iteration happens only on practice seeds. The counted run is single and append-only.',
      'Frozen here: the probe observation set, analyse.mjs and its synthetic-row tests (EXP 008\'s lesson: an analysis amendment resets the clock).',
      'Synthetic configurations only: no tenant names.',
      'Live arms only: no replay arms.',
      'No other experiment\'s files change: EXP 005–008 stay untouched, enforced by the frozen-path census test.',
    ],
    memoryWindow: {
      wrapper: 'mac-memory-window.sh run --label <block> --max-wait 12h -- <block command> (odin-labs)',
      opens: 'free memory ≥ 50% and load1 < 8 for 3 consecutive readings, 60 s apart',
      breach: 'free < 50% or load1 ≥ 12 during a block: recorded, never acted on',
      exclusive: 'one measured run holds the lease machine-wide',
      mxMemoryToleranceGB: pv('mxMemoryToleranceGB'),
    },
    spend: {
      rule: 'Inference is local and unpriced: its cost is recorded as unknown, with the reason local-unpriced, never as zero. Paid spend is refutes and lane overhead only, under the program cap.',
      programCapUsd: 150,
    },
    notBefore: 'No attempt of the counted run starts before 24 hours after the merge of the odin-rnd pull request that publishes this record as frozen. This covers every attempt: a restarted, resumed or re-queued block is an attempt and is held to the same time. The time is recorded after publication. Practice seeds do not wait for it.',
    limits: [
      `n = ${P1_N} supports "at most 1% of trials" (95% Wilson upper bound ${(bound400 * 100).toFixed(2)}% at zero divergences), not zero.`,
      'One kernel, one language, one Mac.',
      'Equivalence says nothing about accuracy.',
      'The P2 corpus is synthetic, written from a spec whose fault classes we chose; the real filter keeps exactly the spec-enabled set in all 120 configurations, which shows the spec models its enable rule, not that the classes are representative.',
      'The baseline filter has no notion of needs, so it is the no-census condition, not a competing census.',
      'P2\'s outcome was computed once before registration (see the P2 disclosure): P2 is registered for the record, its weight rests on the blind authorship and the real filter baseline, and only P1 and the validity gates are predictive.',
    ],
    practiceFields: PRACTICE_FIELDS,
    ...fileMaps(root),
  };
  record.freeze.toFreeze = toFreezePaths(record).filter(p => !p.startsWith('freeze.'));
  return record;
}

export function toFreezePaths(value, at = '') {
  if (value === TO_FREEZE) return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => toFreezePaths(v, `${at}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => toFreezePaths(v, at ? `${at}.${k}` : k));
  return [];
}

export const REQUIRED_KEYS = ['schemaVersion', 'kind', 'experiment', 'freeze', 'question', 'framing', 'components', 'corpus', 'arms', 'schedule', 'primary', 'p2Disclosure', 'secondary', 'secondaryRule', 'validityGates', 'validityRule', 'analysis', 'fences', 'memoryWindow', 'spend', 'notBefore', 'limits', 'practiceFields', 'files', 'pendingFiles'];

/** The P2 disclosure (orchestrator, binding): P2 was computable and computed once before registration; its weight
 *  rests on blind authorship and the real filter baseline; only P1 and the gates are predictive; P2 is never called a
 *  prediction. */
export function assertP2Disclosure(record) {
  const d = record.p2Disclosure;
  assert.ok(d && d.computedBeforeRegistration === true, 'the record discloses that P2 was computed before registration');
  assert.match(d.statement, /computable before this record/, 'disclosure (a): P2 was computable');
  assert.match(d.statement, /computed once, before registration/, 'disclosure (a): P2 was computed once, before registration');
  assert.match(d.weight, /registered for the record/, 'disclosure (b): P2 is registered for the record');
  assert.match(d.weight, /blind authorship/, 'disclosure (b): weight rests on blind authorship');
  assert.match(d.weight, /real, unmodified filter baseline/, 'disclosure (b): weight rests on the real filter baseline');
  assert.match(d.predictive, /^Only P1 .* and the validity gates are predictive/, 'disclosure (c): only P1 and the gates are predictive');
  assert.ok(record.limits.some(l => /computed once before registration/.test(l)), 'the limits carry the P2 disclosure');
  assert.ok(!/predict/i.test(JSON.stringify(record.primary.P2)), 'P2 is never called a prediction');
}

export function validateRecord(record, root = '.') {
  assert.deepEqual(Object.keys(record), REQUIRED_KEYS, 'the record carries exactly the required sections, in order');
  assert.ok(['draft', 'frozen'].includes(record.freeze.status));
  assert.equal(record.experiment.statusText, STATUS[record.freeze.status]);
  assert.equal(record.experiment.note, NOTE[record.freeze.status]);
  const open = toFreezePaths(record).filter(p => !p.startsWith('freeze.'));
  assert.deepEqual(record.freeze.toFreeze, open, 'freeze.toFreeze lists exactly the open fields');
  if (record.freeze.status === 'frozen') assert.deepEqual(open, [], 'a frozen record carries no TO-FREEZE field');
  assert.ok(record.framing.includes(KERNEL_WORDING), `the framing says "${KERNEL_WORDING}"`);
  assert.ok(!/\b20\d\d\b|\b\d{1,2}:\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(record.notBefore), 'the not-before is a rule here; its time is recorded after publication');
  assert.ok(/every attempt/.test(record.notBefore), 'the not-before covers every attempt');
  assertP2Disclosure(record);
  for (const f of [record.analysis.file, record.analysis.tests]) assert.ok(record.files[f] || record.pendingFiles[f], `${f} is in the file map or pending`);
  for (const [file, digest] of Object.entries(record.files)) assert.match(digest, /^[a-f0-9]{64}$/, `${file}: the file map holds sha256s only`);
  for (const f of Object.keys(record.files)) assert.ok(!OUTCOME_PATHS.test(f), `${f} is an outcome path and cannot be pinned`);
  for (const [file, digest] of Object.entries(record.files)) {
    assert.equal(sha256(readFileSync(join(root, file))), digest, `${file} differs from its pinned sha256`);
  }
  return record;
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;

/** The built record in a given freeze state: a frozen record differs from the build only by its status fields. */
export function asState(record, state) {
  if (state === 'frozen') assert.deepEqual(record.freeze.toFreeze, [], 'a record with open TO-FREEZE fields cannot be frozen');
  return { ...record, experiment: { ...record.experiment, statusText: STATUS[state], note: NOTE[state] }, freeze: { ...record.freeze, status: state } };
}

export async function checkRecord(root = '.') {
  const bytes = readFileSync(join(root, recordPath), 'utf8');
  const record = validateRecord(JSON.parse(bytes), root);
  const rebuilt = render(validateRecord(asState(await buildRecord(root), record.freeze.status), root));
  assert.equal(bytes, rebuilt, 'the committed record differs from the build');
  const digest = sha256(bytes);
  if (existsSync(join(root, pinPath))) assert.equal(readFileSync(join(root, pinPath), 'utf8').trim().split(/\s+/)[0], digest, 'preregistration.sha256 does not pin the committed record');
  return { record, sha256: digest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === '--write') {
    writeFileSync(recordPath, render(validateRecord(await buildRecord())));
  } else if (command === '--freeze') {
    writeFileSync(recordPath, render(validateRecord(asState(await buildRecord(), 'frozen'))));
  } else if (command === '--pin') {
    const { sha256: digest } = await checkRecord();
    writeFileSync(pinPath, `${digest}  preregistration.json\n`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/composable-prereg.mjs --check | --write | --freeze | --pin');
    process.exit(2);
  }
  const { record, sha256: digest } = await checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest} (${record.freeze.status}${record.freeze.toFreeze.length ? `, ${record.freeze.toFreeze.length} TO-FREEZE: ${record.freeze.toFreeze.join(', ')}` : ''})`);
}
