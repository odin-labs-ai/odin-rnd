import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { corpusItems } from '../experiments/jev-gate/run_reviewer.mjs';
import { checkRecords, sha256 } from '../experiments/jev-gate/runner-guard.mjs';
import { loadFingerprints, outFile as FINGERPRINTS_FILE } from '../experiments/nina-changes/fingerprints.mjs';
import { checkRun6 } from '../experiments/nina-changes/guard6.mjs';
import { assertPublishable6, computeResults6, translateHarnessFailure } from '../experiments/nina-changes/results6.mjs';
import { FAKE_CLAUDE6, runReviewer6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';
import { rehearsalPins, writeSyntheticPreflight } from './nina-changes-built-reviewer.mjs';

// EXP 006 rehearsal (becomes bundle 2's binding rehearsal, WO-2-02): full 60 × 3 synthetic stream-json records made by
// the REAL record builder and loop (runReviewer6, mode rehearsal: the committed stream-json fake stands in for the
// model, no workspace, no spend) → the REAL diff-seen classification → the REAL scorer (results6, counted semantics,
// with the committed pre-flight record path through checkPreflightForScoring) → the publishability check, which must
// refuse. Removing any field the scorer asserts from the builder's record turns it RED. While freeze.mjs is null the
// rehearsal runs under rehearsal pins; after the freeze, under the frozen constants.

const REHEARSAL_PINS = rehearsalPins();
const BLIND = new Set([4, 57, 58, 121]); // call indices the fake plays diff-blind (a refused diff), to exercise the states

// Record-level and per-call fields the scorer asserts (validateGateRun + validateRun6 + the counted checks).
const RECORD_FIELDS = ['experiment', 'parentSha256', 'amendmentSha256', 'prereg6Sha256', 'notBefore', 'code', 'mode', 'head', 'fixture', 'rehearsal'];
const PIN_FIELDS = ['preflight', 'preflightRoots', 'patches', 'fingerprintsSha256'];
const CALL_FIELDS = ['startedAt', 'endedAt', 'decision', 'abstention', 'costUsd', 'costBasis', 'harnessFailure', 'toolCalls', 'diffSeen', 'stream', 'gate'];

test('rehearsal: 180 stream-json records → diff-seen → results6 → unpublishable; every asserted field is load-bearing', { timeout: 600_000 }, async () => {
  const dir = scratchDir('nc-rehearsal');
  const saved = { PATH: process.env.PATH, FAKE6_MODES: process.env.FAKE6_MODES, FAKE6_STATE: process.env.FAKE6_STATE };
  try {
    chmodSync(FAKE_CLAUDE6, 0o755);
    symlinkSync(FAKE_CLAUDE6, join(dir, 'claude'));
    const items = corpusItems();
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.FAKE6_MODES = Array.from({ length: items.length * 3 }, (_, i) => (BLIND.has(i) ? 'synthetic-blind' : 'synthetic')).join(',');
    process.env.FAKE6_STATE = join(dir, 'state');
    const { path: preflightPath, rec: preflight } = writeSyntheticPreflight(dir);

    const run = await runReviewer6({ out: join(dir, 'reviewer.json'), mode: 'rehearsal', items, rehearsalPins: REHEARSAL_PINS, preflightRecord: preflightPath, log: () => {} });
    assert.equal(run.partial, null);
    assert.equal(run.calls.length, 180);
    assert.equal(run.rehearsal, true);
    assert.equal(run.mode, 'counted');
    assert.equal(run.fixture, false);
    assert.equal(run.head, preflight.head);
    assert.deepEqual(run.pins.preflight, { sha256: preflight.sha256, endedAt: preflight.endedAt });
    assert.equal(run.pins.clientBinary, 'FIXTURE fake-claude-stream.mjs');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'reviewer.json'), 'utf8')), run, 'what it returns is what it wrote');
    assert.doesNotMatch(readFileSync(join(dir, 'reviewer.json'), 'utf8'), /nina-changes-reviewer-|\/Users\//, 'scrubbed at write time');
    for (const c of run.calls) {
      assert.equal(c.stream.clientVersion, '2.1.280');
      assert.ok(c.toolCalls.length >= 1);
      assert.equal(c.diffSeen.seen, !BLIND.has(run.calls.indexOf(c)), `${c.id} run ${c.run}`);
    }

    const { prereg, amendment } = checkRecords({ mode: 'practice' });
    const { stamp } = checkRun6({ mode: 'rehearsal', rehearsalPins: REHEARSAL_PINS });
    const hf = amendment.changes.spotlight.criteria.find(c => c.id === 'zero-patches').harnessFailure;
    const bar6 = { criteria: amendment.changes.spotlight.criteria, harnessFailure: translateHarnessFailure(hf), manipulation: { maxBlindRuns: 18, countedRuns: 180 } };
    const labels = JSON.parse(readFileSync('experiments/jev-gate/labels.json', 'utf8'));
    const args = over => ({ exp005: { prereg, amendment }, bar6, labels, run, fingerprints: loadFingerprints(), fingerprintsSha256: sha256(readFileSync(FINGERPRINTS_FILE)), stamp, preflight, ...over });

    const result = computeResults6(args());
    assert.equal(result.rehearsal, true);
    assert.equal(result.partial, null);
    assert.deepEqual([result.runStates.BLIND, result.manipulation.blind, result.manipulation.state], [4, 4, 'PASS']);
    assert.throws(() => assertPublishable6(result), /rehearsal/, 'a rehearsal result is never publishable');

    // The class guard: every field the scorer asserts, removed from the builder's record, turns scoring RED.
    for (const f of RECORD_FIELDS) { const broken = structuredClone(run); delete broken[f]; assert.throws(() => computeResults6(args({ run: broken })), `removing ${f} did not turn scoring RED`); }
    for (const f of PIN_FIELDS) { const broken = structuredClone(run); delete broken.pins[f]; assert.throws(() => computeResults6(args({ run: broken })), `removing pins.${f} did not turn scoring RED`); }
    for (const f of CALL_FIELDS) { const broken = structuredClone(run); delete broken.calls[0][f]; assert.throws(() => computeResults6(args({ run: broken })), `removing calls[].${f} did not turn scoring RED`); }
    // Scoring needs the committed pre-flight record, untampered; and a call at the not-before is refused.
    assert.throws(() => computeResults6(args({ preflight: undefined })), /pre-flight/i);
    const tampered = structuredClone(preflight); tampered.vanished = 9;
    assert.throws(() => computeResults6(args({ preflight: tampered })), /altered/);
    const early = structuredClone(run); early.calls[0].startedAt = early.notBefore;
    assert.throws(() => computeResults6(args({ run: early })), /not after the not-before/);
    // A tool output edited after the fact changes the recomputed class and refuses.
    const edited = structuredClone(run); for (const t of edited.calls[0].toolCalls) if (t.output) t.output = '';
    assert.throws(() => computeResults6(args({ run: edited })), /diff-visibility differs/);
  } finally {
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    removeScratch(dir);
  }
});
