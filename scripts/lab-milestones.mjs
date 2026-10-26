// Lab 01's story (founder plans 1 and 2, 2026-10-26): "How the agent space was born", dated beats and corrections from
// the first filmable space to Lab 01 going live, and "Moments", verbatim quotes with the story around them. Both come
// from site/data/labs/agent-space/milestones.json (odin-milestones v1, scripts/schemas/odin-milestones-v1.schema.json),
// the public projection the delivery-record pipeline makes from the team's chat (odin-labs milestone-extract.mjs; its
// text is changed there, never by hand here). scripts/labs.mjs renders it into its own page,
// labs/agent-space/story/index.html, and links it from Lab 01 (nothing while there is no record).
//
// The build refuses the record, every reason listed, when:
//   - its bytes are not the ones pinned when it was produced (scripts/milestones.pin.json: the file's sha256, plus the
//     sha256 of the private inputs and the commit of the producer);
//   - it misses the schema: every object is closed, so an internal field (a post id, a channel, a user, a run id, a
//     private path) is refused by name;
//   - a record has evidence in neither tier. Tier 1, "checkable here": a PR or commit of a public repository
//     (PUBLIC_REPOS, its link naming exactly that PR or commit), a proof id a published dispatch shows, or a link to
//     this site or a public repository that resolves to something published here. Tier 2, "cited by hash": a full
//     40-hex private commit, with no repository name or path, checked when produced to be an ancestor of the private
//     main head the record names (mainCheck {main, how, checked}; each such item's onMain is that head). The page says
//     beside it that it cannot check it, and anyone with access can;
//   - its counts do not reconcile with its records, or a quote is longer than 25 words, or any text fails the
//     publisher's screen or the private test game's world terms (benchScreen);
//   - a sentence mentions a review, reviewer, jury, judge or advocate without saying, in that sentence, that it is AI;
//   - records are out of date order, outside the record's window, or dated after the build;
//   - an id repeats or does not match its kind, or a picture is not a file already published under this lab's assets.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';
import { benchScreen } from './brain-bench-import.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MILESTONES_FILE = 'data/labs/agent-space/milestones.json';
export const MILESTONES_SCHEMA_FILE = join(here, 'schemas/odin-milestones-v1.schema.json');
export const MILESTONES_PIN_FILE = join(here, 'milestones.pin.json');
export const STORY_PAGE = 'labs/agent-space/story/index.html';
/** Public repositories whose commits and PRs count as evidence (a subset of scripts/check.mjs's public export list). */
export const PUBLIC_REPOS = ['odin-labs-ai/odin-rnd'];
export const MAX_QUOTE_WORDS = 25;
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

// Where a public URL resolves in this checkout, or null when it does not: a page or file of this site (under `root`),
// or a file of this repository on github.com (blob/main/<path>, under the repository root). A PR or commit link is
// checked by shape (its number or sha must be the one the link names).
function resolves(url, root) {
  const u = new URL(url), path = decodeURIComponent(u.pathname);
  if (u.hostname === 'odin-labs-ai.github.io') {
    const rel = path.replace(/^\/odin-rnd\/?/, '');
    return [rel, join(rel, 'index.html')].some(candidate => candidate !== '' && existsSync(join(root, candidate))) || rel === '' || rel.endsWith('/') && existsSync(join(root, rel, 'index.html'));
  }
  const blob = path.match(/^\/odin-labs-ai\/odin-rnd\/blob\/main\/(.+)$/);
  if (blob) return existsSync(join(root, '..', blob[1]));
  return path === '/odin-labs-ai/odin-rnd' || /^\/odin-labs-ai\/odin-rnd\/(pull\/\d+|commit\/[0-9a-f]{40})$/.test(path);
}

/** Every proof id a published dispatch shows. */
function publishedProofIds(root) {
  const dir = join(root, 'data/labs/agent-space/dispatches');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter(n => n.endsWith('.json')).flatMap(n => {
    const d = JSON.parse(readFileSync(join(dir, n), 'utf8'));
    return [...(d.questions ?? []).map(q => q.evidence), ...(d.answersScreen?.answers ?? []).map(a => a.evidence)];
  }));
}

/** Why one evidence item is not evidence (empty when it is). Tier 2 (private-commit) is checked against mainCheck by the caller. */
export function evidenceProblems(item, at, root, proofIds = publishedProofIds(root)) {
  if (item.type === 'private-commit') return [];
  const problems = [];
  if (!isPublicUrl(item.url)) return [`${at}: ${item.url} is not a public repository or this site`];
  if (item.type === 'pr' && item.url !== `https://github.com/${PUBLIC_REPOS[0]}/pull/${item.number}`) problems.push(`${at}: the link is not PR #${item.number} of ${PUBLIC_REPOS[0]}`);
  if (item.type === 'commit' && item.url !== `https://github.com/${PUBLIC_REPOS[0]}/commit/${item.sha}`) problems.push(`${at}: the link is not commit ${item.sha} of ${PUBLIC_REPOS[0]}`);
  if (item.type === 'proof' && !proofIds.has(item.id)) problems.push(`${at}: proof ${item.id} is not shown by any published dispatch`);
  if (!resolves(item.url, root)) problems.push(`${at}: ${item.url} does not resolve to anything this site or repository publishes`);
  return problems;
}

const ACTOR_SENTENCE = /\b(review\w*|jury|juries|judge\w*|advocate\w*|refute\w*)\b/i;
const sentences = text => text.split(/(?<=[.!?:])\s+/);

/** Everything that makes a milestones record unpublishable. `now` is the build's time (dates after it are refused). */
export function milestonesProblems(record, { root = 'site', now = new Date(), where = MILESTONES_FILE } = {}) {
  const problems = validate(JSON.parse(readFileSync(MILESTONES_SCHEMA_FILE, 'utf8')), record).map(problem => `${where}#${problem} (does not match odin-milestones v1)`);
  if (problems.length) return problems;
  const proofIds = publishedProofIds(root);
  const screen = (text, at) => benchScreen(text).map(reason => `${at}: ${reason}`);
  const ids = new Set();
  let last = null;
  if (record.records.some(r => r.evidence.some(ev => ev.type === 'private-commit')) && !record.mainCheck) problems.push(`${where}: a private commit is cited by hash, but the record has no mainCheck (the private main head it was checked against, how and when)`);
  for (const kind of ['beat', 'moment', 'correction']) {
    const n = record.records.filter(r => r.kind === kind).length;
    if (record.counts[kind] !== n) problems.push(`${where}#/counts/${kind}: ${record.counts[kind]}, but the record holds ${n}`);
  }
  for (const [i, item] of record.records.entries()) {
    const at = `${where}#/records/${i}`;
    if (ids.has(item.id)) problems.push(`${at}/id: ${item.id} is listed twice`);
    ids.add(item.id);
    if (!item.id.startsWith(`${item.kind}-`)) problems.push(`${at}/id: ${item.id} is not a ${item.kind} id`);
    const when = new Date(item.at);
    if (when > now) problems.push(`${at}/at: ${item.at} is after this build (${now.toISOString()})`);
    if (last && when < last) problems.push(`${at}/at: ${item.at} comes before the record above it`);
    if (when < new Date(record.window.from) || when > new Date(record.window.to)) problems.push(`${at}/at: ${item.at} is outside the record's window`);
    last = when;
    const texts = { title: item.title, body: item.body, ...(item.quote ? { quote: item.quote } : {}) };
    for (const [field, text] of Object.entries(texts)) {
      problems.push(...screen(text, `${at}/${field}`));
      for (const sentence of sentences(text)) if (ACTOR_SENTENCE.test(sentence) && !/\bAI\b/.test(sentence)) problems.push(`${at}/${field}: a review, reviewer, jury, judge or advocate is mentioned without saying, in the same sentence, that it is AI ("${sentence.slice(0, 80)}")`);
    }
    if (item.quote && words(item.quote) > MAX_QUOTE_WORDS) problems.push(`${at}/quote: ${words(item.quote)} words, over ${MAX_QUOTE_WORDS}`);
    for (const [j, ev] of item.evidence.entries()) {
      problems.push(...evidenceProblems(ev, `${at}/evidence/${j}`, root, proofIds));
      if (ev.url) problems.push(...benchScreen(ev.url).filter(r => /^a (restricted name|place name|name from the private)/.test(r)).map(r => `${at}/evidence/${j}: ${r}`));
      if (ev.type === 'private-commit' && record.mainCheck && ev.onMain !== record.mainCheck.main) problems.push(`${at}/evidence/${j}/onMain: a private commit must name the main head it was checked against (${record.mainCheck.main})`);
    }
    if (item.visual) {
      if (!ASSET_ROOTS.some(prefix => item.visual.startsWith(prefix))) problems.push(`${at}/visual: not under this lab's published assets`);
      else if (!existsSync(join(root, item.visual))) problems.push(`${at}/visual: ${item.visual} is not published`);
    }
  }
  if (record.mainCheck) problems.push(...screen(record.mainCheck.how, `${where}#/mainCheck/how`));
  return problems;
}

/** A record's evidence tier: 1 ("checkable here") when any of its evidence is public, else 2 ("cited by hash"). */
export const tierOf = item => item.evidence.some(ev => ev.type !== 'private-commit') ? 1 : 2;

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
/** One evidence item as a link a reader can follow (tier 2 as a plain statement: there is nothing public to open). */
export function evidenceLink(ev) {
  switch (ev.type) {
    case 'pr': return `<a href="${escape(ev.url)}">odin-rnd #${escape(ev.number)}</a>`;
    case 'commit': return `<a href="${escape(ev.url)}">commit <code>${escape(ev.sha.slice(0, 8))}</code></a>`;
    case 'proof': return `<a href="${escape(ev.url)}">proof <code>${escape(ev.id)}</code></a>`;
    case 'url': { const u = new URL(ev.url); return `<a href="${escape(ev.url)}">${escape(u.pathname.replace(/^\/odin-rnd\/?/, '/').replace(/\/$/, '') || '/')}${escape(u.hash)}</a>`; }
    case 'private-commit': return `Private commit <code>${escape(ev.sha.slice(0, 8))}</code>, cited by hash; this page cannot check it, anyone with access can.`;
    default: return '';
  }
}

const TIER = { 1: 'Checkable here', 2: 'Cited by hash' };
const KIND_LABEL = { beat: '', moment: '', correction: '<span class="story-correction">Correction</span> ' };
const evidenceList = item => `<p class="story-evidence"><span class="story-tier story-tier-${tierOf(item)}">${TIER[tierOf(item)]}</span> <span>Evidence:</span> ${item.evidence.map(evidenceLink).join(' · ')}</p>`;
const picture = (item, up) => item.visual ? `<img class="story-picture" src="${up}${escape(item.visual)}" alt="" loading="lazy">` : '';
const quoteBlock = item => item.quote ? `<blockquote class="story-quote"><p>${escape(item.quote)}</p></blockquote>` : '';

/** The plain count: how many are checkable here, cited by hash, and left out. */
export function tallyLine(record, kinds, noun) {
  const items = record.records.filter(r => kinds.includes(r.kind)), one = items.filter(i => tierOf(i) === 1).length;
  const left = kinds.reduce((n, k) => n + record.counts.leftOut[k], 0);
  return `<p class="story-tally">${one} ${noun} checkable here, ${items.length - one} cited by hash, ${left} left out for having no evidence.</p>`;
}

/** "Step by step": beats and corrections as one dated list, oldest first. */
export function renderBeats(record, up = '../../../') {
  const items = record.records.filter(r => r.kind !== 'moment');
  return `${tallyLine(record, ['beat', 'correction'], 'steps')}<ol class="story-beats">${items.map(b => `<li class="story-beat story-${b.kind}" id="${escape(b.id)}"><p class="story-when">${KIND_LABEL[b.kind]}${when(b.at)}</p><h3>${escape(b.title)}</h3><p>${escape(b.body)}</p>${quoteBlock(b)}${picture(b, up)}${evidenceList(b)}</li>`).join('')}</ol>`;
}

/** "Moments": each quote, its story and its evidence. */
export function renderMoments(record, up = '../../../') {
  const items = record.records.filter(r => r.kind === 'moment');
  if (!items.length) return `${tallyLine(record, ['moment'], 'moments')}<p class="lab-none">No moments yet.</p>`;
  return `${tallyLine(record, ['moment'], 'moments')}<div class="story-moments">${items.map(m => `<figure class="story-moment" id="${escape(m.id)}">${m.quote ? `<blockquote><p>${escape(m.quote)}</p></blockquote>` : ''}<figcaption><h3>${escape(m.title)}</h3><p class="story-who">${when(m.at)}</p><p>${escape(m.body)}</p>${picture(m, up)}${evidenceList(m)}</figcaption></figure>`).join('')}</div>`;
}

/** The link block on Lab 01's page: empty while there is no record. */
export function renderStoryLink(record) {
  if (!record) return '';
  const steps = record.records.filter(r => r.kind !== 'moment').length, moments = record.records.length - steps;
  return `<section class="company-section company-width" id="story" aria-labelledby="story-title"><div class="company-section-heading"><h2 id="story-title">How it was born.</h2><p>${steps} dated steps from the first filmable space to this lab, and ${moments} moments in the words that were said, each with evidence you can open.</p></div><p><a class="button" href="story/">Read the story</a></p></section>`;
}

/** The story page's markers, filled. */
export function storyValues(record) {
  return { '<!--STORY_PRODUCER-->': `the team's own chat, projected by its delivery-record pipeline (<time datetime="${escape(record.window.from)}">${escape(record.window.from.slice(0, 10))}</time> to <time datetime="${escape(record.window.to)}">${escape(record.window.to.slice(0, 10))}</time>)`, '<!--STORY_BEATS-->': renderBeats(record), '<!--STORY_MOMENTS-->': renderMoments(record) };
}
