// Validates the EXP 005 pre-registration record. Every hash, the verbatim rules and question and the
// corpus counts are read from disk and must equal what the record states.
//   node scripts/jev-gate-prereg.mjs --check   validate; print the record's sha256
//   node scripts/jev-gate-prereg.mjs --write   re-derive the disk-derived fields (after a corpus change), then --check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'experiment.id': str, 'experiment.slug': v => v === 'jev-gate', 'experiment.title': str, 'experiment.stationTitle': str,
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
  'gates.reviewer.timeoutSeconds': pos, 'gates.reviewer.order': str, 'gates.reviewer.hangStop.fraction': fraction, 'gates.reviewer.hangStop.rule': str,
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
  'thresholdRule.states': v => strings(v) && v.length === 3, 'thresholdRule.singleRate': str, 'thresholdRule.pairedDifference': str, 'thresholdRule.publication': str,
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
export const criterionFields = { id: str, kind: v => ['single-rate', 'paired-difference'].includes(v), metric: str, gate: str, refutedWhen: v => v === 'greater-than', threshold: v => typeof v === 'number' && v >= 0 && v < 1, statement: str };
// Files every gate input or the verdict depends on. The record may pin more, never fewer.
export const requiredFiles = ['corpus.sha256', 'labels.json', 'inputs.json', 'inputs.sha256', 'rules.txt', 'gate-question.json', 'blueprint.json'].map(f => `${dir}/${f}`);
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
    assert(record.metrics.some(m => m.id === c.metric), `Criterion ${c.id} names an undefined metric`);
    if (c.kind === 'single-rate') assert(c.statement.includes(percent(c.threshold)), `Criterion ${c.id} statement disagrees with its threshold`);
    else assert(str(c.comparedWith), `Criterion ${c.id} must name what it is compared with`);
  }
  assert(record.criteria.some(c => c.kind === 'paired-difference'), 'The cascade criterion is required');
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
  assert.equal(record.corpus.items, record.corpus.groundTruthRed + record.corpus.groundTruthGreen + record.corpus.excluded, 'Corpus counts do not add up');
}

export function checkRecord(root = '.') {
  const bytes = readFileSync(join(root, recordPath));
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
    writeFileSync(recordPath, JSON.stringify(derive(record), null, 2) + '\n');
    console.log(`Re-derived ${recordPath} from disk.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/jev-gate-prereg.mjs --check | --write');
    process.exit(2);
  }
  const { sha256: digest } = checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest}`);
}
