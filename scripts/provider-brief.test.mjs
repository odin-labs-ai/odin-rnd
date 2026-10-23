import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ASSERTS, briefProblems, renderLabPages, renderProviderBrief, siteReader } from './lab-pages.mjs';
import { checkPage, recordProblem, SOURCE_FILE } from './number-provenance.mjs';
import { checkPages, loadTerms } from './provider-terms.mjs';
import { BASE, deckMarkdown, toMarkdown } from './provider-brief-export.mjs';

// The provider brief (vp-grow-odin-r-d bundle-4 WO-01; WO-VG-05) and its Markdown export for the seed deck.
const html = renderLabPages()['provider-brief'];
const config = JSON.parse(readFileSync('site/data/provider-brief.json', 'utf8'));
const readSite = path => (existsSync(join('site', path)) ? readFileSync(join('site', path), 'utf8') : null);

test('the brief passes the number-provenance gate and every number on it is sourced', () => {
  assert.deepEqual(checkPage('provider-brief/index.html', html, { readData: readSite, recordProblem: (path, raw) => recordProblem(path, raw) }), []);
  const sources = [...html.matchAll(/data-source="([^"#]*)#/g)].map(m => m[1]);
  assert.ok(sources.length >= 10, 'the brief shows sourced numbers');
  assert.deepEqual([...new Set(sources)].sort(), ['data/broker-same-model/results.json', 'data/review-frontier/results.json']);
});

test('the brief names no broker and no lead, shows no logo, and claims no partner', () => {
  assert.doesNotMatch(html, /open\s?router|eu\s?router|requesty|\borq\b|double\s?word/i);
  const imgs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(imgs.filter(src => src !== '../assets/odin-logo.svg'), []);
  assert.deepEqual(checkPages([{ file: 'provider-brief/index.html', html }], loadTerms()), []);
  assert.doesNotMatch(html, /\b(?:partnered|in partnership with|our partners?\b(?! *agreement))/i);
  assert.match(html, /None is signed\./);
});

test('EXP 018 and EXP 019 are never a claim: no claim record or value reads them, and the brief cites none of their figures', () => {
  assert.deepEqual(briefProblems(config), []);
  for (const c of config.claims) {
    assert.doesNotMatch(c.record, /router-arm/, c.id);
    for (const v of Object.values(c.values)) assert.doesNotMatch(v.source ?? '', /router-arm/, c.id);
  }
  assert.doesNotMatch(html, /data-source="data\/router-arm/);
  // The incomplete verdict is shown, read from the record, in the not-a-result list.
  const notResults = html.slice(html.indexOf('id="not-results"'));
  assert.match(notResults, /EXP 018, “<cite[^>]*>[^<]*<\/cite>”: its pre-registered verdict is <strong>incomplete<\/strong>, so this brief cites none of its figures\./);
  assert.match(notResults, /EXP 019, “<cite[^>]*>[^<]*<\/cite>”: <a href="\.\.\/data\/router-arm-fresh\/preregistration\.json">Pre-registered<\/a>; no result is published yet\./);
  assert.equal(html.indexOf('EXP 018') > html.indexOf('id="not-results"'), true, 'EXP 018 appears only after the measured list');
});

test('a claim backed by EXP 018 or reading one of its values is refused', () => {
  const bad = { claims: [{ id: 'x', record: 'data/router-arm/results.json', values: {} }] };
  assert.match(briefProblems(bad).join('\n'), /has no decided result/);
  const sneaky = { claims: [{ id: 'y', record: 'data/review-frontier/results.json', values: { v: { source: 'data/router-arm/results.json#/spend/billedUsd', format: 'usd' } } }] };
  assert.match(briefProblems(sneaky).join('\n'), /values\/v\/source reads data\/router-arm/);
  const read = siteReader();
  const patched = path => (path === 'data/provider-brief.json' ? { ...config, claims: [...config.claims, ...bad.claims] } : read(path));
  assert.throws(() => renderProviderBrief(patched), /is refused/);
});

test('the not-a-result list keeps savings, traffic, negotiated prices and partnerships out of the claims', () => {
  const notResults = html.slice(html.indexOf('id="not-results"'));
  for (const phrase of ['saves money against a fixed-model baseline', 'How much traffic Odin can route', 'Negotiated prices.', 'Provider partnerships.']) assert.ok(notResults.includes(phrase), phrase);
});

test('the brief is in the sitemap, linked from the providers page, and has a print stylesheet', () => {
  assert.match(readFileSync('site/sitemap.xml', 'utf8'), /<loc>https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/provider-brief\/<\/loc>/);
  assert.match(renderLabPages().providers, /href="\.\.\/provider-brief\/"/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/assets\/brief-print\.css" media="print">/);
});

test('the deck export says no more than the brief: every number is a link to its record, none to EXP 018', () => {
  const md = deckMarkdown({ revision: 'a'.repeat(40) });
  const links = [...md.matchAll(/\[([^\]]*)\]\((https:[^)\s]*)\)/g)];
  const numberLinks = links.filter(([, text]) => /\d/.test(text));
  assert.ok(numberLinks.length >= 10);
  for (const [, text, url] of numberLinks) {
    assert.ok(url.startsWith(BASE + 'data/'), url);
    const [path, pointer] = url.slice(BASE.length).split('#');
    assert.match(path, SOURCE_FILE, url);
    assert.doesNotMatch(path, /router-arm/, url);
    assert.ok(pointer && pointer.startsWith('/'), `${url} carries its JSON pointer`);
    const value = pointer.slice(1).split('/').reduce((at, k) => at?.[k], JSON.parse(readSite(path)));
    assert.equal(String(value), text.replace(/^\$/, ''), url);
  }
  // Outside the provenance header, number links, identifiers in backticks, dates and EXP ids, no digit remains.
  const rest = md.split('\n').filter(line => !line.startsWith('>')).join('\n')
    .replace(/\[([^\]]*)\]\((https:[^)\s]*)\)/g, (whole, text) => (/\d/.test(text) ? ' ' : text))
    .replace(/`[^`]*`/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\bEXP \d{3}\b/g, ' ');
  assert.doesNotMatch(rest, /\d/);
  assert.doesNotMatch(md, /open\s?router|eu\s?router|requesty|\borq\b|double\s?word/i);
});

test('a claim reading EXP 018 through its window or an assert is refused too', () => {
  const review = config.claims.find(c => c.id === 'review-cost');
  const viaWindow = { claims: [{ ...review, window: { from: { source: 'data/router-arm/results.json#/window/firstCall' } } }] };
  assert.match(briefProblems(viaWindow).join('\n'), /window\/from\/source reads data\/router-arm/);
  const viaAssert = { claims: [{ ...review, asserts: [{ kind: 'min-at', source: 'data/router-arm-fresh/results.json#/arms', field: 'x', index: 0 }] }] };
  assert.match(briefProblems(viaAssert).join('\n'), /asserts\/0\/source reads data\/router-arm-fresh/);
});

test('"No broker answered with a different model" is checked against the record, and fails when one did', () => {
  const real = siteReader();
  const a = { kind: 'served-as-asked', source: 'data/broker-same-model/results.json#/perArm' };
  assert.equal(ASSERTS['served-as-asked'](real, a), null);
  const doc = JSON.parse(JSON.stringify(real('data/broker-same-model/results.json')));
  doc.perArm.mini.perBroker.B.servedMatch.matched -= 1;
  assert.match(ASSERTS['served-as-asked'](() => doc, a), /mini\/B: an answer came from a different model/);
  const doc2 = JSON.parse(JSON.stringify(real('data/broker-same-model/results.json')));
  doc2.perArm.sonnet.silentSubstitutions = 1;
  assert.match(ASSERTS['served-as-asked'](() => doc2, a), /silent substitutions are not zero/);
});

test('a decided verdict is refused in the not-a-result list', () => {
  const read = siteReader();
  const patched = Object.assign(path => (path === 'data/router-arm/results.json' ? { ...read(path), decision: [{ verdict: 'supported' }] } : read(path)), { recordProblem: read.recordProblem, quoteProblem: read.quoteProblem });
  assert.throws(() => renderProviderBrief(patched), /is decided/);
});

test('the export CLI runs from its path and prints the gated section', () => {
  const out = execFileSync(process.execPath, ['scripts/provider-brief-export.mjs'], { encoding: 'utf8' });
  assert.match(out, /^## Evidence: what the Odin R&D lab has measured/);
  assert.match(out, /from odin-rnd at `[0-9a-f]{40}(?:-dirty)?`/);
});

test('toMarkdown: no raw angle bracket, decoded attributes, no dropped text, the source-line join only after a claim', () => {
  assert.equal(toMarkdown('<p>a &lt;b&gt; c</p>'), 'a &lt;b&gt; c\n');
  assert.equal(toMarkdown('<p><a class="lab-num" href="#" data-source="data/x<y>/results.json#/n">1</a></p>'), `[1](${BASE}data/x%3Cy%3E/results.json#/n)\n`);
  assert.equal(toMarkdown('<p><a href="https://e.org/?a=1&amp;b=2">t</a></p>'), '[t](https://e.org/?a=1&b=2)\n');
  assert.equal(toMarkdown('<ul><li>< 5 ms</li></ul>'), '- &lt; 5 ms\n');
  assert.equal(toMarkdown('<p><abc'), '&lt;abc\n', 'a tag-like fragment with no end is text');
  assert.equal(toMarkdown('<p>n <k items</p>'), 'n &lt;k items\n', 'a stray < and a letter swallow nothing');
  assert.equal(toMarkdown('<p><b"oops 5 ms</p>'), '&lt;b"oops 5 ms\n');
  assert.equal(toMarkdown('<p>x</p></a>'), 'x\n', 'an unmatched </a> is ignored');
  assert.equal(toMarkdown('<a href="../p/"><code>c</code></a>'), `[\`c\`](${BASE}p/)\n`);
  assert.equal(toMarkdown('<li><p>claim</p><p class="lab-source">Source.</p></li>'), '- claim\n  Source.\n');
  assert.equal(toMarkdown('<h2>H</h2><p class="lab-source">S</p>'), '### H\n\nS\n', 'no join after a heading');
});
