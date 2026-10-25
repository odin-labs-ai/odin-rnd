import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COPY, DELIVERY_FILE, aggregateProblems, aggregateWindow, deliveryProblems, leadText, readDelivery, renderAggregates, renderDelivery, renderedProblems, telemetryOf } from './lab-delivery.mjs';
import { renderLabs } from './labs.mjs';

// "How this site got built" (WO-NOTHEATRE-01/02). The committed record, the page rendered from it by the real build
// path (renderLabs), and the no-theatre gates: an element without a source, telemetry that is not the records' own,
// counts that do not reconcile, and text the publisher's screen refuses all fail the build.
const record = readDelivery();
const page = renderLabs()['labs/agent-space/index.html'];
const section = page.slice(page.indexOf('<div class="delivery" id="delivery">'), page.indexOf('id="follow"'));
const clone = () => JSON.parse(JSON.stringify(record));
// The window's size, in the words the page uses: the record grows with every merged PR, the facts below do not.
const W = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const w = n => W[n] ?? String(n);
const N = record.prs.length, TO = record.window.toPr;

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
  assert.deepEqual([...keys].sort(), ['at', 'attempt', 'id', 'kind', 'pr', 'ref', 'repo', 'reviewer', 'source', 'state', 'title', 'workflow']);
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

test('an aggregate field outside the allowlist, a percent above 100 or a repository under five PRs is refused', () => {
  const leak = clone();
  leak.aggregates = [{ label: 'repo-0123456789ab', prCount: 9, ciPassPercent: 90, reviewRounds: 12, medianMinutesToLand: 30, name: 'a private repo' }];
  assert.match(deliveryProblems(leak).join('\n'), /aggregates\/0\/name: not allowed/);
  const over = clone();
  over.aggregates = [{ label: 'repo-0123456789ab', prCount: 9, ciPassPercent: 101, reviewRounds: 12, medianMinutesToLand: 30 }];
  assert.match(deliveryProblems(over).join('\n'), /above 100/);
  const small = clone();
  small.aggregates = [{ label: 'repo-0123456789ab', prCount: 2, ciPassPercent: 100, reviewRounds: 1, medianMinutesToLand: 30 }];
  assert.ok(deliveryProblems(small).length > 0, 'a repository with fewer than five PRs is not published even as an aggregate');
});

test('the window holds every merged PR from #71 to its latest (at least #79), and #79 is the one without a recorded review round', () => {
  assert.ok(TO >= 79);
  assert.deepEqual(record.prs, Array.from({ length: TO - 70 }, (_, i) => 71 + i).filter(n => !record.window.otherNumbers.includes(n)));
  assert.deepEqual(record.prs.filter(pr => !record.records.some(r => r.pr === pr && r.kind === 'review')), [79], 'only #79 has no recorded review round');
  assert.equal(record.records.filter(r => r.pr === 79 && r.kind === 'review').length, 0);
});

test('every PR without a recorded review round says so, and no PR with one does', () => {
  const without = record.telemetry.perPr.filter(row => row.reviewRounds === 0).map(row => row.pr);
  assert.deepEqual(without, record.prs.filter(pr => !record.records.some(r => r.pr === pr && r.kind === 'review')));
  assert.ok(without.length >= 1, 'the record has a PR without a review round (#79)');
  for (const pr of record.prs) {
    const has = section.includes(`#${pr} has no recorded review round.`);
    assert.equal(has, without.includes(pr), `#${pr}: the no-review sentence appears exactly when it has no review round`);
  }
  const r78 = record.telemetry.perPr.find(row => row.pr === 78);
  assert.ok(section.includes(`#78 needed ${['', '', 'two', 'three', 'four', 'five', 'six', 'seven'][r78.reviewRounds]} review rounds before it shipped`));
  assert.equal(renderDelivery(record), section.slice(0, section.lastIndexOf('</div>') + 6));
  assert.deepEqual(telemetryOf(record), record.telemetry);
});

test('the lead is counted from the record, never a claim about every change', () => {
  const lead = leadText(record);
  assert.ok(section.includes(lead.replaceAll("'", '&#39;')) || section.includes(lead), 'the page shows the counted lead');
  assert.ok(lead.startsWith(`This site is built in the open, one pull request at a time. Of the ${w(N)} pull requests merged between #71 and #${TO} (every number in that range), ${w(N - 1)} went through at least one recorded automated review round before they were merged; one has no recorded review round; `), lead);
  const text = `${lead} ${Object.values(COPY).join(' ')}`;
  for (const universal of [/only then merged/i, /typed by hand\./i, /\bevery change is\b/i, /\bA change is read by an AI reviewer\b/]) assert.doesNotMatch(text, universal);
  assert.match(COPY.generated, /only the sentences around them are written by hand/);
  // With a review added to #79, the count moves: the sentence comes from the records, not from the page.
  const reviewed = clone();
  const land79 = reviewed.records.find(r => r.kind === 'landing' && r.pr === 79);
  reviewed.records.push({ id: 'pr-79/review/11111111-2222-4333-8444-555555555555', kind: 'review', pr: 79, at: '2026-10-25T07:10:00Z', repo: 'odin-labs-ai/odin-rnd', ref: land79.ref, state: 'SHIP', source: 'verdict-row:11111111-2222-4333-8444-555555555555', reviewer: 'automated' });
  assert.ok(leadText(reviewed).includes(`${w(N)} went through at least one recorded automated review round before they were merged; every one had CI`));
  // A review recorded only after the merge does not count as "before merge".
  const late = clone();
  late.records.push({ ...reviewed.records.at(-1), at: '2026-10-26T00:00:00Z' });
  assert.ok(leadText(late).includes(`, ${w(N - 1)} went through`));
});

test('a CI record\'s source is the attempt it names: /attempts/N equals its attempt field', () => {
  const changed = clone();
  const ci = changed.records.find(r => r.kind === 'ci' && r.attempt === 1);
  ci.attempt = 2;
  ci.id = ci.id.replace(/\/1$/, '/2');
  assert.match(deliveryProblems(changed).join('\n'), /source is attempt 1 of its run, not attempt 2/);
  assert.throws(() => renderWith(changed), /Delivery record refused/);
  for (const r of record.records.filter(r => r.kind === 'ci')) {
    assert.ok(r.source.endsWith(`/attempts/${r.attempt}`), r.id);
    assert.equal(r.id, `pr-${r.pr}/ci/${r.source.split('/runs/')[1].split('/')[0]}/${r.attempt}`);
  }
});

test('the window accounts for every number from #fromPr to #toPr: a merged PR or one of its other numbers, never a gap', () => {
  assert.deepEqual(record.window.otherNumbers, []);
  const gap = clone();
  gap.prs = gap.prs.filter(pr => pr !== 78);
  gap.records = gap.records.filter(r => r.pr !== 78);
  gap.telemetry = telemetryOf(gap);
  assert.match(deliveryProblems(gap).join('\n'), /#78 is inside the window but neither a merged PR in the record nor one of its other numbers/);
  assert.throws(() => renderWith(gap), /Delivery record refused/);
  // Declared as a number that is not a merged PR, the same record passes, and the lead says so.
  const declared = clone();
  Object.assign(declared, { prs: gap.prs, records: gap.records, telemetry: gap.telemetry });
  declared.window = { ...declared.window, otherNumbers: [78] };
  declared.generatedFrom = { ...declared.generatedFrom, window: { ...declared.window } };
  assert.deepEqual(deliveryProblems(declared), []);
  assert.ok(leadText(declared).includes(`Of the ${w(N - 1)} pull requests merged between #71 and #${TO} (the other one number in that range is an issue or a pull request that was not merged)`));
  const both = clone();
  both.window = { ...both.window, otherNumbers: [75] };
  both.generatedFrom = { ...both.generatedFrom, window: { ...both.window } };
  assert.match(deliveryProblems(both).join('\n'), /#75 is both a merged PR/);
  const outside = clone();
  outside.window = { ...outside.window, otherNumbers: [90] };
  outside.generatedFrom = { ...outside.generatedFrom, window: { ...outside.window } };
  assert.match(deliveryProblems(outside).join('\n'), /other number #90 is outside the window/);
});

test('"automated" review is said only when every counted round carries that reviewer kind', () => {
  assert.ok(record.records.filter(r => r.kind === 'review').every(r => r.reviewer === 'automated'));
  const mixed = clone();
  mixed.records.find(r => r.kind === 'review').reviewer = 'unrecorded';
  assert.deepEqual(deliveryProblems(mixed), []);
  assert.ok(leadText(mixed).includes(`${w(N - 1)} went through at least one recorded review round before`));
  assert.doesNotMatch(leadText(mixed), /automated|\bAI\b/);
  const missing = clone();
  delete missing.records.find(r => r.kind === 'review').reviewer;
  assert.ok(deliveryProblems(missing).length > 0, 'a review round without a reviewer kind is refused');
  const invented = clone();
  invented.records.find(r => r.kind === 'review').reviewer = 'human';
  assert.ok(deliveryProblems(invented).length > 0);
});

test('every CI and deploy link names what it opens; no two CI links share a name', () => {
  assert.doesNotMatch(section, /See the run|See the deploy/);
  const names = [];
  for (const r of record.records.filter(r => r.kind === 'ci' || r.kind === 'deploy')) {
    const name = r.kind === 'ci' ? `CI run ${r.source.split('/runs/')[1].split('/')[0]}, attempt ${r.attempt}` : `Pages deploy of ${r.ref.slice(0, 7)}`;
    assert.ok(section.includes(`href="${r.source}" data-source="${r.id}">${name}</a>`), r.id);
    names.push(name);
  }
  assert.equal(new Set(names).size, names.length, 'link names are distinct');
});

test('a PR reviewed only after it was merged says so, apart from "no recorded review round", in its sentence and the lead', () => {
  const late = clone();
  const land71 = late.records.find(r => r.kind === 'landing' && r.pr === 71).at;
  const after = new Date(Date.parse(land71) + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const r of late.records.filter(r => r.kind === 'review' && r.pr === 71)) r.at = after;
  assert.deepEqual(deliveryProblems(late), []);
  const page = renderWith(late)['labs/agent-space/index.html'];
  assert.ok(page.includes('#71 was reviewed only after it was merged: two review rounds, none before.'));
  assert.ok(!page.includes('#71 has no recorded review round.') && !page.includes('#71 needed'));
  assert.ok(page.includes('#79 has no recorded review round.'), 'zero records keeps its own sentence');
  assert.ok(leadText(late).includes(`, ${w(N - 2)} went through at least one recorded automated review round before they were merged; one was reviewed only after it was merged; one has no recorded review round; `));
  const mixed = clone();
  const second = mixed.records.filter(r => r.kind === 'review' && r.pr === 71)[1];
  second.at = after;
  const text = renderWith(mixed)['labs/agent-space/index.html'];
  assert.ok(text.includes('#71 had one review round before it was merged, and it sent the change back. One more review round came after it was merged.'));
});

test('a review row backs exactly one PR, and judged a head of that PR', () => {
  const reused = clone();
  const row71 = reused.records.find(r => r.kind === 'review' && r.pr === 71);
  const head72 = reused.records.find(r => r.kind === 'pr' && r.pr === 72).ref;
  reused.records.push({ ...row71, id: `pr-72/review/${row71.source.replace('verdict-row:', '')}`, pr: 72, ref: head72 });
  reused.telemetry = telemetryOf(reused);
  assert.match(deliveryProblems(reused).join('\n'), /review row verdict-row:[0-9a-f-]+ backs both pr-71\/review\/[0-9a-f-]+ and pr-72\/review\//);
  const foreign = clone();
  foreign.records.find(r => r.kind === 'review' && r.pr === 71).ref = head72;
  assert.match(deliveryProblems(foreign).join('\n'), /judged [0-9a-f]{40}, which is not a head of #71/);
  assert.throws(() => renderWith(foreign), /Delivery record refused/);
});

test('only a successful deploy is "published"; a failed one renders its real state and is not counted', () => {
  assert.ok(record.records.filter(r => r.kind === 'deploy').every(r => r.state === 'success'));
  assert.equal(record.telemetry.totals.deploys, record.records.filter(r => r.kind === 'deploy' && r.state === 'success').length);
  const failed = clone();
  const d79 = failed.records.find(r => r.kind === 'deploy' && r.pr === 79);
  d79.state = 'failure';
  failed.telemetry = telemetryOf(failed);
  assert.equal(failed.telemetry.totals.deploys, N - 1);
  const page = renderWith(failed)['labs/agent-space/index.html'];
  const li = page.slice(page.indexOf(`data-source="${d79.id}"`)).split('</li>')[0];
  assert.match(li, /Not published: the Pages deploy failed\./);
  assert.doesNotMatch(li, /Published to this site/);
  assert.ok(page.includes(`${w(N - 1)} deploys published to this site and one deploy that did not publish.`));
  const stale = clone();
  stale.records.find(r => r.kind === 'deploy' && r.pr === 79).state = 'cancelled';
  assert.match(deliveryProblems(stale).join('\n'), /telemetry: differs/, 'counting a cancelled deploy as published is refused');
  const wrongCommit = clone();
  wrongCommit.records.find(r => r.kind === 'deploy' && r.pr === 79).ref = wrongCommit.records.find(r => r.kind === 'landing' && r.pr === 78).ref;
  assert.match(deliveryProblems(wrongCommit).join('\n'), /is not of #79's merge commit/);
});

// "Beyond this site" (WO-NOTHEATRE-03b): the private repositories, anonymous.
const AGG = [
  { label: 'repo-0a1b2c3d4e5f', prCount: 12, ciPassPercent: 83, reviewRounds: 19, medianMinutesToLand: 47 },
  { label: 'repo-f0e1d2c3b4a5', prCount: 5, ciPassPercent: 100, reviewRounds: 6, medianMinutesToLand: 22 },
];
const withAgg = (aggregates = AGG) => { const r = clone(); r.aggregates = aggregates.map(a => ({ ...a })); return r; };
const panelOf = html => html.slice(html.indexOf('<div class="delivery-aggregates"'), html.indexOf('</div>', html.indexOf('<div class="delivery-aggregates"')) + 6);

test('the panel shows one row per aggregate with exactly its four figures, no link, under the timeline', () => {
  const html = renderDelivery(withAgg());
  const panel = panelOf(html);
  assert.ok(html.indexOf('delivery-aggregates') > html.indexOf('delivery-timeline'), 'the panel comes after the timeline');
  assert.match(panel, new RegExp(COPY.aggregatesTitle));
  for (const a of AGG) {
    const row = panel.match(new RegExp(`<tr data-aggregate="${a.label}">([\\s\\S]*?)</tr>`))[1];
    for (const k of ['prCount', 'ciPassPercent', 'reviewRounds', 'medianMinutesToLand']) assert.match(row, new RegExp(`data-figure="${k}">${a[k]}<`));
  }
  assert.doesNotMatch(panel, /<a\b/);
  assert.deepEqual(aggregateProblems(html, withAgg()), []);
  assert.deepEqual(renderedProblems(html, withAgg()), []);
  const { since, until } = aggregateWindow(record);
  assert.equal(since, record.records.filter(r => r.kind === 'pr').map(r => r.at).sort()[0]);
  assert.equal(until, record.generatedFrom.ghFetchedAt);
});

test('the panel is held to the record: a changed figure, a missing, extra or doubled row, or a link is refused', () => {
  const rec = withAgg(), html = renderDelivery(rec);
  assert.match(aggregateProblems(html.replace('data-figure="ciPassPercent">83<', 'data-figure="ciPassPercent">93<'), rec).join('\n'), /ciPassPercent shows 93, the record says 83/);
  const row = html.match(/<tr data-aggregate="repo-0a1b2c3d4e5f">[\s\S]*?<\/tr>/)[0];
  assert.match(aggregateProblems(html.replace(row, ''), rec).join('\n'), /rendered 0 times/);
  assert.match(aggregateProblems(html.replace(row, row + row), rec).join('\n'), /rendered 2 times/);
  assert.match(aggregateProblems(html.replace(row, row + row.replaceAll('repo-0a1b2c3d4e5f', 'repo-999999abcdef')), rec).join('\n'), /no such aggregate/);
  assert.match(aggregateProblems(html.replace('<h3>Beyond', '<h3><a href="https://example.com">x</a>Beyond'), rec).join('\n'), /links somewhere/);
  assert.match(aggregateProblems(html.replace('data-aggregate="repo-0a1b2c3d4e5f"', 'data-aggregate="secret-name"'), rec).join('\n'), /not an anonymous label/);
  assert.match(aggregateProblems(html.replace(/<div class="delivery-aggregates"[\s\S]*?<\/div>/, ''), rec).join('\n'), /panel is missing/);
});

test('with no aggregate the panel says so honestly, and still names its window', () => {
  const html = renderDelivery(withAgg([]));
  const panel = panelOf(html);
  assert.ok(panel.includes(COPY.aggregatesEmpty));
  assert.match(panel, /Window: /);
  assert.doesNotMatch(panel, /<table/);
  assert.match(aggregateProblems(html.replace(COPY.aggregatesEmpty, ''), withAgg([])).join('\n'), /does not say so/);
});

test('a label that is not repo- plus 12 hex is refused by the schema, and the panel copy passes the publisher\'s screen', () => {
  assert.match(deliveryProblems(withAgg([{ ...AGG[0], label: 'repo-odin-labs' }])).join('\n'), /aggregates\/0\/label/);
  assert.match(deliveryProblems(withAgg([{ ...AGG[0], label: 'odin-command-center' }])).join('\n'), /aggregates\/0\/label/);
  assert.deepEqual(deliveryProblems(withAgg()), []);
  assert.doesNotThrow(() => renderAggregates(withAgg()));
});

test('the committed record\'s aggregates, if any, render on the real page and reconcile', () => {
  assert.deepEqual(aggregateProblems(section, record), []);
  for (const a of record.aggregates) assert.match(a.label, /^repo-[0-9a-f]{12}$/);
});
