// EXP 008 (latent-handoff) amendment 02: the dated record, experiments/latent-handoff/amendment-02.json, that fixes the
// runner's zero-prefill counter for the untimed reference A0, rebinds runner.py and the analysis script to their new
// hashes, moves the counted run to fresh run ids and voids the attempt made under the old runner. It names the
// pre-registration and amendment 01 by sha256; both stay byte-identical. Every clause it touches is quoted verbatim from
// the record (by its path) or from amendment 01, beside the change. The validator refuses a record that differs from
// this build, a quote that is not its source's text, a runner, script or tests that differ from the ones it binds, a void
// attempt on an analysed item, and a not-before that names a time (the time is fixed by the merge that publishes it).
//   node scripts/latent-handoff-amendment-02.mjs --write   build the record (review it, then --pin)
//   node scripts/latent-handoff-amendment-02.mjs --pin     pin its sha256 in amendment-02.sha256
//   node scripts/latent-handoff-amendment-02.mjs --check   validate; print its sha256
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMENDMENT, PREREG, PRIOR_AMENDMENTS, RUNNER_REBIND, SELF, runIds } from '../experiments/latent-handoff/analyse.mjs';
import { STAGE1_ARMS } from '../experiments/latent-handoff/arms.mjs';
import { at, checkAmendment, longDate, ORDER, PUBLISHED, testPath } from './latent-handoff-amendment.mjs';
import { checkRecord, localPath, REBOUND, sha256 } from './latent-handoff-prereg.mjs';

const L = 'experiments/latent-handoff';
export const amendment02Path = AMENDMENT.file;
export const amendment02PinPath = AMENDMENT.pin;
export const amendment02PublishedPath = 'site/data/latent-handoff/amendment-02.json';
export const runnerPath = `${L}/runner.py`;
export const runnerTestPath = `${L}/test_runner.py`;
export const runnerTestName = 'test_the_counter_does_not_carry_over_into_the_next_items_reference_a0';
export const DATE = '2026-10-09';
export const STATUS = `Amended ${longDate(DATE)}, before any analysed item has run`;
// Amendment 01 as published (odin-rnd #27, merge cf91fa3), hard-coded: a different one on disk is refused.
export const amendment01Sha256 = PRIOR_AMENDMENTS[0].sha256;
/** The attempt under the old runner, read from its rows (outside the repository): void, never analysed. */
export const VOID = Object.freeze({ runId: 'counted-d1p-L-01', rows: 133, items: Array.from({ length: 19 }, (_, i) => `c${String(i + 1).padStart(3, '0')}`), crashes: 9 });

// The clauses this amendment touches: [record path(s) and amendment 01 path(s) quoted verbatim, what changes].
export const CLAUSES = [
  { id: 'frozen', record: ['experiment.note'], amendment01: [], change: 'This is that amendment. runner.py is hash-bound by the record, so the one-line fix below is a dated change, refuted and published before any analysed item runs, and it resets the not-before.' },
  { id: 'zero-prefill', record: ['validityGates.2', 'interface.rule'], amendment01: [], change: 'The gate and its analysis (amendment 01, clause zero-prefill) are unchanged. The fix makes the runner\'s own run-time check, which stops a run on a violation, count the untimed reference A0\'s forward calls only, as every other arm already does.' },
  { id: 'one-run', record: ['leakageFences.2'], amendment01: ['clauses.1.implementation', 'run.statement'], change: `The counted run moves to the run ids ${ORDER.map(s => runIds('D1p').counted[s]).join(', ')} and the re-run to ${ORDER.map(s => runIds('D1p').rerun[s]).join(', ')}, so rows of two runner versions never share a run id. The analysis refuses every row of any other run id, the -01 ids included. Every other part of amendment 01's clause stands.` },
  { id: 'exclusions', record: ['corpus.analysed'], amendment01: [], change: `The void attempt (see void) covered ${VOID.items[0]}–${VOID.items.at(-1)} only, all of them seen items that this clause excludes from every claim and gate. No analysed item has run.` },
  { id: 'not-before', record: ['notBefore'], amendment01: ['notBefore'], change: 'The not-before moves to 24 hours after the merge of the odin-rnd pull request that publishes this amendment, replacing amendment 01\'s (see notBefore).' },
];

export function buildAmendment02(root = '.') {
  const read = f => readFileSync(join(root, f));
  const { record, sha256: preregSha } = checkRecord(root);
  assert.equal(preregSha, PREREG.sha256, 'the pre-registration is not the published record');
  const { record: a1, sha256: a1Sha } = checkAmendment(root);
  assert.equal(a1Sha, amendment01Sha256, 'amendment-01.json is not the published amendment 01');
  const rb = REBOUND[runnerPath];
  assert.equal(JSON.parse(read(`${L}/mapper-freeze.json`)).code['runner.py'], rb.published, 'mapper-freeze.json binds another runner.py');
  assert.deepEqual([RUNNER_REBIND.file, RUNNER_REBIND.from, RUNNER_REBIND.to], [runnerPath, rb.published, rb.rebound], 'analyse.mjs and the prereg builder rebind runner.py the same way');
  assert.equal(record.files[runnerPath], rb.published, 'the record binds another runner.py');
  assert.equal(sha256(read(runnerPath)), rb.rebound, 'runner.py is not the one this amendment rebinds');
  assert.deepEqual([a1.analysis.sha256, a1.analysis.tests.sha256], [PUBLISHED.analysis, PUBLISHED.tests]);
  const exposed = new Set(record.corpus.exposedItems);
  for (const id of VOID.items) assert.ok(exposed.has(id), `${id} is an analysed item: a void attempt on it would not be harmless`);
  assert.equal(VOID.rows, VOID.items.length * STAGE1_ARMS.length, 'one row per item and arm');
  const lock = JSON.parse(read(`${L}/pair-lock.json`));
  const fp = JSON.parse(read(`${L}/footprints.json`)).pairs[lock.decision];
  const ids = runIds(lock.decision), old = runIds(lock.decision, '01');
  const command = (id, s, items) => `node experiments/latent-handoff/arms.mjs --pair ${lock.decision} --stratum ${s} --items ${items} --run-id ${id} --peak-gb ${fp.peakGB}`;
  const quote = (src, path) => { const text = at(src, path); assert.equal(typeof text, 'string', `${path} is not a text field`); return { path, text }; };
  const analysisSha = sha256(read(SELF)), testsSha = sha256(read(testPath));
  const rebinds = [
    { file: runnerPath, boundBy: 'preregistration.json files and mapper-freeze.json code."runner.py"', from: rb.published, to: rb.rebound },
    { file: SELF, boundBy: 'amendment-01.json analysis.sha256', from: PUBLISHED.analysis, to: analysisSha },
    { file: testPath, boundBy: 'amendment-01.json analysis.tests.sha256', from: PUBLISHED.tests, to: testsSha },
  ];
  // The repository's frozen-path census reads a record's re-pins from `pins` ({ path: { from, to } }) and accepts one only
  // for a path an earlier record's files bind: the rebinds the analysis applies to record.files, selected the same way.
  const pins = Object.fromEntries(rebinds.filter(r => r.file in record.files).map(r => [r.file, { from: r.from, to: r.to }]));
  assert.deepEqual(Object.keys(pins), [runnerPath], 'of the record\'s files, only runner.py is re-pinned');
  return {
    schemaVersion: 1,
    kind: 'amendment',
    id: 'amendment-02',
    experiment: 'EXP 008',
    title: 'Amendment 02: the zero-prefill counter fix and a fresh counted run',
    parent: {
      file: 'preregistration.json',
      sha256: preregSha,
      published: 'odin-rnd #24, merged 2026-10-02T14:11:46Z (GitHub mergedAt). It stays byte-identical and is still served as published.',
    },
    priorAmendments: [{
      id: 'amendment-01', file: 'amendment-01.json', sha256: a1Sha,
      published: 'odin-rnd #27, merged 2026-10-07T09:18:47Z (GitHub mergedAt). It stays byte-identical. This amendment supersedes its run ids, its not-before and its binding of the analysis script and tests; every clause of its analysis stands.',
    }],
    date: DATE,
    statusText: STATUS,
    reason: {
      record: quote(record, 'experiment.note').text,
      bug: 'In the runner, every arm resets the receiver\'s forward counter before it runs, except one call: when an item\'s seeded arm order puts C1 before A0, the runner first computes A0 once, untimed, as C1\'s reference, and reset the counter only after that call. Its zero-prefill check then also counted the previous item\'s last arm, and stopped the run with a false zero-prefill violation. The model computation was unaffected (that call builds a fresh cache); only the count was stale. The first item after a process start has an empty counter, so it passed.',
      evidence: `The first counted attempt (${VOID.runId}) stopped ${VOID.crashes} times, each time at that reference A0. The excesses over the prompt were 24 tokens five times, 54 three times and 15811 once, and each equals the previous item's last arm: a KV arm's 24-token suffix, C3's 54-token prompt, or a whole A0 prompt (that stop read 31624 tokens against a 15813-token prompt, after an item that ended on A0).`,
    },
    changes: {
      fields: [],
      runner: {
        file: runnerPath,
        change: 'engine.receiver.reset() is called immediately before the untimed reference a0() in run_item (the existing reset after it is kept). Nothing else in the runner changes.',
        test: { file: runnerTestPath, sha256: sha256(read(runnerTestPath)), name: runnerTestName, statement: 'Item N ends on a text arm, so its forward calls stay in the counter; item N+1 puts C1 before A0. The reference A0 must be checked on its own calls only. It fails on the old runner (a zero-prefill violation on that A0) and passes on the fixed one.' },
      },
      runIds: { from: { counted: ORDER.map(s => old.counted[s]), rerun: ORDER.map(s => old.rerun[s]) }, to: { counted: ORDER.map(s => ids.counted[s]), rerun: ORDER.map(s => ids.rerun[s]) } },
      analysis: `analyse.mjs binds this amendment (its pin, the pre-registration as parent and amendment 01, by sha256, as the prior amendment), checks runner.py at the hash rebound below with every other file the record binds unchanged, reads the -02 run ids, and takes the not-before from this amendment's merge. Every statistical clause of amendment 01 is unchanged, byte for byte.`,
      statement: 'No field of the pre-registration or of amendment 01 is rewritten; both stay byte-identical. This amendment supersedes the bindings and run ids listed here.',
    },
    rebinds,
    pins,
    analysis: {
      file: SELF,
      sha256: analysisSha,
      tests: { file: testPath, sha256: testsSha },
      command: `node ${SELF} --counted <rows of ${ORDER.map(s => ids.counted[s]).join(', ')}> --rerun <rows of ${ORDER.map(s => ids.rerun[s]).join(', ')}> --amendment-merged-at <mergedAt of this amendment> --out <analysis.json>`,
    },
    clauses: CLAUSES.map(c => ({ id: c.id, record: c.record.map(p => quote(record, p)), amendment01: c.amendment01.map(p => quote(a1, p)), change: c.change })),
    run: {
      pair: lock.decision,
      arms: [...STAGE1_ARMS],
      strataOrder: ORDER,
      counted: ORDER.map(s => ({ stratum: s, runId: ids.counted[s], items: 'all 200 (c001–c200)', command: command(ids.counted[s], s, '<c001,…,c200>') })),
      rerun: ORDER.map(s => ({ stratum: s, runId: ids.rerun[s], items: 'the 18 re-run items of the record', command: command(ids.rerun[s], s, '<the 18 ids>') })),
      statement: 'As amendment 01\'s run, under the new run ids and the fixed runner: stratum by stratum in this order, then the re-run in the same order, each through arms.mjs (its timing protocol, seeded arm order and memory gate unchanged). A paused run is resumed under the same run id; nothing is ever re-run to change a result.',
    },
    void: {
      runId: VOID.runId,
      rows: VOID.rows,
      items: `${VOID.items[0]}–${VOID.items.at(-1)}`,
      statement: `The attempt ${VOID.runId} ran under the old runner and recorded ${VOID.rows} rows (${VOID.items.length} items × ${STAGE1_ARMS.length} arms), on ${VOID.items[0]}–${VOID.items.at(-1)} only: seen items, which corpus.analysed excludes from every claim and gate. It is void. Its rows are never scored and never analysed (the analysis refuses its run id), and no score or analysis of them exists; they were read only to diagnose the stops (the token counts above). Each stored row passed its own zero-prefill check after its own reset; the ${VOID.crashes} stops were false positives of the mechanism above. They are disclosed with it here and on the results page.`,
    },
    notBefore: 'No counted item runs before 24 hours after the merge of the odin-rnd pull request that publishes this amendment (its GitHub mergedAt). That time is recorded after publication. This replaces amendment 01\'s not-before, which it can only move later. If any item of the counted run or the re-run started earlier, the analysis fails its global gate not-before and the whole result is uninformative.',
    limits: [
      `The void attempt stopped ${VOID.crashes} times and was resumed after each stop under the same run id: the scheduler wrapper treated a stop with progress as a pause. A stop on an error now ends the run and is escalated, never resumed; that wrapper lives outside this repository and is not bound here. The attempt ended when the host restarted; no row of c020 or a later item exists.`,
      'Under the old runner an item with C1 before A0 could complete only as the first item after a process start, so the void attempt\'s items are not a random sample of arm orders. Under the fix every item resets the counter first, so this pattern cannot recur; the void rows enter nothing.',
      'The not-before time is an input to the script (the merge time). The script checks every item start against it; that the input is the true merge time is checked against GitHub by the results refute, not by the script.',
      'The regression test runs the real run_item on a fake engine, without any model.',
    ],
  };
}

export function validateAmendment02(a) {
  assert.equal(a.kind, 'amendment');
  assert.equal(a.id, 'amendment-02');
  assert.equal(a.statusText, STATUS);
  assert.equal(a.parent.sha256, PREREG.sha256);
  assert.deepEqual(a.priorAmendments.map(p => p.sha256), [amendment01Sha256]);
  assert.deepEqual(a.changes.fields, [], 'this amendment rewrites no field of the pre-registration');
  assert.ok(!/\b20\d\d\b|\b\d{1,2}:\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(a.notBefore), 'the not-before is a rule here; its time is recorded after publication');
  assert.deepEqual(a.clauses.map(c => c.id), CLAUSES.map(c => c.id));
  const runnerRebind = a.rebinds.find(r => r.file === runnerPath);
  assert.deepEqual([runnerRebind?.from, runnerRebind?.to], [RUNNER_REBIND.from, RUNNER_REBIND.to], 'the rebinding of runner.py is the one analyse.mjs applies');
  assert.deepEqual(a.pins, { [runnerPath]: { from: runnerRebind.from, to: runnerRebind.to } }, 'pins re-pins runner.py, and only it, exactly as rebinds does');
  assert.ok(a.analysis.command.includes('-02') && !a.analysis.command.includes('-01'), 'the analysis reads the -02 run ids only');
  const text = JSON.stringify(a);
  assert(!localPath.test(text), 'a local machine path in the amendment');
  assert(!/HeteroFold|2609\.32259|2608\.03893/.test(text), 'the amendment refers to the arms by id only');
  assert(!/A3/.test(text), 'the amendment makes no use of the reserved slot');
  assert(!/\d\.\d*(?:0{6,}|9{6,})\d/.test(text), 'a float artefact in the amendment');
  return a;
}

export function checkAmendment02(root = '.') {
  const bytes = readFileSync(join(root, amendment02Path));
  const pinned = existsSync(join(root, amendment02PinPath)) ? readFileSync(join(root, amendment02PinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${amendment02Path} differs from the sha256 pinned in ${amendment02PinPath}: review the change, then node scripts/latent-handoff-amendment-02.mjs --pin`);
  const record = validateAmendment02(JSON.parse(bytes));
  assert.deepEqual(record, buildAmendment02(root), `${amendment02Path} differs from its build: run node scripts/latent-handoff-amendment-02.mjs --write, review the diff, then --pin`);
  return { record, sha256: sha256(bytes), bytes };
}

export const render = record => `${JSON.stringify(record, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    writeFileSync(amendment02Path, render(validateAmendment02(buildAmendment02())));
    console.log(`Built ${amendment02Path} (sha256 ${sha256(readFileSync(amendment02Path))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateAmendment02(JSON.parse(readFileSync(amendment02Path, 'utf8')));
    writeFileSync(amendment02PinPath, `${sha256(readFileSync(amendment02Path))}  amendment-02.json\n`);
    console.log(`Pinned ${amendment02Path} in ${amendment02PinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/latent-handoff-amendment-02.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkAmendment02();
  console.log(`PASS ${amendment02Path} sha256 ${digest}`);
}
