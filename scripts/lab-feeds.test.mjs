import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedProblems, parseXml, readUpdates, renderFeed, renderFeeds, runEntryId, SITE_URL, updateEntryId } from './lab-feeds.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { recordHash } from './lab-record.mjs';
import { readLabRuns, runAnchor, withLabRuns } from './lab-runs.mjs';
import { renderRogue } from './lab-rogue.mjs';
import { renderLabs } from './labs.mjs';
import { renderMeasuredBlind } from './lab-measured-blind.mjs';

// The Atom feeds (scripts/lab-feeds.mjs): generated at build from the records, well-formed, with ids that never move.
const golden = JSON.parse(readFileSync('site/data/labs/rogue/record.json', 'utf8')).runs[0];
const tile = JSON.parse(readFileSync('site/data/labs/rogue-tile.json', 'utf8'));
const org = (() => { const r = { ...structuredClone(golden), runner: 'org-hosted', machineClass: 'org-ci-heavy', ranAt: '2026-10-27T20:00:00Z' }; return { ...r, recordHash: recordHash(r) }; })();
const lab = runs => [{ tile, href: 'data/labs/rogue/record.json', runs, page: 'labs/rogue/index.html' }];
const update = { key: 'exp-099-results', experiment: 'EXP 099', title: 'A question', kind: 'Results', text: 'It cost $1.20.', href: 'journal/x.html', source: 'data/rogue/results.json', date: '2026-10-26' };
const ids = xml => [...xml.matchAll(/<id>([^<]+)<\/id>/g)].map(m => m[1]);
const valid = (feeds) => { for (const [path, xml] of Object.entries(feeds)) assert.deepEqual(feedProblems(xml, { self: `${SITE_URL}${path}` }), [], path); };

test('the published feeds: the site feed and Lab 05\'s, valid Atom, every id unique, Lab 01\'s still valid, all screened', () => {
  const pages = renderLabs();
  const known = readLabRuns().flatMap(l => l.runs.flatMap(recordHashes));
  for (const path of ['feed.xml', 'labs/rogue/feed.xml', 'labs/agent-space/feed.xml']) {
    assert.ok(pages[path], path);
    assert.deepEqual(feedProblems(pages[path], { self: `${SITE_URL}${path}` }), [], path);
  }
  for (const path of ['feed.xml', 'labs/rogue/feed.xml']) assert.deepEqual(pageLeaks(pages[path], known), [], path);
  const site = pages['feed.xml'];
  assert.equal(ids(site).length, 1 + readUpdates().length + readLabRuns().reduce((n, l) => n + l.runs.length, 0), 'the feed, every update and every run');
  assert.ok(site.includes(`<id>${runEntryId(golden)}</id>`));
  assert.ok(site.includes(`<link rel="alternate" type="text/html" href="${SITE_URL}labs/runs/#${runAnchor(golden)}"/>`));
  // An update's entry carries its title and link, never its text.
  for (const u of readUpdates()) assert.ok(site.includes(`<id>${updateEntryId(u)}</id>`), u.key);
  assert.doesNotMatch(site, /<summary>[^<]*(cents|\$)/);
  // No lab without runs gets a feed: it would have no date of its own.
  assert.deepEqual(Object.keys(pages).filter(p => p.endsWith('feed.xml')).sort(), ['feed.xml', 'labs/agent-space/feed.xml', 'labs/rogue/feed.xml']);
  assert.doesNotMatch(site + pages['labs/rogue/feed.xml'], /org machine|daily/i);
});

test('the feeds are linked from the Labs index, the runs page and the page of every lab with runs', () => {
  const pages = renderLabs();
  const has = (page, href) => page.split('<link rel="alternate" type="application/atom+xml" title="').slice(1).some(l => l.split('>')[0].endsWith(`" href="${href}"`));
  assert.ok(has(pages['labs/index.html'], '../feed.xml'));
  assert.match(pages['labs/index.html'], /<a href="\.\.\/feed\.xml">Follow every update and every run \(Atom\)<\/a>/);
  assert.ok(has(pages['labs/runs/index.html'], '../../feed.xml'));
  assert.match(pages['labs/runs/index.html'], /<a href="\.\.\/\.\.\/feed\.xml">Follow every update and every run \(Atom\)<\/a>/);
  const rogue = pages['labs/rogue/index.html'];
  assert.ok(has(rogue, 'feed.xml') && has(rogue, '../../feed.xml'));
  assert.match(rogue, /<section class="company-section company-width lab-runs-section" id="lab-runs"[^>]*>.*<a href="feed\.xml">This lab's feed \(Atom\)<\/a>.*<a href="\.\.\/\.\.\/feed\.xml">The site feed \(Atom\)<\/a>.*<\/section><\/main>/s);
  assert.equal(rogue.split('id="lab-runs"').length, 2);
  assert.match(rogue, /data-state="laptop"><strong>Single machine, a laptop re-run\.<\/strong>/);
  // Every lab with runs links both feeds; a lab page without runs is left as its own renderer wrote it.
  for (const l of readLabRuns()) assert.ok(has(pages[l.page], 'feed.xml') && has(pages[l.page], '../../feed.xml'), l.page);
  assert.equal(pages['labs/measured-blind/index.html'], renderMeasuredBlind().pages['labs/measured-blind/index.html']);
});

test('ids never move: the same records give the same bytes, and a new run or update leaves every other entry as it was', () => {
  const before = renderFeeds(lab([golden]), [update], { anchor: runAnchor });
  assert.deepEqual(renderFeeds(lab([golden]), [update], { anchor: runAnchor }), before, 'deterministic: no wall clock');
  valid(before);
  const after = renderFeeds(lab([golden, org]), [update, { ...update, key: 'exp-099-amendment-01', date: '2026-10-27' }], { anchor: runAnchor });
  valid(after);
  for (const path of Object.keys(before)) {
    for (const id of ids(before[path])) assert.ok(ids(after[path]).includes(id), `${path}: ${id} stays`);
    const entry = xml => Object.fromEntries([...xml.matchAll(/<entry><id>([^<]+)<\/id>(.*?)<\/entry>/g)].map(m => [m[1], m[2]]));
    for (const [id, body] of Object.entries(entry(before[path]))) assert.equal(entry(after[path])[id], body, `${path}: ${id} unchanged`);
  }
  // The newest entry first, and the feed's updated is its date.
  assert.match(after['labs/rogue/feed.xml'], /<updated>2026-10-27T20:00:00Z<\/updated><link rel="self"/);
  assert.ok(after['feed.xml'].indexOf(runEntryId(org)) < after['feed.xml'].indexOf(runEntryId(golden)));
  // The lab feed holds the updates of its experiment (source under data/<experiment>/), the site feed all of them.
  assert.ok(after['labs/rogue/feed.xml'].includes(updateEntryId(update)));
  assert.ok(!renderFeeds(lab([golden]), [{ ...update, source: 'data/other/results.json' }], { anchor: runAnchor })['labs/rogue/feed.xml'].includes(updateEntryId(update)));
  assert.doesNotMatch(after['feed.xml'], /\$1\.20/, 'an update\'s text is not carried');
});

test('a feed with no entry is never written', () => {
  assert.throws(() => renderFeed({ id: 'tag:x.example,2026:f', title: 't', subtitle: 's', self: `${SITE_URL}f.xml`, alternate: SITE_URL, entries: [] }), /no date of its own/);
});

test('the reader refuses XML that is not well-formed', () => {
  const ok = renderFeeds(lab([golden]), [], { anchor: runAnchor })['labs/rogue/feed.xml'];
  assert.deepEqual(parseXml(ok).problems, []);
  const bad = {
    'no declaration': ok.replace(/^<\?xml[^>]*>\n/, ''),
    'an unclosed element': ok.replace('</feed>', ''),
    'a mismatched end tag': ok.replace('</title>', '</titel>'),
    'a raw ampersand': ok.replace('R&amp;D', 'R&D'),
    'an unknown entity': ok.replace('R&amp;D', 'R&nbsp;D'),
    'a raw < in text': ok.replace('Can an agent', 'Can < an agent'),
    'a single-quoted attribute': ok.replace('rel="self"', "rel='self'"),
    'a repeated attribute': ok.replace('rel="self"', 'rel="self" rel="self"'),
    'a second root': `${ok.trimEnd()}<feed/>\n`,
    'text after the root': `${ok.trimEnd()}x\n`,
    'a NUL reference': ok.replace('R&amp;D', 'R&#0;D'),
    'a control-character reference': ok.replace('R&amp;D', 'R&#x1b;D'),
    'a literal control character': ok.replace('R&amp;D', 'R\u0001D'),
    'a namespace reset on a child': ok.replace('<updated>', '<updated xmlns="">'),
    'a prefixed element': ok.replace('<author>', '<x:author xmlns:x="http://example.com/">').replace('</author>', '</x:author>'),
  };
  for (const [what, xml] of Object.entries(bad)) assert.ok(parseXml(xml).problems.length, what);
});

test('the Atom check refuses a feed whose ids, dates, links or order are wrong', () => {
  const self = `${SITE_URL}labs/rogue/feed.xml`;
  const two = renderFeeds(lab([golden, org]), [], { anchor: runAnchor })['labs/rogue/feed.xml'];
  assert.deepEqual(feedProblems(two, { self }), []);
  const refused = (xml, re) => assert.ok(feedProblems(xml, { self }).some(p => re.test(p)), `${re}: ${JSON.stringify(feedProblems(xml, { self }))}`);
  refused(two.replace(runEntryId(golden), runEntryId(org)), /an id appears twice/);
  refused(two.replace(`<id>${runEntryId(golden)}</id>`, '<id>run 1</id>'), /not a tag: or https: URI/);
  refused(two.replace('<updated>2026-10-27T11:25:33Z</updated>', '<updated>27 Oct 2026</updated>'), /not an RFC 3339 UTC time/);
  refused(two.replace('<updated>2026-10-27T20:00:00Z</updated><link rel="self"', '<updated>2026-10-26T00:00:00Z</updated><link rel="self"'), /is not its newest entry's/);
  refused(two.replace(/<entry>(.*?)<\/entry><entry>(.*?)<\/entry>/, '<entry>$2</entry><entry>$1</entry>'), /newer than the entry before it/);
  refused(two.replace('href="https://odin-labs-ai.github.io/odin-rnd/labs/rogue/feed.xml"', 'href="https://odin-labs-ai.github.io/odin-rnd/feed.xml"'), /self link is not this feed's own URL/);
  refused(two.replace(/<link rel="alternate" type="text\/html" href="[^"]+#run-[^"]+"\/>/, ''), /has no alternate link/);
  refused(two.replace('</title><updated>2026-10-27T20', '</title><title>again</title><updated>2026-10-27T20'), /has 2 <title>, not one/);
  refused(two.replace('xmlns="http://www.w3.org/2005/Atom"', ''), /not an Atom <feed>/);
  refused(two.replace('<updated>2026-10-27T11:25:33Z</updated>', '<updated>2026-02-30T00:00:00Z</updated>'), /not an RFC 3339 UTC time/);
  refused(two.replace('<updated>2026-10-27T11:25:33Z</updated>', '<updated>2026-10-27T24:00:00Z</updated>'), /not an RFC 3339 UTC time/);
});

test('an update with an impossible date is refused before any feed is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-feeds-'));
  try {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data/updates.json'), JSON.stringify({ schemaVersion: 1, updates: [{ ...update, date: '2026-02-30' }] }));
    assert.throws(() => readUpdates(root), /date: not a real date/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a lab\'s runs feed never replaces a feed already rendered at its path', () => {
  const pages = renderLabs();
  const index = pages['labs/index.html'].replace(/<div class="lab-provenance [^]*?<\/div>(?=<ul class="lab-tile-links">)/, '').replace(/<p class="lab-runs-link">[^]*?<\/p>/g, '').replace(/\n *<link rel="(stylesheet" href="\.\.\/assets\/lab-runs\.css|alternate" type="application\/atom\+xml" title="Odin Labs R&amp;D[^"]*" href="\.\.\/feed\.xml)">/g, '');
  assert.throws(() => withLabRuns({ 'labs/index.html': index, 'labs/rogue/index.html': renderRogue().pages['labs/rogue/index.html'], 'labs/rogue/feed.xml': '<?xml version="1.0" encoding="utf-8"?>\n<feed/>\n' }), /labs\/rogue\/feed\.xml is already rendered/);
});
