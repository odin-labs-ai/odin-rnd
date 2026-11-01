import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimTextProblems, pageClaimProblems, updateClaimProblems, atomClaimProblems, publicationBoundaryProblems, checkPublicationClaims } from './publication-claims.mjs';
import { renderFeed, updateEntryId } from './lab-feeds.mjs';

const update = { key: 'exp-006-results', kind: 'Results', experiment: 'EXP 006', title: 'A review comparison', text: 'Measured on fixed fixtures. No real-world or independent validation.', date: '2026-10-31', href: 'journal/review.html', source: 'data/review/results.json' };
const boundary = (prefix = '') => `<aside id="publication-boundary"><p>Research has limits. <a href="${prefix}methods/#publication-standard">How to read these results</a></p></aside>`;
const feed = updates => ({ schemaVersion: 1, updates });
const atom = (entry = {}) => renderFeed({ id: 'https://example.test/feed.xml', title: 'Research updates', subtitle: 'Plans and results', self: 'https://example.test/feed.xml', alternate: 'https://example.test/', entries: [{ id: updateEntryId(update), updated: '2026-10-31T00:00:00Z', title: 'Results · EXP 006: A review comparison', summary: update.text, href: 'https://example.test/journal/review.html', ...entry }] });

test('source cards cannot be promoted to answer correctness, even through inline tags or entities', () => {
  for (const html of ['<p>Verified <em>answers</em>.</p>', '<p>Answers with pr&#111;of.</p>', '<p>Proven answers.</p>']) assert.ok(pageClaimProblems(html, 'page').length);
  assert.deepEqual(pageClaimProblems('<p>A proof card identifies the source. It does not establish correctness.</p>', 'page'), []);
});

test('the denial must immediately qualify the matched phrase, not another claim in the paragraph', () => {
  for (const text of ['Not verified answers.', 'A source card, not a verified answer.', 'Not yet independently reproduced.', 'These are not “answers with proof”.', 'No verified answers are claimed.']) assert.deepEqual(claimTextProblems(text), []);
  for (const text of ['Not only verified answers.', 'Not independently reproduced. Verified answers.', 'No runtime claim: independently verified.', 'No proof? Verified answers.']) assert.ok(claimTextProblems(text).length, text);
  assert.ok(pageClaimProblems('<p>Not</p><h2>Verified answers</h2>', 'page').length, 'a preceding block cannot qualify the headline');
});

test('hash identity is not truth, while specific byte checks remain allowed', () => {
  for (const text of ['The hash proves correctness.', 'SHA256 verifies the answer.', 'The same digest guarantees our results.']) assert.ok(claimTextProblems(text).length, text);
  for (const text of ['The hash identifies this record.', 'The digest verifies the bytes.', 'A replay printed the same hash on two org machines.', 'The experiment asks whether a proof can be checked.']) assert.deepEqual(claimTextProblems(text), []);
});

test('social preview and accessible metadata cannot overstate qualified body copy', () => {
  for (const attrs of ['name="description" content="Verified answers"', "property='og:description' content='Independently verified'", 'NAME=twitter:title CONTENT="Answers with proof"', 'property="og:image:alt" content="Proven answers"']) {
    assert.ok(pageClaimProblems(`<meta ${attrs}><p>Not independently verified.</p>`, 'page').length, attrs);
  }
  assert.ok(pageClaimProblems('<img alt="Verified answers" src="x.png"><p>Source cards only.</p>', 'page').length);
  assert.deepEqual(pageClaimProblems('<script>"Verified answers"</script><style>/* independently verified */</style><p>Recorded result.</p>', 'page'), []);
});

test('progress JSON retains every source candidate and its complete status and kind', () => {
  assert.deepEqual(updateClaimProblems(feed([update]), [update]), []);
  for (const changed of [{ text: 'Measured on fixed fixtures.' }, { kind: 'Verified' }, { source: 'data/other/results.json' }, { title: 'Proven answers' }]) assert.ok(updateClaimProblems(feed([{ ...update, ...changed }]), [update]).length);
  assert.ok(updateClaimProblems(feed([]), [update]).length);
  assert.ok(updateClaimProblems(feed([update, update]), [update]).length);
  assert.ok(updateClaimProblems(feed([update]), []).length);
});

test('Atom requires the complete caveated source summary, not only a result headline', () => {
  assert.deepEqual(atomClaimProblems(atom(), [update], 'feed.xml'), []);
  assert.ok(atomClaimProblems(atom({ summary: undefined }), [update], 'feed.xml').some(p => p.includes('full source summary')));
  assert.ok(atomClaimProblems(atom({ summary: 'Measured on fixed fixtures.' }), [update], 'feed.xml').length);
  assert.ok(atomClaimProblems(atom({ title: 'Verified: A review comparison' }), [update], 'feed.xml').length);
  assert.ok(atomClaimProblems(atom({ summary: 'Independently verified.' }), [update], 'feed.xml').length);
});

test('the publication scan covers nested pages and feeds and fails closed on missing data', () => {
  const root = mkdtempSync(join(tmpdir(), 'rnd-claims-'));
  try {
    assert.ok(checkPublicationClaims({ dist: join(root, 'absent'), expectedUpdates: [] }).length);
    const dist = join(root, 'dist'); mkdirSync(join(dist, 'data'), { recursive: true }); mkdirSync(join(dist, 'labs', 'example'), { recursive: true });
    assert.ok(checkPublicationClaims({ dist, expectedUpdates: [] }).length);
    writeFileSync(join(dist, 'data', 'updates.json'), JSON.stringify(feed([update])));
    writeFileSync(join(dist, 'index.html'), '<p>Source records are available.</p>' + boundary());
    writeFileSync(join(dist, 'labs', 'example', 'index.html'), '<p>Verified answers.</p>' + boundary('../../'));
    writeFileSync(join(dist, 'feed.xml'), atom({ summary: 'Measured on fixed fixtures.' }));
    const problems = checkPublicationClaims({ dist, expectedUpdates: [update] });
    assert.ok(problems.some(p => p.includes('labs/example/index.html')));
    assert.ok(problems.some(p => p.includes('feed.xml') && p.includes('full source summary')));
    writeFileSync(join(dist, 'labs', 'example', 'index.html'), '<p>Not verified answers.</p>' + boundary('../../'));
    writeFileSync(join(dist, 'feed.xml'), atom());
    assert.deepEqual(checkPublicationClaims({ dist, expectedUpdates: [update] }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('every published page has one scoped publication-boundary link', () => {
  assert.deepEqual(publicationBoundaryProblems(boundary(), 'index.html'), []);
  assert.deepEqual(publicationBoundaryProblems(boundary('../../'), 'labs/x/index.html'), []);
  assert.ok(publicationBoundaryProblems('<p>No note</p>', 'index.html').length);
  assert.ok(publicationBoundaryProblems(boundary() + boundary(), 'index.html').length);
  assert.ok(publicationBoundaryProblems(boundary('wrong/'), 'index.html').length);
  assert.ok(publicationBoundaryProblems('<aside id="publication-boundary"><p>Research.</p></aside><a href="methods/#publication-standard">Policy</a>', 'index.html').length, 'an unrelated link cannot stand in for the boundary link');
  assert.ok(publicationBoundaryProblems(boundary().replace('publication-standard', 'elsewhere'), 'index.html').length);
});
