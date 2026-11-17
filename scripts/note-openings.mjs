/*
 * Field note openings, and each plan paired with its result (mission rnd-site-human PR 4, 2026-11-17; the founder found
 * the site "too technical / jargon" and "hard to navigate"; PLAN A4). Every field note the Notes & updates page lists
 * (dist/journal/*.html) opens, right after its own header, the way every lab page does since PR 3: "In short" (two plain
 * sentences), "What we found" (or, for a plan not run yet, "Not run yet: what would count as a yes"), "Why it matters"
 * and a one-line "Limit", then the note exactly as its generator wrote it. The words come from site/data/note-openings.json
 * and are rendered by renderOpening() in scripts/lab-pages.mjs, so they fail closed on the same rules: plain words carry
 * no digit and no number word, a number is a verbatim quote of the same note or a value read from a measured record,
 * the banned lab words stop the build, and the first use of each mapped word links its glossary entry on How we test.
 *
 * Plans and results: the config's `pairs` name each written plan (a plan note or the plan's record) and the note that
 * holds its result. Both notes' openings link the pair, and the build checks that the plan, where it is a page, links
 * its result (the opening is that link for EXP 009's plan, whose frozen page never did) and that the result links back.
 *
 * The same pass folds the record's identifiers out of the reading line, verbatim: every paragraph, table, block of code
 * or list in the note's body that cites a hash, a commit, a run id or the "matching hash is not independent validation"
 * text goes into a closed native <details> titled "How we checked" (a list keeps its items in view when only some cite
 * one: those items' text is folded inside them). A block that states a verdict, a status, a failure, a limit or a
 * correction stays in view, identifiers and all, unless it is the record's own provenance line. Headings stay in view, and nothing is reworded or removed: taking the
 * fold tags and the opening out gives back the note byte for byte (withoutNoteOpening). Built pages only: site/journal/
 * stays exactly its generators' output, so every byte pin of a frozen note still holds.
 *
 * scripts/site-sections.mjs renderSectionPages runs openNotePages() over dist/ (scripts/build.mjs is pinned by the
 * witness records, so it is not changed); it is required on the published site and a no-op on a test dist without notes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockText, CHECKED_OPEN, CHECKED_SUMMARY, elementEnd, glossaryIds, pageLinks, renderOpening, siteReader, unfoldChecks } from './lab-pages.mjs';

export const NOTE_OPENINGS_CONFIG = 'data/note-openings.json';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The published build's dist/ (where the openings are required). */
export const REPO_DIST = join(REPO, 'dist');

/** A note's opening, as openNotePages() puts it right after the note's own header. */
export const NOTE_OPENING_SECTION = /<section class="note-opening lab-opening" id="in-short"[\s\S]*?<\/section>/;
/** openNotePages() undone on one note: its folds' tags and its opening out, nothing else (the generator's page). */
export const withoutNoteOpening = html => unfoldChecks(html).replace(NOTE_OPENING_SECTION, '');

const CHECKED_CLOSE = '</details>';
// What a note folds: a hash or digest, a commit, a run id, or the hash disclaimer (as lab pages fold them, plus run ids).
const IDENTIFIER = /\b[0-9a-f]{12,64}\b|\bsha-?256\b|\bcommit [0-9a-f]{7,}\b|independent(?:ly)? validat|matching (?:record )?hash|\b(?:workflow )?run (?:id )?#?\d{8,}\b|\battempt \d+ of run\b/i;
const RUN_LINK = /\/actions\/runs\/\d+/;
// A block that states a verdict, a status, a failure, a limit or a correction stays in view even when it cites an
// identifier, unless it is the record's own provenance line ("This page is rendered from …", the hash disclaimer).
const STATES = /\b(?:refuted|supported|establish(?:es|ed)?|corrections?|corrected|errat(?:um|a)|stands|status|complete|stopped|failed|fails|limits?|limitations?)\b/i;
const PROVENANCE = /^(?:This (?:page|section) is rendered from|Provenance\b)|independent(?:ly)? validat|matching (?:record )?hash/i;
const cites = fragment => {
  const text = blockText(fragment);
  if (!IDENTIFIER.test(text) && !RUN_LINK.test(fragment)) return false;
  return PROVENANCE.test(text) || !STATES.test(text);
};
const BLOCKS = /<(p|pre|table|dl|blockquote|figure)\b[^>]*>|<div class="table-scroll"[^>]*>/g;
const LISTS = /<(ul|ol)\b[^>]*>/g;
const HEADING = /<h[1-6]\b/i;

/** [start, end] of the note's <article class="article-body">. */
function bodySpan(html, label) {
  const at = html.indexOf('<article class="article-body">');
  if (at < 0 || html.indexOf('<article class="article-body">', at + 1) >= 0) throw new Error(`Note opening: ${label} needs exactly one article body`);
  return [at, elementEnd(html, at)];
}

/** The note `html` with its record identifiers folded under "How we checked" (see the header). Idempotent. */
export function foldNoteChecks(html, label = 'note') {
  if (html.includes(CHECKED_OPEN)) return html;
  const [from, to] = bodySpan(html, label);
  const within = (r, list) => list.some(o => o !== r && o[0] <= r[0] && r[1] <= o[1]);
  const details = [...html.slice(from, to).matchAll(/<details\b/g)].map(m => [from + m.index, elementEnd(html, from + m.index)]);
  const wraps = []; // [start, end] of a whole element
  const inner = []; // [start, end] of a list item's content
  const spans = re => [...html.slice(from, to).matchAll(re)].map(m => [from + m.index, elementEnd(html, from + m.index)]);
  for (const [s, e] of spans(BLOCKS)) if (!HEADING.test(html.slice(s, e)) && cites(html.slice(s, e))) wraps.push([s, e]);
  for (const [s, e] of spans(LISTS)) {
    const list = html.slice(s, e);
    if (HEADING.test(list)) continue;
    const items = [];
    for (const m of list.matchAll(/<li\b[^>]*>/g)) {
      const start = s + m.index;
      if (items.some(([a, b]) => a < start && start < b)) continue; // a nested list's item
      items.push([start, elementEnd(html, start), m[0].length]);
    }
    if (!items.length) continue;
    const citing = items.filter(([a, b]) => cites(html.slice(a, b)));
    if (citing.length === items.length) wraps.push([s, e]);
    else for (const [a, b, open] of citing) inner.push([a + open, b - '</li>'.length]);
  }
  const all = [...wraps, ...inner];
  const keep = all.filter(r => !within(r, all) && !within(r, details)).sort((a, b) => a[0] - b[0]);
  // Neighbouring whole elements with nothing but white space between them share one fold.
  const merged = [];
  for (const r of keep) {
    const last = merged[merged.length - 1];
    if (last && wraps.includes(r) && last.whole && !html.slice(last[1], r[0]).trim()) last[1] = r[1];
    else merged.push(Object.assign([...r], { whole: wraps.includes(r) }));
  }
  let out = html;
  for (const [start, end] of merged.reverse()) out = `${out.slice(0, start)}${CHECKED_OPEN}${out.slice(start, end)}${CHECKED_CLOSE}${out.slice(end)}`;
  return out;
}

/** The end of the note's own header (the first </header> after <header class="article-header">). */
function headerEnd(html, label) {
  const open = html.indexOf('<header class="article-header"');
  const close = open < 0 ? -1 : html.indexOf('</header>', open);
  if (close < 0) throw new Error(`Note opening: ${label} has no article header`);
  return close + '</header>'.length;
}

/** The config's pairs, checked for shape: [{ exp, plan, result }], each a site-root-relative path. */
export function notePairs(config) {
  const pairs = config.pairs ?? [];
  if (!Array.isArray(pairs)) throw new Error(`site/${NOTE_OPENINGS_CONFIG}: pairs is a list`);
  for (const [i, p] of pairs.entries()) {
    if (!/^EXP \d{3}$/.test(p?.exp ?? '') || typeof p.plan !== 'string' || typeof p.result !== 'string') throw new Error(`site/${NOTE_OPENINGS_CONFIG}: pairs[${i}] needs an exp ("EXP 009"), a plan and a result`);
    if (!/^journal\/[a-z0-9-]+\.html$/.test(p.result)) throw new Error(`site/${NOTE_OPENINGS_CONFIG}: pairs[${i}] result ${p.result} is not a field note`);
    if (!/^(?:journal\/[a-z0-9-]+\.html|data\/[a-z0-9-]+\/preregistration\.json)$/.test(p.plan)) throw new Error(`site/${NOTE_OPENINGS_CONFIG}: pairs[${i}] plan ${p.plan} is not a field note or a plan's record`);
  }
  return pairs;
}

/** The opening's pairs for the note at `rel`, in renderOpening's shape (labels in words, EXP numbers kept). */
function pairsFor(rel, pairs) {
  return pairs.filter(p => p.plan === rel || p.result === rel).map(p => ({
    plan: { href: p.plan, label: `${p.exp}: the plan${p.plan.endsWith('.json') ? ' (its record)' : ''}` },
    result: { href: p.result, label: p.result === rel ? 'its result: this note' : 'its result' },
  }));
}

/**
 * One note with its opening and folds. `source` is the note as built so far; `pageText` for the quotes is its main text.
 */
export function openNote(read, rel, source, opening, { pairs = [], ids = null } = {}) {
  if (source.includes('id="in-short"')) throw new Error(`Note opening: ${rel} already has an opening`);
  for (const id of ['in-short-title', 'opening-found', 'opening-why']) if (source.includes(`id="${id}"`)) throw new Error(`Note opening: ${rel} already uses the id ${id}`);
  const main = source.slice(source.indexOf('<main'), source.indexOf('</main>'));
  const folded = foldNoteChecks(source, rel);
  const more = folded === source
    ? 'The full note follows, unchanged. Lab words link to <a href="../methods/#glossary">what they mean</a>.'
    : `The full note follows, unchanged. Lab words link to <a href="../methods/#glossary">what they mean</a>, and the record’s identifiers sit under “${CHECKED_SUMMARY}”.`;
  const section = renderOpening(read, rel, { ...opening, ...(pairsFor(rel, pairs).length ? { pairs: pairsFor(rel, pairs) } : {}) }, { pageText: blockText(main), up: '../', glossaryIds: ids, shell: 'note', config: NOTE_OPENINGS_CONFIG, more });
  const at = headerEnd(folded, rel);
  return folded.slice(0, at) + section + folded.slice(at);
}

/**
 * Every field note under `distDir`/journal/ opened and folded, in place. A note with no opening in the config, an opening
 * for a note that is not built, or a plan and result that do not link each other stops the build. A dist without the
 * config's notes (a test fixture) is left as it is, unless `required` (the published site). Returns the notes it opened.
 */
export function openNotePages({ distDir, root = join(REPO, 'site'), read = siteReader(root), required = resolve(distDir) === REPO_DIST } = {}) {
  const dir = join(distDir, 'journal');
  const notes = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.html') && n !== 'index.html').map(n => `journal/${n}`).sort() : [];
  if (!existsSync(join(root, NOTE_OPENINGS_CONFIG))) {
    if (required) throw new Error(`site/${NOTE_OPENINGS_CONFIG} is required on the published site: every field note opens with it`);
    return [];
  }
  const config = read(NOTE_OPENINGS_CONFIG);
  if (!config?.notes || typeof config.notes !== 'object') throw new Error(`site/${NOTE_OPENINGS_CONFIG}: no notes`);
  const configured = Object.keys(config.notes).sort();
  if (!required && !notes.some(n => configured.includes(n))) return [];
  const missing = notes.filter(n => !configured.includes(n)), extra = configured.filter(n => !notes.includes(n));
  if (missing.length) throw new Error(`site/${NOTE_OPENINGS_CONFIG}: no opening for ${missing.join(', ')}`);
  if (extra.length) throw new Error(`site/${NOTE_OPENINGS_CONFIG}: an opening for a note that is not built: ${extra.join(', ')}`);
  const pairs = notePairs(config);
  const ids = glossaryIds(root);
  const out = {};
  for (const rel of notes) out[rel] = openNote(read, rel, readFileSync(join(distDir, rel), 'utf8'), config.notes[rel], { pairs, ids });
  for (const p of pairs) {
    for (const href of [p.plan, p.result]) if (!existsSync(join(distDir, href))) throw new Error(`Note opening: ${p.exp} links ${href}, which is not built`);
    const page = href => out[href] ?? readFileSync(join(distDir, href), 'utf8');
    if (p.plan.endsWith('.html') && !pageLinks(page(p.plan), p.plan, p.result)) throw new Error(`Note opening: the plan ${p.plan} does not link its result ${p.result}`);
    if (p.plan !== p.result && !pageLinks(withoutNoteOpening(page(p.result)), p.result, p.plan)) throw new Error(`Note opening: the result ${p.result} does not link back to its plan ${p.plan} in its own text`);
  }
  for (const [rel, html] of Object.entries(out)) writeFileSync(join(distDir, rel), html);
  return Object.keys(out);
}

/** The journal index's word for a note: its place in a plan and result pair ("Result", "Plan, result published",
 *  "Plan, not run yet"), from the config; null for a note that is neither. */
export function noteStage(rel, config) {
  const pairs = notePairs(config);
  if (pairs.some(p => p.result === rel)) return 'Result';
  if (pairs.some(p => p.plan === rel)) return 'Plan, result published';
  if (config.notes?.[rel]?.plan) return 'Plan, not run yet';
  return null;
}
