// "This week in Lab 01" (mission rnd-labs-human-first-1024, founder plan 7): a weekly rhythm where the work is the
// content. scripts/labs.mjs fills <!--LAB_WEEK--> on Lab 01 with renderWeek(), built when the site builds from records
// this site already publishes, never typed:
//   - the delivery record (scripts/lab-delivery.mjs): pull requests merged, review rounds and published deploys;
//   - the milestones record (scripts/lab-milestones.mjs): steps, moments and corrections;
//   - the dispatches (scripts/labs.mjs readDispatches): new sessions, and the proof cards they show.
// The window is the seven UTC days ending on the build's date ("20 Oct to 26 Oct 2026"): the site rebuilds every Monday
// (.github/workflows/publish.yml), so consecutive weekly builds cover consecutive weeks, and a week with nothing dated
// in it says so. Where a record was last produced before the window ends, the section says when, so a quiet record is
// never read as a quiet lab.
// The build fails, and nothing is rendered, when:
//   - a count shown is not the one recomputed from the records (every count carries data-count, re-read and compared);
//   - a link names no record in the inputs, or links anywhere but that record's own place (every link carries
//     data-source: a PR's public URL, a story entry, a session anchor, a proof card, or the section that itemises it);
//   - a list shows a different number of lines than its count;
//   - any string of the week, or any visible text of the rendered section, fails the publisher's screen.
// This module takes the records as arguments and imports neither scripts/labs.mjs nor the drafts generator, which both
// import it. scripts/lab-dispatch-drafts.mjs --week writes the per-channel drafts from the same weekOf() and renderWeek().
import { screenHits, screenTree } from './lab-dispatch-publish.mjs';
import { recordLink } from './lab-delivery.mjs';
import { proofAnchor } from './lab-proofs.mjs';

export const WEEK_ANCHOR = 'this-week';
export const WEEK_DAYS = 7;
const DAY = 86_400_000;
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = date => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
const stamp = iso => { const d = new Date(iso); return `${day(d)}, ${iso.slice(11, 16)} UTC`; };
const dayOf = iso => iso.slice(0, 10);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** What a reader of an HTML page sees: no style or script, no tags or comments, entities decoded. */
export const visibleText = html => html.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => name[0] === '#' ? String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : ENTITIES[name.toLowerCase()] ?? all);

/** The window: the seven UTC days ending on `now`'s date, and nothing after `now`. */
export function weekWindow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error(`not a build time: ${now}`);
  const to = dayOf(now.toISOString()), from = dayOf(new Date(Date.parse(`${to}T00:00:00Z`) - (WEEK_DAYS - 1) * DAY).toISOString());
  const fromDate = new Date(`${from}T00:00:00Z`);
  const label = `${day(fromDate)}${fromDate.getUTCFullYear() !== now.getUTCFullYear() ? ` ${fromDate.getUTCFullYear()}` : ''} to ${day(now)} ${now.getUTCFullYear()}`;
  return { from, to, now: now.toISOString(), label };
}

// A date (a dispatch's) is in the window when its day is; a time (a record's) also must not be after the build,
// compared as instants (a record's "…:00Z" and the build's "…:00.500Z" do not order as strings).
const inWindow = (iso, window) => dayOf(iso) >= window.from && dayOf(iso) <= window.to && (iso.length === 10 || Date.parse(iso) <= Date.parse(window.now));

/**
 * The week, from the records alone. `delivery` is the checked delivery record, `milestones` the checked milestones
 * record or null, `dispatches` the checked dispatches, `proofs` whether the proof-card explorer is published.
 */
export function weekOf({ delivery, milestones = null, dispatches = [], proofs = false, now = new Date() }) {
  const window = weekWindow(now);
  const rows = delivery.records.filter(r => inWindow(r.at, window));
  const landed = rows.filter(r => r.kind === 'landing').sort((a, b) => b.at.localeCompare(a.at));
  const merged = landed.map(l => { const pr = delivery.records.find(r => r.kind === 'pr' && r.pr === l.pr); return { id: pr.id, pr: pr.pr, title: pr.title, at: l.at, href: recordLink(pr) }; });
  const reviews = rows.filter(r => r.kind === 'review');
  const deploys = rows.filter(r => r.kind === 'deploy' && r.state === 'success');
  const story = milestones ? milestones.records.filter(r => inWindow(r.at, window)).sort((a, b) => b.at.localeCompare(a.at))
    .map(r => ({ id: r.id, kind: r.kind, title: r.title, at: r.at, href: `story/#${r.id}` })) : [];
  const sessions = dispatches.filter(d => inWindow(d.date, window)).sort((a, b) => b.date.localeCompare(a.date) || b.session.localeCompare(a.session));
  const proofIds = [...new Set(sessions.flatMap(d => d.questions.map(q => q.evidence)))];
  return {
    window,
    coverage: { delivery: delivery.generatedFrom.ghFetchedAt, milestones: milestones?.window.to ?? null },
    // "automated" only when every counted round says so, as the delivery section words it.
    automated: reviews.length > 0 && reviews.every(r => r.reviewer === 'automated'),
    merged,
    counts: {
      merged: merged.length, reviewRounds: reviews.length, sentBack: reviews.filter(r => r.state === 'FIX-NEEDED').length, deploys: deploys.length,
      beat: story.filter(r => r.kind === 'beat').length, moment: story.filter(r => r.kind === 'moment').length, correction: story.filter(r => r.kind === 'correction').length,
      sessions: sessions.length, proofs: proofIds.length,
    },
    story,
    sessions: sessions.map(d => ({ session: d.session, date: d.date, questions: d.questions.length, href: `#${d.session}` })),
    // A proof links to its card in the explorer, or, while the explorer is not published, to the session that shows it.
    proofs: proofIds.map(id => ({ id, href: proofs ? `proofs/#${proofAnchor(id)}` : `#${sessions.find(d => d.questions.some(q => q.evidence === id)).session}` })),
  };
}

const KIND = { beat: 'Step', moment: 'Moment', correction: 'Correction' };

/**
 * The plain sentences the section and the drafts share, from the week's own counts. `num(key, value)` writes each
 * count: as plain digits for the drafts, as a checked <span data-count> on the page. An empty line names its counts
 * through `zero(keys)` instead (nothing on the drafts, hidden zeros on the page), so every count is always checked.
 */
export function weekSentences(week, { num = (key, value) => String(value), zero = () => '' } = {}) {
  const c = week.counts;
  const n = (key, one, many = `${one}s`) => `${num(key, c[key])} ${c[key] === 1 ? one : many}`;
  const delivery = c.merged || c.reviewRounds || c.deploys
    ? `${n('merged', 'pull request')} merged, ${n('reviewRounds', `${week.automated ? 'automated ' : ''}review round`)} (${num('sentBack', c.sentBack)} sent the change back) and ${n('deploys', 'deploy')} published to this site.`
    : `No pull request merged, no review round and no deploy is dated in this window.${zero(['merged', 'reviewRounds', 'sentBack', 'deploys'])}`;
  const story = c.beat + c.moment + c.correction
    ? `In the story: ${n('beat', 'step')}, ${n('moment', 'moment')} and ${n('correction', 'correction')}.`
    : `No step, moment or correction of the story is dated in this window.${zero(['beat', 'moment', 'correction'])}`;
  const sessions = c.sessions
    ? `${n('sessions', 'new session')}, showing ${n('proofs', 'proof card')}.`
    : `No new session is dated in this window.${zero(['sessions', 'proofs'])}`;
  const quiet = !(c.merged || c.reviewRounds || c.deploys || c.beat || c.moment || c.correction || c.sessions);
  return { delivery, story, sessions, quiet: quiet ? `A quiet week: no record is dated ${week.window.label}.` : null };
}

/** When a record was last produced before the window's end, in words. */
export function coverageNotes(week) {
  const notes = [];
  if (week.coverage.delivery < week.window.now) notes.push(`The delivery record was read from GitHub on ${stamp(week.coverage.delivery)}; a pull request merged after that is not counted yet.`);
  if (!week.coverage.milestones) notes.push('No story record is published yet.');
  else if (week.coverage.milestones < week.window.now) notes.push(`The story record runs to ${stamp(week.coverage.milestones)}.`);
  return notes;
}

const count = (key, value) => `<span data-count="${key}">${value}</span>`;
const zeros = keys => keys.map(key => `<span data-count="${key}" hidden>0</span>`).join('');
const link = (source, href, body) => `<a href="${escape(href)}" data-source="${escape(source)}">${body}</a>`;
const group = (title, items) => items.length ? `<details class="week-list"><summary>${escape(title)}</summary><ul>${items.join('')}</ul></details>` : '';
const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The section body. Throws, listing every reason, when a count, a link or a word does not hold (weekProblems). */
export function renderWeek(week) {
  const s = weekSentences(week), c = week.counts;
  const textProblems = screenTree({ sentences: s, notes: coverageNotes(week), label: week.window.label, merged: week.merged.map(m => m.title), story: week.story.map(r => r.title) }, 'lab-week text');
  if (textProblems.length) throw new Error(`This week in Lab 01 refused:\n  ${textProblems.join('\n  ')}`);
  // The sentences hold only fixed words and counts, so escaping them whole is safe; the counts become checked spans.
  const lines = weekSentences({ ...week, window: { ...week.window, label: escape(week.window.label) } }, { num: count, zero: zeros });
  const deliveryLine = c.merged || c.reviewRounds || c.deploys ? `${lines.delivery} ${link('section:built', '#built', 'Every round, run and deploy')}.` : lines.delivery;
  const storyLine = lines.story, sessionLine = lines.sessions;
  const lists = [
    group(`The ${n(c.merged, 'pull request')} merged`, week.merged.map(m => `<li data-list="merged">${link(m.id, m.href, `#${m.pr}`)} ${escape(m.title)} <span class="week-when">${escape(stamp(m.at))}</span></li>`)),
    group(`The ${n(week.story.length, 'story entry', 'story entries')}`, week.story.map(r => `<li data-list="story"><span class="week-kind">${KIND[r.kind]}</span> ${link(`milestone:${r.id}`, r.href, escape(r.title))} <span class="week-when">${escape(stamp(r.at))}</span></li>`)),
    group(`The ${n(c.sessions, 'session')}`, week.sessions.map(d => `<li data-list="sessions">${link(`dispatch:${d.session}`, d.href, `Session of ${escape(d.date)}`)}: ${n(d.questions, 'question')}</li>`)),
    group(`The ${n(c.proofs, 'proof card')}`, week.proofs.map(p => `<li data-list="proofs">${link(`proof:${p.id}`, p.href, `<code>${escape(p.id)}</code>`)}</li>`)),
  ].join('');
  const html = `<div class="week" id="week-body"><p class="week-window technical" data-window="${escape(week.window.from)}/${escape(week.window.to)}">${escape(week.window.label.toUpperCase())}</p>`
    + (s.quiet ? `<p class="week-quiet">${escape(s.quiet)}</p>` : '')
    + `<ul class="week-lines"><li>${deliveryLine}</li><li>${storyLine}</li><li>${sessionLine}</li></ul>${lists}`
    + coverageNotes(week).map(note => `<p class="week-note">${escape(note)}</p>`).join('')
    + `<p class="week-how">Built when the site builds, from the delivery record, the story record and the dispatches: every line links its record, and the counts are recomputed from them.</p></div>`;
  const problems = weekProblems(html, week);
  if (problems.length) throw new Error(`This week in Lab 01 refused:\n  ${problems.join('\n  ')}`);
  return html;
}

/** Every way the rendered section differs from the week: a count, a link, a list's length, the screen. */
export function weekProblems(html, week) {
  const problems = [];
  const shown = {};
  for (const m of html.matchAll(/<span data-count="(\w+)"(?: hidden)?>(\d+)<\/span>/g)) {
    if (m[1] in shown) problems.push(`count ${m[1]} is shown twice`);
    shown[m[1]] = Number(m[2]);
  }
  for (const [key, value] of Object.entries(week.counts)) if (shown[key] !== value) problems.push(`count ${key} shows ${shown[key]}, the records say ${value}`);
  for (const key of Object.keys(shown)) if (!(key in week.counts)) problems.push(`count ${key} is not a count of the week`);
  // Every record line, in order, carries exactly one link, and it is to the record that line stands for.
  const expected = {
    merged: week.merged.map(m => m.id), story: week.story.map(r => `milestone:${r.id}`),
    sessions: week.sessions.map(d => `dispatch:${d.session}`), proofs: week.proofs.map(p => `proof:${p.id}`),
  };
  for (const [key, sources] of Object.entries(expected)) {
    const lines = [...html.matchAll(new RegExp(`<li data-list="${key}">([\\s\\S]*?)</li>`, 'g'))].map(m => m[1]);
    if (lines.length !== sources.length) problems.push(`the ${key} list shows ${lines.length} lines, the count is ${sources.length}`);
    lines.forEach((line, i) => {
      const linked = [...line.matchAll(/<a\b[^>]*data-source="([^"]*)"/g)].map(m => m[1].replaceAll('&amp;', '&'));
      if (linked.length !== 1 || linked[0] !== sources[i]) problems.push(`the ${key} list, line ${i + 1}: links ${linked.length ? linked.join(', ') : 'nothing'}, not its record ${sources[i] ?? '(none)'}`);
    });
  }
  const places = new Map([
    ['section:built', '#built'],
    ...week.merged.map(m => [m.id, m.href]),
    ...week.story.map(r => [`milestone:${r.id}`, r.href]),
    ...week.sessions.map(d => [`dispatch:${d.session}`, d.href]),
    ...week.proofs.filter(p => p.href).map(p => [`proof:${p.id}`, p.href]),
  ]);
  for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
    const source = m[1].match(/data-source="([^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
    const href = m[1].match(/href="([^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
    if (!source) { problems.push(`${m[0]}: a link with no source record`); continue; }
    if (!places.has(source)) { problems.push(`${m[0]}: names ${source}, which is not a record of this week`); continue; }
    if (href !== places.get(source)) problems.push(`${m[0]}: links to ${href}, not its record's ${places.get(source)}`);
  }
  for (const hit of screenHits(visibleText(html))) problems.push(`the rendered section: ${hit.reason}`);
  return problems;
}
