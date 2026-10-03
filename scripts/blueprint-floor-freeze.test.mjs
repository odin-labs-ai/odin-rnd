import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_BEFORE, PREREG_SHA256, SERVED_URL } from '../experiments/blueprint-floor/freeze.mjs';
import { checkCensusRun, codeShas, fetchServed, PINS, readPins, REPO_ROOT, RUNNER_FILES, sha256, trackedByGit } from '../experiments/blueprint-floor/census-guard.mjs';
import { LEDGER } from '../experiments/blueprint-floor/census-spend.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 007 WO-2-01: the freeze and the census guard, in the frozen state (the committed freeze.mjs) and the unfrozen one
// (an injected null freeze), with the served-record fetch stubbed (the real fetch refuses under the test runner).

const PREREG = 'experiments/blueprint-floor/preregistration.json';
const preregBytes = readFileSync(join(REPO_ROOT, PREREG));
const served = async () => preregBytes;
const tracked = () => true;
const AFTER = new Date(Date.parse(NOT_BEFORE) + 1000);
const frozenArgs = over => ({ mode: 'counted', now: AFTER, fetch: served, tracked, ...over });

test('the freeze holds the published record: its sha256, and the odin-rnd #25 mergedAt as the not-before', () => {
  assert.equal(PREREG_SHA256, 'ee56929ab38de831d618a41b9a2f359d814fc01849d273060e590669e94c9edb');
  assert.equal(sha256(preregBytes), PREREG_SHA256, 'the pre-registration on disk is the frozen one');
  assert.equal(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/preregistration.sha256'), 'utf8').split(/\s/)[0], PREREG_SHA256);
  assert.equal(NOT_BEFORE, '2026-10-03T12:09:42Z');
  assert.match(readFileSync(join(REPO_ROOT, 'experiments/blueprint-floor/freeze.mjs'), 'utf8'), /gh pr view 25 -R odin-labs-ai\/odin-rnd --json mergedAt/, 'the command that read the not-before is recorded');
  assert.equal(SERVED_URL, 'https://odin-labs-ai.github.io/odin-rnd/data/blueprint-floor/preregistration.json');
});

test('runners.sha256 pins every file on the counted path, and matches the files on disk', () => {
  const pins = readPins();
  assert.deepEqual(Object.keys(pins), RUNNER_FILES, 'the pins file lists exactly the counted-path files, in order');
  assert.deepEqual(pins, codeShas(), 'a counted-path file changed: rerun node experiments/blueprint-floor/census-guard.mjs --write-pins');
  for (const f of ['census-run.mjs', 'census-gate.mjs', 'census-guard.mjs', 'census-spend.mjs', 'freeze.mjs', 'adapter.mjs', 'whitelist.mjs', 'whitelist.json', 'scorer.mjs', 'protocol.mjs', 'contract.md', 'contract-module-graph.md', 'prompts/translator.md', 'prompts/adjudicator.md', 'prompts/canary.md', 'rules/selection.json', 'controls/positive.json', 'controls/negative.json', 'controls/practice.json']) assert(RUNNER_FILES.includes(`experiments/blueprint-floor/${f}`), f);
  assert.equal(RUNNER_FILES.filter(f => /\/rules\/[^/]+\.json$/.test(f) && !f.endsWith('selection.json')).length, 8, 'every plugin rule file');
});

test('frozen: the guard passes after the not-before with the served copy byte-identical, and records the fetch', async () => {
  const stamp = await checkCensusRun(frozenArgs());
  assert.equal(stamp.preregSha256, PREREG_SHA256);
  assert.equal(stamp.notBefore, NOT_BEFORE);
  assert.equal(stamp.codeMatchesPins, true);
  assert.deepEqual([stamp.served.url, stamp.served.sha256], [SERVED_URL, PREREG_SHA256]);
  assert.ok(Number.isFinite(Date.parse(stamp.served.fetchedAt)));
  const practice = await checkCensusRun(frozenArgs({ mode: 'practice' }));
  assert.equal(practice.served.sha256, PREREG_SHA256, 'a practice (canary) call passes the same guard');
});

test('unfrozen: a null freeze refuses every mode', async () => {
  for (const mode of ['practice', 'counted', 'rehearsal']) {
    for (const freeze of [{ PREREG_SHA256: null, NOT_BEFORE }, { PREREG_SHA256, NOT_BEFORE: null }, { PREREG_SHA256: null, NOT_BEFORE: null }]) {
      await assert.rejects(checkCensusRun(frozenArgs({ mode, freeze })), /waits for the freeze/, `${mode} ${JSON.stringify(freeze)}`);
    }
  }
});

test('frozen, but each condition broken in turn: the guard refuses', async () => {
  await assert.rejects(checkCensusRun(frozenArgs({ now: new Date(NOT_BEFORE) })), /not after the not-before/, 'exactly at the not-before');
  await assert.rejects(checkCensusRun(frozenArgs({ now: new Date('2026-10-03T12:00:00Z') })), /not after the not-before/);
  await assert.rejects(checkCensusRun(frozenArgs({ freeze: { PREREG_SHA256: 'a'.repeat(64), NOT_BEFORE } })), /hashes to ee56929a/, 'another frozen sha');
  await assert.rejects(checkCensusRun(frozenArgs({ freeze: { PREREG_SHA256, NOT_BEFORE: '2026-10-03 12:09:42' } })), /not an ISO 8601 UTC time/);
  await assert.rejects(checkCensusRun(frozenArgs({ fetch: async () => Buffer.concat([preregBytes, Buffer.from(' ')]) })), /site serves a pre-registration hashing to/, 'the served copy differs');
  await assert.rejects(checkCensusRun(frozenArgs({ fetch: async () => { throw new Error('HTTP 404'); } })), /could not be fetched: HTTP 404/);
  await assert.rejects(checkCensusRun(frozenArgs({ tracked: () => false })), /spend-ledger\.jsonl is not committed/);
  await assert.rejects(checkCensusRun(frozenArgs({ ledgerPath: join(REPO_ROOT, 'experiments/blueprint-floor/other-ledger.jsonl') })), /appends to the committed ledger/);
  await assert.rejects(checkCensusRun(frozenArgs({ mode: 'probe' })), /unknown mode/);
  // The default fetch never reaches the network under the test runner.
  await assert.rejects(fetchServed(SERVED_URL), /not fetched under the Node test runner/);
  await assert.rejects(checkCensusRun({ mode: 'counted', now: AFTER, tracked }), /could not be fetched: the served pre-registration is not fetched under the Node test runner/);
});

test('a rehearsal checks the same freeze and pins, fetches nothing and takes a scratch ledger', async () => {
  let fetched = false;
  const stamp = await checkCensusRun({ mode: 'rehearsal', now: AFTER, fetch: async () => { fetched = true; return preregBytes; }, ledgerPath: '/nonexistent/ledger.jsonl', tracked: () => false });
  assert.deepEqual([stamp.rehearsal, stamp.served, fetched], [true, null, false]);
});

test('a counted-path file or a pre-registration pin that drifts refuses the guard (on a copy of the tree)', async () => {
  const root = scratchDir('bf-freeze');
  try {
    for (const rel of [...new Set([...RUNNER_FILES, PINS, PREREG, ...Object.keys(JSON.parse(preregBytes).files)])]) { mkdirSync(join(root, rel, '..'), { recursive: true }); cpSync(join(REPO_ROOT, rel), join(root, rel)); }
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
    const args = over => frozenArgs({ root, ledgerPath: join(root, LEDGER), ...over });
    await checkCensusRun(args());
    writeFileSync(join(root, 'experiments/blueprint-floor/census-run.mjs'), `${readFileSync(join(root, 'experiments/blueprint-floor/census-run.mjs'), 'utf8')}\n// drift\n`);
    await assert.rejects(checkCensusRun(args()), /counted-path code differs from experiments\/blueprint-floor\/runners\.sha256 \(experiments\/blueprint-floor\/census-run\.mjs\)/);
    await assert.rejects(checkCensusRun(args({ mode: 'rehearsal' })), /counted-path code differs/, 'a rehearsal runs the pinned code too');
    cpSync(join(REPO_ROOT, 'experiments/blueprint-floor/census-run.mjs'), join(root, 'experiments/blueprint-floor/census-run.mjs'));
    writeFileSync(join(root, 'experiments/blueprint-floor/scorer.mjs'), `${readFileSync(join(root, 'experiments/blueprint-floor/scorer.mjs'), 'utf8')} `);
    await assert.rejects(checkCensusRun(args()), /the pre-registration pins experiments\/blueprint-floor\/scorer\.mjs/);
  } finally { removeScratch(root); }
});

test('the committed ledger exists, is tracked by git, and holds no line from before the not-before (none at all in bundle 1)', () => {
  assert.equal(trackedByGit(REPO_ROOT, LEDGER), true);
  const lines = readFileSync(join(REPO_ROOT, LEDGER), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const l of lines) assert(Date.parse(l.ts) > Date.parse(NOT_BEFORE), `a ledger line at ${l.ts}`);
});
