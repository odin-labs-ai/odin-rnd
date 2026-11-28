import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('list() against this repository\'s own committed records finds the known live cite and nothing malformed', () => {
  const registry = list();
  assert.equal(registry.format, 'odin-lab-waiting');
  assert.equal(registry.version, 1);
  const outage = registry.items.find(i => i.file === 'data/labs/agent-space/outage.json');
  assert.ok(outage, 'agent-space/outage.json is cited by lane (source.onMain is false there today)');
  assert.equal(outage.at, '/source');
  assert.equal(outage.commit, COMMIT);
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

test('CLI: list --json prints the odin-lab-waiting registry', () => {
  const out = execFileSync('node', ['scripts/lab-waiting.mjs', 'list', '--json'], { encoding: 'utf8' });
  const registry = JSON.parse(out);
  assert.equal(registry.format, 'odin-lab-waiting');
  assert.ok(registry.items.some(i => i.file === 'data/labs/agent-space/outage.json'));
});

test('CLI: list without --json prints a human line per item', () => {
  const out = execFileSync('node', ['scripts/lab-waiting.mjs', 'list'], { encoding: 'utf8' });
  assert.match(out, new RegExp(`${COMMIT.slice(0, 12)} agent-space data/labs/agent-space/outage\\.json/source`));
});

test('CLI: flip refuses (not yet built) instead of touching a record, with every argument present', () => {
  assert.throws(
    () => execFileSync('node', ['scripts/lab-waiting.mjs', 'flip', '--commit', COMMIT, '--main', '1'.repeat(40), '--checked', '2026-11-28', '--compare', 'diverged'], { stdio: 'pipe' }),
    e => e.status === 1 && /not yet implemented/.test(e.stderr.toString()),
  );
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
