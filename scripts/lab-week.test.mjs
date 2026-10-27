import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readDelivery } from './lab-delivery.mjs';
import { readMilestones } from './lab-milestones.mjs';
import { readDispatches, renderLabs } from './labs.mjs';
import { renderWeek, weekOf, weekProblems, weekWindow } from './lab-week.mjs';
import { DRAFT_FILES, X_LIMIT, length, siteWeek, weekDrafts, weekUrl, writeWeekDrafts } from './lab-dispatch-drafts.mjs';

// "This week in Lab 01" (founder plan 7). It runs on the records this site publishes, at fixed build times, so the
// counts it checks are the ones recomputed here from the same records, independently of lab-week.mjs.
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'lab-dispatch-drafts.mjs');
const temp = mkdtempSync(join(tmpdir(), 'dg-lab-week-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const NOW = new Date('2026-10-26T06:17:00Z');
const QUIET = new Date('2027-01-10T06:17:00Z');
const delivery = readDelivery(), milestones = readMilestones('site', { now: NOW }), dispatches = readDispatches();
const week = (now = NOW) => weekOf({ delivery, milestones, dispatches, proofs: true, now });
const privateProject = String.fromCharCode(111, 97, 99);
const run = (...argv) => spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8' });

test('the window: seven UTC days ending on the build date, stated in words, a new year named', () => {
  assert.deepEqual(weekWindow(new Date('2026-11-01T06:17:00Z')), { from: '2026-10-26', to: '2026-11-01', now: '2026-11-01T06:17:00.000Z', label: '26 Oct to 1 Nov 2026' });
  assert.equal(weekWindow(new Date('2027-01-02T00:00:00Z')).label, '27 Dec 2026 to 2 Jan 2027');
  assert.throws(() => weekWindow(new Date('nope')), /not a build time/);
});

test('the counts are the records\' own, recomputed here, and nothing after the build is counted', () => {
  const w = week();
  const inside = iso => iso.slice(0, 10) >= '2026-10-20' && Date.parse(iso) <= NOW.getTime();
  const rows = delivery.records.filter(r => inside(r.at));
  assert.equal(w.counts.merged, rows.filter(r => r.kind === 'landing').length);
  assert.equal(w.counts.reviewRounds, rows.filter(r => r.kind === 'review').length);
  assert.equal(w.counts.sentBack, rows.filter(r => r.kind === 'review' && r.state === 'FIX-NEEDED').length);
  assert.equal(w.counts.deploys, rows.filter(r => r.kind === 'deploy' && r.state === 'success').length);
  for (const kind of ['beat', 'moment', 'correction']) assert.equal(w.counts[kind], milestones.records.filter(r => r.kind === kind && inside(r.at)).length);
  assert.equal(w.counts.sessions, dispatches.filter(d => d.date >= '2026-10-20' && d.date <= '2026-10-26').length);
  assert.ok(w.counts.merged > 0 && w.counts.beat > 0 && w.counts.sessions > 0, 'the published records do have a week here');
  // A build an hour before the build's last landing does not count it (the record refreshes weekly, so it can hold later ones).
  const last = delivery.records.filter(r => r.kind === 'landing' && Date.parse(r.at) <= NOW.getTime()).map(r => r.at).sort().at(-1);
  const before = week(new Date(Date.parse(last) - 3_600_000));
  assert.ok(before.merged.every(m => m.at <= new Date(Date.parse(last) - 3_600_000).toISOString()));
  assert.ok(before.counts.merged < w.counts.merged);
});

test('the section: every count checked, every line links its record, the window stated, the coverage said', () => {
  const w = week(), html = renderWeek(w);
  assert.deepEqual(weekProblems(html, w), []);
  assert.match(html, /20 OCT TO 26 OCT 2026/);
  assert.equal((html.match(/data-list="merged"/g) ?? []).length, w.counts.merged);
  for (const m of w.merged) assert.ok(html.includes(`<a href="https://github.com/odin-labs-ai/odin-rnd/pull/${m.pr}" data-source="pr-${m.pr}">`));
  for (const r of w.story) assert.ok(html.includes(`<a href="story/#${r.id}" data-source="milestone:${r.id}">`));
  // Read before the build, the record says when; read after it (a later refresh), nothing past the build is counted, so there is no note.
  // The wording is checked on a week whose record was read at 04:55 on the build day, whatever the committed record's read time.
  const early = { ...w, coverage: { ...w.coverage, delivery: '2026-10-26T04:55:12Z' } };
  assert.match(renderWeek(early), /The delivery record was read from GitHub on 26 Oct, 04:55 UTC; a pull request merged after that is not counted yet\./);
  assert.deepEqual(weekProblems(renderWeek(early), early), []);
  const read = w.coverage.delivery;
  if (read < w.window.now) assert.ok(html.includes(`The delivery record was read from GitHub on ${new Date(read).getUTCDate()} ${new Date(read).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}, ${read.slice(11, 16)} UTC; a pull request merged after that is not counted yet.`), read);
  else assert.doesNotMatch(html, /The delivery record was read from GitHub/);
  const page = renderLabs('site', { now: NOW })['labs/agent-space/index.html'];
  assert.ok(page.includes('id="this-week"') && page.includes(html), 'Lab 01 carries the section as rendered');
  // Every story anchor it links lands on the story page.
  const story = renderLabs('site', { now: NOW })['labs/agent-space/story/index.html'];
  for (const r of w.story) assert.ok(story.includes(` id="${r.id}"`), r.id);
});

test('a record at the build\'s own second counts, and a proof without the explorer links its session', () => {
  const last = delivery.records.filter(r => r.kind === 'landing').map(r => r.at).sort().at(-1);
  const at = new Date(Date.parse(last) + 500);
  assert.ok(week(at).merged.some(m => m.at === last), 'a record 500 ms before the build is in the window');
  const w = weekOf({ delivery, milestones, dispatches, proofs: false, now: NOW });
  assert.ok(w.proofs.length > 0);
  for (const p of w.proofs) assert.match(p.href, /^#session-/);
  assert.deepEqual(weekProblems(renderWeek(w), w), []);
});

test('an empty week says so, and still checks every count (as zero)', () => {
  const w = week(QUIET);
  assert.deepEqual(Object.values(w.counts), Array(Object.keys(w.counts).length).fill(0));
  const html = renderWeek(w);
  assert.match(html, /A quiet week: no record is dated 4 Jan to 10 Jan 2027\./);
  assert.match(html, /No pull request merged, no review round and no deploy is dated in this window\./);
  assert.doesNotMatch(html, /<details/);
  assert.deepEqual(weekProblems(html, w), []);
  assert.match(weekProblems(html.replace('<span data-count="merged" hidden>0</span>', ''), w).join(), /count merged shows undefined/);
});

test('the gates: a changed count, a moved or unknown link, a dropped line or a restricted word refuses the section', () => {
  const w = week(), html = renderWeek(w);
  assert.match(weekProblems(html.replace(`<span data-count="merged">${w.counts.merged}</span>`, `<span data-count="merged">${w.counts.merged + 1}</span>`), w).join(), /count merged shows \d+, the records say/);
  const [m] = w.merged;
  assert.match(weekProblems(html.replace(`href="https://github.com/odin-labs-ai/odin-rnd/pull/${m.pr}"`, 'href="https://github.com/odin-labs-ai/odin-rnd/pull/1"'), w).join(), /not its record's/);
  assert.match(weekProblems(`${html}<a href="#x" data-source="pr-1">x</a>`, w).join(), /names pr-1, which is not a record of this week/);
  assert.match(weekProblems(`${html}<a href="#x">x</a>`, w).join(), /a link with no source record/);
  assert.match(weekProblems(html.replace(/<li data-list="merged">[\s\S]*?<\/li>/, ''), w).join(), /the merged list shows \d+ lines, the count is/);
  // A record line whose link is taken off (the text kept) or pointed at another record's line is refused.
  const unlinked = html.replace(new RegExp(`<a href="[^"]*" data-source="${m.id}">(#${m.pr})</a>`), '$1');
  assert.notEqual(unlinked, html);
  assert.match(weekProblems(unlinked, w).join(), /the merged list, line 1: links nothing, not its record/);
  const [r1, r2] = w.story;
  const swapped = html.replace(`data-source="milestone:${r1.id}">`, `data-source="milestone:${r2.id}" data-x>`).replace(`href="${r1.href}"`, `href="${r2.href}"`);
  assert.match(weekProblems(swapped, w).join(), /the story list, line 1: links milestone:/);
  assert.match(weekProblems(`${html}<p>built on ${privateProject}</p>`, w).join(), /the rendered section: a restricted name/);
  const tainted = structuredClone(w); tainted.story[0].title = `A step on ${privateProject}`;
  assert.throws(() => renderWeek(tainted), /This week in Lab 01 refused[\s\S]*restricted name/);
});

test('--week drafts: five files, the banner, the week link, only the week\'s own words, every X part fits', () => {
  const out = join(temp, 'week-drafts');
  const cli = run('--week', '--out', out, '--now', NOW.toISOString());
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(readdirSync(out).sort(), [...DRAFT_FILES, 'preview.html'].sort());
  const w = siteWeek('site', NOW), url = weekUrl();
  assert.equal(url, 'https://odin-labs-ai.github.io/odin-rnd/labs/agent-space/#this-week');
  for (const file of [...DRAFT_FILES, 'preview.html']) {
    const text = readFileSync(join(out, file), 'utf8');
    assert.ok(text.includes(url), `${file} links the week`);
    assert.match(text, /DRAFT — the founder posts\. Nothing here is sent\./);
  }
  const linkedin = readFileSync(join(out, 'linkedin.md'), 'utf8');
  assert.ok(linkedin.includes(`This week in Lab 01, ${w.window.label}.`));
  // Every story line a draft carries is a record title in the week, word for word.
  const titles = new Set(w.story.map(r => r.title));
  for (const file of DRAFT_FILES) for (const m of readFileSync(join(out, file), 'utf8').matchAll(/^- (?:Step|Moment|Correction): (.+)$/gm)) assert.ok(titles.has(m[1]), `${file}: ${m[1]}`);
  for (const m of readFileSync(join(out, 'github-discussion.md'), 'utf8').matchAll(/^- #(\d+) (.+)$/gm)) assert.equal(w.merged.find(x => x.pr === Number(m[1]))?.title, m[2]);
  const { xParts } = weekDrafts(w);
  for (const part of xParts) assert.ok(length(part) <= X_LIMIT, part);
  assert.match(readFileSync(join(out, 'reddit.md'), 'utf8'), /## Title\n\nThis week in Lab 01, 20 Oct to 26 Oct 2026\n/);
});

test('--week drafts refuse: under site/, a week the page refuses, a problem only in the preview; nothing written', () => {
  // A site picked with --site is protected too, and so is the dist/ beside it.
  const other = join(temp, 'other-checkout', 'site');
  cpSync(join(here, '..', 'site', 'data'), join(other, 'data'), { recursive: true });
  for (const target of [join(other, 'drafts'), join(other, '..', 'dist', 'drafts')]) {
    assert.match(writeWeekDrafts(target, { site: other, now: NOW }).problems.join(), /drafts are never published/);
    assert.equal(existsSync(target), false);
  }
  const site = run('--week', '--out', join(here, '..', 'site', 'dg-week-should-not-exist'), '--now', NOW.toISOString());
  assert.equal(site.status, 1);
  assert.match(site.stderr, /drafts are never published/);
  assert.equal(existsSync(join(here, '..', 'site', 'dg-week-should-not-exist')), false);
  const tainted = structuredClone(siteWeek('site', NOW)); tainted.story[0].title = `A step on ${privateProject}`;
  assert.match(weekDrafts(tainted).problems.join(), /restricted name/);
  const out = join(temp, 'week-preview-refused');
  const result = writeWeekDrafts(out, { now: NOW, render: () => `<p>${weekUrl()} built on ${privateProject}</p>` });
  assert.match(result.problems.join(), /preview\.html: a restricted name/);
  assert.equal(existsSync(out), false);
  assert.equal(run('--week', '--out', out, '--now', 'yesterday').status, 3);
  assert.equal(run('--week', '--dispatch', 'x', '--out', out).status, 3);
});

test('--week drafts of an empty week say it was quiet, and carry no story line', () => {
  const { problems, files } = weekDrafts(week(QUIET));
  assert.deepEqual(problems, []);
  for (const file of DRAFT_FILES) {
    assert.match(files[file], /A quiet week: no record is dated 4 Jan to 10 Jan 2027\./);
    assert.doesNotMatch(files[file], /^- (?:Step|Moment|Correction):/m);
  }
});
