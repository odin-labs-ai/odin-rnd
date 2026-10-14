import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatWeek, weekOf, yesterday } from './rnd-weekly.mjs';

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
  assert.ok(text.includes('P1 refuted \\@here \\*bold\\*.'), 'no mention or emphasis from record text');
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
