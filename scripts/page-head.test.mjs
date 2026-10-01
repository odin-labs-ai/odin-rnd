import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkResults, measuredHead } from './jev-gate-results-site.mjs';
import { checkResults6, measuredHead6 } from './nina-changes-results-site.mjs';
import { readHead, replaceHead, SITE_SUFFIX } from './page-head.mjs';
import { builtCopy } from './test-build.mjs';

// A measured field note's <head> says what its results say (follow-up, founder 2026-10-02): its <title> and description
// come from the results data at build time; the body keeps the pre-registration as published. Without results the
// pre-registration's own head stays.

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const STALE = [/before any counted run/i, /before any gate runs?/i, /the pre-registration/i];
const pages = { exp005: 'journal/jev-as-a-fast-gate.html', exp006: 'journal/nina-reviews-the-change.html' };

test('each built field note\'s <head> matches its results state, from the results data', { timeout: 600_000 }, () => {
  const dist = join(builtCopy(), 'dist');
  const states = [[pages.exp005, checkResults(), measuredHead], [pages.exp006, checkResults6(), measuredHead6]];
  for (const [page, data, head] of states) {
    const got = readHead(readFileSync(join(dist, page), 'utf8'));
    if (!data) { assert.match(got.title, /the pre-registration/, `${page}: no results, the pre-registration's own title`); continue; }
    const want = head(data);
    assert.equal(got.title, `${escape(want.title)}${SITE_SUFFIX}`, page);
    assert.equal(got.description, escape(want.description), page);
    for (const re of STALE) { assert.doesNotMatch(got.title, re, `${page} title`); assert.doesNotMatch(got.description, re, `${page} description`); }
    assert.match(got.title, /measured/, page);
  }
});

test('the head wording is derived from the record: EXP 006 outcomes (in the spotlight, held, bar not met, manipulation failed, partial, rehearsal)', () => {
  const base = { prereg6: { experiment: { id: 'EXP 006', title: 'nina reviews the change', authoredOn: '2026-09-30' } }, amendment6: { record: { date: '2026-10-01' } }, measuredOn: '2026-10-01T10:00:00Z' };
  const r = (over = {}) => ({ partial: null, spotlight: { verdict: 'PASS' }, manipulation: { state: 'PASS', blind: 3, countedRuns: 180 }, spotlightEligible: true, ...over });
  const h = (results, shown) => measuredHead6({ ...base, results, gate: { shown } });
  assert.deepEqual(h(r(), true), { title: 'EXP 006: nina reviews the change, measured', description: 'Field notes from Odin R&D. EXP 006, nina reviews the change, measured 1 Oct 2026: the bar was met, the manipulation check passed (3 of 180 runs diff-blind), and nina is in the spotlight. Pre-registered 30 Sep 2026; amendment 01 1 Oct 2026.' });
  assert.match(h(r(), false).description, /passed \(3 of 180 runs diff-blind\), and the spotlight is held\./);
  assert.match(h(r({ spotlight: { verdict: 'FAIL' }, spotlightEligible: false }), false).description, /the bar was not met, .*, and there is no spotlight\./);
  assert.match(h(r({ manipulation: { state: 'FAIL', blind: 19, countedRuns: 180 }, spotlightEligible: false }), false).description, /the manipulation check failed \(19 of 180 runs diff-blind\)/);
  assert.match(h(r({ partial: [{ reason: 'spend-cap' }] }), false).description, /measured 1 Oct 2026: a partial run, which decides nothing\./);
  assert.match(h(r({ rehearsal: true }), false).title, /, rehearsed, not measured$/);
  for (const x of [h(r(), true), h(r(), false)]) for (const re of STALE) { assert.doesNotMatch(x.title, re); assert.doesNotMatch(x.description, re); }
});

test('the head wording is derived from the record: EXP 005 (claim refuted or holds; spotlight held, featured or bar not met)', () => {
  const data = (refuted, verdict, held) => ({ results: { claim: { refuted }, spotlight: { verdict } }, decision: held === null ? null : { held }, facts: { measuredOn: '2026-09-29' } });
  assert.match(measuredHead(data(true, 'PASS', true)).description, /measured 29 Sep 2026: the claim is refuted; nina's reviewer met the spotlight bar, and the spotlight is held\. Pre-registered 26 Sep 2026; amendment 01 28 Sep 2026, amendment 02 28 Sep 2026\.$/);
  assert.match(measuredHead(data(false, 'PASS', false)).description, /the claim holds; nina's reviewer met the spotlight bar, and the spotlight is featured\./);
  assert.match(measuredHead(data(true, 'FAIL', null)).description, /nina's reviewer did not meet the spotlight bar\./);
  assert.equal(measuredHead(data(true, 'PASS', true)).title, 'Jev as a fast gate: measured');
});

test('replaceHead changes only the head: the title, the description and any og:/twitter: tags, escaped; the body is untouched', () => {
  const page = '<!doctype html><html><head><title>Old — Odin R&amp;D</title><meta name="description" content="old"><meta property="og:title" content="old"><meta name="twitter:description" content="old"></head><body><p><title>not the head</title> body says before any gate runs</p></body></html>';
  const out = replaceHead(page, { title: 'New & "measured"', description: "it's <done>" });
  assert.deepEqual(readHead(out), { title: 'New &amp; &quot;measured&quot; — Odin R&amp;D', description: 'it&#39;s &lt;done&gt;' });
  assert(out.includes('<meta property="og:title" content="New &amp; &quot;measured&quot;">') && out.includes('<meta name="twitter:description" content="it&#39;s &lt;done&gt;">'));
  assert.equal(out.split('</head>')[1], page.split('</head>')[1], 'the body is byte-identical');
  assert.throws(() => replaceHead('<html><head></head><body></body></html>', { title: 'x', description: 'y' }), /exactly one <title>/);
});

test('without results the committed notes keep the pre-registration\'s head (the no-results path)', () => {
  for (const page of Object.values(pages)) assert.match(readHead(readFileSync(join('site', page), 'utf8')).title, /the pre-registration/, page);
});
