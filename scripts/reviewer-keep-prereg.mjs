// EXP 011 (reviewer-keep): validates the pre-registration, experiments/reviewer-keep/preregistration.json. The authored
// text lives in the record; every fact about committed files (the vendored rule records and their sha256s, the
// eligibility counts, the not-class set it was drawn from, the fixture manifest, the baseline mapping, the parents'
// record shas, the files it pins) is recomputed from disk and must equal what the record states. The design's frozen
// wording (the reviewer prompt, the churn heuristic, the best-baseline definition, the floors, the ceiling trip) must be
// the design's words, verbatim. Same pattern as EXP 007's blueprint-floor-prereg.mjs.
//   node scripts/reviewer-keep-prereg.mjs --check   validate; print the record's sha256
//   node scripts/reviewer-keep-prereg.mjs --write   re-derive the vendored rules, the fixture manifest and the disk-derived fields
//   node scripts/reviewer-keep-prereg.mjs --pin     after review, pin the record's sha256 in preregistration.sha256
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const D = 'experiments/reviewer-keep';
const BF = 'experiments/blueprint-floor', J = 'experiments/jev-gate', N = 'experiments/nina-changes';
export const recordPath = `${D}/preregistration.json`;
export const pinPath = `${D}/preregistration.sha256`;
export const publishedPath = 'site/data/reviewer-keep/preregistration.json';
export const manifestPath = `${D}/fixture.sha256`;
export const statusText = 'Pre-registered, not yet run';
export const TO_BE_PINNED = 'to be pinned by dated amendment before any call';
export const CAP_STATUS = '$80 proposed — founder sign-off pending; no call before a dated amendment records the signed cap';
export const COMPARATOR_NAME = 'the frozen rule-filtered off-the-shelf tools';
export const NOT_BEFORE = "the merge time of this pre-registration's odin-rnd PR";
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The design's frozen wording (EXP011-DESIGN v3 addendum), verbatim. A record may not paraphrase it.
export const PROMPT_VERBATIM = 'The change under review is the last commit: run `git show HEAD` (or `git diff HEAD~1`) to see it, including added files. The rule to check is in RULE.md. If TASK.md exists it states the task the change was meant to do. Decide whether the change breaks the rule in RULE.md. Answer ACCEPT or REJECT, then one sentence naming the evidence.';
export const HISTORY_VERBATIM = '**Neutral fixture history.** Exactly two commits on one branch: `base` ("fixture") and `change` ("change"). There are no other refs or tags, and no author intent in any message, file name or path. `git log`/`show` therefore leak nothing. A validator asserts this per item.';
export const CHURN_VERBATIM = '**Churn heuristic, frozen:** REJECT iff the change touches any file not named in TASK.md, or changes more than 40 lines (added+deleted). Without a TASK.md, only the 40-line rule applies.';
export const BEST_BASELINE_VERBATIM = [
  '**Best baseline, one definition everywhere** (gate AND primary): among {each tool, OR-of-tools}, the one with the highest BA subject to FR ≤ 15% on GREEN items.',
  'Ties → the lower FR, then the fixed tool order [tsc, eslint, prettier, churn, OR].',
  'If none reaches FR ≤ 15%, the hardness gate passes (published explicitly) and the primary compares against always-RED / prevalence-random, reported as such.',
];
export const PRIMARY_VERBATIM = 'BA difference = BA(reviewer item-majority) − BA(best baseline). The bar is: difference ≥ 0.20 AND the 95% lower bound of a **class-stratified bootstrap** > 0. The bootstrap resamples items within RED and within GREEN, 10,000 resamples, seed 10010.';
export const FLOORS_VERBATIM = [
  'fewer than 10 eligible rules after the blind filter → "too few buildable rules";',
  'after label-disagreement exclusions, fewer than 30 RED or fewer than 30 GREEN items → "unlabelable at this N";',
  'if the human spot-check disagrees with the agreed label on more than 10% of the spot-checked items → the agreement gate fails.',
];
export const CEILING_VERBATIM = '**Pre-counted ceiling trip:** if pre-counted spend reaches $30 before the counted runs, STOP. Do not start the counted runs; disclose; ask the founder.';
export const CLAIM_VERBATIM = "On code changes that break, or respect, rules that EXP 007's census found not expressible in bce 0.3.1, nina's reviewer separates violating from clean changes better than the best frozen off-the-shelf model-free baseline. Both are measured at a matched false-reject budget.";

export const ALL_PLUGINS = ['hunch', 'jev-pref', 'abide', 'limpet', 'jev-belay', 'jev-engineering', 'pi-verdict', 'jev-axi'];
export const TOOL_IDS = ['tsc-unused', 'eslint-tseslint-recommended', 'prettier-check', 'churn'];
export const CODES = ['ELIGIBLE', 'X-PROCESS', 'X-TRANSCRIPT', 'X-TOOLCALL', 'X-COMMIT', 'X-WITHHELD', 'X-RUST', 'X-META', 'X-OTHER'];
// The EXP 006 reviewer machinery EXP 011 reuses by reference: pinned by sha256 here and, in the tests, against odin-rnd
// main at the base commit of this pre-registration.
export const EXP006_REUSED = ['run_reviewer6.mjs', 'stream6.mjs', 'fence6.mjs', 'scrub6.mjs', 'spend6.mjs', 'guard6.mjs', 'diff-seen.mjs', 'fingerprints.mjs', 'amendment-01.json'].map(f => `${N}/${f}`);
export const REUSE_COMMIT = '5b5c68189a047029278fe24df80cbd8b0c9a51a3';

// The files the analysis depends on. The record pins exactly these; never its own validator, the note or the isolation check.
export const PINNED = [
  ...['criteria.md', 'eligibility.json', 'not-rules.json', 'baselines.json', 'prompt.md', 'fixture.sha256', 'rules/hunch.json', 'rules/abide.json', 'rules/jev-axi.json'].map(f => `${D}/${f}`),
  'scripts/reviewer-keep-stats.mjs',
];
export const NOT_PINNED = ['scripts/reviewer-keep-prereg.mjs', 'scripts/reviewer-keep-note.mjs', 'scripts/reviewer-keep-isolation.mjs', recordPath, pinPath];

const hex = /^[a-f0-9]{64}$/, sha40 = /^[a-f0-9]{40}$/;
const str = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(str);
const int = v => Number.isInteger(v) && v >= 0;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fileRef = v => obj(v) && str(v.file) && hex.test(v.sha256);

export const required = {
  schemaVersion: v => v === 1,
  kind: v => v === 'preregistration',
  'experiment.id': v => v === 'EXP 011', 'experiment.slug': v => v === 'reviewer-keep', 'experiment.title': v => v === 'Where does a model reviewer earn its keep?',
  'experiment.status': v => v === 'pre-registered', 'experiment.statusText': v => v === statusText, 'experiment.authoredOn': date, 'experiment.summary': str, 'experiment.note': str,
  claim: v => v === CLAIM_VERBATIM, question: v => str(v) && v.includes('frozen rule-filtered off-the-shelf tools') && /reviewer's own item-level false-reject rate/.test(v),
  claimReading: v => str(v) && v.includes(COMPARATOR_NAME) && /both sides/.test(v), comparatorName: v => v === COMPARATOR_NAME,
  preconditions: v => strings(v) && /FIRST paid call/.test(v[0]) && v.some(x => /lockfile/.test(x)) && v.some(x => /verified to exist/.test(x)) && v.some(x => /clean under all four/.test(x)),
  'parents.exp005.preregistration': fileRef, 'parents.exp005.results': fileRef, 'parents.exp005.finding': str,
  'parents.exp006.preregistration': fileRef, 'parents.exp006.amendment01': fileRef, 'parents.exp006.results': fileRef, 'parents.exp006.finding': str,
  'parents.exp007.preregistration': fileRef, 'parents.exp007.amendment01': fileRef, 'parents.exp007.results': fileRef, 'parents.exp007.finding': str,
  'parents.exp007.primaryClasses': v => obj(v) && int(v.expressible) && int(v.partial) && int(v.not) && int(v.error),
  'eligibility.criteria': fileRef, 'eligibility.decisions': fileRef, 'eligibility.notRules': fileRef, 'eligibility.source': str, 'eligibility.decidedBy': str,
  'eligibility.rules': v => v === 50, 'eligibility.eligible': v => v === 18, 'eligibility.excluded': v => v === 32, 'eligibility.uncertain': int,
  'eligibility.perCode': v => obj(v) && Object.keys(v).every(k => CODES.includes(k)), 'eligibility.perPlugin': obj, 'eligibility.killFloor': str,
  'rules.dir': v => v === `${D}/rules`, 'rules.plugins': v => Array.isArray(v) && v.length > 0, 'rules.recordSha256': obj, 'rules.statement': str, 'rules.ruleFileShown': str,
  'fixture.dir': v => v === `${D}/fixture`, 'fixture.manifest': fileRef, 'fixture.files': int, 'fixture.language': v => v === 'TypeScript', 'fixture.description': str, 'fixture.taskTemplate': str,
  'fixture.history': v => v === HISTORY_VERBATIM, 'fixture.baseCleanliness': str, 'fixture.authoredBy': str,
  'items.perRule.red': v => v === 2, 'items.perRule.green': v => v === 2, 'items.red': int, 'items.green': int, 'items.total': int,
  'items.nearMiss': str, 'items.shown': str, 'items.cleanMeans': str, 'items.onePrior': str, 'items.status': str,
  'items.controls.statement': str, 'items.controls.batch': str, 'items.controls.batches': int, 'items.controls.items': int,
  'labels.author.family': str, 'labels.author.model': v => v === TO_BE_PINNED, 'labels.author.fence': str,
  'labels.labeller.family': str, 'labels.labeller.model': v => v === TO_BE_PINNED, 'labels.labeller.blind': str,
  'labels.humanSpotCheck.n': v => v === 16, 'labels.humanSpotCheck.red': v => v === 8, 'labels.humanSpotCheck.green': v => v === 8, 'labels.humanSpotCheck.seed': v => v === 10011, 'labels.humanSpotCheck.share': str, 'labels.humanSpotCheck.procedure': v => str(v) && /spotCheckSample/.test(v), 'labels.agreementBar.rawAgreement': v => v === 0.9, 'labels.agreementBar.kappa': v => v === 0.7, 'labels.agreementBar.fixForwardRounds': v => v === 1,
  'labels.agreementBar.statement': str, 'labels.disagreements': str,
  'arms.reviewer.nina.release': v => v === '0.34.0', 'arms.reviewer.nina.commit': v => sha40.test(v), 'arms.reviewer.nina.integrity': str,
  'arms.reviewer.model': v => v === 'claude-opus-5-5', 'arms.reviewer.client': str, 'arms.reviewer.clientVersion': v => v === '2.1.280', 'arms.reviewer.effort': v => v === 'high',
  'arms.reviewer.runsPerItem': v => v === 3, 'arms.reviewer.prompt': fileRef, 'arms.reviewer.promptText': v => v === PROMPT_VERBATIM, 'arms.reviewer.promptComparable': v => v === false,
  'arms.reviewer.ignoreList': str, 'arms.reviewer.reusedFromExp006': v => obj(v) && v.commit === REUSE_COMMIT && obj(v.files), 'arms.reviewer.statement': str,
  'arms.baselines.mapping': fileRef, 'arms.baselines.tools': v => Array.isArray(v) && v.length === TOOL_IDS.length, 'arms.baselines.or': str,
  'arms.baselines.churn': v => v === CHURN_VERBATIM, 'arms.baselines.rulesWithoutTool': v => Array.isArray(v), 'arms.baselines.statement': str,
  'arms.references': strings, 'arms.jev': str,
  'scoring.scorer': fileRef, 'scoring.primary.verbatim': v => v === PRIMARY_VERBATIM, 'scoring.primary.bar': v => v === 0.2, 'scoring.primary.seed': v => v === 10010, 'scoring.primary.resamples': v => v === 10000,
  'scoring.primary.matchedBudget': v => str(v) && /reviewer's item-level false-reject rate on GREEN items <= 15%/.test(v), 'scoring.primary.reviewerFrBudget': v => v === 0.15, 'scoring.primary.runsPerItem': str,
  'scoring.primary.interval': str, 'scoring.primary.comparatorFixed': str, 'scoring.primary.itemCall': str, 'scoring.primary.reported': str,
  'scoring.bestBaseline': v => Array.isArray(v) && v.length === 3 && v.every((t, i) => t === BEST_BASELINE_VERBATIM[i]),
  'scoring.secondary': v => Array.isArray(v) && v.length >= 3 && v.every(m => str(m.id) && str(m.statement)),
  'scoring.hardnessGate': str, 'scoring.manipulation': str, 'scoring.controls': str,
  floors: v => Array.isArray(v) && v.length === 3 && v.every((t, i) => t === FLOORS_VERBATIM[i]), kills: strings,
  'spend.capUsd': v => v === 80, 'spend.capStatus': v => v === CAP_STATUS, 'spend.preCountedCeilingUsd': v => v === 30, 'spend.ceilingTrip': v => v === CEILING_VERBATIM,
  'spend.estimate': v => Array.isArray(v) && v.length > 0 && v.every(r => str(r.item) && typeof r.lowUsd === 'number' && typeof r.highUsd === 'number'),
  'spend.countedRuns': int, 'spend.perRunUsd': v => Array.isArray(v) && v.length === 2, 'spend.breaker': str, 'spend.fallback': str, 'spend.thisBundle': str,
  notBefore: v => v === NOT_BEFORE,
  limits: strings,
  publication: v => v === 'every outcome published',
  status: v => v === statusText,
  decisions: strings,
  files: v => obj(v) && Object.values(v).every(h => hex.test(h)),
};

export const get = (record, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), record);

export function validateRecord(record) {
  assert(obj(record), 'The pre-registration must be a JSON object');
  for (const [path, check] of Object.entries(required)) assert(check(get(record, path)), `Pre-registration field ${path} is missing or invalid`);
  assert.deepEqual(Object.keys(record.files), PINNED, 'The record pins exactly the analysis files, in order');
  for (const f of NOT_PINNED) assert(!(f in record.files), `${f} is never pinned`);
  const e = record.eligibility;
  assert.equal(e.eligible + e.excluded, e.rules, 'Eligibility counts do not add up');
  assert.equal(Object.values(e.perCode).reduce((a, b) => a + b, 0), e.rules, 'Per-code counts do not add up');
  assert.equal(e.perCode.ELIGIBLE, e.eligible, 'ELIGIBLE count');
  assert.equal(Object.values(e.perPlugin).reduce((a, b) => a + b, 0), e.eligible, 'Per-plugin counts do not add up');
  assert.equal(record.items.red, e.eligible * record.items.perRule.red, 'RED items = eligible rules x 2');
  assert.equal(record.items.green, e.eligible * record.items.perRule.green, 'GREEN items = eligible rules x 2');
  assert.equal(record.items.total, record.items.red + record.items.green, 'Item total');
  assert.equal(record.spend.countedRuns, record.arms.reviewer.runsPerItem * (record.items.total + record.items.controls.items), 'Counted runs = 3 x (items + control items)');
  const counted = record.spend.estimate.find(r => r.item.startsWith('Counted runs'));
  assert(counted && Math.abs(counted.lowUsd - record.spend.countedRuns * record.spend.perRunUsd[0]) < 0.005 && Math.abs(counted.highUsd - record.spend.countedRuns * record.spend.perRunUsd[1]) < 0.005, 'The counted-runs estimate is runs x per-run cost');
  const preCounted = record.spend.estimate.filter(r => !r.item.startsWith('Counted runs')).reduce((s, r) => s + r.highUsd, 0);
  assert(preCounted <= record.spend.preCountedCeilingUsd, 'The pre-counted estimate fits under the ceiling at its high end');
  assert(record.spend.estimate.reduce((s, r) => s + r.highUsd, 0) <= record.spend.capUsd, 'The whole estimate fits under the proposed cap at its high end');
  assert(record.limits.some(l => l.includes(`abide ${e.perPlugin.abide}/${e.eligible}`)), 'The abide skew is stated as a limit, with the computed counts');
  assert(record.limits.some(l => l.includes('7/36')) && record.limits.some(l => /unreachable/.test(l)), 'The unmapped-rule advantage and the unreachable no-baseline branch are disclosed');
  assert(record.scoring.secondary.some(m => m.id === 'mapped-unmapped'), 'The mapped/unmapped subgroup secondary is reported');
  assert(/OFF/.test(record.arms.jev) && /never from data/.test(record.arms.jev), 'Jev is OFF, decided before any data');
  const text = JSON.stringify(record);
  assert(!/(?<![\w\\])\/(?:Users|home|private)\//.test(text), 'Private local paths in the record');
  assert(!/Recorded experiment|results show/i.test(text), 'A pre-registration states no result');
  return record;
}

const readJson = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const walk = (root, dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(root, `${dir}/${e.name}`) : [`${dir}/${e.name}`]));

/** The 50 not-class primary rules, recomputed from EXP 007's census records (an attempt-2 record supersedes attempt 1). */
export function notClassRules(root = '.') {
  const out = [];
  for (const p of ALL_PLUGINS) {
    for (const r of readJson(root, `${BF}/rules/${p}.json`).rules) {
      if (r.stratum !== 'primary') continue;
      const rel = r.ruleId.slice(p.length + 1);
      const second = `${BF}/census-attempt-2/${p}/${rel}.json`;
      const file = existsSync(join(root, second)) ? second : `${BF}/census/${p}/${rel}.json`;
      if (readJson(root, file).final.final === 'not') out.push(r.ruleId);
    }
  }
  return out;
}

/** The vendored rule files: each plugin's eligible records copied verbatim from EXP 007's rule file, by ruleId. */
export function vendoredRules(root = '.') {
  const eligible = readJson(root, `${D}/eligibility.json`).filter(x => x.eligible).map(x => x.ruleId);
  const files = {};
  for (const p of ALL_PLUGINS) {
    const ids = eligible.filter(id => id.startsWith(`${p}/`));
    if (!ids.length) continue;
    const sourceFile = `${BF}/rules/${p}.json`, licenseFile = `${BF}/rules/licenses/${p}.LICENSE`;
    const src = readJson(root, sourceFile);
    const rules = ids.map(id => { const r = src.rules.find(x => x.ruleId === id); assert(r, `${id} is not in ${sourceFile}`); return r; });
    const body = {
      schemaVersion: 1, kind: 'vendored-rules', experiment: 'EXP 011', plugin: p, repo: src.repo, sha: src.sha, license: src.license, copyright: src.copyright,
      source: { file: sourceFile, sha256: sha256(readFileSync(join(root, sourceFile))) },
      licenseFile: { file: licenseFile, sha256: sha256(readFileSync(join(root, licenseFile))) },
      statement: `The eligible ${p} rule records, copied verbatim (every field) from EXP 007's vendored rule file at the sha256 above. The licence is referenced, not duplicated.`,
      ruleIds: ids,
      recordSha256: Object.fromEntries(rules.map(r => [r.ruleId, sha256(JSON.stringify(r))])),
      rules,
    };
    files[`${D}/rules/${p}.json`] = JSON.stringify(body, null, 2) + '\n';
  }
  return files;
}

/** The fixture manifest: `<sha256>  <repository path>`, one line per file, sorted by path (sha256sum format, repository-rooted, as the frozen census reads it). */
export function fixtureManifest(root = '.') {
  const files = walk(root, `${D}/fixture`).sort();
  return files.map(f => `${sha256(readFileSync(join(root, f)))}  ${f}`).join('\n') + '\n';
}

// Everything in the record that is a fact about files on disk, recomputed from them.
export function derive(record, root = '.') {
  const read = file => readFileSync(join(root, file));
  const ref = file => ({ file, sha256: sha256(read(file)) });
  const next = structuredClone(record);
  const vendored = vendoredRules(root);
  const ruleFiles = Object.keys(vendored);
  next.files = Object.fromEntries(PINNED.map(f => [f, sha256(read(f))]));
  Object.assign(next.parents.exp005, { preregistration: ref(`${J}/preregistration.json`), results: ref(`${J}/results/results.json`) });
  Object.assign(next.parents.exp006, { preregistration: ref(`${N}/preregistration.json`), amendment01: ref(`${N}/amendment-01.json`), results: ref(`${N}/results/results.json`) });
  Object.assign(next.parents.exp007, { preregistration: ref(`${BF}/preregistration.json`), amendment01: ref(`${BF}/amendment-01.json`), results: ref(`${BF}/results/results.json`) });
  const classes = { expressible: 0, partial: 0, not: 0, error: 0 };
  for (const p of readJson(root, `${BF}/results/results.json`).score.perPlugin) for (const k of Object.keys(classes)) classes[k] += p[k];
  next.parents.exp007.primaryClasses = classes;
  const decisions = readJson(root, `${D}/eligibility.json`);
  const perCode = {};
  for (const c of CODES) { const n = decisions.filter(d => d.code === c).length; if (n) perCode[c] = n; }
  const perPlugin = {};
  for (const d of decisions.filter(x => x.eligible)) { const p = ALL_PLUGINS.find(x => d.ruleId.startsWith(`${x}/`)); perPlugin[p] = (perPlugin[p] ?? 0) + 1; }
  Object.assign(next.eligibility, { criteria: ref(`${D}/criteria.md`), decisions: ref(`${D}/eligibility.json`), notRules: ref(`${D}/not-rules.json`), rules: decisions.length, eligible: decisions.filter(d => d.eligible).length, excluded: decisions.filter(d => !d.eligible).length, uncertain: decisions.filter(d => d.uncertain).length, perCode, perPlugin });
  next.rules.plugins = ruleFiles.map(f => {
    const v = JSON.parse(vendored[f]);
    return { plugin: v.plugin, file: f, sha256: sha256(vendored[f]), repo: v.repo, sha: v.sha, license: v.license, copyright: v.copyright, source: v.source, licenseFile: v.licenseFile, rules: v.ruleIds.length };
  });
  next.rules.recordSha256 = Object.assign({}, ...ruleFiles.map(f => JSON.parse(vendored[f]).recordSha256));
  next.fixture.manifest = { file: manifestPath, sha256: sha256(fixtureManifest(root)) };
  next.fixture.files = fixtureManifest(root).trim().split('\n').length;
  const b = readJson(root, `${D}/baselines.json`);
  next.arms.baselines.mapping = ref(`${D}/baselines.json`);
  next.arms.baselines.tools = b.tools.map(t => ({ id: t.id, command: t.command, packages: t.packages }));
  next.arms.baselines.rulesWithoutTool = b.rules.filter(r => r.tools.length === 0).map(r => r.ruleId);
  next.arms.reviewer.prompt = ref(`${D}/prompt.md`);
  const nina = readJson(root, `${N}/preregistration.json`).reused.nina;
  Object.assign(next.arms.reviewer.nina, { release: nina.release, commit: nina.commit, integrity: nina.integrity });
  next.arms.reviewer.reusedFromExp006 = { commit: REUSE_COMMIT, files: Object.fromEntries(EXP006_REUSED.map(f => [f, sha256(read(f))])) };
  next.scoring.scorer = ref('scripts/reviewer-keep-stats.mjs');
  next.items.red = next.eligibility.eligible * next.items.perRule.red;
  next.items.green = next.eligibility.eligible * next.items.perRule.green;
  next.items.total = next.items.red + next.items.green;
  return next;
}

/** The frozen baseline mapping: the four tools at exact versions, the verbatim churn and best-baseline wording, and exactly the eligible rules. */
export function checkBaselines(b, eligible) {
  assert.deepEqual(b.rules.map(r => r.ruleId), eligible, 'The baseline mapping covers exactly the 18 eligible rules, in eligibility order');
  for (const r of b.rules) assert(Array.isArray(r.tools) && r.tools.every(t => TOOL_IDS.includes(t)) && new Set(r.tools).size === r.tools.length && str(r.reason), `${r.ruleId}: mapping`);
  assert.deepEqual(b.tools.map(t => t.id), TOOL_IDS, 'The four tools, in order');
  for (const t of b.tools) for (const v of Object.values(t.packages)) assert(/^\d+\.\d+\.\d+$/.test(v), `${t.id}: exact versions only`);
  assert.equal(b.churnHeuristic, CHURN_VERBATIM, 'The churn heuristic, verbatim');
  assert.deepEqual(b.bestBaseline, BEST_BASELINE_VERBATIM, 'The best-baseline definition and tie order, verbatim');
  assert.deepEqual(b.tieOrder, ['tsc', 'eslint', 'prettier', 'churn', 'OR']);
  assert(str(b.precondition) && /FIRST paid call/.test(b.precondition) && /lockfile/.test(b.precondition) && /clean under all four/.test(b.precondition), 'The baselines are a precondition of the first paid call');
  assert.equal(b.comparatorName, COMPARATOR_NAME);
  return b;
}

// Disk facts the record does not store but must agree with.
export function assertDisk(record, root = '.') {
  const read = file => readFileSync(join(root, file), 'utf8');
  const decisions = readJson(root, `${D}/eligibility.json`);
  const notRules = readJson(root, `${D}/not-rules.json`);
  assert.deepEqual(decisions.map(d => d.ruleId), notRules.map(r => r.ruleId), 'eligibility.json decides exactly the rules of not-rules.json, in order');
  assert.deepEqual([...notClassRules(root)].sort(), decisions.map(d => d.ruleId).sort(), "The 50 rules are exactly EXP 007's not-class primary rules, recomputed from its census records");
  for (const d of decisions) {
    assert(CODES.includes(d.code) && str(d.reason) && typeof d.uncertain === 'boolean', `${d.ruleId}: incomplete decision`);
    assert.equal(d.eligible, d.code === 'ELIGIBLE', `${d.ruleId}: eligible iff code ELIGIBLE`);
  }
  for (const r of notRules) {
    const p = ALL_PLUGINS.find(x => r.ruleId.startsWith(`${x}/`));
    const src = readJson(root, `${BF}/rules/${p}.json`).rules.find(x => x.ruleId === r.ruleId);
    assert(src && src.text === r.text && src.kind === r.kind && src.inputKind === r.inputKind && (src.context ?? null) === (r.context ?? null), `${r.ruleId}: not-rules.json differs from EXP 007's rule record`);
  }
  for (const [file, body] of Object.entries(vendoredRules(root))) assert.equal(read(file), body, `${file} is not the verbatim vendoring of EXP 007's records: run node scripts/reviewer-keep-prereg.mjs --write`);
  const ruleDir = readdirSync(join(root, D, 'rules')).map(f => `${D}/rules/${f}`).sort();
  assert.deepEqual(ruleDir, Object.keys(vendoredRules(root)).sort(), 'rules/ holds exactly the vendored plugin files');
  assert.deepEqual(Object.keys(vendoredRules(root)), PINNED.filter(f => f.startsWith(`${D}/rules/`)), 'the pinned rule files are the vendored ones');
  assert.equal(read(manifestPath), fixtureManifest(root), `${manifestPath} is not the fixture's manifest: run --write`);
  assert(!/(?<![\w\\])\/(?:Users|home|private)\//.test(fixtureManifest(root)), 'the manifest names no local path');
  checkBaselines(readJson(root, `${D}/baselines.json`), decisions.filter(d => d.eligible).map(d => d.ruleId));
  assert.equal(read(`${D}/prompt.md`), `${PROMPT_VERBATIM}\n`, 'prompt.md is the v3 prompt, verbatim');
  assert(existsSync(join(root, D, 'fixture', record.fixture.taskTemplate.replace(/^fixture\//, ''))), 'the TASK.md template is in the fixture');
  for (const f of walk(root, `${D}/fixture`)) assert(!/TASK\.md$|RULE\.md$/.test(f), `${f}: the fixture carries no live TASK.md or RULE.md (items add them)`);
}

export function checkRecord(root = '.') {
  const bytes = readFileSync(join(root, recordPath));
  const pinned = existsSync(join(root, pinPath)) ? readFileSync(join(root, pinPath), 'utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${recordPath} differs from the sha256 pinned in ${pinPath}: review the change, then node scripts/reviewer-keep-prereg.mjs --pin`);
  const record = validateRecord(JSON.parse(bytes));
  assert.deepEqual(record, derive(record, root), 'The record differs from the files on disk: run node scripts/reviewer-keep-prereg.mjs --write, review the diff, then --pin');
  assertDisk(record, root);
  return { record, sha256: sha256(bytes), bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--write') {
    mkdirSync(`${D}/rules`, { recursive: true });
    for (const [file, body] of Object.entries(vendoredRules())) writeFileSync(file, body);
    writeFileSync(manifestPath, fixtureManifest());
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const next = validateRecord(derive(record));
    writeFileSync(recordPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`Re-derived the vendored rules, the fixture manifest and ${recordPath} (sha256 ${sha256(readFileSync(recordPath))}). Review, then --pin.`);
    process.exit(0);
  } else if (command === '--pin') {
    validateRecord(JSON.parse(readFileSync(recordPath, 'utf8')));
    writeFileSync(pinPath, `${sha256(readFileSync(recordPath))}  preregistration.json\n`);
    console.log(`Pinned ${recordPath} in ${pinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/reviewer-keep-prereg.mjs --check | --write | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkRecord();
  console.log(`PASS ${recordPath} sha256 ${digest}`);
}
