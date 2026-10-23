import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkPage, checkSite, format, PAGES, parseAttributes, quoteProblem, recordProblem, resolvePointer, SOURCE_FILE } from './number-provenance.mjs';

// The realism ratchet for the lab's provider-economics and evidence pages (vp-grow-odin-r-d bundle-3 WO-04): every
// visible number links to an experiment record and shows exactly the value its JSON pointer holds. These tests run
// before the build (publish.yml runs `pnpm test` first), so they use in-memory fixtures and never read dist/.

const RECORD = 'data/demo/results.json';
const files = {
  [RECORD]: JSON.stringify({ seats: [{ caught: 31, caughtOf: 60, cost: 0.083274, ci: [0.393, 0.638] }] }),
  'data/evidence.json': JSON.stringify({ typed: 42 }),
  'data/demo/preregistration.json': JSON.stringify({ experiment: { title: 'Does it beat one fixed model in 2 runs?' } }),
  'assets/style.css': '',
  'methods/index.html': '',
};
const readData = path => files[path] ?? null;
const exists = path => path in files;
const FILE = 'evidence/index.html';
const page = body => `<!doctype html><html><head><title>t 2026</title><link rel="stylesheet" href="../assets/style.css"></head><body><main>${body}</main></body></html>`;
const sourced = (pointer, kind, shown, extra = '') => `<a href="../${RECORD}" data-source="${RECORD}#${pointer}" data-format="${kind}"${extra}>${shown}</a>`;
// In these unit cases the demo record stands in for a measured experiment record; recordProblem has its own tests below.
const io = { readData, exists, recordProblem: path => (path === RECORD ? null : `${path} is not a measured experiment record`), quoteProblem: path => (path === 'data/demo/preregistration.json' ? null : `${path} is not a frozen pre-registration`) };
const problems = body => checkPage(FILE, page(body), io);

test('a sourced number that links to its record and shows its value passes', () => {
  assert.deepEqual(problems(`<p>Caught ${sourced('/seats/0/caught', 'int', '31')} of ${sourced('/seats/0/caughtOf', 'int', '60')} at ${sourced('/seats/0/cost', 'usd', '$0.083274')} (${sourced('/seats/0/ci/0', 'pct', '39%')}).</p>`), []);
});

test('an unsourced number fails', () => {
  const p = problems('<p>Odin saves 40% on every call.</p>');
  assert.equal(p.length, 1);
  assert.match(p[0], /unsourced digit/);
});

test('a number that does not match its record fails', () => {
  const p = problems(`<p>Caught ${sourced('/seats/0/caught', 'int', '32')}.</p>`);
  assert.equal(p.length, 1);
  assert.match(p[0], /shows '32' but the record holds 31/);
  assert.match(problems(`<p>${sourced('/seats/0/cost', 'usd', '$0.08')}</p>`)[0], /renders '\$0\.083274'/, 'rounding by hand is a mismatch');
});

test('a dead link fails', () => {
  const p = problems('<p><a href="../no-such-page/">gone</a> and <a href="../methods/">here</a></p>');
  assert.equal(p.length, 1);
  assert.match(p[0], /dead link '\.\.\/no-such-page\/'/);
});

test('a page configuration file is never a source, even when its number matches', () => {
  const html = `<p><a href="../data/evidence.json" data-source="data/evidence.json#/typed" data-format="int">42</a></p>`;
  assert.match(problems(html).join('\n'), /not a measured experiment record/);
  assert.equal(SOURCE_FILE.test('data/evidence.json'), false);
  assert.equal(SOURCE_FILE.test('data/provider-economics.json'), false);
  assert.equal(SOURCE_FILE.test('data/provider-partners.json'), false);
  assert.equal(SOURCE_FILE.test('data/review-frontier/results.json'), true);
  assert.equal(SOURCE_FILE.test('data/telemetry-truth/preregistration.json'), false, 'a pre-registration holds planned values, not measured ones');
  assert.equal(SOURCE_FILE.test('data/broker-probe/2026-W43.json'), true);
  assert.equal(SOURCE_FILE.test('data/broker-probe/catalogue/openrouter.json'), false);
});

test('a sourced number must be a link to its own record', () => {
  assert.match(problems(`<p><span data-source="${RECORD}#/seats/0/caught" data-format="int">31</span></p>`).join('\n'), /not a link to its record/);
  assert.match(problems(`<p><a href="../methods/" data-source="${RECORD}#/seats/0/caught" data-format="int">31</a></p>`).join('\n'), /not a link to its record/);
  // data-href is not href: \b would have matched after the hyphen.
  assert.match(problems(`<p><a data-href="../${RECORD}" data-source="${RECORD}#/seats/0/caught" data-format="int">31</a></p>`).join('\n'), /not a link to its record/);
  assert.equal(parseAttributes(' data-href="x" x-data-source=\'y\'').get('href'), undefined);
  assert.equal(parseAttributes(' data-href="x" x-data-source=\'y\'').get('data-source'), undefined);
  // Single-quoted and unquoted attributes are read the same as double-quoted ones.
  assert.deepEqual(problems(`<p><a href='../${RECORD}' data-source='${RECORD}#/seats/0/caught' data-format=int>31</a></p>`), []);
});

test('a title quoted verbatim from a frozen pre-registration may hold digits and number words; anything else may not', () => {
  const Q = 'data/demo/preregistration.json#/experiment/title';
  assert.deepEqual(problems(`<p>EXP 018: <cite data-quote="${Q}">Does it beat one fixed model in 2 runs?</cite></p>`), []);
  assert.match(problems(`<p><cite data-quote="${Q}">Does it beat one fixed model in 3 runs?</cite></p>`).join('\n'), /not the record's, verbatim/);
  assert.match(problems(`<p><span data-quote="${Q}">Does it beat one fixed model in 2 runs?</span></p>`).join('\n'), /not on a <cite>/);
  assert.match(problems(`<p><cite data-quote="${RECORD}#/seats/0/caught">31</cite></p>`).join('\n'), /not a published pre-registration/);
  assert.match(problems(`<p><cite data-quote="data/evidence.json#/typed">42</cite></p>`).join('\n'), /not a published pre-registration/);
  assert.match(problems(`<p><cite data-quote="data/demo/preregistration.json#/experiment/missing">x</cite></p>`).join('\n'), /does not resolve to text/);
  assert.match(problems(`<p><cite data-quote="${Q}">Does it beat <b>one</b> fixed model in 2 runs?</cite></p>`).join('\n'), /number word|unsourced digit/, 'not a leaf');
  assert.match(problems(`<p><cite>beats one fixed model</cite></p>`).join('\n'), /number word 'one'/, 'a plain <cite> is not exempt');
});

test('a missing record, an unresolved pointer, a non-number and an unknown format all fail', () => {
  assert.match(problems(`<p><a href="../data/gone/results.json" data-source="data/gone/results.json#/x" data-format="int">1</a></p>`).join('\n'), /not in the built site/);
  assert.match(problems(`<p>${sourced('/seats/9/caught', 'int', '1')}</p>`).join('\n'), /does not resolve/);
  assert.match(problems(`<p>${sourced('/seats/0/ci', 'int', '1')}</p>`).join('\n'), /not a finite number/);
  assert.match(problems(`<p>${sourced('/seats/0/caught', 'eur', '31')}</p>`).join('\n'), /unknown data-format/);
  assert.match(problems(`<p>${sourced('/seats/0/cost', 'int', '0')}</p>`).join('\n'), /not an integer/);
});

test('a data-source element with child tags is not a leaf, so its digits stay unsourced', () => {
  assert.match(problems(`<p><a href="../${RECORD}" data-source="${RECORD}#/seats/0/caught" data-format="int"><b>31</b></a></p>`).join('\n'), /unsourced digit/);
});

test('exemptions are exactly the enumerated ones', () => {
  assert.deepEqual(problems('<p>EXP 017 froze its sha256; p50 and p95 latency; 5xx errors.</p>'), []);
  assert.deepEqual(problems('<p>Model <code>openai/gpt-oss-120b</code> and <code>gpt-4o-mini</code>.</p>'), []);
  assert.deepEqual(problems('<p>From <time datetime="2026-10-28T00:00:00Z">2026-10-28</time> in <time datetime="2026-W43">2026-W43</time>.</p>'), []);
  // Not exempt: a figure inside <code>, a <time> whose text is not its datetime or not a date, and near-miss tokens.
  assert.match(problems('<p><code>$12,000</code></p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p><code>40%</code></p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p><code>5 brokers</code></p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p><code>16k</code></p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p><code>12000</code></p>').join('\n'), /unsourced digit/);
  assert.deepEqual(problems('<p><code>data/broker-probe/2026-W43.json</code></p>'), []);
  assert.match(problems('<p><time datetime="2026-10-28">2026-11-04</time></p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p><time datetime="12k">12k</time></p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p>EXP 17</p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p>p99</p>').join('\n'), /unsourced digit/);
  assert.match(problems('<p>4xx</p>').join('\n'), /unsourced digit/);
});

test('digits of any script and numbers written as words fail', () => {
  assert.match(problems('<p>Odin saves \uff14\uff10% on spend.</p>').join('\n'), /unsourced digit/, 'full-width digits');
  assert.match(problems('<p>Odin saves \u0664\u0660 percent.</p>').join('\n'), /unsourced digit/, 'Arabic-Indic digits');
  for (const phrase of ['in its two counted runs', 'on one sealed corpus', 'a hundredfold cheaper', 'the first week', 'twice as fast', 'dozens of models', 'Zero errors']) assert.match(problems(`<p>${phrase}</p>`).join('\n'), /number word/, phrase);
  assert.deepEqual(problems('<p>Someone, anyone, alone, done, tone, often, tenant: words that only contain a number word pass.</p>'), []);
});

test('digits in SVG text and in aria-label, alt and title fail', () => {
  assert.match(problems('<svg><text x="1" y="2">$0.01</text></svg>').join('\n'), /unsourced digit/);
  assert.deepEqual(problems('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2"></circle><text x="1" y="2">opus</text></svg>'), [], 'geometry attributes are not text');
  assert.match(problems('<div aria-label="saves 40%">x</div>').join('\n'), /aria-label=.*unsourced digit/);
  assert.match(problems('<img src="../assets/style.css" alt="chart of 3 brokers">').join('\n'), /alt=.*unsourced digit/);
  assert.match(problems('<abbr title="since 2024">x</abbr>').join('\n'), /title=.*unsourced digit/);
  assert.match(problems("<div aria-label='saves 40%'>x</div>").join('\n'), /aria-label=.*unsourced digit/, 'single-quoted');
  assert.match(problems('<div aria-label=saves40>x</div>').join('\n'), /aria-label=.*unsourced digit/, 'unquoted');
  assert.match(problems('<input value="40%" placeholder="3 brokers">').join('\n'), /value=.*unsourced digit/);
  assert.match(problems('<div aria-label="two brokers">x</div>').join('\n'), /aria-label=.*number word/);
});

test('text outside <body> is not scanned; comments, scripts and styles are not visible text', () => {
  assert.deepEqual(problems('<!-- 42 --><script>const a = 42;</script><style>.a{width:42px}</style><p>none</p>'), []);
});

test('a listed page missing from the build fails the site check (fail closed)', () => {
  const dist = mkdtempSync(join(tmpdir(), 'np-'));
  mkdirSync(join(dist, 'evidence'), { recursive: true });
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'assets/style.css'), '');
  writeFileSync(join(dist, 'evidence/index.html'), page('<p>none</p>'));
  let p;
  try { p = checkSite(dist, ['evidence/index.html', 'provider-economics/index.html']); } finally { rmSync(dist, { recursive: true, force: true }); }
  assert.equal(p.length, 1);
  assert.match(p[0], /provider-economics\/index\.html: the page is listed .* but is not in the build/);
  assert.ok(PAGES.includes('evidence/index.html') && PAGES.includes('provider-economics/index.html'));
});

test('format and resolvePointer are exact', () => {
  assert.equal(format(31, 'int'), '31');
  assert.equal(format(0.000631, 'usd'), '$0.000631');
  assert.equal(format(0.3925, 'pct'), '39%');
  assert.equal(format(16.85832, 'num'), '16.85832');
  assert.throws(() => format('31', 'int'), /not a finite number/);
  assert.throws(() => format(NaN, 'num'), /not a finite number/);
  assert.throws(() => format(5e-7, 'usd'), /no plain decimal form/);
  assert.equal(resolvePointer({ 'a/b': { '~c': 5 } }, '/a~1b/~0c'), 5);
  assert.equal(resolvePointer({ a: [1, 2] }, '/a/1'), 2);
  assert.equal(resolvePointer({ a: 1 }, '/b'), undefined);
  assert.equal(resolvePointer({ a: 1 }, 'a'), undefined);
});

// recordProblem binds a source to a measured, pre-registered experiment in the checkout (finding: path shape alone let
// any committed data/<slug>/results.json through).
test('a source must be a measured experiment record bound to its frozen pre-registration', () => {
  const root = mkdtempSync(join(tmpdir(), 'np-rec-'));
  try {
    const dir = join(root, 'experiments/demo');
    mkdirSync(dir, { recursive: true });
    const prereg = '{"kind":"odin-rnd.preregistration"}\n';
    writeFileSync(join(dir, 'preregistration.json'), prereg);
    writeFileSync(join(dir, 'preregistration.sha256'), createHash('sha256').update(prereg).digest('hex') + '  preregistration.json\n');
    const results = JSON.stringify({ kind: 'odin-rnd.results', slug: 'demo', preregistration: 'experiments/demo/preregistration.json', n: 3 });
    writeFileSync(join(dir, 'results.json'), results);
    assert.equal(recordProblem('data/demo/results.json', results, root), null);
    assert.equal(quoteProblem('data/demo/preregistration.json', prereg, root), null);
    assert.match(quoteProblem('data/demo/preregistration.json', prereg.replace('}', ',"x":1}'), root), /not byte for byte/);
    assert.match(quoteProblem('data/demo/results.json', prereg, root), /not a published pre-registration/);
    assert.match(recordProblem('data/demo/results.json', results.replace('3', '4'), root), /not byte for byte/);
    assert.match(recordProblem('data/marketing/results.json', '{"savings":0.4}', root), /not byte for byte experiments\/marketing/);
    assert.match(recordProblem('data/demo/preregistration.json', prereg, root), /not a results record/);
    assert.match(recordProblem('data/evidence.json', '{}', root), /not a results record/);
    writeFileSync(join(dir, 'preregistration.sha256'), '0'.repeat(64) + '  preregistration.json\n');
    assert.match(recordProblem('data/demo/results.json', results, root), /does not match its preregistration\.sha256/);
    const other = JSON.stringify({ kind: 'odin-rnd.results', slug: 'demo', preregistration: 'experiments/other/preregistration.json' });
    writeFileSync(join(dir, 'results.json'), other);
    assert.match(recordProblem('data/demo/results.json', other, root), /does not name experiments\/demo\/preregistration\.json/);
    assert.equal(recordProblem('data/broker-probe/2026-W43.json', '{"kind":"odin-rnd.broker-probe","week":"2026-W43"}', root), null);
    assert.match(recordProblem('data/broker-probe/2026-W43.json', '{"kind":"odin-rnd.broker-probe","week":"2026-W44"}', root), /not the probe record of week 2026-W43/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the committed records the pages cite are bound to their experiments', () => {
  for (const slug of ['review-frontier', 'self-verify']) assert.equal(recordProblem(`data/${slug}/results.json`, readFileSync(`site/data/${slug}/results.json`, 'utf8')), null, slug);
});
