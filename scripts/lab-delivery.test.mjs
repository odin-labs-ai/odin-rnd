import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DELIVERY_FILE, deliveryProblems, readDelivery, renderDelivery, renderedProblems, telemetryOf } from './lab-delivery.mjs';
import { renderLabs } from './labs.mjs';

// "How this site got built" (WO-NOTHEATRE-01/02). The committed record, the page rendered from it by the real build
// path (renderLabs), and the no-theatre gates: an element without a source, telemetry that is not the records' own,
// counts that do not reconcile, and text the publisher's screen refuses all fail the build.
const record = readDelivery();
const page = renderLabs()['labs/agent-space/index.html'];
const section = page.slice(page.indexOf('<div class="delivery" id="delivery">'), page.indexOf('id="follow"'));
const clone = () => JSON.parse(JSON.stringify(record));

/** Render the Labs pages from a copy of site/ whose delivery record is `changed`. */
function renderWith(changed) {
  const root = mkdtempSync(join(tmpdir(), 'labs-delivery-'));
  try {
    for (const file of ['labs/index.html', 'labs/agent-space/index.html', 'data/labs/agent-space.json']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), readFileSync(join('site', file)));
    }
    mkdirSync(join(root, DELIVERY_FILE, '..'), { recursive: true });
    writeFileSync(join(root, DELIVERY_FILE), JSON.stringify(changed));
    return renderLabs(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// The figures, counted here by hand from the records, without telemetryOf.
function recount(rec) {
  const rows = {};
  for (const pr of rec.prs) rows[pr] = { reviewRounds: 0, fixNeededRounds: 0, runs: new Set(), ciReruns: 0, opened: null, landed: null };
  for (const r of rec.records) {
    const row = rows[r.pr];
    if (r.kind === 'review') { row.reviewRounds++; if (r.state === 'FIX-NEEDED') row.fixNeededRounds++; }
    if (r.kind === 'ci') { row.runs.add(r.source.split('/runs/')[1].split('/')[0]); if (r.attempt > 1) row.ciReruns++; }
    if (r.kind === 'pr') row.opened = r.at;
    if (r.kind === 'landing') row.landed = r.at;
  }
  return Object.fromEntries(Object.entries(rows).map(([pr, row]) => [pr, {
    reviewRounds: row.reviewRounds, fixNeededRounds: row.fixNeededRounds, ciRuns: row.runs.size, ciReruns: row.ciReruns,
    minutesToLand: Math.round((new Date(row.landed) - new Date(row.opened)) / 60000),
  }]));
}

test('the committed record passes its gate and covers #71 to #78 with every review round, verdict, head and CI conclusion', () => {
  assert.deepEqual(deliveryProblems(record), []);
  for (let pr = 71; pr <= 78; pr++) {
    assert.ok(record.prs.includes(pr), `#${pr} is in the record`);
    const reviews = record.records.filter(r => r.pr === pr && r.kind === 'review');
    assert.ok(reviews.length >= 1, `#${pr} has its review rounds`);
    for (const r of reviews) { assert.match(r.state, /^(SHIP|FIX-NEEDED)$/); assert.match(r.ref, /^[0-9a-f]{40}$/); }
    assert.ok(record.records.some(r => r.pr === pr && r.kind === 'ci' && r.state), `#${pr} has a CI conclusion`);
    assert.equal(record.records.filter(r => r.pr === pr && r.kind === 'landing').length, 1, `#${pr} landed once`);
  }
});

test('the record carries no review text, finding, branch, person or machine', () => {
  const text = readFileSync(join('site', DELIVERY_FILE), 'utf8');
  for (const leak of ['findings', 'summary', 'subjectCheckout', 'reviewerId', 'headBranch', 'driver', '/Users/', 'claimUrl', 'mergedBy']) {
    assert.ok(!text.includes(leak), `no ${leak}`);
  }
  const keys = new Set(record.records.flatMap(r => Object.keys(r)));
  assert.deepEqual([...keys].sort(), ['at', 'attempt', 'id', 'kind', 'pr', 'ref', 'repo', 'source', 'state', 'title', 'workflow']);
});

test('the page shows every PR of the record, each review round with its verdict, each linked to the real PR', () => {
  for (const pr of record.prs) {
    const block = section.slice(section.indexOf(`id="delivery-pr-${pr}"`));
    const article = block.slice(0, block.indexOf('</article>'));
    assert.ok(article.includes(`href="https://github.com/odin-labs-ai/odin-rnd/pull/${pr}" data-source="pr-${pr}"`), `#${pr} links to its PR`);
    const reviews = record.records.filter(r => r.pr === pr && r.kind === 'review');
    assert.equal((article.match(/class="delivery-event delivery-review/g) ?? []).length, reviews.length, `#${pr} shows every round`);
    for (const r of reviews) {
      assert.ok(article.includes(`data-source="${r.id}"`), r.id);
      assert.ok(article.includes(`(${r.state}) on version <a href="https://github.com/odin-labs-ai/odin-rnd/commit/${r.ref}"`), `${r.id} names its verdict and the head it judged`);
    }
  }
  assert.equal((section.match(/class="delivery-pr"/g) ?? []).length, record.prs.length, 'one block per PR, nothing else');
});

test('telemetry equals the figures recomputed from the records, in the record and on the page', () => {
  const counted = recount(record);
  for (const row of record.telemetry.perPr) {
    const { pr, ...figures } = row;
    assert.deepEqual(figures, counted[pr], `#${pr}`);
    const tr = section.slice(section.indexOf(`<tr data-source="pr-${pr}">`)).split('</tr>')[0];
    for (const [key, value] of Object.entries(figures)) assert.ok(tr.includes(`<td data-figure="${key}">${value}</td>`), `#${pr} ${key} on the page`);
  }
  const sum = key => Object.values(counted).reduce((n, row) => n + row[key], 0);
  assert.equal(record.telemetry.totals.reviewRounds, sum('reviewRounds'));
  assert.equal(record.telemetry.totals.ciReruns, sum('ciReruns'));
  assert.equal(record.telemetry.totals.prs, record.prs.length);
  assert.ok(section.includes(`<td data-total="reviewRounds">${sum('reviewRounds')}</td>`));
});

test('a telemetry figure that is not the records\' own fails the build', () => {
  const changed = clone();
  changed.telemetry.perPr[0].reviewRounds += 1;
  assert.match(deliveryProblems(changed).join('\n'), /telemetry: differs from the figures recomputed/);
  assert.throws(() => renderWith(changed), /Delivery record refused/);
  const total = clone();
  total.telemetry.totals.medianMinutesToLand += 1;
  assert.throws(() => renderWith(total), /telemetry: differs/);
});

test('a record without a resolvable source fails the build', () => {
  const missing = clone();
  delete missing.records.find(r => r.kind === 'ci').source;
  assert.throws(() => renderWith(missing), /Delivery record refused/);
  const elsewhere = clone();
  const pr = elsewhere.records.find(r => r.kind === 'pr');
  pr.source = 'https://example.com/pull/71';
  assert.ok(deliveryProblems(elsewhere).length > 0);
  const wrongPr = clone();
  wrongPr.records.find(r => r.kind === 'pr').source = 'https://github.com/odin-labs-ai/odin-rnd/pull/1';
  assert.match(deliveryProblems(wrongPr).join('\n'), /source is not pull request/);
  const wrongId = clone();
  wrongId.records.find(r => r.kind === 'review').id = 'pr-71/review/00000000-0000-0000-0000-000000000000';
  assert.match(deliveryProblems(wrongId).join('\n'), /does not follow from its fields/);
});

test('a rendered element without a source record, or a link that is not its record\'s, is refused', () => {
  assert.deepEqual(renderedProblems(section, record), []);
  const inject = (html, extra) => html.replace('<ol class="delivery-events">', `<ol class="delivery-events">${extra}`);
  assert.match(renderedProblems(inject(section, '<li class="delivery-event">Reviewed and approved</li>'), record).join('\n'), /no source record/);
  assert.match(renderedProblems(inject(section, '<li class="delivery-event" data-source="pr-71/review/made-up">x</li>'), record).join('\n'), /which is not a record/);
  assert.match(renderedProblems(inject(section, '<li data-source="pr-71"><a href="https://github.com/odin-labs-ai/odin-rnd/pull/72" data-source="pr-71">#72</a></li>'), record).join('\n'), /not its record/);
  assert.match(renderedProblems(section.replace('<tbody>', '<tbody><tr><th>#99</th><td>7</td></tr>'), record).join('\n'), /table row with no source/);
  assert.match(renderedProblems(section.replace('<svg class="delivery-chart"', '<svg class="delivery-chart"><rect x="0" y="0" width="9" height="9"/></svg><svg'), record).join('\n'), /rect.*no source record/);
});

test('counts reconcile with the record\'s own PR list', () => {
  const dropped = clone();
  dropped.prs = dropped.prs.filter(pr => pr !== 75);
  assert.match(deliveryProblems(dropped).join('\n'), /is for #75, which is not in the PR list/);
  const extra = clone();
  extra.prs.push(99);
  assert.match(deliveryProblems(extra).join('\n'), /#99 has 0 pr records/);
  const twice = clone();
  twice.records.push({ ...twice.records.find(r => r.kind === 'landing') });
  assert.match(deliveryProblems(twice).join('\n'), /duplicate id|has 2 landing records/);
  const cursor = clone();
  cursor.generatedFrom.latestPr = 70;
  assert.match(deliveryProblems(cursor).join('\n'), /generatedFrom does not match/);
});

test('free text runs through the publisher\'s screen; structured fields are held to their shape', () => {
  const email = clone();
  email.records.find(r => r.kind === 'pr').title = 'feat: mail someone@example.org about it';
  assert.match(deliveryProblems(email).join('\n'), /an email address/);
  const price = clone();
  price.records.find(r => r.kind === 'ci').workflow = 'Costs €40 a run';
  assert.match(deliveryProblems(price).join('\n'), /a price or currency amount/);
  const sha = clone();
  sha.records.find(r => r.kind === 'landing').ref = 'not-a-sha';
  assert.ok(deliveryProblems(sha).length > 0);
  const text = clone();
  text.records.find(r => r.kind === 'review').finding = 'the reviewer said the guard is fail-open';
  assert.ok(deliveryProblems(text).length > 0, 'a review record cannot carry review text');
});

test('aggregates are empty in this increment, and an aggregate field outside the allowlist is refused', () => {
  assert.deepEqual(record.aggregates, []);
  const leak = clone();
  leak.aggregates.push({ label: 'repo-0123456789ab', prCount: 9, ciPassPercent: 90, reviewRounds: 12, medianMinutesToLand: 30, name: 'a private repo' });
  assert.match(deliveryProblems(leak).join('\n'), /aggregates\/0\/name: not allowed/);
  const over = clone();
  over.aggregates.push({ label: 'repo-0123456789ab', prCount: 9, ciPassPercent: 101, reviewRounds: 12, medianMinutesToLand: 30 });
  assert.match(deliveryProblems(over).join('\n'), /above 100/);
  const small = clone();
  small.aggregates.push({ label: 'repo-0123456789ab', prCount: 2, ciPassPercent: 100, reviewRounds: 1, medianMinutesToLand: 30 });
  assert.ok(deliveryProblems(small).length > 0, 'a repository with fewer than five PRs is not published even as an aggregate');
});

test('the sentences are made from the record, never typed: #79 has no recorded review round', () => {
  const t = record.telemetry.perPr.find(row => row.pr === 79);
  if (t && t.reviewRounds === 0) assert.ok(section.includes('#79 has no recorded review round.'));
  const r78 = record.telemetry.perPr.find(row => row.pr === 78);
  assert.ok(section.includes(`#78 needed ${['', '', 'two', 'three', 'four', 'five', 'six', 'seven'][r78.reviewRounds]} review rounds before it shipped`));
  assert.equal(renderDelivery(record), section.slice(0, section.lastIndexOf('</div>') + 6));
  assert.deepEqual(telemetryOf(record), record.telemetry);
});
