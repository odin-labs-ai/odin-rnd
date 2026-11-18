import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLabs } from './labs.mjs';

const read = name => JSON.parse(readFileSync(`site/data/failover/${name}.json`, 'utf8'));
const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

test('Lab 03 chronology uses the published record dates and keeps its open limits', () => {
  const plan = read('preregistration');
  const first = read('amendment-01');
  const second = read('amendment-02');
  const completed = read('amendment-03');
  const result = read('results');
  assert.equal(first.authoredOn, plan.experiment.authoredOn, 'the plan and runner protocol share a day');
  assert.equal(completed.authoredOn, result.date, 'the completion amendment and result share a day');

  const page = renderLabs()['labs/failover/index.html'];
  const timeline = page.match(/<section[^>]*id="timeline"[\s\S]*?<\/section>/)?.[0];
  assert.ok(timeline, 'the detail page has a dated lab history');
  const times = [...timeline.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">([^<]+)<\/time>/g)].map(([, date, text]) => [date, text]);
  const dates = [plan.experiment.authoredOn, second.authoredOn, result.date];
  assert.deepEqual(times, dates.map(date => [date, day(date)]), 'all displayed dates follow the source records');
  assert.deepEqual(dates, [...dates].sort(), 'the milestones stay in chronological order');
  for (const href of ['#plan', '../../data/failover/amendment-01.json', '../../data/failover/amendment-02.json', '../../data/failover/amendment-03.json', '../../journal/failover-results.html']) {
    assert.ok(timeline.includes(`href="${href}"`), `the milestone links ${href}`);
  }
  assert.match(result.summary, /No overall winner/);
  assert.match(result.summary, /Strict-ack and disturbance uncertainties remain/);
  assert.match(timeline, /reports no overall winner; strict acknowledgements and a disturbance window remain unresolved/);
  assert.match(timeline, /one experiment on one host/);
});
