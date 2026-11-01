// Record pages (scripts/site-records.mjs, mission rnd-site-ux-nav-1101 wave 4): pure tests, the site index's use of
// them (scripts/site-index.mjs), then the real build in a disposable copy (scripts/test-build.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isRecordHref, RECORD_FIELDS, recordLocation, recordPageHref, recordRows, renderRecordPage } from './site-records.mjs';
import { buildIndex, hrefOnSite } from './site-index.mjs';
import { ledgerEntries } from './experiment-ledger.mjs';
import { builtCopy } from './test-build.mjs';

const BLOB = 'https://github.com/odin-labs-ai/odin-rnd/blob/main/';

test('a record link is a JSON file on this site or of this repository; anything else is refused', () => {
  assert.deepEqual(recordLocation('data/telemetry-truth/preregistration.json'), { sitePath: 'data/telemetry-truth/preregistration.json' });
  assert.deepEqual(recordLocation(`${BLOB}experiments/document-store/preregistration.json`), { repoPath: 'experiments/document-store/preregistration.json' });
  assert.equal(recordPageHref('data/telemetry-truth/preregistration.json'), 'records/telemetry-truth/');
  assert.equal(recordPageHref(`${BLOB}experiments/document-store/preregistration.json`), 'records/document-store/');
  for (const bad of ['journal/a.html', 'https://github.com/someone/else/blob/main/experiments/x/r.json', `${BLOB}experiments/../secret/r.json`, `${BLOB}scripts/leak-gate-set.json`, 'data/../x/r.json', '/data/x/r.json']) {
    assert.throws(() => recordLocation(bad), /Record pages/, bad);
  }
  assert.equal(isRecordHref('data/x/r.json'), true);
  assert.equal(isRecordHref('experiments/#bench'), false);
});

const entry = { id: 'EXP 015', title: 'Does the estimate match the bill?', href: 'data/telemetry-truth/preregistration.json', stage: 'Pre-registered', status: 'Pre-registration published; no field note yet.' };
const record = {
  experiment: { id: 'EXP 015', slug: 'telemetry-truth', title: 'Does the estimate match the bill?', statusText: 'Pre-registered, not yet run', authoredOn: '2026-10-23', summary: 'Compare <estimate> & bill.', note: 'Frozen.' },
  window: { from: '2026-10-28T00:00:00Z', to: '2026-11-04T00:00:00Z', settlement: 'Read later: under-counts by 1-10% at OpenRouter.' },
  sources: ['https://github.com/someone/upstream'],
  files: { 'experiments/x/a.mjs': 'abc' },
};

test('a record page shows the allowlisted fields as written, escaped, and nothing else of the record', () => {
  const bytes = Buffer.from(JSON.stringify(record));
  const html = renderRecordPage({ entry, slug: 'telemetry-truth', record, bytes, links: { github: `${BLOB}experiments/telemetry-truth/preregistration.json`, site: entry.href } });
  for (const [label, value] of recordRows(record)) assert.ok(html.includes(`<dt>${label}</dt><dd>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dd>`), label);
  assert.equal(recordRows(record).length, RECORD_FIELDS.length, 'every listed field the record has');
  assert.ok(html.includes('<dd>Compare &lt;estimate&gt; &amp; bill.</dd>'), 'escaped, never markup');
  assert.ok(html.includes(`<dt>Ledger status</dt><dd>${entry.status}</dd>`), 'the ledger\'s own status sentence');
  assert.doesNotMatch(html, /someone\/upstream|a\.mjs|1-10%|settlement/, 'no source, file list or unlisted field');
  assert.ok(html.includes(`href="../../${entry.href}"`), 'the on-site copy is linked');
  assert.ok(html.includes(`href="${BLOB}experiments/telemetry-truth/preregistration.json"`), 'and the repository file');
  assert.match(html, /<code>[0-9a-f]{64}<\/code>/, 'with the file\'s sha256');
  assert.equal((html.match(/<header class="site-header[ "]/g) || []).length, 1, 'one site header');
  assert.match(html, /aria-current="page">Experiments<\/a>/, 'under Experiments');
  // A field the record lacks is left out, not filled in.
  const bare = { experiment: { id: 'EXP 015', title: entry.title } };
  assert.deepEqual(recordRows(bare), []);
  // The record must be the ledger's: another id, another title or no link at all stops the build.
  assert.throws(() => renderRecordPage({ entry, slug: 'x', record: { experiment: { id: 'EXP 016', title: entry.title } }, bytes, links: { site: 'a' } }), /names EXP 016/);
  assert.throws(() => renderRecordPage({ entry, slug: 'x', record: { experiment: { id: 'EXP 015', title: 'Other' } }, bytes, links: { site: 'a' } }), /is titled "Other"/);
  assert.throws(() => renderRecordPage({ entry, slug: 'x', record, bytes, links: {} }), /no link to its record/);
  assert.throws(() => renderRecordPage({ entry, slug: 'Bad Slug', record, bytes, links: { site: 'a' } }), /not a plain slug/);
});

test('the site index points a raw-record item at its record page, and refuses an item that would still link raw JSON', () => {
  const base = {
    ledger: [{ ...entry }],
    updates: [{ key: 'exp-015-preregistration', experiment: 'EXP 015', title: 'Estimate vs bill', kind: 'Pre-registered', text: 'Published first.', href: entry.href, date: '2026-10-23' }],
    notes: [], labs: [], tools: [],
    topics: { topics: [{ id: 'cost', label: 'Cost' }], experiments: { 'EXP 015': ['cost'] }, labs: {}, notes: {}, tools: {} },
    outcomes: { outcomes: {}, withheld: {} },
    pages: new Set(['index.html', entry.href, 'records/telemetry-truth/index.html']),
  };
  const items = buildIndex({ ...base, recordPages: new Map([[entry.href, 'records/telemetry-truth/']]) });
  assert.deepEqual(items.map(i => [i.id, i.href]).sort(), [['exp-015', 'records/telemetry-truth/'], ['update-exp-015-preregistration', 'records/telemetry-truth/']]);
  assert.throws(() => buildIndex(base), /exp-015 links the raw record data\/telemetry-truth\/preregistration\.json/);
});

test('as built: a record page for every ledger entry that links a raw record; Find and every item lead to pages', () => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const files = new Set(walk(dist).map(file => relative(dist, file).split('\\').join('/')));
  const ledger = ledgerEntries(readFileSync(join(dist, 'index.html'), 'utf8'), JSON.parse(readFileSync(join(dist, 'data/experiments.json'), 'utf8')), dist);
  const raw = ledger.filter(e => isRecordHref(e.href));
  assert.deepEqual(raw.map(e => e.id).sort(), ['EXP 010', 'EXP 015'], 'the two ledger rows that link a raw record today');
  const index = JSON.parse(readFileSync(join(dist, 'data/index.json'), 'utf8')).items;
  const find = readFileSync(join(dist, 'find/index.html'), 'utf8');
  for (const e of raw) {
    const page = recordPageHref(e.href);
    assert.ok(files.has(`${page}index.html`), `${page} is built`);
    const html = readFileSync(join(dist, page, 'index.html'), 'utf8');
    assert.ok(html.includes(`<h1 id="record-title">${e.title.replace(/'/g, '&#39;')}</h1>`), `${page} carries the ledger's title`);
    const item = index.find(i => i.id === `exp-${e.id.slice(4)}`);
    assert.equal(item.href, page, `${e.id}'s item leads to its record page`);
    assert.ok(find.includes(`href="../${page}"`), `Find lists ${e.id} with a link to ${page}`);
  }
  for (const item of index) {
    assert.doesNotMatch(item.href, /\.json(#|$)/, `${item.id} does not lead to raw JSON`);
    assert.ok(hrefOnSite(item.href, files), `${item.id}: ${item.href} resolves to a file of the built site`);
  }
  assert.match(readFileSync(join(root, 'site/sitemap.xml'), 'utf8'), /records\/document-store\/<\/loc><\/url><url><loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/records\/telemetry-truth\//);
});
