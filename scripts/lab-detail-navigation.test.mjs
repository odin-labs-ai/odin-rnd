import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readTiles, renderTile } from './lab-tiles.mjs';
import { renderLabs } from './labs.mjs';

test('every published experiment lab has a page reached directly from its index card', () => {
  const pages = renderLabs();
  const index = pages['labs/index.html'];
  for (const tile of readTiles()) {
    const path = `labs/${tile.experiment}/index.html`;
    assert.ok(existsSync(join('site', path)), `${tile.label} has a committed page`);
    assert.ok(pages[path], `${tile.label} has a built page`);
    const card = renderTile(tile);
    assert.match(card, new RegExp(`<a href="\\.\\./${path.replaceAll('.', '\\.')}"><span class="sr-only">`), `${tile.label} has a primary page link`);
    assert.ok(card.includes(`<span class="sr-only">${tile.title} — </span>`), `${tile.label} names its page to screen readers`);
    assert.ok(index.includes(card.slice(0, card.indexOf('<ul class="lab-tile-links">'))), `${tile.label} keeps that link on the index`);
    assert.equal(card.split(`href="../${path}"`).length - 1, 1, `${tile.label} does not repeat its page link among source links`);
    const selfLink = renderTile({ ...tile, links: [...tile.links, { label: 'This lab page', href: path }] });
    assert.equal(selfLink.split(`href="../${path}"`).length - 1, 1, `${tile.label} omits a duplicate self link`);
  }
});

test('the published render requires checked tiles and pages, and Failover metadata follows its tile', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'rnd-lab-page-'));
  try {
    cpSync('site', join(fixture, 'site'), { recursive: true });
    cpSync('scripts', join(fixture, 'scripts'), { recursive: true });
    cpSync('experiments', join(fixture, 'experiments'), { recursive: true });
    copyFileSync('package.json', join(fixture, 'package.json'));
    const source = join(fixture, 'scripts/labs.mjs');
    const original = readFileSync(source, 'utf8');
    assert.ok(original.includes('    ...jury.pages,'), 'the fixture removes a real rendered page entry');
    writeFileSync(source, original.replace('    ...jury.pages,', ''));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /labs\/ai-jury\/index\.html: checked tile has no rendered page/);
    writeFileSync(source, original);
    const tilePath = join(fixture, 'site/data/labs/failover.json');
    const tile = JSON.parse(readFileSync(tilePath, 'utf8'));
    tile.label = 'Lab 12';
    tile.title = 'Failover study';
    tile.question = 'When the primary database stops, which acknowledged writes survive?';
    tile.status = 'Pre-registered; next step under review';
    const alternatePrereg = 'journal/failover-pre-registration-alt.html';
    copyFileSync(join(fixture, 'site/journal/failover-pre-registration.html'), join(fixture, 'site', alternatePrereg));
    tile.links[0].href = alternatePrereg;
    tile.links.push({ label: 'Another plan copy', href: alternatePrereg });
    tile.links.push({ label: 'This lab page', href: 'labs/failover/index.html' });
    writeFileSync(tilePath, JSON.stringify(tile));
    const changed = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; process.stdout.write(renderLabs('site', {requireBench: false})['labs/failover/index.html']);"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.ok(changed.stdout.includes(`<title>${tile.label}: ${tile.title} — Odin Labs R&amp;D</title>`));
    assert.ok(changed.stdout.includes(`<meta property="og:title" content="${tile.label}: ${tile.title} — Odin Labs R&amp;D">`));
    assert.ok(changed.stdout.includes(`<meta name="description" content="${tile.question} ${tile.status}.">`));
    assert.ok(changed.stdout.includes(`<meta property="og:description" content="${tile.question} ${tile.status}.">`));
    assert.ok(changed.stdout.includes(`<span class="technical">${tile.label.toUpperCase()}</span><h1 id="lab-title">${tile.title}</h1>`));
    const plan = changed.stdout.match(/<section[^>]*id="plan"[\s\S]*?<\/section>/)?.[0];
    const sources = changed.stdout.match(/<section[^>]*id="sources"[\s\S]*?<\/section>/)?.[0];
    assert.ok(plan?.includes(`href="../../${alternatePrereg}"`), 'the plan follows the tile link, even when its path changes');
    assert.ok(sources, 'the page has a source list');
    assert.ok(!sources.includes(`href="../../${alternatePrereg}"`), 'the source list omits both copies of the plan link');
    assert.equal(changed.stdout.split(`href="../../${alternatePrereg}"`).length - 1, 1, 'the plan link appears once');
    assert.ok(!sources.includes('href="../../labs/failover/index.html"'), 'the source list omits a link to itself');
    tile.links[0].label = 'The plan';
    writeFileSync(tilePath, JSON.stringify(tile));
    const noPrereg = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(noPrereg.status, 1, noPrereg.stderr);
    assert.match(noPrereg.stderr, /expected one pre-registration link in the checked tile/);
    tile.links[0].label = 'The pre-registration (EXP 021)';
    tile.links.push({ label: 'Pre-registration record', href: 'data/failover/preregistration.json' });
    writeFileSync(tilePath, JSON.stringify(tile));
    const twoPrereg = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(twoPrereg.status, 1, twoPrereg.stderr);
    assert.match(twoPrereg.stderr, /expected one pre-registration link in the checked tile/);
    rmSync(tilePath);
    const missing = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /data\/labs\/failover\.json: missing \(listed in TILE_FILES/);
    copyFileSync('site/data/labs/failover.json', tilePath);
    const tilesSource = join(fixture, 'scripts/lab-tiles.mjs');
    const tilesCode = readFileSync(tilesSource, 'utf8');
    assert.ok(tilesCode.includes("'data/labs/failover.json', "));
    writeFileSync(tilesSource, tilesCode.replace("'data/labs/failover.json', ", ''));
    const unlisted = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(unlisted.status, 1, unlisted.stderr);
    assert.match(unlisted.stderr, /labs\/failover\/index\.html: template has no checked tile/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('the failover page shows the published plan and status without implying a result', () => {
  const page = renderLabs()['labs/failover/index.html'];
  const tile = readTiles().find(item => item.experiment === 'failover');
  assert.ok(page);
  assert.ok(page.includes(tile.question));
  assert.ok(page.includes(tile.how));
  assert.ok(page.includes(tile.status), 'the page reflects the checked tile status');
  assert.ok(page.includes(tile.kind === 'results' ? 'A result is published.' : 'No counted result is published yet.'));
  const prereg = `data/${tile.experiment}/preregistration.json`;
  assert.ok(existsSync(join('site', prereg)), 'the checked tile requires a published pre-registration');
  const preregLinks = tile.links.filter(link => /pre-?registration/i.test(link.label) && /pre-?registration/i.test(link.href));
  assert.equal(preregLinks.length, 1, 'the checked tile names exactly one pre-registration link');
  const preregLink = preregLinks[0];
  const plan = page.match(/<section[^>]*id="plan"[\s\S]*?<\/section>/)?.[0];
  assert.ok(plan?.includes(`href="../../${preregLink.href}"`), 'the plan links the checked tile source');
  assert.equal(page.split(`href="../../${preregLink.href}"`).length - 1, 1, 'the page links the plan once');
  const description = page.match(/<meta name="description" content="([^"]*)">/)?.[1];
  assert.ok(description);
  assert.ok(description.includes(tile.question));
  assert.ok(description.includes(tile.status));
  for (const link of tile.links) assert.ok(page.includes(`href="../../${link.href}"`), `${link.label} is on the lab page`);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/failover/</loc>'));
  assert.doesNotMatch(page, /<!--FAILOVER_[A-Z_]+-->/);
});
