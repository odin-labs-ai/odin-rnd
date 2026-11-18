import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESULT_CONTACT_PAGES, addResultContact, resultContactHref } from './result-contact.mjs';

test('the link preselects the lab topic and carries the utm tags odin-labs.ai keeps on a lead', () => {
  const url = new URL(resultContactHref('failover-results'));
  assert.equal(url.origin + url.pathname, 'https://odin-labs.ai/contact/');
  assert.equal(url.hash, '#contact-form');
  assert.deepEqual(Object.fromEntries(url.searchParams), { topic: 'lab', utm_source: 'odin-rnd', utm_medium: 'result-record', utm_content: 'failover-results' });
  assert.throws(() => resultContactHref('Bad Tag'), /Bad result-contact tag/);
});

test('the failover result record gets the link in its built page, the committed page stays as published', () => {
  assert.equal(RESULT_CONTACT_PAGES.get('journal/failover-results.html'), 'failover-results');
  const page = readFileSync('site/journal/failover-results.html', 'utf8');
  assert.doesNotMatch(page, /odin-labs\.ai\/contact/, 'the pinned record is not edited');
  const built = addResultContact(page, 'failover-results', 'failover-results');
  const link = built.match(/<p class="article-note result-contact"><a href="([^"]+)" data-contact-opened>Talk to us about this result /);
  assert.ok(link, 'the link is added');
  assert.equal(link[1].replace(/&amp;/g, '&'), resultContactHref('failover-results'));
  assert.ok(built.indexOf('result-contact') < built.indexOf('</article>'), 'inside the article body');
  assert.equal(built.replace(/<p class="article-note result-contact">.*\n/, ''), page, 'nothing else changes');
  assert.equal(addResultContact(built, 'failover-results'), built, 'idempotent');
});

test('a page without exactly one article fails closed', () => {
  assert.throws(() => addResultContact('<main></main>', 'x', 'none'), /exactly one <\/article> in none, found 0/);
  assert.throws(() => addResultContact('<article></article><article></article>', 'x', 'two'), /found 2/);
});

test('the build runs the pass', () => {
  assert.match(readFileSync('scripts/build.mjs', 'utf8'), /await addResultContactsToDist\(\{ distDir: 'dist' \}\);/);
});
