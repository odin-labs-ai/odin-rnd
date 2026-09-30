import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkPreflightForScoring, checkPreflightRecord, defaultScanRoots, NOT_BEFORE_02, renderRunnerPins, RUNNER_PINS, runnerCodeShas, scrubTempPath, sha256,
} from '../experiments/jev-gate/runner-guard.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 006 (R2-1 / R3-1): the pre-flight record checks take the pins file and the not-before as parameters, so EXP 006
// binds its record to experiments/nina-changes/runners.sha256 and its own not-before. The defaults are EXP 005's
// (experiments/jev-gate/runners.sha256, amendment 02's not-before), so every EXP 005 call site is unchanged.

const selfSha = rec => sha256(JSON.stringify({ ...rec, sha256: null }));
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const OTHER_PINS = 'experiments/jev-gate/inputs.sha256'; // any tracked file stands in for another experiment's pins

function record(pinsFile, endedAt = new Date(Date.now() - 60e3).toISOString()) {
  const r = {
    kind: 'answer-key-preflight', mode: 'counted', ok: true, scanned: defaultScanRoots().scannable.map(scrubTempPath), skipped: [], copies: [],
    vanished: 0, permissionSkipped: 0, durationMs: 1, override: null, startedAt: endedAt, endedAt,
    runnersSha256: sha256(readFileSync(pinsFile)), head: head(), sha256: null,
  };
  r.sha256 = selfSha(r);
  return r;
}

test('checkPreflightRecord binds to the pins file it is given; the default stays EXP 005 runners.sha256', () => {
  const dir = scratchDir('pfparams');
  const write = rec => { const p = join(dir, 'pf.json'); writeFileSync(p, JSON.stringify(rec)); return p; };
  try {
    const exp005 = record(RUNNER_PINS);
    assert.doesNotThrow(() => checkPreflightRecord({ path: write(exp005) }), 'the EXP 005 default');
    assert.throws(() => checkPreflightRecord({ path: write(exp005), pinsFile: OTHER_PINS }), /inputs\.sha256 differs/);
    const other = record(OTHER_PINS);
    assert.doesNotThrow(() => checkPreflightRecord({ path: write(other), pinsFile: OTHER_PINS }));
    assert.throws(() => checkPreflightRecord({ path: write(other) }), /runners\.sha256 differs/);
  } finally { removeScratch(dir); }
});

test('checkPreflightRecord and checkPreflightForScoring take the not-before; the default stays amendment 02', () => {
  const dir = scratchDir('pfparams');
  const write = rec => { const p = join(dir, 'pf.json'); writeFileSync(p, JSON.stringify(rec)); return p; };
  try {
    const rec = record(RUNNER_PINS);
    const later = new Date(Date.now() - 30e3).toISOString(); // after the record ended
    assert.doesNotThrow(() => checkPreflightRecord({ path: write(rec), notBefore: NOT_BEFORE_02 }));
    assert.throws(() => checkPreflightRecord({ path: write(rec), notBefore: later }), new RegExp(`the not-before ${later}`));
    // A null not-before (a freeze not yet made) never passes.
    assert.throws(() => checkPreflightRecord({ path: write(rec), notBefore: null }), /not-before/);
    const run = { gate: 'reviewer', code: runnerCodeShas(), head: rec.head, pins: { preflightRoots: rec.scanned, preflight: { sha256: rec.sha256, endedAt: rec.endedAt } } };
    const firstCallStartedAt = new Date(Date.now() - 10e3).toISOString();
    assert.equal(rec.runnersSha256, sha256(renderRunnerPins(run.code)));
    assert.doesNotThrow(() => checkPreflightForScoring({ record: rec, run, firstCallStartedAt }));
    assert.throws(() => checkPreflightForScoring({ record: rec, run, firstCallStartedAt, notBefore: later }), /at or before the not-before/);
    assert.throws(() => checkPreflightForScoring({ record: rec, run, firstCallStartedAt, notBefore: null }), /not-before/);
  } finally { removeScratch(dir); }
});

test('the parameterisation is additive: no spotlight threshold literal in runner-guard.mjs', () => {
  const src = readFileSync('experiments/jev-gate/runner-guard.mjs', 'utf8');
  for (const v of ['0.1', '0.25', '0.9', '0.05']) assert.doesNotMatch(src, new RegExp(`(?<![\\w.])${v.replace('.', '\\.')}(?![\\w.])`), `runner-guard.mjs states ${v}`);
});
