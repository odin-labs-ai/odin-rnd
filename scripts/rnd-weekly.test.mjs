import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { KINDS, formatWeek, inert, weekOf, yesterday } from './rnd-weekly.mjs';
import { KIND_ORDER } from './updates.mjs';

const feed = { updates: [
  { key: 'a', date: '2026-10-11', kind: 'Erratum', experiment: 'EXP 005', title: 'Jev as a fast gate', text: 'Erratum 01: the DOI link does not resolve.', href: 'journal/jev-as-a-fast-gate.html' },
  { key: 'b', date: '2026-10-05', kind: 'Results', experiment: 'EXP 009', title: 'Unload leaves no trace', text: 'P1 refuted @here *bold*.', href: 'journal/composable-harness-results.html' },
  { key: 'c', date: '2026-10-04', kind: 'Tool', experiment: null, title: 'Old', text: 'Older.', href: 'projects/ci-witness/' },
] };

test('the week is the seven days ending on the given day, inclusive', () => {
  const week = weekOf(feed, '2026-10-11');
  assert.equal(week.start, '2026-10-05');
  assert.deepEqual(week.entries.map(e => e.key), ['a', 'b']);
  assert.equal(yesterday(new Date('2026-10-12T06:30:00Z')), '2026-10-11');
});

test('the summary links absolute pages and keeps record text inert in Mattermost', () => {
  const text = formatWeek(weekOf(feed, '2026-10-11'));
  assert.match(text, /^#### R&D floor this week \(5 Oct 2026 to 11 Oct 2026\)/);
  assert.match(text, /\[EXP 005: Jev as a fast gate\]\(https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/journal\/jev-as-a-fast-gate\.html\)/);
  assert.ok(text.includes('P1 refuted @\u200Bhere \\*bold\\*\\.'), 'no mention or emphasis from record text');
  assert.match(text, /\[All updates\]\(https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/updates\/\)/);
});

test('an empty week still posts one plain line', () => {
  assert.match(formatWeek(weekOf(feed, '2026-01-01')), /Nothing new was published on the R&D floor this week\./);
});

test('without the webhook the scheduled run skips instead of failing', () => {
  const env = { ...process.env };
  delete env.ODIN_MM_RND_WEBHOOK_URL;
  const out = execFileSync(process.execPath, ['scripts/rnd-weekly.mjs'], { env, encoding: 'utf8' });
  assert.match(out, /not configured .* skipping/);
});

test('an escape or a line break in record text cannot re-arm markdown (refute pr39 r1 #1)', () => {
  assert.equal(inert('\\[click\\](https://example.invalid/)'), '\\\\\\[click\\\\\\]\\(https://example\\.invalid/\\)');
  assert.doesNotMatch(inert('Record title\n\n---\n\nInjected paragraph'), /\n/, 'no new block can start');
  assert.match(inert('1. item'), /^1\\\. item$/, 'no list marker');
  const text = formatWeek(weekOf({ updates: [{ key: 'x', date: '2026-10-11', kind: 'Tool', experiment: null, title: 'T', text: 'a\n\n---\n[x](https://evil.invalid)', href: 'journal/a (b).html' }] }, '2026-10-11'));
  assert.ok(!/\]\(https:\/\/evil/.test(text), 'no live link from text');
  assert.ok(text.includes('journal/a%20%28b%29.html'), 'a link target cannot close the markdown link');
});

test('a malformed webhook never reaches the log, whole or in part (refute pr39 r1 #2)', () => {
  for (const webhook of ['https://bad host/hooks/DEMO_SECRET_1', 'HTTPS://[invalid]/hooks/DEMO_SECRET_2']) {
    let stderr = '';
    try { execFileSync(process.execPath, ['scripts/rnd-weekly.mjs'], { env: { ...process.env, ODIN_MM_RND_WEBHOOK_URL: webhook, RND_WEEK_END: '2026-10-11' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { stderr = String(error.stderr); }
    assert.ok(stderr.length > 0, 'the run fails visibly');
    assert.doesNotMatch(stderr, /DEMO_SECRET|bad host|hooks/, `no part of ${webhook} is printed`);
  }
});

test('an unknown kind or a malformed date in the feed is refused, never posted (refute pr39 final #1)', () => {
  const bad = kind => formatWeek(weekOf({ updates: [{ key: 'x', date: '2026-10-11', kind, experiment: null, title: 'T', text: 't', href: 'updates/' }] }, '2026-10-11'));
  assert.throws(() => bad('Tool** @here [x](https://evil.invalid) **'), /Unknown update kind/);
  assert.throws(() => formatWeek({ start: '2026-10-05', end: '2026-10-11', entries: [{ key: 'x', date: '2026-10-11 @here', kind: 'Tool', experiment: null, title: 'T', text: 't', href: 'updates/' }] }), /no YYYY-MM-DD date/);
  assert.doesNotMatch(bad('Pre-registered'), /\*\*Pre-registered\*\*/, 'the kind is escaped too');
});

test('the weekly summary accepts exactly the kinds the feed generator writes', () => {
  assert.deepEqual(KINDS, KIND_ORDER);
});

test('no mention survives Mattermost removing markdown escapes first (refute pr39 final-2 #1)', () => {
  for (const raw of ['@here', '@channel', '@all', '\\@here', 'x@here', '@everyone please']) {
    const out = inert(raw).replace(/\\(.)/g, '$1');
    assert.doesNotMatch(out, /@(here|channel|all|everyone)\b/, `${raw} cannot mention once escapes are removed`);
  }
});
