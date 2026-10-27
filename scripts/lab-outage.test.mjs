import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAIN_CLAIM, OUTAGE_RECORD, citeSource, outageProblems, readOutage, renderOutage } from './lab-outage.mjs';

// Lab 01's Dispatch #2 (lane dispatch2-film): the film pinned by its sha256, its screen, and a citation that never
// claims the private main for a commit that is not on it.
const sha256 = data => createHash('sha256').update(data).digest('hex');
const committed = () => JSON.parse(readFileSync(join('site', OUTAGE_RECORD), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

// A scratch site root holding the committed record and its two files (the real bytes).
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'lab-outage-'));
  cpSync('site/data/labs/agent-space/outage.json', join(root, OUTAGE_RECORD));
  cpSync('site/assets/labs/agent-space/outage', join(root, 'assets/labs/agent-space/outage'), { recursive: true });
  return root;
}

test('the committed record passes, and the film on disk is the one it pins', () => {
  const record = committed();
  assert.deepEqual(outageProblems(record, { root: 'site' }), []);
  const film = readFileSync(join('site', record.film.src)), poster = readFileSync(join('site', record.film.poster));
  assert.equal(sha256(film), record.film.sha256.src);
  assert.equal(sha256(poster), record.film.sha256.poster);
  assert.equal(statSync(join('site', record.film.src)).size, record.film.bytes);
  assert.equal(record.screening.srcSha256, record.film.sha256.src);
  assert.ok(record.film.bytes <= 6 * 1024 * 1024, 'the film is within the 6 MB agreement');
  assert.ok(readOutage('site'));
});

test('a film or poster that differs by one byte, or has a different size, is refused', () => {
  const root = scratch();
  try {
    const record = committed(), src = join(root, record.film.src);
    const bytes = readFileSync(src);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(src, bytes);
    assert.ok(outageProblems(record, { root }).some(p => p.includes('does not match its recorded sha256')));
    writeFileSync(src, Buffer.concat([bytes, Buffer.from('x')]));
    assert.ok(outageProblems(record, { root }).some(p => p.includes('bytes on disk')));
    assert.throws(() => readOutage(root), /Dispatch #2 refused/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('while onMain is false the citation says "not yet part of the private main" and never claims it', () => {
  const record = committed();
  assert.equal(record.source.onMain, false);
  assert.match(record.source.baseMain, /^[0-9a-f]{40}$/);
  const words = citeSource(record.source);
  assert.match(words, /not yet part of the private main/);
  assert.doesNotMatch(words, MAIN_CLAIM);
  assert.doesNotMatch(words, /checked as part of the private main/);
  assert.match(words, /from private commit <code>d02ee74b<\/code>/);
  assert.match(words, /the main of 27 October \(<code>aa35e6db<\/code>\) plus two changes/);
  assert.match(words, /Cited by hash; this page cannot check it, anyone with access can\./);
  const html = renderOutage(record);
  assert.doesNotMatch(html, MAIN_CLAIM);
  assert.doesNotMatch(html, /checked as part of the private main/);
});

test('a record that claims main while onMain is false, or flips onMain without a main check, is refused', () => {
  const claim = clone(committed());
  claim.staged = 'Filmed from a commit checked as part of the private main.';
  assert.ok(outageProblems(claim).some(p => p.includes('claims the private main')));
  const flipped = clone(committed());
  flipped.source.onMain = true;
  assert.ok(outageProblems(flipped).some(p => p.includes('no mainCheck')));
  const stray = clone(committed());
  stray.source.mainCheck = { main: 'a'.repeat(40), checked: '2026-10-28', how: 'GitHub compare against the private main head' };
  assert.ok(outageProblems(stray).some(p => p.includes('a main check for a commit marked not on main')));
  // Once the lane merges, a re-cite flips onMain and adds the main check; then the main wording is allowed.
  const merged = clone(stray);
  merged.source.onMain = true;
  assert.deepEqual(outageProblems(merged), []);
  assert.match(citeSource(merged.source), /checked as part of the private main <code>aaaaaaaa<\/code>/);
});

// One negative per leak class: each injected into page text is refused by the record gate.
const LEAKS = {
  'a machine path': 'Filmed from /Users/someone/scratch/film.webm.',
  'a host name': 'Filmed on studio-mbp.local by the worker.',
  'a local host': 'Pulse answered at localhost before it stopped.',
  'an IP address': 'Pulse answered at 10.1.2.3 before it stopped.',
  'a port': 'Pulse did not answer on :6423 any more.',
  'a memory count': 'Pulse said 12.5 GB of 64 GB memory is free.',
  'a processor count': 'Pulse said the host has 16 logical processors.',
};
for (const [kind, line] of Object.entries(LEAKS)) {
  test(`the screen refuses ${kind} in the record's text`, () => {
    const record = clone(committed());
    record.line = line;
    assert.notDeepEqual(outageProblems(record), [], `${kind} passed the screen: ${line}`);
  });
  test(`the rendered section refuses ${kind}`, () => {
    const record = clone(committed());
    record.steps[2].said = `I found a problem: ${line}`;
    assert.throws(() => renderOutage(record), /fails the screen/, `${kind} reached the page: ${line}`);
  });
}

test('the published metadata carries no path, host, address, port or machine count', () => {
  const text = readFileSync(join('site', OUTAGE_RECORD), 'utf8');
  for (const [kind, re] of [['a machine path', /\/Users\/|\/home\/|\/private\/|\/tmp\//], ['a local host or address', /localhost|127\.0\.0\.1|\b\d{1,3}(?:\.\d{1,3}){3}\b/],
    ['a port', /:\d{4,5}\b/], ['a host name', /\.local\b|macbook|\bmbp\b/i], ['a machine count', /\bGB\b|logical processors|memory is free/i]]) {
    assert.doesNotMatch(text, re, `the record holds ${kind}`);
  }
});

test('the outage is a failing check between passing ones, each with its own evidence id', () => {
  const record = clone(committed());
  const asks = record.steps.filter(s => s.ask);
  assert.deepEqual(asks.map(s => s.verdict), ['pass', 'fail', 'pass', 'pass']);
  assert.deepEqual(asks.map(s => s.evidence), ['ia-4e58a3', 'ia-709326', 'ia-d7d01a', 'ip-7318d7']);
  assert.match(asks[3].said, /4 of 4 places/);
  record.steps = record.steps.filter(s => s.verdict !== 'fail');
  assert.ok(outageProblems(record).some(p => p.includes('a failing check')));
});
