import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    assert.match(card, new RegExp(`<a href="\\.\\./${path.replaceAll('.', '\\.')}">Open the lab page`), `${tile.label} has a primary page link`);
    assert.ok(index.includes(card.slice(0, card.indexOf('<ul class="lab-tile-links">'))), `${tile.label} keeps that link on the index`);
    assert.equal(card.split(`href="../${path}"`).length - 1, 1, `${tile.label} does not repeat its page link among source links`);
  }
});

test('the failover page shows the published plan and status without implying a result', () => {
  const page = renderLabs()['labs/failover/index.html'];
  const tile = readTiles().find(item => item.experiment === 'failover');
  assert.ok(page);
  assert.ok(page.includes(tile.question));
  assert.ok(page.includes(tile.how));
  assert.ok(page.includes(tile.status), 'the page follows the checked tile as the lab progresses');
  assert.match(page, /No counted result is published yet/);
  assert.match(page, /data\/failover\/preregistration\.json/);
  for (const link of tile.links) assert.ok(page.includes(`href="../../${link.href}"`), `${link.label} is on the lab page`);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/failover/</loc>'));
  assert.doesNotMatch(page, /<!--FAILOVER_[A-Z_]+-->/);
});
