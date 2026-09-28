// Validates the EXP 005 pre-registration record. Every hash, the verbatim rules and question and the
// corpus counts are read from disk and must equal what the record states.
//   node scripts/jev-gate-prereg.mjs --check   validate; print the record's sha256
//   node scripts/jev-gate-prereg.mjs --write   re-derive the disk-derived fields (after a corpus change)
//   node scripts/jev-gate-prereg.mjs --pin     after review, pin the record's sha256 in preregistration.sha256
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickBestBaseline } from '../experiments/jev-gate/metrics.mjs';

export const recordPath = 'experiments/jev-gate/preregistration.json';
export const statusText = 'Pre-registered — not yet run';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const dir = 'experiments/jev-gate';
const hex = /^[a-f0-9]{64}$/;
const str = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(str);
const int = v => Number.isInteger(v) && v >= 0;
const pos = v => Number.isInteger(v) && v > 0;
const fraction = v => typeof v === 'number' && v > 0 && v < 1;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));

// Every required field and its type check. Tests delete each one and expect the validator to refuse.
export const required = {
  schemaVersion: v => v === 1,
  kind: v => v === 'preregistration',
  'experiment.id': str, 'experiment.slug': v => v === 'jev-gate', 'experiment.title': str, 'experiment.stationTitle': str, 'experiment.stationSummary': str,
  'experiment.status': v => v === 'pre-registered', 'experiment.statusText': v => v === statusText, 'experiment.authoredOn': date, 'experiment.note': str,
  question: str, framing: strings,
  'corpus.description': str, 'corpus.items': pos, 'corpus.groundTruthRed': int, 'corpus.groundTruthGreen': int,
  'corpus.intentDisagreements': int, 'corpus.excluded': int, 'corpus.corpusSha256': v => hex.test(v), 'corpus.corpusSha256Meaning': str,
  'corpus.inputsSha256': v => hex.test(v), 'corpus.inputsSha256Meaning': str,
  files: v => obj(v) && Object.keys(v).length > 0 && Object.values(v).every(h => hex.test(h)),
  rulesText: str, gateQuestion: v => obj(v) && v.type === 'noul' && str(v.instructions), stateConstruction: str,
  'groundTruth.engine': str, 'groundTruth.version': str, 'groundTruth.extractor': str, 'groundTruth.command': str, 'groundTruth.labelRule': str,
  'gates.jev.role': str, 'gates.jev.provider': str, 'gates.jev.endpoint': v => str(v) && v.startsWith('https://'), 'gates.jev.model': str,
  'gates.jev.acceptedServedModelPrefixes': strings, 'gates.jev.request': str, 'gates.jev.stateConstruction': str, 'gates.jev.answer': str,
  'gates.jev.timeoutSeconds': pos, 'gates.jev.order': str,
  'gates.laya.role': str, 'gates.laya.repository': str, 'gates.laya.revision': v => /^[a-f0-9]{40}$/.test(v), 'gates.laya.subdir': str,
  'gates.laya.fileSha256': v => obj(v) && Object.keys(v).length > 0 && Object.values(v).every(h => hex.test(h)),
  'gates.laya.revisionSource': str, 'gates.laya.backend': str, 'gates.laya.sequence': str, 'gates.laya.answer': str, 'gates.laya.order': str,
  'gates.reviewer.role': str, 'gates.reviewer.tool': str, 'gates.reviewer.repository': str, 'gates.reviewer.release': str,
  'gates.reviewer.commit': v => /^[a-f0-9]{40}$/.test(v), 'gates.reviewer.agent': str, 'gates.reviewer.client': str, 'gates.reviewer.clientVersion': str,
  'gates.reviewer.model': str, 'gates.reviewer.effort': str, 'gates.reviewer.k': pos, 'gates.reviewer.allowedTools': strings,
  'gates.reviewer.command': str, 'gates.reviewer.workspace': str, 'gates.reviewer.prompt': str, 'gates.reviewer.promptAuthorship': str,
  'gates.reviewer.timeoutSeconds': pos, 'gates.reviewer.order': str, 'gates.reviewer.hangStop.fraction': fraction, 'gates.reviewer.hangStop.minRuns': pos, 'gates.reviewer.hangStop.rule': str,
  'gates.reviewer.isolationProof': v => str(v) && /canary/.test(v) && /before any counted/i.test(v),
  baselines: v => Array.isArray(v) && v.every(b => str(b.id) && str(b.script) && hex.test(b.scriptSha256) && str(b.lib) && hex.test(b.libSha256) && str(b.description) && pos(b.scored) && int(b.correct) && int(b.missedRed) && int(b.falseReject)),
  baselineRule: str, baselinesSource: str, 'bestBaseline.rule': str,
  'bestBaseline.id': v => v === null || str(v), 'bestBaseline.missedRed': v => v === null || int(v),
  'bestBaseline.plainly': v => v === null || str(v), 'bestBaseline.scope': str,
  'commentOnlyRed.ids': strings, 'commentOnlyRed.note': str,
  'decisionRules.typedDecision': str, 'decisionRules.decisionThreshold': fraction, 'decisionRules.confidence': str,
  'decisionRules.verdictPattern': str, 'decisionRules.verdictParse': str, 'decisionRules.reviewerMajority': str,
  'decisionRules.abstention': str, 'decisionRules.failures': str,
  'cascade.fastGate': v => v === 'jev', 'cascade.escalateTo': v => v === 'reviewer', 'cascade.confidenceThreshold': fraction, 'cascade.rule': str, 'cascade.reporting': str,
  'populations.primary': str, 'populations.sensitivity': str,
  metrics: v => Array.isArray(v) && v.length > 0 && v.every(m => str(m.id) && str(m.definition)),
  'statistics.confidenceLevel': fraction, 'statistics.z': v => typeof v === 'number' && v > 0,
  'statistics.singleRate.method': str, 'statistics.singleRate.formula': str, 'statistics.singleRate.reference': str,
  'statistics.pairedDifference.method': v => str(v) && /Newcombe/.test(v), 'statistics.pairedDifference.formula': str,
  'statistics.pairedDifference.reference': str, 'statistics.pairedDifference.implementation': str,
  criteria: v => Array.isArray(v) && v.length > 0,
  claimRule: str,
  'thresholdRule.states': v => obj(v) && JSON.stringify(v) === JSON.stringify(resultStates), 'thresholdRule.singleRate': str, 'thresholdRule.pairedDifference': str, 'thresholdRule.pointRatio': str, 'thresholdRule.publication': str,
  'baselineValidity.metric': str, 'baselineValidity.gate': v => v === 'reviewer', 'baselineValidity.threshold': fraction,
  'baselineValidity.statement': str, 'baselineValidity.consequence': str,
  'latency.role': str,
  'cost.jev.usdPerMillionInputTokens': v => typeof v === 'number' && v > 0, 'cost.jev.basis': str, 'cost.reviewer.basis': str, 'cost.laya.basis': str, 'cost.comparison': str,
  'spendCap.usd': v => typeof v === 'number' && v > 0, 'spendCap.alreadySpentUsd': v => typeof v === 'number' && v >= 0, 'spendCap.covers': str, 'spendCap.rule': str,
  'retryProtocol.readinessGateMaxAttempts': pos, 'retryProtocol.rule': str, 'retryProtocol.gateCalls': str,
  'clock.rule': str, 'clock.notBefore': str,
  'attribution.nina': str, 'attribution.ninaUrl': str,
  limits: strings,
  sources: v => Array.isArray(v) && v.length > 0 && v.every(s => str(s.id) && str(s.label) && str(s.url) && s.url.startsWith('https://') && str(s.claim)),
};
export const criterionFields = { id: str, kind: v => ['single-rate', 'paired-difference', 'point-ratio'].includes(v), metric: str, gate: str, refutedWhen: v => ['greater-than', 'not-below-fraction'].includes(v), threshold: v => typeof v === 'number' && v >= 0 && v < 1, statement: str };
// The five criteria, exactly. A record may not drop, rename or re-aim one; the thresholds stay in the record.
export const criterionShapes = {
  'jev-missed-drift': { kind: 'single-rate', metric: 'missedDrift', gate: 'jev', refutedWhen: 'greater-than' },
  'jev-false-reject': { kind: 'single-rate', metric: 'falseReject', gate: 'jev', refutedWhen: 'greater-than' },
  'cascade-vs-reviewer': { kind: 'paired-difference', metric: 'missedDrift', gate: 'cascade', comparedWith: 'reviewer', refutedWhen: 'greater-than', threshold: 0 },
  'jev-vs-best-baseline': { kind: 'paired-difference', metric: 'missedDrift', gate: 'jev', comparedWith: 'bestBaseline', refutedWhen: 'greater-than', threshold: 0 },
  'cascade-cost': { kind: 'point-ratio', metric: 'meanCostPerChange', gate: 'cascade', comparedWith: 'reviewer', refutedWhen: 'not-below-fraction' },
};
export const resultStates = { refuted: 'refuted', notEstablished: 'passes, not established at this N', passes: 'passes' };
export const requiredMetrics = ['agreement', 'missedDrift', 'falseReject', 'abstentionRate', 'decidedOnly', 'missedDriftSplit', 'accuracyAtHighConfidence', 'cascade', 'reviewerVariance', 'latency', 'costPer1000', 'meanCostPerChange'];
// Files every gate input or the verdict depends on. The record may pin more, never fewer.
export const requiredFiles = [...['corpus.sha256', 'labels.json', 'inputs.json', 'inputs.sha256', 'rules.txt', 'gate-question.json', 'blueprint.json', 'metrics.mjs'].map(f => `${dir}/${f}`), 'scripts/jev-gate-prereg.mjs', 'scripts/jev-gate-journal.mjs'];
// The published record's sha256, pinned in its own file. The gate runners refuse any other record.
export const pinPath = `${dir}/preregistration.sha256`;
export const ninaAttribution = 'nina (github.com/xhulz/nina) — used with the permission of its author, as confirmed by Odin Labs';

export const get = (record, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), record);
export const percent = value => `${Math.round(value * 1000) / 10}%`;

export function validateRecord(record) {
  assert(obj(record), 'The pre-registration must be a JSON object');
  for (const [path, check] of Object.entries(required)) assert(check(get(record, path)), `Pre-registration field ${path} is missing or invalid`);
  for (const file of requiredFiles) assert(file in record.files, `Pre-registration does not pin ${file}`);
  const ids = new Set();
  for (const c of record.criteria) {
    for (const [key, check] of Object.entries(criterionFields)) assert(check(c[key]), `Criterion field ${key} is missing or invalid`);
    assert(!ids.has(c.id), `Duplicate criterion ${c.id}`); ids.add(c.id);
    const shape = criterionShapes[c.id];
    assert(shape, `Unknown criterion ${c.id}`);
    for (const [key, value] of Object.entries(shape)) assert.equal(c[key], value, `Criterion ${c.id} ${key} must be ${value}`);
    if (!('comparedWith' in shape)) assert(!('comparedWith' in c), `Criterion ${c.id} compares with nothing`);
    if (c.kind !== 'paired-difference') assert(c.statement.includes(percent(c.threshold)), `Criterion ${c.id} statement disagrees with its threshold`);
  }
  for (const id of Object.keys(criterionShapes)) assert(ids.has(id), `Criterion ${id} is required`);
  const metricIds = record.metrics.map(m => m.id);
  assert.equal(new Set(metricIds).size, metricIds.length, 'Duplicate metric');
  for (const id of requiredMetrics) assert(metricIds.includes(id), `Metric ${id} is required`);
  if (record.baselines.length) assert(record.baselines.some(b => b.id === record.bestBaseline.id) && int(record.bestBaseline.missedRed), 'bestBaseline must name a recorded baseline');
  else assert(record.bestBaseline.id === null && record.bestBaseline.missedRed === null, 'bestBaseline must be null while no baseline is recorded');
  assert(record.baselineValidity.statement.includes(percent(record.baselineValidity.threshold)), 'Baseline statement disagrees with its threshold');
  assert.equal(record.attribution.nina, ninaAttribution, 'nina attribution must match the founder wording exactly');
  assert.equal(record.attribution.ninaUrl, 'https://github.com/xhulz/nina');
  assert.equal(record.gates.reviewer.k % 2, 1, 'k must be odd so that a majority exists');
  assert(record.gates.reviewer.command.includes(`--model ${record.gates.reviewer.model}`) && record.gates.reviewer.command.includes(`--effort ${record.gates.reviewer.effort}`), 'Reviewer command disagrees with its pins');
  for (const tool of record.gates.reviewer.allowedTools) assert(record.gates.reviewer.command.includes(tool), `Reviewer command lacks ${tool}`);
  assert(new RegExp(record.decisionRules.verdictPattern, 'm').test('text\nVERDICT: REJECTED'), 'verdictPattern must parse a verdict line');
  assert(!/Recorded experiment/i.test(JSON.stringify(record)), 'A pre-registration never calls itself a recorded experiment');
  assert(!/\/Users\/|\/private\/|\/home\/[^\s"]+/.test(JSON.stringify(record)), 'Private local paths in the record');
  return record;
}

export const baselinesPath = `${dir}/baselines.json`;
export const baselinesLib = `${dir}/baselines.mjs`;
// The comparison baselines (deterministic scripts, no model) as baselines.json records them, keyed by name;
// [] until the file exists. Everything the file asserts about disk is re-checked here.
export function readBaselines(root = '.', labels = JSON.parse(readFileSync(join(root, dir, 'labels.json'), 'utf8'))) {
  if (!existsSync(join(root, baselinesPath))) return [];
  const read = file => readFileSync(join(root, file));
  const raw = JSON.parse(read(baselinesPath));
  assert(obj(raw.baselines), `${baselinesPath} must key its baselines by name`);
  assert.equal(raw.inputsSha256, sha256(read(`${dir}/inputs.json`)), 'Baselines were scored on different gate inputs');
  assert.equal(raw.labelsSha256, sha256(read(`${dir}/labels.json`)), 'Baselines were scored against different labels');
  const truth = Object.fromEntries(labels.items.filter(i => ['RED', 'GREEN'].includes(i.label)).map(i => [i.id, i.label]));
  const ids = Object.keys(truth);
  return Object.entries(raw.baselines).map(([id, b]) => {
    assert.equal(sha256(read(b.script)), b.scriptSha256, `Baseline script changed: ${b.script}`);
    assert.equal(sha256(read(baselinesLib)), b.libSha256, `Baseline library changed: ${baselinesLib}`);
    assert(obj(b.predictions), `Baseline ${id} records no per-item predictions`);
    const missed = ids.filter(i => truth[i] === 'RED' && b.predictions[i] !== 'RED');
    const rejected = ids.filter(i => truth[i] === 'GREEN' && b.predictions[i] !== 'GREEN');
    assert.deepEqual([...b.missedRed].sort(), missed.sort(), `Baseline ${id} missedRed disagrees with its predictions`);
    assert.deepEqual([...b.falseReject].sort(), rejected.sort(), `Baseline ${id} falseReject disagrees with its predictions`);
    assert.equal(b.correct, ids.length - missed.length - rejected.length, `Baseline ${id} correct disagrees with its predictions`);
    return { id, script: b.script, scriptSha256: b.scriptSha256, lib: baselinesLib, libSha256: b.libSha256, description: b.description, scored: b.scored, correct: b.correct, accuracy: b.accuracy, missedRed: missed.length, falseReject: rejected.length, predictions: b.predictions };
  });
}

const pyString = (source, name) => source.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))?.[1];

// Everything in the record that is a fact about files on disk, recomputed from those files.
export function derive(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  const next = structuredClone(record);
  for (const file of Object.keys(next.files)) next.files[file] = sha256(read(file));
  const corpusList = read(`${dir}/corpus.sha256`);
  next.corpus.corpusSha256 = sha256(corpusList);
  next.corpus.inputsSha256 = sha256(read(`${dir}/inputs.json`));
  const labels = JSON.parse(read(`${dir}/labels.json`));
  Object.assign(next.corpus, { items: labels.counts.total, groundTruthRed: labels.counts.RED, groundTruthGreen: labels.counts.GREEN, intentDisagreements: labels.counts.disagree, excluded: labels.counts.EXCLUDED });
  next.rulesText = read(`${dir}/rules.txt`).toString('utf8');
  next.gateQuestion = JSON.parse(read(`${dir}/gate-question.json`));
  const inputs = JSON.parse(read(`${dir}/inputs.json`));
  next.stateConstruction = inputs.stateConstruction;
  next.groundTruth.version = labels.engine.version;
  next.groundTruth.extractor = labels.engine.extractor;
  const baselines = readBaselines(root, labels);
  next.baselines = baselines.map(({ predictions, ...summary }) => summary);
  if (baselines.length) for (const file of [baselinesPath, baselinesLib]) next.files[file] = sha256(read(file));
  for (const b of baselines) next.files[b.script] = sha256(read(b.script));
  const primary = labels.items.filter(item => !item.disagree && ['RED', 'GREEN'].includes(item.label));
  Object.assign(next.bestBaseline, pickBestBaseline(baselines, { red: primary.filter(i => i.label === 'RED').map(i => i.id), green: primary.filter(i => i.label === 'GREEN').map(i => i.id) }));
  const { id, missedRed } = next.bestBaseline, red = labels.counts.RED;
  // Criterion 4 in plain words, from the recorded numbers (founder, 2026-09-26: "Keep it, state it plainly").
  next.bestBaseline.plainly = id === null ? null : missedRed === 0
    ? `Jev must miss 0 of ${red} RED items, abstentions included, because the better baseline (${id}) misses 0.`
    : `Jev must miss at most ${missedRed} of ${red} RED items, abstentions included, because the better baseline (${id}) misses ${missedRed}.`;
  const runner = read('experiments/laya-vs-jev/run.py').toString('utf8');
  next.gates.laya.revision = pyString(runner, 'HF_SHA');
  next.gates.laya.subdir = pyString(runner, 'SUBDIR');
  next.gates.jev.model = pyString(runner, 'JEV_MODEL');
  const pinned = runner.match(/^PINNED = \{([\s\S]*?)^\}/m)?.[1] ?? '';
  next.gates.laya.fileSha256 = Object.fromEntries([...pinned.matchAll(/"(typed-decisions\/[^"]+)": "([a-f0-9]{64})"/g)].map(m => [m[1], m[2]]));
  return next;
}

// Disk facts the record does not store but must agree with.
export function assertDisk(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  for (const line of read(`${dir}/corpus.sha256`).toString('utf8').split('\n').filter(Boolean)) {
    const [, digest, file] = line.match(/^([a-f0-9]{64}) {2}(.+)$/) ?? [];
    assert(digest && file, `Malformed corpus.sha256 line: ${line}`);
    assert.equal(sha256(read(`${dir}/${file}`)), digest, `Corpus file changed: ${file}`);
  }
  assert.equal(read(`${dir}/inputs.sha256`).toString('utf8').split(/\s+/)[0], record.corpus.inputsSha256, 'inputs.sha256 disagrees with inputs.json');
  const inputs = JSON.parse(read(`${dir}/inputs.json`));
  assert.equal(inputs.items.length, record.corpus.items, 'Every corpus item needs a gate input');
  assert(inputs.items.every(item => item.truncated === false), 'A gate input is truncated');
  assert.equal(inputs.tokenizer.hfRevision, record.gates.laya.revision, 'Gate inputs were counted with a different Laya revision');
  assert.equal(inputs.tokenizer.tokenizerSha256, record.gates.laya.fileSha256['typed-decisions/tokenizer/tokenizer.json']);
  assert.equal(inputs.question.sha256, sha256(read(`${dir}/gate-question.json`)));
  const labels = JSON.parse(read(`${dir}/labels.json`));
  for (const id of record.commentOnlyRed.ids) assert.equal(labels.items.find(i => i.id === id)?.label, 'RED', `commentOnlyRed item ${id} is not RED`);
  assert.equal(record.corpus.items, record.corpus.groundTruthRed + record.corpus.groundTruthGreen + record.corpus.excluded, 'Corpus counts do not add up');
}

export function checkRecord(root = '.') {
  const bytes = readFileSync(join(root, recordPath));
  const pinned = existsSync(join(root, pinPath)) ? readFileSync(join(root, pinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${recordPath} differs from the sha256 pinned in ${pinPath}: review the change, then node scripts/jev-gate-prereg.mjs --pin`);
  const record = validateRecord(JSON.parse(bytes));
  assert.deepEqual(record, derive(record, root), 'The record differs from the files on disk: run node scripts/jev-gate-prereg.mjs --write, review the diff, then --check');
  assertDisk(record, root);
  return { record, sha256: sha256(bytes), bytes };
}

export const loadPreregistration = (root = '.') => checkRecord(root).record;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const next = validateRecord(derive(record));
    writeFileSync(recordPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`Re-derived ${recordPath} from disk (sha256 ${sha256(readFileSync(recordPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateRecord(JSON.parse(readFileSync(recordPath, 'utf8')));
    writeFileSync(pinPath, `${sha256(readFileSync(recordPath))}  preregistration.json\n`);
    console.log(`Pinned ${recordPath} in ${pinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/jev-gate-prereg.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest}`);
}
