// The site index (mission rnd-site-ux-nav-1101, WP1): buildIndex() on fixtures (no build needed), then loadIndex() on a
// real build in a disposable copy: every item matches scripts/schemas/site-index.schema.json, every source item appears
// exactly once, ids are unique, dates are real ISO days, every href is a file of the built site, and two runs agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';
import { buildIndex, experimentIds, hrefOnSite, loadIndex, metaDay } from './site-index.mjs';
import { ledgerEntries } from './experiment-ledger.mjs';
import { TILE_FILES } from './lab-tiles.mjs';
import { builtCopy } from './test-build.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(REPO, 'scripts/schemas/site-index.schema.json'), 'utf8'));
const isoDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

const fixture = () => ({
  ledger: [
    { id: 'EXP 001', title: 'Recipe one', href: 'experiments/#bench', stage: 'Recorded', status: 'Recorded 19 Oct 2026: flagged the copy we broke on purpose.' },
    { id: 'EXP 002', title: 'Recipe two', href: 'experiments/#bench', stage: 'Recorded', status: 'Recorded 19 Oct 2026: flagged the copy we broke on purpose.' },
    { id: 'EXP 005', title: 'A gate', href: 'journal/gate.html', stage: 'Results published · 2 amendments', status: 'Pre-registered; measured 29 Sep 2026: the claim is refuted.' },
    { id: 'EXP 010', title: 'From the repository', href: 'https://github.com/x/y/blob/main/r.json', stage: 'Pre-registered · record in the repository', status: 'Pre-registration published in the repository.' },
  ],
  updates: [
    { key: 'exp-001-002-recorded', experiment: 'EXP 001–002', title: 'Two recipes', kind: 'Recorded', text: 'Both recipes ran.', href: 'experiments/#bench', date: '2026-09-23' },
    { key: 'exp-005-preregistration', experiment: 'EXP 005', title: 'A gate', kind: 'Pre-registered', text: 'Published first.', href: 'journal/gate.html', date: '2026-09-28' },
    { key: 'exp-005-results', experiment: 'EXP 005', title: 'A gate', kind: 'Results', text: 'Pre-registered; measured 29 Sep 2026: the claim is refuted.', href: 'journal/gate.html', date: '2026-09-29' },
    { key: 'note-why', experiment: null, title: 'Why', kind: 'Field note', text: 'A note.', href: 'journal/why.html', date: '2026-09-07' },
    { key: 'tool-witness', experiment: null, title: 'Witness', kind: 'Tool', text: 'A tool.', href: 'projects/witness/', date: '2026-09-23' },
  ],
  notes: [
    { slug: 'gate', title: 'A gate: measured', summary: 'The gate note.', date: '2026-09-26' },
    { slug: 'why', title: 'Why', summary: 'Why we do it.', date: '2026-09-07' },
  ],
  labs: [{ label: 'Lab 01', title: 'The space', summary: 'A small world.', stage: 'running', href: 'labs/space/index.html', date: '2026-10-25' }],
  tools: [{ project: 'witness', title: 'Witness', summary: 'A tool.', href: 'projects/witness/', date: '2026-09-23' }],
  topics: {
    topics: [{ id: 'gates', label: 'Gates' }, { id: 'agents', label: 'Agents' }, { id: 'architecture', label: 'Architecture' }],
    experiments: { 'EXP 001': ['architecture'], 'EXP 002': ['architecture', 'gates'], 'EXP 005': ['gates'], 'EXP 010': ['gates'] },
    labs: { 'Lab 01': ['agents'] },
    notes: { gate: ['gates'], why: ['agents'] },
    tools: { witness: ['gates'] },
  },
  outcomes: {
    outcomes: { 'EXP 001': { outcome: 'supported', phrase: 'flagged the copy we broke on purpose' }, 'EXP 005': { outcome: 'refuted', phrase: 'the claim is refuted' } },
    withheld: { 'EXP 002': 'A reason it carries no outcome.' },
  },
  pages: new Set(['index.html', 'experiments/index.html', 'journal/gate.html', 'journal/why.html', 'labs/space/index.html', 'projects/witness/index.html']),
  fallbackDay: entry => (entry.id === 'EXP 010' ? '2026-10-10' : null),
});

test('metaDay reads the first day of an article-meta line', () => {
  assert.equal(metaDay('EXPERIMENT NOTE / 004 · EXP 007 · PRE-REGISTERED 30 SEP 2026 · MEASURED 7 OCT 2026'), '2026-09-30');
  assert.equal(metaDay('BUILD NOTE / 001 · 07 SEP 2026 · INTERNAL CASE STUDY'), '2026-09-07');
  assert.equal(metaDay('MEASURED 7 OCT 2026'), '2026-10-07');
  assert.equal(metaDay('NO DATE HERE'), null);
  assert.equal(metaDay(undefined), null);
});

test('experimentIds expands a range and refuses anything else', () => {
  assert.deepEqual(experimentIds('EXP 001–003'), ['EXP 001', 'EXP 002', 'EXP 003']);
  assert.deepEqual(experimentIds('EXP 005'), ['EXP 005']);
  assert.deepEqual(experimentIds(null), []);
  assert.deepEqual(experimentIds('Lab 01'), []);
});

test('hrefOnSite accepts a file or folder of the built site, with or without an anchor, and nothing off it', () => {
  const pages = new Set(['index.html', 'experiments/index.html', 'journal/a.html', 'data/x/preregistration.json']);
  for (const ok of ['index.html#all-experiments', 'experiments/#bench', 'experiments/', 'journal/a.html', 'data/x/preregistration.json']) assert.ok(hrefOnSite(ok, pages), ok);
  for (const bad of ['https://example.com/', '/journal/a.html', '../journal/a.html', 'journal/./a.html', 'journal/b.html', '#top', 'labs/', 'mailto:x@example.invalid']) assert.ok(!hrefOnSite(bad, pages), bad);
});

test('buildIndex places every source item once, with its topics, stage, outcome and date', () => {
  const items = buildIndex(fixture());
  for (const item of items) assert.deepEqual(validate(schema, item), [], `${item.id} matches the schema`);
  assert.deepEqual(items.map(i => i.id).sort(), ['exp-001', 'exp-002', 'exp-005', 'exp-010', 'lab-01', 'note-gate', 'note-why', 'tool-witness',
    'update-exp-001-002-recorded', 'update-exp-005-preregistration', 'update-exp-005-results', 'update-note-why', 'update-tool-witness']);
  const by = Object.fromEntries(items.map(i => [i.id, i]));
  assert.equal(by['exp-001'].outcome, 'supported');
  assert.equal(by['exp-001'].stage, 'recorded');
  assert.ok(!('outcome' in by['exp-002']), 'a withheld experiment carries no outcome');
  assert.equal(by['exp-005'].outcome, 'refuted');
  assert.equal(by['exp-005'].stage, 'results');
  assert.equal(by['exp-005'].date, '2026-09-29', 'an experiment is dated by its latest update');
  assert.equal(by['exp-010'].href, 'index.html#all-experiments', 'an off-site ledger link becomes its row on the home ledger');
  assert.equal(by['exp-010'].date, '2026-10-10', 'with no update and no note, the record dates it');
  assert.equal(by['update-exp-005-results'].outcome, 'refuted', 'a results update carries its experiment\'s outcome');
  assert.ok(!('outcome' in by['update-exp-005-preregistration']), 'a pre-registration update carries none');
  assert.deepEqual(by['update-exp-001-002-recorded'].topics, ['architecture', 'gates'], 'a range update takes every experiment\'s topics');
  assert.deepEqual(by['update-note-why'].topics, ['agents']);
  assert.deepEqual(by['update-tool-witness'].topics, ['gates']);
  const dates = items.map(i => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
});

test('buildIndex refuses what it cannot place', () => {
  const broken = (edit, re) => { const f = fixture(); edit(f); assert.throws(() => buildIndex(f), re); };
  broken(f => { delete f.topics.notes.why; }, /journal\/why\.html has no topics/);
  broken(f => { f.topics.labs['Lab 01'] = ['robots']; }, /names topic "robots"/);
  broken(f => { f.topics.notes.gone = ['gates']; }, /maps notes "gone", which the site does not publish/);
  broken(f => { f.outcomes.outcomes['EXP 005'].phrase = 'the claim is supported'; }, /phrase is not in its status/);
  broken(f => { f.outcomes.outcomes['EXP 010'] = { outcome: 'supported', phrase: 'published' }; }, /no published result/);
  broken(f => { f.outcomes.outcomes['EXP 005'].outcome = 'likely'; }, /is not supported, refuted or mixed/);
  broken(f => { f.outcomes.withheld['EXP 005'] = 'Both.'; }, /both given an outcome and withheld/);
  broken(f => { f.outcomes.outcomes['EXP 099'] = { outcome: 'mixed', phrase: 'x' }; }, /not on the experiment ledger/);
  broken(f => { f.pages.delete('journal/why.html'); }, /links journal\/why\.html, which is not a page/);
  broken(f => { f.fallbackDay = () => null; }, /exp-010 has no date/);
  broken(f => { f.tools.push({ ...f.tools[0] }); }, /tool-witness appears twice/);
  broken(f => { f.updates[1].kind = 'Rumour'; }, /maps to no index stage/);
});

test('the real index: every source item exactly once, schema-valid, unique ids, ISO dates, hrefs on the built site, deterministic', () => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  // Lab dates with no date of their own come from the real checkout's history: the build copy has one fresh commit.
  const items = loadIndex({ root, dist, gitRoot: REPO });
  for (const item of items) assert.deepEqual(validate(schema, item), [], `${item.id} matches the schema`);
  const ids = items.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const item of items) assert.ok(isoDay(item.date), `${item.id}: ${item.date} is a real day`);

  const files = new Set();
  const walk = at => { for (const e of readdirSync(at, { withFileTypes: true })) e.isDirectory() ? walk(join(at, e.name)) : files.add(join(at, e.name).slice(dist.length + 1)); };
  walk(dist);
  for (const item of items) assert.ok(hrefOnSite(item.href, files), `${item.id} links ${item.href}, a file of the built site`);

  const ofType = type => items.filter(i => i.type === type).map(i => i.id).sort();
  const json = path => JSON.parse(readFileSync(path, 'utf8'));
  const ledger = ledgerEntries(readFileSync(join(dist, 'index.html'), 'utf8'), json(join(dist, 'data/experiments.json')), dist);
  assert.deepEqual(ofType('experiment'), ledger.map(e => `exp-${e.id.slice(4)}`).sort(), 'one item per ledger entry');
  assert.equal(ofType('lab').length, 1 + TILE_FILES.length, 'Lab 01 and one item per lab tile');
  assert.deepEqual(ofType('note'), readdirSync(join(root, 'site/journal')).filter(n => n.endsWith('.html')).map(n => `note-${n.replace(/\.html$/, '')}`).sort(), 'one item per field note');
  assert.deepEqual(ofType('update'), json(join(root, 'site/data/updates.json')).updates.map(u => `update-${u.key}`).sort(), 'one item per update');
  assert.deepEqual(ofType('tool'), readdirSync(join(root, 'site/projects'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => `tool-${e.name}`).sort(), 'one item per tool');
  assert.equal(items.length, ledger.length + 1 + TILE_FILES.length + ofType('note').length + ofType('update').length + ofType('tool').length, 'nothing else');

  const updatesById = new Map(json(join(root, 'site/data/updates.json')).updates.map(u => [`update-${u.key}`, u]));
  for (const item of items.filter(i => i.type === 'update')) assert.equal(item.date, updatesById.get(item.id).date, `${item.id} keeps the feed's frozen date`);
  assert.equal(JSON.stringify(loadIndex({ root, dist, gitRoot: REPO })), JSON.stringify(items), 'a second run gives the same bytes');
});
