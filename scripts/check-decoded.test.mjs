// vp-rnd-frontier-residuals R4: the site check scans raw text only, so a restricted term written as hex or base64
// passed it. check.mjs is pinned by EXP 006 and EXP 007 (their runners.sha256), so the decoding pass is a separate
// tripwire, check-decoded.mjs, run over the built site by check-decoded-site.test.mjs. It reads the same list from
// check.mjs's source. Proved here with synthetic terms; the real list is only checked for parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restrictedFingerprints as latentHandoffList } from './latent-handoff-private-terms.mjs';
import { checkFingerprints, decodedViews, encodedRestricted, scanDecoded } from './check-decoded.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const term = 'qzxwvk';
const synthetic = { [term.length]: [sha(term)] };
const hex = text => Buffer.from(text, 'utf8').toString('hex');
const b64 = text => Buffer.from(text, 'utf8').toString('base64');
const b64url = text => Buffer.from(text, 'utf8').toString('base64url');
const scan = text => encodedRestricted(text, synthetic);

test('the fingerprint list is the one check.mjs declares, not a copy', () => {
  assert.deepEqual(checkFingerprints(), latentHandoffList);
});

test('a term written as hex, base64 or base64url is refused, in any case', () => {
  for (const encoded of [
    hex(`note ${term} here`), hex(`NOTE ${term.toUpperCase()}`).toUpperCase(),
    b64(`a line about ${term}.`), b64url(`a line about ${term}?>>`), b64(`${term}`).replace(/=+$/, ''),
  ]) {
    assert.equal(scan(`<p data-x="${encoded}">ok</p>`), true, encoded);
    assert.equal(scan(`{"blob":"${encoded}"}`), true, encoded);
  }
});

test('ordinary text, digests and unrelated encodings pass', () => {
  const digest = sha('a random control row');
  for (const text of [
    'plain prose with no encoded content at all',
    `{"sha256":"${digest}","git":"${digest.slice(0, 40)}"}`,
    `<p data-x="${hex('an unrelated sentence')}">${b64('nothing restricted in here')}</p>`,
    'scripts/activity-sitewide.test.mjs and blueprint-floor-census-rehearsal',
  ]) assert.equal(scan(text), false, text);
});

test('the raw term is check.mjs\'s job, not this one', () => {
  // This pass only looks at decoded content, so it never double-reports what check.mjs already refuses.
  assert.equal(scan(`plain ${term} text`), false);
});

test('decodedViews keeps only decodings that are readable text', () => {
  const views = decodedViews(`x ${hex('readable words')} y ${sha('digest')} z`);
  assert(views.includes('readable words'));
  assert.equal(views.length, 1, 'a random digest does not decode to text');
});

test('scanDecoded reports the file that carries an encoded term', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-decoded-'));
  try {
    mkdirSync(join(root, 'journal'));
    writeFileSync(join(root, 'journal/clean.html'), '<p>fine</p>');
    writeFileSync(join(root, 'journal/leak.html'), `<p data-x="${b64(`about ${term}`)}"></p>`);
    writeFileSync(join(root, 'font.woff2'), b64(`about ${term}`));
    assert.deepEqual(scanDecoded(root, synthetic), ['journal/leak.html']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
