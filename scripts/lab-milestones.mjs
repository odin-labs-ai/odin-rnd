// Lab 01's story (founder plans 1 and 2, 2026-10-26): "How the agent space was born", dated beats from the first
// filmable space to Lab 01 going live, and "Moments", verbatim quotes with why they mattered. Both come from
// site/data/labs/agent-space/milestones.json (odin-milestones v1, scripts/schemas/odin-milestones-v1.schema.json), the
// public projection the delivery-record pipeline makes from the team's chat. scripts/labs.mjs renders it into its own
// page, labs/agent-space/story/index.html, and links it from Lab 01 (empty while there is no record).
//
// The build refuses the record, every reason listed, when:
//   - its bytes are not the ones pinned when it was produced (scripts/milestones.pin.json: the file's sha256, plus the
//     sha256 of the private inputs and the commit the projection was built at);
//   - it misses the schema: every object is closed, so an internal field (a post id, a channel, a user, a run id, a
//     private path) is refused by name;
//   - a beat or moment has no PUBLIC evidence: a commit or PR in a public repository (PUBLIC_REPOS), a proof id that
//     occurs in a published dispatch, a moment in a published film (films.json, within its length), or a link to a
//     public repository or this site. A private repository's commit is not evidence here;
//   - a quote is longer than 25 words, or any text fails the publisher's screen or the private test game's world terms
//     (benchScreen: names, places, prices, paths, links elsewhere, world names);
//   - beats or moments are out of date order, or dated after the build;
//   - a review, reviewer, jury or judge is mentioned without the item saying, in `review`, that it was an AI model, or a
//     speaker labelled a reviewer, jury or judge is not marked an AI model;
//   - an id repeats, or a picture (`asset`) is not a file already published under this lab's assets.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';
import { benchScreen } from './brain-bench-import.mjs';
import { readFilms } from './lab-films.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MILESTONES_FILE = 'data/labs/agent-space/milestones.json';
export const MILESTONES_SCHEMA_FILE = join(here, 'schemas/odin-milestones-v1.schema.json');
export const MILESTONES_PIN_FILE = join(here, 'milestones.pin.json');
export const STORY_PAGE = 'labs/agent-space/story/index.html';
/** Public repositories whose commits and PRs count as evidence (a subset of scripts/check.mjs's public export list). */
export const PUBLIC_REPOS = ['odin-labs-ai/odin-rnd'];
export const MAX_QUOTE_WORDS = 25;
const REVIEW_WORDS = /\b(review|reviews|reviewed|reviewer|reviewers|refute|refuted|jury|juries|judge|judged|judges)\b/i;
const ASSET_ROOTS = ['assets/labs/agent-space/', 'assets/agent-space/'];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const words = text => text.trim().split(/\s+/).filter(Boolean).length;

/** The pin the producer writes beside the file: its own sha256 and the private inputs it came from (by sha256 and commit). */
export const pinFor = (fileBytes, { sourceSha256, commit }) => ({ format: 'odin-milestones-pin', version: 1, file: `site/${MILESTONES_FILE}`, fileSha256: sha256(fileBytes), sourceSha256, commit });

/** Why the committed bytes are not the pinned ones (empty when they are). */
export function pinProblems(fileBytes, pin) {
  if (!pin || pin.format !== 'odin-milestones-pin' || pin.version !== 1) return ['scripts/milestones.pin.json: missing, or not odin-milestones-pin v1'];
  const problems = [];
  if (pin.file !== `site/${MILESTONES_FILE}`) problems.push(`scripts/milestones.pin.json: file is ${JSON.stringify(pin.file)}, not site/${MILESTONES_FILE}`);
  if (!/^[0-9a-f]{64}$/.test(pin.sourceSha256 ?? '')) problems.push('scripts/milestones.pin.json: sourceSha256 is not a sha256');
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? '')) problems.push('scripts/milestones.pin.json: commit is not a 40-hex commit');
  if (pin.fileSha256 !== sha256(fileBytes)) problems.push(`${MILESTONES_FILE}: its sha256 is ${sha256(fileBytes)}, the pin says ${pin.fileSha256}; the file was edited after it was produced`);
  return problems;
}

/** A link this page may cite as evidence: https, a public repository on github.com or this site. */
export function isPublicUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const path = decodeURIComponent(u.pathname);
  if (/(^|\/)\.{1,2}(\/|$)|\\/.test(path)) return false;
  if (u.hostname === 'github.com') return PUBLIC_REPOS.some(repo => path === `/${repo}` || path.startsWith(`/${repo}/`));
  return u.hostname === 'odin-labs-ai.github.io' && (path === '/odin-rnd' || path.startsWith('/odin-rnd/'));
}

/** Why one evidence item is not public evidence (empty when it is). */
export function evidenceProblems(item, at, root, films) {
  switch (item.kind) {
    case 'commit': case 'pr':
      return PUBLIC_REPOS.includes(item.repo) ? [] : [`${at}: ${item.repo} is not a public repository (${PUBLIC_REPOS.join(', ')}); its ${item.kind} is not public evidence`];
    case 'proof': {
      const file = join(root, item.record);
      if (!existsSync(file)) return [`${at}: ${item.record} is not a published dispatch`];
      const dispatch = JSON.parse(readFileSync(file, 'utf8'));
      const ids = new Set([...(dispatch.questions ?? []).map(q => q.evidence), ...(dispatch.answersScreen?.answers ?? []).map(a => a.evidence)]);
      return ids.has(item.id) ? [] : [`${at}: proof ${item.id} is not in ${item.record}`];
    }
    case 'film': {
      const film = films.find(f => f.id === item.film);
      if (!film) return [`${at}: ${item.film} is not a published film (films.json)`];
      return item.atSeconds <= film.seconds ? [] : [`${at}: ${item.atSeconds} s is past the end of ${item.film} (${film.seconds} s)`];
    }
    case 'url':
      return isPublicUrl(item.url) ? [] : [`${at}: ${item.url} is not a public repository or this site`];
    default:
      return [`${at}: unknown evidence kind`];
  }
}

/** Everything that makes a milestones record unpublishable. `now` is the build's time (dates after it are refused). */
export function milestonesProblems(record, { root = 'site', now = new Date(), where = MILESTONES_FILE } = {}) {
  const problems = validate(JSON.parse(readFileSync(MILESTONES_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-milestones v1)`);
  if (problems.length) return problems;
  const films = existsSync(join(root, 'data/labs/agent-space/films.json')) ? readFilms(root)?.films ?? [] : [];
  const screen = (text, at) => benchScreen(text).map(reason => `${at}: ${reason}`);
  problems.push(...screen(record.producer.from, `${where}#/producer/from`));
  const ids = new Set();
  for (const kind of ['beats', 'moments']) {
    let last = null;
    for (const [i, item] of record[kind].entries()) {
      const at = `${where}#/${kind}/${i}`;
      if (ids.has(item.id)) problems.push(`${at}/id: ${item.id} is listed twice`);
      ids.add(item.id);
      const when = new Date(item.at);
      if (Number.isNaN(when.getTime())) problems.push(`${at}/at: not a date`);
      else {
        if (when > now) problems.push(`${at}/at: ${item.at} is after this build (${now.toISOString()})`);
        if (last && when < last) problems.push(`${at}/at: ${item.at} comes before the ${kind === 'beats' ? 'beat' : 'moment'} above it`);
        last = when;
      }
      const texts = kind === 'beats' ? { title: item.title, line: item.line } : { quote: item.quote, why: item.why, 'who/label': item.who.label };
      for (const [field, text] of Object.entries(texts)) problems.push(...screen(text, `${at}/${field}`));
      if (item.review) problems.push(...screen(item.review.by, `${at}/review/by`));
      if (kind === 'moments' && words(item.quote) > MAX_QUOTE_WORDS) problems.push(`${at}/quote: ${words(item.quote)} words, over ${MAX_QUOTE_WORDS}`);
      if (Object.values(texts).some(text => REVIEW_WORDS.test(text)) && !item.review) problems.push(`${at}: it mentions a review, reviewer, jury or judge but does not say it was an AI model (review: { by, kind: "ai-model" })`);
      if (kind === 'moments' && /\b(reviewer|jury|judge)\b/i.test(item.who.label) && item.who.kind !== 'ai-model') problems.push(`${at}/who: a reviewer, jury or judge is an AI model here (kind "ai-model")`);
      for (const [j, ev] of item.evidence.entries()) {
        problems.push(...evidenceProblems(ev, `${at}/evidence/${j}`, root, films));
        if (ev.kind === 'url') problems.push(...benchScreen(ev.url).filter(r => /^a (restricted name|place name|name from the private)/.test(r)).map(r => `${at}/evidence/${j}: ${r}`));
      }
      if (item.asset) {
        if (!ASSET_ROOTS.some(prefix => item.asset.startsWith(prefix))) problems.push(`${at}/asset: not under this lab's published assets`);
        else if (!existsSync(join(root, item.asset))) problems.push(`${at}/asset: ${item.asset} is not published`);
      }
    }
  }
  return problems;
}

/** The committed record, pinned and checked; null when there is none. A record without its pin is refused. */
export function readMilestones(root = 'site', { now = new Date(), pin } = {}) {
  const file = join(root, MILESTONES_FILE);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const usePin = pin ?? (existsSync(MILESTONES_PIN_FILE) ? JSON.parse(readFileSync(MILESTONES_PIN_FILE, 'utf8')) : null);
  const record = JSON.parse(bytes);
  const problems = [...pinProblems(bytes, usePin), ...milestonesProblems(record, { root, now })];
  if (problems.length) throw new Error(`Lab 01 story refused:\n  ${problems.join('\n  ')}`);
  return record;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = iso => { const d = new Date(iso); return `<time datetime="${escape(iso)}">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC</time>`; };
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** One evidence item as a link a reader can follow. `up` leads from the story page to the site root. */
export function evidenceLink(ev, up = '../../../') {
  switch (ev.kind) {
    case 'commit': return `<a href="https://github.com/${escape(ev.repo)}/commit/${escape(ev.sha)}">commit <code>${escape(ev.sha.slice(0, 8))}</code></a>`;
    case 'pr': return `<a href="https://github.com/${escape(ev.repo)}/pull/${escape(ev.number)}">${escape(ev.repo.split('/')[1])} #${escape(ev.number)}</a>`;
    case 'proof': { const session = ev.record.split('/').pop().replace(/\.json$/, ''); return `<a href="../#${escape(session)}">proof <code>${escape(ev.id)}</code></a>`; }
    case 'film': return `<a href="../#film-${escape(ev.film)}">the film, at ${mmss(ev.atSeconds)}</a>`;
    case 'url': return `<a href="${escape(ev.url)}">${escape(new URL(ev.url).hostname)}${escape(new URL(ev.url).pathname.replace(/\/$/, ''))}</a>`;
    default: return '';
  }
}

const reviewNote = item => item.review ? `<p class="story-review">Reviewed by an AI model (${escape(item.review.by)}), not a human.</p>` : '';
const evidenceList = (item, up) => `<p class="story-evidence"><span>Evidence:</span> ${item.evidence.map(ev => evidenceLink(ev, up)).join(' · ')}</p>`;
const picture = (item, up) => item.asset && !item.asset.endsWith('.webm') ? `<img class="story-picture" src="${up}${escape(item.asset)}" alt="" loading="lazy">` : '';
const WHO = { human: '', agent: ' (an agent)', 'ai-model': ' (an AI model)' };

/** "How the agent space was born": the beats as a dated list. */
export function renderBeats(record, up = '../../../') {
  return `<ol class="story-beats">${record.beats.map(b => `<li class="story-beat" id="beat-${escape(b.id)}"><p class="story-when">${when(b.at)}</p><h3>${escape(b.title)}</h3><p>${escape(b.line)}</p>${picture(b, up)}${reviewNote(b)}${evidenceList(b, up)}</li>`).join('')}</ol>`;
}

/** "Moments": each quote, who said it, why it mattered and its evidence. */
export function renderMoments(record, up = '../../../') {
  if (!record.moments.length) return '<p class="lab-none">No moments yet.</p>';
  return `<div class="story-moments">${record.moments.map(m => `<figure class="story-moment" id="moment-${escape(m.id)}"><blockquote><p>${escape(m.quote)}</p></blockquote><figcaption><p class="story-who">${escape(m.who.label)}${WHO[m.who.kind]}, ${when(m.at)}</p><p>${escape(m.why)}</p>${picture(m, up)}${reviewNote(m)}${evidenceList(m, up)}</figcaption></figure>`).join('')}</div>`;
}

/** The link block on Lab 01's page: empty while there is no record. */
export function renderStoryLink(record) {
  if (!record) return '';
  return `<section class="company-section company-width" id="story" aria-labelledby="story-title"><div class="company-section-heading"><h2 id="story-title">How it was born.</h2><p>${record.beats.length} dated steps from the first filmable space to this lab, and ${record.moments.length} moments in the words that were said, each with evidence you can open.</p></div><p><a class="button" href="story/">Read the story</a></p></section>`;
}

/** The story page's markers, filled. */
export function storyValues(record) {
  return { '<!--STORY_PRODUCER-->': `${escape(record.producer.from)}, built <time datetime="${escape(record.producer.builtAt)}">${escape(record.producer.builtAt.slice(0, 10))}</time>`, '<!--STORY_BEATS-->': renderBeats(record), '<!--STORY_MOMENTS-->': renderMoments(record) };
}
