// EXP 008 (latent-handoff) pre-registration, bundle 4 WO-01: experiments/latent-handoff/preregistration.json.
// The authored text lives below; every fact about committed files (shas, counts, pins, the gate constants, the
// readout) is recomputed from them, so the record cannot drift from the harness it freezes. The validator refuses a
// record that differs from this build, a corpus that is not EXP 005's by sha, and a frozen record that still carries
// a TO-FREEZE field.
//
// A draft (freeze.status "draft") may carry TO-FREEZE fields: the mapper code, calibration and parity hashes that
// bundle 3 WO-05 has not committed yet. A draft names no not-before. Only a record with freeze.status "frozen" and no
// TO-FREEZE field may be published as the pre-registration.
//   node scripts/latent-handoff-prereg.mjs --write   build the record from the files (review it, then --pin)
//   node scripts/latent-handoff-prereg.mjs --pin     pin its sha256 in preregistration.sha256
//   node scripts/latent-handoff-prereg.mjs --check   validate; print its sha256
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS as HARNESS_ARMS } from '../experiments/latent-handoff/arms.mjs';
import { GATE } from '../experiments/latent-handoff/mem-gate.mjs';
import { PROTOCOL } from '../experiments/latent-handoff/timing.mjs';
import { CAP_USD, MIN_RESERVE_USD } from '../experiments/latent-handoff/spend8.mjs';
import { SCHEMA_ID as FFR_SCHEMA } from '../experiments/latent-handoff/ffr8.mjs';
import { CORPUS_X_SUMS_SHA256 } from '../experiments/latent-handoff/strata.mjs';
import { BAR as LOCK_BAR, decide as decideLock, PRACTICE as LOCK_PRACTICE } from '../experiments/latent-handoff/pair_lock.mjs';
import { loadTruth } from '../experiments/latent-handoff/score.mjs';

const L = 'experiments/latent-handoff', J = 'experiments/jev-gate';
export const recordPath = `${L}/preregistration.json`;
export const pinPath = `${L}/preregistration.sha256`;
export const publishedPath = 'site/data/latent-handoff/preregistration.json';
export const STATUS = { draft: 'Draft pre-registration — not yet frozen, not yet run', frozen: 'Pre-registered — not yet run' };
export const NOTE = {
  draft: 'A draft, shown before it is frozen. It changes only to fill its TO-FREEZE fields; it is then frozen, refuted and published, and only the frozen record binds the results.',
  frozen: 'Written, hashed and published before the counted run. Nothing in this record may change after publication; a later change is a new, dated amendment, refuted and published first, and it resets the not-before.',
};
// Items seen before this record: run in the counted run but excluded from every claim and gate.
export const EXPOSURES = [
  { ids: ['c001', 'c002', 'c003', 'c004', 'c005'], reason: 'run end to end in the harness smoke test (pair D1, strata S and L, arms A0, A1 and C1–C3) to check the plumbing, C1 against A0; their mapper readouts (A2a and A2b probabilities, unlabelled and unscored) were also viewed during port debugging; and c001 was run in the memory-footprint runs (D1 A2a and A2b; D1′ every arm), stratum L' },
  { ids: Array.from({ length: 15 }, (_, i) => `c${String(i + 6).padStart(3, '0')}`), reason: 'mapper readouts (A2a and A2b probabilities, unlabelled and unscored) viewed during port debugging, before freeze' },
  { ids: ['c029', 'c081', 'c097', 'c112', 'c144'], practice: false, reason: 'used as the C2 donors of c001–c005 in the harness smoke test (pair D1, strata S and L) and of c001 in the D1′ memory-footprint run (c081). C2 reads the receiver out on the donor\'s own context with the question, so a receiver readout (p(YES) and decision, unlabelled and unscored) on each of them was recorded before this record. The stratum S smoke rows were not committed; their donors follow from the 200-item strata manifest and are the same five' },
];
export const EXPOSED = EXPOSURES.flatMap(x => x.ids);
// c001–c020: the seen items that also form the pair-lock practice set
export const PRACTICE_SET = EXPOSURES.filter(x => x.practice !== false).flatMap(x => x.ids);
const idNum = id => Number(id.slice(1));
/** "c001–c005" for a contiguous run of ids, else the ids listed. */
export const span = ids => (ids.every((id, i) => i === 0 || idNum(id) === idNum(ids[i - 1]) + 1) ? `${ids[0]}–${ids.at(-1)}` : ids.join(', '));
const ITEM_ID = /\bc\d{3}\b/g;
/** Every item id in every committed file that records a run or measurement from before this record (evidence/,
 *  footprints, parity and mapper records). Fail-closed: any id there that is not an excluded (seen) item throws. */
export function preRecordItemIds(dir, files) {
  const found = new Map();
  for (const f of files) for (const id of readFileSync(join(dir, f), 'utf8').match(ITEM_ID) ?? []) found.set(id, [...(found.get(id) ?? []), f]);
  const unseen = [...found.keys()].filter(id => !EXPOSED.includes(id)).sort();
  assert.deepEqual(unseen, [], `pre-record files hold analysed items: ${unseen.map(id => `${id} (${[...new Set(found.get(id))].join(', ')})`).join('; ')}`);
  return [...found.keys()].sort();
}
export const TO_FREEZE = 'TO-FREEZE';
// The day the record was frozen (commit b5543ab, 2026-10-02T05:05Z); the published page is dated by it.
export const FROZEN_ON = '2026-10-02';
export const A2B_LABEL = 'our simplified reimplementation of HeteroFold (arXiv 2609.32259), closed-form fit, without its output-aware calibration stage';

// EXP 005 as published, asserted by sha256: a different corpus on disk is refused.
export const EXP005 = {
  corpusSums: { file: `${J}/corpus.sha256`, sha256: 'a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9' },
  inputs: { file: `${J}/inputs.json`, sha256: '6bfb2b8d52376cbd22c8a34f5f986fe67ad68a0c587da862ba6b56e77e966a34' },
  labels: { file: `${J}/labels.json`, sha256: '36af1422755e56af56f4af267411a4a8e6535d08e6fc9d7aa3734aa005e4412a' },
  rules: { file: `${J}/rules.txt`, sha256: '87186d652a7cf8a4c8e71966236c4fe6837c4bd22799fc49a15d437a083b2562' },
};

// Pinned by sha256: everything that makes, gates, counts or scores a run, and the inputs it reads. Never this
// builder, the site renderer or the record's own files (the results must be able to add pages without an amendment).
export const PINNED = [
  ...['README.md', 'models.json', 'pins.mjs', 'strata.mjs', 'count_tokens.py', 'strata-manifest.json', 'readout.json', 'runner.py', 'arms.mjs',
    'score.mjs', 'counter.py', 'mem-gate.mjs', 'timing.mjs', 'spend8.mjs', 'ffr8.mjs', 'lint-stdin.mjs',
    'vendor/ffr/ffr.v1.schema.json', 'vendor/ffr/ffr-model-family.json', 'vendor/ffr/validate.mjs', 'vendor/ffr/vendor.json',
    'distractor/lodash-4.17.21-head2500.js', 'distractor/LICENSE',
    'corpus-x/corpus-x.json', 'corpus-x/corpus-x.sha256', 'corpus-x/labels-x.json', 'corpus-x/baselines-x.mjs', 'corpus-x/overlap-x.mjs'].map(f => `${L}/${f}`),
  ...['lint.mjs', 'gate-question.json', 'baselines.json'].map(f => `${J}/${f}`),
];
export const NOT_PINNED = ['scripts/latent-handoff-prereg.mjs', 'scripts/latent-handoff-site.mjs', recordPath, pinPath, `${L}/horizon.json`, `${L}/horizon.sha256`];

// Bundle 3 WO-05 (the two public mappers, calibrated on the Mac) is still in progress. Its code is pinned here once
// it is committed under these names; its calibration and parity records are frozen by hand from its final commit.
// The mapper records frozen by hand from the harness's final commit: present => their values replace TO-FREEZE.
export const mapperFreezePath = `${L}/mapper-freeze.json`;
export const RERUN = { seed: 8008, count: 18, fallbackCount: 4, rule: 'the 18 analysed items with the smallest sha256("8008:" + item id), run again on the locked pair, every stratum and every arm' };
// Mapper code and records, pinned once committed. transfer() is Engine.transfer in runner.py (pinned above); its maths is kvmap.py.
export const MAPPER_CODE = ['kvmap.py', 'calibrate.py', 'parity.py', 'calib-sources.json', 'mapper_freeze.py', 'mapper-freeze.json', 'footprints.py', 'footprints.json', 'served.py',
  ...['D1', 'D1p'].flatMap(p => [`mappers-${p}.json`, `parity-${p}.json`, `evidence/bf16-decision-stability-${p}.json`])].map(f => `${L}/${f}`);
export const PAIRS_FROZEN = ['D1', 'D1p'];

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = (file, root) => {
  try { execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
};

/** The record, built from the files under `root`. */
export function buildRecord(root = '.') {
  const read = file => readFileSync(join(root, file));
  const json = file => JSON.parse(read(file));
  for (const [k, v] of Object.entries(EXP005)) assert.equal(sha256(read(v.file)), v.sha256, `${v.file} is not EXP 005's published ${k}`);
  assert.equal(sha256(read(`${L}/corpus-x/corpus-x.sha256`)), CORPUS_X_SUMS_SHA256, 'EXP 008-X sums differ from the sha strata.mjs asserts');
  const models = json(`${L}/models.json`), strata = json(`${L}/strata-manifest.json`), readout = json(`${L}/readout.json`);
  const labels5 = json(EXP005.labels.file), labelsX = json(`${L}/corpus-x/labels-x.json`), baselines5 = json(`${J}/baselines.json`);
  const count = (items, label) => items.filter(i => i.label === label).length;
  const items5 = labels5.items, itemsX = labelsX.items;
  const range = (xs, f) => [Math.min(...xs.map(f)), Math.max(...xs.map(f))];
  const tokens = s => range(strata.items.flatMap(i => Object.values(i.strata[s].tokens)), x => x);
  const padding = range(strata.items.flatMap(i => Object.values(i.strata.L.paddingShare)), x => x);
  const model = key => {
    const m = models.models[key];
    return { key, repo: m.repo, revision: m.revision, source: m.source.replace('founder-approved ', 'approved '), geometry: m.geometry, attentionLayers: m.attentionLayers, vocabSha256: m.vocab.sha256, chatTemplateSha256: m.convert.files['chat_template.jinja'], weightsGB: m.convert.weightsGB };
  };
  const pair = (id, extra) => ({ id, sender: model(models.pairs[id].sender), receiver: model(models.pairs[id].receiver), role: models.pairs[id].role, ...extra });
  const files = Object.fromEntries(PINNED.map(f => [f, sha256(read(f))]));
  const frozenMappers = existsSync(join(root, mapperFreezePath)) && tracked(mapperFreezePath, root) ? json(mapperFreezePath) : {};
  const analysedIds = [...items5, ...itemsX].map(i => i.id).filter(id => !EXPOSED.includes(id));
  const analysed5 = analysedIds.filter(id => items5.some(i => i.id === id));
  const analysed5Seen = items5.map(i => i.id).filter(id => idNum(id) >= 21 && EXPOSED.includes(id));
  const analysedX = analysedIds.length - analysed5.length;
  const pick = ids => [...ids].sort((a, b) => sha256(`${RERUN.seed}:${a}`).localeCompare(sha256(`${RERUN.seed}:${b}`)));
  const rerunFallbackIds = pick(analysedIds.filter(id => items5.some(i => i.id === id))).slice(0, RERUN.fallbackCount).sort();
  const rerunIds = [...analysedIds].sort((a, b) => sha256(`${RERUN.seed}:${a}`).localeCompare(sha256(`${RERUN.seed}:${b}`))).slice(0, RERUN.count).sort();
  // mapper-freeze.json schema 2: one entry per pair; the parity definition and implementations must be the same for both.
  const fm = frozenMappers, fp = fm.pairs ?? {};
  if (fm.pairs) {
    assert.equal(fm.schemaVersion, 2, 'mapper-freeze.json schema 2 (per pair)');
    assert.deepEqual(Object.keys(fp), PAIRS_FROZEN, 'the freeze covers D1 and D1′');
    const bare = x => ({ ...x, contextsSha256: undefined });
    assert.deepEqual(bare(fp.D1p.parityDefinition), bare(fp.D1.parityDefinition), 'one parity definition for both pairs');
    assert.deepEqual(fp.D1p.parityDefinition.contextsSha256, fp.D1.parityDefinition.contextsSha256, 'the same held-out parity items for both pairs');
    assert.deepEqual(fp.D1p.implementations, fp.D1.implementations, 'the same implementations for both pairs');
    assert.equal(fp.D1p.calibration.textSha256, fp.D1.calibration.textSha256, 'the same calibration text for both pairs');
    assert.equal(sha256(read(`${L}/footprints.json`)), fm.footprintsSha256, 'footprints.json differs from the hash mapper-freeze.json binds');
    for (const p of PAIRS_FROZEN) for (const [k, f] of [['mapperRecordSha256', `mappers-${p}.json`], ['parityRecordSha256', `parity-${p}.json`], ['bf16DecisionStabilitySha256', `evidence/bf16-decision-stability-${p}.json`]])
      assert.equal(sha256(read(`${L}/${f}`)), fp[p][k], `${f} differs from the hash mapper-freeze.json binds`);
  }
  const pd = fp.D1?.parityDefinition;
  // Every committed row file from before this record: its hash is the one footprints.json binds, and every item in it
  // is an excluded (seen) item. The earlier D1 practice result is stated, with what an always-ACCEPT receiver would score.
  const footprintSources = Object.values(json(`${L}/footprints.json`).pairs).flatMap(v => Object.entries(v.sources ?? {}));
  const evidenceRows = footprintSources.map(([f, digest]) => {
    const path = `${L}/evidence/${f}`;
    assert.equal(sha256(read(path)), digest, `${path} differs from the hash footprints.json binds`);
    const rows = read(path).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
    const items = [...new Set(rows.map(r => r.itemId))].sort();
    const donors = [...new Set(rows.map(r => r.donor).filter(Boolean))].sort();
    for (const id of [...items, ...donors]) assert.ok(EXPOSED.includes(id), `${path} holds ${id}, which is not an excluded (seen) item`);
    return { file: path, sha256: digest, pairs: [...new Set(rows.map(r => r.pair))].sort(), arms: [...new Set(rows.map(r => r.arm))].sort(), strata: [...new Set(rows.map(r => r.stratum))].sort(), items, donors };
  });
  const evidenceDir = join(root, L, 'evidence');
  const preRecordFiles = [...readdirSync(evidenceDir).map(f => `evidence/${f}`), 'footprints.json', 'mapper-freeze.json', 'calib-sources.json', ...PAIRS_FROZEN.flatMap(p => [`parity-${p}.json`, `mappers-${p}.json`])].sort();
  preRecordItemIds(join(root, L), preRecordFiles);
  const truth5 = Object.fromEntries(items5.map(i => [i.id, i.label]));
  const practiceRows = read(`${L}/evidence/practice-d1-L-01.rows.jsonl`).toString('utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.arm === 'A0');
  const practiceCorrect = practiceRows.filter(r => (r.decision === 'REJECT') === (truth5[r.itemId] === 'RED')).length;
  const practiceDecisions = [...new Set(practiceRows.map(r => r.decision))];
  const answered = practiceDecisions.length === 1 ? `answered ${practiceDecisions[0]} on all ${practiceRows.length}` : `answered ${practiceRows.map(r => r.decision).join(', ')}`;
  // The lock, applied after the freeze to the committed lock-run rows: stated plainly; pair-lock.json carries the rows.
  const lockRowsPath = `${L}/evidence/pairlock-d1-L-01.rows.jsonl`;
  const lockResult = existsSync(join(root, lockRowsPath)) ? (() => {
    const d = decideLock(read(lockRowsPath).toString('utf8').trim().split('\n').map(l => JSON.parse(l)), loadTruth());
    return { decision: d.locked, correct: d.correct, of: d.of, abstentions: d.abstentions, rows: { file: lockRowsPath, sha256: sha256(read(lockRowsPath)) },
      statement: `Applied after this record was frozen: D1's A0 on stratum L got ${d.correct} of ${d.of} practice items (${LOCK_PRACTICE[0]}–${LOCK_PRACTICE.at(-1)}) right, with ${d.abstentions} abstentions, ${d.correct >= LOCK_BAR ? 'at or above' : 'below'} the bar of ${LOCK_BAR}, so ${d.locked === 'D1' ? 'D1 stays the counted pair' : 'D1′ (Qwen3-4B → Llama-3.1-8B) is the counted pair'}. The rows and the decision are in experiments/latent-handoff/pair-lock.json.` };
  })() : null;
  const earlierPractice = `An earlier 5-item D1 practice run (stratum L, an older render, ${practiceRows.map(r => r.itemId).join(', ')}) is not the lock test: its A0 ${answered} (${practiceCorrect} of ${practiceRows.length} correct).`;
  if (fm.code) for (const [f, digest] of Object.entries(fm.code)) assert.equal(sha256(read(`${L}/${f}`)), digest, `${f} differs from the hash mapper-freeze.json binds`);
  const bf16 = fm.pairs ? Object.fromEntries(PAIRS_FROZEN.map(p => [p, json(`${L}/evidence/bf16-decision-stability-${p}.json`)])) : null;
  const mapperCode = Object.fromEntries(MAPPER_CODE.map(f => [f, existsSync(join(root, f)) && tracked(f, root) ? sha256(read(f)) : TO_FREEZE]));
  const record = {
    schemaVersion: 1, kind: 'preregistration',
    experiment: {
      id: 'EXP 008', slug: 'latent-handoff', title: 'Hand over the cache, not the text', statusText: STATUS.draft, authoredOn: '2026-10-01',
      summary: 'Two small open-weight models from different families, with different tokenizers. The sender reads a change and the rules once; the receiver must make the EXP 005 gate decision from the sender\'s KV cache, mapped into its own, without a forward pass over that context. EXP 008 measures whether that matches text re-prefill closely enough, and fast enough, to be worth having, on public baselines only.',
      note: NOTE.draft,
    },
    freeze: {
      status: 'draft',
      rule: 'A draft may carry TO-FREEZE fields and names no not-before. Every TO-FREEZE field is filled from the harness\'s committed records before the record is cut for publication; only a record with status "frozen" and no TO-FREEZE field is the pre-registration.',
      toFreeze: [],
    },
    question: 'On the 60 EXP 005 changes and 140 new EXP 008-X changes, can a receiver model from another family, with another tokenizer, make the EXP 005 gate decision from a sender\'s mapped KV cache, with no forward pass over the context, nearly as accurately as text re-prefill, and faster once the mapping time is counted?',
    framing: 'A lab handoff the factory could adopt, not a measurement of the factory: no KV-compatible sender-receiver pair is deployed on the floor today. The local decoders the factory runs are hybrids (some layers attention, some recurrent or feed-forward only), and their non-attention state has no published mapping.',
    corpus: {
      exp005: {
        statement: 'Reused by sha256 assertion only: the builder refuses any other corpus, inputs, labels or rules on disk.',
        corpusSumsSha256: EXP005.corpusSums.sha256, inputsSha256: EXP005.inputs.sha256, labelsSha256: EXP005.labels.sha256, rulesSha256: EXP005.rules.sha256,
        items: items5.length, red: count(items5, 'RED'), green: count(items5, 'GREEN'), ids: `${items5[0].id}..${items5.at(-1).id}`,
      },
      exp008x: {
        statement: 'Authored to the EXP 005 family quotas, labelled by bce, with a blind second pass and an overlap fence against EXP 005; hashed before this record.',
        sumsFile: `${L}/corpus-x/corpus-x.sha256`, sumsSha256: CORPUS_X_SUMS_SHA256, labelsSha256: sha256(read(`${L}/corpus-x/labels-x.json`)),
        items: itemsX.length, red: count(itemsX, 'RED'), green: count(itemsX, 'GREEN'), ids: `${itemsX[0].id}..${itemsX.at(-1).id}`,
      },
      n: items5.length + itemsX.length,
      analysed: `Every claim and validity gate is computed on the ${analysedIds.length} items not seen before this record (${analysedX} of the ${itemsX.length} EXP 008-X items and ${analysed5.length} of EXP 005's c021–c060). ${[span(PRACTICE_SET), ...EXPOSURES.filter(x => x.practice === false).map(x => span(x.ids))].join(' and ')} were seen (see exposures and limits): they are run in the counted run but excluded from P1, S1–S3 and every gate, and reported separately.`,
      exposedItems: EXPOSED,
      exposures: EXPOSURES.map(x => ({ items: span(x.ids), reason: x.reason })),
      preRecordScan: { files: preRecordFiles.map(f => `${L}/${f}`), rule: 'Every item id in these committed files (rows, donors, parity and footprint records from before this record, and the post-record pair-lock rows) is an excluded (seen) item; the build refuses the record otherwise.' },
      exposureEvidence: evidenceRows,
      fallback: `If the refute of this record (or a dated amendment before the not-before) finds EXP 008-X invalid, by a label error or a leak through the overlap fence, the run uses the 60 EXP 005 items alone and is refute-only: a P1 that holds on the ${analysed5.length} analysed EXP 005 items (c021–c060 without ${analysed5Seen.join(', ')}) is reported as "not refuted", never as met.`,
    },
    strata: {
      manifest: { file: `${L}/strata-manifest.json`, sha256: files[`${L}/strata-manifest.json`] },
      layout: strata.layout,
      target: strata.target,
      tokensRange: { S: tokens('S'), M: tokens('M'), L: tokens('L') },
      primary: 'L',
      distractor: { file: strata.distractor.file, sha256: strata.distractor.sha256, source: strata.distractor.source, license: 'MIT', excerpt: strata.distractor.excerpt },
      paddingShareRange: padding,
      paddingDisclosure: `L is padding: each L context is M plus the first lines of a public, lint-clean library file, sized to 16K tokens. The padding is ${Math.round(padding[0] * 100)}–${Math.round(padding[1] * 100)}% of every L context. L tests the mechanism at length, not a real factory context of that size.`,
      lint: strata.lint,
    },
    pins: {
      file: `${L}/models.json`, sha256: files[`${L}/models.json`], toolchain: models.toolchain,
      rule: 'Every model is pinned by Hugging Face revision and by the sha256 of every source and converted (BF16, MLX) file; pins.mjs --verify recomputes every hash before a run.',
      vocabAssertion: 'Within every pair the sender and receiver vocabularies must differ (sha256 of the vocabulary): pins.mjs --verify throws otherwise, and its output is committed with the results of the counted run. A control pair that shares Llama-3 ids (SmolLM3-3B and Llama-3.2-3B) must make it throw.',
      mirrors: models.limits.map(x => x.replace('founder-approved ', '')),
    },
    pairs: {
      D1: pair('D1', { use: 'primary' }),
      D1p: pair('D1p', { use: 'pre-stated fallback; replaces D1 only by the pair-lock rule' }),
      D2: pair('D2', { use: 'reported only' }),
      D3: pair('D3', { use: 'reported only' }),
    },
    pairLock: 'After this record is frozen and before the not-before, A0 is measured for D1 on stratum L, with the frozen readout and the current render, on the practice set c001–c020 (seen items, excluded from every claim and gate). If D1\'s A0 gets fewer than 15 of the 20 right (accuracy below 0.75), D1′ (Qwen3-4B → Llama-3.1-8B) replaces D1, mechanically; otherwise D1 stays. The decision and its rows are written to pair-lock.json before the not-before. No other rule chooses the pair.',
    pairLockEarlierPractice: earlierPractice,
    ...(lockResult ? { pairLockResult: lockResult } : {}),
    hardware: {
      D1: 'One Apple-silicon Mac (128 GB unified memory), MLX, BF16. Every arm of a pair runs on the same machine, so the TTFT ratios are within-hardware.',
      D1p: 'The same Mac. No rented GPU is provisioned for EXP 008; if the Mac cannot run D1′, the run is reported as uninformative (pair lock failed), not run elsewhere.',
      footprints: (fp => ({ file: `${L}/footprints.json`, designBoundGB: GATE.maxFootprintGB,
        measured: Object.fromEntries(Object.entries(fp.pairs).map(([k, v]) => [k, { peakGB: v.peakGB, weightsGB: v.weightsGB, boundGB: v.boundGB ?? GATE.maxFootprintGB, armsMeasured: v.armsMeasured }])),
        statement: `Measured peak memory on practice items c001–c020 only (and their C2 donors), per pair: D1 ${fp.pairs.D1.peakGB} GB over ${fp.pairs.D1.armsMeasured.join(', ')}, under the ${fp.pairs.D1.boundGB ?? GATE.maxFootprintGB} GB design bound; D1′ ${fp.pairs.D1p.peakGB} GB over ${fp.pairs.D1p.armsMeasured.join(', ')}, so its bound was raised to ${fp.pairs.D1p.boundGB} GB on that measurement, before this record (24 GB would rule D1′ out by construction; ${fp.pairs.D1p.boundGB} GB is the most the gate admits consistently: at 50% free a 128 GB Mac has 64 GB available, and peak + 16 GB must fit).` }))(json(`${L}/footprints.json`)),
    },
    readout: {
      file: `${L}/readout.json`, sha256: files[`${L}/readout.json`],
      question: readout.question, answerInstruction: readout.answerInstruction, answers: [readout.yes, readout.no], rejectThreshold: readout.rejectThreshold,
      rule: 'The gate question in the receiver\'s own chat template. The decision is the softmax over the two single-token answers at the first assistant position: REJECT when p(YES) / (p(YES) + p(NO)) ≥ 0.5. No sampling. An out-of-memory error, or a probability that is not a number, is an abstention and counts as a wrong answer for its arm.',
      chatTemplates: Object.fromEntries(['llama-3.2-3b', 'llama-3.1-8b', 'qwen3-1.7b', 'gemma-3-1b'].map(k => [k, models.models[k].convert.files['chat_template.jinja']])),
      summaryPrompt: readout.summaryPrompt, summaryMaxTokens: readout.summaryMaxTokens, derangementSeed: readout.derangementSeed,
    },
    interface: {
      signature: 'transfer(senderCache, senderTokenOffsets, contextText) → receiverCache',
      rule: 'A transfer may read the context text to align tokens; it may not run any forward pass over the context. The zero-prefill counter wraps the receiver: in a KV arm the receiver forwards exactly the suffix (the question and the chat-template tail) and nothing else, or the run fails.',
    },
    arms: [
      { id: 'A0', kind: 'text', what: HARNESS_ARMS.A0.what },
      { id: 'A1', kind: 'text', what: HARNESS_ARMS.A1.what },
      { id: 'A2a', kind: 'kv', what: 'Char-boundary token alignment plus a per-layer ridge map from sender to receiver K and V. Our extension of arXiv 2608.03893, labelled as ours wherever it appears.' },
      { id: 'A2b', kind: 'kv', what: 'Procrustes alignment, our simplified reimplementation of HeteroFold (arXiv 2609.32259), closed-form fit, without its output-aware calibration stage. Built from the paper\'s description: the authors released no code, so no authors\' mappers were available at the freeze and none are used.' },
      { id: 'A3', kind: 'kv', what: 'Reserved: a slot for any further transfer method behind the same interface. No method is assigned to it, and this record makes no claim about one. Using it needs a dated amendment.' },
      { id: 'C1', kind: 'kv', what: HARNESS_ARMS.C1.what },
      { id: 'C2', kind: 'kv', what: HARNESS_ARMS.C2.what },
      { id: 'C3', kind: 'text', what: HARNESS_ARMS.C3.what },
      { id: 'B', kind: 'baseline', what: `EXP 005's model-free baselines, run unchanged: heuristic lint ${baselines5.baselines['heuristic-lint'].accuracy} and heuristic grep ${baselines5.baselines['heuristic-grep'].accuracy} accuracy on EXP 005's 60 items; on EXP 008-X by corpus-x/baselines-x.mjs.` },
    ],
    mappers: {
      label: 'A2a and A2b are our own implementations: A2a is our extension of one published method; A2b is our simplified reimplementation of HeteroFold (arXiv 2609.32259), closed-form fit, without its output-aware calibration stage. No authors\' mappers were available for either. A weak result from ours says nothing about the published methods themselves.',
      // mapper-freeze.json is hash-bound and keeps its own wording; the record states A2b with its full label.
      implementations: fp.D1 ? { ...fp.D1.implementations, A2b: `${A2B_LABEL[0].toUpperCase()}${A2B_LABEL.slice(1)}; built from the paper's description, the authors' repository had no released code, so no authors' mappers were available at freeze` } : TO_FREEZE,
      transfer: 'transfer() is Engine.transfer in runner.py; its maths is kvmap.py (an MLX port of a torch reference).',
      freezeRecord: fm.code ? { file: mapperFreezePath, sha256: sha256(read(mapperFreezePath)), producedBy: `${L}/mapper_freeze.py`, rule: 'mapper_freeze.py refuses to write it unless the binding parity gate passes on the pinned mapper weights.' } : TO_FREEZE,
      calibration: 'Calibration runs on the Mac (MLX, BF16) on public, MIT-licensed code text fetched by URL at pinned commits and checked by sha256, disjoint from EXP 005, EXP 008-X and the L distractor. No rented GPU (the pre-stated fallback when none is available); disclosed in limits.',
      code: mapperCode,
      calibrationTextSha256: fp.D1?.calibration.textSha256 ?? TO_FREEZE,
      calibrationWhere: fp.D1 ? `${fp.D1.calibration.where}; ${fp.D1.calibration.machine.chip}, ${fp.D1.calibration.machine.memoryGB} GB; ${fp.D1.calibration.receiverTokens} receiver tokens` : TO_FREEZE,
      pairs: fm.pairs ? Object.fromEntries(PAIRS_FROZEN.map(p => [p, { mapperRecordSha256: fp[p].mapperRecordSha256, mapperWeightsSha256: fp[p].mapperWeightsSha256, parityRecordSha256: fp[p].parityRecordSha256, parityBinding: fp[p].parityBinding, calibrationWallSeconds: fp[p].calibration.wallSeconds }])) : TO_FREEZE,
      parity: pd ? { items: `${pd.items[0]}–${pd.items.at(-1)}`, itemsAre: pd.contexts, mapping: pd.mapping, readout: pd.readout, pass: pd.pass, maxDp: pd.maxDp, rationale: pd.rationale } : TO_FREEZE,
      notes: [...(fm.notes ?? []), 'The shorter A2b labels in arms.mjs, calibrate.py, kvmap.py and mapper-freeze.json are hash-bound by the mapper freeze and stay as they are; the label above supersedes them.'],
      parityRule: 'Both pairs passed this gate before this record was frozen; whichever pair the pair lock chooses is read out with the mappers bound here.',
      weights: 'Mapper weights are hashed, not published (v1).',
    },
    primary: {
      P1: {
        on: 'arm A2b, stratum L, the locked pair (D1, or D1′ by the pair-lock rule)',
        criteria: [
          { id: 'agreement', statement: 'Decision agreement with A0, item by item over the analysed items, has a two-sided 95% Wilson score interval whose lower bound is ≥ 0.90. An item where either arm abstains counts as a disagreement; the denominator is every analysed item.' },
          { id: 'ttft', statement: 'The ratio median(A2b receiver TTFT, mapping time included) / median(A0 TTFT), over the items where both arms answered and neither is timing-unstable, has a 95% percentile-bootstrap interval (10,000 paired item resamples, seed 8008) whose upper bound is ≤ 0.5. The sender\'s own prefill is excluded (in a handoff the sender has already read the context for its own work) and reported separately. Timing follows the protocol below. The excluded items are counted and reported; if more than 10% of the analysed items are excluded, the TTFT criterion is uninformative.' },
        ],
        rule: 'P1 holds only if both criteria hold and every validity gate passes. Refuting P1 is the expected outcome, and it is published the same way.',
      },
    },
    secondary: [
      { id: 'S1', statement: 'On stratum S, neither A2a nor A2b reaches a 1.2× TTFT speed-up over A0 (median A0 TTFT / median arm TTFT, mapping included). Predicted to hold; it locates the crossover.' },
      { id: 'S2', statement: 'Round trip, on D1 and its reverse D2 only (A → B → A; not estimable if D1′ is locked, since its reverse is not pinned): decision agreement with A0 after the round trip is below the product of the two one-hop agreements.' },
      { id: 'S3', statement: 'An intrinsic signal (next-token KL, cycle-consistency error or attention-output cosine) predicts disagreement with A0 at AUROC ≥ 0.70 and beats KV cosine by ≥ 0.05. Recorded as "not estimable" if there are fewer than 15 disagreements.' },
    ],
    secondaryRule: 'Secondary claims are directional and decide nothing.',
    descriptive: [
      { id: 'R1', statement: bf16 ? `Decision stability under bf16 rounding, reported for A2a and A2b on the locked pair, never a gate. At run time the receiver computes in bf16, where near p = 0.5 one logit step moves p by about 0.03. On the held-out parity items, float32-level cache differences (largest key difference ${bf16.D1.heldOut.maxAbsDeltaKeys.toExponential(1)} on D1) left ${PAIRS_FROZEN.map(p => `${p === 'D1p' ? 'D1′' : p}: A2a ${bf16[p].heldOut.byMapper.A2a.agree}/${bf16[p].heldOut.byMapper.A2a.of}, A2b ${bf16[p].heldOut.byMapper.A2b.agree}/${bf16[p].heldOut.byMapper.A2b.of} decisions unchanged (max Δp ${bf16[p].heldOut.byMapper.A2a.maxDp.toFixed(3)} and ${bf16[p].heldOut.byMapper.A2b.maxDp.toFixed(3)})`).join('; ')}.${bf16.D1.attempt1 ? ` The larger cache differences of a superseded reduced-precision D1 port attempt (largest key difference ${bf16.D1.attempt1.maxAbsDeltaKeys.toFixed(3)}, read out on c001–c020) gave ${bf16.D1.attempt1.byMapper.A2a.agree}/${bf16.D1.attempt1.byMapper.A2a.of} (A2a) and ${bf16.D1.attempt1.byMapper.A2b.agree}/${bf16.D1.attempt1.byMapper.A2b.of} (A2b).` : ''} The counted run reports, per arm, how many decisions sit within 0.03 of the threshold.` : TO_FREEZE,
        evidence: bf16 ? PAIRS_FROZEN.map(p => ({ file: `${L}/evidence/bf16-decision-stability-${p}.json`, sha256: sha256(read(`${L}/evidence/bf16-decision-stability-${p}.json`)) })) : TO_FREEZE },
    ],
    validityGates: [
      'Global: A0 accuracy ≥ 0.75 on stratum L of the locked pair. Below it the receiver cannot do the gate, and the result is "small receivers cannot do this gate", not a test of transfer.',
      `Global: C1 matches A0, KL < ${readout.c1KlMax} on every item; a C1 abstention counts as a mismatch. Otherwise the run stops.`,
      'Global: zero prefill, the receiver\'s forwarded-token count equals the suffix length on every KV-arm item.',
      'Global: the seeded 10% re-run is byte-identical (see leakage fences).',
      'Per arm: MLX-vs-CPU-torch parity for that arm\'s ported mapper (above).',
      'Per arm: manipulation check, (arm accuracy − C2 accuracy) ≥ 0.15 on the stratum claimed, and |C2 − C3| ≤ 0.10 there.',
    ],
    analysis: 'score.mjs scores rows; the confirmatory analysis (the exclusions, Wilson interval, paired bootstrap, A2b-vs-A0 agreement, gates and the re-run comparison) is a script written after this record, before the not-before, that implements exactly the definitions here. It is added by a dated amendment that changes no other field, is refuted and published before any counted item runs, and resets the not-before.',
    validityRule: 'Failing a global gate makes every result uninformative; failing a per-arm gate makes that arm\'s results uninformative. P1 needs every global gate and A2b\'s per-arm gates. Uninformative is never a pass.',
    leakageFences: [
      'The runner reads only the contexts and the readout; an audit hook refuses any label, manifest, adjudication or second-pass file. score.mjs is the only step that reads labels.',
      'No calibration text shares a line with an EXP 005 or EXP 008-X base file or change (overlap-x.mjs --calibration).',
      'Iteration happens on practice items only. There is one counted run, append-only.',
      `A seeded 10% re-run: ${RERUN.rule} (${rerunIds.join(', ')}). Under the ${analysed5.length}-item fallback the set is the 4 analysed EXP 005 items picked the same way (${rerunFallbackIds.join(', ')}). Decisions and readout probabilities (to 6 decimals) must be byte-identical. Timings are excluded from byte identity and reported separately. A difference makes the run uninformative.`,
      'lint.mjs (EXP 005\'s) checks every context and every A1 summary; a summary that fails it is an abstention.',
    ],
    memoryGate: {
      constants: GATE,
      rule: 'Checked before every invocation and every item. It proceeds only when memory_pressure reports ≥ 50% free, available memory ≥ the practice peak + 16 GB, swap has not grown, no mlx_lm.server is resident, the 1-minute load is below the bound, and the pair footprint is within the bound. Otherwise it waits, backing off from 30 s to 10 min. It never stops or re-prioritises another process.',
    },
    timing: {
      protocol: PROTOCOL,
      rule: 'Per item, the arm order is a seeded random permutation; each arm gets 1 warm-up and 5 timed repetitions and reports the median. The gate is read before and after each item; an item whose readings drifted is re-queued at most twice, then marked timing-unstable. TTFT includes the mapping time.',
    },
    telemetry: { schema: FFR_SCHEMA, rule: 'Every arm row is also emitted as an ffr.v1 handoff event, validated against the vendored schema. Local compute is unpriced: its cost is recorded as unknown, with the reason local-unpriced, never as zero.' },
    spend: {
      capUsd: CAP_USD, minReserveUsd: MIN_RESERVE_USD,
      rule: 'Every paid call (a refute round, an API call, rented compute) is reserved before it is made; a reservation is refused when the committed total plus max(the largest call so far, $5, this call) would exceed $100. Never a $0 line; an unknown cost stays charged at its upper bound. Enforced in code (spend8.mjs).',
      stage1BudgetUsd: 40,
      stage1Split: 'Pre-registration refute $2, results refute $26, publication $2, and $10 held back that EXP 008 does not plan to spend: D1′ runs on the Mac or not at all.',
      local: 'The counted run is local and unpriced.',
    },
    notBefore: 'No counted item runs before 24 hours after the merge of the odin-rnd pull request that publishes this record as frozen. That time is recorded after publication; every counted item must start after it. Practice items do not wait for it.',
    limits: [
      'L is padding (see strata): it tests the mechanism at 16K tokens, not a real factory context of that size.',
      'The mapper calibration runs on one Mac, not on a rented GPU; the torch reference for the parity gate is CPU torch on the same machine.',
      'Llama-3.2-3B, Llama-3.1-8B and Gemma-3-1B come from public unsloth mirrors. Their byte-identity to the gated upstream weights cannot be verified (the upstream repositories mask their file hashes); only model.safetensors.index.json matches an upstream git object id.',
      `${items5.length + itemsX.length} items are run and ${analysedIds.length} analysed; ${analysed5.length} and refute-only if EXP 008-X is set aside (see corpus).`,
      'A lab handoff the factory could adopt: no KV-compatible pair is deployed on the factory floor today, so nothing here measures the factory itself.',
      'Two small models on authored changes and mechanical architecture rules; nothing here generalises to other tasks, larger models or other hardware.',
      'A2a is our extension of a published method and A2b is our simplified reimplementation of HeteroFold (arXiv 2609.32259), closed-form fit, without its output-aware calibration stage; no authors\' mappers were available. A weak A2a or A2b result is ours and does not show that the cited methods fail.',
      ...EXPOSURES.map(x => `${span(x.ids)} were seen before this record: ${x.reason}. They are excluded from every claim and gate (see corpus)${x.practice === false ? '' : ' and serve as the pair-lock practice set'}.`),
      'Under bf16 at run time, cache differences at the level of one rounding step can move p(YES) by about 0.03 near the threshold, enough to flip a borderline decision; this is reported as a descriptive property (R1), not hidden and not gated.',
      'The parity gate is judged in float32 (a float32 CPU readout of the MLX port against a float32 torch reference) because it tests the port, not the run-time precision; MLX\'s float32 GPU matmul runs at reduced precision, which made the first attempt fail at about 2e-3, and the port now uses a split-precision matmul, with a regression test.',
      'The timings come from one machine under whatever load the memory gate admits; they are recorded with the gate readings, and their ratios are within-hardware only.',
    ],
    files,
  };
  record.freeze.toFreeze = toFreezePaths(record);
  const state = record.freeze.toFreeze.length ? 'draft' : 'frozen';
  Object.assign(record.freeze, state === 'frozen' ? { status: state, frozenOn: FROZEN_ON } : { status: state });
  Object.assign(record.experiment, { statusText: STATUS[state], note: NOTE[state] });
  return record;
}

/** Every dotted path in the record whose value is exactly TO-FREEZE. */
export function toFreezePaths(value, at = '') {
  if (value === TO_FREEZE) return [at];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => toFreezePaths(v, at ? `${at}.${k}` : k));
  return [];
}

const hex = /^[a-f0-9]{64}$/;
export const localPath = /\/Users\/|\/home\/[a-z]|\/private\/var\/folders\/|(?<!\/private)\/var\/folders\/|\/opt\/homebrew\/|\/private\/tmp\/|(?<![\w.])\/tmp\/|~\/\./;
export const REQUIRED = ['experiment', 'freeze', 'question', 'framing', 'corpus', 'strata', 'pins', 'pairs', 'pairLock', 'hardware', 'readout', 'interface', 'arms', 'mappers', 'primary', 'secondary', 'validityGates', 'leakageFences', 'memoryGate', 'timing', 'spend', 'notBefore', 'limits', 'files'];

/** The invariants a record must hold, beyond being exactly the build of the files. */
export function validateRecord(record) {
  assert.equal(record.kind, 'preregistration');
  assert.equal(record.experiment.statusText, STATUS[record.freeze.status], 'the status text follows the freeze status');
  assert.equal(record.experiment.note, NOTE[record.freeze.status], 'the note follows the freeze status');
  assert.deepEqual(record.corpus.exposedItems, EXPOSED);
  for (const key of REQUIRED) assert.ok(record[key] !== undefined && record[key] !== null, `required field ${key} is missing`);
  assert.deepEqual(record.arms.map(a => a.id), ['A0', 'A1', 'A2a', 'A2b', 'A3', 'C1', 'C2', 'C3', 'B']);
  assert.deepEqual(Object.keys(record.primary), ['P1'], 'stage 1 has exactly one primary claim, P1');
  assert.deepEqual(record.secondary.map(s => s.id), ['S1', 'S2', 'S3']);
  assert.deepEqual(Object.keys(record.pairs), ['D1', 'D1p', 'D2', 'D3']);
  for (const p of Object.values(record.pairs)) assert.notEqual(p.sender.vocabSha256, p.receiver.vocabSha256, `${p.id}: the vocabularies must differ`);
  assert.equal(record.corpus.exp005.corpusSumsSha256, EXP005.corpusSums.sha256);
  assert.deepEqual([record.corpus.exp005.items, record.corpus.exp005.red, record.corpus.exp005.green], [60, 30, 30]);
  assert.deepEqual([record.corpus.exp008x.items, record.corpus.exp008x.red, record.corpus.exp008x.green], [140, 70, 70]);
  assert.equal(record.corpus.n, 200);
  assert.equal(record.spend.capUsd, 100);
  // A3 is a generic reserved slot: no method, no commitment to one.
  assert.ok(record.arms.find(a => a.id === 'A2b').what.includes(A2B_LABEL), 'A2b carries its full simplified-reimplementation label');
  assert.ok(record.limits.some(l => l.includes(A2B_LABEL)), 'the limits carry the A2b label');
  // every string in the record that names the method A2b reimplements carries the full label (case-insensitive start)
  const strings = x => (typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []);
  for (const t of strings(record).filter(t => /HeteroFold|2609\.32259/.test(t))) assert.ok(t.toLowerCase().includes(A2B_LABEL.toLowerCase()), `an A2b description without its full label: ${t.slice(0, 80)}`);
  const a3 = record.arms.find(a => a.id === 'A3');
  assert.match(a3.what, /^Reserved: /);
  assert.ok(!/sha256|[a-f0-9]{16}/i.test(a3.what), 'A3 carries no hash of anything');
  assert.ok(!/commitment|stage[ -]2|consent|camera-ready|unpublished|not-yet-public/i.test(JSON.stringify(record)), 'no stage-2, consent or private-document commitment anywhere in the record');
  // Draft vs frozen: a frozen record carries no TO-FREEZE field and states its not-before rule; a draft lists its own.
  const open = toFreezePaths(record);
  assert.deepEqual(record.freeze.toFreeze, open, 'freeze.toFreeze lists exactly the TO-FREEZE fields');
  assert.ok(['draft', 'frozen'].includes(record.freeze.status));
  if (record.freeze.status === 'frozen') assert.deepEqual(open, [], 'a frozen record carries no TO-FREEZE field');
  assert.ok(!/\b20\d\d\b|\b\d{1,2}:\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(record.notBefore), 'the not-before is a rule here; its time is recorded after publication');
  for (const [file, digest] of Object.entries({ ...record.files, ...Object.fromEntries(Object.entries(record.mappers.code).filter(([, d]) => d !== TO_FREEZE)) })) {
    assert.match(digest, hex, `${file}: not a sha256`);
    assert.ok(!NOT_PINNED.includes(file), `${file} is never pinned`);
  }
  const text = JSON.stringify(record);
  assert(!localPath.test(text), 'a local machine path in the pre-registration');
  assert(!/\d\.\d*(?:0{6,}|9{6,})\d/.test(text), 'a float artefact in the pre-registration');
  return record;
}

export function checkRecord(root = '.') {
  const read = file => readFileSync(join(root, file));
  const bytes = read(recordPath);
  const pinned = existsSync(join(root, pinPath)) ? read(pinPath).toString('utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${recordPath} differs from the sha256 pinned in ${pinPath}: review the change, then node scripts/latent-handoff-prereg.mjs --pin`);
  const record = validateRecord(JSON.parse(bytes));
  assert.deepEqual(record, buildRecord(root), `${recordPath} differs from its build: run node scripts/latent-handoff-prereg.mjs --write, review the diff, then --pin`);
  return { record, sha256: sha256(bytes), bytes };
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    writeFileSync(recordPath, render(validateRecord(buildRecord())));
    console.log(`Built ${recordPath} (sha256 ${sha256(readFileSync(recordPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateRecord(JSON.parse(readFileSync(recordPath, 'utf8')));
    writeFileSync(pinPath, `${sha256(readFileSync(recordPath))}  preregistration.json\n`);
    console.log(`Pinned ${recordPath} in ${pinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/latent-handoff-prereg.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { record, sha256: digest } = checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest} (${record.freeze.status}${record.freeze.toFreeze.length ? `, ${record.freeze.toFreeze.length} TO-FREEZE: ${record.freeze.toFreeze.join(', ')}` : ''})`);
}
