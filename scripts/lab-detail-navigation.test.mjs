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
    tile.title = 'Failover study';
    tile.question = 'When the primary database stops, which acknowledged writes survive?';
    tile.links[0].href = 'data/failover/preregistration.json';
    writeFileSync(tilePath, JSON.stringify(tile));
    const changed = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; process.stdout.write(renderLabs('site', {requireBench: false})['labs/failover/index.html']);"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.ok(changed.stdout.includes(`<title>${tile.label}: ${tile.title} — Odin Labs R&amp;D</title>`));
    assert.ok(changed.stdout.includes(`<meta name="description" content="${tile.question} ${tile.status}.">`));
    assert.ok(changed.stdout.includes(`href="../../${tile.links[0].href}"`));
    rmSync(tilePath);
    const missing = spawnSync(process.execPath, ['--input-type=module', '-e', "import {renderLabs} from './scripts/labs.mjs'; renderLabs('site', {requireBench: false});"], { cwd: fixture, encoding: 'utf8' });
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /data\/labs\/failover\.json: missing \(listed in TILE_FILES/);
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
  const preregLink = tile.links.find(link => /pre-registration/i.test(link.label));
  assert.ok(preregLink, 'the checked tile names its pre-registration link');
  assert.ok(page.includes(`href="../../${preregLink.href}"`), 'the page links the checked tile source');
  const description = page.match(/<meta name="description" content="([^"]*)">/)?.[1];
  assert.ok(description);
  assert.ok(description.includes(tile.question));
  assert.ok(description.includes(tile.status));
  for (const link of tile.links) assert.ok(page.includes(`href="../../${link.href}"`), `${link.label} is on the lab page`);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/failover/</loc>'));
  assert.doesNotMatch(page, /<!--FAILOVER_[A-Z_]+-->/);
});
