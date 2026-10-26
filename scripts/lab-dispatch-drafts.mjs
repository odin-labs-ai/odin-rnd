// The Lab 01 drafts generator (mission rnd-labs-human-first-1024, vision-plan bundle 4 WO-01/WO-02): the work is the
// content. From one public dispatch (odin-lab-dispatch v1, as scripts/lab-dispatch-publish.mjs writes it) it drafts a
// post for each channel the lab is followed on, for the founder to read, edit and post by hand:
//   <out>/linkedin.md            one post: the session, its first question, the answer and where it came from
//   <out>/x.md                   a thread, every part counted and at most 280 characters
//   <out>/reddit.md              a title (the first question, as asked) and a body, with a note to check each
//                                subreddit's self-promotion rule
//   <out>/github-discussion.md   every question with its answer, why, and where it came from
//   <out>/preview.html           the four side by side, under a "DRAFT — the founder posts" banner
//
//   node scripts/lab-dispatch-drafts.mjs --dispatch <file> --out <dir>
//   node scripts/lab-dispatch-drafts.mjs --cadence [--site <dir>] [--today YYYY-MM-DD]
//   node scripts/lab-dispatch-drafts.mjs --week --out <dir> [--site <dir>] [--now <ISO time>]
//
// --week drafts the same five files from "This week in Lab 01" (scripts/lab-week.mjs): the same weekOf() over the same
// records the page section is built from, and renderWeek() is run on it first, so a week the page would refuse is
// refused here too. Every draft links that section (labs/agent-space/#this-week) and carries only the section's own
// sentences, the window it states, and the titles of the records in it (story entries, merged pull requests), verbatim.
// It writes to --out (for the mission: its deliverables/ folder), never under site/ or dist/, under the same checks.
//
// Nothing here posts, sends or calls anything: the script makes no network call of any kind, and posting stays the
// founder's own act (odin-labs rule 36). Every draft links the dispatch's live place on the lab page and carries only
// text the dispatch carries (the question, who it was asked, the answer, its why and where it came from), around a few
// fixed sentences. A long answer is cut at a word, never reworded.
// It REFUSES (exit 1, every reason listed, nothing written, the out dir not even created) when the dispatch does not
// pass the publisher's own checks (dispatchProblems), when any draft, the preview's visible text included, fails the
// publisher's text screen (screenHits; the dispatch's own page link is the one link let through, after it passes
// urlProblems on the site's host, and the preview's only href or src may be that link), when an X part is over 280
// characters, or when --out resolves, through any symlink, under site/ or dist/ (drafts are never published), or runs
// through a link that does not resolve.
// --cadence prints how many days have passed since the latest dispatch committed under site/ (by the dispatch's own
// date), or, with none yet, since the lab opened; it exits 2 when that is more than 10 days: the lab has gone quiet.
// Exit codes: 0 done, 1 refused, 2 quiet (--cadence only), 3 usage.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchProblems, screenHits, urlProblems } from './lab-dispatch-publish.mjs';
import { readDispatches, readLab, SITE_URL, sourceKind } from './labs.mjs';
import { readDelivery } from './lab-delivery.mjs';
import { readMilestones } from './lab-milestones.mjs';
import { PROOFS_PAGE } from './lab-proofs.mjs';
import { WEEK_ANCHOR, coverageNotes, renderWeek, visibleText, weekOf, weekSentences } from './lab-week.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SITE_DIR = join(here, '..', 'site');
export const DIST_DIR = join(here, '..', 'dist');
export const SITE_HOST = new URL(SITE_URL).hostname;
export const X_LIMIT = 280;
export const QUIET_AFTER_DAYS = 10;
export const DRAFT_FILES = ['linkedin.md', 'x.md', 'reddit.md', 'github-discussion.md'];
const BANNER = 'DRAFT — the founder posts. Nothing here is sent.';

/** The dispatch's live place: its anchor on the lab page, as the Atom feed links it. */
export const dispatchUrl = dispatch => `${SITE_URL}labs/agent-space/#${dispatch.session}`;

// X weighs a character 1 in these code point ranges (Latin, the common punctuation, curly quotes) and 2 everywhere else
// (an ellipsis, an emoji, CJK). A link is counted at its full length, more than X's flat 23, so a part never runs over.
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];

/** Characters as X counts them: by code point, weighted as above, so nothing is undercounted. */
export const length = text => [...text].reduce((sum, ch) => { const cp = ch.codePointAt(0); return sum + (LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2); }, 0);

/** The text unchanged when it fits in `max` characters, else its longest prefix that ends at a word, plus "…". */
export function excerpt(text, max) {
  if (length(text) <= max) return text;
  const chars = [...text];
  // Every character weighs at least 1, so no more than max - 1 of them fit before the "…".
  for (let take = Math.min(chars.length, max) - 1; ; take--) {
    const cut = chars.slice(0, Math.max(0, take)).join('');
    const short = `${(cut.replace(/\s+\S*$/, '') || cut).replace(/[\s,;:.]+$/, '')}…`;
    if (length(short) <= max || take <= 0) return short;
  }
}

const longDate = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const quoted = text => `“${text}”`;
const quote = text => text.split('\n').map(line => `> ${line}`).join('\n');
const asked = q => `Asked ${q.to}${q.followUp ? ', as a follow-up' : ''}`;

function linkedin(dispatch, url) {
  const [first] = dispatch.questions;
  return [`<!-- ${BANNER} Attach the first still of this session from the lab page. -->`, '',
    `A session in the agent space, ${longDate(dispatch.date)}: ${plural(dispatch.questions.length, 'question')}, answered live.`, '',
    `${asked(first)}: ${quoted(first.text)}`, '',
    excerpt(first.answer, 400), '',
    `Where it came from: ${sourceKind(first.source)}.`, '',
    `The recording, every question and every card: ${url}`, ''].join('\n');
}

/** One X part, shrinking the answer first and then the question until it fits. */
function xPart(prefix, q) {
  let question = q.text, answerMax = length(q.answer);
  const build = () => `${prefix} ${asked(q)}: ${quoted(question)}\n${excerpt(q.answer, answerMax)}\nWhere it came from: ${sourceKind(q.source)}`;
  while (length(build()) > X_LIMIT && answerMax > 60) answerMax--;
  while (length(build()) > X_LIMIT && length(question) > 40) question = excerpt(q.text, length(question) - 1);
  return build();
}

/** The thread: an opening part, one per question (at most four), and the link. */
export function xThread(dispatch, url) {
  const shown = dispatch.questions.slice(0, 4);
  const total = shown.length + 2;
  return [
    `1/${total} A session in the agent space, ${longDate(dispatch.date)}: ${plural(dispatch.questions.length, 'question')}, answered live. Every answer comes with a card that says where it came from.`,
    ...shown.map((q, i) => xPart(`${i + 2}/${total}`, q)),
    `${total}/${total} The recording, every question and every card: ${url}`,
  ];
}

function x(parts) {
  return [`<!-- ${BANNER} A thread: post the parts in order, each as a reply to the one before. -->`, '',
    ...parts.flatMap((part, i) => [`### Part ${i + 1} of ${parts.length} (${length(part)} of ${X_LIMIT} characters)`, '', part, '']), ''].join('\n');
}

function reddit(dispatch, url) {
  const [first] = dispatch.questions;
  return [`<!-- ${BANNER} Before posting in a subreddit, read its rules on self-promotion and links to your own work; many allow it only in a set thread, or not at all. Post where it is welcome, and only there. -->`, '',
    `## Title`, '', `${asked(first)}: ${quoted(first.text)}`, '',
    `## Body`, '',
    `A session in the agent space, recorded live on ${longDate(dispatch.date)}. ${asked(first)}: ${quoted(first.text)}`, '',
    quote(excerpt(first.answer, 600)), '',
    `Where it came from: ${sourceKind(first.source)}.`, '',
    `The recording and every question with its card: ${url}`, ''].join('\n');
}

function githubDiscussion(dispatch, url) {
  return [`<!-- ${BANNER} For the repository's Discussions, in the category for show and tell. -->`, '',
    `## Title`, '', `The agent space, session of ${longDate(dispatch.date)}`, '',
    `## Body`, '',
    `${plural(dispatch.questions.length, 'question')}, answered live in the agent space. The recording and every card: ${url}`, '',
    ...dispatch.questions.flatMap(q => [`### ${quoted(q.text)}`, '', `${asked(q)}.`, '', quote(q.answer), '',
      ...(q.why ? [`**Why:** ${q.why}`, ''] : []), `**Where it came from:** ${sourceKind(q.source)} (evidence \`${q.evidence}\`)`, '']),
    ''].join('\n');
}

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// The preview's heading: a week names its window, a dispatch its session's date.
const previewHeading = subject => subject.window ? `Drafts for this week in Lab 01, ${subject.window.label}` : `Drafts for the session of ${longDate(subject.date)}`;

function preview(subject, drafts) {
  const columns = [['LinkedIn', 'linkedin.md'], ['X (a thread)', 'x.md'], ['Reddit', 'reddit.md'], ['GitHub Discussions', 'github-discussion.md']]
    .map(([label, file]) => `<section><h2>${escape(label)}</h2><pre>${escape(drafts[file])}</pre></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Dispatch drafts</title><style>
:root{--bg:#f6f4ef;--fg:#1d1d1b;--card:#fff;--line:#d9d4c7;--warn:#8a3b12;--warn-bg:#fde9d9}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--fg:#ecebe6;--card:#1f1f1c;--line:#3a3934;--warn:#ffb98a;--warn-bg:#3b2214}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
.banner{position:sticky;top:0;padding:12px 16px;background:var(--warn-bg);color:var(--warn);font-weight:700;border-bottom:2px solid var(--warn);text-align:center}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;padding:16px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;min-width:0}
h1{margin:16px 16px 0;font-size:18px}h2{margin:0 0 8px;font-size:16px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace;margin:0}
</style></head><body><div class="banner" role="note">${escape(BANNER)}</div><h1>${escape(previewHeading(subject))}</h1><main>${columns}</main></body></html>\n`;
}

/**
 * Why the drafts may not be written: the publisher's text screen over each draft, with every occurrence of the
 * dispatch's own link taken out first (that one link is checked as a URL on the site's host), and the X part limit.
 */
export function draftProblems(drafts, url, xParts = []) {
  const problems = urlProblems(url, [SITE_HOST]).map(reason => `the dispatch link ${url}: ${reason}`);
  for (const [file, text] of Object.entries(drafts)) {
    for (const hit of screenHits(text.replaceAll(url, ' '))) problems.push(`${file}: ${hit.reason}`);
    if (!text.includes(url)) problems.push(`${file}: does not link the dispatch`);
  }
  xParts.forEach((part, i) => { if (length(part) > X_LIMIT) problems.push(`x.md: part ${i + 1} is ${length(part)} characters, over ${X_LIMIT}`); });
  return problems;
}

/** What a reader of an HTML page sees (one definition, in scripts/lab-week.mjs). */
export { visibleText };

/**
 * Why a preview page may not be written: the same screen over its visible text, and the same one-link rule over its
 * markup: an href or src may only be the dispatch link, and nothing may load from anywhere (no script, frame, link
 * element, form, CSS url() or @import).
 */
export function previewProblems(html, url) {
  const problems = draftProblems({ 'preview.html': visibleText(html) }, url);
  for (const m of html.matchAll(/\s(href|src|srcset|action|formaction|poster|data|background)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
    const value = visibleText(m[2].replace(/^["']|["']$/g, ''));
    if (value !== url) problems.push(`preview.html: ${m[1]} ${JSON.stringify(value)} is not the dispatch link`);
  }
  if (/<(script|iframe|frame|object|embed|link|form|base|img|video|audio|source)\b|url\s*\(|@import|http-equiv/i.test(html)) problems.push('preview.html: it loads or embeds something');
  return problems;
}

/**
 * Every draft for one dispatch, in memory: { problems, files } where files maps a file name to its text. All five are
 * built first and all five screened; only when nothing is refused are they returned to be written. `render` replaces
 * the preview renderer (for tests).
 */
export function drafts(dispatch, where = 'dispatch', { render = preview } = {}) {
  const problems = dispatchProblems(dispatch, where);
  if (problems.length) return { problems, files: {} };
  const url = dispatchUrl(dispatch);
  const parts = xThread(dispatch, url);
  return screened(dispatch, { 'linkedin.md': linkedin(dispatch, url), 'x.md': x(parts), 'reddit.md': reddit(dispatch, url), 'github-discussion.md': githubDiscussion(dispatch, url) }, parts, url, render);
}

// The four drafts and their preview, all screened together; nothing is returned to be written unless all five pass.
function screened(subject, texts, parts, url, render) {
  const page = render(subject, texts);
  const refused = [...draftProblems(texts, url, parts), ...previewProblems(page, url)];
  if (refused.length) return { problems: refused, files: {} };
  return { problems: [], files: { ...texts, 'preview.html': page }, xParts: parts, url };
}

/** The week section's live place on Lab 01. */
export const weekUrl = () => `${SITE_URL}labs/agent-space/#${WEEK_ANCHOR}`;

// A week's sentences as the drafts carry them: the section's own, in its order, the quiet line first when there is one.
const weekLines = week => { const s = weekSentences(week); return [...(s.quiet ? [s.quiet] : []), s.delivery, s.story, s.sessions]; };
const KIND = { beat: 'Step', moment: 'Moment', correction: 'Correction' };
const STORY_SHOWN = 5;

function weekLinkedin(week, url) {
  const story = week.story.slice(0, STORY_SHOWN);
  return [`<!-- ${BANNER} -->`, '', `This week in Lab 01, ${week.window.label}.`, '', ...weekLines(week).flatMap(line => [line, '']),
    ...(story.length ? [`From the story${week.story.length > story.length ? `, the newest ${story.length} of ${week.story.length}` : ''}:`, ...story.map(r => `- ${KIND[r.kind]}: ${r.title}`), ''] : []),
    `Every line, linked to its record: ${url}`, ''].join('\n');
}

/** The week's thread: the window and the delivery line, the story and sessions, up to three story titles, the link. */
export function weekThread(week, url) {
  const s = weekSentences(week);
  const body = [
    `This week in Lab 01, ${week.window.label}. ${s.quiet ?? s.delivery}`,
    ...(s.quiet ? [] : [`${s.story} ${s.sessions}`]),
    ...week.story.slice(0, 3).map(r => `${KIND[r.kind]}: ${quoted(r.title)}`),
  ];
  const total = body.length + 1;
  const parts = [...body, `Every line, linked to its record: ${url}`].map((text, i) => `${i + 1}/${total} ${text}`);
  return parts.map(part => excerpt(part, X_LIMIT));
}

function weekReddit(week, url) {
  const story = week.story.slice(0, STORY_SHOWN);
  return [`<!-- ${BANNER} Before posting in a subreddit, read its rules on self-promotion and links to your own work; many allow it only in a set thread, or not at all. Post where it is welcome, and only there. -->`, '',
    `## Title`, '', `This week in Lab 01, ${week.window.label}`, '',
    `## Body`, '', ...weekLines(week).flatMap(line => [line, '']),
    ...(story.length ? [...story.map(r => `- ${KIND[r.kind]}: ${r.title}`), ''] : []),
    `Every line, linked to its record: ${url}`, ''].join('\n');
}

function weekGithub(week, url) {
  return [`<!-- ${BANNER} For the repository's Discussions, in the category for show and tell. -->`, '',
    `## Title`, '', `This week in Lab 01, ${week.window.label}`, '',
    `## Body`, '', ...weekLines(week).flatMap(line => [line, '']), `Every line, linked to its record: ${url}`, '',
    ...(week.merged.length ? ['### Merged', '', ...week.merged.map(m => `- #${m.pr} ${m.title}`), ''] : []),
    ...(week.story.length ? ['### In the story', '', ...week.story.map(r => `- ${KIND[r.kind]}: ${r.title}`), ''] : []),
    ...(week.sessions.length ? ['### Sessions', '', ...week.sessions.map(d => `- Session of ${d.date}: ${plural(d.questions, 'question')}`), ''] : []),
    ...(week.proofs.length ? ['### Proof cards', '', ...week.proofs.map(p => `- \`${p.id}\``), ''] : []),
    ...coverageNotes(week).flatMap(note => [`_${note}_`, '']), ''].join('\n');
}

/**
 * Every draft for one week, in memory, under the same checks as a dispatch's. The week must also pass the page's own
 * gates (renderWeek throws on a count, link or word that does not hold), so a draft never says what the page refuses.
 */
export function weekDrafts(week, { render = preview } = {}) {
  try { renderWeek(week); } catch (error) { return { problems: [error.message], files: {} }; }
  const url = weekUrl();
  const parts = weekThread(week, url);
  return screened(week, { 'linkedin.md': weekLinkedin(week, url), 'x.md': x(parts), 'reddit.md': weekReddit(week, url), 'github-discussion.md': weekGithub(week, url) }, parts, url, render);
}

/** The week as the site would build it now (or at `now`), from the records under `site`. */
export function siteWeek(site = SITE_DIR, now = new Date()) {
  return weekOf({ delivery: readDelivery(site), milestones: readMilestones(site, { now }), dispatches: readDispatches(site), proofs: existsSync(join(site, PROOFS_PAGE)), now });
}

// The path with every symlink resolved: the deepest existing ancestor (the target itself when it exists) through
// realpath, in the file system's own letter case, plus the part that does not exist yet. `dangling` names a part that
// does not resolve but is there as a link: it may point under site/ once its target is made, so it is refused.
function real(path) {
  let at = resolve(path), rest = [], dangling = null;
  while (!existsSync(at) && dirname(at) !== at) {
    try { lstatSync(at); dangling = at; } catch {}
    rest.unshift(at.slice(dirname(at).length + 1)); at = dirname(at);
  }
  return { path: join(realpathSync.native(at), ...rest), dangling };
}
const within = (path, root) => { const r = relative(root, path); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Is the resolved `target` the directory `root` or under it? By path against the root's own realpath, and by identity
// (device and inode) for every existing ancestor of the resolved target, so neither a symlink (the out dir itself or
// any ancestor) nor a case-insensitive spelling ("SITE/") gets past it.
function under(target, root) {
  const rootReal = real(root).path;
  if (within(target, rootReal)) return true;
  if (!existsSync(root)) return false;
  const id = statSync(root);
  for (let at = target; ; at = dirname(at)) {
    if (existsSync(at) && same(statSync(at), id)) return true;
    if (dirname(at) === at) return false;
  }
}

/** Why drafts may not go to `out`: anywhere under site/ or dist/ would publish them, and so might a dangling link. */
export function outProblems(out, roots = [SITE_DIR, DIST_DIR]) {
  const { path, dangling } = real(out);
  if (dangling) return [`--out ${out}: ${dangling} is a link that does not resolve; it could point under site/ once its target exists`];
  return roots.filter(root => under(path, root)).map(root => `--out ${out} is under ${root}: drafts are never published`);
}

/** Write the drafts for the dispatch file into `out`; nothing is written unless every check passes. */
export function writeDrafts(dispatchFile, out, roots, options) {
  const problems = outProblems(out, roots);
  let dispatch;
  try { dispatch = JSON.parse(readFileSync(dispatchFile, 'utf8')); } catch (error) { problems.push(`${dispatchFile}: ${error.message}`); }
  if (problems.length) return { problems };
  return written(drafts(dispatch, dispatchFile, options), out);
}

/** Write the week's drafts into `out`, from the records under `site` at `now`; nothing is written unless all pass. */
export function writeWeekDrafts(out, { site = SITE_DIR, now = new Date(), roots = [SITE_DIR, DIST_DIR], render } = {}) {
  // The site the week is read from is protected too, with its dist/ beside it: a draft never lands in a publication tree.
  const problems = outProblems(out, [...new Set([...roots, resolve(site), resolve(site, '..', 'dist')])]);
  if (problems.length) return { problems };
  let week;
  try { week = siteWeek(site, now); } catch (error) { return { problems: [error.message] }; }
  return { ...written(weekDrafts(week, render ? { render } : {}), out), week };
}

function written(result, out) {
  if (result.problems.length) return result;
  mkdirSync(out, { recursive: true });
  for (const [file, text] of Object.entries(result.files)) writeFileSync(join(out, file), text);
  return result;
}

const DAY = 86_400_000;

/** How long the lab has been quiet: days from the latest committed dispatch's date (or the lab's opening) to `today`. */
export function cadence(site = SITE_DIR, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`--today ${today} is not YYYY-MM-DD`);
  const [latest] = readDispatches(site);
  const since = latest ? latest.date : readLab(site).since;
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / DAY);
  const quiet = days > QUIET_AFTER_DAYS;
  const basis = latest ? `the latest dispatch, ${latest.session}, is dated ${since}` : `no dispatch yet; the lab opened ${since}`;
  return { days, quiet, line: `${quiet ? 'QUIET' : 'OK'} ${days} day${days === 1 ? '' : 's'}: ${basis} (quiet after ${QUIET_AFTER_DAYS} days, counted to ${today})` };
}

function args(argv) {
  const out = { cadence: false, week: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--cadence' || flag === '--week') out[flag.slice(2)] = true;
    else if (['--dispatch', '--out', '--site', '--today', '--now'].includes(flag) && argv[i + 1]) out[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (out.week && (!out.out || out.dispatch || out.cadence)) throw new Error('--week takes --out <dir> (and no --dispatch or --cadence)');
  if (out.now && (!out.week || Number.isNaN(Date.parse(out.now)))) throw new Error('--now takes an ISO time, with --week');
  if (!out.cadence && !out.week && (!out.dispatch || !out.out)) throw new Error('--dispatch <file> and --out <dir> are required (or --cadence, or --week)');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-dispatch-drafts.mjs --dispatch <file> --out <dir>\n       node scripts/lab-dispatch-drafts.mjs --cadence [--site <dir>] [--today YYYY-MM-DD]\n       node scripts/lab-dispatch-drafts.mjs --week --out <dir> [--site <dir>] [--now <ISO time>]\n${error.message}`);
    process.exit(3);
  }
  if (options.cadence) {
    let result;
    try { result = cadence(resolve(options.site ?? SITE_DIR), options.today); } catch (error) { console.error(`REFUSED --cadence: ${error.message}`); process.exit(1); }
    console.log(result.line);
    process.exit(result.quiet ? 2 : 0);
  }
  const result = options.week
    ? writeWeekDrafts(resolve(options.out), { site: resolve(options.site ?? SITE_DIR), now: options.now ? new Date(options.now) : new Date() })
    : writeDrafts(resolve(options.dispatch), resolve(options.out));
  if (result.problems.length) {
    console.error(`REFUSED ${options.week ? '--week' : options.dispatch}: ${result.problems.length} reason${result.problems.length === 1 ? '' : 's'}; nothing was written.`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`DRAFTED ${Object.keys(result.files).length} files -> ${options.out} (${result.url}); the founder posts.`);
}
