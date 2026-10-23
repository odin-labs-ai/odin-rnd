import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { anonymise, anonymiseRow, errorClass } from '../experiments/broker-same-model/amendment-01/anonymise.mjs';
import { letteredRecord } from '../experiments/broker-same-model/amendment-01/analyse-anon.mjs';
import { analyse } from '../experiments/broker-same-model/analyse.mjs';

const dir = 'experiments/broker-same-model';
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const amendment = JSON.parse(readFileSync(`${dir}/amendment-01/amendment.json`, 'utf8'));
const prereg = JSON.parse(readFileSync(`${dir}/preregistration.json`, 'utf8'));
const letters = { openrouter: 'Q', eurouter: 'R', requesty: 'S' }; // a test assignment; the real one is private

test('EXP 016 amendment 01 is pinned and pins the frozen record and its own code', () => {
  assert.equal(readFileSync(`${dir}/amendment-01/amendment.sha256`, 'utf8').trim().split(/\s+/)[0], sha(`${dir}/amendment-01/amendment.json`));
  assert.equal(amendment.amends.preregistrationSha256, sha(`${dir}/preregistration.json`));
  assert.equal(amendment.amends.preregistrationSha256, readFileSync(`${dir}/preregistration.sha256`, 'utf8').trim().split(/\s+/)[0]);
  for (const c of amendment.changes) assert.equal(c.sha256, sha(c.file), c.file);
  assert.equal(prereg.analysis.sha256, sha(prereg.analysis.script), 'the frozen analysis is unchanged');
});

function named() {
  const rows = [{ _header: true, experiment: 'EXP 016', kind: 'counted', startedAt: '2026-10-23T08:00:44.007Z', command: 'node … --out /private/path', changes: 60, replicates: 2, arms: ['sonnet', 'mini'], brokers: prereg.brokers, capUsd: 3 }];
  let slot = 0;
  for (const rep of [1, 2]) for (let c = 1; c <= 60; c++) for (const arm of ['sonnet', 'mini']) {
    slot++;
    for (const broker of prereg.brokers) {
      const p = prereg.arms[arm].listPrice, pt = 300, ct = 150, list = (pt * p.inputPer1mUsd + ct * p.outputPer1mUsd) / 1e6;
      const fail503 = broker === 'eurouter' && arm === 'sonnet' && c === 5;
      const empty = broker === 'requesty' && arm === 'sonnet' && c === 9;
      rows.push({ ts: '2026-10-23T08:05:00.000Z', kind: 'counted', rep, slot, broker, arm, change: `c${String(c).padStart(3, '0')}`,
        requestedModel: prereg.arms[arm].ids[broker], latencyMs: 1000 + c, status: fail503 ? 503 : 200, ok: !(fail503 || empty),
        ...(fail503 ? { error: 'No upstream provider is currently available.' } : empty ? { error: '{"choices":[…]}' } : {}),
        servedModel: `vendor-x/${prereg.arms[arm].family}`, servedProvider: 'Vendor X', servedFamily: prereg.arms[arm].family, servedMatches: true,
        promptTokens: pt, completionTokens: empty ? 400 : ct, costUsd: fail503 ? null : list * (broker === 'eurouter' ? 1.1 : 1), costWhy: fail503 ? 'no-usage' : null,
        finishReason: empty ? 'length' : 'stop', answerChars: empty ? 0 : 300, answerSha256: 'f'.repeat(64), verdict: empty ? null : 'SHIP' });
    }
  }
  rows.push({ _trailer: true, endedAt: '2026-10-23T08:13:58.515Z', slots: slot, spentUsdCounted: 1.4, stopped: null });
  return rows;
}

test('the published rows keep every measured value and nothing that names a broker', () => {
  const text = named().map(r => JSON.stringify(r)).join('\n');
  const out = anonymise(text, letters);
  for (const word of ['openrouter', 'eurouter', 'requesty', 'Vendor X', 'vendor-x', 'upstream provider', '/private/path', 'anthropic/', 'openai/'])
    assert.ok(!out.includes(word), `published rows mention ${word}`);
  const rows = out.trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(rows[0].brokers, ['Q', 'R', 'S']);
  assert.equal(rows.length, 722);
  const r = anonymiseRow(named()[1], letters);
  assert.deepEqual(Object.keys(r).sort(), ['answerChars', 'answerSha256', 'arm', 'broker', 'change', 'completionTokens', 'costUsd', 'costWhy', 'finishReason', 'kind', 'latencyMs', 'ok', 'promptTokens', 'rep', 'servedFamily', 'servedMatches', 'slot', 'status', 'ts', 'verdict'].sort());
  assert.throws(() => anonymiseRow({ broker: 'other' }, letters), /no letter/);
  assert.throws(() => anonymiseRow({ broker: 'openrouter', arm: 'mini' }, letters), /without a slot/);
  assert.throws(() => errorClass({ status: 200 }), /boolean ok/);
  assert.throws(() => anonymise(JSON.stringify(named()[1]), letters), /one header/);
  for (const leak of ['{"openrouter": "A"}', "openrouter: 'B'", 'requesty=C', 'eurouter => "A"', 'EUrouter: Broker B'])
    assert.ok(/\b(open\s?router|eu\s?router|requesty)\b["']?\s*(:|=>?|->)\s*["'`]?(broker\s)?[A-Z]\b(?![a-z])/i.test(leak), leak);
});

test('error classes', () => {
  assert.equal(errorClass({ ok: true }), null);
  assert.equal(errorClass({ ok: false, status: 503 }), 'http-503');
  assert.equal(errorClass({ ok: false, status: 200 }), 'empty-answer');
  assert.equal(errorClass({ ok: false, status: null }), 'transport');
});

test('the frozen analysis gives the same numbers on the published rows as on the named rows, under the letters', () => {
  const namedRows = named();
  const anonRows = anonymise(namedRows.map(r => JSON.stringify(r)).join('\n'), letters).trim().split('\n').map(l => JSON.parse(l));
  const a = analyse(namedRows, prereg);
  const b = analyse(anonRows, letteredRecord(prereg, ['Q', 'R', 'S']));
  for (const arm of Object.keys(prereg.arms)) {
    assert.deepEqual(b.perArm[arm].rate, a.perArm[arm].rate);
    assert.deepEqual(b.perArm[arm].bill, a.perArm[arm].bill);
    assert.equal(b.perArm[arm].silentSubstitutions, a.perArm[arm].silentSubstitutions);
    for (const [broker, letter] of Object.entries(letters)) {
      const x = { ...a.perArm[arm].perBroker[broker] }, y = { ...b.perArm[arm].perBroker[letter] };
      // servedModels, servedProviders and mismatches list served ids, which name the broker's upstream; the published
      // rows drop them by design. Whether each call was served the requested model is still compared (servedMatch).
      assert.deepEqual([y.servedModels, y.servedProviders], [[], []]);
      assert.equal(y.mismatches.length, x.mismatches.length);
      for (const k of ['servedModels', 'servedProviders', 'mismatches']) { delete x[k]; delete y[k]; }
      assert.deepEqual(y, x, `${arm} ${broker}`);
    }
  }
  assert.equal(b.window.calls, a.window.calls);
});

test('no file in this public repository maps a broker to its EXP 016 letter (the assignment stays private)', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(f => f && !/\.(png|jpe?g|webp|woff2?|ico|gif|mp4|webm|tar\.gz)$/.test(f));
  // a broker id followed, within the same line, by := or => and a single capital letter in any quoting
  const mapping = /\b(open\s?router|eu\s?router|requesty)\b["']?\s*(:|=>?|->)\s*["'`]?(broker\s)?[A-Z]\b(?![a-z])/i;
  // Test files are left out: they hold fixtures (this file's test assignment Q/R/S, and the probe's own display-name
  // test, whose letters follow the probe's order and are unrelated to EXP 016). Every record, script and page is scanned.
  const hits = files.filter(f => !/^scripts\/[^/]+\.test\.mjs$/.test(f)).filter(f => { try { return mapping.test(readFileSync(f, 'utf8')); } catch { return false; } });
  assert.deepEqual(hits, [], 'a broker-to-letter mapping is published');
  const published = readFileSync(`${dir}/amendment-01/anonymise.mjs`, 'utf8');
  assert.ok(!mapping.test(published));
});
