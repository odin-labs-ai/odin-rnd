import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTiles, renderTile, tileProblems } from './lab-tiles.mjs';
import { renderLabs } from './labs.mjs';

// Lab 03's tile on the Labs index (mission rnd-labs-human-first-1024): what the lab asks, its status, and links to its
// frozen records; no number, no prediction, nothing private.
const temp = mkdtempSync(join(tmpdir(), 'lab-tiles-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const committed = JSON.parse(readFileSync('site/data/labs/failover.json', 'utf8'));

test('Lab 03 renders on the Labs index after Lab 01, says what it asks and that it has not run, and links EXP 021 and its amendment', () => {
  assert.deepEqual(tileProblems(committed), []);
  const page = renderLabs()['labs/index.html'];
  const lab01 = page.indexOf('<a class="lab-tile" href="agent-space/">'), lab03 = page.indexOf('<article class="lab-tile lab-tile-static" aria-labelledby="lab-tile-failover">');
  assert.ok(lab01 >= 0 && lab03 > lab01, 'Lab 03 follows Lab 01');
  const tile = page.slice(lab03, page.indexOf('</article>', lab03));
  assert.match(tile, /<span class="technical">LAB 03<\/span><h2 id="lab-tile-failover">Failover<\/h2>/);
  assert.match(tile, /MongoDB or PostgreSQL\?/);
  assert.match(tile, /<p class="lab-tile-status">Pre-registered, not yet run\.<\/p>/);
  assert.match(tile, /<a href="\.\.\/journal\/failover-pre-registration\.html">The pre-registration \(EXP 021\)<\/a>/);
  assert.match(tile, /<a href="\.\.\/data\/failover\/amendment-01\.json">Amendment 01: how it will be run<\/a>/);
  assert.doesNotMatch(tile.replace(/<[^>]*>/g, ' ').replace(/LAB 03|EXP 021|Amendment 01/g, ''), /\d/, 'no number beyond the lab, experiment and amendment names');
  assert.doesNotMatch(tile, /fits|predict|winner|faster|safer/i, 'no prediction or verdict');
  // Lab 02's tile (a results lab) sits between Lab 01 and Lab 03, once.
  const lab02 = page.indexOf('<article class="lab-tile lab-tile-static" aria-labelledby="lab-tile-brain-bench">');
  assert.ok(lab01 < lab02 && lab02 < lab03, 'Lab 02 sits between Lab 01 and Lab 03');
  assert.equal((page.match(/LAB 02/g) ?? []).length, 1);
});

test('the published site requires every listed tile: the repository\'s own site/ root defaults to required', () => {
  assert.deepEqual(readTiles('site').map(t => t.label), ['Lab 02', 'Lab 03']);
  assert.equal(readTiles(join(process.cwd(), 'site')).length, 2);
});

test('the build refuses a tile with a number, a missing or outside link, an unscreened word, or a stale status', () => {
  const root = join(temp, 'site');
  mkdirSync(join(root, 'data/labs'), { recursive: true });
  cpSync('site/data/failover', join(root, 'data/failover'), { recursive: true });
  cpSync('site/journal', join(root, 'journal'), { recursive: true });
  const cases = [
    [t => { t.how = 'We stop the primary after 30 seconds.'; }, /how: a tile carries no number/],
    [t => { t.links[1].href = 'data/failover/amendment-02.json'; }, /links\/1\/href: data\/failover\/amendment-02\.json is not on this site/],
    [t => { t.links[0].href = 'https://example.com/x.html'; }, /links\/0\/href: not a page or record path of this site/],
    [t => { t.links[0].href = '../secret.html'; }, /links\/0\/href: not a page or record path/],
    [t => { t.question = `Which store keeps writes in ${[...'nrooH'].reverse().join('')}?`; }, /question: a place name/],
    [t => { t.how = 'See PROTOCOL-LAB02.md for details.'; }, /how: a file path or file name/],
    [t => { t.experiment = 'nothing-here'; }, /data\/nothing-here\/preregistration\.json is not published/],
    [t => { t.extra = 'x'; }, /extra: not allowed/],
  ];
  for (const [edit, expected] of cases) {
    const t = structuredClone(committed); edit(t);
    assert.match(tileProblems(t, root).join('\n'), expected, String(expected));
  }
  // A listed tile that is missing refuses the build of the published site (required), and a fixture that asks for it.
  assert.throws(() => readTiles(root, { required: true }), /data\/labs\/failover\.json: missing \(listed in TILE_FILES/);
  assert.deepEqual(readTiles(root), [], 'a fixture site without the tile renders none');
  writeFileSync(join(root, 'data/labs/failover.json'), JSON.stringify(committed));
  assert.equal(readTiles(root).length, 1);
  // Once results are published, "not yet run" is refused until the tile is updated.
  writeFileSync(join(root, 'data/failover/results.json'), '{}');
  assert.throws(() => readTiles(root), /status: says not yet run, but data\/failover\/results\.json is published/);
  assert.match(renderTile(committed), /^<article class="lab-tile lab-tile-static"/);
});

const results = JSON.parse(readFileSync('site/data/labs/brain-bench-tile.json', 'utf8'));

test('Lab 02 is a results lab: it links its page and its pinned record, says its pre-registrations are private, and carries no number', () => {
  assert.deepEqual(tileProblems(results), []);
  const tile = renderTile(results);
  assert.match(tile, /<span class="technical">LAB 02<\/span><h2 id="lab-tile-brain-bench">Every brain on the same tasks<\/h2>/);
  assert.match(tile, /<p class="lab-tile-status">Results published · pre-registrations private, cited by hash\.<\/p>/);
  assert.match(tile, /<a href="\.\.\/labs\/brain-bench\/index\.html">/);
  assert.match(tile, /<a href="\.\.\/data\/labs\/brain-bench\/results\.json">/);
  assert.doesNotMatch(tile.replace(/<[^>]*>/g, ' ').replace(/LAB 02/g, ''), /\d/);
});

test('a results lab is refused without its record, without a matching pin, or without a link to the record', () => {
  const root = join(temp, 'results-site');
  const copy = file => { mkdirSync(join(root, file, '..'), { recursive: true }); cpSync(join('site', file), join(root, file)); };
  for (const file of ['labs/brain-bench/index.html', 'data/labs/brain-bench/results.json', 'data/labs/brain-bench/results.sha256']) copy(file);
  assert.deepEqual(tileProblems(results, root), []);
  const cases = [
    [t => { delete t.record; }, /must have required property|record/],
    [t => { t.record.pin = 'data/labs/brain-bench/missing.sha256'; }, /record\/pin: data\/labs\/brain-bench\/missing\.sha256 is not on this site/],
    [t => { t.record.href = 'data/labs/brain-bench/results.sha256'; }, /record\/href: not a record \(\.json\) path/],
    [t => { t.record.pin = '../results.sha256'; }, /record\/pin: not a pin \(\.sha256\) path/],
    [t => { t.links = t.links.slice(0, 1); }, /the tile does not link its record/],
    [t => { t.status = 'Results published, cited by hash, not yet run'; }, /a results lab has run/],
    [t => { delete t.kind; }, /only a results lab \(kind "results"\) carries a record/],
  ];
  for (const [edit, expected] of cases) {
    const t = structuredClone(results); edit(t);
    assert.match(tileProblems(t, root).join('\n'), expected, String(expected));
  }
  // A record that changes without its pin is refused.
  writeFileSync(join(root, 'data/labs/brain-bench/results.json'), `${readFileSync('site/data/labs/brain-bench/results.json', 'utf8')} `);
  assert.match(tileProblems(results, root).join('\n'), /record\/pin: data\/labs\/brain-bench\/results\.sha256 does not pin the sha256 of data\/labs\/brain-bench\/results\.json/);
});
