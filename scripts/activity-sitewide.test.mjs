import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { routeKey, readConfig, bindActivity } from '../site/assets/activity.mjs';

const walk = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);

function canonicalPages() {
  return walk('site').filter(file => file.endsWith('.html')).flatMap(file => {
    const html = readFileSync(file, 'utf8');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (!canonical) return [];
    const route = routeKey(new URL(canonical).pathname);
    return route ? [{ file, route, pathname: new URL(canonical).pathname }] : [];
  });
}

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

test('each canonical public page loads one collector and emits one page event', async () => {
  const pages = canonicalPages();
  assert.deepEqual(pages.map(page => page.route).sort(), [
    'ci-witness', 'home', 'journal-a-passing-pipeline', 'journal-why-open-the-floor',
    'migration-witness', 'test-witness', 'work-with-us',
  ]);
  for (const { file, route, pathname } of pages) {
    const graph = moduleGraphForPage(file);
    assert(graph.has(resolve('site/assets/activity.mjs')), `${route} does not load activity.mjs`);
    const calls = [], registrations = new Map();
    const doc = { addEventListener: name => registrations.set(name, (registrations.get(name) || 0) + 1) };
    const browser = { location: { pathname }, fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; } };
    bindActivity(doc, browser, 'https://intake.example.invalid');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.map(({ url, options }) => [url, JSON.parse(options.body)]), [[
      'https://intake.example.invalid/v1/rd/events', { event: 'page_view', route },
    ]], route);
    assert.deepEqual(Object.fromEntries(registrations), {
      click: 1, keydown: 1, change: 1, 'rd-reproduction-copied': 1,
    }, route);
  }
});

test('disabled site config sends no activity event on every canonical route', async () => {
  const config = await readConfig(async () => ({ ok: true, json: async () => ({ apiOrigin: null }) }));
  for (const { route, pathname } of canonicalPages()) {
    const calls = [], listeners = [];
    const browser = { location: { pathname }, fetch: async (...args) => { calls.push(args); return { ok: true }; } };
    bindActivity({ addEventListener: name => listeners.push(name) }, browser, config);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [], route);
    assert.deepEqual(listeners, [], route);
  }
});
