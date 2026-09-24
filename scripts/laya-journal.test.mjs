import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { articlePath, dataDir, loadPublished, renderArticle, sha256, slug, validateResults, verdicts } from './laya-journal.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/laya-vs-jev.fixture.json', import.meta.url)));
const measured = () => { const r = fixture(); delete r.fixture; return r; };

test('a fixture renders only with visible FIXTURE labels', () => {
  const html = renderArticle({ results: fixture() });
  assert.match(html, /FIXTURE — NOT A MEASUREMENT/);
  assert.match(html, /FIXTURE VALUES/);
  assert.doesNotMatch(html, /MEASURED ON THIS MACHINE/);
  assert.doesNotMatch(html, /<!--[A-Z_]+-->/);
});

test('the results contract rejects missing fields, percent scales and local paths', () => {
  for (const mutate of [
    r => { delete r.perModel; },
    r => { delete r.perModel.jev.p90Ms; },
    r => { r.perModel.jev.accuracy = 75; },
    r => { r.agreement = {}; },
    r => { r.corpus.sha256 = 'abc'; },
    r => { r.perModel.ghost = r.perModel.jev; },
    r => { r.notes.push('/Users/someone/model'); },
  ]) { const r = measured(); mutate(r); assert.throws(() => validateResults(r)); }
  assert.doesNotThrow(() => validateResults(measured()));
});

test('criteria stay UNVERIFIED without Jev and turn RED past the stated margin', () => {
  const noJev = measured();
  noJev.agreement.laya_vs_jev = null;
  noJev.perModel.jev = { ...noJev.perModel.jev, accuracy: null, calibratedAccuracy: null, p50Ms: null, p90Ms: null, maxMs: null, costPer1kUsd: null };
  const byId = Object.fromEntries(verdicts(noJev).map(v => [v.id, v.label]));
  assert.equal(byId['laya-typed-decisions-accuracy'], 'UNVERIFIED');
  assert.equal(byId.parity, 'UNVERIFIED');
  assert.match(renderArticle({ results: noJev, fixture: true }), /Jev was not run in this recording/);
  const behind = measured();
  behind.perModel.jev.accuracy = 0.9;
  behind.parity = { decisionMismatches: 1, maxTopProbDelta: 0.002 };
  const labels = Object.fromEntries(verdicts(behind).map(v => [v.id, v.label]));
  assert.equal(labels['laya-typed-decisions-accuracy'], 'RED');
  assert.equal(labels.parity, 'RED');
  assert.equal(labels['laya-typed-decisions-confidence'], 'GREEN');
});

test('publication refuses fixtures, changed bytes and non-measured manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'laya-journal-'));
  mkdirSync(join(root, dataDir), { recursive: true });
  const write = (results, manifestPatch = {}) => {
    const bytes = JSON.stringify(results);
    writeFileSync(join(root, dataDir, 'r.json'), bytes);
    writeFileSync(join(root, dataDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'measured', file: 'r.json', sha256: sha256(bytes), source: { repository: 'odin-labs-ai/odin-rnd', branch: 'b', revision: 'a'.repeat(40), path: 'experiments/laya-vs-jev/results/r.json' }, copiedAt: '2026-09-24T00:00:00Z', ...manifestPatch }));
  };
  write(fixture());
  assert.throws(() => loadPublished(root), /fixture/i);
  write(measured(), { kind: 'fixture' });
  assert.throws(() => loadPublished(root), /measured/);
  write(measured(), { sha256: '0'.repeat(64) });
  assert.throws(() => loadPublished(root), /sha256/);
  write(measured());
  assert.doesNotThrow(() => loadPublished(root));
});

test('the published article is exactly the render of the copied measured record', () => {
  const published = loadPublished();
  const listed = readFileSync('site/index.html', 'utf8').includes(`journal/${slug}.html`) || readFileSync('site/sitemap.xml', 'utf8').includes(`journal/${slug}.html`);
  if (!published) {
    assert(!existsSync(articlePath) && !listed, 'The article and its floor listing require a measured record');
    return;
  }
  assert(existsSync(articlePath), 'Measured record present but article missing: run node scripts/laya-journal.mjs --write');
  assert.equal(readFileSync(articlePath, 'utf8'), renderArticle(published), 'Article differs from its results record');
  assert.doesNotMatch(readFileSync(articlePath, 'utf8'), /FIXTURE/);
  assert(readFileSync('site/index.html', 'utf8').includes(`journal/${slug}.html`), 'Article missing from the floor');
  assert(readFileSync('site/sitemap.xml', 'utf8').includes(`journal/${slug}.html`), 'Article missing from the sitemap');
});
