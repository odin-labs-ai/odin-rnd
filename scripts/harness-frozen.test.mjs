import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CENSUS_FILE, census, pinSources, renderCensus } from '../harness/frozen-census.mjs';

// The harness (bundle 2 of the composable-harness plan) must change no byte that any experiment binds. This census
// reads every pin format in the tree and fails, naming the path, on any bound file whose bytes differ from its
// effective hash. It can only make the suite stricter: a new pin is picked up live, and the committed list is a floor.

const live = census();

test('every bound path hashes to its effective pin on this tree', () => {
  assert.deepEqual(live.violations, [], live.violations.map(v => `${v.path}: ${v.reason}`).join('\n'));
});

test('the census covers the known bound set', () => {
  const paths = new Set(live.entries.map(e => e.path));
  const has = p => assert.ok(paths.has(p), `${p} is bound`);
  // EXP 005: its runners, the laya-vs-jev runners they pin, and scripts/check.mjs (bound by EXP 006's runners.sha256).
  for (const p of ['experiments/jev-gate/runner-guard.mjs', 'experiments/jev-gate/run_reviewer.mjs', 'experiments/laya-vs-jev/run.py', 'experiments/laya-vs-jev/laya_mlx.py', 'scripts/check.mjs']) has(p);
  // The published ROI witness records bind their inputs and generator, demos/lib.mjs included (witness-records.mjs).
  for (const p of ['demos/lib.mjs', 'demos/CONTRACT.md', 'scripts/witness-records.mjs', 'site/data/witnesses/test-witness.json']) has(p);
  assert.ok(live.entries.find(e => e.path === 'demos/lib.mjs').boundBy.every(b => b.startsWith('site/data/witnesses/')));
  const by = prefix => live.entries.filter(e => e.boundBy.some(b => b.startsWith(prefix)));
  assert.ok(by('experiments/nina-changes/').length >= 20, 'EXP 006 binds at least 20 paths');
  assert.ok(by('experiments/latent-handoff/').length >= 45, 'EXP 008 binds at least 45 paths');
  // scripts/check.mjs is EXP 006's: the harness must never edit it.
  assert.ok(live.entries.find(e => e.path === 'scripts/check.mjs').boundBy.some(b => b.startsWith('experiments/nina-changes/runners.sha256')));
  // EXP 006 amendment 01 re-pinned seven runner files: their effective hash is the amendment's, not the pre-registration's.
  const rr = live.entries.find(e => e.path === 'experiments/nina-changes/run_reviewer6.mjs');
  assert.ok(rr.boundBy.some(b => b.includes('preregistration.json#files -> experiments/nina-changes/amendment-01.json#pins')));
  // The roi-lib flake target is not bound (bundle 2 WO-05 relies on this).
  assert.equal([...paths].filter(p => p.startsWith('scripts/roi-lib')).length, 0);
});

test('the committed census is a floor: every listed path is still bound, and it renders from this tree', () => {
  const committed = JSON.parse(readFileSync(CENSUS_FILE, 'utf8'));
  const paths = new Set(live.entries.map(e => e.path));
  for (const p of committed.paths) assert.ok(paths.has(p), `${p} was bound when the census was committed and no longer is`);
  assert.ok(committed.paths.length >= 100, 'the committed census lists the bound set');
  // While no pin has been added since, the committed file is exactly the rendered census.
  if (live.entries.length === committed.paths.length) assert.equal(readFileSync(CENSUS_FILE, 'utf8'), renderCensus(live.entries));
});

/** One scratch copy holding only the pin files and the bound files, so a flipped byte never touches the tree. */
const root = mkdtempSync(join(tmpdir(), 'harness-frozen-'));
after(() => rmSync(root, { recursive: true, force: true }));
for (const p of new Set([...pinSources(), ...live.entries.map(e => e.path)])) {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  cpSync(p, join(root, p));
}
/** Run fn against the scratch copy with `p` mutated, then restore p's bytes. */
function mutated(p, mutate, fn) {
  const original = readFileSync(join(root, p));
  try { mutate(join(root, p), original); return fn(); } finally { writeFileSync(join(root, p), original); }
}
test('a scratch copy is clean, and one flipped byte in a file of each pin format fails with the path named', () => {
  assert.deepEqual(census(root).violations, [], 'the scratch copy reproduces the live census');
  const cases = [
    ['scripts/check.mjs', 'runners.sha256 (repo-root path)'],
    ['experiments/latent-handoff/corpus-x/corpus/c061.patch', 'sha256sum list (path relative to the list)'],
    ['experiments/latent-handoff/models.json', 'preregistration.json#files'],
    ['experiments/nina-changes/run_reviewer6.mjs', 'amendment #pins re-pin'],
    ['experiments/jev-gate/fixtures/amendment-01.fixture.json', 'fixture digest'],
    ['experiments/latent-handoff/vendor/ffr/validate.mjs', 'vendor.json#files'],
    ['demos/lib.mjs', 'ROI witness record #inputSha256'],
  ];
  for (const [p, format] of cases) {
    const v = mutated(p, (abs, bytes) => { const b = Buffer.from(bytes); b[b.length >> 1] ^= 0x01; writeFileSync(abs, b); }, () => census(root).violations);
    assert.ok(v.length > 0 && v.every(x => x.path === p), `${format}: ${p} flipped -> ${JSON.stringify(v)}`);
    assert.match(v[0].reason, /bytes hash to/);
  }
  assert.deepEqual(census(root).violations, [], 'restoring every byte restores a clean census');
});

test('an amendment whose from does not equal the binding it supersedes is a violation', () => {
  const v = mutated('experiments/nina-changes/amendment-01.json', (abs, bytes) => {
    const j = JSON.parse(bytes);
    j.pins['experiments/nina-changes/stream6.mjs'].from = '0'.repeat(64);
    writeFileSync(abs, JSON.stringify(j));
  }, () => census(root).violations).filter(x => x.path === 'experiments/nina-changes/stream6.mjs');
  assert.equal(v.length, 1);
  assert.match(v[0].reason, /#pins: from 000000000000 != the bound/);
});

test('a bound file that disappears is named', () => {
  const v = mutated('experiments/jev-gate/lint.mjs', abs => rmSync(abs), () => census(root).violations);
  assert.deepEqual(v, [{ path: 'experiments/jev-gate/lint.mjs', reason: 'bound but missing' }]);
});
