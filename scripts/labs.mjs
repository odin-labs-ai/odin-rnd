// Labs: long-running projects people follow and take part in (mission rnd-labs-human-first-1024, vision-plan bundle 2).
// Lab 01 is the agent space. scripts/build.mjs calls renderLabs() after it copies site/ to dist/ and writes, into dist/
// only (nothing rendered is committed):
//   labs/index.html               the Labs index, from site/labs/index.html (<!--LABS_LIST-->)
//   labs/agent-space/index.html   the lab page, from site/labs/agent-space/index.html (<!--LAB_*--> markers)
//   labs/agent-space/feed.xml     an Atom feed with one entry per dispatch
//   labs/brain-bench/index.html   Lab 02's page, rendered by scripts/brain-bench.mjs
// Lab 01's "How this site got built" section comes from site/data/labs/delivery/odin-rnd.json (scripts/lab-delivery.mjs).
// The lab's words come from site/data/labs/agent-space.json; under site/data/labs/agent-space/, its films from films.json
// (scripts/lab-films.mjs), the space's own measurements from telemetry.json (scripts/lab-telemetry.mjs), the counts of
// its published records from counts.json (scripts/lab-counts.mjs), "The hard parts" from
// hard-parts.json (readHardParts); its dispatches from
// site/data/labs/agent-space/dispatches/<session>.json, as scripts/lab-dispatch-publish.mjs writes them. Every dispatch
// must match scripts/schemas/odin-lab-dispatch.schema.json and pass the publisher's screen again, or the build fails.
// Until a screened session exists there is no dispatch, and the page says the first session is being recorded.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchProblems, isLabLink, screenHits, screenTree, urlProblems } from './lab-dispatch-publish.mjs';
import { readDelivery, renderDelivery } from './lab-delivery.mjs';
import { readFilms, renderFilms } from './lab-films.mjs';
import { readTelemetry, renderTelemetry } from './lab-telemetry.mjs';
import { readCounts, renderCounts } from './lab-counts.mjs';
import { STORY_PAGE, readMilestones, renderStoryLink, storyValues } from './lab-milestones.mjs';
import { readFitMap, renderFitMap } from './lab-fit-map.mjs';
import { readTiles, renderTile } from './lab-tiles.mjs';
import { PROOFS_PAGE, proofAnchor, proofProblems, renderProofs, SOURCE_KIND, sourceKind } from './lab-proofs.mjs';
import { NOTES as BENCH_NOTES, renderBench } from './brain-bench.mjs';

// The site this repository publishes, where Lab 02 is required.
const REPO_SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');
export const SITE_URL = 'https://odin-labs-ai.github.io/odin-rnd/';
export const LAB_FILE = 'data/labs/agent-space.json';
export const DISPATCH_DIR = 'data/labs/agent-space/dispatches';
export const HARD_PARTS_FILE = 'data/labs/agent-space/hard-parts.json';
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

/**
 * "The hard parts" (site/data/labs/agent-space/hard-parts.json): what makes the answers checkable, each part linked to
 * the record it stands on — its own page (#anchor, which must land on something there), this lab's repository, or a lab
 * record this site publishes. Its words pass the publisher's screen. Null when there is none.
 */
export function readHardParts(root = 'site') {
  if (!existsSync(join(root, HARD_PARTS_FILE))) return null;
  const record = JSON.parse(readFileSync(join(root, HARD_PARTS_FILE), 'utf8'));
  const problems = [];
  if (record.format !== 'odin-lab-hard-parts' || record.version !== 1 || record.lab !== 'agent-space') problems.push('not odin-lab-hard-parts v1 for agent-space');
  if (!Array.isArray(record.parts) || !record.parts.length) problems.push('parts is missing');
  for (const [i, part] of (record.parts ?? []).entries()) {
    if (typeof part.title !== 'string' || !part.title || typeof part.text !== 'string' || !part.text) problems.push(`parts/${i}: a title and a text are required`);
    if (!Array.isArray(part.links) || !part.links.length) problems.push(`parts/${i}/links: link the record it stands on`);
    for (const [j, link] of (part.links ?? []).entries()) {
      const href = link?.href, at = `parts/${i}/links/${j}/href`;
      if (typeof link?.label !== 'string' || !link.label) problems.push(`parts/${i}/links/${j}/label is missing`);
      if (typeof href !== 'string') { problems.push(`${at}: missing`); continue; }
      if (/^#[a-z0-9][a-z0-9-]*$/.test(href)) continue;
      if (/^https:/.test(href) ? !isLabLink(href) : !/^data\/labs\/agent-space\/[a-z0-9/-]+\.json$/.test(href) || !existsSync(join(root, href))) problems.push(`${at}: not this page, this lab's repository or a published lab record`);
      // Being a path, it is not refused as a path; it may still carry no restricted name or place.
      problems.push(...screenHits(href).filter(hit => !/^a (file path|link to)/.test(hit.reason)).map(hit => `${at}: ${hit.reason}`));
    }
  }
  const { parts = [], ...rest } = record;
  problems.push(...screenTree({ ...rest, parts: parts.map(({ links = [], ...part }) => ({ ...part, links: links.map(link => ({ label: link?.label })) })) }, HARD_PARTS_FILE));
  if (problems.length) throw new Error(`${HARD_PARTS_FILE}:\n  ${problems.join('\n  ')}`);
  return record;
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

/** Where an answer came from, in the words its card on the page uses (one map, defined in scripts/lab-proofs.mjs). */
export { SOURCE_KIND, sourceKind };

// Headings nest: Dispatches (h2) > the latest session (h3) > its questions (h4); Earlier sessions (h3) > a session (h4) > its questions (h5).
function dispatchCards(dispatch, level, proofs = false) {
  // With the proof-card explorer published, each card's evidence id links to that proof's entry.
  const evidence = q => proofs ? `<a href="proofs/#${escape(proofAnchor(q.evidence))}"><code>evidence ${escape(q.evidence)}</code></a>` : `<code>evidence ${escape(q.evidence)}</code>`;
  return dispatch.questions.map(q => `<article class="lab-card"><p class="lab-card-to">Asked ${escape(q.to)}${q.followUp ? ', as a follow-up' : ''}</p><h${level} class="lab-card-question">${escape(q.text)}</h${level}><p class="lab-card-answer">${escape(q.answer)}</p>${q.why ? `<p class="lab-card-why"><strong>Why:</strong> ${escape(q.why)}</p>` : ''}<p class="lab-card-source"><span>${escape(sourceKind(q.source))}</span>${evidence(q)}</p></article>`).join('');
}

function dispatchBlock(dispatch, up, latest, proofs = false) {
  const heading = latest ? 'h3' : 'h4', card = latest ? 4 : 5;
  return `<article class="lab-dispatch${latest ? ' lab-dispatch-latest' : ''}" id="${escape(dispatch.session)}"><${heading}>Session of ${time(dispatch.date)}</${heading}><figure class="lab-dispatch-media"><video controls preload="none" playsinline poster="${up}${escape(dispatch.poster)}" aria-label="Recorded session of the agent space, ${escape(dispatch.date)}: the agents answer the questions below"><source src="${up}${escape(dispatch.clip.src)}" type="video/webm"></video><figcaption>Recorded live, no sound.</figcaption></figure><div class="lab-cards">${dispatchCards(dispatch, card, proofs)}</div></article>`;
}

/** The dispatches section: the latest first with its recording and cards, older ones below; or the first-session note. */
export function renderDispatches(lab, dispatches, up = '../../', { proofs = false } = {}) {
  if (!dispatches.length) return `<div class="lab-empty" id="no-dispatch"><p class="technical">NO DISPATCH YET</p><p>${escape(lab.comingSoon)}</p></div>`;
  const [latest, ...older] = dispatches;
  return dispatchBlock(latest, up, true, proofs) + (older.length ? `<div class="lab-older"><h3>Earlier sessions</h3>${older.map(d => dispatchBlock(d, up, false, proofs)).join('')}</div>` : '');
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

/** The hard parts: what makes the answers checkable, each linked to the record it stands on. */
export function renderHardParts(record, up = '../../') {
  if (!record) return '<p class="lab-none">Written up with the next session.</p>';
  const href = h => h.startsWith('#') || h.startsWith('https:') ? h : `${up}${h}`;
  return `<div class="lab-hard">${record.parts.map(part => `<article class="lab-hard-part"><h3>${escape(part.title)}</h3><p>${escape(part.text)}</p><ul class="lab-hard-links">${part.links.map(link => `<li><a href="${escape(href(link.href))}">${escape(link.label)}${link.href.startsWith('https:') ? ' <span aria-hidden="true">↗</span>' : ''}</a></li>`).join('')}</ul></article>`).join('')}</div>`;
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

/** The explorer page, refused on any problem proofProblems finds (a field not the published text, a missing entry, the screen). */
function checkedProofs(html, dispatches) {
  const problems = proofProblems(html, dispatches);
  if (problems.length) throw new Error(`Proof-card explorer refused:\n  ${problems.join('\n  ')}`);
  return html;
}

/** The rendered Labs pages and feed, keyed by their dist/ path. */
export function renderLabs(root = 'site', { requireBench = resolve(root) === REPO_SITE } = {}) {
  const lab = readLab(root);
  const dispatches = readDispatches(root);
  const films = readFilms(root), telemetry = readTelemetry(root), counts = readCounts(root), hardParts = readHardParts(root);
  const story = readMilestones(root);
  // The story page's template ships only with its record: without one, its markers would reach dist/ unfilled.
  if (!story && existsSync(join(root, STORY_PAGE))) throw new Error(`${STORY_PAGE}: the story page ships without its record (data/labs/agent-space/milestones.json)`);
  // Lab 02's page is required on the site this repository publishes: its words missing refuse the build, as a missing
  // tile does (scripts/lab-tiles.mjs). Another root (a test fixture) renders it only when it carries its files.
  if (requireBench && !existsSync(join(root, BENCH_NOTES))) throw new Error(`Lab 02 is required on the published site: ${BENCH_NOTES} is missing`);
  // The proof-card explorer: required on the published site (scripts/lab-proofs.mjs); a fixture renders it only when it
  // carries the template. Its page is checked field by field against the dispatches before it is returned.
  if (resolve(root) === REPO_SITE && !existsSync(join(root, PROOFS_PAGE))) throw new Error(`${PROOFS_PAGE}: the proof-card explorer is required on the published site`);
  const proofs = existsSync(join(root, PROOFS_PAGE));
  const bench = requireBench || existsSync(join(root, BENCH_NOTES)) ? renderBench(root) : { pages: {} };
  const fill = (template, values) => {
    let html = readFileSync(join(root, template), 'utf8');
    for (const [marker, value] of Object.entries(values)) {
      if (!html.includes(marker)) throw new Error(`${template}: ${marker} is missing`);
      html = html.replace(marker, () => value);
    }
    if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${template}: unresolved content marker`);
    // A hard part that links to its own page must land on something there.
    for (const part of template === 'labs/agent-space/index.html' ? hardParts?.parts ?? [] : []) for (const { href } of part.links) {
      if (href.startsWith('#') && !html.includes(` id="${href.slice(1)}"`)) throw new Error(`${HARD_PARTS_FILE}: the link ${href} lands on nothing on the page`);
    }
    return html;
  };
  return {
    'labs/index.html': fill('labs/index.html', {
      // Lab 01's tile, then the experiment labs' tiles, Lab 02 then Lab 03 (scripts/lab-tiles.mjs gates them; the build
      // fails on a problem).
      '<!--LABS_LIST-->': renderLabsList(lab, dispatches) + readTiles(root).map(tile => renderTile(tile)).join(''),
      // "Where each store fits": the vendored fit map (scripts/lab-fit-map.mjs gates it; the build fails on a problem).
      '<!--LABS_FIT_MAP-->': renderFitMap(readFitMap(root)),
    }),
    'labs/agent-space/index.html': fill('labs/agent-space/index.html', {
      '<!--LAB_INTRO-->': renderIntro(lab), '<!--LAB_ABOUT-->': renderAbout(lab),
      '<!--LAB_DISPATCHES-->': renderDispatches(lab, dispatches, '../../', { proofs }),
      // The link to the explorer, only when it is rendered (so it always lands on a page).
      '<!--LAB_PROOFS_LINK-->': proofs ? ' <a href="proofs/">Every proof card, in one place.</a>' : '', '<!--LAB_FOLLOW-->': renderFollow(lab),
      '<!--LAB_FILMS-->': renderFilms(films), '<!--LAB_TELEMETRY-->': renderTelemetry(telemetry, { benchLink: existsSync(join(root, 'labs/brain-bench/index.html')) }), '<!--LAB_COUNTS-->': renderCounts(counts), '<!--LAB_HARD_PARTS-->': renderHardParts(hardParts),
      // "How this site got built": the delivery record (scripts/lab-delivery.mjs gates it; the build fails on a problem).
      '<!--LAB_DELIVERY-->': renderDelivery(readDelivery(root)),
      // "How it was born": a link to the story page, empty while there is no milestones record (scripts/lab-milestones.mjs).
      '<!--LAB_STORY_LINK-->': renderStoryLink(story),
    }),
    // Lab 01's story: its own page, when the milestones record exists (its template ships in site/ only with it).
    ...(story ? { [STORY_PAGE]: fill(STORY_PAGE, storyValues(story)) } : {}),
    ...(proofs ? { [PROOFS_PAGE]: checkedProofs(fill(PROOFS_PAGE, { '<!--LAB_PROOFS-->': renderProofs(dispatches) }), dispatches) } : {}),
    'labs/agent-space/feed.xml': renderFeed(lab, dispatches),
    ...bench.pages,
  };
}
