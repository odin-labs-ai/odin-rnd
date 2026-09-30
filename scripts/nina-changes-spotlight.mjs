// EXP 006's spotlight artefact (REVISION 5): nina's entry in the home page's "Tools leaving the factory" list, next
// after 002 Laya, in the same shape as the Laya project-row. WHETHER it shows is decided only by the pinned gate,
// experiments/nina-changes/spotlight-gate.mjs (refute r2 B1); this file is the markup, unpinned, and every figure in it
// is read from the EXP 006 results record. The upstream PR states come from the committed upstream.json (refreshed by
// scripts/nina-changes-upstream.mjs --refresh before each publish), never typed here.
//
// One nina entry only: it takes the number (005) and the id (project-nina) of EXP 005's gated card, which EXP 005's
// committed decision (held: true, on immutable results) keeps closed for good; this entry supersedes that slot, and
// refuses to add a second one if the page ever carried it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDecision, entryShown } from '../experiments/nina-changes/spotlight-gate.mjs';
import { ninaAttribution } from './jev-gate-prereg.mjs';
import { slug } from './nina-changes-note.mjs';
import { loadUpstream } from './nina-changes-upstream.mjs';

export { entryShown };
export const resultsPath = 'experiments/nina-changes/results/results.json';
export const decisionPath = 'experiments/nina-changes/results/spotlight-decision.json';
export const reviewerRunPath = 'experiments/nina-changes/results/reviewer.json';
export const entryNumber = '005';
export const entryId = 'project-nina';
export const author = 'Marcos Schulz (xhulz)';
export const attributionLine = ninaAttribution.split('— ')[1]; // "used with the permission of its author, as confirmed by Odin Labs"
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };

/** The committed EXP 006 results, its decision (bound to the results by sha256) and the measured date; null while none. */
export function loadEntryData(root = '.') {
  if (!existsSync(join(root, resultsPath))) return null;
  const bytes = readFileSync(join(root, resultsPath));
  const results = JSON.parse(bytes);
  const decision = existsSync(join(root, decisionPath)) ? checkDecision(bytes, JSON.parse(readFileSync(join(root, decisionPath), 'utf8'))) : null;
  const run = existsSync(join(root, reviewerRunPath)) ? JSON.parse(readFileSync(join(root, reviewerRunPath), 'utf8')) : null;
  return { results, decision, measuredOn: run?.endedAt ?? null, upstream: loadUpstream(root).prs };
}

/** nina's entry, or '' when the gate is closed. The Laya row's shape: number + category, title, paragraph, links, note, spec. */
export function renderNinaEntry(data) {
  if (!entryShown(data)) return '';
  const { results: r, measuredOn } = data;
  assert(measuredOn, 'a shown entry needs the measured date from the run record');
  const c = id => r.spotlight.criteria.find(x => x.id === id);
  const rate = x => `${x.x} of ${x.n}`;
  const seen = r.manipulation.countedRuns - r.manipulation.blind;
  const up = data.upstream.map(u => `<a href="https://github.com/${escape(u.repo)}/pull/${u.pr}">${escape(u.repo)}#${u.pr} (${escape(u.state.toLowerCase())}${u.mergedAt ? ` ${escape(u.mergedAt.slice(0, 10))}` : ''})</a>`).join('');
  const zp = c('zero-patches');
  const patches = zp.patches?.length === 0 ? 'no local patch to nina' : `${zp.patches.length} local patches to nina`;
  return `<article class="project-row project-featured" id="${entryId}"><div class="project-number">${entryNumber}<span>HARNESS</span></div><div class="project-description"><h3><a href="journal/${slug}.html#results">nina: harness orchestration for Claude Code</a></h3><p>nina composes the agents, hooks and checks that run Claude Code on a project. We measured one part of it, its reviewer at 0.34.0, deciding whether a change breaks mechanical architecture rules, with a bar fixed before any counted run: ${escape(rate(c('missed-drift').runLevel))} runs missed drift, ${escape(rate(c('false-reject').runLevel))} runs falsely rejected, the same verdict on ${c('self-agreement').x} of ${c('self-agreement').n} changes, ${escape(patches)}, ${escape(rate(zp.harnessFailures))} harness failures, and in ${seen} of ${r.manipulation.countedRuns} runs a tool output showed it at least one line of the change. Nothing else about nina was measured.</p><div class="project-links"><a href="journal/${slug}.html#results">The measurement (EXP 006)</a><a href="journal/jev-as-a-fast-gate.html#spotlight">EXP 005</a>${up}<a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a></div><p class="project-note">nina is by ${escape(author)}, <a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a> — ${escape(attributionLine)}. The upstream fixes above were opened by Odin Labs.</p></div><dl class="project-spec"><div><dt>Tool</dt><dd>nina 0.34.0 reviewer</dd></div><div><dt>Measured</dt><dd>${escape(day(measuredOn))}</dd></div><div><dt>Bar</dt><dd>${escape(r.spotlight.verdict)}</dd></div><div><dt>Saw the change</dt><dd>${seen} of ${r.manipulation.countedRuns} runs</dd></div></dl></article>`;
}

/** The built home page with nina's entry after 002 Laya (nothing added while the gate is closed). */
export function addNinaEntry(html, data) {
  const entry = renderNinaEntry(data);
  if (!entry) return html;
  assert(!html.includes(`id="${entryId}"`), 'the home page already carries a nina entry: one nina entry only');
  const anchor = '<article class="project-row"><div class="project-number">003';
  assert.equal(html.split(anchor).length, 2, 'the home page carries row 003 exactly once');
  return html.replace(anchor, `${entry}\n      ${anchor}`);
}
