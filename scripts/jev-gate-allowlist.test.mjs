import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeResults, loadRecords } from '../experiments/jev-gate/results.mjs';
import { readRunnerPins, renderRunnerPins, runnerCodeShas } from '../experiments/jev-gate/runner-guard.mjs';
import { assertLiveCodeAllowed, checkResults, LIVE_CODE_MAY_DIFFER, resultsDir, resultsPath } from './jev-gate-results-site.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 005 follow-up (EXP 006 WO-1-06): the committed measured runs are scored under the code each run recorded. The
// live checkout may differ from that code ONLY in runner-guard.mjs and its one runners.sha256 line; any other pinned
// file that differs refuses. results.json must still recompute byte for byte.

const reviewer = () => JSON.parse(readFileSync(`${resultsDir}/reviewer.json`, 'utf8'));
const GUARD = 'experiments/jev-gate/runner-guard.mjs';
const flip = hex => `${hex[0] === '0' ? '1' : '0'}${hex.slice(1)}`;

test('the allowlist names runner-guard.mjs and nothing else', () => {
  assert.deepEqual(LIVE_CODE_MAY_DIFFER, [GUARD]);
});

test('live pins equal to the recorded pins, or different only in runner-guard.mjs, pass', () => {
  const recorded = reviewer().code;
  assert.deepEqual(assertLiveCodeAllowed(recorded, recorded), []);
  assert.deepEqual(assertLiveCodeAllowed({ ...recorded, [GUARD]: flip(recorded[GUARD]) }, recorded), [GUARD]);
});

test('a difference in any other pinned file refuses, and so does a changed file list', () => {
  const recorded = reviewer().code;
  for (const rel of Object.keys(recorded).filter(r => r !== GUARD)) {
    assert.throws(() => assertLiveCodeAllowed({ ...recorded, [rel]: flip(recorded[rel]) }, recorded), new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${rel} must refuse`);
    assert.throws(() => assertLiveCodeAllowed({ ...recorded, [GUARD]: flip(recorded[GUARD]), [rel]: flip(recorded[rel]) }, recorded), /only/, `${rel} + runner-guard must refuse`);
  }
  const extra = { ...recorded, 'experiments/nina-changes/run_reviewer6.mjs': 'a'.repeat(64) };
  assert.throws(() => assertLiveCodeAllowed(extra, recorded), /other files/);
  const { [GUARD]: _, ...fewer } = recorded;
  assert.throws(() => assertLiveCodeAllowed(fewer, recorded), /other files/);
});

test('the live checkout passes the allowlist; the only live difference is runner-guard.mjs', () => {
  const live = runnerCodeShas();
  assert.equal(renderRunnerPins(live), renderRunnerPins(readRunnerPins()), 'the live runners.sha256 matches the live code');
  const differ = assertLiveCodeAllowed(live, reviewer().code);
  assert.ok(differ.every(rel => rel === GUARD));
});

test('EXP 005 build: checkResults passes and results.json recomputes byte for byte under the recorded code', () => {
  const data = checkResults();
  assert.ok(data, 'the committed results record exists');
  const runs = Object.fromEntries(['jev', 'laya', 'reviewer'].map(g => [g, JSON.parse(readFileSync(`${resultsDir}/${g}.json`, 'utf8'))]));
  const preflight = JSON.parse(readFileSync(`${resultsDir}/preflight.json`, 'utf8'));
  const records = loadRecords();
  const recomputed = computeResults({ ...records, stamp: { ...records.stamp, code: runs.reviewer.code }, runs, preflight });
  assert.equal(`${JSON.stringify(recomputed, null, 2)}\n`, readFileSync(resultsPath, 'utf8'), 'results.json bytes');
});

test('checkResults refuses committed runs whose recorded code differs from the live code in another pinned file', () => {
  const root = scratchDir('allowlist');
  try {
    // Only the results/ records are copied (no answer file); the refusal comes before any answer file is read.
    mkdirSync(join(root, resultsDir), { recursive: true });
    cpSync(resultsDir, join(root, resultsDir), { recursive: true });
    for (const g of ['jev', 'laya', 'reviewer']) {
      const file = join(root, resultsDir, `${g}.json`);
      const run = JSON.parse(readFileSync(file, 'utf8'));
      run.code['experiments/jev-gate/results.mjs'] = flip(run.code['experiments/jev-gate/results.mjs']);
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    }
    assert.throws(() => checkResults(root), /results\.mjs, which only experiments\/jev-gate\/runner-guard\.mjs may/);
  } finally {
    removeScratch(root);
  }
});
