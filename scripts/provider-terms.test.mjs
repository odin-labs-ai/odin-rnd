import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkPages, loadTerms, namedMeasurements, refusal, segments, staleEntries, validateTerms } from './provider-terms.mjs';
import { quotedPassages } from './provider-terms-capture.mjs';

// Provider terms before naming (vp-grow-odin-r-d bundle-2 WO-05).
const terms = loadTerms();
const page = html => [{ file: 'fixture.html', html }];
const hash = createHash('sha256').update('x').digest('hex');
const cleared = { benchmarking: 'allowed', nameUse: 'plain-text', logoUse: 'not-used', readBy: 'agent-browser-verbatim', textSha256: hash, founderReview: { required: false } };
/** A synthetic record, so these tests do not move when the lab owner clears or adds a review flag in the real one. */
const synthetic = providers => ({ ...terms, providers });

test('the record holds the five providers, each with a url, a dated read, a quote and the hash of the text read', () => {
  assert.deepEqual(validateTerms(terms), []);
  assert.deepEqual(Object.keys(terms.providers).sort(), ['doubleword', 'eurouter', 'openrouter', 'orq', 'requesty']);
  for (const [id, e] of Object.entries(terms.providers)) {
    assert.match(e.url, /^https:\/\//, id);
    assert.notEqual(e.readBy, 'human', `${id}: no human has read these pages yet`);
    assert.match(e.textSha256, /^[0-9a-f]{64}$/, id);
    assert.ok(quotedPassages(e.quote).length >= 1, `${id}: the quote carries at least one verbatim passage`);
  }
  assert.equal(terms.providers.doubleword.benchmarking, 'consent-required');
});

test('an allowed broker may be named next to a number', () => {
  assert.deepEqual(checkPages(page('<p>OpenRouter billed $0.04 per call.</p>'), synthetic({ openrouter: cleared })), []);
});

test('Doubleword next to a number fails: its terms require written consent to benchmark', () => {
  const problems = checkPages(page('<table><tr><td>Doubleword</td><td>12.5%</td></tr></table>'), terms);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /doubleword.*consent-required/);
});

test('a broker with no record, or a record waiting on review, fails', () => {
  assert.match(checkPages(page('<li>orq.ai: p95 410 ms</li>'), synthetic({}))[0], /no terms record/);
  const waiting = synthetic({ eurouter: { ...cleared, founderReview: { required: true, reason: 'trade names' } } });
  assert.match(checkPages(page('<p>EUrouter charged 10% more.</p>'), waiting)[0], /review \(trade names\)/);
  assert.match(refusal({ ...cleared, founderReview: undefined }), /review/);
  assert.equal(refusal({ benchmarking: 'unknown' }), "benchmarking is 'unknown'");
});

test('name use is an allowlist: a typo or an unknown value is refused, and the loader rejects it', () => {
  assert.match(refusal({ ...cleared, nameUse: 'consent_required' }), /name use/);
  assert.match(refusal({ ...cleared, nameUse: 'prohibited' }), /name use/);
  const typo = synthetic({ ...terms.providers, orq: { ...terms.providers.orq, nameUse: 'consent_required' } });
  assert.match(validateTerms(typo).join('\n'), /orq: nameUse 'consent_required' is not one of/);
});

test('an agent read counts only with the hash of the text it read; a summary never counts', () => {
  assert.equal(refusal({ ...cleared, readBy: 'human', textSha256: undefined }), null);
  assert.equal(refusal(cleared), null);
  assert.match(refusal({ ...cleared, textSha256: undefined }), /sha256/);
  assert.match(refusal({ ...cleared, readBy: 'summariser' }), /not an accepted read/);
});

test('names in a div, a bare text node or a table row are caught; inline tags do not split a segment', () => {
  const blocked = synthetic({ doubleword: { ...cleared, benchmarking: 'consent-required' } });
  for (const html of ['<div>Doubleword: 12.5% cheaper</div>', '<section>Doubleword was 2x faster at 1.9 s</section>', '<main>Doubleword <span>USD 3</span></main>',
    'Doubleword served 40 tok/s', '<tr><th>Doubleword</th><td>£1.20</td></tr>', '<li>Doubleword <strong>p95</strong> 900 ms</li>']) {
    assert.equal(checkPages(page(html), blocked).length, 1, html);
  }
  assert.deepEqual(segments('<p>a <em>b</em></p><div>c</div>'), ['a b', 'c']);
});

test('a name without a measured number, a number in another segment, or an anonymised broker is not a named measurement', () => {
  assert.deepEqual(namedMeasurements('<p>We call models through Doubleword.</p><p>It took 300 ms.</p>'), []);
  assert.deepEqual(namedMeasurements('<p>Broker A: p50 210 ms, $0.01 per call.</p>'), []);
  assert.deepEqual(namedMeasurements('<script>const doubleword = "5%";</script><p>none</p>'), []);
});

test('a read older than 90 days, or with no parseable date, warns', () => {
  assert.deepEqual(staleEntries(terms, '2026-11-01'), []);
  assert.deepEqual(staleEntries(terms, '2027-02-01').map(e => e.id).sort(), ['doubleword', 'eurouter', 'openrouter', 'orq', 'requesty']);
  assert.deepEqual(staleEntries(synthetic({ x: { readOn: 'soon' } }), '2026-11-01').map(e => e.id), ['x']);
});

test('the current site names no broker next to a number without leave', () => {
  const pages = ['site/index.html', 'site/methods/index.html', 'site/journal/where-a-model-reviewer-earns-its-keep.html'].map(file => ({ file, html: readFileSync(file, 'utf8') }));
  assert.deepEqual(checkPages(pages, terms), []);
});

test('the site build runs the check over every finished page, last', () => {
  const build = readFileSync('scripts/build.mjs', 'utf8');
  const at = build.indexOf("await import('./provider-terms.mjs')");
  assert.ok(at > 0, 'scripts/build.mjs imports the check');
  assert.ok(at > build.lastIndexOf("writeFileSync(file,source.replace(/(<header"), 'after the last page rewrite');
  assert.match(build.slice(at), /checkPages\(htmlFiles\('dist'\)/);
});
