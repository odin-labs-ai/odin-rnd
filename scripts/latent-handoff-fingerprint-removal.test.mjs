import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as headFences from './latent-handoff-fences.mjs';

// A restricted fingerprint may be removed only by a diff that also adds the sha256 commitment of an
// operator-signed permission record (kept privately; only its hash is public). The commitment proves that a
// record exists, not that it is genuine: the operator's signature is the human half of this gate.
const { removedFingerprints, removalVerdict, parseFingerprintMap, fingerprintEntries, diffBase, fileAt, loadBaseFences } = headFences;

const sha = text => createHash('sha256').update(text).digest('hex');
const line = map => `export const restrictedFingerprints = ${JSON.stringify(map)};\n`;
const base = line({ '6': [sha('qzxwvk'), sha('#90712')], '5': [sha('e7e7a')] });
const dropped = line({ '6': [sha('qzxwvk')], '5': [sha('e7e7a')] });

test('removing a fingerprint without the commitment is refused; adding the commitment admits it', () => {
  const removed = removedFingerprints(base, dropped);
  assert.deepEqual(removed, [`6:${sha('#90712')}`]);
  const one = `${sha('a signed synthetic record')}\n`, two = `${one}${sha('a second signed synthetic record')}\n`;
  assert.equal(removalVerdict({ removed, commitmentAtBase: null, commitmentAtHead: null }).ok, false);
  assert.equal(removalVerdict({ removed, commitmentAtBase: null, commitmentAtHead: one }).ok, true);
  // Append-only: a second removal adds a second line; the first stays as it was.
  assert.equal(removalVerdict({ removed, commitmentAtBase: one, commitmentAtHead: one }).ok, false);
  assert.equal(removalVerdict({ removed, commitmentAtBase: one, commitmentAtHead: two }).ok, true);
  // One record cannot be reused for a second removal.
  assert.equal(removalVerdict({ removed, commitmentAtBase: one, commitmentAtHead: `${one}${one}` }).ok, false);
  // Deleting or rewriting an earlier line is refused even when nothing is removed.
  for (const head of [null, '', `${sha('other')}\n`, `${sha('a second signed synthetic record')}\n`]) {
    assert.equal(removalVerdict({ removed: [], commitmentAtBase: one, commitmentAtHead: head }).ok, false, JSON.stringify(head));
  }
  assert.equal(removalVerdict({ removed: [], commitmentAtBase: null, commitmentAtHead: null }).ok, true);
  // Every line must be one lowercase sha256.
  for (const bad of ['not a hash\n', `${sha('x').toUpperCase()}\n`, `${sha('x')}${sha('y')}\n`, `${sha('x').slice(1)}\n`]) {
    assert.equal(removalVerdict({ removed, commitmentAtBase: null, commitmentAtHead: bad }).ok, false, JSON.stringify(bad));
  }
  // Moving a digest to another size key is a removal too; adding fingerprints never is.
  assert.equal(removedFingerprints(base, line({ '6': [sha('qzxwvk')], '7': [sha('#90712')], '5': [sha('e7e7a')] })).length, 1);
  assert.deepEqual(removedFingerprints(base, line({ '6': [sha('qzxwvk'), sha('#90712'), sha('new')], '5': [sha('e7e7a')] })), []);
  // Deleting the list or the file, splitting it over lines, or shadowing it with a second declaration is refused outright.
  assert.throws(() => removedFingerprints(base, 'export const restrictedFingerprints = {\n};'), /exactly one line \(found 0\)/);
  assert.throws(() => removedFingerprints(base, `/*\n${base}*/\nexport const restrictedFingerprints = {};\n`), /exactly one line \(found 2\)/);
  assert.throws(() => removedFingerprints(base, null), /missing/);
});

test('this change removes no fingerprint without a signed-record commitment, judged by the fences at its base', async t => {
  const at = diffBase(process.cwd());
  if (!at) {
    // In a pull_request run the base must be established; anywhere else there is no change to judge.
    assert.notEqual(process.env.GITHUB_EVENT_NAME, 'pull_request', 'no diff base in a pull_request run (fails closed)');
    t.skip('no origin/main to compare against');
    return;
  }
  const judge = (await loadBaseFences(at, process.cwd())) ?? headFences;
  const baseSource = fileAt(at, judge.fingerprintFile, process.cwd());
  if (baseSource === null) { t.skip(`${judge.fingerprintFile} does not exist at the base yet`); return; }
  const headSource = existsSync(judge.fingerprintFile) ? readFileSync(judge.fingerprintFile, 'utf8') : null;
  const removed = judge.removedFingerprints(baseSource, headSource);
  const verdict = judge.removalVerdict({
    removed,
    commitmentAtBase: fileAt(at, judge.commitmentPath, process.cwd()),
    commitmentAtHead: existsSync(judge.commitmentPath) ? readFileSync(judge.commitmentPath, 'utf8') : null,
  });
  assert(verdict.ok, verdict.reason);
});

test('the fingerprints the scanner actually uses are exactly the declared line, and cannot be changed at run time', async () => {
  const declared = parseFingerprintMap(readFileSync(headFences.fingerprintFile, 'utf8'));
  const { restrictedFingerprints } = await import(pathToFileURL(resolve(headFences.fingerprintFile)).href);
  assert.deepEqual(fingerprintEntries(restrictedFingerprints), fingerprintEntries(declared));
  assert(Object.isFrozen(restrictedFingerprints) && Object.values(restrictedFingerprints).every(Object.isFrozen));
});
