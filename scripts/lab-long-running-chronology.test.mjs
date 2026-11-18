import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderLabs } from './labs.mjs';

const read = path => JSON.parse(readFileSync(`site/${path}`, 'utf8'));
const pages = renderLabs();
const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const sourceDay = instant => instant.slice(0, 10);

function timeline(slug, dates) {
  const page = pages[`labs/${slug}/index.html`];
  assert.ok(page, `${slug} renders`);
  const section = page.match(/<section[^>]*id="timeline"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, `${slug} has a progression section`);
  const times = [...section.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">([^<]+)<\/time>/g)].map(([, date, text]) => [date, text]);
  assert.deepEqual(times, dates.map(date => [date, day(date)]), `${slug} uses its source dates`);
  assert.deepEqual(dates, [...dates].sort(), `${slug} milestones are ordered`);
  for (const [, href] of section.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith('#')) assert.ok(page.includes(`id="${href.slice(1)}"`), `${slug} resolves ${href}`);
    else if (href.startsWith('../../')) assert.ok(existsSync(resolve(`site/labs/${slug}`, href.split('#')[0])), `${slug} resolves ${href}`);
  }
  assert.match(section, /later (?:runs|check run)/i, `${slug} distinguishes record checks from source work`);
  return section;
}

test('Rogue progression binds staged runs, rebuild and second-machine check to its public record', () => {
  const record = read('data/labs/rogue/record.json');
  const section = timeline('rogue', [sourceDay(record.vendored.cites[0].at), sourceDay(record.vendored.cites[2].at), record.reproductions[0].on]);
  assert.equal(record.governed.acts.length, 4);
  assert.deepEqual([record.reproductions[0].breaches, record.reproductions[0].tests.passed], [0, 12]);
  assert.match(section, /staged attack/);
  assert.match(section, /not new attacks or outside validation/);
});

test('Review progression uses the dated public result updates and keeps the negative result', () => {
  const updates = read('data/updates.json').updates;
  const result = key => updates.find(item => item.key === key);
  const rows = ['exp-006-results', 'exp-012-results', 'exp-017-results'].map(result);
  assert.ok(rows.every(Boolean), 'all three source updates exist');
  const section = timeline('review', rows.map(row => row.date));
  for (const row of rows) assert.ok(section.includes(`href="../../${row.source}"`), `links ${row.key}'s public record`);
  assert.match(section, /href="\.\.\/\.\.\/journal\/nina-reviews-the-change\.html#amendment-01">EXP 006's pre-run amendment<\/a>/);
  assert.match(section, /href="\.\.\/\.\.\/data\/nina-changes\/results\.json">the result record<\/a> reports the counted runs and manipulation check/);
  assert.equal(read('data/labs/review/record.json').selfVerify.decision, 'no');
  assert.match(section, /did not bring false alarms below its pre-set bar/);
  assert.match(section, /not new reviewer trials/);
});

test('Red Build progression keeps the two sets separate and the held-out result negative', () => {
  const record = read('data/labs/red-build/record.json');
  const cites = record.vendored.cites;
  const section = timeline('red-build', [sourceDay(cites[2].at), sourceDay(cites[0].at), sourceDay(cites[1].at)]);
  assert.equal(record.heldOut.runs.length, 9);
  assert.equal(record.heldOut.score.judgedFix, 0);
  assert.match(section, /zero judged fixes/);
  assert.match(section, /not new repair attempts/);
});

test('Measured Blind progression retains its three sets and the known evaluation limits', () => {
  const record = read('data/labs/measured-blind/record.json');
  const cites = record.vendored.cites;
  const section = timeline('measured-blind', [sourceDay(cites[0].at), sourceDay(cites[2].at), sourceDay(cites[5].at)]);
  assert.equal(record.sets.length, 3);
  assert.match(record.setup.blinding, /partial/);
  assert.match(record.setup.restart, /runtime updated/);
  assert.match(section, /partial blinding/);
  assert.match(section, /not outside validation/);
});
