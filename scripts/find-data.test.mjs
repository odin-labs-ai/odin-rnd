// The Find page's curated data (mission rnd-site-ux-nav-1101, WP0): the topic map (site/data/find-topics.json) and the
// outcomes (site/data/find-outcomes.json). The topic map must cover every experiment, lab, field note, tool and update
// the site publishes with known topic words; every outcome must quote its experiment's status sentence word for word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerEntries } from './experiment-ledger.mjs';
import { LAB_FILE } from './labs.mjs';
import { TILE_FILES } from './lab-tiles.mjs';
import { experimentIds, experimentIdsInData, hasPhrase } from './site-index.mjs';
import { builtCopy } from './test-build.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
const topics = json('site/data/find-topics.json');
const outcomes = json('site/data/find-outcomes.json');
const vocabulary = new Set(topics.topics.map(t => t.id));

/** Every experiment id the site's data publishes, read from site/ without a build, by the same reader the build uses
 *  to cross-check the home ledger (so the two can never drift). The built-site test below checks it against the ledger. */
const experimentIdsOnSite = () => experimentIdsInData('site');

test('the topic list is a small set of plain lower-case words, each with a label', () => {
  assert.equal(topics.format, 'odin-find-topics');
  assert.equal(topics.version, 1);
  const ids = topics.topics.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'no topic is listed twice');
  assert.ok(ids.length >= 5 && ids.length <= 20, `a small curated set (${ids.length})`);
  for (const { id, label } of topics.topics) {
    assert.match(id, /^[a-z]+$/, `${id} is one plain word`);
    assert.equal(label.toLowerCase(), id, `${id}'s label is the same word`);
  }
});

test('every mapped list names only known topic words, at least one, none twice, and every topic is used', () => {
  const used = new Set();
  for (const group of ['experiments', 'labs', 'notes', 'tools']) {
    for (const [key, list] of Object.entries(topics[group])) {
      assert.ok(Array.isArray(list) && list.length >= 1, `${group} ${key} has a topic`);
      assert.equal(new Set(list).size, list.length, `${group} ${key} names no topic twice`);
      for (const word of list) { assert.ok(vocabulary.has(word), `${group} ${key}: "${word}" is in the topic list`); used.add(word); }
    }
  }
  assert.deepEqual([...vocabulary].filter(word => !used.has(word)), [], 'no topic word is left unused');
});

test('the topic map covers exactly the experiments, labs, notes and tools the site publishes', () => {
  assert.deepEqual(Object.keys(topics.experiments).sort(), experimentIdsOnSite());
  const labs = [json(join('site', LAB_FILE)).label, ...TILE_FILES.map(file => json(join('site', file)).label)].sort();
  assert.deepEqual(Object.keys(topics.labs).sort(), labs);
  const notes = readdirSync('site/journal').filter(name => name.endsWith('.html')).map(name => name.replace(/\.html$/, '')).sort();
  assert.deepEqual(Object.keys(topics.notes).sort(), notes);
  const tools = readdirSync('site/projects', { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  assert.deepEqual(Object.keys(topics.tools).sort(), tools);
});

test('every update reaches at least one topic through its experiment, note or tool', () => {
  for (const u of json('site/data/updates.json').updates) {
    const ids = experimentIds(u.experiment);
    const note = /^journal\/([a-z0-9-]+)\.html(#.*)?$/.exec(u.href)?.[1];
    const tool = /^projects\/([a-z0-9-]+)\/$/.exec(u.href)?.[1];
    const list = ids.length ? ids.flatMap(id => topics.experiments[id] ?? []) : note ? topics.notes[note] : tool ? topics.tools[tool] : undefined;
    assert.ok(list && list.length >= 1, `update ${u.key} has a topic`);
  }
});

test('the outcomes file is curated: a known outcome and a phrase per experiment, or a reason it is withheld', () => {
  assert.equal(outcomes.format, 'odin-find-outcomes');
  assert.equal(outcomes.version, 1);
  for (const [id, entry] of Object.entries(outcomes.outcomes)) {
    assert.match(id, /^EXP \d{3}$/);
    assert.deepEqual(Object.keys(entry).sort(), ['outcome', 'phrase'], `${id} carries an outcome and its phrase, nothing else`);
    assert.match(entry.outcome, /^(supported|refuted|mixed)$/, `${id}'s outcome`);
    assert.ok(entry.phrase.trim().length >= 10, `${id}'s phrase is words, not a fragment`);
    assert.ok(!(id in outcomes.withheld), `${id} is not also withheld`);
  }
  for (const [id, reason] of Object.entries(outcomes.withheld)) {
    assert.match(id, /^EXP \d{3}$/);
    assert.ok(typeof reason === 'string' && reason.length >= 10, `${id} is withheld with a reason`);
  }
});

test('every outcome phrase appears word for word in its experiment\'s ledger status, and every published result is curated', () => {
  const root = builtCopy();
  const dist = join(root, 'dist');
  const entries = ledgerEntries(readFileSync(join(dist, 'index.html'), 'utf8'), json(join(dist, 'data/experiments.json')), dist);
  assert.deepEqual(entries.map(e => e.id).sort(), experimentIdsOnSite(), 'the ledger lists exactly the experiments the topic test reads from site/');
  const byId = new Map(entries.map(e => [e.id, e]));
  for (const [id, { phrase }] of Object.entries(outcomes.outcomes)) {
    const entry = byId.get(id);
    assert.ok(entry, `${id} is on the ledger`);
    assert.ok(hasPhrase(entry.status, phrase), `${id}'s phrase "${phrase}" is in its status "${entry.status}"`);
    assert.match(entry.stage, /^(Results published|Recorded|Measured)/, `${id} has a published result`);
  }
  for (const id of Object.keys(outcomes.withheld)) assert.ok(byId.has(id), `withheld ${id} is on the ledger`);
  const published = entries.filter(e => /^(Results published|Recorded|Measured)/.test(e.stage)).map(e => e.id);
  const curated = new Set([...Object.keys(outcomes.outcomes), ...Object.keys(outcomes.withheld)]);
  assert.deepEqual(published.filter(id => !curated.has(id)), [], 'every experiment with a published result has an outcome or a reason it has none');
});
