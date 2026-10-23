import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSERTS, fillClaim, frontierBlock, num, renderEvidence, renderLabPages, renderProviderEconomics, siteReader, statesNumber } from './lab-pages.mjs';
import { checkPage, recordProblem } from './number-provenance.mjs';
import { createHash } from 'node:crypto';
import { checkPages, loadTerms } from './provider-terms.mjs';

// The provider-economics and evidence pages (vp-grow-odin-r-d bundle-3 WO-01, WO-03). `pnpm test` runs before
// `pnpm build`, so these render in memory from site/ (and from fixtures) and never read dist/. dist/data/ is a copy
// of site/data/, so the provenance check reads the records from site/ here.

const rendered = renderLabPages();
const readSite = path => (existsSync(join('site', path)) ? readFileSync(join('site', path), 'utf8') : null);

test('every lab page renders from the committed records and passes the number-provenance check', () => {
  const minimumSourced = { 'provider-economics': 10, evidence: 10, providers: 0 };
  assert.deepEqual(Object.keys(rendered).sort(), Object.keys(minimumSourced).sort());
  for (const [page, html] of Object.entries(rendered)) {
    assert.deepEqual(checkPage(`${page}/index.html`, html, { readData: readSite, recordProblem: (path, raw) => recordProblem(path, raw) }), [], page);
    const sourced = (html.match(/data-source="/g) ?? []).length;
    if (minimumSourced[page] === 0) assert.equal(sourced, 0, `${page} shows no number`); else assert.ok(sourced >= minimumSourced[page], `${page} shows sourced numbers`);
  }
});

test('no broker is named next to a number without leave in provider-terms.json', () => {
  const problems = checkPages(Object.entries(rendered).map(([page, html]) => ({ file: page, html })), loadTerms());
  assert.deepEqual(problems, []);
});

test('the pages carry no third-party image or logo', () => {
  for (const [page, html] of Object.entries(rendered)) {
    const imgs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(imgs.filter(src => src !== '../assets/odin-logo.svg'), [], page);
    assert.doesNotMatch(html, /double\s?word/i, `${page} names no lead without a record`);
    // Brokers whose terms are under review appear only by letter; orq has no record on these pages at all.
    assert.doesNotMatch(html, /eu\s?router|requesty|\borq\b/i, `${page} names no broker without leave`);
  }
});

test('the evidence page lists what is not measured yet: at least routing savings, negotiated prices and partnerships', () => {
  const notMeasured = rendered.evidence.slice(rendered.evidence.indexOf('id="not-measured"'));
  for (const phrase of ["routing saves money against a fixed-model baseline", 'negotiated better prices', 'provider partnerships', "cost estimates match what the brokers bill"]) assert.ok(notMeasured.includes(phrase), phrase);
});

test('the pages are in the sitemap and linked from the home page, the methods page or provider economics', () => {
  const sitemap = readFileSync('site/sitemap.xml', 'utf8');
  for (const page of ['provider-economics', 'evidence', 'providers']) {
    assert.match(sitemap, new RegExp(`<loc>https://odin-labs-ai\\.github\\.io/odin-rnd/${page}/</loc>`), page);
    if (page === 'providers') { assert.match(rendered['provider-economics'], /href="\.\.\/providers\/"/, 'provider economics links the providers page'); continue; }
    assert.match(readFileSync('site/index.html', 'utf8'), new RegExp(`href="${page}/"`), `home links ${page}`);
    assert.match(readFileSync('site/methods/index.html', 'utf8'), new RegExp(`href="\\.\\./${page}/"`), `methods links ${page}`);
  }
});

// A fixture site: experiment alpha has results, beta has only a pre-registration, and the probe has one week.
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
function fixture({ betaResults = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'lab-pages-'));
  made.push(repo);
  const root = join(repo, 'site');
  const put = (path, value, base = root) => { mkdirSync(join(base, path, '..'), { recursive: true }); writeFileSync(join(base, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  // A frozen pre-registration: published under data/ and committed under experiments/ with its sha256 (quoteProblem).
  const frozen = (slug, record) => {
    const prereg = JSON.stringify(record);
    put(`data/${slug}/preregistration.json`, prereg);
    put(`experiments/${slug}/preregistration.json`, prereg, repo);
    put(`experiments/${slug}/preregistration.sha256`, createHash('sha256').update(prereg).digest('hex') + '  preregistration.json\n', repo);
  };
  // A measured experiment record is bound to its experiment folder and frozen pre-registration (recordProblem).
  frozen('alpha', { experiment: { id: 'EXP 901', title: 'Alpha question?' } });
  const results = JSON.stringify({ kind: 'odin-rnd.results', slug: 'alpha', preregistration: 'experiments/alpha/preregistration.json', n: 7 });
  put('data/alpha/results.json', results);
  put('experiments/alpha/results.json', results, repo);
  put('data/stray/results.json', { kind: 'odin-rnd.results', slug: 'stray', savings: 0.4 });
  frozen('beta', { experiment: { id: 'EXP 902', title: 'Beta question?' }, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z' } });
  if (betaResults) put('data/beta/results.json', { n: 3 });
  put('data/provider-terms.json', JSON.parse(readFileSync('site/data/provider-terms.json', 'utf8')));
  put('data/broker-probe/2026-W43.json', JSON.parse(readFileSync('site/data/broker-probe/2026-W43.json', 'utf8')));
  put('data/provider-economics.json', { series: [{ slug: 'alpha' }, { slug: 'beta' }, { slug: null, title: 'Gamma question?', status: 'Not pre-registered yet.' }] });
  return { root, read: siteReader(root), frozen };
}

// Titles are quoted from the frozen pre-registration as <cite data-quote=…>; these assertions read the plain text.
const plain = html => html.replace(/<cite data-quote="[^"]*">([^<]*)<\/cite>/g, '$1');

test('an experiment with results is published; one without is listed as not yet published, with its window', () => {
  const { read } = fixture();
  const html = renderProviderEconomics(read, ['2026-W43']);
  assert.match(html, /<cite data-quote="data\/alpha\/preregistration\.json#\/experiment\/title">Alpha question\?<\/cite>/);
  const [published, pending] = plain(html).split('id="not-yet"');
  assert.match(published, /EXP 901: Alpha question\?/);
  assert.match(published, /href="\.\.\/data\/alpha\/results\.json"/);
  assert.doesNotMatch(published, /EXP 902/);
  assert.match(pending, /EXP 902: Beta question\?<\/strong> <a href="\.\.\/data\/beta\/preregistration\.json">Pre-registered<\/a>; no result is published yet\./);
  assert.match(pending, /<time datetime="2026-11-01T00:00:00Z">2026-11-01<\/time> to <time datetime="2026-11-08T00:00:00Z">2026-11-08<\/time>/);
  assert.match(pending, /Gamma question\?/);
  assert.doesNotMatch(pending, /EXP 901/);
  // The not-yet list is exactly the series entries without a results record.
  assert.equal((pending.match(/<li>/g) ?? []).length, 2);
});

test('a planned experiment shows its fallback until its pre-registration is published, then becomes a normal entry', () => {
  const { read, root, frozen } = fixture();
  const config = { series: [{ slug: 'gamma', unregistered: { title: 'Gamma question?', status: 'Not pre-registered yet.' } }] };
  const withConfig = r => Object.assign(path => (path === 'data/provider-economics.json' ? config : r(path)), r);
  assert.match(renderProviderEconomics(withConfig(read), ['2026-W43']), /Gamma question\?<\/strong> Not pre-registered yet\./);
  frozen('gamma', { experiment: { id: 'EXP 903', title: 'Gamma, frozen?' } });
  const html = plain(renderProviderEconomics(withConfig(siteReader(root)), ['2026-W43']));
  assert.match(html, /EXP 903: Gamma, frozen\?<\/strong> <a href="\.\.\/data\/gamma\/preregistration\.json">Pre-registered<\/a>/);
  assert.doesNotMatch(html, /Not pre-registered yet/);
});

test('on /evidence/ the router-arm item drops its "not pre-registered" fallback once the pre-registration exists', () => {
  // EXP 018's pre-registration is on main (#60); "before" hides it, "after" is the committed site.
  const site = siteReader();
  const without = Object.assign(path => (path === 'data/router-arm/preregistration.json' ? null : site(path)), site);
  const before = renderEvidence(without), after = plain(renderEvidence(site));
  assert.match(before, /Not pre-registered yet\./);
  assert.doesNotMatch(after, /Not pre-registered yet/);
  assert.doesNotMatch(after, /assumes its baseline/);
  // Once EXP 018's results are committed the item links the results record instead.
  assert.match(after, /EXP 018, “Does routing by our own rulebook beat one fixed model on real tasks\?”: (<a href="\.\.\/data\/router-arm\/preregistration\.json">Pre-registered<\/a>; no result is published yet\.|Results are published: <a href="\.\.\/data\/router-arm\/results\.json">the record<\/a>\.)/);
});

test('when a pre-registered experiment gains results, it moves to the published block without a page edit', () => {
  const { read } = fixture({ betaResults: true });
  const [published, pending] = plain(renderProviderEconomics(read, ['2026-W43'])).split('id="not-yet"');
  assert.match(published, /EXP 902: Beta question\?/);
  assert.match(published, /href="\.\.\/data\/beta\/results\.json"/);
  assert.doesNotMatch(pending, /EXP 902/);
});

test('a number may only come from an experiment record, never from page configuration', () => {
  const { read } = fixture();
  assert.match(num(read, 'data/alpha/results.json#/n', 'int'), /data-source="data\/alpha\/results\.json#\/n" data-format="int">7<\/a>/);
  assert.throws(() => num(read, 'data/provider-economics.json#/series', 'int'), /only come from an experiment record/);
  assert.throws(() => num(read, 'data/alpha/results.json#/missing', 'int'), /does not resolve/);
  assert.throws(() => num(read, 'data/stray/results.json#/savings', 'pct'), /not byte for byte experiments\/stray/, 'a results file without an experiment behind it');
  assert.throws(() => num(read, 'data/beta/preregistration.json#/window', 'int'), /only come from an experiment record/, 'a pre-registration holds planned values');
  assert.throws(() => num(path => ({ n: 1 }), 'data/alpha/results.json#/n', 'int'), /cannot check records/, 'a reader without the record check is refused');
});

test('a claim whose text holds a digit, or names a value it does not define, is refused', () => {
  const { read } = fixture();
  assert.throws(() => fillClaim(read, { id: 'x', text: 'Saves 40 percent.' }), /states a number/);
  assert.throws(() => fillClaim(read, { id: 'x', text: 'Saves \uff14\uff10 percent.' }), /states a number/, 'full-width digits');
  assert.throws(() => fillClaim(read, { id: 'x', text: 'In its two counted runs.' }), /states a number/, 'a number word');
  assert.throws(() => fillClaim(read, { id: 'x', text: 'Caught {n}.' , values: {} }), /no value for \{n\}/);
  assert.match(fillClaim(read, { id: 'x', text: 'Caught {n}.', values: { n: { source: 'data/alpha/results.json#/n', format: 'int' } } }), />7<\/a>\./);
});

test('a comparison sentence is checked against its record', () => {
  const read = path => ({ 'data/x/results.json': { seats: [{ ci: [0.3, 0.5] }, { ci: [0.4, 0.6] }, { ci: [0.55, 0.7] }] } })[path];
  assert.equal(ASSERTS['intervals-overlap'](read, { source: 'data/x/results.json#/seats', field: 'ci' }), 'some intervals do not overlap');
  const ok = path => ({ 'data/x/results.json': { seats: [{ ci: [0.3, 0.5] }, { ci: [0.4, 0.6] }] } })[path];
  assert.equal(ASSERTS['intervals-overlap'](ok, { source: 'data/x/results.json#/seats', field: 'ci' }), null);
  const config = JSON.parse(readFileSync('site/data/evidence.json', 'utf8'));
  const broken = { ...config, claims: [{ ...config.claims[0], asserts: [{ kind: 'no-such-check' }] }] };
  const read2 = path => (path === 'data/evidence.json' ? broken : siteReader()(path));
  assert.throws(() => renderEvidence(read2), /unknown assertion 'no-such-check'/);
  const seats = path => ({ 'data/x/results.json': { seats: [{ cost: 0.01, caught: 30 }, { cost: 0.0005, caught: 29 }, { cost: 0.08, caught: 31 }] } })[path];
  const at = { source: 'data/x/results.json#/seats', field: 'cost' };
  assert.equal(ASSERTS['min-at'](seats, { ...at, index: 1 }), null);
  assert.match(ASSERTS['min-at'](seats, { ...at, index: 0 }), /does not have the smallest/);
  assert.equal(ASSERTS['max-at'](seats, { ...at, index: 2 }), null);
  assert.match(ASSERTS['max-at'](seats, { ...at, index: 1 }), /does not have the largest/);
  assert.equal(ASSERTS['spread-greater'](seats, { source: at.source, wide: 'cost', narrow: 'caught', by: 10 }), null);
  assert.match(ASSERTS['spread-greater'](seats, { source: at.source, wide: 'caught', narrow: 'cost' }), /is not more than/);
});

test('a model name is the key its counts are read under, so a name and its numbers cannot drift apart', () => {
  const read = siteReader();
  assert.equal(fillClaim(read, { id: 'k', text: '{m}', values: { m: { source: 'data/broker-probe/2026-W43.json#/brokers/openrouter/models/gpt-4o-mini', format: 'key' } } }), '<code>gpt-4o-mini</code>');
  assert.throws(() => fillClaim(read, { id: 'k', text: '{m}', values: { m: { source: 'data/broker-probe/2026-W43.json#/brokers/openrouter/models/no-such-model', format: 'key' } } }), /does not resolve/);
  const probe = JSON.parse(readFileSync('site/data/evidence.json', 'utf8')).claims.find(c => c.id === 'probe-openrouter');
  for (const [m, n] of [['modelA', ['okA', 'nA', 'mmA', 'fiveA']], ['modelB', ['okB', 'nB', 'mmB', 'fiveB']]]) {
    assert.equal(probe.values[m].format, 'key');
    for (const k of n) assert.ok(probe.values[k].source.startsWith(probe.values[m].source + '/'), `${k} is read under ${m}`);
  }
});

test('the EXP 017 scatter refuses a cost it cannot place on a log scale', () => {
  const read = siteReader();
  const e = { results: JSON.parse(readFileSync('site/data/review-frontier/results.json', 'utf8')) };
  e.results.seats[1].costPerReviewUsd = 0;
  assert.throws(() => frontierBlock(read, e, 'journal/review-frontier-results.html'), /positive cost per review/);
});

test('page configuration holds no number that is shown: claim texts and not-measured items are digit-free', () => {
  const config = JSON.parse(readFileSync('site/data/evidence.json', 'utf8'));
  for (const c of config.claims) assert.equal(statesNumber(c.text), false, c.id);
  for (const n of config.notMeasured) assert.equal(statesNumber(`${n.claim} ${n.why ?? ''} ${n.planned ?? ''}`), false, n.claim);
  const series = JSON.parse(readFileSync('site/data/provider-economics.json', 'utf8')).series;
  for (const s of series) assert.equal(statesNumber(`${s.title ?? ''} ${s.status ?? ''}`), false, s.title ?? s.slug);
});
