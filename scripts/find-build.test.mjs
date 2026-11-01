// The Find page's build step (scripts/find-build.mjs, mission rnd-site-ux-nav-1101 WP4), on fixtures: no build needed.
// The real build's output is checked in find-built.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIND_MARKER, indexJson, placeFindList, renderFindList, topicLabels } from './find-build.mjs';

const items = [
  { type: 'update', id: 'update-a', title: 'An update', date: '2026-10-30', stage: 'results', outcome: 'refuted', topics: ['gates'], summary: 's', href: 'updates/#a' },
  { type: 'experiment', id: 'exp-005', title: 'Gates & drift <fast>', date: '2026-09-29', stage: 'results', outcome: 'refuted', topics: ['gates'], summary: 's', href: 'journal/jev.html' },
  { type: 'note', id: 'note-why', title: 'Why we&rsquo;re open', date: '2026-09-01', stage: 'note', topics: ['agents'], summary: 's', href: 'journal/why.html' },
  { type: 'experiment', id: 'exp-006', title: 'Second', date: '2026-09-20', stage: 'pre-registered', topics: ['gates'], summary: 's', href: 'labs/x/' },
];

test('the static list groups by kind in a fixed order, keeps item order inside a group, and links from find/', () => {
  const html = renderFindList(items);
  assert.deepEqual([...html.matchAll(/<h2 id="find-([a-z]+)">([^<]+)<\/h2>/g)].map(m => [m[1], m[2]]), [['experiment', 'Experiments'], ['note', 'Field notes'], ['update', 'Updates']]);
  assert.deepEqual([...html.matchAll(/<a href="([^"]+)">/g)].map(m => m[1]), ['../journal/jev.html', '../labs/x/', '../journal/why.html', '../updates/#a']);
  assert.match(html, /<a href="\.\.\/journal\/jev\.html">Gates &amp; drift &lt;fast&gt;<\/a><span>Results, refuted <time datetime="2026-09-29">2026-09-29<\/time><\/span>/);
  assert.match(html, /Why we&rsquo;re open/, 'a character reference read from a page is kept');
  assert.match(html, /<span>Pre-registered <time/);
  assert.doesNotMatch(html, />s</, 'summaries stay out of the list');
});

test('an item of an unknown kind, or a page without exactly one marker, stops the build', () => {
  assert.throws(() => renderFindList([{ ...items[0], type: 'rumour' }]), /no group for/);
  assert.throws(() => placeFindList('<p>none</p>', items), /exactly once.*found 0/);
  assert.throws(() => placeFindList(FIND_MARKER + FIND_MARKER, items), /found 2/);
  assert.equal(placeFindList(`<div>${FIND_MARKER}</div>`, []), '<div></div>');
});

test('the index JSON carries the items and the topic labels', () => {
  const labels = topicLabels({ topics: [{ id: 'gates', label: 'Gates' }, { id: 'agents', label: 'Agents' }] });
  assert.deepEqual(labels, { gates: 'Gates', agents: 'Agents' });
  assert.deepEqual(JSON.parse(indexJson(items, labels)), { items, topics: labels });
  assert.throws(() => topicLabels({ topics: [{ id: 'gates' }] }), /needs a label/);
});
