// Renders EXP 006 amendment 01 onto the public pages: a dated line in the EXP 006 row of the home page, and a dated
// amendment section in the EXP 006 field note. Both come from experiments/nina-changes/amendment-01.json; nothing
// here is typed by hand. The note is committed byte-identical to the pre-registration's render, so the section is
// added to the built copy of the note, and the build asserts the result.
import assert from 'node:assert/strict';
import { slug } from './nina-changes-note.mjs';

export const amendmentDataPath = 'data/nina-changes/amendment-01.json';
export const sectionId = 'amendment-01';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };

/** The field note's amendment section, rendered from the record and its sha256. */
export function renderAmendmentSection(amendment, amendmentSha256) {
  assert.match(amendmentSha256, /^[a-f0-9]{64}$/, 'The section needs the sha256 of the amendment it renders');
  const { reason, changes: c, spend: s, projection: p } = amendment;
  return `<section id="${sectionId}" class="article-amendment">
<h2>Amendment 01 · ${escape(day(amendment.date))}</h2>
<p><strong>${escape(amendment.statusText)}.</strong> ${escape(reason.summary)} The pre-registration below is unchanged and still served byte for byte (sha256 ${code(amendment.parent.sha256)}); where this section and it differ, this section wins, and only on what it lists.</p>
<h3>What the dry run found</h3>
${list(reason.findings.map(f => `<strong>${escape(f.id)}, ${escape(f.title.toLowerCase())}.</strong> ${escape(f.what)}`))}
<p>The dry-run records: ${reason.dryRun.records.map(r => `${code(r.file.split('/').pop())} (${escape(r.rows)}; sha256 ${code(r.sha256)})`).join('; ')}. Their spend is lines ${escape(reason.dryRun.ledgerLines)}.</p>
<h3>What changes</h3>
${list([
  `<strong>${escape(c.lint.id)}, the record lint.</strong> ${escape(c.lint.rule)}`,
  `<strong>${escape(c.gitCall.id)}, what counts as a git call.</strong> ${escape(c.gitCall.definition)} The allowed forms: ${c.gitCall.allowedForms.map(code).join(', ')}.`,
  `<strong>${escape(c.fence.id)}, the fence as the client runs it.</strong> ${escape(c.fence.correction)} ${escape(c.fence.unchanged)}`,
  `<strong>${escape(c.guard.id)}, the guard.</strong> ${escape(c.guard.rule)}`,
])}
<p>The amended classifier rule, as every run record now carries it:</p>
<p>${escape(c.gitCall.rule)}</p>
<h3>Files re-pinned</h3>
${list(Object.entries(amendment.pins).map(([f, x]) => `${code(f.split('/').pop())}: ${code(x.from)} → ${code(x.to)}. ${escape(x.reason)}.`))}
<p>${escape(amendment.runnersPins)}</p>
<h3>Spend and the projection</h3>
${list([
  `Paid so far: ${escape(s.sum)} dollars, every line itemised in the record. ${escape(amendment.countedCalls)}`,
  `The $${s.preCountedCeilingUsd} pre-counted ceiling: $${escape(s.preCountedRemainingUsd.toFixed(7))} remains, $${escape(s.preCountedHeadroomUsd.toFixed(7))} after the reserve of $${escape(s.reserveUsd.toFixed(7))}.`,
  `The dry run's per-run cost over ${p.dryRunRuns} runs: mean $${escape(p.meanUsd.toFixed(7))}, p90 $${escape(p.p90Usd.toFixed(7))}, max $${escape(p.maxUsd.toFixed(7))} (${escape(p.method)}). ${escape(p.statement)}`,
])}
<p>${escape(amendment.notBefore)}</p>
<h3>Unchanged</h3>
${list(amendment.unchanged.map(escape))}
<h3>What the amendment adds to the limits</h3>
${list(amendment.limits.map(escape))}
<p>This section is rendered from <a href="../${amendmentDataPath}"><code>amendment-01.json</code></a>, the committed record at ${code('experiments/nina-changes/amendment-01.json')}, whose sha256 is ${code(amendmentSha256)}. It names its parent by sha256 ${code(amendment.parent.sha256)}. The build validates the record, publishes it byte for byte and writes this section from it; a repository test re-renders the section from the record.</p>
</section>
`;
}

const once = (page, marker) => assert.equal(page.split(marker).length, 2, `The page must contain ${JSON.stringify(marker)} exactly once`);

// The home row: it is one link, so it cannot hold a second one. The row gains the amendment's line after its
// "Pre-registered, not yet run." sentence and links to the amendment's section of the note.
export const rowHref = `journal/${slug}.html`;
export const rowSentence = ' Pre-registered, not yet run.</p>';
export function qualifyRow(page, amendment) {
  const open = `<a class="journal-row" href="${rowHref}">`;
  once(page, open);
  const start = page.indexOf(open), end = page.indexOf('</a>', start);
  const row = page.slice(start, end);
  once(row, rowSentence);
  const amended = row.replace(open, `<a class="journal-row" href="${rowHref}#${sectionId}">`)
    .replace(rowSentence, `${rowSentence.replace('</p>', '')} <span class="amendment-qualifier">${escape(amendment.siteQualifier.row)}</span></p>`);
  return `${page.slice(0, start)}${amended}${page.slice(end)}`;
}

const metaEnd = ' · NOT YET RUN</p>';
const bodyOpen = '<article class="article-body">\n';
const firstParagraph = '<p><strong>Pre-registered, not yet run.</strong>';
const descriptionOpen = '<meta name="description" content="';
const noteQualifier = amendment => ` <a class="amendment-qualifier" href="#${sectionId}">${escape(amendment.siteQualifier.note)}</a>`;
// The built note: the pre-registration's render, with the amendment's date in the meta line, the amendment's line in
// the description, a qualifier after the "Pre-registered, not yet run." lead, and its section first in the body.
export function amendNote(note, amendment, amendmentSha256) {
  for (const marker of [bodyOpen, metaEnd, firstParagraph, descriptionOpen]) once(note, marker);
  assert(!note.includes(`id="${sectionId}"`), 'The note is already amended');
  return note.replace(metaEnd, ` · AMENDED ${day(amendment.date)}${metaEnd}`)
    .replace(descriptionOpen, `${descriptionOpen}${escape(amendment.siteQualifier.meta)} `)
    .replace(firstParagraph, `${firstParagraph}${noteQualifier(amendment)}`)
    .replace(bodyOpen, `${bodyOpen}${renderAmendmentSection(amendment, amendmentSha256)}`);
}
