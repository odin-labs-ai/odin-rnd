import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREREG_SHA256, SERVED_URL } from '../experiments/blueprint-floor/freeze.mjs';
import { readPins, REPO_ROOT } from '../experiments/blueprint-floor/census-guard.mjs';
import { ADJUDICATOR_FIELDS, ADJUDICATOR_LIVE_FIELDS, CALL_FIELDS, computeCensusResults, gateFromData, readRecords, RECORD_FIELDS, recordFilesUnder, TRANSLATOR_FIELDS, TRANSLATOR_LIVE_FIELDS } from '../experiments/blueprint-floor/census-gate.mjs';
import { buildTranslatorPrompt } from '../experiments/blueprint-floor/protocol.mjs';
import { censusRules, runCensus } from '../experiments/blueprint-floor/census-run.mjs';
import { loadCensusRules } from '../experiments/blueprint-floor/scorer.mjs';
import { withFake } from './blueprint-floor-census-free.mjs';

// EXP 007 WO-2-02 rehearsal: ALL 188 pinned census rules through the REAL prompt builders, the REAL mechanical checks
// (adapter + bce-engine 0.3.1 validate + teeth, for the answers that decide something), the REAL runner loop, ledger and
// record writer, and the REAL pinned scorer, with the committed fake client emitting canned translator and adjudicator
// JSON. The result is a rehearsal and the gate refuses it for that alone; with the rehearsal markers flipped in memory it
// opens, so every field the gate needs is written by the runner. Removing any asserted field turns it RED.

const prereg = JSON.parse(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.json'), 'utf8'));
const sha = s => createHash('sha256').update(s).digest('hex');
const REHEARSAL_ONLY = /rehearsal|served record was not the frozen one/;

test('rehearsal: 188 rules -> builders -> fake client -> mechanical -> adjudicator -> records -> scorer -> gate (refused as a rehearsal only)', { timeout: 3_600_000 }, async () => {
  await withFake({}, async ({ paths, ledger, log }) => {
    const practice = await runCensus({ ...paths, mode: 'rehearsal', rehearsalOf: 'practice', log: () => {} });
    assert.equal(practice.partial, null);
    const run = await runCensus({ ...paths, mode: 'rehearsal', log: () => {} });
    assert.equal(run.partial, null);
    const census = censusRules();
    assert.deepEqual([run.completed, run.skipped, run.called], [188, 0, 376]);
    assert.equal(run.firstRuleId, 'control/01', 'controls first');

    // The order: controls, then the primary stratum (selection.json's plugin order, ruleId order), then the secondary.
    const calls = log().slice(4);
    const translatorCalls = calls.filter(c => c.role === 'translator');
    assert.equal(translatorCalls.length, 188);
    assert.deepEqual(translatorCalls.map(c => c.stdinSha256), census.map(r => sha(buildTranslatorPrompt(r).user)), 'every translator prompt is the real builder\'s, in the pinned order');
    assert.deepEqual(census.map(r => r.stratum).filter((s, i, a) => s !== a[i - 1]), ['control-positive', 'control-negative', 'primary', 'secondary']);

    const files = recordFilesUnder(paths.outDir);
    assert.equal(files.length, 188);
    const records = readRecords(paths.outDir, files);
    for (const r of census) {
      const rec = records[r.ruleId];
      assert.equal(rec.complete, true, r.ruleId);
      assert.equal(rec.translator.userSha256, sha(buildTranslatorPrompt(r).user), r.ruleId);
      assert.equal(rec.translator.rawSha256, sha(rec.translator.raw), `${r.ruleId}: the raw sha is recorded before the scrub (nothing to scrub here)`);
      assert.deepEqual(rec.code, readPins(), `${r.ruleId}: made by the pinned code`);
      assert.equal(rec.rehearsal, true);
      assert.match(rec.banner, /REHEARSAL/);
    }
    // The canned answers exercised the real checks: decisive answers went through bce validate and teeth.
    const decisive = Object.values(records).filter(r => r.translator.translatorClass !== 'not');
    assert.ok(decisive.length >= 10, `${decisive.length} decisive answers`);
    assert.ok(decisive.every(r => r.translator.mechanical.validate && (r.translator.mechanical.teeth || r.translator.failedCheck === 'flags')), 'validate and teeth ran');
    assert.ok(decisive.some(r => r.translator.mechanical.teeth?.pass === true), 'a canned answer passed teeth through the real engine');
    assert.ok(Object.values(records).some(r => r.final.disputed), 'the adjudicator disputed some');

    // The ledger: one line per call, 7 dp, every line a rehearsal line.
    const lines = ledger.entries();
    assert.equal(lines.filter(l => l.kind === 'counted').length, 376);
    assert.equal(lines.filter(l => l.kind !== 'counted').length, 4);
    assert.ok(lines.every(l => l.rehearsal === true && l.costUsd > 0));

    // The real scorer, through the results builder.
    const { rules, plugins } = loadCensusRules(REPO_ROOT);
    const args = recs => ({ rules, plugins, records: recs, ledgerLines: lines, denominator: prereg.census.rules, scorerSha256: prereg.files['experiments/blueprint-floor/scorer.mjs'] });
    const results = computeCensusResults(args(records));
    assert.deepEqual([results.rehearsal, results.mode, results.rules, results.spend.countedCalls], [true, 'counted', 188, 376]);
    assert.equal(results.score.perPlugin.length, 8);
    assert.ok(['refuted', 'interim'].includes(results.score.kill.variant));

    // The gate refuses it, for being a rehearsal and nothing else.
    const gateArgs = (res, recs, ledgerText) => ({ resultsBytes: JSON.stringify(res), records: recs, recordFiles: files, ledgerText, rules, plugins, pins: readPins(), preregDiskSha256: PREREG_SHA256, denominator: prereg.census.rules, scorerDiskSha256: prereg.files['experiments/blueprint-floor/scorer.mjs'], scorerPin: prereg.files['experiments/blueprint-floor/scorer.mjs'] });
    const ledgerText = readFileSync(paths.ledgerPath, 'utf8');
    const g = gateFromData(gateArgs(results, records, ledgerText));
    assert.equal(g.publishable, false);
    assert.ok(g.failures.length > 0);
    assert.deepEqual(g.failures.filter(f => !REHEARSAL_ONLY.test(f)), [], 'the only failures are the rehearsal markers');
    // With the markers flipped in memory (never on disk), the runner's own output opens the gate.
    const flipped = structuredClone(records);
    for (const rec of Object.values(flipped)) { rec.rehearsal = false; delete rec.banner; rec.served = { url: SERVED_URL, sha256: PREREG_SHA256, fetchedAt: rec.startedAt }; }
    const flippedLines = lines.map(l => ({ ...l, rehearsal: false }));
    const flippedText = `${flippedLines.map(l => JSON.stringify(l)).join('\n')}\n`;
    const open = gateFromData(gateArgs(computeCensusResults({ ...args(flipped), ledgerLines: flippedLines }), flipped, flippedText));
    assert.deepEqual(open.failures, []);
    assert.equal(open.publishable, true);
    assert.equal(open.variant, results.score.kill.variant);

    // The class guard: removing any field the scorer or the gate reads, from any record, turns the results RED.
    const id = Object.values(records).find(r => r.translator.translatorClass === 'expressible' && r.adjudicator.called).ruleId;
    const red = (edit, label) => { const b = structuredClone(records); edit(b[id]); assert.throws(() => computeCensusResults(args(b)), /unsound census records/, `removing ${label} did not turn it RED`); };
    for (const f of RECORD_FIELDS) red(r => { delete r[f]; }, f);
    for (const f of [...CALL_FIELDS, ...TRANSLATOR_FIELDS, ...TRANSLATOR_LIVE_FIELDS]) red(r => { delete r.translator[f]; }, `translator.${f}`);
    for (const f of [...CALL_FIELDS, ...ADJUDICATOR_FIELDS, ...ADJUDICATOR_LIVE_FIELDS]) red(r => { delete r.adjudicator[f]; }, `adjudicator.${f}`);
    red(r => { r.complete = false; }, 'complete (set false)');
    assert.throws(() => { const b = structuredClone(records); delete b[id]; computeCensusResults(args(b)); }, /no record for 1 census rule/);
  });
});
