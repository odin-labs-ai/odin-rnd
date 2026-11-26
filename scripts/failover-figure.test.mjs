import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { failoverFigure } from './failover-figure.mjs';

const record = JSON.parse(readFileSync(new URL('../site/data/failover/results.json', import.meta.url), 'utf8'));

test('EXP 021 shows only the six timed cells and keeps timing separate from the feed verdict', () => {
  const html = failoverFigure(record);
  const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th>(.*?)<\/tr>/g)];
  assert.deepEqual(rows.map(row => row[1]), ['Node stopped', 'Node isolated', 'Planned switchover']);
  assert.deepEqual(rows.map(row => [...row[2].matchAll(/class="failover-(?:reading|feed)">([^<]+)</g)].map(cell => cell[1])),
    [['25.0 s', '11.0 s'], ['9.7 s', '10.2 s'], ['3.1 s', '9.0 s']]);
  // Each bar is its reading over the longest one, so every width is finite and the longest is the full row (review 2bb1b73a item 8).
  assert.deepEqual([...html.matchAll(/class="failover-bar" aria-hidden="true" style="width:([^"]+)"/g)].map(m => m[1]),
    ['100.0%', '43.9%', '39.0%', '40.9%', '12.5%', '36.1%']);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /href="data\/failover\/results.json"/);
  assert.match(html, /scope="colgroup" colspan="2">MongoDB faster by \(s\)<\/th><\/tr><tr><th scope="col">Default<\/th><th scope="col">Tuned/);
  assert.match(html, /only PostgreSQL passed the feed check at both settings/);
  assert.match(html, /datetime="2026-11-11"/);
});

test('the chart reads the repeat-run differences and refuses a verdict its caption cannot describe', () => {
  const copy = structuredClone(record);
  copy.verdict.scenarios['default/F1'].repro_median_diff = -30.2;
  assert.match(failoverFigure(copy), /30\.2 s/);
  copy.verdict.scenarios['default/F2b'].gates.mongo = true;
  assert.throws(() => failoverFigure(copy), /EXP 021 comparison changed: default\/F2b/);
});

test('a rerun where MongoDB was not faster stops the build with its own message, not a changed comparison (review 2bb1b73a item 7)', () => {
  for (const diff of [1, 0]) {
    const copy = structuredClone(record);
    copy.verdict.scenarios['tuned/F3'].repro_median_diff = diff;
    assert.throws(() => failoverFigure(copy), /EXP 021 result moved \(MongoDB not faster\): tuned\/F3; rewrite the figure and caption/, String(diff));
  }
  const copy = structuredClone(record);
  copy.verdict.scenarios['tuned/F3'].verdict = 'postgres-fits';
  assert.throws(() => failoverFigure(copy), /EXP 021 comparison changed: tuned\/F3/);
});

test('a scenario the figure does not describe stops the build (review 2bb1b73a item 6)', () => {
  const copy = structuredClone(record);
  copy.verdict.scenarios['default/F4'] = structuredClone(copy.verdict.scenarios['default/F1']);
  assert.throws(() => failoverFigure(copy), /EXP 021 scenario not described by the figure: default\/F4/);
});

test('a date the pattern admits but no calendar has stops the build (review 2bb1b73a item 9)', () => {
  for (const date of ['2026-02-30', '2026-13-01', '2026-99-99']) {
    const copy = structuredClone(record);
    copy.date = date;
    assert.throws(() => failoverFigure(copy), /EXP 021 date is not a calendar day/, date);
  }
});
