import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partnerProblems, renderLabPages, renderPartners } from './lab-pages.mjs';

// The providers page (vp-grow-odin-r-d bundle-3 WO-02) names a partner only with a signed agreement on record:
// site/data/provider-partners.json entries need name, signedOn and evidence, and nothing else (no logo, no status).
const valid = { name: 'Example Provider', signedOn: '2026-11-02', evidence: 'agreement-record-0001' };
const read = config => path => (path === 'data/provider-partners.json' ? config : null);

test('an entry without signedOn is refused', () => {
  const { signedOn, ...noDate } = valid;
  assert.match(partnerProblems({ partners: [noDate] }).join('\n'), /signedOn must be the date/);
  assert.throws(() => renderPartners(read({ partners: [noDate] })), /is refused/);
  assert.match(partnerProblems({ partners: [{ ...valid, signedOn: 'soon' }] }).join('\n'), /signedOn must be the date/);
});

test('an entry without evidence, or with a link instead of a record id, is refused', () => {
  const { evidence, ...noEvidence } = valid;
  assert.match(partnerProblems({ partners: [noEvidence] }).join('\n'), /evidence must be the id/);
  assert.match(partnerProblems({ partners: [{ ...valid, evidence: 'https://example.com/contract.pdf' }] }).join('\n'), /evidence must be the id/);
});

test('a logo, a status or any other field is refused', () => {
  assert.match(partnerProblems({ partners: [{ ...valid, logo: 'x.svg' }] }).join('\n'), /field 'logo' is not allowed/);
  assert.match(partnerProblems({ partners: [{ ...valid, status: 'in conversation' }] }).join('\n'), /field 'status' is not allowed/);
  assert.deepEqual(partnerProblems({ partners: 'none' }), ['partners must be a list']);
});

test('a valid signed entry renders with its date; an empty list renders the empty state', () => {
  assert.match(renderPartners(read({ partners: [valid] })), /<strong>Example Provider<\/strong>, agreement signed <time datetime="2026-11-02">2026-11-02<\/time>/);
  assert.equal(renderPartners(read({ partners: [] })), '<p class="lab-empty">No partner agreement is signed yet.</p>');
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
