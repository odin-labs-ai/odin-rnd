import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { routeKey, readConfig, bindActivity } from '../site/assets/activity.mjs';

const walk = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);

function moduleGraphForPage(htmlPath) {
  const visited = new Set();
  const visit = (modulePath, source) => {
    const absolute = resolve(modulePath);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    for (const [, fromSpecifier, sideEffectSpecifier] of source.matchAll(/\bfrom\s*['"]([^'"]+\.m?js)['"]|\bimport\s*['"]([^'"]+\.m?js)['"]/g)) {
      const dependency = fromSpecifier || sideEffectSpecifier;
      if (!dependency.startsWith('.')) continue;
      const target = resolve(dirname(absolute), dependency);
      visit(target, readFileSync(target, 'utf8'));
    }
  };
  const html = readFileSync(htmlPath, 'utf8');
  for (const [, source] of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) {
    const entry = resolve(dirname(htmlPath), source);
    visit(entry, readFileSync(entry, 'utf8'));
  }
  return visited;
}

test('every canonical public page reaches the shared activity collector exactly once', () => {
  const canonicalPages = walk('site').filter(file => file.endsWith('.html')).flatMap(file => {
    const html = readFileSync(file, 'utf8');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (!canonical) return [];
    const route = routeKey(new URL(canonical).pathname);
    return route ? [{ file, route }] : [];
  });
  assert.deepEqual(canonicalPages.map(page => page.route).sort(), [
    'ci-witness', 'home', 'journal-a-passing-pipeline', 'journal-why-open-the-floor',
    'migration-witness', 'test-witness', 'work-with-us',
  ]);
  for (const { file, route } of canonicalPages) {
    const graph = moduleGraphForPage(file);
    assert(graph.has(resolve('site/assets/activity.mjs')), `${route} does not load activity.mjs`);
    // The browser's ES module map evaluates a resolved module URL once even if
    // both a page entrypoint and another module import it.
    assert.equal([...graph].filter(path => path === resolve('site/assets/activity.mjs')).length, 1, route);
  }
});

test('disabled site config sends no activity event on canonical routes', async () => {
  const config = await readConfig(async () => ({ ok: true, json: async () => ({ apiOrigin: null }) }));
  const calls = [];
  const browser = { location: { pathname: '/odin-rnd/' }, fetch: async (...args) => { calls.push(args); return { ok: true }; } };
  const listeners = [];
  bindActivity({ addEventListener: name => listeners.push(name) }, browser, config);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, []);
  assert.deepEqual(listeners, []);
});
