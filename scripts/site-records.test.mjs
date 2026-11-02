// Record pages (scripts/site-records.mjs, mission rnd-site-ux-nav-1101 wave 4): pure tests, the site index's use of
// them (scripts/site-index.mjs), then the real build in a disposable copy (scripts/test-build.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { isRecordHref, notesNaming, RECORD_FIELDS, recordLocation, recordPageHref, recordRows, renderRecordPage } from './site-records.mjs';
import { buildIndex, hrefOnSite, loadIndex } from './site-index.mjs';
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
  assert.throws(() => buildIndex(base), /EXP 015's ledger row links the raw record data\/telemetry-truth\/preregistration\.json, which has no record page/);
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

test('"no field note yet" only when no field note names the experiment; otherwise the page links the note', () => {
  const bytes = Buffer.from(JSON.stringify(record));
  const links = { site: entry.href };
  const none = renderRecordPage({ entry, slug: 'telemetry-truth', record, bytes, links, notes: [] });
  assert.ok(none.includes('This experiment has no field note yet.'));
  const one = renderRecordPage({ entry, slug: 'telemetry-truth', record, bytes, links, notes: [{ href: 'journal/estimate.html', title: 'Estimate & bill' }] });
  const lead = html => /<p class="company-lead">([\s\S]*?)<\/p>/.exec(html)[1];
  assert.ok(lead(none).startsWith('This experiment has no field note yet.'));
  assert.ok(!lead(one).includes('no field note'), 'never claimed when a note names it (the ledger\'s own status sentence is quoted as written, below)');
  assert.ok(one.includes('Its field note: <a href="../../journal/estimate.html">Estimate &amp; bill</a>.'));
  // notesNaming reads the built notes' meta lines: a whole "EXP 015" token, never EXP 0150 or EXP 105.
  const dist = mkdtempSync(join(tmpdir(), 'site-records-'));
  try {
    mkdirSync(join(dist, 'journal'));
    const page = (meta, h1) => `<main><header class="article-header"><h1>${h1}</h1><p class="article-meta">${meta}</p></header></main>`;
    writeFileSync(join(dist, 'journal/a.html'), page('EXPERIMENT NOTE / 009 · EXP 015 · PRE-REGISTERED 23 OCT 2026', 'Estimate &amp; bill'));
    writeFileSync(join(dist, 'journal/b.html'), page('EXPERIMENT NOTE / 010 · EXP 0150 · EXP 105', 'Other'));
    writeFileSync(join(dist, 'journal/index.html'), page('EXP 015', 'The list'));
    assert.deepEqual(notesNaming('EXP 015', dist), [{ href: 'journal/a.html', title: 'Estimate & bill' }]);
    assert.deepEqual(notesNaming('EXP 010', dist), []);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('a JSON record link without its record page stops the index: no fallback for a GitHub blob, an on-site copy or an update', () => {
  const blob = `${BLOB}experiments/document-store/preregistration.json`;
  const base = {
    ledger: [{ id: 'EXP 010', title: 'From the repository', href: blob, stage: 'Pre-registered · record in the repository', status: 'Published.' }],
    updates: [{ key: 'exp-010-preregistration', experiment: 'EXP 010', title: 'Repo record', kind: 'Pre-registered', text: 'Published first.', href: 'data/telemetry-truth/preregistration.json', date: '2026-10-10' }],
    notes: [], labs: [], tools: [],
    topics: { topics: [{ id: 'cost', label: 'Cost' }], experiments: { 'EXP 010': ['cost'] }, labs: {}, notes: {}, tools: {} },
    outcomes: { outcomes: {}, withheld: {} },
    pages: new Set(['index.html', 'records/document-store/index.html', 'records/telemetry-truth/index.html']),
  };
  assert.throws(() => buildIndex(base), /EXP 010's ledger row links the raw record https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/blob\/main\/experiments\/document-store\/preregistration\.json, which has no record page/);
  assert.throws(() => buildIndex({ ...base, recordPages: new Map([[blob, 'records/document-store/']]) }), /update exp-010-preregistration links the raw record data\/telemetry-truth\/preregistration\.json, which has no record page/);
  const items = buildIndex({ ...base, recordPages: new Map([[blob, 'records/document-store/'], ['data/telemetry-truth/preregistration.json', 'records/telemetry-truth/']]) });
  assert.equal(items.find(i => i.id === 'exp-010').href, 'records/document-store/', 'never index.html#all-experiments for a JSON record');
});

test('as built: removing a rendered record page makes the site index refuse to build, naming the page', () => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  for (const slug of ['document-store', 'telemetry-truth']) {
    const page = join(dist, 'records', slug, 'index.html');
    renameSync(page, `${page}.aside`);
    try { assert.throws(() => loadIndex({ root, dist }), new RegExp(`its record page records/${slug}/ was not rendered`)); } finally { renameSync(`${page}.aside`, page); }
  }
  assert.ok(loadIndex({ root, dist }).length > 0, 'both pages back: the index builds');
});

test('as built: each record page links the chrome stylesheet exactly once, after its own, and marks Experiments current', () => {
  const dist = join(builtCopy(), 'dist');
  for (const slug of ['document-store', 'telemetry-truth']) {
    const html = readFileSync(join(dist, 'records', slug, 'index.html'), 'utf8');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
    assert.deepEqual(sheets, ['../../assets/style.css', '../../assets/company.css', '../../assets/chrome.css'], `${slug}: chrome.css once, last`);
    assert.match(html, /<a href="\.\.\/\.\.\/experiments\/" aria-current="page">Experiments<\/a>/, `${slug}: Experiments is current`);
    assert.ok(html.includes('This experiment has no field note yet.'), `${slug}: no built note names it today`);
  }
});
