// Labs: long-running projects people follow and take part in (mission rnd-labs-human-first-1024, vision-plan bundle 2).
// Lab 01 is the agent space. scripts/build.mjs calls renderLabs() after it copies site/ to dist/ and writes, into dist/
// only (nothing rendered is committed):
//   labs/index.html               the Labs index, from site/labs/index.html (<!--LABS_LIST-->)
//   labs/agent-space/index.html   the lab page, from site/labs/agent-space/index.html (<!--LAB_*--> markers)
//   labs/agent-space/feed.xml     an Atom feed with one entry per dispatch
// The lab's words come from site/data/labs/agent-space.json; its dispatches from
// site/data/labs/agent-space/dispatches/<session>.json, as scripts/lab-dispatch-publish.mjs writes them. Every dispatch
// must match scripts/schemas/odin-lab-dispatch.schema.json and pass the publisher's screen again, or the build fails.
// Until a screened session exists there is no dispatch, and the page says the first session is being recorded.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dispatchProblems, screenTree, urlProblems } from './lab-dispatch-publish.mjs';

export const SITE_URL = 'https://odin-labs-ai.github.io/odin-rnd/';
export const LAB_FILE = 'data/labs/agent-space.json';
export const DISPATCH_DIR = 'data/labs/agent-space/dispatches';
// Where a follow link may point: exactly these hosts (on github.com only this lab's repository). Anything else is refused.
export const FOLLOW_HOSTS = ['www.linkedin.com', 'linkedin.com', 'www.reddit.com', 'reddit.com', 'x.com', 'twitter.com', 'github.com'];

const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const time = date => `<time datetime="${escape(date)}">${escape(new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</time>`;

/** The lab's words, checked for shape: a follow link is a real URL or null ("coming soon"), never a placeholder. */
export function readLab(root = 'site') {
  const lab = JSON.parse(readFileSync(join(root, LAB_FILE), 'utf8'));
  const problems = [];
  if (lab.format !== 'odin-lab' || lab.version !== 1 || lab.slug !== 'agent-space') problems.push('not odin-lab v1 for agent-space');
  for (const key of ['label', 'title', 'oneLine', 'whyItMatters', 'boundary', 'comingSoon']) if (typeof lab[key] !== 'string' || !lab[key]) problems.push(`${key} is missing`);
  for (const key of ['whatItIs', 'howItWorks']) if (!Array.isArray(lab[key]) || !lab[key].length || !lab[key].every(line => typeof line === 'string' && line)) problems.push(`${key} is missing`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lab.since ?? '')) problems.push('since is not a date');
  if (!/^https:\/\/github\.com\/odin-labs-ai\/odin-rnd\/issues\/new\?template=ask-the-agents\.yml$/.test(lab.ask?.url ?? '')) problems.push('ask.url is not the ask-the-agents form');
  if (!Array.isArray(lab.follow) || !lab.follow.length) problems.push('follow is missing');
  // A follow link is null ("coming soon") or a URL on FOLLOW_HOSTS whose host, path and query pass the screen.
  for (const [i, link] of (lab.follow ?? []).entries()) {
    if (link.url !== null) problems.push(...urlProblems(link.url, FOLLOW_HOSTS).map(reason => `follow/${i}/url: ${reason}`));
  }
  problems.push(...urlProblems(lab.ask?.url, ['github.com'], { templates: true }).map(reason => `ask/url: ${reason}`));
  // Every other string is screened as page text (the URLs above were screened as URLs).
  const { ask: { url: askUrl, ...ask } = {}, follow = [], ...words } = lab;
  problems.push(...screenTree({ ...words, ask, follow: follow.map(({ url, ...rest }) => rest) }, LAB_FILE));
  if (problems.length) throw new Error(`${LAB_FILE}:\n  ${problems.join('\n  ')}`);
  return lab;
}

/** Every committed dispatch, newest first; the build fails on one that does not match the schema or the screen. */
export function readDispatches(root = 'site') {
  const dir = join(root, DISPATCH_DIR);
  if (!existsSync(dir)) return [];
  const dispatches = [];
  const problems = [];
  for (const name of readdirSync(dir).filter(name => !name.startsWith('.')).sort()) {
    const file = `${DISPATCH_DIR}/${name}`;
    if (!name.endsWith('.json')) { problems.push(`${file}: only <session>.json files belong here`); continue; }
    const dispatch = JSON.parse(readFileSync(join(root, file), 'utf8'));
    // The publisher's own checks, run again: a hand-written dispatch fails the build exactly as it fails to publish.
    problems.push(...dispatchProblems(dispatch, file, root));
    if (dispatch.session !== name.slice(0, -'.json'.length)) problems.push(`${file}: the file name is not its session`);
    dispatches.push(dispatch);
  }
  if (problems.length) throw new Error(`Lab dispatches refused:\n  ${problems.join('\n  ')}`);
  return dispatches.sort((a, b) => b.date.localeCompare(a.date) || b.session.localeCompare(a.session));
}

export const SOURCE_KIND = { 'world-checked': 'Something it can see in the world', wiki: 'A page it has read', tool: 'A tool it used' };
/** Where an answer came from, in the words its card on the page uses. */
export const sourceKind = source => SOURCE_KIND[source] ?? `Source: ${source}`;

// Headings nest: Dispatches (h2) > the latest session (h3) > its questions (h4); Earlier sessions (h3) > a session (h4) > its questions (h5).
function dispatchCards(dispatch, level) {
  return dispatch.questions.map(q => `<article class="lab-card"><p class="lab-card-to">Asked ${escape(q.to)}${q.followUp ? ', as a follow-up' : ''}</p><h${level} class="lab-card-question">${escape(q.text)}</h${level}><p class="lab-card-answer">${escape(q.answer)}</p>${q.why ? `<p class="lab-card-why"><strong>Why:</strong> ${escape(q.why)}</p>` : ''}<p class="lab-card-source"><span>${escape(sourceKind(q.source))}</span><code>evidence ${escape(q.evidence)}</code></p></article>`).join('');
}

function dispatchBlock(dispatch, up, latest) {
  const heading = latest ? 'h3' : 'h4', card = latest ? 4 : 5;
  return `<article class="lab-dispatch${latest ? ' lab-dispatch-latest' : ''}" id="${escape(dispatch.session)}"><${heading}>Session of ${time(dispatch.date)}</${heading}><figure class="lab-dispatch-media"><video controls preload="none" playsinline poster="${up}${escape(dispatch.poster)}" aria-label="Recorded session of the agent space, ${escape(dispatch.date)}: the agents answer the questions below"><source src="${up}${escape(dispatch.clip.src)}" type="video/webm"></video><figcaption>Recorded live, no sound.</figcaption></figure><div class="lab-cards">${dispatchCards(dispatch, card)}</div></article>`;
}

/** The dispatches section: the latest first with its recording and cards, older ones below; or the first-session note. */
export function renderDispatches(lab, dispatches, up = '../../') {
  if (!dispatches.length) return `<div class="lab-empty" id="no-dispatch"><p class="technical">NO DISPATCH YET</p><p>${escape(lab.comingSoon)}</p></div>`;
  const [latest, ...older] = dispatches;
  return dispatchBlock(latest, up, true) + (older.length ? `<div class="lab-older"><h3>Earlier sessions</h3>${older.map(d => dispatchBlock(d, up, false)).join('')}</div>` : '');
}

export function renderFollow(lab) {
  const items = lab.follow.map(link => link.url
    ? `<li><a href="${escape(link.url)}">${escape(link.channel)} <span aria-hidden="true">↗</span></a></li>`
    : `<li><span class="lab-soon">${escape(link.channel)}</span> <span class="technical">COMING SOON</span></li>`);
  items.push('<li><a href="feed.xml">Feed (Atom)</a></li>');
  return `<ul class="lab-follow">${items.join('')}</ul>`;
}

export function renderIntro(lab) {
  return `<span class="technical">${escape(lab.label.toUpperCase())} · ${escape(lab.title.toUpperCase())}</span><h1 id="lab-title">${escape(lab.title)}.</h1><p class="company-lead">${escape(lab.oneLine)}</p><div class="company-actions"><a class="button button-primary" id="ask-the-agents" href="${escape(lab.ask.url)}">${escape(lab.ask.label)}</a><a href="#follow">Follow the lab</a></div><p class="lab-ask-note">${escape(lab.ask.note)}</p>`;
}

export function renderAbout(lab) {
  return `${lab.whatItIs.map(line => `<p>${escape(line)}</p>`).join('')}<h3>Why it matters</h3><p>${escape(lab.whyItMatters)}</p><h3>How a question becomes a dispatch</h3><ol class="lab-steps">${lab.howItWorks.map(line => `<li>${escape(line)}</li>`).join('')}</ol><p class="lab-boundary">${escape(lab.boundary)}</p>`;
}

export function renderLabsList(lab, dispatches) {
  const latest = dispatches[0] ? `Latest session: ${time(dispatches[0].date)}.` : 'The first session is being recorded.';
  return `<a class="lab-tile" href="agent-space/"><span class="technical">${escape(lab.label.toUpperCase())}</span><h2>${escape(lab.title)}</h2><p>${escape(lab.oneLine)}</p><p class="lab-tile-status">${latest}</p></a>`;
}

const xml = v => escape(v).replaceAll("'", '&apos;');

/** The Atom feed: one entry per dispatch, newest first. Its time is the latest dispatch's date, so a rebuild with no new dispatch writes the same bytes. */
export function renderFeed(lab, dispatches) {
  const page = `${SITE_URL}labs/agent-space/`;
  const updated = `${dispatches[0]?.date ?? lab.since}T00:00:00Z`;
  const entries = dispatches.map(d => `<entry><id>${page}#${xml(d.session)}</id><title>${xml(`${lab.title}: session of ${d.date}`)}</title><updated>${d.date}T00:00:00Z</updated><link rel="alternate" type="text/html" href="${page}#${xml(d.session)}"/><summary>${xml(d.questions.map(q => q.text).join(' · '))}</summary></entry>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><id>${page}</id><title>${xml(`Odin Labs R&D · ${lab.label}: ${lab.title}`)}</title><subtitle>${xml(lab.oneLine)}</subtitle><updated>${updated}</updated><link rel="self" type="application/atom+xml" href="${page}feed.xml"/><link rel="alternate" type="text/html" href="${page}"/><author><name>Odin Labs R&amp;D</name></author>${entries}</feed>\n`;
}

/** The rendered Labs pages and feed, keyed by their dist/ path. */
export function renderLabs(root = 'site') {
  const lab = readLab(root);
  const dispatches = readDispatches(root);
  const fill = (template, values) => {
    let html = readFileSync(join(root, template), 'utf8');
    for (const [marker, value] of Object.entries(values)) {
      if (!html.includes(marker)) throw new Error(`${template}: ${marker} is missing`);
      html = html.replace(marker, () => value);
    }
    if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${template}: unresolved content marker`);
    return html;
  };
  return {
    'labs/index.html': fill('labs/index.html', { '<!--LABS_LIST-->': renderLabsList(lab, dispatches) }),
    'labs/agent-space/index.html': fill('labs/agent-space/index.html', {
      '<!--LAB_INTRO-->': renderIntro(lab), '<!--LAB_ABOUT-->': renderAbout(lab),
      '<!--LAB_DISPATCHES-->': renderDispatches(lab, dispatches), '<!--LAB_FOLLOW-->': renderFollow(lab),
    }),
    'labs/agent-space/feed.xml': renderFeed(lab, dispatches),
  };
}
