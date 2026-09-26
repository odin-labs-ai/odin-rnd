import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkRecord, criterionFields, derive, get, ninaAttribution, recordPath, required, validateRecord } from './jev-gate-prereg.mjs';
import { baselineValid, judgePaired, judgeSingleRate, newcombePaired, wilson } from '../experiments/jev-gate/metrics.mjs';

const committed = () => JSON.parse(readFileSync(recordPath, 'utf8'));
const unset = (record, path) => { const keys = path.split('.'), last = keys.pop(); delete keys.reduce((v, k) => v[k], record)[last]; };

test('the committed record validates and every hash in it equals the file on disk', () => {
  const { record, sha256 } = checkRecord();
  assert.match(sha256, /^[a-f0-9]{64}$/);
  assert.equal(record.corpus.corpusSha256, record.files['experiments/jev-gate/corpus.sha256']);
  assert.equal(record.corpus.inputsSha256, record.files['experiments/jev-gate/inputs.json']);
  assert.equal(record.rulesText, readFileSync('experiments/jev-gate/rules.txt', 'utf8'));
  assert.deepEqual(record.gateQuestion, JSON.parse(readFileSync('experiments/jev-gate/gate-question.json', 'utf8')));
  assert.equal(record.experiment.statusText, 'Pre-registered — not yet run');
});

test('the validator refuses a record missing any required field', () => {
  for (const path of Object.keys(required)) {
    const record = committed(); unset(record, path);
    assert.throws(() => validateRecord(record), new RegExp(path.replaceAll('.', '\\.')), `missing ${path} was accepted`);
  }
  for (const field of Object.keys(criterionFields)) for (const index of [0, 2]) {
    const record = committed(); delete record.criteria[index][field];
    assert.throws(() => validateRecord(record), /Criterion field/, `criterion ${index} without ${field} was accepted`);
  }
  const noCascade = committed(); noCascade.criteria = noCascade.criteria.filter(c => c.kind !== 'paired-difference');
  assert.throws(() => validateRecord(noCascade), /cascade criterion/);
  const unpinned = committed(); delete unpinned.files['experiments/jev-gate/labels.json'];
  assert.throws(() => validateRecord(unpinned), /does not pin/);
});

test('statements, attribution and pins must agree with the numbers they describe', () => {
  const wrongStatement = committed(); wrongStatement.criteria[0].threshold = wrongStatement.criteria[1].threshold;
  assert.throws(() => validateRecord(wrongStatement), /statement disagrees/);
  const wrongBaseline = committed(); wrongBaseline.baselineValidity.threshold = wrongBaseline.criteria[1].threshold;
  assert.throws(() => validateRecord(wrongBaseline), /Baseline statement/);
  const attribution = committed(); attribution.attribution.nina = attribution.attribution.nina.replace('permission', 'blessing');
  assert.throws(() => validateRecord(attribution), /founder wording/);
  assert.equal(committed().attribution.nina, ninaAttribution);
  const model = committed(); model.gates.reviewer.model = 'another-model';
  assert.throws(() => validateRecord(model), /Reviewer command/);
  const even = committed(); even.gates.reviewer.k += 1;
  assert.throws(() => validateRecord(even), /odd/);
  const recorded = committed(); recorded.experiment.note += ' Recorded experiment.';
  assert.throws(() => validateRecord(recorded), /recorded experiment/);
});

test('a changed hash, rules text or corpus file is refused, and --write re-derives it from disk', () => {
  const edited = committed(); edited.files['experiments/jev-gate/rules.txt'] = '0'.repeat(64);
  assert.notDeepEqual(derive(edited), edited);
  assert.deepEqual(derive(edited), committed(), 'Re-deriving restores the disk value');
  const rules = committed(); rules.rulesText += 'An extra rule.\n';
  assert.notDeepEqual(derive(rules), rules);
  const root = mkdtempSync(join(tmpdir(), 'jev-gate-prereg-'));
  const skip = source => !/(^|\/)(\.venv|node_modules|results)(\/|$)/.test(source);
  for (const d of ['experiments/jev-gate', 'experiments/laya-vs-jev']) cpSync(d, join(root, d), { recursive: true, filter: skip });
  assert.doesNotThrow(() => checkRecord(root));
  writeFileSync(join(root, 'experiments/jev-gate/corpus/c001.patch'), readFileSync('experiments/jev-gate/corpus/c001.patch', 'utf8') + ' ');
  assert.throws(() => checkRecord(root), /Corpus file changed: corpus\/c001\.patch/);
});

test('Wilson and Newcombe intervals match an independent hand computation', () => {
  const z = committed().statistics.z;
  const close = (actual, expected) => assert(Math.abs(actual - expected) < 5e-6, `${actual} != ${expected}`);
  for (const [x, n, lower, upper] of [[0, 10, 0, 0.277533], [3, 30, 0.0346, 0.256211], [30, 30, 0.886487, 1], [5, 30, 0.073365, 0.335644]]) {
    const w = wilson(x, n, z); close(w.lower, lower); close(w.upper, upper);
  }
  assert.equal(wilson(0, 0, z), null);
  // Newcombe (1998) example a=12 b=9 c=2 d=21, and three tables shaped like the experiment's.
  for (const [table, estimate, lower, upper] of [
    [{ a: 12, b: 9, c: 2, d: 21 }, 0.159091, 0.01821, 0.289157],
    [{ a: 2, b: 3, c: 1, d: 24 }, 0.066667, -0.075005, 0.218146],
    [{ a: 0, b: 0, c: 0, d: 30 }, 0, -0.113513, 0.113513],
    [{ a: 1, b: 0, c: 4, d: 25 }, -0.133333, -0.292885, -0.006215],
  ]) { const i = newcombePaired(table, z); close(i.estimate, estimate); close(i.lower, lower); close(i.upper, upper); }
});

test('verdicts take three states and read every threshold from the record', () => {
  const record = committed();
  const [missed, , cascade] = record.criteria;
  const [refuted, notEstablished, passes] = record.thresholdRule.states;
  assert.equal(judgeSingleRate(record, missed, 0, 30).state, notEstablished, '0 of 30: point passes, upper bound crosses');
  assert.equal(judgeSingleRate(record, missed, 30, 30).state, refuted);
  const lenient = structuredClone(record); lenient.criteria[0].threshold = 0.3;
  assert.equal(judgeSingleRate(lenient, lenient.criteria[0], 0, 30).state, passes, 'A changed record threshold changes the verdict');
  assert.equal(judgePaired(record, cascade, { a: 1, b: 2, c: 0, d: 27 }).state, refuted);
  assert.equal(judgePaired(record, cascade, { a: 0, b: 0, c: 0, d: 30 }).state, notEstablished);
  assert.equal(judgePaired(record, cascade, { a: 0, b: 0, c: 12, d: 18 }).state, passes);
  assert.equal(baselineValid(record, 0, 30), true);
  assert.equal(baselineValid(record, 30, 30), false);
});

// Threshold-bearing values of the record. None may appear as a literal in the EXP 005 code.
const thresholdValues = record => [
  ...record.criteria.map(c => c.threshold), record.decisionRules.decisionThreshold, record.cascade.confidenceThreshold,
  record.baselineValidity.threshold, record.statistics.confidenceLevel, record.statistics.z, record.gates.reviewer.hangStop.fraction,
  record.cost.jev.usdPerMillionInputTokens, record.spendCap.alreadySpentUsd,
].filter(v => !Number.isInteger(v));

test('no threshold is expressed anywhere in the code, only in the record', () => {
  const record = committed();
  const code = [
    ...readdirSync('scripts').filter(f => /^jev-gate-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs')).map(f => `scripts/${f}`),
    ...readdirSync('experiments/jev-gate').filter(f => f.endsWith('.mjs')).map(f => `experiments/jev-gate/${f}`),
    'scripts/station-render.mjs', 'scripts/station-contract.mjs', 'scripts/build.mjs',
  ];
  const forms = new Set();
  for (const value of thresholdValues(record)) {
    forms.add(String(value)); forms.add(value.toFixed(2)); forms.add(String(value).replace(/^0\./, '.'));
    forms.add(`${Math.round(value * 1000) / 10}%`); forms.add(`${Math.round(value * 1000) / 10} %`);
  }
  forms.add(`$${record.spendCap.usd}`);
  const states = source => [...forms].filter(form => new RegExp(`(?<![\\w.])${form.replace(/[.$%]/g, m => `\\${m}`)}(?![\\w.])`).test(source));
  assert.deepEqual(states(`if (confidence >= ${record.cascade.confidenceThreshold}) escalate(); // cap $${record.spendCap.usd}`).length, 2, 'The scan catches a planted threshold');
  assert.deepEqual(states("const version = '0.3.1';"), [], 'A version string is not a threshold');
  for (const file of code) assert.deepEqual(states(readFileSync(file, 'utf8')), [], `${file} states a threshold; read it from ${recordPath}`);
  assert.ok(forms.size > 0 && get(record, 'criteria.0.threshold') !== undefined);
});

test('baselines come from baselines.json, and their scripts are pinned by the hash on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'jev-gate-baselines-'));
  const skip = source => !/(^|\/)(\.venv|node_modules|results)(\/|$)/.test(source);
  for (const d of ['experiments/jev-gate', 'experiments/laya-vs-jev']) cpSync(d, join(root, d), { recursive: true, filter: skip });
  const script = 'scripts/jev-gate-heuristic-demo.mjs';
  cpSync('scripts/jev-gate-prereg.mjs', join(root, script));
  const sha = createHash('sha256').update(readFileSync(join(root, script))).digest('hex');
  writeFileSync(join(root, 'experiments/jev-gate/baselines.json'), JSON.stringify({ schemaVersion: 1, baselines: [{ id: 'demo', script, sha256: sha, results: { correct: 50, total: 60 } }] }));
  assert.throws(() => checkRecord(root), /differs from the files on disk/, 'A record without the recorded baselines is refused');
  const pinned = derive(committed(), root);
  assert.deepEqual(pinned.baselines.map(b => [b.id, b.sha256]), [['demo', sha]]);
  assert.equal(pinned.files[script], sha);
  assert.doesNotThrow(() => validateRecord(pinned));
  writeFileSync(join(root, script), 'changed');
  assert.throws(() => derive(committed(), root), /Baseline script changed/);
});
