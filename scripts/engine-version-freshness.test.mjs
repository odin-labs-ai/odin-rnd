// Offline checks for scripts/engine-version-freshness.mjs: a card that lags the activated engine fails naming the file,
// the version found and the version expected; a matching card passes; a mid-release engine passes with a notice; the
// historical 0.3.1 mentions are never read. No network: the pin and npm answers below are recorded shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { card001, freshnessProblems, NPM_LATEST_URL, PIN_URL, PLACES, readPlaces, run } from './engine-version-freshness.mjs';

const card = v => `<article class="project-row project-featured"><div class="project-number">001<span>ENGINE</span></div><div class="project-description"><h3><a href="https://github.com/blueprint-conformance/bce">Blueprint Conformance Engine</a></h3><div class="project-links"><a href="https://blueprint-conformance.github.io/bce/">Documentation</a><a href="https://github.com/blueprint-conformance/bce/releases/tag/v${v}">Release & evidence</a></div></div><dl class="project-spec"><div><dt>Release</dt><dd>v${v}</dd></div><div><dt>Source</dt><dd>Released tag</dd></div></dl></article>`;
// Card 004 carries a dated, deliberate pin (the experiment's ground truth) that must never be judged.
const historical = '<article class="project-row"><div class="project-number">004<span>TRIAGE</span></div><dl class="project-spec"><div><dt>Ground truth</dt><dd>bce-engine 0.3.1</dd></div><div><dt>Release</dt><dd>v0.3.1</dd></div><a href="https://github.com/blueprint-conformance/bce/releases/tag/v0.3.1">then</a></dl></article>';
const page = v => `<main>${card(v)}${historical}</main>`;

function fakeFetch({ pin, latest }) {
  return async url => {
    if (url === PIN_URL) return { ok: true, status: 200, json: async () => ({ package: 'bce-engine', pin }) };
    if (url === NPM_LATEST_URL) return { ok: true, status: 200, json: async () => ({ name: 'bce-engine', version: latest }) };
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function check(html, versions) {
  const root = mkdtempSync(join(tmpdir(), 'engine-version-freshness-'));
  try {
    mkdirSync(join(root, 'site'));
    writeFileSync(join(root, 'site', 'index.html'), html);
    const out = [], err = [];
    const code = await run({ root, fetchImpl: fakeFetch(versions), out: s => out.push(s), err: s => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a card that lags the activated engine fails, naming the file, the version found and the version expected', async () => {
  const r = await check(page('0.6.2'), { pin: '0.6.3', latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /::error file=site\/index\.html,.*card 001 "Release & evidence" link: found 0\.6\.2, expected 0\.6\.3/);
  assert.match(r.err, /card 001 Release field: found 0\.6\.2, expected 0\.6\.3/);
});

test('a card that matches the activated engine passes, and the historical 0.3.1 card is not judged', async () => {
  const r = await check(page('0.6.3'), { pin: '0.6.3', latest: '0.6.3' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.match(r.out, /every place states 0\.6\.3/);
});

test('one lagging place out of two is enough to fail', async () => {
  const r = await check(page('0.6.3').replace('<dd>v0.6.3</dd>', '<dd>v0.6.2</dd>'), { pin: '0.6.3', latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /Release field: found 0\.6\.2/);
  assert.doesNotMatch(r.err, /link: found/);
});

test('mid-release (npm latest differs from the pin) passes with a notice when the card states either answer', async () => {
  for (const v of ['0.6.3', '0.6.4']) {
    const r = await check(page(v), { pin: '0.6.4', latest: '0.6.3' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /::notice .*mid-release: main pins 0\.6\.4, npm latest is 0\.6\.3/);
  }
});

test('mid-release never hides a card that lags both the pin and npm latest', async () => {
  const r = await check(page('0.6.2'), { pin: '0.6.4', latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /link: found 0\.6\.2, expected 0\.6\.4 or 0\.6\.3/);
});

test('mid-release never hides a card the check can no longer find', async () => {
  const r = await check(`<main>${historical}</main>`, { pin: '0.6.4', latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /no bce-engine version found/);
});

test('a release link whose tag only starts with the version is not read as that version', async () => {
  const html = page('0.6.3').replace('releases/tag/v0.6.3"', 'releases/tag/v0.6.3+stale"');
  const r = await check(html, { pin: '0.6.3', latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /"Release & evidence" link: no bce-engine version found/);
});

test('a card the check can no longer find fails instead of passing on nothing', async () => {
  const r = await check(`<main>${historical}</main>`, { pin: '0.6.3', latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /no bce-engine version found/);
  assert.equal(freshnessProblems([{ file: 'f', where: 'w', versions: [] }], '1.0.0').length, 1);
});

test('an answer that is not a version fails', async () => {
  const r = await check(page('0.6.3'), { pin: undefined, latest: '0.6.3' });
  assert.equal(r.code, 1);
  assert.match(r.err, /pin is undefined, not a version/);
});

test('the real home page states exactly one engine version at each place, and it is the same at both', () => {
  const found = readPlaces(file => readFileSync(file, 'utf8'));
  assert.equal(found.length, PLACES.length);
  for (const { where, versions } of found) assert.equal(versions.length, 1, `${where}: ${versions}`);
  assert.equal(new Set(found.flatMap(f => f.versions)).size, 1, JSON.stringify(found));
  assert.ok(card001(readFileSync('site/index.html', 'utf8')).includes('ENGINE'));
});
