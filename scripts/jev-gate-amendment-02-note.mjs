// Renders EXP 005 amendment 02 onto the public pages, beside amendment 01: a dated line on station 06, a
// dated section in the field note after amendment 01's, and an "amended again" qualifier next to each of the
// parent's "before any gate" sentences. Everything comes from experiments/jev-gate/amendment-02.json.
import assert from 'node:assert/strict';

export const amendment02DataPath = 'data/jev-gate/amendment-02.json';
export const section02Id = 'amendment-02';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const code = value => `<code>${escape(value)}</code>`;
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const day = iso => { const [y, m, d] = iso.split('-'); return `${d} ${months[Number(m) - 1]} ${y}`; };
const usd = n => `$${escape(n.toFixed(7))}`;

// Station 06: the dated line for amendment 02, linked to its record and section. It names no result.
export function renderAmendment02Line(amendment) {
  return `<p class="station-provenance"><strong>${escape(amendment.statusText)}.</strong> The reviewer's file and git tools are fenced to its workspace after the dry run's isolation probe read a file outside it.<br><a href="${amendment02DataPath}">Amendment 02, the record</a> · <a href="journal/jev-as-a-fast-gate.html#${section02Id}">What changed</a></p>`;
}

export function renderAmendment02Section(amendment, amendmentSha256) {
  assert.match(amendmentSha256, /^[a-f0-9]{64}$/, 'The section needs the sha256 of the amendment it renders');
  const { reason, changes: { reviewer: r }, priorCalls: p, spend } = amendment;
  const ev = r.isolationEvidence;
  const rows = run => Object.entries(run.rows).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ');
  const run = x => `<strong>${escape(x.variant)}</strong>: ${escape(rows(x))}${x.info ? `; information ${escape(Object.entries(x.info).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', '))}` : ''}; ${x.controls} controls ${x.controlsWorked ? 'all worked' : 'not all worked'}; ${x.passed ? 'passed' : 'failed'}; client ${escape(x.clientVersion)}; runner ${code(x.runnerSha256.slice(0, 16))}…; ${usd(x.costUsd)}. Record ${code(x.file)}, sha256 ${code(x.sha256)}.`;
  return `<section id="${section02Id}" class="article-amendment">
<h2>Amendment 02 · ${escape(day(amendment.date))}</h2>
<p><strong>${escape(amendment.statusText)}.</strong> ${escape(reason.summary)} It names amendment 01 by sha256 ${code(amendment.parent.sha256)} and the pre-registration by ${code(amendment.preregistration.sha256)}; both are unchanged.</p>
<p>${escape(reason.failure.what)} ${escape(reason.failure.counted)} The probe's record is ${code(reason.failure.evidence.file)} (sha256 ${code(reason.failure.evidence.sha256)}). ${escape(reason.rule)}</p>
<p>${escape(reason.outputHole.what)} Record ${code(reason.outputHole.evidence.file)} (sha256 ${code(reason.outputHole.evidence.sha256)}).</p>
<p>${escape(reason.redirectGap.what)} Record ${code(reason.redirectGap.evidence.file)} (sha256 ${code(reason.redirectGap.evidence.sha256)}).</p>
<p>${escape(reason.quoteGap.what)} Record ${code(reason.quoteGap.evidence.file)} (sha256 ${code(reason.quoteGap.evidence.sha256)}).</p>
<p>${escape(reason.answerKeyCopies.what)} Record ${code(reason.answerKeyCopies.evidence.file)} (sha256 ${code(reason.answerKeyCopies.evidence.sha256)}).</p>
<p>${escape(amendment.notBefore)}</p>
<h3>The reviewer's tools</h3>
<p>${escape(r.replaces)} Allowed tools: ${r.allowedTools.map(code).join(', ')}. Settings, passed on the command line: ${code(r.settingsArgument)}. ${escape(r.argumentOrder)} ${escape(r.denyRules)} Client ${code(r.clientVersion)}.</p>
<p>${escape(r.sandbox.what)}</p>
<p>${escape(r.sandbox.runDirectory)}</p>
<p>${escape(r.answerKeyPreflight)}</p>
<p>The reviewer's git environment: ${Object.entries(r.childEnv).map(([k, v]) => code(`${k}=${v}`)).join(', ')}. ${escape(r.childEnvRule)}</p>
<p>${escape(r.ninaUntouched)} ${escape(r.derivedFrom)}</p>
<p>The command, exactly (${code('<prompt>')} is the parent's prompt, unchanged):</p>
<pre tabindex="0">${escape(r.command)}</pre>
<h3>The fence, tested live</h3>
<p>${escape(ev.judgedBy)} What each run tried:</p>
${list(Object.entries(ev.matrix).map(([k, v]) => `${escape(k.toUpperCase())}: ${escape(v)}`))}
${list(ev.runs.map(run))}
<p>${escape(ev.howRefused)}</p>
<p>The probe of record is ${code(ev.probeOfRecord.file)}. ${escape(ev.probeOfRecord.why)}</p>
<p>${escape(ev.earlierNote)}</p>
${list(ev.earlierRuns.map(run))}
<h3>Which runner made which run</h3>
<p>${escape(r.runners.note)}</p>
${list(r.runners.byRun.map(g => `${g.runs.map(code).join(', ')}: runner ${code(g.runnerSha256)}, ${g.committed ? `committed in ${escape(g.where)}.` : escape(g.where)}`))}
<h3>Local paths</h3>
<p>${escape(r.scrub.what)} ${escape(r.scrub.disclosure)} Record ${code(r.scrub.evidence.file)}, sha256 ${code(r.scrub.evidence.sha256)}.</p>
<h3>Every paid call since amendment 01</h3>
<p>${escape(p.statement)} ${escape(p.rounding)}</p>
${list(p.calls.map(c => `${escape(c.kind)}${c.item ? ` ${code(c.item)}` : ''}, ${escape(c.startedAt)}: ${escape(c.outcome)}, ${usd(c.costUsd)}. Record ${code(c.evidence)}.`))}
<p>${escape(p.unpaid.what)} Record ${code(p.unpaid.evidence.file)}, sha256 ${code(p.unpaid.evidence.sha256)}.</p>
<p>The amount already spent under the cap is now $${escape(spend.alreadySpentUsd.toFixed(7))}: ${escape(spend.sum)} ${escape(spend.supersedes)} ${escape(spend.noDoubleCount)}</p>
<h3>Unchanged</h3>
${list(amendment.unchanged.map(escape))}
<h3>What amendment 02 adds to the limits</h3>
${list(amendment.limits.map(escape))}
<h3>Sources</h3>
${list(amendment.sources.map(src => `<a href="${escape(src.url)}">${escape(src.label)}</a>. ${escape(src.claim)}`))}
<p>This section is rendered from <a href="../${amendment02DataPath}"><code>amendment-02.json</code></a>, the committed record at ${code('experiments/jev-gate/amendment-02.json')}, whose sha256 is ${code(amendmentSha256)}. The build validates the record, publishes it byte for byte and writes this section from it; a repository test re-renders the section from the record.</p>
</section>
`;
}

// Inserts html before the first </p> after marker; the marker must occur exactly once.
function beforeParagraphEnd(page, marker, html) {
  assert.equal(page.split(marker).length, 2, `The page must contain ${JSON.stringify(marker)} exactly once`);
  const at = page.indexOf('</p>', page.indexOf(marker));
  assert(at > 0, `No paragraph end after ${JSON.stringify(marker)}`);
  return page.slice(0, at) + html + page.slice(at);
}
const qualifier = (href, text) => ` <a class="amendment-qualifier" href="${href}">${escape(text)}</a>`;
export const cardQualifier02 = a => qualifier(`journal/jev-as-a-fast-gate.html#${section02Id}`, a.siteQualifier.card);
export const stationQualifier02 = a => qualifier(`journal/jev-as-a-fast-gate.html#${section02Id}`, a.siteQualifier.station);
export const noteQualifier02 = a => qualifier(`#${section02Id}`, a.siteQualifier.note);
export const qualifyHome02 = (page, a) => beforeParagraphEnd(page, 'Published before any gate runs.', cardQualifier02(a));
export const qualifyStation02 = (exhibit, a) => beforeParagraphEnd(exhibit, 'Written down before any gate runs', ` ·${stationQualifier02(a)}`);

// The built note after amendment 01's amendNote: a second meta date, a second qualifier, and this section after 01's.
export function amendNote02(note, amendment, amendmentSha256) {
  assert(note.includes('id="amendment-01"'), 'Amendment 02 is added to a note that amendment 01 already amended');
  assert(!note.includes(`id="${section02Id}"`), 'The note already carries amendment 02');
  const headerEnd = ' · NO RESULTS YET</p>';
  assert.equal(note.split(headerEnd).length, 2);
  const meta = /<meta name="description" content="([^"]*)">/;
  assert(meta.test(note), 'The note has no meta description');
  const a01End = note.indexOf('</section>\n', note.indexOf('id="amendment-01"')) + '</section>\n'.length;
  let out = note.slice(0, a01End) + renderAmendment02Section(amendment, amendmentSha256) + note.slice(a01End);
  out = out.replace(headerEnd, ` · AMENDED AGAIN ${day(amendment.date)}${headerEnd}`);
  out = out.replace(meta, (_, content) => `<meta name="description" content="${content} ${escape(amendment.siteQualifier.meta)}">`);
  return beforeParagraphEnd(out, 'and the results are judged against this one.', noteQualifier02(amendment));
}
