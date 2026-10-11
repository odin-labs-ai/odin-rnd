import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { sha256, recordPath as preregPath } from './jev-gate-prereg.mjs';
import { articlePath } from './jev-gate-journal.mjs';
import { stripTags } from './test-html-text.mjs';
import { amendNoteErratum, checkErratum, differsOnlyInIssue, erratumPath, erratumPinPath, publishedErratumPath, renderErratumLine, validateErratum } from './jev-gate-erratum.mjs';

const prereg = JSON.parse(readFileSync(preregPath, 'utf8'));
const preregFileSha256 = sha256(readFileSync(preregPath));
const { record, sha256: digest, bytes } = checkErratum();
const context = { prereg, preregFileSha256 };
const copy = () => structuredClone(record);
const correction = record.corrections[0];
const wrongUrl = 'https://doi.org/10.1002/(SICI)1097-0258(19981030)17:20%3C2635::AID-SIM954%3E3.0.CO;2-C';
const rightUrl = 'https://doi.org/10.1002/(SICI)1097-0258(19981130)17:22%3C2635::AID-SIM954%3E3.0.CO;2-C';

test('the erratum passes --check: pinned, naming the pre-registration on disk, published byte for byte', () => {
  const out = execFileSync(process.execPath, ['scripts/jev-gate-erratum.mjs', '--check'], { encoding: 'utf8' });
  assert.match(out, /^PASS experiments\/jev-gate\/erratum-01\.json sha256 [a-f0-9]{64}/);
  assert.equal(readFileSync(erratumPinPath, 'utf8'), `${digest}  erratum-01.json\n`);
  assert.equal(record.parent.sha256, preregFileSha256);
  assert(readFileSync(publishedErratumPath).equals(bytes), 'The published copy is the committed erratum');
  assert.equal(correction.sourceId, 'newcombe-1998');
  assert.equal(correction.was, wrongUrl);
  assert.equal(correction.now, rightUrl);
});

test('the pre-registration is byte-unchanged against HEAD', () => {
  const head = execFileSync('git', ['show', `HEAD:${preregPath}`]);
  assert(readFileSync(preregPath).equals(head), `${preregPath} differs from HEAD`);
  assert.equal(sha256(head), record.parent.sha256);
});

test('a tampered erratum fails', () => {
  const wrongWas = copy(); wrongWas.corrections[0].was = rightUrl;
  assert.throws(() => validateErratum(wrongWas, context), /"was" is not the record's/);
  const wrongSource = copy(); wrongSource.corrections[0].sourceId = 'wilson-1927';
  assert.throws(() => validateErratum(wrongSource, context), /"was" is not the record's/);
  const wrongParent = copy(); wrongParent.parent.sha256 = '0'.repeat(64);
  assert.throws(() => validateErratum(wrongParent, context), /pre-registration other than/);
  assert.throws(() => validateErratum(copy(), { prereg, preregFileSha256: '1'.repeat(64) }), /other than the one on disk/);
  const otherPart = copy(); otherPart.corrections[0].now = rightUrl.replace('AID-SIM954', 'AID-SIM955');
  assert.throws(() => validateErratum(otherPart, context), /only in the issue part/);
  const wrongField = copy(); wrongField.corrections[0].field = 'label';
  assert.throws(() => validateErratum(wrongField, context), /citation link only/);
  assert.equal(differsOnlyInIssue(wrongUrl, rightUrl), true);
  assert.equal(differsOnlyInIssue(wrongUrl, wrongUrl), false);
});

test('a site copy or pin that differs from the committed erratum fails the check', () => {
  // checkErratum reads from a root: a scratch root holds only the files it reads, copied from the checkout.
  const root = mkdtempSync(join(tmpdir(), 'jev-gate-erratum-'));
  try {
    for (const file of [preregPath, 'experiments/jev-gate/preregistration.sha256', erratumPath, erratumPinPath, publishedErratumPath]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(file, join(root, file));
    }
    assert.equal(checkErratum(root).sha256, digest, 'the scratch copy passes as committed');
    writeFileSync(join(root, publishedErratumPath), Buffer.concat([bytes, Buffer.from(' ')]));
    assert.throws(() => checkErratum(root), /is not the committed erratum/);
    copyFileSync(erratumPath, join(root, publishedErratumPath));
    writeFileSync(join(root, erratumPinPath), `${'2'.repeat(64)}  erratum-01.json\n`);
    assert.throws(() => checkErratum(root), /differs from the sha256 pinned/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the built field note carries the dated erratum line inside the Newcombe entry, and nothing else moves', () => {
  const built = readFileSync(join(builtCopy(), 'dist', articlePath.slice('site/'.length)), 'utf8');
  const line = renderErratumLine(record, correction);
  assert.equal(built.split(line).length, 2, 'The erratum line appears once');
  assert.equal(built.split(`<a href="${rightUrl}">`).length, 2, 'The corrected link appears once');
  assert.equal(built.split(`<a href="${wrongUrl}">`).length, 2, 'The record\'s own link is still shown as the record has it');
  const item = built.slice(built.indexOf(`<li><a href="${wrongUrl}">`), built.indexOf('</li>', built.indexOf(`<li><a href="${wrongUrl}">`)));
  assert(item.includes(line), 'The line sits inside the Newcombe list item');
  const text = stripTags(line, '').replace(/\s+/g, ' ').trim();
  assert.equal(text, 'Erratum 11 Oct 2026: the DOI link in the frozen record does not resolve; the correct link is doi.org/10.1002/(SICI)1097-0258(19981130)17:22&lt;2635::AID-SIM954&gt;3.0.CO;2-C. The record is unchanged. The erratum record.');
  // The only difference the erratum makes to the committed note is that line.
  const note = readFileSync(articlePath, 'utf8');
  assert.equal(amendNoteErratum(note, record).replace(line, ''), note);
  assert.throws(() => amendNoteErratum(amendNoteErratum(note, record), record), /already carries/);
  assert(readFileSync(join(builtCopy(), 'dist', publishedErratumPath.slice('site/'.length))).equals(bytes), 'dist serves the erratum byte for byte');
});
