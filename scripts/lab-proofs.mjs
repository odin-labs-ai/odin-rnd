// The proof-card explorer on Lab 01 (mission rnd-labs-human-first-1024, founder plan 8): every proof id a published
// dispatch shows gets an entry at labs/agent-space/proofs/#proof-<id>, with that proof's screened record exactly as the
// dispatch publishes it (for each question that cites it: who was asked, the question, the answer, the why, the source
// kind and the evidence id) plus the still of that moment and the session's clip, when they are published.
//
// Source: only the dispatches under site/data/labs/agent-space/dispatches/, read through readDispatches() in
// scripts/labs.mjs, which already refuses one that misses its schema or the publisher's screen. Nothing unpublished.
// The build fails, and nothing is rendered, when:
//   - a field shown in an entry is not byte for byte the published string (proofProblems re-reads every
//     data-field element of the rendered page, un-escapes it and compares it with the dispatch);
//   - any visible text of the page body (header, main and footer, and image alt text) fails the publisher's screen,
//     or the page has no body or main to check;
//   - a question shows a still other than the one its dispatch publishes for it (stills/NN-<question id>.png), or the
//     page shows any other image;
//   - a proof id the dispatches show has no entry, or an entry names a proof no dispatch shows.
// Links into the explorer (the dispatch cards on Lab 01, the story page's proof evidence) are site-relative anchors, so
// scripts/check.mjs refuses one that does not resolve to an entry.
import { screenHits } from './lab-dispatch-publish.mjs';

export const PROOFS_PAGE = 'labs/agent-space/proofs/index.html';
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unescape = v => v.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
// The plain-language name of each source kind: one map, shared with the dispatch cards (scripts/labs.mjs re-exports it).
export const SOURCE_KIND = { 'world-checked': 'Something it can see in the world', wiki: 'A page it has read', tool: 'A tool it used' };
export const sourceKind = source => SOURCE_KIND[source] ?? `Source: ${source}`;
const FIELDS = ['to', 'text', 'answer', 'why', 'source', 'evidence'];

/** The anchor of one proof's entry. Proof ids are lowercase letters, digits and hyphens (the dispatch schema). */
export const proofAnchor = id => `proof-${id}`;

/** Every proof id the dispatches show, in first-shown order, each with the questions (and their dispatch) that cite it. */
export function proofIndex(dispatches) {
  const index = new Map();
  for (const dispatch of dispatches) {
    for (const question of dispatch.questions) {
      if (!index.has(question.evidence)) index.set(question.evidence, []);
      index.get(question.evidence).push({ dispatch, question });
    }
  }
  return index;
}

/** The still of a question's moment: the one dispatch still named stills/NN-<question id>.png, or null. */
export function stillFor(dispatch, question) {
  const name = new RegExp(`/stills/\\d{2}-${question.id.replace(/[^a-z0-9-]/g, '')}\\.png$`);
  const found = dispatch.stills.filter(still => name.test(still));
  return found.length === 1 ? found[0] : null;
}

const field = (name, key, value) => `<span data-field="${escape(key)}/${name}">${escape(value)}</span>`;

function citation({ dispatch, question }, up) {
  const key = `${dispatch.session}/${question.id}`;
  const still = stillFor(dispatch, question);
  const media = still
    ? `<figure class="proof-still"><img data-still="${escape(key)}" src="${up}${escape(still)}" width="1280" height="720" loading="lazy" alt="The moment in the recording where this question is answered"><figcaption>From the <a href="${up}${escape(dispatch.clip.src)}">session recording</a>.</figcaption></figure>`
    : `<p class="proof-film">In the <a href="${up}${escape(dispatch.clip.src)}">session recording</a>.</p>`;
  return `<div class="proof-citation"><p class="proof-where">Session of <time datetime="${escape(dispatch.date)}">${escape(dispatch.date)}</time> · <a href="../#${escape(dispatch.session)}">the dispatch</a>${question.followUp ? ' · a follow-up' : ''}</p><dl class="proof-record"><div><dt>Asked</dt><dd>${field('to', key, question.to)}</dd></div><div><dt>Question</dt><dd>${field('text', key, question.text)}</dd></div><div><dt>Answer</dt><dd>${field('answer', key, question.answer)}</dd></div><div><dt>Why</dt><dd>${field('why', key, question.why)}</dd></div><div><dt>Source kind</dt><dd>${field('source', key, question.source)} <span class="proof-plain">(${escape(sourceKind(question.source))})</span></dd></div><div><dt>Evidence id</dt><dd><code>${field('evidence', key, question.evidence)}</code></dd></div></dl>${media}</div>`;
}

/** The explorer: one entry per proof id, its record as published. `up` is the way from the page to the site root. */
export function renderProofs(dispatches, up = '../../../') {
  const index = proofIndex(dispatches);
  if (!index.size) return '<div class="lab-empty" id="no-proof"><p class="technical">NO PROOF CARD YET</p><p>When the first session is published, its proof cards appear here.</p></div>';
  const entries = [...index].map(([id, cites]) => `<article class="proof-entry" id="${escape(proofAnchor(id))}" aria-labelledby="${escape(proofAnchor(id))}-title"><h2 id="${escape(proofAnchor(id))}-title"><code>${escape(id)}</code></h2><p class="proof-count">${cites.length === 1 ? 'Shown on one card.' : `Shown on ${cites.length} cards.`}</p>${cites.map(c => citation(c, up)).join('')}</article>`);
  return `<nav class="proof-index" aria-label="All proof cards"><ul>${[...index.keys()].map(id => `<li><a href="#${escape(proofAnchor(id))}"><code>${escape(id)}</code></a></li>`).join('')}</ul></nav>${entries.join('')}`;
}

/** Why the rendered explorer may not be published (empty when it may): byte-for-byte fields, coverage and the screen. */
export function proofProblems(html, dispatches, up = '../../../') {
  const problems = [];
  // The page must have its parts, or the checks below would read nothing and pass.
  for (const tag of ['<body', '</body>', '<main', '</main>']) if (!html.includes(tag)) problems.push(`${PROOFS_PAGE}: no ${tag} in the page; nothing can be checked`);
  if (problems.length) return problems;
  const index = proofIndex(dispatches);
  const byKey = new Map(dispatches.flatMap(d => d.questions.map(q => [`${d.session}/${q.id}`, q])));
  const seen = new Set();
  for (const [, key, name, value] of html.matchAll(/<span data-field="([^"/]+\/[^"/]+)\/([a-z]+)">([^<]*)<\/span>/g)) {
    const question = byKey.get(unescape(key));
    seen.add(`${unescape(key)}/${name}`);
    if (!question) problems.push(`${PROOFS_PAGE}: ${key} is not a question of a published dispatch`);
    else if (!FIELDS.includes(name)) problems.push(`${PROOFS_PAGE}: ${key}/${name} is not a published field`);
    else if (unescape(value) !== question[name]) problems.push(`${PROOFS_PAGE}: ${key}/${name} is not the published text, byte for byte`);
  }
  for (const [key, question] of byKey) for (const name of FIELDS) if (!seen.has(`${key}/${name}`)) problems.push(`${PROOFS_PAGE}: ${key}/${name} (proof ${question.evidence}) is not shown`);
  const anchors = new Set([...html.matchAll(/<article class="proof-entry" id="proof-([a-z0-9-]+)"/g)].map(m => m[1]));
  for (const id of index.keys()) if (!anchors.has(id)) problems.push(`${PROOFS_PAGE}: proof ${id} has no entry`);
  for (const id of anchors) if (!index.has(id)) problems.push(`${PROOFS_PAGE}: an entry for proof ${id}, which no published dispatch shows`);
  // Stills: each question shows exactly the still its dispatch publishes for it (or none), and the page shows no other.
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  for (const tag of imgs) if (!/\bdata-still="[^"]+"/.test(tag)) problems.push(`${PROOFS_PAGE}: an image that is not a dispatch still (${tag.slice(0, 80)})`);
  for (const d of dispatches) for (const q of d.questions) {
    const key = `${d.session}/${q.id}`, want = stillFor(d, q);
    const shown = imgs.filter(tag => tag.includes(`data-still="${escape(key)}"`)).map(tag => unescape(tag.match(/\bsrc="([^"]*)"/)?.[1] ?? ''));
    if (want === null && shown.length) problems.push(`${PROOFS_PAGE}: ${key} shows a still, but its dispatch publishes none for it`);
    if (want !== null && (shown.length !== 1 || shown[0] !== `${up}${want}`)) problems.push(`${PROOFS_PAGE}: ${key} does not show exactly its published still (${want})`);
  }
  // The screen over everything a visitor reads: every text node of the body, and every image's alt text.
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  const alts = [...body.matchAll(/\balt="([^"]*)"/g)].map(m => m[1]);
  const text = [...unescape(body.replace(/<[^>]*>/g, '\n')).split('\n'), ...alts.map(unescape)].map(s => s.trim()).filter(Boolean);
  for (const line of text) for (const hit of screenHits(line)) problems.push(`${PROOFS_PAGE}: ${hit.reason} in ${JSON.stringify(line.slice(0, 80))}`);
  return problems;
}
