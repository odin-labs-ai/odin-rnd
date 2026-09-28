// Renders EXP 005 amendment 01 onto the public pages: one dated line on station 06, and a dated
// amendment section in the pre-registration field note. Both come from experiments/jev-gate/amendment-01.json;
// nothing here is typed by hand. The parent note is committed byte-identical to its own render, so the
// section is added to the built copy of the note, and the build asserts the result.
import assert from 'node:assert/strict';
import { percent } from './jev-gate-prereg.mjs';

export const amendmentDataPath = 'data/jev-gate/amendment-01.json';
export const sectionId = 'amendment-01';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const threshold = c => c.id === 'zero-patches' ? c.harnessFailureMax : c.threshold;

// Station 06: the dated amendment line, linked to the record. It names no result.
export function renderAmendmentLine(amendment) {
  const n = amendment.changes.reviewer.nina;
  return `<p class="station-provenance"><strong>${escape(amendment.statusText)}.</strong> The LLM reviewer is re-pinned from nina ${escape(n.previousRelease)} to ${escape(n.release)}, and a bar nina's reviewer must clear for a spotlight is fixed in advance.<br><a href="${amendmentDataPath}">Amendment 01, the record</a> · <a href="journal/jev-as-a-fast-gate.html#${sectionId}">What changed</a></p>`;
}

// The field note's amendment section, rendered from the record and its sha256.
export function renderAmendmentSection(amendment, amendmentSha256) {
  assert.match(amendmentSha256, /^[a-f0-9]{64}$/, 'The section needs the sha256 of the amendment it renders');
  const { reason, changes: { reviewer: r, spotlight: s } } = amendment;
  const nina = amendment.attribution.nina.replace('github.com/xhulz/nina', `<a href="${escape(amendment.attribution.ninaUrl)}">github.com/xhulz/nina</a>`);
  const w = r.workspace;
  return `<section id="${sectionId}" class="article-amendment">
<h2>Amendment 01 · ${escape(day(amendment.date))}</h2>
<p><strong>${escape(amendment.statusText)}.</strong> ${escape(reason.summary)} The pre-registration below is unchanged and still served byte for byte; where this section and it differ, this section wins, and only on what it lists.</p>
<p>Why, in the founder's words (${escape(reason.founderDate)}):</p>
${list(reason.founder.map(escape))}
<p>${escape(reason.paidCallsSoFar)} ${escape(amendment.priorCalls.plainly)} Their record is ${code(amendment.priorCalls.evidence.file)} (sha256 ${code(amendment.priorCalls.evidence.sha256)}); the amount already spent under the cap is now $${escape(amendment.spend.alreadySpentUsd)}.</p>
<p>${escape(amendment.notBefore)}</p>
<h3>The reviewer: nina ${escape(r.nina.previousRelease)} → ${escape(r.nina.release)}</h3>
<p>${nina}. Package ${code(`${r.nina.package}@${r.nina.release}`)}, tarball ${code(r.nina.tarball.url)} with integrity ${code(r.nina.tarball.integrity)}; commit ${code(r.nina.commit)}, release tree ${code(r.nina.releaseTree)}. ${escape(r.nina.verification)}</p>
<p>What this replaces: ${escape(r.replaces)}</p>
<p>${escape(r.reportFormat)}</p>
<p>${escape(r.toolRestrictionInteraction)}</p>
<p>${escape(w.description)}</p>
<p>Each run's workspace, in this order:</p>
<ol>${w.order.map(step => `<li>${escape(step)}</li>`).join('')}</ol>
${list([escape(r.install.rule), escape(w.vocabularyRule), escape(w.fragmentsRule), escape(w.patchRule), `The base commit is ${code(w.baseCommit.sha)}. ${escape(w.baseCommit.rule)}`, escape(w.ninaData), escape(r.hooks.rule), escape(r.hooks.errors), escape(r.billing)])}
<p>The probe that confirmed all of this, with no model called: ${escape(r.probe.summary)} Its record is ${code(r.probe.file)}.</p>
<h3>The spotlight bar for nina's reviewer</h3>
<p>Applies to ${escape(s.appliesTo)} ${escape(s.rule)}</p>
${list(s.criteria.map(c => `<strong>${escape(c.id)}</strong> (${escape(percent(threshold(c)))}): ${escape(c.statement)} Denominator: ${escape(c.denominator)}.${c.harnessFailure ? ` ${escape(c.harnessFailure)}` : ''}`))}
<p>${escape(s.judging)} ${escape(s.labelPhrase)}</p>
<p>${escape(s.supersedes)}</p>
<h3>Unchanged</h3>
${list(amendment.unchanged.map(escape))}
<h3>What the amendment adds to the limits</h3>
${list(amendment.limits.map(escape))}
<p>This section is rendered from <a href="../${amendmentDataPath}"><code>amendment-01.json</code></a>, the committed record at ${code('experiments/jev-gate/amendment-01.json')}, whose sha256 is ${code(amendmentSha256)}. It names its parent by sha256 ${code(amendment.parent.sha256)}. The build validates the record, publishes it byte for byte and writes this section from it; a repository test re-renders the section from the record.</p>
</section>
`;
}

const bodyOpen = '<article class="article-body">\n';
const metaEnd = ' · NO RESULTS YET</p>';
// The built note: the parent's render, with the amendment's date in the meta line and its section first in the body.
export function amendNote(note, amendment, amendmentSha256) {
  for (const marker of [bodyOpen, metaEnd]) assert.equal(note.split(marker).length, 2, `The note must contain ${JSON.stringify(marker)} exactly once`);
  assert(!note.includes(`id="${sectionId}"`), 'The note is already amended');
  return note.replace(metaEnd, ` · AMENDED ${day(amendment.date)}${metaEnd}`).replace(bodyOpen, `${bodyOpen}${renderAmendmentSection(amendment, amendmentSha256)}`);
}
