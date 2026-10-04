// EXP 007 census gate (PLAN-DETAIL R6-2): the ONLY place that decides whether the census results may be published, and in
// which variant. It is pinned in runners.sha256 and OWNS loading the results record, the per-rule census records and the
// spend ledger; a site renderer renders only what censusGate() returns: {publishable, variant: refuted|interim, facts}.
// The variant is the pinned scorer's kill output (scorer.mjs score().kill.variant), never a site choice.
//
// It opens only if ALL hold (each failure is listed; any one keeps it closed):
//   - the results record is EXP 007's census results, mode counted, not a fixture, not a rehearsal;
//   - the pre-registration is frozen, the one on disk hashes to the frozen sha, and the results and every record name it;
//   - the ruleId set of the records is exactly the census (selection's primary and secondary strata and the controls),
//     each exactly once (one record file per ruleId, no other record file), and its count is the pre-registered
//     denominator;
//   - every record is complete, counted, not a fixture or rehearsal, carries every field the scorer and this gate read,
//     its code shas equal runners.sha256, it and every call in it started after the not-before, and its served sha is the
//     frozen one;
//   - the ledger lines map 1:1 to the (ruleId, role) calls the records say were made (kind counted), every other line
//     (canary, practice) is exactly the list the results disclose, and every sum is exact at 7 dp;
//   - the scorer on disk is the pinned one, and the results' score is the scorer's recompute from the records (and its
//     sha256 binds it).
//   node experiments/blueprint-floor/census-gate.mjs --write-results   compute results/results.json from the committed records
//   node experiments/blueprint-floor/census-gate.mjs --check           print the gate's decision
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCensusRules, finalClass, score } from './scorer.mjs';
import { NOT_BEFORE, PREREG_SHA256 } from './freeze.mjs';
import { LEDGER, ROLES, sumUsd, units, validLine } from './census-spend.mjs';

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const DIR = 'experiments/blueprint-floor';
export const RESULTS_PATH = `${DIR}/results/results.json`;
export const RECORDS_DIR = `${DIR}/census`;
export const PINS_PATH = `${DIR}/runners.sha256`;
export const SCORER_PATH = `${DIR}/scorer.mjs`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const canonical = v => JSON.stringify(v, (_, x) => (isObject(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));

// ----------------------------------------------------------------------------- one record's shape

/** Every field of a record the scorer or this gate reads (removing any one makes the record invalid). */
export const RECORD_FIELDS = ['schemaVersion', 'kind', 'experiment', 'mode', 'rehearsal', 'fixture', 'preregSha256', 'notBefore', 'served', 'code', 'ruleId', 'stratum', 'startedAt', 'endedAt', 'translator', 'adjudicator', 'translatorError', 'adjudicatorError', 'final', 'complete'];
export const CALL_FIELDS = ['called', 'model', 'costUsd', 'costBasis', 'callId', 'startedAt', 'endedAt'];
export const TRANSLATOR_FIELDS = ['translatorClass', 'classAfterMechanical', 'failedCheck', 'engineLimit'];
export const TRANSLATOR_LIVE_FIELDS = ['modelUsage', 'harnessFailure', 'rawSha256', 'stdoutSha256', 'mechanical'];
export const ADJUDICATOR_FIELDS = ['verdict', 'proposedClass'];
export const ADJUDICATOR_LIVE_FIELDS = ['modelUsage', 'harnessFailure', 'rawSha256', 'stdoutSha256', 'schemaOk'];

/** The problems of one census record (an empty list when it is sound). */
export function recordProblems(rec, ruleId) {
  const p = [];
  if (!isObject(rec)) return [`${ruleId}: not a record`];
  for (const f of RECORD_FIELDS) if (!(f in rec)) p.push(`${ruleId}: no ${f}`);
  if (p.length) return p;
  if (rec.kind !== 'census-record' || rec.experiment !== 'EXP 007') p.push(`${ruleId}: not an EXP 007 census record`);
  if (rec.ruleId !== ruleId) p.push(`${ruleId}: the record names ${rec.ruleId}`);
  if (rec.complete !== true) p.push(`${ruleId}: incomplete`);
  const t = rec.translator, a = rec.adjudicator;
  if (!isObject(t) || t.called !== true) p.push(`${ruleId}: no translator call`);
  else {
    for (const f of [...CALL_FIELDS, ...TRANSLATOR_FIELDS, ...(t.lost ? [] : TRANSLATOR_LIVE_FIELDS)]) if (!(f in t)) p.push(`${ruleId}: translator.${f} missing`);
  }
  if (!isObject(a)) p.push(`${ruleId}: no adjudicator entry`);
  else if (a.called === true) { for (const f of [...CALL_FIELDS, ...ADJUDICATOR_FIELDS, ...(a.lost ? [] : ADJUDICATOR_LIVE_FIELDS)]) if (!(f in a)) p.push(`${ruleId}: adjudicator.${f} missing`); }
  else if (a.called !== false || typeof a.reason !== 'string') p.push(`${ruleId}: the adjudicator entry says neither called nor why not`);
  else if (!rec.translatorError && !rec.adjudicatorError) p.push(`${ruleId}: no adjudicator call and no error to explain it`);
  if (!p.length && canonical(rec.final) !== canonical(finalClass(rec))) p.push(`${ruleId}: final is not the scorer's finalClass of the record`);
  return p;
}
/** The (role -> call) entries a record says were made and charged. */
export const calledRoles = rec => ROLES.filter(r => rec?.[r]?.called === true).map(role => ({ role, call: rec[role] }));

// ----------------------------------------------------------------------------- the results record

/**
 * The results record from the census records and the ledger, computed by the pinned scorer. Throws on any unsound
 * record (a missing field, an incomplete record, a ruleId outside the census or missing from it).
 */
export function computeCensusResults({ rules, plugins, records, ledgerLines, denominator, scorerSha256 }) {
  const ids = rules.map(r => r.ruleId);
  const missing = ids.filter(id => !records[id]);
  if (missing.length) throw new Error(`no record for ${missing.length} census rule(s): ${missing.slice(0, 5).join(', ')}`);
  const extra = Object.keys(records).filter(id => !ids.includes(id));
  if (extra.length) throw new Error(`records outside the census: ${extra.slice(0, 5).join(', ')}`);
  const problems = ids.flatMap(id => recordProblems(records[id], id));
  if (problems.length) throw new Error(`unsound census records: ${problems.slice(0, 5).join('; ')}`);
  const one = (field, label, pick = r => r[field]) => {
    const values = [...new Set(ids.map(id => canonical(pick(records[id]) ?? null)))];
    if (values.length !== 1) throw new Error(`the records disagree on ${label}`);
    return JSON.parse(values[0]);
  };
  const recs = ids.map(id => records[id]);
  const counted = ledgerLines.filter(l => l.kind === 'counted'), excluded = ledgerLines.filter(l => l.kind !== 'counted');
  const scoreOut = score({ rules, records, plugins });
  const calls = recs.flatMap(r => calledRoles(r).map(c => c.call));
  return {
    schemaVersion: 1, kind: 'census-results', experiment: 'EXP 007',
    mode: one('mode', 'the mode'), rehearsal: one('rehearsal', 'rehearsal'), fixture: one('fixture', 'fixture'),
    preregSha256: one('preregSha256', 'the pre-registration'), notBefore: one('notBefore', 'the not-before'), servedSha256: one('served', 'the served record', r => r.served?.sha256),
    code: one('code', 'the code'), scorer: { file: SCORER_PATH, sha256: scorerSha256 },
    denominator, rules: ids.length,
    measured: { firstCallStartedAt: calls.map(c => c.startedAt).sort()[0] ?? null, lastCallEndedAt: calls.map(c => c.endedAt).sort().at(-1) ?? null },
    spend: {
      countedCalls: counted.length, countedUsd: sumUsd(counted), excludedUsd: sumUsd(excluded), totalUsd: sumUsd(ledgerLines),
      excludedLines: excluded.map(({ ts, kind, ruleId, role, model, costUsd, costBasis }) => ({ ts, kind, ruleId, role, model, costUsd, costBasis })),
      basis: 'API-equivalent total_cost_usd under subscription auth; an unknown cost is charged its pre-registered bound',
    },
    score: scoreOut, scoreSha256: sha256(canonical(scoreOut)),
  };
}

// ----------------------------------------------------------------------------- the gate

const parseLedger = text => text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } });

/**
 * The gate from in-memory inputs (tests inject them; censusGate() reads them from disk). Returns {publishable, variant,
 * facts, failures}: publishable only when failures is empty.
 */
export function gateFromData({ resultsBytes, records, recordFiles, ledgerText, rules, plugins, pins, freeze = { PREREG_SHA256, NOT_BEFORE }, preregDiskSha256, denominator, scorerDiskSha256, scorerPin }) {
  const failures = [];
  const fail = m => failures.push(m);
  const closed = () => ({ publishable: false, variant: null, facts: null, failures });
  if (!resultsBytes) { fail('no results record'); return closed(); }
  let results;
  try { results = JSON.parse(resultsBytes); } catch { fail('the results record is not JSON'); return closed(); }
  if (results?.kind !== 'census-results' || results.experiment !== 'EXP 007') { fail('the results record is not EXP 007\'s census results'); return closed(); }
  if (results.mode !== 'counted') fail(`the results are not counted (mode ${results.mode})`);
  if (results.fixture !== false) fail('the results are a fixture');
  if (results.rehearsal !== false) fail('the results are a rehearsal');

  // The frozen pre-registration.
  if (!freeze?.PREREG_SHA256 || !freeze?.NOT_BEFORE) fail('the pre-registration is not frozen (freeze.mjs)');
  if (preregDiskSha256 !== freeze?.PREREG_SHA256) fail('the pre-registration on disk is not the frozen one');
  if (results.preregSha256 !== freeze?.PREREG_SHA256) fail('the results were made under another pre-registration');
  if (results.notBefore !== freeze?.NOT_BEFORE) fail('the results carry another not-before');
  if (scorerDiskSha256 !== scorerPin) fail('the scorer on disk is not the pinned scorer');
  if (results.scorer?.sha256 !== scorerPin) fail('the results were not computed by the pinned scorer');

  // The ruleId set: exactly the census, once each, the pre-registered denominator.
  const ids = rules.map(r => r.ruleId);
  if (new Set(ids).size !== ids.length) fail('the census rule list has a duplicate ruleId');
  if (ids.length !== denominator) fail(`the census has ${ids.length} rules, not the denominator ${denominator}`);
  if (results.denominator !== denominator || results.rules !== denominator) fail('the results do not state the pre-registered denominator');
  const fileIds = recordFiles.map(f => f.replace(/\.json$/, ''));
  const dupFiles = fileIds.filter((id, i) => fileIds.indexOf(id) !== i);
  if (dupFiles.length) fail(`duplicate record files: ${[...new Set(dupFiles)].join(', ')}`);
  const extraFiles = fileIds.filter(id => !ids.includes(id));
  if (extraFiles.length) fail(`record files outside the census: ${extraFiles.slice(0, 5).join(', ')}`);
  const missing = ids.filter(id => !records[id]);
  if (missing.length) fail(`no record for ${missing.length} census rule(s) (a partial set): ${missing.slice(0, 5).join(', ')}`);

  // Every record.
  const notBefore = Date.parse(freeze?.NOT_BEFORE ?? '');
  for (const id of ids.filter(i => records[i])) {
    const rec = records[id];
    for (const p of recordProblems(rec, id)) fail(p);
    if (!isObject(rec)) continue;
    if (rec.mode !== 'counted') fail(`${id}: not a counted record (mode ${rec.mode})`);
    if (rec.fixture !== false) fail(`${id}: a fixture record`);
    if (rec.rehearsal !== false) fail(`${id}: a rehearsal record`);
    if (rec.preregSha256 !== freeze?.PREREG_SHA256 || rec.notBefore !== freeze?.NOT_BEFORE) fail(`${id}: made under another pre-registration or not-before`);
    if (rec.served?.sha256 !== freeze?.PREREG_SHA256) fail(`${id}: the served record was not the frozen one at run start`);
    if (!pins || canonical(rec.code) !== canonical(pins)) fail(`${id}: its code shas differ from runners.sha256`);
    const starts = [rec.startedAt, ...calledRoles(rec).map(c => c.call.startedAt)];
    if (!starts.every(s => Number.isFinite(Date.parse(s)) && Date.parse(s) > notBefore)) fail(`${id}: a call started at or before the not-before`);
  }
  if (!pins || canonical(results.code) !== canonical(pins)) fail('the results name other code than runners.sha256');

  // The ledger: 1:1 with the calls the records made, the rest exactly the disclosed list, sums exact at 7 dp.
  const lines = parseLedger(ledgerText ?? '');
  const bad = lines.map((l, i) => (validLine(l) ? null : i + 1)).filter(Boolean);
  if (bad.length) fail(`ledger line(s) ${bad.join(', ')} are corrupt`);
  else {
    if (lines.some(l => l.rehearsal)) fail('the ledger holds rehearsal lines');
    const counted = lines.filter(l => l.kind === 'counted'), excluded = lines.filter(l => l.kind !== 'counted');
    const key = (ruleId, role) => `${ruleId}\u0000${role}`;
    const byKey = new Map();
    for (const l of counted) { const k = key(l.ruleId, l.role); if (byKey.has(k)) fail(`two ledger lines for ${l.ruleId} ${l.role}`); byKey.set(k, l); }
    const made = new Set();
    for (const id of ids.filter(i => isObject(records[i]))) {
      for (const { role, call } of calledRoles(records[id])) {
        const k = key(id, role); made.add(k);
        const l = byKey.get(k);
        if (!l) fail(`${id} ${role}: a call with no ledger line (a ledger gap)`);
        else if (l.costUsd !== call.costUsd || l.callId !== call.callId) fail(`${id} ${role}: the record's cost or call id differs from its ledger line`);
      }
    }
    for (const [k, l] of byKey) if (!made.has(k)) fail(`a counted ledger line with no call in the records: ${l.ruleId} ${l.role}`);
    const disclosed = (results.spend?.excludedLines ?? []);
    const actual = excluded.map(({ ts, kind, ruleId, role, model, costUsd, costBasis }) => ({ ts, kind, ruleId, role, model, costUsd, costBasis }));
    if (canonical(disclosed) !== canonical(actual)) fail('the practice and canary lines are not exactly the ones the results disclose');
    if (units(results.spend?.countedUsd ?? NaN) !== units(sumUsd(counted)) || units(results.spend?.excludedUsd ?? NaN) !== units(sumUsd(excluded)) || units(results.spend?.totalUsd ?? NaN) !== units(sumUsd(lines)) || results.spend?.countedCalls !== counted.length) fail('the spend sums are not exact at 7 dp');
  }

  // The score: the pinned scorer's recompute, bound by sha256.
  let recomputed = null;
  try { recomputed = score({ rules, records: Object.fromEntries(ids.filter(i => records[i]).map(i => [i, records[i]])), plugins }); } catch (error) { fail(`the scorer refused the records: ${error.message}`); }
  if (recomputed) {
    if (canonical(results.score) !== canonical(recomputed)) fail('the results\' score is not the scorer\'s recompute (tampered)');
    if (results.scoreSha256 !== sha256(canonical(recomputed))) fail('the results\' scoreSha256 does not bind the recompute');
  }
  if (failures.length) return closed();
  const s = recomputed;
  return {
    publishable: true, variant: s.kill.variant, failures,
    facts: {
      preregSha256: results.preregSha256, notBefore: results.notBefore, denominator, measured: results.measured, spend: results.spend,
      kill: s.kill, median: s.median, perPlugin: s.perPlugin, pluginsWithoutRules: s.pluginsWithoutRules, secondary: s.secondary, controls: s.controls,
      calibrated: s.controls.calibrated, agreement: s.agreement, disputes: s.disputes, downgrades: s.downgrades, engineLimit: s.engineLimit, errors: s.errors,
      abide: s.abide, breakdown: s.breakdown,
    },
  };
}

// ----------------------------------------------------------------------------- reading from disk

/** Every *.json under the records dir, as a path relative to it (the run log runs.jsonl is not a record). */
export function recordFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) out.push(relative(dir, p).split('\\').join('/')); } };
  walk(dir);
  return out.sort();
}
export function readRecords(dir, files) {
  const records = {};
  for (const f of files) { try { records[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { records[f.replace(/\.json$/, '')] = 'unparseable'; } }
  return records;
}
export function readPinsFile(root) {
  const path = join(root, PINS_PATH);
  if (!existsSync(path)) return null;
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { const [h, rel] = l.split('  '); return [rel, h]; }));
}
const bytesOrNull = path => (existsSync(path) ? readFileSync(path) : null);

/** The census inputs from the committed files under `root`. */
export function loadInputs(root = REPO_ROOT, { recordsDir = join(root, RECORDS_DIR), ledgerPath = join(root, LEDGER) } = {}) {
  const preregBytes = readFileSync(join(root, DIR, 'preregistration.json'));
  const prereg = JSON.parse(preregBytes);
  const { rules, plugins } = loadCensusRules(root);
  const recordFiles = recordFilesUnder(recordsDir);
  return {
    prereg, rules, plugins, recordFiles, records: readRecords(recordsDir, recordFiles),
    ledgerText: existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '',
    pins: readPinsFile(root), preregDiskSha256: sha256(preregBytes), denominator: prereg.census.rules,
    scorerDiskSha256: sha256(readFileSync(join(root, SCORER_PATH))), scorerPin: prereg.files[SCORER_PATH],
  };
}

/** The one entry point: the gate over the committed records, under the committed freeze.mjs. */
export function censusGate(root = REPO_ROOT, { freeze } = {}) {
  const i = loadInputs(root);
  return gateFromData({ ...i, resultsBytes: bytesOrNull(join(root, RESULTS_PATH)), ...(freeze ? { freeze } : {}) });
}

/** Writes results/results.json from the committed records and ledger (the pinned scorer computes it). */
export function writeResults(root = REPO_ROOT) {
  const i = loadInputs(root);
  const results = computeCensusResults({ rules: i.rules, plugins: i.plugins, records: i.records, ledgerLines: parseLedger(i.ledgerText), denominator: i.denominator, scorerSha256: i.scorerDiskSha256 });
  mkdirSync(join(root, DIR, 'results'), { recursive: true });
  writeFileSync(join(root, RESULTS_PATH), `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    if (argv.includes('--write-results')) { const r = writeResults(); console.log(`wrote ${RESULTS_PATH} (variant ${r.score.kill.variant}, median ${r.score.median.expressibleShare})`); }
    const g = censusGate();
    console.log(JSON.stringify({ publishable: g.publishable, variant: g.variant, failures: g.failures.slice(0, 20) }, null, 2));
    process.exit(g.publishable ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
