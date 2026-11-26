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
