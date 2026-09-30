// EXP 007 WO-1-04: validates the stage-1 pre-registration, experiments/blueprint-floor/preregistration.json. The authored
// text lives in the record; every fact about committed files (shas, the plugin table, the counts, the vocabulary, the
// EXP 005 figures it cites) is recomputed from disk and must equal what the record states. The kill criteria and the
// discriminating negatives must be the council's words, verbatim. Same pattern as EXP 005's jev-gate-prereg.mjs.
//   node scripts/blueprint-floor-prereg.mjs --check   validate; print the record's sha256
//   node scripts/blueprint-floor-prereg.mjs --write   re-derive the disk-derived fields
//   node scripts/blueprint-floor-prereg.mjs --pin     after review, pin the record's sha256 in preregistration.sha256
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const D = 'experiments/blueprint-floor', J = 'experiments/jev-gate';
export const recordPath = `${D}/preregistration.json`;
export const pinPath = `${D}/preregistration.sha256`;
export const publishedPath = 'site/data/blueprint-floor/preregistration.json';
export const statusText = 'Pre-registered, not yet run';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// COUNCIL-VERDICT.md (2026-09-30), verbatim, line breaks and indentation included. A record may not paraphrase them.
export const KILL_CRITERIA_VERBATIM = 'Kill criteria (pre-registered, published either way): median expressible share < 25% → premise refuted, census is the result;\n  cascade adds false rejects > 2 pts over plugin-alone, or avoids < 20% of Jev calls → refuted.';
export const DISCRIMINATING_NEGATIVES_VERBATIM = 'Discriminating negatives: sham floor must collapse to Jev-alone; floor must abstain on ≥95% of non-expressible rules;\n  lint-floor tie is published as "any deterministic floor works".';
// PLAN-DETAIL R2-7, verbatim.
export const WORDING_R2_7 = '"$0 / no model" in COUNCIL-VERDICT STAGE 1 and STEER S5 = no Jev and no paid call before the stage-1 prereg is live; the census translator + adjudicator are METERED model calls under the $100 cap (council\'s cost line counts them as agent labour).';

// Files the census path depends on. The record pins exactly these; never its own validator or the site renderer.
export const PLUGINS = ['hunch', 'jev-pref', 'abide', 'limpet', 'jev-belay', 'jev-engineering', 'pi-verdict', 'jev-axi'];
export const PINNED = [
  ...['adapter.mjs', 'whitelist.mjs', 'whitelist.json', 'contract.md', 'contract-module-graph.md', 'prompts/translator.md', 'prompts/adjudicator.md', 'protocol.mjs', 'protocol.md', 'scorer.mjs', 'fixtures/scorer.json', 'extract.mjs', 'rules/selection.json', 'rules/SELECTION.md', ...PLUGINS.map(p => `rules/${p}.json`), 'controls/positive.json', 'controls/negative.json'].map(f => `${D}/${f}`),
  `${J}/bce-contract.mjs`, `${J}/rules.txt`, 'scripts/blueprint-floor-rules.mjs', 'package.json', 'pnpm-lock.yaml',
];
export const NOT_PINNED = ['scripts/blueprint-floor-prereg.mjs', 'scripts/blueprint-floor-note.mjs', 'scripts/blueprint-floor-isolation.mjs', `${D}/preregistration.json`, `${D}/preregistration.sha256`];
// The base tree committed under EXP 005's scoring contract (bce-contract.mjs materialise: fixed identity, date and message).
export const BASE_COMMIT = '2c55f16e20ccc27e60d5c53e25661acafb82133f';

const hex = /^[a-f0-9]{64}$/, sha40 = /^[a-f0-9]{40}$/;
const str = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(str);
const int = v => Number.isInteger(v) && v >= 0;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const required = {
  schemaVersion: v => v === 1,
  kind: v => v === 'preregistration',
  'experiment.id': v => v === 'EXP 007', 'experiment.slug': v => v === 'blueprint-floor', 'experiment.title': str, 'experiment.summary': str,
  'experiment.status': v => v === 'pre-registered', 'experiment.statusText': v => v === statusText, 'experiment.authoredOn': date, 'experiment.note': str,
  question: str,
  stage: v => v === '1 of 2 (census); stage 2 pre-registered by amendment before any paid Jev call',
  'lineage.exp005.resultsSha256': v => hex.test(v), 'lineage.exp005.lintMissedRed': int, 'lineage.exp005.redItems': int, 'lineage.exp005.finding': str, 'lineage.motivation': str,
  plugins: v => Array.isArray(v) && v.length === PLUGINS.length,
  excludedPlugins: v => Array.isArray(v) && v.length === 3 && v.every(p => str(p.plugin) && str(p.reason)),
  'selection.file': v => v === `${D}/rules/selection.json`, 'selection.inclusionTest': str, 'selection.granularity': str, 'selection.textField': str, 'selection.inputKinds': str, 'selection.regexFlags': str, 'selection.hunchSecondary': str,
  files: v => obj(v) && Object.values(v).every(h => hex.test(h)),
  'engine.package': v => v === 'bce-engine', 'engine.version': v => v === '0.3.1', 'engine.files': v => obj(v) && Object.values(v).every(h => hex.test(h)),
  'engine.pluginVocabulary': strings, 'engine.controlVocabulary': strings, 'engine.excludedTypes': strings, 'engine.rule': str, 'engine.customPolicy': str,
  'adapter.profiles': str, 'adapter.inputs': strings, 'adapter.judge': str, 'adapter.teeth': str, 'adapter.base': str, 'adapter.baseCommit': v => sha40.test(v), 'adapter.baseTree': v => sha40.test(v),
  'classes.expressible': str, 'classes.partial': str, 'classes.not': str,
  'translator.input': str, 'translator.never': str, 'translator.output': str, 'translator.blindness': str,
  'mechanical.checks': strings, 'mechanical.downgrade': str, 'mechanical.engineLimit': str, 'mechanical.error': str,
  'adjudicator.input': str, 'adjudicator.output': str, 'adjudicator.finalClass': str, 'adjudicator.agreement': str,
  'controls.positive': str, 'controls.negative': str, 'controls.calibrationBar': str, 'controls.miss': str, 'controls.counts.positive': v => v === 7, 'controls.counts.negative': v => v === 6,
  metrics: v => Array.isArray(v) && v.length > 0 && v.every(m => str(m.id) && str(m.definition)),
  'census.primaryRules': int, 'census.secondaryRules': v => v === 30, 'census.secondaryPopulation': int, 'census.controls': v => v === 13, 'census.rules': int, 'census.calls': int, 'census.pluginsInMedian': int, 'census.pluginsWithoutRules': v => Array.isArray(v),
  'calls.translatorModel': v => v === 'claude-opus-5-5', 'calls.adjudicatorModel': v => v === 'claude-sonnet-5', 'calls.client': str, 'calls.clientVersion': v => /^\d+\.\d+\.\d+$/.test(v), 'calls.effort': v => v === 'high',
  'calls.attempts': v => v === 1, 'calls.command': str, 'calls.workingDirectory': str, 'calls.environment': str, 'calls.billing': str, 'calls.modelAssertion': str, 'calls.canary': str, 'calls.bareRejected': str,
  'killCriteria.stage1': str, 'killCriteria.verbatim': v => v === KILL_CRITERIA_VERBATIM, 'killCriteria.discriminatingNegativesVerbatim': v => v === DISCRIMINATING_NEGATIVES_VERBATIM, 'killCriteria.source': str, 'killCriteria.publication': str,
  'spend.capUsd': v => v === 100, 'spend.censusCeilingUsd': v => v === 40, 'spend.ledger': v => v === `${D}/spend-ledger.jsonl`, 'spend.rules': strings, 'spend.bundle1': str, 'spend.wording': v => v === WORDING_R2_7, 'spend.unknownCost': str,
  notBefore: str, runnerGuard: str,
  limits: strings,
  sources: v => Array.isArray(v) && v.length > 0 && v.every(s => str(s.id) && str(s.label) && str(s.url) && s.url.startsWith('https://') && str(s.claim)),
};

export const get = (record, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), record);

export function validateRecord(record) {
  assert(obj(record), 'The pre-registration must be a JSON object');
  for (const [path, check] of Object.entries(required)) assert(check(get(record, path)), `Pre-registration field ${path} is missing or invalid`);
  assert.deepEqual(Object.keys(record.files), PINNED, 'The record pins exactly the census-path files, in order');
  for (const f of NOT_PINNED) assert(!(f in record.files), `${f} is never pinned`);
  assert.deepEqual(record.plugins.map(p => p.plugin), PLUGINS, 'The eight plugins, in selection order');
  for (const p of record.plugins) {
    assert(str(p.repo) && sha40.test(p.sha) && p.license === 'MIT' && str(p.copyright) && hex.test(p.rulesFileSha256) && int(p.primary) && int(p.secondary) && int(p.excluded), `Plugin ${p.plugin} row is incomplete`);
  }
  assert.equal(record.census.rules, record.census.primaryRules + record.census.secondaryRules + record.census.controls, 'Census counts do not add up');
  assert.equal(record.census.calls, 2 * record.census.rules, 'Two counted calls per rule (translator, adjudicator)');
  assert(!record.engine.pluginVocabulary.includes('customPolicy') && !record.engine.controlVocabulary.includes('customPolicy'), 'customPolicy is refused');
  assert(record.calls.command.includes(`--model <pin>`) && record.calls.command.includes('--effort high') && record.calls.command.includes('--tools ""') && !record.calls.command.includes('--fallback-model'), 'The pinned command');
  const text = JSON.stringify(record);
  assert(!/(?<![\w\\])\/(?:Users|home|private)\//.test(text), 'Private local paths in the record');
  assert(!/Recorded experiment|results show/i.test(text), 'A pre-registration states no result');
  return record;
}

/** The base tree's commit under EXP 005's scoring contract (fixed identity and date) and its git tree id: the pin of every diff input. */
export async function baseCommit(root) {
  const { materialise } = await import(resolve(root, `${J}/bce-contract.mjs`));
  const dir = materialise(resolve(root, `${J}/base`));
  const git = rev => execFileSync('git', ['-C', dir, 'rev-parse', rev], { encoding: 'utf8' }).trim();
  try { return { commit: git('HEAD'), tree: git('HEAD^{tree}') }; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Everything in the record that is a fact about files on disk, recomputed from them.
export async function derive(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  const json = file => JSON.parse(read(file));
  const next = structuredClone(record);
  next.files = Object.fromEntries(PINNED.map(f => [f, sha256(read(f))]));
  const selection = json(`${D}/rules/selection.json`);
  const rules = Object.fromEntries(PLUGINS.map(p => [p, json(`${D}/rules/${p}.json`)]));
  next.plugins = selection.plugins.map(s => {
    const r = rules[s.plugin];
    return { plugin: s.plugin, repo: s.repo, sha: s.sha, license: r.license, copyright: r.copyright, rulesFile: `${D}/rules/${s.plugin}.json`, rulesFileSha256: sha256(read(`${D}/rules/${s.plugin}.json`)), primary: r.counts.primary, secondary: r.counts.secondary, excluded: r.counts.excluded };
  });
  next.excludedPlugins = selection.outOfScope.map(o => ({ plugin: o.plugin, reason: o.reason }));
  Object.assign(next.selection, { inclusionTest: selection.inclusionTest, granularity: selection.granularity, textField: selection.textField, inputKinds: selection.inputKinds, regexFlags: selection.regexFlags });
  const w = json(`${D}/whitelist.json`);
  Object.assign(next.engine, { version: w.engine.version, files: w.engine.files, pluginVocabulary: w.plugin.map(t => t.type), controlVocabulary: w.controls.map(t => t.type), excludedTypes: w.excluded.map(t => t.type) });
  const primary = next.plugins.reduce((s, p) => s + p.primary, 0), secondary = next.plugins.reduce((s, p) => s + p.secondary, 0);
  const controls = json(`${D}/controls/positive.json`).rules.length + json(`${D}/controls/negative.json`).rules.length;
  Object.assign(next.census, { primaryRules: primary, secondaryRules: secondary, secondaryPopulation: rules.hunch.secondaryPopulation.size, controls, rules: primary + secondary + controls, calls: 2 * (primary + secondary + controls), pluginsInMedian: next.plugins.filter(p => p.primary > 0).length, pluginsWithoutRules: next.plugins.filter(p => p.primary === 0).map(p => p.plugin) });
  Object.assign(next.controls.counts, { positive: json(`${D}/controls/positive.json`).rules.length, negative: json(`${D}/controls/negative.json`).rules.length });
  const lint = json(`${J}/baselines.json`).baselines['heuristic-lint'];
  const labels = json(`${J}/labels.json`);
  Object.assign(next.lineage.exp005, { resultsSha256: sha256(read(`${J}/results/results.json`)), lintMissedRed: lint.missedRed.length, redItems: labels.counts.RED });
  const base = await baseCommit(root);
  next.adapter.baseCommit = base.commit;
  next.adapter.baseTree = base.tree;
  return next;
}

// Disk facts the record does not store but must agree with.
export function assertDisk(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  for (const p of record.plugins) {
    const r = JSON.parse(read(p.rulesFile));
    assert.equal(r.sha, p.sha, `${p.rulesFile} is not at the recorded pin`);
    assert.equal(r.rules.filter(x => x.stratum === 'primary').length, p.primary, `${p.rulesFile} primary count`);
  }
  assert.equal(record.adapter.baseCommit, BASE_COMMIT, 'The diff base is EXP 005\'s base tree under its scoring contract');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.devDependencies['bce-engine'], '0.3.1', 'bce-engine 0.3.1 exactly (J4)');
}

export async function checkRecord(root = '.') {
  const bytes = readFileSync(join(root, recordPath));
  const pinned = existsSync(join(root, pinPath)) ? readFileSync(join(root, pinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${recordPath} differs from the sha256 pinned in ${pinPath}: review the change, then node scripts/blueprint-floor-prereg.mjs --pin`);
  const record = validateRecord(JSON.parse(bytes));
  assert.deepEqual(record, await derive(record, root), 'The record differs from the files on disk: run node scripts/blueprint-floor-prereg.mjs --write, review the diff, then --pin');
  assertDisk(record, root);
  return { record, sha256: sha256(bytes), bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const next = validateRecord(await derive(record));
    writeFileSync(recordPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`Re-derived ${recordPath} from disk (sha256 ${sha256(readFileSync(recordPath))}). Review it, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateRecord(JSON.parse(readFileSync(recordPath, 'utf8')));
    writeFileSync(pinPath, `${sha256(readFileSync(recordPath))}  preregistration.json\n`);
    console.log(`Pinned ${recordPath} in ${pinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/blueprint-floor-prereg.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = await checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest}`);
}
