import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkPages, loadTerms, namedMeasurements, refusal, staleEntries } from './provider-terms.mjs';

// Provider terms before naming (vp-grow-odin-r-d bundle-2 WO-05).
const terms = loadTerms();
const page = html => [{ file: 'fixture.html', html }];
const hash = createHash('sha256').update('x').digest('hex');

test('the record holds the five providers, each with a url, a dated read, a quote and the hash of the text read', () => {
  assert.deepEqual(Object.keys(terms.providers).sort(), ['doubleword', 'eurouter', 'openrouter', 'orq', 'requesty']);
  for (const [id, e] of Object.entries(terms.providers)) {
    assert.match(e.url, /^https:\/\//, id);
    assert.match(e.readOn, /^\d{4}-\d{2}-\d{2}$/, id);
    assert.ok(e.quote.length > 20, id);
    assert.ok(['allowed', 'consent-required', 'unknown'].includes(e.benchmarking), id);
    assert.notEqual(e.readBy, 'human', `${id}: no human has read these pages yet`);
    assert.match(e.textSha256, /^[0-9a-f]{64}$/, id);
  }
  assert.equal(terms.providers.doubleword.benchmarking, 'consent-required');
});

test('an allowed broker may be named next to a number', () => {
  assert.deepEqual(checkPages(page('<p>OpenRouter billed $0.04 per call.</p>'), terms), []);
});

test('Doubleword next to a number fails: its terms require written consent to benchmark', () => {
  const problems = checkPages(page('<table><tr><td>Doubleword</td><td>12.5%</td></tr></table>'), terms);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /doubleword.*consent-required/);
});

test('a broker with no record, or a record still waiting on review, fails', () => {
  const noRecord = { ...terms, providers: { ...terms.providers } };
  delete noRecord.providers.orq;
  assert.match(checkPages(page('<li>orq.ai: p95 410 ms</li>'), noRecord)[0], /no terms record/);
  assert.match(checkPages(page('<p>EUrouter charged 10% more.</p>'), terms)[0], /review/);
  assert.equal(refusal({ benchmarking: 'unknown' }), "benchmarking is 'unknown'");
});

test('an agent read counts only with the hash of the text it read; a summary never counts', () => {
  const base = { benchmarking: 'allowed', nameUse: 'plain-text', founderReview: { required: false } };
  assert.equal(refusal({ ...base, readBy: 'human' }), null);
  assert.equal(refusal({ ...base, readBy: 'agent-browser-verbatim', textSha256: hash }), null);
  assert.match(refusal({ ...base, readBy: 'agent-browser-verbatim' }), /sha256/);
  assert.match(refusal({ ...base, readBy: 'summariser', textSha256: hash }), /not an accepted read/);
});

test('a name without a measured number, or a number in another block, is not a named measurement', () => {
  assert.deepEqual(namedMeasurements('<p>We call models through Doubleword.</p><p>It took 300 ms.</p>'), []);
  assert.deepEqual(namedMeasurements('<p>Broker A: p50 210 ms, $0.01 per call.</p>'), []);
  assert.equal(namedMeasurements('<li>Requesty <strong>p95</strong> 900 ms</li>').length, 1);
});

test('a read older than 90 days warns', () => {
  assert.deepEqual(staleEntries(terms, '2026-11-01'), []);
  assert.deepEqual(staleEntries(terms, '2027-02-01').map(e => e.id).sort(), ['doubleword', 'eurouter', 'openrouter', 'orq', 'requesty']);
});
