// EXP 008 (latent-handoff) amendment 01: the dated record, experiments/latent-handoff/amendment-01.json, that adds the
// confirmatory analysis script the pre-registration's `analysis` field calls for. It names the pre-registration by
// sha256 and changes none of its fields; the pre-registration stays byte-identical and is still served as published.
// Every record clause the script implements is quoted verbatim from the pre-registration (by its path in the record),
// beside the implementation, so a reader can check one against the other. The validator refuses a record that differs
// from this build, a quote that is not the record's text, an analysis script that differs from the one it binds, and a
// not-before that names a time (the time is fixed by the merge that publishes this amendment).
//   node scripts/latent-handoff-amendment.mjs --write   build the record (review it, then --pin)
//   node scripts/latent-handoff-amendment.mjs --pin     pin its sha256 in amendment-01.sha256
//   node scripts/latent-handoff-amendment.mjs --check   validate; print its sha256
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BARS, BOOT, CLAIM_ARMS, DP, KV_ARMS, PREREG, SELF, STRATA, Z95, runIds } from '../experiments/latent-handoff/analyse.mjs';
import { STAGE1_ARMS } from '../experiments/latent-handoff/arms.mjs';
import { checkRecord, localPath, sha256 } from './latent-handoff-prereg.mjs';

const L = 'experiments/latent-handoff';
export const amendmentPath = `${L}/amendment-01.json`;
export const amendmentPinPath = `${L}/amendment-01.sha256`;
export const amendmentPublishedPath = 'site/data/latent-handoff/amendment-01.json';
export const testPath = 'scripts/latent-handoff-analysis.test.mjs';
export const DATE = '2026-10-02';
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longDate = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
export const STATUS = `Amended ${longDate(DATE)}, before any counted run`;
// The script and tests as amendment 01 published them. Amendment 02 rebinds both (and the run ids, -01 to -02), so this
// build reproduces amendment 01 from these hashes and its own run ids, not from the files now on disk.
export const PUBLISHED = Object.freeze({ analysis: 'bc7e0b560f7ac6b7a96c8b5e6528d9b5b0346102c98aaab0f1e68635b32fac2b', tests: '9858ef4358326822b313800534852692d22a15cc64872eda352b03baca794bab' });
/** The run order the amendment fixes: the primary stratum first, then M and S; the re-run after, in the same order. */
export const ORDER = ['L', 'M', 'S'];

/** A path into the record, e.g. "validityGates.0" or "primary.P1.criteria.1.statement". */
export const at = (record, path) => path.split('.').reduce((x, k) => (x === undefined ? x : x[k]), record);

// The clauses the script implements: [record path(s) quoted verbatim, how analyse.mjs implements them].
export const CLAUSES = [
  { id: 'exclusions', from: ['corpus.analysed', 'corpus.fallback'], implementation: `The analysed items are every labelled item (score.mjs's labels, ${200} items) minus corpus.exposedItems, asserted to be the record's count (175). Every claim, gate, secondary and descriptive figure is computed on them. The seen items are run and reported separately (seenItems: accuracy per stratum and arm), and enter nothing else. The 60-item fallback is not implemented: the pre-registration's refute did not trigger it, so it can now be triggered only by a dated amendment before the not-before, which would carry its own analysis of that run.` },
  { id: 'one-run', from: ['leakageFences.2'], implementation: `The counted run is exactly these run ids on the locked pair (read from pair-lock.json): ${Object.values(runIds('D1p', '01').counted).join(', ')}; the re-run is ${Object.values(runIds('D1p', '01').rerun).join(', ')}. Any row of another run id or pair is refused. Any row of another stratum, a duplicate attempt or a row for an item outside the run is refused too; a refusal stops the analysis (it is not a gate result), and its cause is disclosed and settled by a dated amendment before any result is read. The latest attempt counts per (item, arm); the driver re-queues whole items, so the arms of one item come from the same attempt. The run is analysed once, when it has finished or stopped; a paused run is resumed under the same run id first. Global gate complete: per stratum, the latest timing attempt of every (item, arm) exists for all 200 items × the ${STAGE1_ARMS.length} stage 1 arms (${STAGE1_ARMS.join(', ')}) in the counted run and for the re-run items in the re-run; an abstention is a row. A gap (for example, a run the runner stopped on a C1 mismatch) fails it, and then nothing else is computed: the result is uninformative.` },
  { id: 'not-before', from: ['notBefore'], implementation: 'The not-before is 24 hours after the GitHub mergedAt of the odin-rnd pull request that publishes this amendment, passed to the script as --amendment-merged-at. Every row of the counted run and of the re-run, of every timing attempt (a superseded attempt included), must have its item start (the memory-gate reading taken before the item, gate.ts) after it; otherwise the global gate not-before fails and the run is uninformative.' },
  { id: 'a0-accuracy', from: ['validityGates.0'], implementation: `A0 on stratum L, analysed items, scored by score.mjs (an abstention is a wrong answer): passes when 100 × correct ≥ ${BARS.a0MinPct} × n. When it fails, the result is reported with the record's own reading: small receivers cannot do this gate, not a test of transfer.` },
  { id: 'c1', from: ['validityGates.1'], implementation: 'score.mjs\'s C1 check on every stratum, analysed items: every C1 row must be answered, with klVsA0 < c1KlMax (0.001) and the same decision as A0 on that item; a C1 abstention is a failure. The gate passes only if all three strata pass.' },
  { id: 'zero-prefill', from: ['validityGates.2', 'interface.rule'], implementation: `For every answered row of a KV arm (${KV_ARMS.join(', ')}) on the analysed items, every stratum: the sum of the receiver's recorded forward calls (forwardCalls) equals suffixLen. Abstained rows have no forward count; they are counted and reported.` },
  { id: 'rerun', from: ['validityGates.3', 'leakageFences.3'], implementation: `The re-run set is recomputed (the analysed items with the smallest sha256("8008:" + id)) and must equal the record's list. For every stratum, item and arm of the re-run, the key (abstain, decision, pYes to ${DP} decimals, pYesBin to ${DP} decimals) must equal the counted run's, string for string. Timings are not compared. Any difference fails the gate.` },
  { id: 'parity', from: ['validityGates.4'], implementation: 'Per KV claim arm (A2a, A2b): the record\'s own parity result for the locked pair (mappers.pairs.<pair>.parityBinding.<arm>.pass) must be true. A1 is a text arm and has no ported mapper: not applicable.' },
  { id: 'manipulation', from: ['validityGates.5'], implementation: `Per claim arm (${CLAIM_ARMS.join(', ')}) and per stratum, on the analysed items: 100 × (correct(arm) − correct(C2)) ≥ ${BARS.manipulationMinPct} × n and 100 × |correct(C2) − correct(C3)| ≤ ${BARS.c2c3MaxPct} × n. P1 reads A2b on stratum L.` },
  { id: 'p1-agreement', from: ['primary.P1.criteria.0.statement'], implementation: `A2b and A0 on stratum L agree on an item when both answered and their decisions are equal; any abstention is a disagreement; n is every analysed item. The interval is the two-sided Wilson score interval with z = ${Z95}. The criterion holds when its lower bound ≥ ${BARS.agreementLower}.` },
  { id: 'p1-ttft', from: ['primary.P1.criteria.1.statement', 'timing.rule'], implementation: `TTFT is the row's ttftMs: the median of the 5 timed repetitions, which for A2b is the receiver side (the transfer plus the suffix, mapping included) and for A0 the whole prefill. Included items: analysed items where A0 and A2b both answered on stratum L and the item is not timing-unstable there (a timing-unstable line of the run names it). If 100 × excluded > ${BARS.ttftExcludedMaxPct} × n the criterion is uninformative. Ratio = median(A2b) / median(A0) over the included items. The bootstrap draws ${BOOT.resamples} resamples of the included items with replacement, each an index floor(u × m) used for both arms (paired), u from mulberry32 seeded with ${BOOT.seed}; the 95% interval is the sorted resampled ratios at 0-based positions ${BOOT.lowerIndex} and ${BOOT.upperIndex}. The criterion holds when the upper bound ≤ ${BARS.ttftUpper}. The sender's own prefill (senderMs) is reported separately as a median over the included items.` },
  { id: 'p1-verdict', from: ['primary.P1.rule', 'validityRule'], implementation: 'In this order: any global gate failed → uninformative; an A2b per-arm gate failed on stratum L → uninformative; the agreement criterion failed, or the TTFT criterion was informative and failed → refuted; the TTFT criterion uninformative → uninformative; otherwise holds. When a gate makes the verdict uninformative, the two criteria are shown with their numbers but no holds value (not in force). Every other figure (S1, R1, the accuracy and timing tables) carries informative false when a global gate failed, or, for a claim arm (A1, A2a, A2b), when its per-arm gate on that stratum failed.' },
  { id: 's1', from: ['secondary.0.statement'], implementation: `On stratum S, per arm A2a and A2b: speed-up = median(A0 TTFT) / median(arm TTFT) over the analysed items both answered and not timing-unstable there. S1 holds when both speed-ups are below ${BARS.s1Speedup}. It is uninformative (no holds value) when any global gate fails or the per-arm gate of A2a or A2b on stratum S fails. Directional; it decides nothing.` },
  { id: 's2', from: ['secondary.1.statement'], implementation: 'The locked pair is D1′ (pair-lock.json), so S2 is reported as not estimable, as the record says.' },
  { id: 's3', from: ['secondary.2.statement'], implementation: `The frozen runner (runner.py, hash-bound) records none of the three intrinsic signals and no KV cosine for a mapper arm (for a mapper arm it records only the YES and NO log-probabilities, lpYes and lpNo, not a next-token distribution), so S3 is reported as not estimable, with the count of A2b-vs-A0 disagreements on stratum L (also not estimable below ${BARS.s3MinDisagreements}). This amendment changes no runner to add them.` },
  { id: 'r1', from: ['descriptive.0.statement'], implementation: `Per arm A2a and A2b, per stratum, analysed items: the number of answered rows with |pYesBin − 0.5| ≤ ${BARS.r1Band}, out of the answered rows, flagged informative only when every global gate and that arm's per-arm gate on that stratum pass. Never a gate.` },
];

export function buildAmendment(root = '.') {
  const read = f => readFileSync(join(root, f));
  const { record, sha256: preregSha } = checkRecord(root);
  assert.equal(preregSha, PREREG.sha256, 'the pre-registration is not the published record');
  const lock = JSON.parse(read(`${L}/pair-lock.json`));
  assert.equal(lock.record.sha256, preregSha, 'pair-lock.json describes another record');
  const fp = JSON.parse(read(`${L}/footprints.json`)).pairs[lock.decision];
  const ids = runIds(lock.decision, '01');
  const command = (id, s, items) => `node experiments/latent-handoff/arms.mjs --pair ${lock.decision} --stratum ${s} --items ${items} --run-id ${id} --peak-gb ${fp.peakGB}`;
  return {
    schemaVersion: 1,
    kind: 'amendment',
    id: 'amendment-01',
    experiment: 'EXP 008',
    title: 'Amendment 01: the confirmatory analysis script',
    parent: {
      file: 'preregistration.json',
      sha256: preregSha,
      published: 'odin-rnd #24, merged 2026-10-02T14:11:46Z (GitHub mergedAt). It stays byte-identical and is still served as published. This amendment adds the analysis script that its analysis field calls for and changes none of its fields.',
    },
    date: DATE,
    statusText: STATUS,
    reason: { record: record.analysis, statement: 'This is that amendment. No counted item has run: nothing of the counted run exists when it is written, and its tests use synthetic rows only.' },
    changes: { fields: [], statement: 'No field of the pre-registration changes. Its not-before is replaced by the later one below, as its analysis field requires.' },
    analysis: {
      file: SELF,
      sha256: PUBLISHED.analysis,
      tests: { file: testPath, sha256: PUBLISHED.tests },
      reads: 'the counted and re-run rows, the labels through score.mjs, the pre-registration, this amendment and pair-lock.json. Before it analyses anything it checks against its sha256 every file the pre-registration binds (its files and mapper code, the EXP 005 corpus sums, inputs, labels and rules, the EXP 008-X sums, the strata manifest, the pins, the readout, the pair-lock rows and the exposure and R1 evidence) and the script and tests this amendment binds',
      command: `node ${SELF} --counted <rows of ${ORDER.map(s => ids.counted[s]).join(', ')}> --rerun <rows of ${ORDER.map(s => ids.rerun[s]).join(', ')}> --amendment-merged-at <mergedAt> --out <analysis.json>`,
    },
    clauses: CLAUSES.map(c => ({ id: c.id, record: c.from.map(path => { const text = at(record, path); assert.equal(typeof text, 'string', `${path} is not a text field of the record`); return { path, text }; }), implementation: c.implementation })),
    run: {
      pair: lock.decision,
      arms: [...STAGE1_ARMS],
      strataOrder: ORDER,
      counted: ORDER.map(s => ({ stratum: s, runId: ids.counted[s], items: 'all 200 (c001–c200)', command: command(ids.counted[s], s, '<c001,…,c200>') })),
      rerun: ORDER.map(s => ({ stratum: s, runId: ids.rerun[s], items: 'the 18 re-run items of the record', command: command(ids.rerun[s], s, '<the 18 ids>') })),
      statement: `The counted run goes stratum by stratum in this order, then the re-run in the same order, each through arms.mjs (its timing protocol, seeded arm order and memory gate unchanged). --peak-gb is the measured ${lock.decision === 'D1p' ? 'D1′' : lock.decision} practice peak in footprints.json (${fp.peakGB} GB). A paused run is resumed under the same run id; nothing is ever re-run to change a result.`,
    },
    notBefore: 'No counted item runs before 24 hours after the merge of the odin-rnd pull request that publishes this amendment (its GitHub mergedAt). That time is recorded after publication. This replaces the pre-registration\'s not-before, which it can only move later. If any item of the counted run or the re-run started earlier, the analysis fails its global gate not-before and the whole result is uninformative.',
    limits: [
      'The not-before time is an input to the script (the merge time). The script checks every item start against it; that the input is the true merge time is checked against GitHub by the results refute, not by the script.',
      'S2 and S3 are not estimable in this run (see clauses s2 and s3). Neither was a primary claim.',
      'The 60-item fallback has no analysis here (see clause exclusions).',
      'The tests use synthetic rows on real item ids with invented decisions, probabilities and timings; no counted data existed when this was written.',
    ],
  };
}

export function validateAmendment(a) {
  assert.equal(a.kind, 'amendment');
  assert.equal(a.statusText, STATUS);
  assert.deepEqual(a.changes.fields, [], 'this amendment changes no field of the pre-registration');
  assert.ok(!/\b20\d\d\b|\b\d{1,2}:\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(a.notBefore), 'the not-before is a rule here; its time is recorded after publication');
  assert.deepEqual(a.clauses.map(c => c.id), CLAUSES.map(c => c.id));
  const text = JSON.stringify(a);
  assert(!localPath.test(text), 'a local machine path in the amendment');
  assert(!/HeteroFold|2609\.32259|2608\.03893/.test(text), 'the amendment refers to the arms by id only');
  assert(!/A3/.test(text), 'the amendment makes no use of the reserved slot');
  assert(!/\d\.\d*(?:0{6,}|9{6,})\d/.test(text), 'a float artefact in the amendment');
  return a;
}

export function checkAmendment(root = '.') {
  const bytes = readFileSync(join(root, amendmentPath));
  const pinned = existsSync(join(root, amendmentPinPath)) ? readFileSync(join(root, amendmentPinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${amendmentPath} differs from the sha256 pinned in ${amendmentPinPath}: review the change, then node scripts/latent-handoff-amendment.mjs --pin`);
  const record = validateAmendment(JSON.parse(bytes));
  assert.deepEqual(record, buildAmendment(root), `${amendmentPath} differs from its build: run node scripts/latent-handoff-amendment.mjs --write, review the diff, then --pin`);
  return { record, sha256: sha256(bytes), bytes };
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    writeFileSync(amendmentPath, render(validateAmendment(buildAmendment())));
    console.log(`Built ${amendmentPath} (sha256 ${sha256(readFileSync(amendmentPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateAmendment(JSON.parse(readFileSync(amendmentPath, 'utf8')));
    writeFileSync(amendmentPinPath, `${sha256(readFileSync(amendmentPath))}  amendment-01.json\n`);
    console.log(`Pinned ${amendmentPath} in ${amendmentPinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/latent-handoff-amendment.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkAmendment();
  console.log(`PASS ${amendmentPath} sha256 ${digest}`);
}
