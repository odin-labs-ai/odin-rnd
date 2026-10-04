import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_BEFORE, PREREG_SHA256, SERVED_URL } from '../experiments/blueprint-floor/freeze.mjs';
import { readPins, REPO_ROOT } from '../experiments/blueprint-floor/census-guard.mjs';
import { censusGate, computeCensusResults, gateFromData } from '../experiments/blueprint-floor/census-gate.mjs';
import { finalClass, loadCensusRules } from '../experiments/blueprint-floor/scorer.mjs';

// EXP 007 R6-2: the census gate. A valid counted fixture (synthetic records for the whole census, built here, never a
// model output) opens it; each check broken in turn keeps it closed. The variant is the scorer's kill output.

const prereg = JSON.parse(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.json'), 'utf8'));
const { rules, plugins } = loadCensusRules(REPO_ROOT);
const pins = readPins();
const scorerPin = prereg.files['experiments/blueprint-floor/scorer.mjs'];
const sha = s => createHash('sha256').update(s).digest('hex');

/** A complete, counted census: `classOf(i)` is each rule's class; every tenth rule disputed down to not. */
function fixture(classOf = i => ['expressible', 'partial', 'not'][i % 3]) {
  const records = {}, lines = [];
  let t = Date.parse(NOT_BEFORE) + 60_000;
  const iso = () => new Date((t += 1000)).toISOString();
  const call = (role, model, cost, ruleId) => ({ called: true, model, modelUsage: [model], costUsd: cost, costBasis: 'api-equivalent', reportedCostUsd: cost, callId: `counted:${ruleId}:${role}`, startedAt: iso(), endedAt: iso(), harnessFailure: null, rawSha256: sha(`${ruleId}${role}`), stdoutSha256: sha(`${ruleId}${role}out`) });
  rules.forEach((r, i) => {
    const cls = classOf(i);
    const tr = { ...call('translator', 'claude-opus-5-5', 0.0400001, r.ruleId), translatorClass: cls, classAfterMechanical: cls, failedCheck: null, engineLimit: false, mechanical: { schemaOk: true } };
    const disputed = i % 10 === 0 && cls !== 'not';
    const ad = { ...call('adjudicator', 'claude-sonnet-5', 0.0100003, r.ruleId), schemaOk: true, verdict: disputed ? 'dispute' : 'confirm', proposedClass: disputed ? 'not' : cls };
    const rec = { schemaVersion: 1, kind: 'census-record', experiment: 'EXP 007', mode: 'counted', rehearsal: false, fixture: false, preregSha256: PREREG_SHA256, notBefore: NOT_BEFORE, served: { url: SERVED_URL, sha256: PREREG_SHA256, fetchedAt: iso() }, code: pins, ruleId: r.ruleId, plugin: r.plugin, stratum: r.stratum, startedAt: tr.startedAt, endedAt: ad.endedAt, translator: tr, adjudicator: ad, translatorError: null, adjudicatorError: null, complete: true };
    rec.final = finalClass(rec);
    records[r.ruleId] = rec;
    for (const [role, c] of [['translator', tr], ['adjudicator', ad]]) lines.push({ ts: c.endedAt, kind: 'counted', ruleId: r.ruleId, role, model: c.model, costUsd: c.costUsd, costBasis: 'api-equivalent', reportedCostUsd: c.costUsd, rehearsal: false, callId: c.callId });
  });
  const pre = [['canary', 'canary', 'translator', 'claude-opus-5-5', 0.0312345], ['canary', 'canary', 'adjudicator', 'claude-sonnet-5', 0.0101234], ['practice', 'practice/01', 'translator', 'claude-opus-5-5', 0.0456789], ['practice', 'practice/01', 'adjudicator', 'claude-sonnet-5', 0.0123456]]
    .map(([kind, ruleId, role, model, c], n) => ({ ts: new Date(Date.parse(NOT_BEFORE) + 1000 * (n + 1)).toISOString(), kind, ruleId, role, model, costUsd: c, costBasis: 'api-equivalent', reportedCostUsd: c, rehearsal: false, callId: `${kind}:${role}` }));
  const all = [...pre, ...lines];
  const pcall = l => ({ called: true, model: l.model, modelUsage: [l.model], callId: l.callId, costUsd: l.costUsd, harnessFailure: null, startedAt: l.ts, endedAt: l.ts });
  const practiceRecord = { kind: 'census-practice', mode: 'practice', rehearsal: false, fixture: false, partial: null, askFork: false, preregSha256: PREREG_SHA256, code: pins,
    canary: { translator: { ...pcall(pre[0]), pass: true }, adjudicator: { ...pcall(pre[1]), pass: true } }, practice: { ruleId: 'practice/01', translator: pcall(pre[2]), adjudicator: pcall(pre[3]) } };
  const results = computeCensusResults({ rules, plugins, records, ledgerLines: all, denominator: prereg.census.rules, scorerSha256: scorerPin });
  return { records, recordFiles: Object.keys(records).map(id => `${id}.json`), ledgerText: `${all.map(l => JSON.stringify(l)).join('\n')}\n`, resultsBytes: JSON.stringify(results, null, 2), results, lines: all, practiceRecords: [practiceRecord] };
}
const models = { translator: 'claude-opus-5-5', adjudicator: 'claude-sonnet-5' };
const inputs = f => ({ resultsBytes: f.resultsBytes, records: f.records, recordFiles: f.recordFiles, ledgerText: f.ledgerText, practiceRecords: f.practiceRecords, models, rules, plugins, pins, freeze: { PREREG_SHA256, NOT_BEFORE }, preregDiskSha256: PREREG_SHA256, denominator: prereg.census.rules, scorerDiskSha256: scorerPin, scorerPin });
const FIX = fixture();
const closedBy = (mutate, re, label) => {
  const f = structuredClone(FIX);
  const i = inputs(f);
  mutate(i, f);
  const g = gateFromData(i);
  assert.equal(g.publishable, false, `${label}: the gate opened`);
  assert.equal(g.facts, null);
  assert.ok(g.failures.some(m => re.test(m)), `${label}: ${JSON.stringify(g.failures.slice(0, 4))}`);
};
const setResults = (i, edit) => { const r = JSON.parse(i.resultsBytes); edit(r); i.resultsBytes = JSON.stringify(r); };

test('a valid counted fixture opens the gate; the variant is the scorer\'s kill output (interim and refuted)', () => {
  assert.equal(rules.length, 188);
  const g = gateFromData(inputs(FIX));
  assert.deepEqual(g.failures, []);
  assert.equal(g.publishable, true);
  assert.equal(g.variant, FIX.results.score.kill.variant);
  assert.equal(g.variant, 'interim', 'a third of each plugin expressible, minus disputes: median >= 25%');
  assert.equal(g.facts.median.expressibleShare, FIX.results.score.median.expressibleShare);
  assert.equal(g.facts.spend.countedCalls, 376);
  assert.equal(g.facts.spend.excludedLines.length, 4);
  const low = fixture(() => 'not');
  const r = gateFromData(inputs(low));
  assert.deepEqual([r.publishable, r.variant, r.facts.kill.refuted], [true, 'refuted', true], 'median 0 < 25%: premise refuted');
});

test('each check broken in turn keeps the gate closed', () => {
  // The results record itself.
  closedBy(i => { i.resultsBytes = null; }, /no results record/, 'no results');
  closedBy(i => setResults(i, r => { r.fixture = true; }), /results are a fixture/, 'fixture flag');
  closedBy(i => setResults(i, r => { r.rehearsal = true; }), /results are a rehearsal/, 'rehearsal results');
  closedBy(i => setResults(i, r => { r.mode = 'practice'; }), /results are not counted/, 'practice results');
  // Records: fixture, practice, rehearsal.
  closedBy(i => { i.records['control/01'].fixture = true; }, /control\/01: a fixture record/, 'a fixture record');
  closedBy(i => { i.records['control/02'].mode = 'practice'; }, /control\/02: not a counted record \(mode practice\)/, 'a practice record');
  closedBy(i => { i.records['control/03'].rehearsal = true; }, /control\/03: a rehearsal record/, 'a rehearsal record');
  // The ruleId set.
  closedBy(i => { delete i.records['abide/api-key-never-logged']; i.recordFiles = i.recordFiles.filter(f => !f.startsWith('abide/api-key-never-logged')); }, /a partial set/, 'a partial set');
  closedBy(i => { i.recordFiles.push(i.recordFiles[5]); }, /duplicate record files/, 'a duplicate id');
  closedBy(i => { i.recordFiles.push('practice/01.json'); }, /record files outside the census: practice\/01/, 'a practice record file among the census');
  closedBy(i => { i.records['control/04'].ruleId = 'control/05'; }, /control\/04: the record names control\/05/, 'a record under another id');
  closedBy(i => { i.denominator = 187; }, /not the denominator 187/, 'another denominator');
  // Code, clock, freeze, scorer.
  closedBy(i => { i.records['control/06'].code = { ...i.records['control/06'].code, 'experiments/blueprint-floor/census-run.mjs': 'f'.repeat(64) }; }, /control\/06: its code shas differ/, 'code sha drift in a record');
  closedBy(i => { i.pins = { ...i.pins, 'experiments/blueprint-floor/adapter.mjs': 'f'.repeat(64) }; }, /code shas differ from runners\.sha256/, 'pins drift');
  closedBy(i => { i.records['control/07'].startedAt = NOT_BEFORE; }, /control\/07: a call started at or before the not-before/, 'a record at the not-before');
  closedBy(i => { i.records['control/08'].adjudicator.startedAt = '2026-10-03T12:00:00.000Z'; }, /control\/08: a call started at or before the not-before/, 'a call before the not-before');
  closedBy(i => { i.freeze = { PREREG_SHA256: null, NOT_BEFORE: null }; }, /not frozen/, 'an unfrozen freeze');
  closedBy(i => { i.preregDiskSha256 = 'a'.repeat(64); }, /on disk is not the frozen one/, 'another pre-registration on disk');
  closedBy(i => { i.records['control/09'].served = { ...i.records['control/09'].served, sha256: 'b'.repeat(64) }; }, /served record was not the frozen one/, 'another served record');
  closedBy(i => { i.scorerDiskSha256 = 'c'.repeat(64); }, /scorer on disk is not the pinned scorer/, 'a changed scorer');
  // The ledger.
  const ledgerWithout = (i, pred) => { i.ledgerText = i.ledgerText.split('\n').filter(Boolean).filter(l => !pred(JSON.parse(l))).map(l => `${l}\n`).join(''); };
  closedBy(i => ledgerWithout(i, l => l.ruleId === 'jev-pref/secrets/sec_leak' && l.role === 'adjudicator'), /a call with no ledger line \(a ledger gap\)/, 'a ledger gap');
  closedBy(i => { i.ledgerText += `${JSON.stringify({ ...JSON.parse(i.ledgerText.split('\n').at(-2)), callId: 'again' })}\n`; }, /two ledger lines for/, 'a duplicate ledger line');
  closedBy(i => { i.ledgerText += `${JSON.stringify({ ts: '2026-10-04T00:00:00Z', kind: 'counted', ruleId: 'practice/01', role: 'translator', model: 'm', costUsd: 0.1, costBasis: 'api-equivalent', reportedCostUsd: 0.1, rehearsal: false, callId: 'x' })}\n`; }, /a counted ledger line with no call in the records/, 'an extra counted line');
  closedBy(i => { i.ledgerText += `${JSON.stringify({ ts: '2026-10-04T00:00:00Z', kind: 'canary', ruleId: 'canary', role: 'translator', model: 'm', costUsd: 0.1, costBasis: 'api-equivalent', reportedCostUsd: 0.1, rehearsal: false, callId: 'y' })}\n`; }, /not exactly the ones the results disclose/, 'an undisclosed canary line');
  closedBy(i => { i.ledgerText = i.ledgerText.replace('"costUsd":0.0400001', '"costUsd":0.0400002').replace('"reportedCostUsd":0.0400001', '"reportedCostUsd":0.0400002'); }, /cost or call id differs from its ledger line/, 'a ledger cost that differs from the record');
  closedBy(i => { i.ledgerText += '{"ts":"x"}\n'; }, /are corrupt/, 'a corrupt ledger line');
  closedBy(i => setResults(i, r => { r.spend.countedUsd += 0.0000001; }), /spend sums are not exact at 7 dp/, 'a sum off by one unit');
  // The results tampered with.
  closedBy(i => setResults(i, r => { r.score.median.expressibleShare = 0.9; }), /not the scorer's recompute \(tampered\)/, 'results tamper');
  closedBy(i => setResults(i, r => { r.score.kill.variant = r.score.kill.variant === 'refuted' ? 'interim' : 'refuted'; }), /tampered/, 'the variant edited');
  closedBy(i => setResults(i, r => { r.scoreSha256 = 'd'.repeat(64); }), /scoreSha256 does not bind/, 'the binding sha edited');
  closedBy(i => { i.records['control/10'].translator.classAfterMechanical = 'expressible'; i.records['control/10'].final = finalClass(i.records['control/10']); }, /tampered/, 'a record class edited after the results');
  // A record missing a field the scorer or the gate reads.
  closedBy(i => { delete i.records['control/11'].translator.costUsd; }, /control\/11: translator\.costUsd missing/, 'a missing call field');
  closedBy(i => { delete i.records['control/12'].final; }, /control\/12: no final/, 'a missing record field');
  closedBy(i => { i.records['control/13'].final = { ...i.records['control/13'].final, final: 'expressible' }; }, /final is not the scorer's finalClass/, 'a final class that is not the scorer\'s');
});

test('refute r1 N1: the practice record, its canaries, its callIds, and the per-call harness and model facts', () => {
  closedBy(i => { i.practiceRecords = []; }, /no practice record/, 'no practice record');
  closedBy(i => { i.practiceRecords[0].canary.adjudicator.pass = false; }, /canaries did not both PASS/, 'a failed canary');
  closedBy(i => { i.practiceRecords[0].askFork = true; }, /no practice record that completed without an ASK-FORK/, 'an ASK-FORK practice');
  closedBy(i => { i.practiceRecords[0].partial = { reason: 'canary' }; }, /no practice record that completed/, 'a stopped practice');
  closedBy(i => { i.practiceRecords[0].rehearsal = true; }, /a practice record is a rehearsal or a fixture/, 'a rehearsed practice');
  closedBy(i => { i.practiceRecords[0].code = { ...i.practiceRecords[0].code, 'experiments/blueprint-floor/census-run.mjs': 'f'.repeat(64) }; }, /practice record was made under another pre-registration or other code/, 'practice on other code');
  closedBy(i => { i.practiceRecords[0].practice.translator.callId = 'practice:other'; }, /not exactly the calls of the practice records \(by callId\)/, 'an excluded line with no practice call');
  closedBy(i => { i.practiceRecords[0].canary.translator.costUsd = 0.0312346; }, /its cost differs from its ledger line/, 'a practice cost that differs');
  const r = 'control/05';
  const rescore = i => { i.records[r].final = finalClass(i.records[r]); };
  closedBy(i => { i.records[r].translator.harnessFailure = 'timeout'; rescore(i); }, /control\/05: a translator harness failure without an error class/, 'a translator timeout without an error class');
  closedBy(i => { i.records[r].translator.modelUsage = ['claude-opus-5-5', 'claude-haiku-4-5']; }, /control\/05: a translator call without an error class but with a harness failure or a model other than the pin/, 'a second model key');
  closedBy(i => { i.records[r].translator.modelUsage = ['claude-sonnet-5']; i.records[r].translator.model = 'claude-sonnet-5'; }, /a model other than the pin/, 'the translator on the adjudicator model');
  closedBy(i => { i.records[r].adjudicator.harnessFailure = 'nonzero-exit'; }, /control\/05: an adjudicator harness failure without an error class/, 'an adjudicator failure without an error');
  closedBy(i => { i.records[r].adjudicator.modelUsage = ['claude-opus-5-5']; }, /control\/05: an adjudicator call without an error class but with a harness failure or a model other than the pin/, 'the adjudicator on another model');
  closedBy(i => { i.models = undefined; }, /no pinned models/, 'no pinned models given');
  const g = gateFromData(inputs(FIX));
  assert.equal(g.facts.disclosures.length, 8, 'the disclosures travel with the facts');
});

test('refute r2 N7: canary calls are validated before their pass counts; the practice pair is required; each excluded line\'s kind matches its slot', () => {
  closedBy(i => { i.practiceRecords[0].canary.translator.harnessFailure = 'timeout'; }, /the translator canary call is not a sound call of the pinned model/, 'a canary pass on a failed call');
  closedBy(i => { i.practiceRecords[0].canary.adjudicator.modelUsage = ['claude-sonnet-5', 'claude-haiku-4-5']; }, /the adjudicator canary call is not a sound call/, 'a canary on two models');
  closedBy(i => { i.practiceRecords[0].canary.adjudicator.model = 'claude-opus-5-5'; i.practiceRecords[0].canary.adjudicator.modelUsage = ['claude-opus-5-5']; }, /adjudicator canary call is not a sound call/, 'a canary on the other role\'s model');
  closedBy(i => { i.practiceRecords[0].practice = null; }, /carries no complete practice pair/, 'no practice pair');
  closedBy(i => { i.practiceRecords[0].practice.adjudicator = { called: false }; }, /carries no complete practice pair/, 'half a practice pair');
  closedBy(i => { i.ledgerText = i.ledgerText.replace('"kind":"canary","ruleId":"canary","role":"translator"', '"kind":"practice","ruleId":"canary","role":"translator"'); setResults(i, r => { r.spend.excludedLines[0].kind = 'practice'; }); }, /is kind practice, but its practice-record slot is canary/, 'a canary line booked as practice');
});

test('the committed tree: no census has run, so the gate is closed', () => {
  const g = censusGate(REPO_ROOT);
  assert.deepEqual([g.publishable, g.variant, g.facts], [false, null, null]);
  assert.deepEqual(g.failures, ['no results record']);
});
