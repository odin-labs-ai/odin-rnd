import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { builtCopy } from './test-build.mjs';

// odin-labs.ai counts R&D page views (GitHub Pages has no analytics): the build adds this site's own beacon file to
// every page, once, in <head>. No page loads a script from another origin.
const walk = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);

test('every built page loads the self-hosted view beacon exactly once, inside <head>', () => {
  const dist = join(builtCopy(), 'dist');
  const beacon = resolve(dist, 'assets/view-beacon.js');
  assert.ok(existsSync(beacon), 'the beacon is published with the site');
  const pages = walk(dist).filter(file => file.endsWith('.html'));
  assert.ok(pages.length >= 10, `expected the full site, found ${pages.length} pages`);
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const tags = [...html.matchAll(/<script defer src="([^"]*view-beacon\.js)"><\/script>/g)];
    assert.equal(tags.length, 1, `${file} must load the beacon once`);
    assert.equal(resolve(dirname(file), tags[0][1]), beacon, `${file} must load this site's own beacon`);
    assert.ok(tags[0].index < html.indexOf('</head>'), `${file} must load the beacon in <head>`);
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//, `${file} must not load a script from another origin`);
  }
});

test('the beacon only reports this site, to the odin-labs.ai counter, and honours GPC and Do Not Track', () => {
  const source = readFileSync('site/assets/view-beacon.js', 'utf8');
  assert.match(source, /location\.origin !== 'https:\/\/odin-labs-ai\.github\.io'/);
  assert.match(source, /'https:\/\/odin-labs\.ai\/api\/rnd-hit\/'/);
  assert.match(source, /globalPrivacyControl === true \|\| navigator\.doNotTrack === '1'/);
  const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /cookie|localStorage|sessionStorage|indexedDB/i);
});
