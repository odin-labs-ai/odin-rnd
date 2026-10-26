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
//   - any visible text of the page fails the publisher's screen;
//   - a proof id the dispatches show has no entry, or an entry names a proof no dispatch shows.
// Links into the explorer (the dispatch cards on Lab 01, the story page's proof evidence) are site-relative anchors, so
// scripts/check.mjs refuses one that does not resolve to an entry.
import { screenHits } from './lab-dispatch-publish.mjs';

export const PROOFS_PAGE = 'labs/agent-space/proofs/index.html';
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unescape = v => v.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const SOURCE_KIND = { 'world-checked': 'Something it can see in the world', wiki: 'A page it has read', tool: 'A tool it used' };
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

/** The still of a question's moment: the dispatch still whose name carries the question id (NN-<question id>.png). */
const stillFor = (dispatch, question) => dispatch.stills.find(still => still.endsWith(`-${question.id}.png`)) ?? null;

const field = (name, key, value) => `<span data-field="${escape(key)}/${name}">${escape(value)}</span>`;

function citation({ dispatch, question }, up) {
  const key = `${dispatch.session}/${question.id}`;
  const still = stillFor(dispatch, question);
  const media = still
    ? `<figure class="proof-still"><img src="${up}${escape(still)}" width="1280" height="720" loading="lazy" alt="The moment in the recording where this question is answered"><figcaption>From the <a href="${up}${escape(dispatch.clip.src)}">session recording</a>.</figcaption></figure>`
    : `<p class="proof-film">In the <a href="${up}${escape(dispatch.clip.src)}">session recording</a>.</p>`;
  return `<div class="proof-citation"><p class="proof-where">Session of <time datetime="${escape(dispatch.date)}">${escape(dispatch.date)}</time> · <a href="../#${escape(dispatch.session)}">the dispatch</a>${question.followUp ? ' · a follow-up' : ''}</p><dl class="proof-record"><div><dt>Asked</dt><dd>${field('to', key, question.to)}</dd></div><div><dt>Question</dt><dd>${field('text', key, question.text)}</dd></div><div><dt>Answer</dt><dd>${field('answer', key, question.answer)}</dd></div><div><dt>Why</dt><dd>${field('why', key, question.why)}</dd></div><div><dt>Source kind</dt><dd>${field('source', key, question.source)} <span class="proof-plain">(${escape(SOURCE_KIND[question.source] ?? 'as recorded')})</span></dd></div><div><dt>Evidence id</dt><dd><code>${field('evidence', key, question.evidence)}</code></dd></div></dl>${media}</div>`;
}

/** The explorer: one entry per proof id, its record as published. `up` is the way from the page to the site root. */
export function renderProofs(dispatches, up = '../../../') {
  const index = proofIndex(dispatches);
  if (!index.size) return '<div class="lab-empty" id="no-proof"><p class="technical">NO PROOF CARD YET</p><p>When the first session is published, its proof cards appear here.</p></div>';
  const entries = [...index].map(([id, cites]) => `<article class="proof-entry" id="${escape(proofAnchor(id))}" aria-labelledby="${escape(proofAnchor(id))}-title"><h2 id="${escape(proofAnchor(id))}-title"><code>${escape(id)}</code></h2><p class="proof-count">${cites.length === 1 ? 'Shown on one card.' : `Shown on ${cites.length} cards.`}</p>${cites.map(c => citation(c, up)).join('')}</article>`);
  return `<nav class="proof-index" aria-label="All proof cards"><ul>${[...index.keys()].map(id => `<li><a href="#${escape(proofAnchor(id))}"><code>${escape(id)}</code></a></li>`).join('')}</ul></nav>${entries.join('')}`;
}

/** Why the rendered explorer may not be published (empty when it may): byte-for-byte fields, coverage and the screen. */
export function proofProblems(html, dispatches) {
  const problems = [];
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
  // The screen over everything a visitor reads: every text node of the main content.
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const text = unescape(main.replace(/<[^>]*>/g, '\n')).split('\n').map(s => s.trim()).filter(Boolean);
  for (const line of text) for (const hit of screenHits(line)) problems.push(`${PROOFS_PAGE}: ${hit.reason} in ${JSON.stringify(line.slice(0, 80))}`);
  return problems;
}
