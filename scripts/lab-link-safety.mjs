// Lab 07, "Can data trick a click?" (lane vp-bundle2). scripts/labs.mjs calls renderLinkSafety() and writes, into dist/
// only (nothing rendered is committed):
//   labs/link-safety/index.html   the lab page, from site/labs/link-safety/index.html (<!--LINK_*--> markers)
// The record is site/data/labs/link-safety/record.json (odin-lab-link-safety v1,
// scripts/schemas/odin-lab-link-safety.schema.json), which scripts/vendor-link-safety.mjs builds from two private
// repositories at commits on their mains; its sha256 is pinned in site/data/labs/link-safety/record.sha256, which the
// Labs tile (scripts/lab-tiles.mjs) also checks.
//
// What the page may say is fixed here, not in the record: the DEFECT was real (a click on a card opened a URL that came
// from data, and the old rule let unsafe ones through), told in the agent space's note and its red/green table, which
// this page cannot re-run and boxes as a summary; the FIXTURES are authored (the engine's test wrote them), boxed as
// such; every verdict beside a fixture is the pinned rule's own, run by the vendor, and the test run is real. The build
// refuses the record, every reason listed, when:
//   - its bytes are not the pinned ones, or it misses the schema (every object is closed);
//   - either provenance block misses the kit record contract (a cited commit not shown as part of its main is refused);
//   - a poisoned URL was not refused with and without the allowlist, a lookalike was not refused under it (or was not
//     a link without it, which is what makes it a lookalike), a good URL was not kept, an unsafe opener line was not
//     caught exactly once, or a safe one was caught at all: the page says each of these in words;
//   - a line shown by its label has no label, two fixtures are the same, or the allowlist is not the one the page names;
//   - the note's old-code counts do not add up to its tests, or the new code did not pass them all;
//   - the test run failed a test, does not add up, or a date is not real or is after the build;
//   - any text fails the publisher's screen.
// The rendered page is screened again as a whole (pageLeaks), with only the record's own hashes masked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, instantProblems, pageLeaks, readPinned, recordHashes, screenRecord, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const LINK_RECORD = 'data/labs/link-safety/record.json';
export const LINK_PIN = 'data/labs/link-safety/record.sha256';
export const LINK_TEMPLATE = 'labs/link-safety/index.html';
export const LINK_SCHEMA = join(here, 'schemas/odin-lab-link-safety.schema.json');
export const ALLOWLIST = ['github.com'];

/** Every reason the record may not be published (empty when it may). */
export function linkSafetyProblems(record, { now = new Date(), where = LINK_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(LINK_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-link-safety v1)`);
  if (problems.length) return problems;
  problems.push(...screenRecord(record, where));
  const v = record.vendored, n = record.note;
  problems.push(...vendoredProblems(v, { where, now }), ...vendoredProblems(n, { where: `${where}#/note`, now }));
  problems.push(...instantProblems(v.committed, `${where}#/vendored/committed`, now));
  if (!v.mainCheck.commits.includes(v.commit) && v.commit !== v.mainCheck.main) problems.push(`${where}#/vendored/commit: not shown as part of the private main`);
  const r = record.run;
  problems.push(...instantProblems(r.at, `${where}#/run/at`, now));
  if (r.at.slice(0, 10) !== r.on) problems.push(`${where}#/run/on: not the date of its run`);
  const t = r.tests;
  if (t.failed !== 0) problems.push(`${where}#/run/tests: a test failed; this page says the test passed`);
  if (t.total < 1 || t.passed + t.failed + t.skipped !== t.total) problems.push(`${where}#/run/tests: passed, failed and skipped do not add up to the tests run`);
  if (n.oldCode.failed + n.oldCode.passed !== n.oldCode.tests) problems.push(`${where}#/note/oldCode: failed and passed do not add up to its tests`);
  if (n.newCode.tests !== n.oldCode.tests || n.newCode.passed !== n.newCode.tests) problems.push(`${where}#/note/newCode: the new code did not pass the same tests`);
  if (n.oldCode.failed < 1) problems.push(`${where}#/note/oldCode: the page says the old code failed the new tests`);
  if (!(record.maxLength > 0)) problems.push(`${where}#/maxLength: the rule's length cap is not a length`);
  if (JSON.stringify(record.allowlist) !== JSON.stringify(ALLOWLIST)) problems.push(`${where}#/allowlist: the page names ${ALLOWLIST.join(', ')} as the allowlist`);
  const each = (list, at, test, says) => list.forEach((x, i) => { if (!test(x)) problems.push(`${where}#/${at}/${i}: ${says}`); });
  each(record.poison, 'poison', x => x.open === 'refused' && x.allowlisted === 'refused', 'the page says every poisoned URL is refused, with and without the allowlist');
  each(record.lookalikes, 'lookalikes', x => x.allowlisted === 'refused', 'the page says every lookalike is refused under the allowlist');
  each(record.lookalikes, 'lookalikes', x => x.open === 'kept', 'the page says a lookalike is a link without the allowlist');
  each(record.good, 'good', x => x.open === 'kept', 'the page says every good URL is kept');
  each(record.unsafeLines, 'unsafeLines', x => x.caught === 1, 'the page says the audit catches every unsafe opener line, once');
  each(record.safeLines, 'safeLines', x => x.caught === 0, 'the page says the audit lets every safe line through');
  for (const at of ['unsafeLines', 'safeLines']) each(record[at], at, x => (x.shown === null) === (typeof x.label === 'string'), 'a line is shown as it is, or by its label, never neither or both');
  const hashes = [...record.poison, ...record.lookalikes, ...record.good, ...record.unsafeLines, ...record.safeLines].map(x => x.sha256);
  if (new Set(hashes).size !== hashes.length) problems.push(`${where}: two fixtures are the same`);
  return problems;
}

/** The committed record, pinned and checked; null when there is none. Throws with every reason. */
export function readLinkSafety(root = 'site', { now = new Date() } = {}) {
  return readPinned({ root, file: LINK_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: LINK_PIN, file: LINK_RECORD, vendor: 'scripts/vendor-link-safety.mjs' }), check: record => linkSafetyProblems(record, { now }), refused: 'Lab 07 record refused' });
}

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = d => `<time datetime="${escape(d)}">${escape(longDate(d))}</time>`;
const cap = s => s[0].toUpperCase() + s.slice(1);

export function renderIntro() {
  return `<span class="technical">LAB 07 · CAN DATA TRICK A CLICK?</span><h1 id="lab-title">Can data trick a click?</h1><p class="company-lead">On the agent space's floor, a card can carry a receipt: a URL that came from data. A click on the card opened it in the visitor's browser. So a receipt written to run a script, or to look like a trusted host, would have opened too. It was a real defect, on the main branch, and it was fixed. This page shows the rule that fixed it and puts every one of its test's fixtures through that rule.</p>`;
}

export function renderDefect(record) {
  const n = record.note, o = n.oldCode;
  return `${box('real', { cls: 'link-real', id: 'real', body: `<ul class="rogue-list"><li><strong>The defect.</strong> A card's receipt, and the URLs in a work panel, a trajectory, the chat's sources and the owner page, could be any string. A click opened it. The server's old rule took plain http on any host, a user name and password inside the URL, unicode and lookalike hosts.</li><li><strong>Where.</strong> On the main branch, found in a review. It mattered at once: the agent space was being opened to anonymous guests.</li><li><strong>The fix.</strong> One rule, the same bytes on the server, in the contract and in the web clients. A URL from data that is not a link is shown as text and never opened.</li></ul>` })}${box('summary', { cls: 'link-summary', id: 'summary', body: `<h3>Red on the old code, green on the new</h3><p>The note that came with the fix ran the engine's own link-safety tests against the code before it. The old code: <strong>${o.failed} failed, ${o.passed} passed</strong>, of ${o.tests}. The new code: <strong>${n.newCode.passed} of ${n.newCode.tests} passed</strong>. In the note's words, the ${o.passed} that passed are cases the old rule already refused. This is the note's table, not a run of ours: the old code is not on this site, and we did not run it again.</p><p class="lab-source">${cite(n.cites[0], n.mainCheck)}</p>` })}`;
}

export function renderRule(record) {
  return `<p>A URL from data is a link only when it passes all of these. Anything else is plain text, and is never made clickable.</p><ul class="rogue-list"><li><strong>The scheme.</strong> Absolute https, in lower case. Never javascript:, data:, vbscript:, file:, or plain http on any host.</li><li><strong>The host.</strong> A plain lower-case name with a letter ending, and an optional port. No bare IP address, and no punycode label: the ASCII spelling of a lookalike is not a link either.</li><li><strong>No credentials.</strong> No user name and password before the host, which also refuses the trick of writing the trusted host's name there.</li><li><strong>The characters.</strong> Printable ASCII only: no space, no control character, no backslash, quote or angle bracket, and no unicode, so no direction override, no zero-width space and no letters from another script.</li><li><strong>The length.</strong> At most ${record.maxLength} characters.</li><li><strong>The allowlist.</strong> Where a connector names its hosts, the host must be one of them exactly. For these fixtures it is ${record.allowlist.map(h => `<code>${escape(h)}</code>`).join(', ')}.</li></ul><p>A reference that looks like a link but is not one is shown with "not a link: " in front of it, so an older client that links anything starting with http still shows words.</p>`;
}

const urlRows = (list, cells) => list.map(x => `<tr><td>${escape(cap(x.label))}</td>${cells(x)}</tr>`).join('');
const said = { refused: 'refused', kept: 'a link', changed: 'changed' };
const lineCell = x => (x.shown === null ? `${escape(cap(x.label))} <span class="lab-source">(shown by its label, not as itself)</span>` : `<code>${escape(x.shown)}</code>`);

export function renderFixtures(record) {
  const p = record.poison, l = record.lookalikes, g = record.good, u = record.unsafeLines, s = record.safeLines;
  const host = record.allowlist.map(h => `<code>${escape(h)}</code>`).join(', ');
  const table = (head, rows) => `<div class="lab-table-wrap"><table><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  return box('fixture', { cls: 'link-fixtures', id: 'fixtures', body: `<p>These are the fixtures of the engine's link-safety test, which we wrote. Each one is an attack or a good URL we made up, not one found in the wild. The verdict beside each is what the pinned rule returned when the vendor put the fixture through it; the page never types one by hand. A poisoned URL is shown by a one-line label we wrote, not as itself: as itself it would be a link off this site, an address, or a character that reorders the text. Each label is bound to its URL by the URL's sha256, which the record holds.</p>
<h3 class="lab-subhead" id="poison">${p.length} poisoned URLs: every one refused</h3>${table(['The poisoned URL', 'The rule', `With the ${host} allowlist`], urlRows(p, x => `<td>${said[x.open]}</td><td>${said[x.allowlisted]}</td>`))}
<h3 class="lab-subhead" id="lookalikes">${l.length} lookalikes: links with no allowlist, refused under it</h3><p>These are well-formed https URLs on real-looking hosts, so with no allowlist the rule takes each one as a link. Under the ${host} allowlist each is refused, because its host is not exactly the trusted one.</p>${table(['The lookalike', 'The rule, no allowlist', `With the ${host} allowlist`], urlRows(l, x => `<td>${said[x.open]}</td><td>${said[x.allowlisted]}</td>`))}
<h3 class="lab-subhead" id="good">${g.length} good URLs: kept as they are</h3><p>A good URL comes back unchanged. One of them is on another host, so the ${host} allowlist refuses it too, as it should.</p>${table(['The good URL', 'The rule, no allowlist', `With the ${host} allowlist`], urlRows(g, x => `<td>${said[x.open]}</td><td>${said[x.allowlisted]}</td>`))}
<h3 class="lab-subhead" id="openers">${u.length} unsafe opener lines: every one caught</h3><p>The test also audits the client's own code: any line that could turn a string into a navigation, outside the one pinned link rule, fails the suite. These are the audit's own fixture lines, each a way to open a URL; each was caught once.</p>${table(['The line', 'Caught'], u.map(x => `<tr><td>${lineCell(x)}</td><td>${x.caught === 1 ? 'yes' : 'no'}</td></tr>`).join(''))}
<h3 class="lab-subhead" id="safe-lines">${s.length} safe lines: none flagged</h3><p>Lines that look close but open nothing. A false alarm here would teach people to ignore the audit.</p>${table(['The line', 'Flagged'], s.map(x => `<tr><td>${lineCell(x)}</td><td>${x.caught ? 'yes' : 'no'}</td></tr>`).join(''))}` });
}

export function renderRun(record) {
  const r = record.run, t = r.tests, v = record.vendored, mc = v.mainCheck;
  const files = [...v.files, ...record.note.files].map(f => `<li>${escape(cap(f.what))}: <code>${escape(f.sha256)}</code></li>`).join('');
  return `<p>Everything on this page comes from one record, <a href="../../${LINK_RECORD}">published here</a> and pinned by its sha256. It was read from ${escape(v.from)}. ${cite(v, mc)}</p><h3 class="lab-subhead">The test, run</h3><p>On ${time(r.on)}, on ${escape(r.host)}, the engine's link-safety test ran at that commit with ${escape(r.how)}: <strong>${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped</strong>, of ${t.total}. The fixtures above are that test's, at that commit.</p><h3 class="lab-subhead">The files, by sha256</h3><ul class="rogue-list rogue-hashes">${files}</ul><p class="lab-source">Each main was checked by ${escape(mc.how)}, on ${time(mc.checked)}.</p>`;
}

export function renderBoundary() {
  return `<ul class="rogue-list"><li>The fixtures are attacks we wrote. They do not say how often a poisoned URL turns up, or that no other trick exists.</li><li>It shows that this rule refuses these URLs and that this audit catches these lines. It does not show every client: a client that skips the rule is caught only where the audit reads its code.</li><li>The red/green table is the note's. This page shows the new rule run, not the old one.</li><li>No screenshot of a poisoned card is shown: one could not be taken without touching a live instance.</li></ul>`;
}

/** The rendered lab page, keyed by its dist/ path; nothing when the record is absent. Throws on any problem. */
export function renderLinkSafety(root = 'site', { now = new Date() } = {}) {
  const record = readLinkSafety(root, { now });
  if (!record) return { pages: {} };
  let html = readFileSync(join(root, LINK_TEMPLATE), 'utf8');
  for (const [marker, value] of Object.entries({ '<!--LINK_INTRO-->': renderIntro(record), '<!--LINK_DEFECT-->': renderDefect(record), '<!--LINK_RULE-->': renderRule(record), '<!--LINK_FIXTURES-->': renderFixtures(record), '<!--LINK_RUN-->': renderRun(record), '<!--LINK_BOUNDARY-->': renderBoundary() })) {
    if (!html.includes(marker)) throw new Error(`${LINK_TEMPLATE}: ${marker} is missing`);
    html = html.replace(marker, () => value);
  }
  if (/<!--[A-Z_]+-->/.test(html)) throw new Error(`${LINK_TEMPLATE}: unresolved content marker`);
  const v = record.vendored, n = record.note;
  const onMain = [v.commit, v.mainCheck.main, ...v.mainCheck.commits, n.mainCheck.main, ...n.mainCheck.commits];
  const leaks = pageLeaks(html, recordHashes(record), { onMain });
  if (leaks.length) throw new Error(`${LINK_TEMPLATE}: the rendered page fails the screen:\n  ${leaks.join('\n  ')}`);
  return { pages: { [LINK_TEMPLATE]: html } };
}
