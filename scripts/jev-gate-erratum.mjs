// Validates EXP 005 erratum 01, a dated, citation-only note beside the frozen pre-registration: it corrects
// one source link and changes nothing else. The pre-registration stays byte-identical; this note names it by
// sha256, states the link as the record has it and the link that resolves, and the build renders one dated
// line beside that source on the field note.
//   node scripts/jev-gate-erratum.mjs --check   validate; print the erratum's sha256
//   node scripts/jev-gate-erratum.mjs --pin     after review, pin the erratum's sha256 in erratum-01.sha256
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, recordPath as preregPath } from './jev-gate-prereg.mjs';
import { publishedParentSha256 as preregSha256 } from './jev-gate-amendment.mjs';

const dir = 'experiments/jev-gate';
export const erratumPath = `${dir}/erratum-01.json`;
export const erratumPinPath = `${dir}/erratum-01.sha256`;
export const preregPinPath = `${dir}/preregistration.sha256`;
export const publishedErratumPath = 'site/data/jev-gate/erratum-01.json';
export const erratumDataPath = 'data/jev-gate/erratum-01.json';
const placeholder = '{now}';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const str = v => typeof v === 'string' && v.length > 0;

// A Wiley SICI DOI's issue part, (YYYYMMDD)VV:II followed by the encoded "<"; null if the url has none.
const issuePart = /\((\d{8})\)(\d{1,3}):(\d{1,3})%3C/;
export function splitIssue(url) {
  const m = issuePart.exec(url);
  return m ? { issue: m[0], rest: url.slice(0, m.index) + '\0' + url.slice(m.index + m[0].length) } : null;
}
// True when two DOI urls differ only in that issue part.
export function differsOnlyInIssue(was, now) {
  const a = splitIssue(was), b = splitIssue(now);
  return Boolean(a && b) && a.rest === b.rest && a.issue !== b.issue;
}

// Checks the erratum against the pre-registration it names. Pure: the caller passes the parsed records and the parent's sha256.
export function validateErratum(erratum, { prereg, preregFileSha256 }) {
  assert.equal(erratum.schemaVersion, 1);
  assert.equal(erratum.kind, 'erratum');
  assert.equal(erratum.id, 'erratum-01');
  assert.equal(erratum.experiment, prereg.experiment.id, 'The erratum names a different experiment');
  assert.match(erratum.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const field of ['title', 'statusText', 'scope']) assert(str(erratum[field]), `The erratum has no ${field}`);
  assert.equal(erratum.parent?.file, 'preregistration.json');
  assert.equal(erratum.parent.sha256, preregSha256, 'The erratum names a pre-registration other than the published one');
  assert.equal(erratum.parent.sha256, preregFileSha256, 'The erratum names a pre-registration other than the one on disk');
  assert(str(erratum.statement) && erratum.statement.split(placeholder).length === 2, `The statement must carry ${placeholder} exactly once`);
  assert(Array.isArray(erratum.corrections) && erratum.corrections.length === 1, 'Erratum 01 makes exactly one correction');
  for (const c of erratum.corrections) {
    assert.equal(c.field, 'url', 'Erratum 01 corrects a citation link only');
    const source = prereg.sources.find(s => s.id === c.sourceId);
    assert(source, `The pre-registration has no source ${c.sourceId}`);
    assert.equal(c.was, source[c.field], `"was" is not the record's ${c.sourceId}.${c.field}`);
    assert(str(c.now) && c.now.startsWith('https://doi.org/'), '"now" is not a doi.org link');
    assert(differsOnlyInIssue(c.was, c.now), '"now" must differ from "was" only in the issue part of the DOI');
    const e = c.evidence ?? {};
    assert.match(e.checkedOn ?? '', /^\d{4}-\d{2}-\d{2}$/);
    for (const field of ['wasHandle', 'nowHandle', 'difference']) assert(str(e[field]), `The evidence has no ${field}`);
    for (const field of ['title', 'journal', 'volume', 'issue', 'pages', 'published']) assert(str(e.crossref?.[field]), `The Crossref evidence has no ${field}`);
    assert(c.now.includes(`${e.crossref.volume}:${e.crossref.issue}%3C`), 'The corrected DOI does not carry the Crossref volume and issue');
  }
  return erratum;
}

// Validates the committed erratum, its pin, its parent and its published copy. Returns { record, sha256, bytes }.
export function checkErratum(root = '.') {
  const read = file => readFileSync(join(root, file));
  const preregBytes = read(preregPath);
  const preregFileSha256 = sha256(preregBytes);
  assert.equal(preregFileSha256, preregSha256, `${preregPath} is not the published pre-registration`);
  assert.equal(read(preregPinPath).toString('utf8').split(/\s+/)[0], preregFileSha256, `${preregPinPath} does not pin the pre-registration on disk`);
  const bytes = read(erratumPath);
  const pinned = existsSync(join(root, erratumPinPath)) ? read(erratumPinPath).toString('utf8').split(/\s+/)[0] : null;
  assert.equal(pinned, sha256(bytes), `${erratumPath} differs from the sha256 pinned in ${erratumPinPath}: review the change, then node scripts/jev-gate-erratum.mjs --pin`);
  const record = validateErratum(JSON.parse(bytes), { prereg: JSON.parse(preregBytes), preregFileSha256 });
  assert(existsSync(join(root, publishedErratumPath)) && read(publishedErratumPath).equals(bytes), `${publishedErratumPath} is not the committed erratum, byte for byte`);
  return { record, sha256: sha256(bytes), bytes };
}

// The dated line the field note shows inside the corrected source's entry. `prefix` reaches the data dir from the page.
export function renderErratumLine(erratum, correction, prefix = '../') {
  const shown = decodeURIComponent(correction.now.slice('https://'.length));
  const [before, after] = erratum.statement.split(placeholder);
  return ` <span><strong>${escape(erratum.statusText)}:</strong> ${escape(before)}<a href="${escape(correction.now)}">${escape(shown)}</a>${escape(after)} <a href="${prefix}${erratumDataPath}">The erratum record</a>.</span>`;
}

// The built note: each corrected source's entry carries the dated line, before its closing </li>. Nothing else moves.
export function amendNoteErratum(note, erratum) {
  let out = note;
  for (const c of erratum.corrections) {
    const marker = `<li><a href="${escape(c.was)}">`;
    assert.equal(out.split(marker).length, 2, `The note must list ${c.sourceId} exactly once`);
    assert(!out.includes(`<a href="${escape(c.now)}">`), `The note already carries the corrected link for ${c.sourceId}`);
    const at = out.indexOf('</li>', out.indexOf(marker));
    assert(at > 0, `No list item end after ${c.sourceId}`);
    out = out.slice(0, at) + renderErratumLine(erratum, c) + out.slice(at);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === '--pin') {
    const preregBytes = readFileSync(preregPath);
    validateErratum(JSON.parse(readFileSync(erratumPath, 'utf8')), { prereg: JSON.parse(preregBytes), preregFileSha256: sha256(preregBytes) });
    writeFileSync(erratumPinPath, `${sha256(readFileSync(erratumPath))}  erratum-01.json\n`);
    console.log(`Pinned ${erratumPath} in ${erratumPinPath}.`);
  } else if (command !== '--check') {
    console.error('usage: node scripts/jev-gate-erratum.mjs --check | --pin');
    process.exit(2);
  }
  const { sha256: digest } = checkErratum();
  console.log(`PASS ${erratumPath} sha256 ${digest} (pre-registration ${preregSha256}, unchanged)`);
}
