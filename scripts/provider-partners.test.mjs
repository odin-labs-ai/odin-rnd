import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { partnerProblems, renderLabPages, renderPartners } from './lab-pages.mjs';
import { checkPage } from './number-provenance.mjs';

// The providers page (vp-grow-odin-r-d bundle-3 WO-02) names a partner only with a signed agreement on record:
// site/data/provider-partners.json entries need name, signedOn (a real past date) and evidence (a record id), and
// nothing else: no logo, no status, no free-text scope.
const valid = { name: 'Example Provider', signedOn: '2026-10-01', evidence: 'agreement-record-0001' };
const TODAY = '2026-10-23';
const read = config => path => (path === 'data/provider-partners.json' ? config : null);
const problems = partners => partnerProblems({ partners }, TODAY).join('\n');

test('an entry without signedOn is refused', () => {
  const { signedOn, ...noDate } = valid;
  assert.match(problems([noDate]), /signedOn must be the date/);
  assert.throws(() => renderPartners(read({ partners: [noDate] }), TODAY), /is refused/);
  assert.match(problems([{ ...valid, signedOn: 'soon' }]), /signedOn must be the date/);
  assert.match(problems([{ ...valid, signedOn: '2026-02-30' }]), /signedOn must be the date/, 'an impossible date');
  assert.match(problems([{ ...valid, signedOn: '2099-01-01' }]), /in the future/, 'a planned signing');
  assert.equal(problems([{ ...valid, signedOn: TODAY }]), '');
});

test('an entry without evidence, or with a link instead of a record id, is refused', () => {
  const { evidence, ...noEvidence } = valid;
  assert.match(problems([noEvidence]), /evidence must be the id/);
  for (const evidence of ['https://example.com/contract.pdf', 'www.example.com/contract.pdf', '//example.com/x', 'drive.google.com/x', 'mailto:legal@x', 'file:///x', 'TBD', 'pending', 'none', 'to be signed', 'to-be-signed', 'ab']) assert.match(problems([{ ...valid, evidence }]), /evidence must be the id/, evidence);
});

test('a logo, a status or any other field is refused', () => {
  assert.match(problems([{ ...valid, logo: 'x.svg' }]), /field 'logo' is not allowed/);
  assert.match(problems([{ ...valid, status: 'in conversation' }]), /field 'status' is not allowed/);
  assert.match(problems([{ ...valid, scope: 'pilot under negotiation' }]), /field 'scope' is not allowed/, 'no free-text field at all');
  assert.deepEqual(partnerProblems({ partners: 'none' }), ['partners must be a list']);
});

test('a valid signed entry renders with its date; an empty list renders the empty state', () => {
  assert.equal(renderPartners(read({ partners: [valid] }), TODAY), '<ul class="lab-partners"><li><strong>Example Provider</strong>, agreement signed <time datetime="2026-10-01">2026-10-01</time></li></ul>');
  assert.equal(renderPartners(read({ partners: [] }), TODAY), '<p class="lab-empty">No partner agreement is signed yet.</p>');
});

test('the committed list is valid and, until an agreement is signed, empty', () => {
  const config = JSON.parse(readFileSync('site/data/provider-partners.json', 'utf8'));
  assert.deepEqual(partnerProblems(config), []);
  assert.deepEqual(config.partners, [], 'no partner agreement is signed on record (mission odin-rnd-lab-1023 STATUS.md)');
});

test('the providers page names no broker or lead, shows no third-party image and promises no number', () => {
  const html = renderLabPages().providers;
  assert.match(html, /No partner agreement is signed yet\./);
  assert.doesNotMatch(html, /open\s?router|eu\s?router|requesty|\borq\b|double\s?word/i);
  const imgs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(imgs.filter(src => src !== '../assets/odin-logo.svg'), []);
  for (const id of ['what-we-measure', 'what-you-get', 'what-we-ask', 'partners']) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('a page with a signed partner still passes the number-provenance gate (the signing date is a <time>)', () => {
  const page = renderLabPages().providers.replace('<p class="lab-empty">No partner agreement is signed yet.</p>', renderPartners(read({ partners: [valid] }), TODAY));
  assert.match(page, /agreement signed <time datetime="2026-10-01">/);
  // site/ is what dist/ copies; the rendered lab pages themselves exist only in dist/, so they count as present.
  const exists = path => existsSync(join('site', path)) || /^(provider-economics|evidence|providers)\/index\.html$/.test(path);
  assert.deepEqual(checkPage('providers/index.html', page, { readData: () => null, exists }), []);
  assert.match(checkPage('providers/index.html', page.replace('agreement signed', 'agreement for two years signed'), { readData: () => null, exists }).join('\n'), /number word 'two'/);
});
