import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSERTS, fillClaim, num, renderEvidence, renderLabPages, renderProviderEconomics, siteReader } from './lab-pages.mjs';
import { checkPage } from './number-provenance.mjs';
import { checkPages, loadTerms } from './provider-terms.mjs';

// The provider-economics and evidence pages (vp-grow-odin-r-d bundle-3 WO-01, WO-03). `pnpm test` runs before
// `pnpm build`, so these render in memory from site/ (and from fixtures) and never read dist/. dist/data/ is a copy
// of site/data/, so the provenance check reads the records from site/ here.

const rendered = renderLabPages();
const readSite = path => (existsSync(join('site', path)) ? readFileSync(join('site', path), 'utf8') : null);

test('both pages render from the committed records and pass the number-provenance check', () => {
  for (const [page, html] of Object.entries(rendered)) {
    assert.deepEqual(checkPage(`${page}/index.html`, html, readSite), [], page);
    assert.ok((html.match(/data-source="/g) ?? []).length >= 10, `${page} shows sourced numbers`);
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
  }
});

test('the evidence page lists what is not measured yet: at least routing savings, negotiated prices and partnerships', () => {
  const notMeasured = rendered.evidence.slice(rendered.evidence.indexOf('id="not-measured"'));
  for (const phrase of ["routing saves money against a fixed-model baseline", 'negotiated better prices', 'provider partnerships', "cost estimates match what the brokers bill"]) assert.ok(notMeasured.includes(phrase), phrase);
});

test('the pages are in the sitemap and linked from the home page and the methods page', () => {
  const sitemap = readFileSync('site/sitemap.xml', 'utf8');
  for (const page of ['provider-economics', 'evidence']) {
    assert.match(sitemap, new RegExp(`<loc>https://odin-labs-ai\\.github\\.io/odin-rnd/${page}/</loc>`), page);
    assert.match(readFileSync('site/index.html', 'utf8'), new RegExp(`href="${page}/"`), `home links ${page}`);
    assert.match(readFileSync('site/methods/index.html', 'utf8'), new RegExp(`href="\\.\\./${page}/"`), `methods links ${page}`);
  }
});

// A fixture site: experiment alpha has results, beta has only a pre-registration, and the probe has one week.
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
function fixture({ betaResults = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lab-pages-'));
  made.push(root);
  const put = (path, value) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  put('data/alpha/preregistration.json', { experiment: { id: 'EXP 901', title: 'Alpha question?' } });
  put('data/alpha/results.json', { n: 7 });
  put('data/beta/preregistration.json', { experiment: { id: 'EXP 902', title: 'Beta question?' }, window: { from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z' } });
  if (betaResults) put('data/beta/results.json', { n: 3 });
  put('data/provider-terms.json', JSON.parse(readFileSync('site/data/provider-terms.json', 'utf8')));
  put('data/broker-probe/2026-W43.json', JSON.parse(readFileSync('site/data/broker-probe/2026-W43.json', 'utf8')));
  put('data/provider-economics.json', { series: [{ slug: 'alpha' }, { slug: 'beta' }, { slug: null, title: 'Gamma question?', status: 'Not pre-registered yet.' }] });
  return { root, read: siteReader(root) };
}

test('an experiment with results is published; one without is listed as not yet published, with its window', () => {
  const { read } = fixture();
  const html = renderProviderEconomics(read, ['2026-W43']);
  const [published, pending] = html.split('id="not-yet"');
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

test('when a pre-registered experiment gains results, it moves to the published block without a page edit', () => {
  const { read } = fixture({ betaResults: true });
  const [published, pending] = renderProviderEconomics(read, ['2026-W43']).split('id="not-yet"');
  assert.match(published, /EXP 902: Beta question\?/);
  assert.match(published, /href="\.\.\/data\/beta\/results\.json"/);
  assert.doesNotMatch(pending, /EXP 902/);
});

test('a number may only come from an experiment record, never from page configuration', () => {
  const { read } = fixture();
  assert.match(num(read, 'data/alpha/results.json#/n', 'int'), /data-source="data\/alpha\/results\.json#\/n" data-format="int">7<\/a>/);
  assert.throws(() => num(read, 'data/provider-economics.json#/series', 'int'), /only come from an experiment record/);
  assert.throws(() => num(read, 'data/alpha/results.json#/missing', 'int'), /does not resolve/);
});

test('a claim whose text holds a digit, or names a value it does not define, is refused', () => {
  const { read } = fixture();
  assert.throws(() => fillClaim(read, { id: 'x', text: 'Saves 40 percent.' }), /holds a digit/);
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
});

test('page configuration holds no number that is shown: claim texts and not-measured items are digit-free', () => {
  const config = JSON.parse(readFileSync('site/data/evidence.json', 'utf8'));
  for (const c of config.claims) assert.doesNotMatch(c.text, /\d/, c.id);
  for (const n of config.notMeasured) assert.doesNotMatch(`${n.claim} ${n.why ?? ''} ${n.planned ?? ''}`, /\d/, n.claim);
  const series = JSON.parse(readFileSync('site/data/provider-economics.json', 'utf8')).series;
  for (const s of series) assert.doesNotMatch(`${s.title ?? ''} ${s.status ?? ''}`, /\d/);
});
