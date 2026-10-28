// Lab 05's "Can you tamper with the record?" section (vision-plan bundle 1, WO-02), rendered into labs/rogue/ by
// scripts/lab-rogue.mjs. Its inputs, all committed:
//   site/data/labs/rogue/journal.jsonl   the governed run's journal, every row in full, byte for byte the file Lab 05's
//                                        record cites by sha256
//   site/data/labs/rogue/tamper.json     odin-lab-rogue-tamper v1 (scripts/schemas/odin-lab-rogue-tamper.schema.json):
//                                        each row's own hash recomputed and its link checked, and five tampered copies
//                                        run through the same check; written by scripts/rogue_tamper.py, in Python,
//                                        because a row's time is a Python float and a JavaScript re-hash would differ
//   site/data/labs/rogue/tamper.sha256   its pin
// scripts/rogue_tamper.py --check re-derives tamper.json from the committed journal, byte for byte; the site's tests run
// it in CI. The build (here) cannot re-hash a row, so it checks everything it can without Python, and refuses, every
// reason listed, when:
//   - the record is not the pinned bytes, misses the schema, or fails the kit's record contract or screen;
//   - the journal is not the bytes Lab 05's record cites, or its rows, links and head are not the ones tamper.json and
//     Lab 05's record list;
//   - the tampered copies are not the five this page describes, a copy is not caught, or is caught by a check other
//     than the one the page names; the links JavaScript can re-check itself (dropped, reordered and cut-off rows) do
//     not come out as tamper.json says; a copy the row checks catch changes the head, or a copy only the head catches
//     does not.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cite, escape, readPinned, screenRecord, sha256, sidecarPinProblems, validate, vendoredProblems } from './lab-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const TAMPER_RECORD = 'data/labs/rogue/tamper.json';
export const TAMPER_PIN = 'data/labs/rogue/tamper.sha256';
export const TAMPER_JOURNAL = 'data/labs/rogue/journal.jsonl';
export const TAMPER_SCHEMA = join(here, 'schemas/odin-lab-rogue-tamper.schema.json');
const ZERO = '0'.repeat(64);

// The five tampered copies, in page order, and the check that must catch each.
export const CASES = {
  'byte-flip': { title: 'Flip one byte', caughtBy: 'own-hash' },
  'drop-row': { title: 'Remove a row', caughtBy: 'prev-link' },
  reorder: { title: 'Swap two rows', caughtBy: 'prev-link' },
  'drop-last': { title: 'Cut off the last row', caughtBy: 'head' },
  'rewrite-chain': { title: 'Flip a byte, then rewrite every hash after it', caughtBy: 'head' },
};
export const CHECK_WORDS = { 'own-hash': 'the row\'s own hash, recomputed', 'prev-link': 'the link to the row above', head: 'the published head' };

/** The journal's rows, parsed in JavaScript (only to compare fields; JavaScript never re-hashes a row). */
export const journalRows = bytes => String(bytes).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

/** The link check, which needs no re-hash: each row's prev is the hash of the row above, the first's is zeros. */
export const links = rows => rows.map((r, i) => (r.prev === (i ? rows[i - 1].hash : ZERO) ? 'OK' : 'BROKEN'));

/** Every reason the tamper section may not be published (empty when it may). */
export function tamperProblems(record, journalBytes, rogueRecord, { now = new Date(), where = TAMPER_RECORD } = {}) {
  const problems = validate(JSON.parse(readFileSync(TAMPER_SCHEMA, 'utf8')), record).map(p => `${where}#${p} (does not match odin-lab-rogue-tamper v1)`);
  if (problems.length) return problems;
  problems.push(...vendoredProblems(record.vendored, { where, now }), ...screenRecord(record, where));
  if (!/Python/.test(record.checkedWith) || !/vendored/.test(record.checkedWith) || !/CI/.test(record.checkedWith)) problems.push(`${where}#/checkedWith: must say the check ran in Python when the journal was vendored, and in CI`);

  // The journal: the bytes Lab 05's record cites, its rows the ones listed here and there.
  const cited = rogueRecord?.vendored.files.find(f => f.role === 'journal')?.sha256;
  const actual = journalBytes ? sha256(journalBytes) : null;
  if (!journalBytes) problems.push(`${TAMPER_JOURNAL}: missing`);
  else if (actual !== cited) problems.push(`${TAMPER_JOURNAL}: its sha256 is ${actual}, not the journal Lab 05's record cites (${cited})`);
  if (record.vendored.files[0]?.sha256 !== cited) problems.push(`${where}#/vendored/files/0/sha256: not the journal Lab 05's record cites`);
  if (!journalBytes) return problems;
  let rows = [];
  try { rows = journalRows(journalBytes); } catch { problems.push(`${TAMPER_JOURNAL}: a row is not JSON`); return problems; }
  if (rows.length !== record.rows.length) problems.push(`${where}#/rows: ${record.rows.length} rows, the journal has ${rows.length}`);
  rows.forEach((r, i) => {
    const t = record.rows[i], g = rogueRecord?.governed.journal.rows[i];
    if (r.n !== i + 1) problems.push(`${TAMPER_JOURNAL}: row ${i + 1} is numbered ${r.n}`);
    if (!t || t.n !== r.n || t.hash !== r.hash || t.prev !== r.prev) problems.push(`${where}#/rows/${i}: not the journal's row ${i + 1}`);
    if (!g || g.n !== r.n || g.hash !== r.hash || g.prev !== r.prev || g.act !== r.act || g.by !== r.by) problems.push(`${TAMPER_JOURNAL}: row ${i + 1} is not the row Lab 05's record shows`);
  });
  // The journal is published as it is: its text passes the same screen.
  problems.push(...screenRecord(rows, TAMPER_JOURNAL));
  if (links(rows).some(l => l !== 'OK')) problems.push(`${TAMPER_JOURNAL}: a row's prev is not the hash of the row above`);
  const head = rows.at(-1)?.hash;
  if (record.head !== head || rogueRecord?.governed.journal.head !== head) problems.push(`${where}#/head: not the journal's last hash and Lab 05's published head`);

  // The tampered copies.
  const ids = record.cases.map(c => c.id);
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(CASES))) problems.push(`${where}#/cases: not the five copies this page describes, in order (${Object.keys(CASES).join(', ')})`);
  const expectLinks = { 'drop-row': links(rows.filter(r => r.n !== 3)), reorder: links([rows[0], rows[2], rows[1], ...rows.slice(3)]), 'drop-last': links(rows.slice(0, -1)) };
  record.cases.forEach((c, i) => {
    const at = `${where}#/cases/${i}`, want = CASES[c.id];
    if (!want) return;
    if (c.caught.check !== want.caughtBy) problems.push(`${at}/caught: caught by ${c.caught.check}; the page says ${want.caughtBy}`);
    const failing = c.result.filter(r => r.ownHash !== 'OK' || r.prevLink !== 'OK');
    if (want.caughtBy === 'head') {
      if (failing.length) problems.push(`${at}/result: a row check fails, but the page says only the head catches this copy`);
      if (c.head === head) problems.push(`${at}/head: the head is unchanged, so nothing would catch this copy`);
    } else {
      const first = failing[0];
      if (!first || first.position !== c.caught.position || first.n !== c.caught.n) problems.push(`${at}/caught: not the first row that fails`);
      if (c.head !== head) problems.push(`${at}/head: the head changed; the page says the head alone does not catch this copy`);
    }
    if (expectLinks[c.id] && JSON.stringify(c.result.map(r => r.prevLink)) !== JSON.stringify(expectLinks[c.id])) problems.push(`${at}/result: its links are not what JavaScript finds for the same copy`);
    if (expectLinks[c.id] && c.result.some(r => r.ownHash !== 'OK')) problems.push(`${at}/result: no row's content changed, so every own hash must still match`);
    // The flipped copy shows its change: the journal's own text before, and after, one bit of one letter flipped.
    if (c.id === 'byte-flip') {
      const row = rows[(c.row ?? 0) - 1];
      if (!row || row[c.field] !== c.before) problems.push(`${at}/before: not the journal's row ${c.row} ${c.field}`);
      const changed = typeof c.before === 'string' && typeof c.after === 'string' && c.before.length === c.after.length ? [...c.before].map((ch, k) => [ch, c.after[k]]).filter(([x, y]) => x !== y) : null;
      if (!changed || changed.length !== 1 || (changed[0][0].charCodeAt(0) ^ 0x20) !== changed[0][1].charCodeAt(0)) problems.push(`${at}/after: not one byte flipped`);
    } else if (c.before !== undefined || c.after !== undefined || c.row !== undefined || c.field !== undefined) problems.push(`${at}: only the flipped copy names a changed field`);
  });
  return problems;
}

/** The committed tamper section, pinned and checked against the Lab 05 record; null when there is none. */
export function readTamper(root = 'site', rogueRecord, { now = new Date() } = {}) {
  const journalPath = join(root, TAMPER_JOURNAL);
  const journalBytes = existsSync(journalPath) ? readFileSync(journalPath) : null;
  return readPinned({ root, file: TAMPER_RECORD, pin: bytes => sidecarPinProblems(root, bytes, { pinFile: TAMPER_PIN, file: TAMPER_RECORD, vendor: 'scripts/rogue_tamper.py' }), check: record => tamperProblems(record, journalBytes, rogueRecord, { now }), refused: 'Lab 05 tamper section refused' });
}

const short = h => `<code>${escape(h.slice(0, 12))}</code>`;
const mark = v => (v === 'OK' ? 'passes' : `<strong>${v === 'MISMATCH' ? 'fails' : 'broken'}</strong>`);
const resultTable = (rows, result) => `<div class="lab-table-wrap"><table><thead><tr><th scope="col">Position</th><th scope="col">Row</th><th scope="col">Own hash</th><th scope="col">Link to the row above</th></tr></thead><tbody>${result.map(r => `<tr><td>${r.position}</td><td>${r.n}</td><td>${mark(r.ownHash)}</td><td>${mark(r.prevLink)}</td></tr>`).join('')}</tbody></table></div>`;

/** The section's HTML: the real journal checked, then the gallery of tampered copies, boxed as copies we made. */
export function renderTamper(t, rogueRecord) {
  const mc = t.vendored.mainCheck;
  const rows = t.rows.map(r => `<tr><td>${r.n}</td><td>${mark(r.ownHash)}</td><td>${mark(r.prevLink)}</td><td>${short(r.hash)}</td></tr>`).join('');
  const cases = t.cases.map(c => {
    const want = CASES[c.id];
    const caught = c.caught.check === 'head'
      ? `Every row passes both checks. Caught only by ${CHECK_WORDS.head}: the copy's last row's hash is no longer ${short(t.head)}.`
      : `Caught by ${CHECK_WORDS[c.caught.check]}, at position ${c.caught.position} (row ${c.caught.n}). The last row's hash is unchanged, ${short(c.head)}, so the head alone would not have caught it.`;
    const change = c.id === 'byte-flip' ? `<p>Before: <code>${escape(c.before)}</code><br>After: <code>${escape(c.after)}</code></p>` : '';
    return `<article class="lab-panel rogue-tamper-case" id="tamper-${escape(c.id)}"><h4>${escape(want.title)}</h4><p>${escape(c.did[0].toUpperCase() + c.did.slice(1))}.</p>${change}${resultTable(t.rows, c.result)}<p class="rogue-outcome">${caught}</p></article>`;
  }).join('');
  const gallery = box('fixture', { cls: 'rogue-tamper-gallery', id: 'tamper-gallery', body: `<h3>Five tampered copies</h3><p>We made each copy ourselves, from the real journal, and ran it through the same check. Nobody tampered with the real one.</p><div class="rogue-acts">${cases}</div>` });
  return `<p>The journal is the governed run's own record of what it refused: ${t.rows.length} rows, each holding the hash of the row before it. Here it is in full, every row exactly as the engine wrote it, <a href="../../${TAMPER_JOURNAL}">published here</a>; it is the file the record above cites by sha256, <code>${escape(t.vendored.files[0].sha256)}</code>.</p><p>We checked it again by the engine's own rule (the rule its journal check uses, written out again in this site's own Python, not the engine's code), row by row, in two parts: each row's own hash, recomputed from the row, and each row's link to the row above. The rule: ${escape(t.rule)}.</p><p class="lab-source">The check ran in Python, when the journal was vendored, and runs again in every CI run of this site, which fails unless it gives the same result byte for byte. It is Python on purpose: each row's time is a whole number of seconds, which Python writes with a trailing <code>.0</code> and JavaScript without it, so a JavaScript re-hash would never match the engine's.</p><div class="lab-table-wrap"><table><thead><tr><th scope="col">Row</th><th scope="col">Own hash</th><th scope="col">Link to the row above</th><th scope="col">Hash</th></tr></thead><tbody>${rows}</tbody></table></div><p>All ${t.rows.length} rows pass both checks. The last row's hash, the head, is ${short(t.head)}, the head the record above publishes.</p>${gallery}<h3 class="lab-subhead">What each check catches</h3><ul class="rogue-list"><li>A change inside a row is caught by that row's own hash. A row removed or moved is caught by the link of the row after it. In those cases the head does not change.</li><li>A journal cut short, or rewritten with every hash recomputed, passes every row check. Only the head catches it, and only because the head is kept somewhere else: here, in the Lab 05 record and in this repository's public history.</li><li>So neither check is enough alone. The row checks say the journal is whole; the head says it is the journal that was published.</li></ul><p class="lab-source">From ${escape(t.vendored.from)}. ${cite(t.vendored.cites[0], mc)} The full check, <a href="../../${TAMPER_RECORD}">published here</a> and pinned by its sha256.</p>`;
}
