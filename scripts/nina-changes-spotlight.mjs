// EXP 006's spotlight artefact (REVISION 5): nina's entry in the home page's "Tools leaving the factory" list, next
// after 002 Laya, in the same shape as the Laya project-row. WHETHER it shows is decided only by the pinned gate,
// experiments/nina-changes/spotlight-gate.mjs, whose gateOpen(root) reads and binds the records itself (refute r2 B1,
// r3 B1); this file is the markup, unpinned: it renders only what gateOpen returns, and every figure in it is read
// from the results record gateOpen hands back. The upstream PR states come from the committed upstream.json (refreshed by
// scripts/nina-changes-upstream.mjs --refresh before each publish), never typed here.
//
// One nina entry only: it takes the number (005) and the id (project-nina) of EXP 005's gated card, which EXP 005's
// committed decision (held: true, on immutable results) keeps closed for good; this entry supersedes that slot, and
// refuses to add a second one if the page ever carried it.
import assert from 'node:assert/strict';
import { gateOpen } from '../experiments/nina-changes/spotlight-gate.mjs';
import { ninaAttribution } from './jev-gate-prereg.mjs';
import { slug } from './nina-changes-note.mjs';
import { loadUpstream } from './nina-changes-upstream.mjs';

export { gateOpen };
/** The build's call (scripts/build.mjs is a witness generator input, so its text stays): the gate's own reading of the records. */
export const loadEntryData = gateOpen;
export const entryNumber = '005';
export const entryId = 'project-nina';
export const author = 'Marcos Schulz (xhulz)';
export const attributionLine = ninaAttribution.split('— ')[1]; // "used with the permission of its author, as confirmed by Odin Labs"
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const day = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };

/** nina's entry, or '' when the gate is closed. The Laya row's shape: number + category, title, paragraph, links, note, spec. */
export function renderNinaEntry(gate, upstream = loadUpstream().prs) {
  if (gate?.shown !== true) return '';
  const { results: r, measuredOn } = gate;
  const c = id => r.spotlight.criteria.find(x => x.id === id);
  const rate = x => `${x.x} of ${x.n}`;
  // The item-level label beside each rate, as EXP 005's card does: the pre-registration's labelPhrase requires the card to
  // carry "passes, not established at this N" verbatim wherever that is the label (refute B1).
  const itemState = x => x?.itemLevel?.state ?? 'item level not recorded';
  const seen = r.manipulation.countedRuns - r.manipulation.blind;
  const up = upstream.map(u => `<a href="https://github.com/${escape(u.repo)}/pull/${u.pr}">${escape(u.repo)}#${u.pr} (${escape(u.state.toLowerCase())}${u.mergedAt ? ` ${escape(u.mergedAt.slice(0, 10))}` : ''})</a>`).join('');
  const zp = c('zero-patches');
  // Null-safe (refute r3 N5): every clause comes from the record's zero-patch fields, and a missing one is said so.
  const patches = Array.isArray(zp?.patches) ? (zp.patches.length === 0 ? 'no local patch to nina' : `${zp.patches.length} local patches to nina`) : 'local patches not recorded';
  const failures = zp?.harnessFailures ? `${rate(zp.harnessFailures)} harness failures` : 'harness failures not recorded';
  return `<article class="project-row project-featured" id="${entryId}"><div class="project-number">${entryNumber}<span>HARNESS</span></div><div class="project-description"><h3><a href="journal/${slug}.html#results">nina: harness orchestration for Claude Code</a></h3><p>nina composes the agents, hooks and checks that run Claude Code on a project. We measured one part of it, its reviewer at 0.34.0, deciding whether a change breaks mechanical architecture rules, with a bar fixed before any counted run: ${escape(rate(c('missed-drift').runLevel))} runs missed drift (${escape(itemState(c('missed-drift')))} on the items), ${escape(rate(c('false-reject').runLevel))} runs falsely rejected (${escape(itemState(c('false-reject')))} on the items), the same verdict on ${c('self-agreement').x} of ${c('self-agreement').n} changes, ${escape(patches)}, ${escape(failures)}, and in ${seen} of ${r.manipulation.countedRuns} runs a tool output showed it at least one line of the change. Nothing else about nina was measured.</p><div class="project-links"><a href="journal/${slug}.html#results">The measurement (EXP 006)</a><a href="journal/jev-as-a-fast-gate.html#spotlight">EXP 005</a>${up}<a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a></div><p class="project-note">nina is by ${escape(author)}, <a href="https://github.com/xhulz/nina">github.com/xhulz/nina</a> — ${escape(attributionLine)}. The upstream fixes above were opened by Odin Labs.</p></div><dl class="project-spec"><div><dt>Tool</dt><dd>nina 0.34.0 reviewer</dd></div><div><dt>Measured</dt><dd>${escape(day(measuredOn))}</dd></div><div><dt>Bar</dt><dd>${escape(r.spotlight.verdict)}</dd></div><div><dt>Saw the change</dt><dd>${seen} of ${r.manipulation.countedRuns} runs</dd></div></dl></article>`;
}

/** The built home page with nina's entry after 002 Laya (nothing added while the gate is closed). */
export function addNinaEntry(html, gate, upstream = loadUpstream().prs) {
  const entry = renderNinaEntry(gate, upstream);
  if (!entry) return html;
  assert(!html.includes(`id="${entryId}"`), 'the home page already carries a nina entry: one nina entry only');
  const anchor = '<article class="project-row"><div class="project-number">003';
  assert.equal(html.split(anchor).length, 2, 'the home page carries row 003 exactly once');
  return html.replace(anchor, `${entry}\n      ${anchor}`);
}
