import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';

// odin-labs.ai counts R&D page views (GitHub Pages has no analytics): the build adds its beacon to every page, once.
const BEACON = '<script defer src="https://odin-labs.ai/rnd-beacon.js"></script>';
const walk = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);

test('every built page loads the odin-labs.ai view beacon exactly once, inside <head>', () => {
  const pages = walk(join(builtCopy(), 'dist')).filter(file => file.endsWith('.html'));
  assert.ok(pages.length >= 10, `expected the full site, found ${pages.length} pages`);
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    assert.equal(html.split(BEACON).length - 1, 1, `${file} must load the beacon once`);
    assert.ok(html.indexOf(BEACON) < html.indexOf('</head>'), `${file} must load the beacon in <head>`);
  }
});
