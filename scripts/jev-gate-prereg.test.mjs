import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkRecord, criterionFields, derive, get, ninaAttribution, recordPath, required, validateRecord } from './jev-gate-prereg.mjs';
import { baselineCounts, baselineValid, judgePaired, judgeSingleRate, newcombePaired, pickBestBaseline, wilson } from '../experiments/jev-gate/metrics.mjs';

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
  for (const d of ['experiments/jev-gate', 'experiments/laya-vs-jev', 'scripts']) cpSync(d, join(root, d), { recursive: true, filter: skip });
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

test('baselines come from baselines.json, with every script, the library and the scored files pinned from disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'jev-gate-baselines-'));
  const skip = source => !/(^|\/)(\.venv|node_modules|results)(\/|$)/.test(source);
  for (const d of ['experiments/jev-gate', 'experiments/laya-vs-jev', 'scripts']) cpSync(d, join(root, d), { recursive: true, filter: skip });
  const hash = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
  const lib = 'experiments/jev-gate/baselines.mjs', script = 'scripts/jev-gate-heuristic-demo.mjs';
  writeFileSync(join(root, lib), '// demo library\n'); cpSync('scripts/jev-gate-prereg.mjs', join(root, script));
  const labels = JSON.parse(readFileSync(join(root, 'experiments/jev-gate/labels.json'), 'utf8')).items;
  const red = labels.filter(i => i.label === 'RED').map(i => i.id), green = labels.filter(i => i.label === 'GREEN').map(i => i.id);
  const entry = (flipRed, flipGreen) => {
    const predictions = Object.fromEntries(labels.map(i => [i.id, i.label]));
    for (const id of [...red.slice(0, flipRed)]) predictions[id] = 'GREEN';
    for (const id of [...green.slice(0, flipGreen)]) predictions[id] = 'RED';
    return { script, scriptSha256: hash(script), libSha256: hash(lib), description: 'demo', scored: labels.length, correct: labels.length - flipRed - flipGreen, accuracy: 0, missedRed: red.slice(0, flipRed), falseReject: green.slice(0, flipGreen), predictions };
  };
  const write = baselines => writeFileSync(join(root, 'experiments/jev-gate/baselines.json'), JSON.stringify({ schemaVersion: 1, inputsSha256: hash('experiments/jev-gate/inputs.json'), labelsSha256: hash('experiments/jev-gate/labels.json'), baselines }));
  write({ 'heuristic-grep': entry(5, 13), 'heuristic-lint': entry(0, 1) });
  assert.throws(() => checkRecord(root), /differs from the files on disk/, 'A record without the recorded baselines is refused');
  const pinned = derive(committed(), root);
  assert.deepEqual(pinned.baselines.map(b => [b.id, b.missedRed, b.falseReject]), [['heuristic-grep', 5, 13], ['heuristic-lint', 0, 1]]);
  assert.deepEqual(pinned.bestBaseline, { ...pinned.bestBaseline, id: 'heuristic-lint', missedRed: 0 });
  for (const file of [script, lib, 'experiments/jev-gate/baselines.json']) assert.equal(pinned.files[file], hash(file), `${file} is pinned`);
  assert(!('predictions' in pinned.baselines[0]), 'Per-item predictions stay in baselines.json, pinned by its hash');
  assert.doesNotThrow(() => validateRecord(pinned));
  const lying = entry(5, 13); lying.missedRed = lying.missedRed.slice(1); write({ 'heuristic-grep': lying });
  assert.throws(() => derive(committed(), root), /missedRed disagrees/);
  write({ 'heuristic-grep': entry(5, 13) });
  writeFileSync(join(root, lib), '// changed\n');
  assert.throws(() => derive(committed(), root), /Baseline library changed/);
  writeFileSync(join(root, lib), '// demo library\n'); writeFileSync(join(root, script), 'changed');
  assert.throws(() => derive(committed(), root), /Baseline script changed/);
  writeFileSync(join(root, 'experiments/jev-gate/baselines.json'), JSON.stringify({ inputsSha256: '0'.repeat(64), labelsSha256: hash('experiments/jev-gate/labels.json'), baselines: {} }));
  assert.throws(() => derive(committed(), root), /different gate inputs/);
});

test('the better baseline is picked by fewest missed RED items, and Jev is judged against it with the paired rule', () => {
  const items = { red: ['c1', 'c2', 'c3'], green: ['c4', 'c5'] };
  const grep = { id: 'grep', predictions: { c1: 'RED', c2: 'GREEN', c3: 'RED', c4: 'GREEN', c5: 'RED' } };
  const lint = { id: 'lint', predictions: { c1: 'RED', c2: 'RED', c4: 'GREEN' } };
  assert.deepEqual(baselineCounts(grep, items), { missedRed: 1, falseReject: 1 });
  assert.deepEqual(baselineCounts(lint, items), { missedRed: 1, falseReject: 1 }, 'A missing decision counts against the baseline');
  assert.deepEqual(pickBestBaseline([grep, lint], items), { id: 'grep', missedRed: 1 }, 'A full tie goes to the id that sorts first');
  assert.deepEqual(pickBestBaseline([grep, { id: 'z', predictions: { c1: 'RED', c2: 'RED', c3: 'RED', c4: 'RED', c5: 'RED' } }], items), { id: 'z', missedRed: 0 }, 'Fewest missed RED wins over fewer false rejects');
  assert.deepEqual(pickBestBaseline([], items), { id: null, missedRed: null });
  const record = committed();
  const criterion = record.criteria.find(c => c.comparedWith === 'bestBaseline');
  const [refuted, notEstablished] = record.thresholdRule.states;
  assert.equal(judgePaired(record, criterion, { a: 0, b: 3, c: 0, d: 27 }).state, refuted, 'Jev misses more than the baseline');
  assert.equal(judgePaired(record, criterion, { a: 0, b: 0, c: 0, d: 30 }).state, notEstablished, 'A tie is not established');
  const without = committed(); without.criteria = without.criteria.filter(c => c !== without.criteria.find(x => x.comparedWith === 'bestBaseline'));
  assert.throws(() => validateRecord(without), /better-baseline criterion/);
  const named = committed(); named.bestBaseline.id = 'grep';
  assert.throws(() => validateRecord(named), /bestBaseline must name a recorded baseline/);
  const none = committed(); none.baselines = [];
  assert.throws(() => validateRecord(none), /null while no baseline/);
});

test('headline figures count abstentions against the gate', () => {
  const record = committed();
  const def = id => record.metrics.find(m => m.id === id).definition;
  assert.match(def('missedDrift'), /abstention on a RED item counts as missed drift/);
  assert.match(def('falseReject'), /abstention on a GREEN item counts as a false reject/);
  assert.match(def('decidedOnly'), /abstentions excluded/);
  assert.match(record.claimRule, /headline \(worst-case\)/);
});

test('the pinned corpus records both baselines, the linter as the better one, and criterion 4 stated plainly', () => {
  const record = committed();
  assert.deepEqual(record.baselines.map(b => [b.id, b.missedRed, b.falseReject]), [['heuristic-grep', 5, 13], ['heuristic-lint', 0, 1]]);
  assert.equal(record.bestBaseline.id, 'heuristic-lint');
  assert.equal(record.bestBaseline.plainly, `Jev must miss 0 of ${record.corpus.groundTruthRed} RED items, abstentions included, because the better baseline (heuristic-lint) misses 0.`);
  assert.match(record.bestBaseline.scope, /mechanical rules as well as a linter, not rules a linter cannot express/);
  assert.deepEqual(record.commentOnlyRed.ids, ['c009', 'c021', 'c026', 'c041']);
  assert.match(record.gates.reviewer.workspace, /No odin-rnd checkout, labels\.json, manifest\.json, baselines\.json, corpus file/);
  const root = mkdtempSync(join(tmpdir(), 'jev-gate-split-'));
  for (const d of ['experiments/jev-gate', 'experiments/laya-vs-jev', 'scripts']) cpSync(d, join(root, d), { recursive: true, filter: s => !/(\.venv|node_modules|results)/.test(s) });
  const wrong = committed(); wrong.commentOnlyRed.ids = ['c001'];
  writeFileSync(join(root, recordPath), JSON.stringify(wrong, null, 2) + '\n');
  assert.throws(() => checkRecord(root), /commentOnlyRed item c001 is not RED/);
});
