import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { stations } from './station-contract.mjs';
import { renderStations, renderStationLinks } from './station-render.mjs';
import { factoryFloor } from './floor.mjs';
import { loadLaya, benchBlock, assertBenchCurrent, spliceBench, reproduceCommand, renderLayaBench, readmePath } from './laya-bench.mjs';

// The home page is site/index.html (the bench, rendered by laya-bench.mjs --write) plus the station
// compartments renderStations adds during the build. Both must show exactly what the committed record says.
const page = readFileSync('site/index.html', 'utf8');
const laya = loadLaya();
const record = JSON.parse(readFileSync(`site/data/laya-vs-jev/${laya.manifest.file}`, 'utf8'));
const report = JSON.parse(readFileSync('site/data/experiments.json', 'utf8'));
const reports = ['migration-witness', 'test-witness', 'ci-witness'].map(id => JSON.parse(readFileSync(`site/data/witnesses/${id}.json`, 'utf8')));
const bench = benchBlock(page).block;
const exhibit = renderStations(report, reports).split('id="station-decision"')[1]?.split('</article>')[0] ?? '';

// Derived straight from the JSON, not through the renderer under test.
const L = record.perModel['laya-typed-decisions'], J = record.perModel.jev;
const expected = {
  layaAccuracy: `${L.detail.correct} / ${L.detail.rows}`,
  jevAccuracy: `${J.detail.correct} / ${J.detail.rows}`,
  layaP50: `${Math.round(L.p50Ms)} ms`,
  jevP50: `${Math.round(J.p50Ms)} ms`,
  parity: `${record.parity.sameDecision} / ${record.parity.rows}`,
  accuracyVerdict: (J.accuracy - L.accuracy) * 100 > 10 ? 'RED' : 'GREEN',
};

test('home-page Laya numbers match the committed record', () => {
  assert.match(bench, new RegExp(`id="laya-accuracy">${expected.layaAccuracy}<`));
  assert.match(bench, new RegExp(`id="jev-accuracy">${expected.jevAccuracy}<`));
  assert.match(bench, new RegExp(`id="laya-p50">${expected.layaP50}<`));
  assert.match(bench, new RegExp(`id="jev-p50">${expected.jevP50}<`));
  assert.match(bench, new RegExp(`id="laya-parity">${expected.parity}<`));
  assert.match(bench, new RegExp(`ACCURACY / ${expected.accuracyVerdict} ·`));
  assert.match(bench, new RegExp(`verdict-${expected.accuracyVerdict.toLowerCase()}">${expected.accuracyVerdict}<`));
  for (const value of [`${expected.accuracyVerdict} · ${expected.layaAccuracy}`, expected.jevAccuracy, `${expected.layaP50} vs ${expected.jevP50}`, expected.parity]) assert(exhibit.includes(`<strong>${value}</strong>`), `Station 05 is missing ${value}`);
  assert(bench.includes(`href="data/laya-vs-jev/${laya.manifest.file}"`), 'Bench must link the exact record it renders');
});

test('a drifted page or a changed record fails the build-time bench check', () => {
  assert.doesNotThrow(() => assertBenchCurrent(page, laya));
  const drifted = page.replace(`id="laya-accuracy">${expected.layaAccuracy}<`, 'id="laya-accuracy">47 / 48<');
  assert.notEqual(drifted, page);
  assert.throws(() => assertBenchCurrent(drifted, laya), /differs from the committed record/);
  const changed = structuredClone(laya); changed.results.perModel['laya-typed-decisions'].detail.correct += 1;
  assert.throws(() => assertBenchCurrent(page, changed), /differs from the committed record/);
  assert.throws(() => renderStations(report, reports, laya, drifted), /differs from the committed record/);
  assert.equal(spliceBench(page, renderLayaBench(laya)), page, 'Re-rendering the committed page is a no-op');
});

test('the bench explains the model, the lock-in, the result and the limits, and reproduces from the README', () => {
  for (const phrase of ['WHAT IS A SYSTEM-1 DECISION MODEL?', 'does not write text', 'WHY NO VENDOR LOCK-IN MATTERS', 'Apache-2.0 weights that run on your own machine', 'hosted API', 'not a benchmark', 'one busy laptop']) assert(bench.includes(phrase), `Bench is missing: ${phrase}`);
  const escaped = reproduceCommand(readFileSync(readmePath, 'utf8')).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  assert(bench.includes(`id="laya-reproduce-command" tabindex="0">${escaped}</pre>`));
  assert(escaped.includes('run.py'));
  assert.doesNotMatch(bench, /<script|<link|<img|<iframe|\bsrc=/, 'The bench adds no requests to the home page');
});

test('station 05 exists on the floor, opens like the others and its links resolve', () => {
  const station = stations.find(s => s.id === 'decision');
  assert.equal(station?.number, '05');
  assert.equal(station.href, '#laya-bench');
  assert(renderStationLinks().includes('href="#laya-bench" data-station="decision"'));
  const floor = factoryFloor();
  assert(floor.includes('data-floor-station="decision"') && floor.includes('>05</text>'));
  assert(factoryFloor({ crop: true }).includes('data-floor-station="decision"'));
  assert.equal(stations.length, [...floor.matchAll(/data-floor-station="/g)].length, 'Every station has floor geometry');
  assert(exhibit.includes('href="#laya-bench"'), 'Station 05 leads to the Laya bench');
  assert(page.includes('id="laya-bench"'), 'The bench anchor exists');
  const links = [...`${bench}${exhibit}`.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)].map(m => m[1]).filter(href => !/^https?:/.test(href));
  for (const href of ['projects/laya-browser/', 'journal/system-1-decisions-without-lock-in.html', `data/laya-vs-jev/${laya.manifest.file}`]) assert(links.includes(href), `Missing link ${href}`);
  for (const href of links) assert(existsSync(`site/${href.endsWith('/') ? href + 'index.html' : href}`), `Link does not resolve: ${href}`);
});

test('project row 002 features Laya and the numbering stays consistent', () => {
  const rows = [...page.matchAll(/<article class="project-row( project-featured)?"><div class="project-number">(\d{3})<span>([A-Z]+)<\/span>/g)].map(m => [m[2], m[3], Boolean(m[1])]);
  assert.deepEqual(rows, [['001', 'ENGINE', true], ['002', 'DECISIONS', true], ['003', 'ARTIFACTS', false], ['000', 'WORKSHOP', false]]);
  const featured = page.split('<div class="project-number">002')[1].split('</article>')[0];
  for (const href of ['projects/laya-browser/', '#laya-bench', 'journal/system-1-decisions-without-lock-in.html']) assert(featured.includes(`href="${href}"`), `Featured row is missing ${href}`);
});

test('the Laya copy button copies the rendered command and reports clipboard denial truthfully', async () => {
  const { setupCopyButtons } = await import('../site/assets/app.js');
  const status = { textContent: '' };
  let handler;
  const button = { dataset: { copyTarget: 'laya-reproduce-command' }, nextElementSibling: status, addEventListener: (_, fn) => { handler = fn; } };
  const command = { textContent: 'cd experiments/laya-vs-jev' };
  const doc = { querySelectorAll: () => [button], getElementById: id => id === 'laya-reproduce-command' ? command : null };
  let copied;
  setupCopyButtons(doc, { navigator: { clipboard: { writeText: async text => { copied = text; } } } });
  await handler();
  assert.equal(copied, command.textContent); assert.equal(status.textContent, 'Command copied.');
  setupCopyButtons(doc, { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  await handler();
  assert.match(status.textContent, /manually/);
});
