import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, MAX_BREACHES, numberSpellingProblems, recordHash, recordProblems, RECORD_SCHEMA } from './lab-record.mjs';

// Record v1 (scripts/lab-record.mjs). The runner on the org's machines and this public repo compute recordHash in two
// languages, so the golden record below pins the bytes both must agree on; every negative is a way a record could
// claim more than its run showed.
const raw = readFileSync('site/data/labs/rogue/record.json', 'utf8');
const rogue = JSON.parse(raw);
const golden = rogue.runs[0];
const GOLDEN_HASH = '47c9ab93279dae96f8423aabc985beda6492f2e498da82e055d9ba9fa44aacf8';
const clone = () => JSON.parse(JSON.stringify(golden));
const rehash = r => ({ ...r, recordHash: recordHash(r) });
const refused = (record, re) => {
  const problems = recordProblems(record);
  assert.ok(problems.some(p => re.test(p)), `expected a problem matching ${re}, got ${JSON.stringify(problems)}`);
};

test('the golden record: Lab 05\'s Mac re-run, as record v1, holds the pinned hash and is valid', () => {
  assert.equal(golden.recordHash, GOLDEN_HASH);
  assert.equal(recordHash(golden), GOLDEN_HASH);
  assert.deepEqual(recordProblems(golden), []);
});

test('the canonical form is the one Python writes with sort_keys and compact separators', () => {
  const core = { format: golden.format, version: golden.version, lab: golden.lab, commit: golden.commit.sha, command: golden.command, inputs: golden.inputs, result: golden.result };
  // json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False), written out by hand.
  const python = `{"command":"the demo's own check command","commit":"${golden.commit.sha}","format":"odin-lab-record","inputs":[{"role":"runner","sha256":"${golden.inputs[0].sha256}"},{"role":"runs","sha256":"${golden.inputs[1].sha256}"}],"lab":"rogue","result":{"breaches":0,"committed":"e41d9422648239dd","now":"e41d9422648239dd","verdict":"SAME"},"version":1}`;
  assert.equal(canonical(core), python);
});

test('where and when a record ran do not change its hash; what ran does', () => {
  const elsewhere = { ...clone(), runner: 'org-hosted', machineClass: 'org-ci-heavy', image: `python:3.12-bookworm@sha256:${'a'.repeat(64)}`, ranAt: '2026-10-28T01:00:00Z' };
  assert.equal(recordHash(elsewhere), GOLDEN_HASH);
  assert.notEqual(recordHash({ ...clone(), result: { ...golden.result, breaches: 1 } }), GOLDEN_HASH);
  assert.notEqual(recordHash({ ...clone(), commit: { ...golden.commit, sha: 'b'.repeat(40) } }), GOLDEN_HASH);
});

test('negative: a record with no runner is refused by the schema', () => {
  const r = clone(); delete r.runner;
  refused(r, /missing|required|runner/);
});

test('negative: a runner or host NAME in place of a class label is refused', () => {
  refused(rehash({ ...clone(), runner: 'odin-gha-jit-gpu-server-s11' }), /\/runner: does not match/);
  refused(rehash({ ...clone(), machineClass: 'odin-gha-runner-3' }), /\/machineClass: does not match/);
  refused(rehash({ ...clone(), runner: 'org-hosted' }), /\/machineClass: not the machine class of the org-hosted runner/);
});

test('negative: a runner name in the command, an input role or the lab (closed lists)', () => {
  const name = 'odin-gha-jit-gpu-server-s11';
  refused(rehash({ ...clone(), command: name }), /\/command: does not match/);
  refused(rehash({ ...clone(), command: "the demo's own check command on runner three" }), /\/command: does not match/);
  refused(rehash({ ...clone(), inputs: [{ role: name, sha256: golden.inputs[0].sha256 }] }), /\/inputs\/0\/role: does not match/);
  refused(rehash({ ...clone(), lab: name }), /\/lab: does not match/);
});

test('negative: a breach count past what both languages write alike', () => {
  refused(rehash({ ...clone(), result: { ...golden.result, breaches: 1e21 } }), /\/result\/breaches: more than/);
  refused(rehash({ ...clone(), result: { ...golden.result, breaches: MAX_BREACHES + 1 } }), /\/result\/breaches: more than/);
});

test('Python reads the same bytes to the same recordHash (the runner\'s language)', () => {
  // The bytes go to Python as written, never re-serialised by JavaScript first. A Lab record file holds its runs[].
  const py = 'import hashlib, json, sys\nd = json.load(sys.stdin)\nr = d["runs"][0] if "runs" in d else d\ncore = {k: r[k] for k in ("format", "version", "lab", "command", "inputs", "result")}\ncore["commit"] = r["commit"]["sha"]\nprint(hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest())';
  const max = `${JSON.stringify(golden, null, 1)}\n`.replace('"breaches": 0', `"breaches": ${MAX_BREACHES}`);
  for (const [text, r] of [[raw, golden], [max, JSON.parse(max)]]) {
    assert.equal(execFileSync('python3', ['-c', py], { input: text, encoding: 'utf8' }).trim(), recordHash(r));
  }
  assert.equal(recordHash(golden), GOLDEN_HASH);
});

test('negative: a number not written as a plain integer, which JavaScript and Python would read apart', () => {
  const text = JSON.stringify(golden).replace('"breaches":0', '"breaches":0.0');
  assert.match(numberSpellingProblems(text).join('\n'), /the number 0\.0 is not written as a plain integer/);
  for (const spelled of ['1e0', '-0', '1.5', '2E3']) assert.equal(numberSpellingProblems(`{"n":${spelled}}`).length, 1, spelled);
  assert.deepEqual(numberSpellingProblems('{"s":"0.0 1e9 -0","n":[0,1,-2,1000000]}'), [], 'digits inside a string are not numbers');
  // runs is the last key of Lab 05's record; the rest of that file (a 4.5-hour repair estimate) is not a record v1.
  assert.ok(raw.lastIndexOf('"runs"') > raw.lastIndexOf('"reproductions"'));
  assert.deepEqual(numberSpellingProblems(raw.slice(raw.lastIndexOf('"runs"'))), [], 'Lab 05\'s published runs');
  const dir = mkdtempSync(join(tmpdir(), 'lab-record-'));
  try {
    writeFileSync(join(dir, 'float.json'), text);
    assert.throws(() => execFileSync('node', ['scripts/lab-record.mjs', join(dir, 'float.json')], { stdio: 'pipe' }), e => e.status === 1 && /float\.json: the number 0\.0/.test(e.stderr.toString()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('negative: a replica with a different recordHash is not a replication', () => {
  refused({ ...clone(), replicatedOn: [{ machineClass: 'ubuntu-latest', recordHash: 'c'.repeat(64) }] }, /replicatedOn\/0\/recordHash: a replica with a different recordHash/);
  refused({ ...clone(), differedOn: [{ machineClass: 'ubuntu-latest', recordHash: GOLDEN_HASH }] }, /differedOn\/0\/recordHash: a run with the same recordHash did not differ/);
  refused({ ...clone(), replicatedOn: [{ machineClass: 'mac', recordHash: GOLDEN_HASH }] }, /already names this machine class/);
  assert.deepEqual(recordProblems({ ...clone(), replicatedOn: [{ machineClass: 'ubuntu-latest', recordHash: GOLDEN_HASH }], differedOn: [{ machineClass: 'org-ci-heavy', recordHash: 'c'.repeat(64) }] }), []);
});

test('negative: a commit only on a lane, marked as on main, is refused', () => {
  const lane = 'd'.repeat(40);
  refused(rehash({ ...clone(), commit: { sha: lane, mainHead: golden.commit.mainHead, compare: 'diverged', onMain: true } }), /\/commit\/onMain: a commit whose main check says "diverged" is marked as on main/);
  refused(rehash({ ...clone(), commit: { sha: lane, mainHead: golden.commit.mainHead, compare: 'behind', onMain: true } }), /\/commit\/onMain/);
  refused(rehash({ ...clone(), commit: { sha: lane, mainHead: golden.commit.mainHead, compare: 'identical', onMain: true } }), /\/commit\/compare: does not agree/);
  assert.deepEqual(recordProblems(rehash({ ...clone(), commit: { sha: lane, mainHead: golden.commit.mainHead, compare: 'ahead', onMain: true } })), [], 'a laptop record may cite a commit main is ahead of');
  // The checker cannot read the private repository; an org runner reads it AT main, so it may only say identical
  // (Lab 05 here; Lab 06's pinned-commit exception is tested in lab06-runner-records.test.mjs).
  const org = { ...clone(), runner: 'org-hosted', machineClass: 'org-ci-heavy' };
  refused(rehash({ ...org, commit: { sha: lane, mainHead: golden.commit.mainHead, compare: 'ahead', onMain: true } }), /\/commit\/compare: the org-hosted runner reads main/);
  assert.deepEqual(recordProblems(rehash(org)), []);
  assert.deepEqual(recordProblems(rehash({ ...clone(), commit: { sha: lane, mainHead: golden.commit.mainHead, compare: 'diverged', onMain: false } })), []);
});

test('negative: a hash that is not the hash of the record, a verdict its hashes do not say, an unordered input list', () => {
  refused({ ...clone(), recordHash: 'e'.repeat(64) }, /\/recordHash: not the hash/);
  refused(rehash({ ...clone(), result: { ...golden.result, now: 'f'.repeat(16) } }), /\/result\/verdict: not what its two hashes say/);
  refused(rehash({ ...clone(), result: { ...golden.result, now: 'e41d9422648239dd00' } }), /not the same length/);
  refused(rehash({ ...clone(), inputs: [...golden.inputs].reverse() }), /\/inputs: roles are not unique and in sorted order/);
});

test('negative: no path, field or date the schema does not hold', () => {
  refused(rehash({ ...clone(), inputs: [{ role: 'runner', sha256: golden.inputs[0].sha256, path: 'games/x.py' }] }), /additional|path/);
  refused(rehash({ ...clone(), command: 'python -m games.agent_space.talk.rogue check' }), /\/command: does not match/);
  refused(rehash({ ...clone(), host: 'a machine' }), /additional|host/);
  refused(rehash({ ...clone(), ranAt: '2026-02-30T00:00:00Z' }), /\/ranAt: not a real date/);
  refused(rehash({ ...clone(), ranAt: '2999-01-01T00:00:00Z' }), /\/ranAt: after the check/);
});

test('Lab 05 embeds record v1 by the same schema, word for word', () => {
  const rogueSchema = JSON.parse(readFileSync('scripts/schemas/odin-lab-rogue.schema.json', 'utf8'));
  const { $schema, $id, title, ...record } = JSON.parse(readFileSync(RECORD_SCHEMA, 'utf8'));
  assert.deepEqual(rogueSchema.properties.runs.items, record);
  for (const [i, run] of rogue.runs.entries()) assert.deepEqual(recordProblems(run, `runs/${i}`), []);
});

test('the command line refuses a bad record with exit 1 and passes a good one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab-record-'));
  try {
    writeFileSync(join(dir, 'good.json'), JSON.stringify(golden));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...clone(), recordHash: 'e'.repeat(64) }));
    assert.match(execFileSync('node', ['scripts/lab-record.mjs', join(dir, 'good.json')], { encoding: 'utf8' }), /1 record\(s\): record v1, valid/);
    assert.throws(() => execFileSync('node', ['scripts/lab-record.mjs', join(dir, 'good.json'), join(dir, 'bad.json')], { stdio: 'pipe' }), e => e.status === 1 && /bad\.json#\/recordHash/.test(e.stderr.toString()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
