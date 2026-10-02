import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as headScanner from './latent-handoff-private-terms.mjs';
import { diffBase, loadBaseModule, fingerprintFile } from './latent-handoff-fences.mjs';
import { builtCopy } from './test-build.mjs';

const { restrictedFingerprints, restrictedContent, scanTree, privateFingerprints } = headScanner;
// The tree is judged by the scanner AS IT IS AT THE BASE when one exists, so a change cannot disarm the scan it is
// judged by (e.g. by emptying a default); the change that introduces the scanner is judged by itself, once.
// This test file itself runs from the PR head: see the honest limit in latent-handoff-fences.mjs.
async function judgeScanner() {
  const base = diffBase(process.cwd());
  assert(base || process.env.GITHUB_EVENT_NAME !== 'pull_request', 'no diff base in a pull_request run (fails closed)');
  return (base && await loadBaseModule(base, fingerprintFile, process.cwd())) || headScanner;
}

// These tests never store a private term, in plain text, as a digest or in any decodable form. The mechanism is
// proved with synthetic terms of assorted shapes (with spaces, hyphens, punctuation, digits, and an all-hex one).
// The private terms are exercised only from a private file outside the repository (LH_PRIVATE_TERMS).

const sha = text => createHash('sha256').update(text).digest('hex');
const fingerprintEntriesOf = map => new Set(Object.entries(map).flatMap(([size, digests]) => digests.map(digest => `${size}:${digest}`)));
const synthetic = ['qzxwv', 'qzxwvk', 'qz-xwvk', 'mlo, kqwpz', 'vyt kqu pzr', '#90712', 'e7e7a', 'kqwpzvyttrq', 'pzrmloqzxwvkjy'];
const syntheticFingerprints = {};
for (const term of synthetic) (syntheticFingerprints[term.length] ||= []).push(sha(term));
const caseVariants = term => [...new Set([term, term.toUpperCase(), term.replace(/(^|[\s-])(\w)/g, (_, sep, ch) => sep + ch.toUpperCase())])];

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'odin-latent-handoff-terms-'));
  for (const dir of ['site/journal', 'experiments/latent-handoff', 'dist']) mkdirSync(join(root, dir), { recursive: true });
  return { root, write: (path, body) => writeFileSync(join(root, path), body), done: () => rmSync(root, { recursive: true, force: true }) };
}

function refusedOnEverySurface(terms, fingerprints) {
  const box = sandbox();
  let cases = 0;
  try {
    terms.forEach((term, index) => {
      for (const variant of caseVariants(term)) {
        for (const [path, body] of [
          ['site/journal/note.html', `<p>handoff by ${variant} today</p>`],
          ['dist/page.html', `<p>handoff by ${variant} today</p>`],
          ['experiments/latent-handoff/rows.jsonl', `{"id":1,"note":"handoff by ${variant} today"}\n`],
          ['experiments/latent-handoff/record.json', JSON.stringify({ note: `by ${variant}` })],
        ]) {
          box.write(path, body);
          assert.deepEqual(scanTree(box.root, fingerprints), [path], `term ${index + 1} in ${path}`);
          box.write(path, '{}');
          cases += 1;
        }
      }
    });
    assert.deepEqual(scanTree(box.root, fingerprints), [], 'clean controls pass');
  } finally { box.done(); }
  return cases;
}

test('every synthetic term shape is refused in a page source, a built page, a JSONL row and a JSON record, in every case variant', () => {
  const cases = refusedOnEverySurface(synthetic, syntheticFingerprints);
  // Every shape, every case variant, on all four surfaces: none skipped.
  assert.equal(cases, synthetic.reduce((sum, term) => sum + caseVariants(term).length * 4, 0));
});

test('a digest run is not text, but the same term as a token is still refused', () => {
  const hexTerm = 'e7e7a', scan = text => restrictedContent(text, syntheticFingerprints);
  const control = sha('latent-handoff random-hex control row');
  assert.equal(control.includes(hexTerm), false);
  // The EXP 006 false-positive class: a random 64-hex digest passes, against the synthetic and the real list.
  assert.equal(scan(`{"sha256":"${control}"}`), false);
  assert.equal(restrictedContent(`{"sha256":"${control}"}`), false);
  // A 64-hex or 40-hex digest that happens to contain the all-hex term passes.
  const carrier = `${control.slice(0, 30)}${hexTerm}${control.slice(30 + hexTerm.length)}`;
  assert.equal(scan(`{"sha256":"${carrier}","git":"${carrier.slice(0, 40)}"}`), false);
  // An all-hex term counts only as a whole token: inside a short SHA, a blob id or a longer hex word it is not text.
  for (const host of [`index 0a${hexTerm}1..b7c9e21 100644`, `{"commit":"9a${hexTerm}b"}`, `{"short":"${carrier.slice(0, 39)}"}`]) assert.equal(scan(host), false, host);
  // As a whole token, bounded by non-hex characters, it is refused in any case.
  for (const host of [`{"x":"${hexTerm.toUpperCase()}"}`, `id ${hexTerm}-x`, `${hexTerm}`]) assert.equal(scan(host), true, host);
  // A term is never hidden by a digest written against it, whether the term starts or ends with a hex letter,
  // and a '#nnn' token cannot merge into one.
  assert.equal(scan(`${control}qzxwvk${control}`), true);
  const edged = { 4: [sha('deck')], 5: [sha('qkbad')] };
  for (const host of [`by deck today`, `${control}deck`, `index ${control.slice(0, 40)}deck..`, `deck${control}`, `qkbad${control}`, `${control}qkbad${control}`]) assert.equal(restrictedContent(host, edged), true, host);
  // Whatever touches the run (a space, '-', '_', an accented letter), a term written against a digest is scanned.
  const named = {};
  for (const term of ['ann dee', 'jo-bead', 'jo_bead', 'dee ann', 'renée', 'zoë ad']) (named[term.length] ||= []).push(sha(term));
  for (const host of [`by renée${control}`, `ann dee${control}`, `jo-bead${control}`, `jo_bead${control}`, `${control}dee ann`, `${control}zoë ad`]) assert.equal(restrictedContent(host, named), true, host);
  assert.equal(scan(`ref #90712${'a'.repeat(40)}`), true);
});

test('a restricted term in a file name, a demo, a doc or an extensionless file is refused', () => {
  const box = sandbox();
  try {
    for (const dir of ['demos/x', 'docs', 'research']) mkdirSync(join(box.root, dir), { recursive: true });
    box.write('site/journal/qzxwvk-note.html', '<p>clean</p>');
    assert.deepEqual(scanTree(box.root, syntheticFingerprints), ['site/journal/qzxwvk-note.html']);
    rmSync(join(box.root, 'site/journal/qzxwvk-note.html'));
    for (const path of ['demos/x/README', 'docs/notes.yaml', 'research/table.tsv']) {
      box.write(path, 'by qzxwvk');
      assert.deepEqual(scanTree(box.root, syntheticFingerprints), [path], path);
      box.write(path, 'clean');
    }
  } finally { box.done(); }
});

test('the public list adds no information: it is exactly the list scripts/check.mjs already publishes', () => {
  const published = JSON.parse(readFileSync('scripts/check.mjs', 'utf8').match(/const restrictedFingerprints = (\{.*?\});/)[1]);
  for (const [size, digests] of Object.entries(restrictedFingerprints)) {
    for (const digest of digests) assert((published[size] ?? []).includes(digest), `size ${size} digest ${digest.slice(0, 8)}… is not already public in check.mjs: a short term's sha256 is reversible, so a new one would publish the term`);
  }
  // Exactly that list until a permitted removal lands (latent-handoff-fences.mjs); after that it may only shrink.
  // Coupling, by design: a term added to check.mjs must be mirrored here, and only a fences branch may edit this file.
  const removalLanded = existsSync('experiments/latent-handoff/permission.sha256');
  if (!removalLanded) assert.deepEqual(fingerprintEntriesOf(restrictedFingerprints), fingerprintEntriesOf(published));
});

test('the committed tree carries no restricted term (site sources, every record, demos, research, docs, latent-handoff scripts)', async () => {
  const judge = await judgeScanner();
  assert(Object.values(judge.restrictedFingerprints).flat().length > 0, 'the fingerprint list is not empty');
  assert.deepEqual(judge.scanTree('.', judge.restrictedFingerprints, judge.scannedDirs), []);
});

test('the built site carries no restricted term (built in a disposable copy: CI runs the tests before the build)', async () => {
  const judge = await judgeScanner();
  const copy = builtCopy();
  assert(existsSync(join(copy, 'dist/index.html')), 'the copy built a site');
  assert.deepEqual(judge.scanTree(copy, judge.restrictedFingerprints, ['dist']), []);
});

test('the private terms are refused (governed publish path only, from a private file outside the repository)', t => {
  const file = process.env.LH_PRIVATE_TERMS;
  if (!file || !existsSync(file)) { t.skip('LH_PRIVATE_TERMS not set: the real terms are never stored in this repository'); return; }
  const terms = readFileSync(file, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
  assert(terms.length > 0);
  t.diagnostic(`${terms.length} private terms, ${refusedOnEverySurface(terms, privateFingerprints(file))} refused cases`);
});
