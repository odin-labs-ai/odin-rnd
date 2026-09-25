// EXP 005 WO-01: the bce ground-truth contract and its GREEN/RED controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertBceVersion, BCE_VERSION, CONTROLS, EXTRACTOR, interpret, scoreTree } from '../experiments/jev-gate/bce-contract.mjs';

test('the installed bce-engine is the pinned 0.3.1 and the contract pins the ast extractor', () => {
  assert.equal(BCE_VERSION, '0.3.1');
  assert.equal(assertBceVersion(), '0.3.1');
  assert.equal(EXTRACTOR, 'ast');
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.match(lock, /bce-engine@0\.3\.1/);
});

test('GREEN control: exit 0, verdict pass, score 100, no violations', async () => {
  const r = await scoreTree({ blueprint: CONTROLS.blueprint, tree: CONTROLS.green });
  assert.deepEqual([r.exitCode, r.label, r.verdict, r.score, r.violations.length], [0, 'GREEN', 'pass', 100, 0]);
});

test('RED control: exit 1, verdict fail, the seeded rule is named', async () => {
  const r = await scoreTree({ blueprint: CONTROLS.blueprint, tree: CONTROLS.red });
  assert.deepEqual([r.exitCode, r.label, r.verdict], [1, 'RED', 'fail']);
  assert.ok(r.score < 100);
  assert.deepEqual(r.rules, ['control-domain-no-app']);
});

test('an exit code that disagrees with the report throws (forged reports)', () => {
  const pass = { verdict: 'pass', score: 100, violations: [] };
  const fail = { verdict: 'fail', score: 60, violations: [{ constraintId: 'x', evidenceRef: 'a#L1', observed: 'o' }] };
  assert.equal(interpret(0, pass).label, 'GREEN');
  assert.equal(interpret(1, fail).label, 'RED');
  assert.throws(() => interpret(0, fail), /disagrees/);
  assert.throws(() => interpret(1, pass), /disagrees/);
  assert.throws(() => interpret(0, { ...pass, score: 99 }), /disagrees/);
  assert.throws(() => interpret(1, { ...fail, score: 100 }), /disagrees/);
  assert.throws(() => interpret(2, fail), /only 0 \(pass\) and 1 \(fail\)/);
  assert.throws(() => interpret(0, undefined), /no report/);
});
