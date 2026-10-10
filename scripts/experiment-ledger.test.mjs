import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addLedger, journalRows, ledgerEntries, renderLedger, statusSentence, textOf } from './experiment-ledger.mjs';
import { builtCopy } from './test-build.mjs';
import { stripTags } from './test-html-text.mjs';

test('textOf reads what a visitor sees and leaves no tag behind', () => {
  assert.equal(textOf('EXP 007: Which of your gate&#39;s rules <br>need a model?'), "EXP 007: Which of your gate's rules need a model?");
  assert.equal(textOf('a &amp;lt; b'), 'a &lt; b', 'an escaped entity is decoded once, not twice');
  assert.equal(textOf('x<scr<script>ipt>y'), 'x ipt y', 'nested tags are removed to a fixed point; only text is left');
});

test('statusSentence starts at the first status word and is empty without one', () => {
  assert.equal(statusSentence('Can a model do it? Pre-registered; measured 29 Sep 2026: the claim is refuted.'), 'Pre-registered; measured 29 Sep 2026: the claim is refuted.');
  assert.equal(statusSentence('A question. Measured on one laptop, 48 authored rows.'), 'Measured on one laptop, 48 authored rows.');
  assert.equal(statusSentence('A question with no status word.'), 'A question with no status word.', 'shown whole, never cut or blank');
});

test('journalRows reads each field-note row in page order', () => {
  const html = '<a class="journal-row" href="journal/a.html#results"><div><h3>EXP 010: A <br>title</h3><p>Why. Pre-registered; not yet run.</p></div></a><a class="journal-row" href="journal/b.html"><h3>B</h3><p>Note.</p></a>';
  assert.deepEqual(journalRows(html), [
    { href: 'journal/a.html#results', heading: 'EXP 010: A title', text: 'Why. Pre-registered; not yet run.' },
    { href: 'journal/b.html', heading: 'B', text: 'Note.' },
  ]);
  const withAttributes = '<a class="journal-row" href="journal/c.html"><h3 class="t">EXP 011: C</h3><p class="s">Pre-registered; not yet run.</p></a>';
  assert.deepEqual(journalRows(withAttributes), [{ href: 'journal/c.html', heading: 'EXP 011: C', text: 'Pre-registered; not yet run.' }], 'attributes on h3 or p do not hide the row');
  assert.equal(journalRows('<a class="journal-row" href="x"><header>H</header><p>t</p></a>')[0].heading, '', '<header> is not an h3');
});

test('renderLedger escapes every value it prints', () => {
  const html = renderLedger([{ id: 'EXP 001', title: '<b>x</b> & "y"', href: 'journal/x.html?a="1"', stage: 'Recorded', status: 'a < b' }]);
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;'));
  assert.ok(html.includes('href="journal/x.html?a=&quot;1&quot;"'));
  assert.ok(html.includes('a &lt; b'));
});

test('addLedger refuses a page without the ledger marker', () => {
  assert.throws(() => addLedger('<main></main>', { runs: [] }), /no ledger marker/);
});

test('the built home page lists every experiment, in order, with the status its own field note states', () => {
  const root = builtCopy();
  const page = readFileSync(join(root, 'dist/index.html'), 'utf8');
  assert.ok(!page.includes('<!--EXPERIMENT_LEDGER-->'));
  const ledger = page.split('<div class="experiment-ledger" id="all-experiments">')[1]?.split('</ol></div>')[0];
  assert.ok(ledger, 'the ledger is on the home page');
  const ids = [...ledger.matchAll(/<span class="technical">(EXP \d{3})<\/span>/g)].map(m => m[1]);
  const report = JSON.parse(readFileSync(join(root, 'site/data/experiments.json'), 'utf8'));
  const preregistered = readdirSync(join(root, 'dist/data'), { withFileTypes: true }).filter(e => e.isDirectory())
    .filter(e => readdirSync(join(root, 'dist/data', e.name)).includes('preregistration.json'))
    .map(e => JSON.parse(readFileSync(join(root, 'dist/data', e.name, 'preregistration.json'), 'utf8')).experiment.id);
  const expected = [...report.runs.map((_, i) => `EXP ${String(i + 1).padStart(3, '0')}`), 'EXP 004', ...preregistered].sort();
  assert.deepEqual(ids, expected, 'one row per recorded recipe, the Laya comparison and every pre-registration, in number order');
  const rows = journalRows(page);
  for (const entry of ledgerEntries(page, report, join(root, 'dist'))) {
    assert.ok(entry.stage, `${entry.id} has a stage`);
    if (entry.href.startsWith('journal/')) {
      const row = rows.find(r => r.href === entry.href);
      assert.ok(row && row.text.endsWith(entry.status), `${entry.id}'s status is its field-note row's own sentence`);
      assert.ok(entry.status, `${entry.id} shows a status`);
    }
  }
  const text = stripTags(ledger);
  assert.match(text, /EXP 001–003 show their recorded run/, 'the intro says which statuses are composed from a record and which are copied from a note');
  assert.match(text, /EXP 005\s+Jev as a fast gate\s+Results published[^]*?the claim is refuted\./, 'a refuted claim stays refuted');
  assert.match(text, /EXP 007\s+Which of your gate's rules need a model at all\?\s+Results published[^]*?the premise is refuted\./);
});

test('the ledger refuses results whose field-note row still says the experiment has not run', () => {
  const root = builtCopy();
  const page = readFileSync(join(root, 'dist/index.html'), 'utf8');
  const report = JSON.parse(readFileSync(join(root, 'site/data/experiments.json'), 'utf8'));
  // replaceAll: the sentence is on the page twice, in the ledger itself and in the field-note row it came from.
  const stale = page.replaceAll('Pre-registered; measured 29 Sep 2026: the claim is refuted.', 'Pre-registered; not yet run.');
  assert.notEqual(stale, page, 'the fixture changed the EXP 005 row');
  assert.throws(() => ledgerEntries(stale, report, join(root, 'dist')), /EXP 005 publishes results but its field-note row says it has not run/);
});

test('a pre-registration with no field-note row is listed with a plain status, and results without one refuse the build', (t) => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  const page = readFileSync(join(dist, 'index.html'), 'utf8');
  const report = JSON.parse(readFileSync(join(root, 'site/data/experiments.json'), 'utf8'));
  // Subjects are picked from what is published now, so the test keeps working as results land (EXP 009 next).
  const published = readdirSync(join(dist, 'data'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    .filter(slug => readdirSync(join(dist, 'data', slug)).includes('preregistration.json'))
    .map(slug => ({ slug, id: JSON.parse(readFileSync(join(dist, 'data', slug, 'preregistration.json'), 'utf8')).experiment.id, results: readdirSync(join(dist, 'data', slug)).includes('results.json') }))
    .filter(e => page.includes(`<h3>${e.id}: `));
  const unrow = (html, id) => html.replaceAll(`<h3>${id}: `, '<h3>Renamed note: ');
  const measured = published.find(e => e.results);
  if (measured) assert.throws(() => ledgerEntries(unrow(page, measured.id), report, dist), new RegExp(`${measured.id} publishes results but has no field-note row`));
  const pending = published.find(e => !e.results);
  if (!pending) { t.skip('every published pre-registration has results'); return; }
  const entry = ledgerEntries(unrow(page, pending.id), report, dist).find(e => e.id === pending.id);
  assert.equal(entry.status, 'Pre-registration published; no field note yet.');
  assert.equal(entry.href, `data/${pending.slug}/preregistration.json`);
});

test('a published results.json with no pre-registration beside it refuses the build', () => {
  const root = builtCopy();
  const page = readFileSync(join(root, 'dist/index.html'), 'utf8');
  const report = JSON.parse(readFileSync(join(root, 'site/data/experiments.json'), 'utf8'));
  const orphan = join(root, 'dist/data/orphan-results-fixture');
  mkdirSync(orphan);
  try {
    writeFileSync(join(orphan, 'results.json'), '{}');
    assert.throws(() => ledgerEntries(page, report, join(root, 'dist')), /data\/orphan-results-fixture\/results\.json has no pre-registration/);
  } finally {
    rmSync(orphan, { recursive: true, force: true });
  }
});
