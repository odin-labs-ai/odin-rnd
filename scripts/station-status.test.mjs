import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkResults, measuredStatus, qualifyStationData } from './jev-gate-results-site.mjs';
import { statusText } from './jev-gate-prereg.mjs';
import { stations } from './station-contract.mjs';
import { builtCopy } from './test-build.mjs';

// The screen-reader status (app.js announces "<label>: <title> <status>. Selected.") reads station statuses from the
// #station-data JSON. Station 06's status there must be what its visible heading says: measured once EXP 005's results
// are committed (the same measuredStatus as station-render.mjs), the pre-registration's status without them.

const stationData = html => JSON.parse(/<script type="application\/json" id="station-data">([\s\S]*?)<\/script>/.exec(html)[1]);
const heading = (html, id) => /<div class="compartment-heading"><span>[^<]*<\/span><span>([^<]*)<\/span><\/div>/.exec(html.slice(html.indexOf(`id="station-${id}"`)))?.[1];
const unescapeHtml = s => s.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const triage = stations.find(s => s.record === 'jev-gate');

test('the built #station-data status for station 06 is the status its visible heading shows', { timeout: 600_000 }, () => {
  const page = readFileSync(join(builtCopy(), 'dist', 'index.html'), 'utf8');
  const data = stationData(page), shown = unescapeHtml(heading(page, triage.id));
  const announced = data.find(s => s.id === triage.id).status;
  assert.equal(announced, shown, 'what is announced is what is shown');
  const results = checkResults();
  assert.equal(announced, results ? measuredStatus(results) : statusText, results ? 'measured: the results\' status' : 'no results: the pre-registration\'s status');
  // Every other station is serialised exactly as the contract has it.
  assert.deepEqual(data.filter(s => s.id !== triage.id), stations.filter(s => s.id !== triage.id));
});

test('without results the contract keeps the pre-registration\'s status; qualifyStationData sets only station 06\'s, from the record', () => {
  assert.equal(triage.status, statusText, 'the contract (what the build serialises without results)');
  assert.equal(statusText, 'Pre-registered — not yet run');
  const page = `<body><script type="application/json" id="station-data">${JSON.stringify(stations).replaceAll('<', '\\u003c')}</script></body>`;
  for (const refuted of [true, false]) {
    const data = { results: { claim: { refuted } } };
    const out = stationData(qualifyStationData(page, data));
    assert.equal(out.find(s => s.id === triage.id).status, measuredStatus(data));
    assert.equal(out.find(s => s.id === triage.id).status, refuted ? 'Measured — claim refuted' : 'Measured — claim holds');
    assert.deepEqual(out.filter(s => s.id !== triage.id), stations.filter(s => s.id !== triage.id));
  }
  assert.throws(() => qualifyStationData(page + page, { results: { claim: { refuted: true } } }), /exactly once/);
  assert.equal(qualifyStationData('<body>no station data</body>', { results: { claim: { refuted: true } } }), '<body>no station data</body>', 'a page without #station-data (the source page) is unchanged');
});
