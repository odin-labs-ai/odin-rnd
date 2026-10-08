import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Kernel, defineComponent } from '../harness/kernel.mjs';
import corpus from '../harness/services/corpus.mjs';
import pins from '../harness/services/pins.mjs';
import {
  EXP005_CALL_RECORDS, EXP005_FIELDS, EXP006_CALL_RECORDS, EXP006_RECORDS, committedCalls, exp005Calls, exp005Results,
  exp006DiffSeen, exp006Results, replay, replayable6,
} from '../harness/parity.mjs';

// Bundle 2 WO-04, the byte-parity witness: the committed EXP 005 and EXP 006 records replay byte-identically through
// the frozen code, directly and from inside the harness, at $0 (no model call: parity.mjs spawns nothing).

const sha256 = b => createHash('sha256').update(b).digest('hex');
const EXP005_RESULTS = 'experiments/jev-gate/results/results.json';
const EXP006_RESULTS = 'experiments/nina-changes/results/results.json';

async function harness(config = {}) {
  const k = new Kernel();
  await k.load(pins);
  await k.load(corpus);
  await k.load(replay, config);
  return k;
}

test('$0: the witness imports no process spawner and no network client', () => {
  const src = readFileSync('harness/parity.mjs', 'utf8');
  assert.doesNotMatch(src, /node:child_process|node:https?|fetch\(/);
});

test('EXP 005: the fake-claude fixture and the counted reviewer run re-derive byte-identically, directly', () => {
  assert.equal(EXP005_CALL_RECORDS.length, 2);
  for (const p of EXP005_CALL_RECORDS) assert.equal(exp005Calls(p), committedCalls(p, EXP005_FIELDS), p);
  assert.equal(exp005Results(), readFileSync(EXP005_RESULTS, 'utf8'));
});

test('EXP 006: the counted run re-derives byte-identically, and the records the live code cannot replay are named', () => {
  assert.deepEqual(EXP006_RECORDS.map(p => [p.split('/').pop(), replayable6(p).reason]), [
    ['practice-a.json', 'judged by diff-seen.mjs c032517d, live is 64d85ee3'],
    ['practice-b.json', 'judged by diff-seen.mjs c032517d, live is 64d85ee3'],
    ['practice-recheck-a01.json', 'no fingerprints on the tree for p01, p02'],
    ['reviewer.json', null],
  ]);
  assert.deepEqual(EXP006_CALL_RECORDS, ['experiments/nina-changes/results/reviewer.json']);
  for (const p of EXP006_CALL_RECORDS) assert.equal(exp006DiffSeen(p), committedCalls(p, ['diffSeen']), p);
  assert.equal(exp006Results(), readFileSync(EXP006_RESULTS, 'utf8'));
});

test('through the harness (corpus + pins adapters injected), every replay equals the direct one byte for byte', async () => {
  const k = await harness();
  assert.deepEqual(k.census().map(r => r.status), ['active', 'active', 'active']);
  const r = k.service('replay');
  for (const p of EXP005_CALL_RECORDS) assert.equal(sha256(r.exp005Calls(p)), sha256(committedCalls(p, EXP005_FIELDS)), p);
  for (const p of EXP006_CALL_RECORDS) assert.equal(sha256(r.exp006DiffSeen(p)), sha256(committedCalls(p, ['diffSeen'])), p);
  assert.equal(sha256(r.exp005Results()), sha256(readFileSync(EXP005_RESULTS)));
  assert.equal(sha256(r.exp006Results()), sha256(readFileSync(EXP006_RESULTS)));
  await k.dispose();
});

test('teeth: a perturbed replay and a perturbed corpus adapter are both detected', async () => {
  const k = await harness({ perturb: '\nVERDICT: REJECTED' });
  for (const p of EXP005_CALL_RECORDS) assert.notEqual(k.service('replay').exp005Calls(p), committedCalls(p, EXP005_FIELDS), `${p}: a perturbed parse is caught`);
  await k.dispose();
  // A corpus adapter that serves one item fewer: the replay refuses, naming the call.
  const k2 = new Kernel();
  await k2.load(pins);
  await k2.load(defineComponent({ name: 'corpus', provides: ['corpus'], apply(ctx) { ctx.provide('corpus', { items: [{ id: 'c001' }] }); } }));
  await k2.load(replay);
  assert.throws(() => k2.service('replay').exp005Calls(EXP005_CALL_RECORDS[1]), /call c0\d\d is not a corpus item/);
  await k2.dispose();
  // Without the corpus at all, the replay never activates: the missing coeffect is named.
  const k3 = new Kernel();
  await k3.load(pins);
  await k3.load(replay);
  assert.equal(k3.census()[1].status, 'inactive: missing corpus');
});

// ------------------------------------------------------------------ vendored module-private symbols (slice test)

function sliceDeclaration(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex(l => new RegExp(`^(?:export )?(?:async )?(?:function ${name}\\(|const ${name} = )`).test(l));
  if (start < 0) return null;
  if (lines[start].endsWith(';')) return { line: start + 1, text: lines[start] };
  let end = start + 1;
  while (end < lines.length && !/^\};?$/.test(lines[end])) end += 1;
  return { line: start + 1, text: lines.slice(start, end + 1).join('\n') };
}

test('vendored fingerprintsFor is byte-identical to experiments/nina-changes/run_reviewer6.mjs:248, a runners.sha256 pin', () => {
  const file = 'experiments/nina-changes/run_reviewer6.mjs';
  const pin = readFileSync('experiments/nina-changes/runners.sha256', 'utf8').split('\n').find(l => l.endsWith(`  ${file}`)).split(' ')[0];
  assert.equal(sha256(readFileSync(file)), pin);
  const want = sliceDeclaration(readFileSync(file, 'utf8'), 'fingerprintsFor');
  assert.equal(want.line, 248);
  assert.doesNotMatch(want.text, /^export /, 'fingerprintsFor is module-private (else import it)');
  const vendored = readFileSync('harness/vendored-exp006.mjs', 'utf8');
  assert.equal(sliceDeclaration(vendored, 'fingerprintsFor').text, want.text);
  const declared = [...vendored.matchAll(/^(?:function (\w+)\(|const (\w+) = )/gm)].map(m => m[1] ?? m[2]);
  assert.deepEqual(declared, ['fingerprintsFor']);
  // What it reaches is imported from the frozen modules, not copied.
  assert.match(vendored, /^import \{ fingerprintItem \} from '\.\.\/experiments\/nina-changes\/fingerprints\.mjs';$/m);
  assert.match(vendored, /^import \{ loadBaseLines \} from '\.\.\/experiments\/nina-changes\/base-lines\.mjs';$/m);
});
