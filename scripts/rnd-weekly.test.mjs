import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { KINDS, absolute, formatWeek, inert, isCalendarDay, weekOf, yesterday } from './rnd-weekly.mjs';
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
  assert.match(text, /\[`EXP 005: Jev as a fast gate`\]\(https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/journal\/jev-as-a-fast-gate\.html\)/);
  assert.ok(text.includes('`P1 refuted @here *bold*.`'), 'record text goes out as an inline code span: no mention, emphasis or entity is processed');
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

test('record text is one inline code span: a backtick or line break cannot end it (refute pr39 r1 #1, final-2, final-3)', () => {
  assert.equal(inert('\\[click\\](https://example.invalid/)'), '`\\[click\\](https://example.invalid/)`');
  assert.equal(inert('Record title\n\n---\n\nInjected paragraph'), '`Record title --- Injected paragraph`', 'no new block can start');
  assert.equal(inert('a ` b `` c'), "`a ' b '' c`", 'a backtick cannot close the span');
  assert.equal(inert(''), '` `', 'an empty value still renders as an empty span');
  const text = formatWeek(weekOf({ updates: [{ key: 'x', date: '2026-10-11', kind: 'Tool', experiment: null, title: 'T', text: 'a\n\n---\n[x](https://evil.invalid)', href: 'journal/a (b).html' }] }, '2026-10-11'));
  assert.ok(text.includes('`a --- [x](https://evil.invalid)`'), 'a link in record text stays literal code');
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
  assert.match(bad('Pre-registered'), /- \*\*Pre-registered\*\* · /, 'a kind from the closed list renders as plain bold');
});

test('the weekly summary accepts exactly the kinds the feed generator writes', () => {
  assert.deepEqual(KINDS, KIND_ORDER);
});

test('no mention or entity in record text can leave its code span (refute pr39 final-2 #1, final-3 #1)', () => {
  for (const raw of ['@here', '@channel', '@all', '\\@here', '&commat;here', '&#64;here', '&#x40;channel', 'x`@here`y', '@everyone\n\n@here']) {
    const span = inert(raw);
    assert.match(span, /^`[^`]*`$/, `${raw} stays inside exactly one code span`);
  }
});

test('an impossible week end is refused instead of shifting the window (refute pr39 final-4 #1)', () => {
  assert.equal(isCalendarDay('2026-02-28'), true);
  assert.equal(isCalendarDay('2028-02-29'), true);
  for (const day of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1']) assert.equal(isCalendarDay(day), false, day);
  assert.throws(() => weekOf(feed, '2026-02-30'), /real calendar day/);
  assert.throws(() => execFileSync(process.execPath, ['scripts/rnd-weekly.mjs', '--dry-run'], { env: { ...process.env, RND_WEEK_END: '2026-02-30' }, stdio: 'pipe' }));
});

test('a feed link must stay inside the R&D site, or the summary is refused (refute pr39 final-5 #1)', () => {
  assert.equal(absolute('journal/x.html'), 'https://odin-labs-ai.github.io/odin-rnd/journal/x.html');
  assert.equal(absolute('#bench'), 'https://odin-labs-ai.github.io/odin-rnd/#bench');
  for (const href of ['//evil.invalid/credential-check', 'https://evil.invalid/', 'javascript:alert(1)', '../../other-repo/', 'https://odin-labs-ai.github.io/other/', 'https://user:pw@odin-labs-ai.github.io/odin-rnd/']) {
    assert.throws(() => absolute(href), /outside the R&D site/, href);
  }
  assert.throws(() => formatWeek(weekOf({ updates: [{ key: 'x', date: '2026-10-11', kind: 'Tool', experiment: null, title: 'T', text: 't', href: '//evil.invalid/' }] }, '2026-10-11')), /outside the R&D site/);
});
