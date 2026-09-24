import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { routeKey } from '../site/assets/activity.mjs';

const walk = directory => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const activity = resolve('dist/assets/activity.mjs');
let built = false;

function builtPages() {
  if (!built) {
    execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'pipe' });
    built = true;
  }
  return walk('dist').filter(file => file.endsWith('.html')).flatMap(file => {
    const html = readFileSync(file, 'utf8');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (!canonical) return [];
    const pathname = new URL(canonical).pathname;
    const route = routeKey(pathname);
    return route ? [{ file, route, pathname, html }] : [];
  });
}

function moduleEntries(page) {
  return [...page.html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)]
    .map(([, source]) => resolve(dirname(page.file), source));
}

function moduleClosure(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const source = readFileSync(entry, 'utf8');
  for (const [, fromSpecifier, sideEffectSpecifier] of source.matchAll(
    /\bfrom\s*['"]([^'"]+\.m?js)['"]|\bimport\s*['"]([^'"]+\.m?js)['"]/g)) {
    const dependency = fromSpecifier || sideEffectSpecifier;
    if (dependency.startsWith('.')) moduleClosure(resolve(dirname(entry), dependency), visited);
  }
  return visited;
}

// Each invocation is a fresh browser-like module registry. Importing the
// contact page's intake module first exercises its static activity import;
// importing the build-injected activity entry then uses that same ESM instance.
const loader = `
const { entries, pathname, origin } = JSON.parse(process.argv[1]);
const events = [], listeners = {};
globalThis.document = {
  addEventListener(name) { listeners[name] = (listeners[name] || 0) + 1; },
  getElementById() { return null; },
};
globalThis.window = {
  location: { pathname },
  fetch: async (url, options) => { events.push([url, JSON.parse(options.body)]); return { ok: true }; },
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({ apiOrigin: origin }) });
for (const entry of entries) await import(entry);
await new Promise(resolve => setImmediate(resolve));
process.stdout.write(JSON.stringify({ events, listeners }));
`;

function loadCollectorEntries(page, entries, origin) {
  const urls = entries.map(entry => pathToFileURL(entry).href);
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', loader,
    JSON.stringify({ entries: urls, pathname: page.pathname, origin })], { encoding: 'utf8' }));
}

test('every built canonical route loads one collector module and initializes it once', () => {
  const pages = builtPages();
  assert.deepEqual(pages.map(page => page.route).sort(), [
    'ci-witness', 'home', 'journal-a-passing-pipeline', 'journal-why-open-the-floor',
    'migration-witness', 'test-witness', 'work-with-us',
  ]);
  assert.deepEqual(JSON.parse(readFileSync('dist/data/intake-config.json', 'utf8')), { apiOrigin: null });
  for (const page of pages) {
    const entries = moduleEntries(page);
    assert.equal(entries.filter(entry => entry === activity).length, 1,
      `${page.route} must have one build-injected collector entry`);
    const collectorEntries = entries.filter(entry => moduleClosure(entry).has(activity));
    assert(collectorEntries.length >= 1, `${page.route} does not resolve the collector module`);
    if (page.route === 'work-with-us') {
      assert(collectorEntries.some(entry => entry.endsWith('/assets/intake.mjs')),
        'contact module must retain its static collector import');
      assert.equal(collectorEntries.length, 2, 'contact static import and direct entry should share one ESM instance');
    }
    const result = loadCollectorEntries(page, collectorEntries, 'https://intake.example.invalid');
    assert.deepEqual(result.events, [[
      'https://intake.example.invalid/v1/rd/events', { event: 'page_view', route: page.route },
    ]], page.route);
    assert.deepEqual(result.listeners, {
      click: 1, keydown: 1, change: 1, 'rd-reproduction-copied': 1,
    }, page.route);
  }
});

test('built routes remain inactive with the published null API origin', () => {
  for (const page of builtPages()) {
    const collectorEntries = moduleEntries(page).filter(entry => moduleClosure(entry).has(activity));
    const result = loadCollectorEntries(page, collectorEntries, null);
    assert.deepEqual(result, { events: [], listeners: {} }, page.route);
  }
});
