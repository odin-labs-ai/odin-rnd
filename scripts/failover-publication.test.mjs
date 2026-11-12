import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkCopies, copies } from './ledger-publish.mjs';

test('EXP 021 public document pins and copied records retain the publication evidence', () => {
  for (const line of readFileSync('experiments/failover/results/final-document-hashes.sha256', 'utf8').trim().split('\n')) {
    const [sum, file] = line.split('  ');
    assert.match(sum, /^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), sum, file);
  }
  checkCopies(copies.filter(copy => copy.id === 'EXP 021'));
  const source = JSON.parse(readFileSync('experiments/failover/results/publication-sources.json'));
  assert.equal(source.originalManifest.doesNotVerifyLaterDocuments, true);
  assert.notEqual(source.originalManifest.listedDisturbancesSha256, source.laterDocuments['DISTURBANCES.md'].sha256);
  assert.equal(source.laterDocuments['supervise.log'].commit, 'dc62a35fbb3a534738738d983cc24e3359dc9d6f');
  const result = JSON.parse(readFileSync('experiments/failover/results.json'));
  assert.equal(result.recount.countedCells, 334);
  assert.equal(result.recount.f2bFailingCells.length, 3);
  assert.equal(result.recount.strictAckCells.length, 10);
  assert.equal(result.recount.strictAckCells.reduce((sum, cell) => sum + cell.acks, 0), 15567);
  const page = readFileSync('site/journal/failover-results.html', 'utf8');
  assert.doesNotMatch(page, /REPOresults|REPOreviews/);
  for (const caveat of ['no overall winner', 'does not establish equal two-copy durability', 'Window I remains open', 'not final acceptance']) assert(page.toLowerCase().includes(caveat.toLowerCase()), caveat);
});
