import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogueDiff, displayNames, isoWeek, normaliseCatalogue, PAGE, PROBE, probe, readTerms, renderPage, summarise, weeks } from './broker-probe.mjs';

// No network: every broker answer below is a recorded shape (vp-grow-odin-r-d bundle-2 WO-04).
const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
function fakeFetch({ swapOn = null, fail5xxOn = null } = {}) {
  let n = 0;
  return async (url, init) => {
    if (url.endsWith('/models')) {
      if (url.includes('openrouter')) return reply(200, { data: [{ id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005' } }, { id: 'openai/gpt-4o-mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } }, { id: 'new/model', pricing: { prompt: '0', completion: '0' } }] });
      if (url.includes('eurouter')) return reply(200, { data: [{ id: 'claude-haiku-4.5', pricing: { prompt: '0.0000011', completion: '0.0000055', currency: 'EUR' } }] });
      return reply(200, { data: [{ id: 'anthropic/claude-haiku-4-5', input_price: 1e-6, output_price: 5e-6 }, { id: 'openai/gpt-4o-mini', input_price: 1.5e-7, output_price: 6e-7 }] });
    }
    n++;
    const body = JSON.parse(init.body);
    if (fail5xxOn === n) return reply(503, { error: { message: 'upstream' } });
    const served = swapOn === n ? 'anthropic/claude-3-haiku' : body.model.includes('haiku') ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini-2024-07-18';
    return reply(200, { model: served, choices: [{ message: { content: 'pong' } }], usage: { cost: 0.00004 } });
  };
}

test('the probe records every keyed broker, marks an unkeyed one, and finds a 5xx and a model swap', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'broker-probe-test-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, 'catalogue'));
  writeFileSync(join(dataDir, 'catalogue', 'openrouter.json'), JSON.stringify({ models: { 'anthropic/claude-haiku-4.5': { in: 1, out: 5, currency: 'USD' }, 'openai/gpt-4o-mini': { in: 0.1, out: 0.6, currency: 'USD' }, 'gone/model': { in: 1, out: 1, currency: 'USD' } } }));
  const env = { BROKER_PROBE_OPENROUTER_KEY: 'k1', BROKER_PROBE_REQUESTY_KEY: 'k2' };
  const r = await probe({ week: '2026-W43', env, fetchImpl: fakeFetch({ swapOn: 3, fail5xxOn: 5 }), dataDir, now: () => '2026-10-23T00:00:00Z' });
  assert.deepEqual(r.brokers.eurouter, { keyed: false });
  const haiku = r.brokers.openrouter.models['claude-haiku-4-5'];
  assert.equal(haiku.attempted, PROBE.callsPerModel);
  assert.equal(haiku.status5xx, 1);
  assert.equal(haiku.servedMismatch, 1);
  assert.equal(haiku.ok, PROBE.callsPerModel - 1);
  assert.deepEqual(r.brokers.openrouter.catalogue.diff.addedIds, ['new/model']);
  assert.deepEqual(r.brokers.openrouter.catalogue.diff.removedIds, ['gone/model']);
  assert.deepEqual(r.brokers.openrouter.catalogue.diff.repricedIds, ['openai/gpt-4o-mini']);
  assert.equal(r.brokers.requesty.catalogue.diff, null, 'a first snapshot has no diff');
  assert.equal(r.catalogueAgreement['claude-haiku-4-5'].agree, true);
  const snap = JSON.parse(readFileSync(join(dataDir, 'catalogue', 'requesty.json'), 'utf8'));
  assert.equal(snap.models['openai/gpt-4o-mini'].in, 0.15);
  assert.ok(!JSON.stringify(r).includes('k1') && !JSON.stringify(r).includes('k2'), 'no key value in the record');
});

test('catalogue normalisation handles both catalogue shapes and keeps the currency', () => {
  const eu = normaliseCatalogue({ data: [{ id: 'x', pricing: { prompt: '0.000002', completion: '0.00001', currency: 'EUR' } }] });
  assert.deepEqual(eu.x, { in: 2, out: 10, currency: 'EUR' });
  const rq = normaliseCatalogue({ data: [{ id: 'y', input_price: 2e-6, output_price: 1e-5, pricing: [{ prompt_tokens_threshold: 0, input_price: 2e-6 }] }] });
  assert.deepEqual(rq.y, { in: 2, out: 10, currency: 'USD' });
  assert.equal(catalogueDiff(null, rq), null);
});

test('summaries never invent a cost', () => {
  const s = summarise([{ ok: true, latencyMs: 10, costUsd: null, servedMatches: true }, { ok: false, status: 429 }]);
  assert.equal(s.costReported, 0);
  assert.equal(s.otherErrors, 1);
  assert.equal(s.status5xx, 0);
});

test('a broker is named only when the terms record allows it; otherwise it gets a letter', () => {
  const brokers = ['openrouter', 'eurouter', 'requesty'];
  assert.deepEqual(displayNames(brokers, null), { openrouter: 'Broker A', eurouter: 'Broker B', requesty: 'Broker C' });
  const terms = { providers: { openrouter: { benchmarking: 'allowed', nameUse: 'allowed', displayName: 'OpenRouter' }, eurouter: { benchmarking: 'unknown', displayName: 'EUrouter' } } };
  assert.deepEqual(displayNames(brokers, terms), { openrouter: 'OpenRouter', eurouter: 'Broker B', requesty: 'Broker C' });
});

test('ISO weeks', () => {
  assert.equal(isoWeek(new Date('2026-10-23T12:00:00Z')), '2026-W43');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
});

test('the committed probe page is exactly what the committed data renders', () => {
  assert.equal(readFileSync(PAGE, 'utf8'), renderPage(weeks(), readTerms()), 'run: node scripts/broker-probe.mjs page --write');
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/probe\/<\/loc>/);
});

test('the workflow never runs on a pull request and keeps the broker keys out of the write job', () => {
  const wf = readFileSync('.github/workflows/broker-probe.yml', 'utf8');
  const on = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'));
  assert.ok(!/pull_request/.test(on), 'no pull_request trigger');
  assert.match(on, /schedule:/);
  assert.match(on, /workflow_dispatch:/);
  const publish = wf.slice(wf.indexOf('\n  publish:'));
  assert.ok(!/BROKER_PROBE_/.test(publish), 'the publish job holds no broker key');
  assert.ok(!/git push origin main|--base main --head main/.test(wf), 'nothing is pushed to main');
});
