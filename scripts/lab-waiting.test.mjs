import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { laneCites, list } from './lab-waiting.mjs';

const COMMIT = 'd02ee74b96a997095950185a20afa05a908a2ff0';
const BASE = 'aa35e6dbf07d5e61d5d836389daa214bd9c5e49a';
const laneCite = (over = {}) => ({ onMain: false, commit: COMMIT, lane: 'lane/x', baseMain: BASE, checkedAt: '2026-10-28', ...over });

test('laneCites finds a laneCite at the root and reports its pointer', () => {
  const found = laneCites({ source: laneCite() });
  assert.equal(found.length, 1);
  assert.equal(found[0].at, '/source');
  assert.equal(found[0].cite.commit, COMMIT);
});

test('laneCites finds a cite nested inside arrays and objects', () => {
  const found = laneCites({ a: [{ b: laneCite() }, { c: { d: laneCite({ commit: '1'.repeat(40) }) } }] });
  assert.deepEqual(found.map(f => f.at).sort(), ['/a/0/b', '/a/1/c/d']);
});

test('laneCites skips onMain: true (already cited as main, not waiting)', () => {
  assert.deepEqual(laneCites({ source: { onMain: true, commit: COMMIT } }), []);
});

test('laneCites skips an onMain that is a commit-hash string, not the boolean false (engine-history.json shape)', () => {
  assert.deepEqual(laneCites({ points: [{ onMain: COMMIT, commit: BASE }] }), []);
});

test('laneCites skips a near-miss: onMain false but missing the laneCite fields', () => {
  assert.deepEqual(laneCites({ source: { onMain: false, commit: COMMIT } }), []);
  assert.deepEqual(laneCites({ source: { onMain: false, commit: 'not-hex', lane: 'x', baseMain: BASE, checkedAt: '2026-10-28' } }), []);
});

test('laneCites never descends into a string or a number', () => {
  assert.deepEqual(laneCites('onMain'), []);
  assert.deepEqual(laneCites(42), []);
  assert.deepEqual(laneCites(null), []);
});

test('laneCites escapes ~ and / in an object key per RFC 6901 (a literal / or ~ in a key must not corrupt the pointer)', () => {
  const found = laneCites({ 'weird/key~x': laneCite() });
  assert.equal(found.length, 1);
  assert.equal(found[0].at, '/weird~1key~0x');
  // Order matters: escaping '/' before '~' would turn a literal '/' into '~01' instead of '~1'.
  assert.equal(laneCites({ 'a/~/b': laneCite() })[0].at, '/a~1~0~1b');
});

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'lab-waiting-'));
  try {
    return fn(root, join(root, 'site', 'data', 'labs'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('list() walks a fixture tree and reports exactly the valid laneCite, by file and pointer', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'agent-space'), { recursive: true });
    mkdirSync(join(labsDir, 'rogue'), { recursive: true });
    writeFileSync(join(labsDir, 'agent-space', 'outage.json'), JSON.stringify({ source: laneCite() }));
    writeFileSync(join(labsDir, 'rogue', 'record.json'), JSON.stringify({ runs: [{ commit: { onMain: true, commit: BASE } }] }));
    writeFileSync(join(labsDir, 'rogue', 'broken.json'), '{ not json');
    const registry = list(labsDir);
    assert.equal(registry.format, 'odin-lab-waiting');
    assert.equal(registry.version, 1);
    assert.equal(registry.items.length, 1);
    assert.deepEqual(registry.items[0], {
      lab: 'agent-space', file: 'data/labs/agent-space/outage.json', at: '/source',
      commit: COMMIT, lane: 'lane/x', baseMain: BASE, checkedAt: '2026-10-28',
    });
  });
});

test('list() fails loudly on a record it cannot read, never as "nothing is waiting for main"', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'locked'), { recursive: true });
    const file = join(labsDir, 'locked', 'secret.json');
    writeFileSync(file, JSON.stringify({ source: laneCite() }));
    chmodSync(file, 0o000);
    try {
      assert.throws(() => list(labsDir), /could not check.*locked\/secret\.json/);
    } finally {
      chmodSync(file, 0o600); // restore before withFixture's rmSync cleans up
    }
  });
});

test('list() still skips a record it can read but cannot parse, rather than throwing (the two failures are not the same)', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'rogue'), { recursive: true });
    writeFileSync(join(labsDir, 'rogue', 'broken.json'), '{ not json');
    assert.deepEqual(list(labsDir).items, []);
  });
});

test('list() never follows a symlink that escapes the lab tree, even one that points at a valid laneCite', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'agent-space'), { recursive: true });
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.json'), JSON.stringify({ source: laneCite() }));
    symlinkSync(join(outside, 'secret.json'), join(labsDir, 'agent-space', 'escape.json'));
    assert.deepEqual(list(labsDir).items, [], 'the escaping symlink must never be read, let alone cited');
  });
});

test('list() still follows a symlink whose target stays inside the lab tree', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'agent-space'), { recursive: true });
    writeFileSync(join(labsDir, 'agent-space', 'real.json'), JSON.stringify({ source: laneCite() }));
    symlinkSync(join(labsDir, 'agent-space', 'real.json'), join(labsDir, 'agent-space', 'alias.json'));
    assert.equal(list(labsDir).items.length, 2, 'both the real file and the in-tree alias are read');
  });
});

test('list() skips a dangling symlink (its target does not exist) instead of throwing', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'agent-space'), { recursive: true });
    symlinkSync(join(labsDir, 'agent-space', 'does-not-exist.json'), join(labsDir, 'agent-space', 'dangling.json'));
    assert.deepEqual(list(labsDir).items, []);
  });
});

test('list() reports one row per cite and sorts by file then pointer', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'b-lab'), { recursive: true });
    mkdirSync(join(labsDir, 'a-lab'), { recursive: true });
    writeFileSync(join(labsDir, 'b-lab', 'x.json'), JSON.stringify({ z: laneCite(), a: laneCite() }));
    writeFileSync(join(labsDir, 'a-lab', 'y.json'), JSON.stringify({ source: laneCite() }));
    const registry = list(labsDir);
    assert.deepEqual(registry.items.map(i => `${i.file}${i.at}`), [
      'data/labs/a-lab/y.json/source',
      'data/labs/b-lab/x.json/a',
      'data/labs/b-lab/x.json/z',
    ]);
  });
});

// A specific item's exact shape is asserted only against a fixture (above); the live registry can change the day
// the lane actually flips, and this test must not break the day it does. It only checks the shared contract every
// item must meet, over whatever the real tree holds right now.
test('list() against this repository\'s own committed records: every item meets the shared contract, whatever it holds today', () => {
  const registry = list();
  assert.equal(registry.format, 'odin-lab-waiting');
  assert.equal(registry.version, 1);
  // The same contract odin-labs' lane_watch.py enforces (ITEM_KEYS, HEX40, DAY), mirrored here so this registry can
  // never commit an item the daily check would refuse.
  const HEX40 = /^[0-9a-f]{40}$/, DAY = /^\d{4}-\d{2}-\d{2}$/, FILE = /^data\/labs\/[a-z0-9][a-z0-9._/-]*\.json$/;
  for (const item of registry.items) {
    for (const k of ['lab', 'file', 'at', 'commit', 'lane', 'baseMain', 'checkedAt']) assert.ok(k in item, `${item.file}${item.at}: no ${k}`);
    assert.match(item.commit, HEX40, item.file);
    assert.match(item.baseMain, HEX40, item.file);
    assert.match(item.checkedAt, DAY, item.file);
    assert.match(item.file, FILE);
    assert.notEqual(item.commit, item.baseMain);
    assert.ok(item.lab && item.lane, item.file);
  }
});

// The CLI tests below run the real binary as a subprocess (exercising argv parsing, stdout formatting and exit
// codes exactly as a real invocation would), but against LAB_WAITING_LABS_DIR, a fixture -- not this repository's
// own live, mutable records. A test tied to "today's" live cite would break the day the lane actually flips.
test('CLI: list --json prints the odin-lab-waiting registry, against a fixture', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'agent-space'), { recursive: true });
    writeFileSync(join(labsDir, 'agent-space', 'outage.json'), JSON.stringify({ source: laneCite() }));
    const out = execFileSync('node', ['scripts/lab-waiting.mjs', 'list', '--json'], { encoding: 'utf8', env: { ...process.env, LAB_WAITING_LABS_DIR: labsDir } });
    const registry = JSON.parse(out);
    assert.equal(registry.format, 'odin-lab-waiting');
    assert.ok(registry.items.some(i => i.file === 'data/labs/agent-space/outage.json' && i.commit === COMMIT));
  });
});

test('CLI: list without --json prints a human line per item, against a fixture', () => {
  withFixture((root, labsDir) => {
    mkdirSync(join(labsDir, 'agent-space'), { recursive: true });
    writeFileSync(join(labsDir, 'agent-space', 'outage.json'), JSON.stringify({ source: laneCite() }));
    const out = execFileSync('node', ['scripts/lab-waiting.mjs', 'list'], { encoding: 'utf8', env: { ...process.env, LAB_WAITING_LABS_DIR: labsDir } });
    assert.match(out, new RegExp(`${COMMIT.slice(0, 12)} agent-space data/labs/agent-space/outage\\.json/source`));
  });
});

test('CLI: list says nothing is waiting when the fixture has no cite', () => {
  withFixture((root, labsDir) => {
    mkdirSync(labsDir, { recursive: true });
    const out = execFileSync('node', ['scripts/lab-waiting.mjs', 'list'], { encoding: 'utf8', env: { ...process.env, LAB_WAITING_LABS_DIR: labsDir } });
    assert.match(out, /nothing is waiting for main/);
  });
});

test('CLI: flip refuses (not yet built) and leaves every real record byte-for-byte unchanged, with every argument present', () => {
  const RECORD = 'site/data/labs/agent-space/outage.json';
  const before = readFileSync(RECORD);
  try {
    assert.throws(
      () => execFileSync('node', ['scripts/lab-waiting.mjs', 'flip', '--commit', COMMIT, '--main', '1'.repeat(40), '--checked', '2026-11-28', '--compare', 'diverged'], { stdio: 'pipe' }),
      e => e.status === 1 && /not yet implemented/.test(e.stderr.toString()),
    );
  } finally {
    assert.deepEqual(readFileSync(RECORD), before, 'flip must not touch the real record even on its refused path');
  }
});

test('CLI: flip with a missing argument refuses before trying anything', () => {
  assert.throws(
    () => execFileSync('node', ['scripts/lab-waiting.mjs', 'flip', '--commit', COMMIT], { stdio: 'pipe' }),
    e => e.status === 2 && /--main is required/.test(e.stderr.toString()),
  );
});

test('CLI: an unknown command prints usage and refuses', () => {
  assert.throws(() => execFileSync('node', ['scripts/lab-waiting.mjs', 'nonsense'], { stdio: 'pipe' }), e => e.status === 2 && /usage: lab-waiting\.mjs/.test(e.stderr.toString()));
});
