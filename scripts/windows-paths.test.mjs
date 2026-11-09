// Path separators on Windows. relative() and join() give '\' there, and a few repo-relative keys and URLs were compared
// against '/' literals: write-results6.mjs threw at import time (so the build died before it started), and the build's
// corrections lookup silently missed every dated clarification. These tests run on every OS; the windows-latest job
// in publish.yml is what makes the native-separator branch real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { clarifyPublication, corrections, publicationPage, unmatchedCorrections } from './publication-corrections.mjs';
import { PREFLIGHT_PATH, RESULTS_DIR } from '../experiments/nina-changes/write-results6.mjs';

const article = '<html><main><article class="article-body"><p>Original.</p></article></main></html>';

test('write-results6 imports on this OS and keeps its results directory POSIX', () => {
  assert.equal(RESULTS_DIR, 'experiments/nina-changes/results');
  assert.equal(PREFLIGHT_PATH, 'experiments/nina-changes/results/preflight.json');
});

test('a built page built from native path segments gets its POSIX corrections key', () => {
  for (const key of Object.keys(corrections)) {
    const file = join('dist', ...key.split('/'));
    if (sep === '\\') assert.ok(file.includes('\\'), 'on Windows the native path really has backslashes');
    assert.equal(publicationPage('dist', file), key);
    assert.match(clarifyPublication(article, publicationPage('dist', file)), /article-correction/);
  }
});

test('a page key with a backslash is refused instead of silently missing', () => {
  const key = Object.keys(corrections)[0].split('/').join('\\');
  assert.throws(() => clarifyPublication(article, key), /"\/" separators/);
});

test('every corrections key matches a page the build copies into dist (site/)', () => {
  const pages = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.html')) pages.push(publicationPage('site', path));
    }
  };
  walk('site');
  assert.ok(pages.length > 0);
  assert.ok(pages.every(page => !page.includes('\\')));
  assert.deepEqual(unmatchedCorrections(pages), []);
  assert.deepEqual(unmatchedCorrections([]), Object.keys(corrections), 'a missing page is reported');
});
