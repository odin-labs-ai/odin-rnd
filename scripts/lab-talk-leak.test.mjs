import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTalkLeak, renderTalkLeak, selfScanProblems, TALK_PIN, TALK_RECORD, TALK_SELF_SCAN, TALK_TEMPLATE, TALK_TILE, talkLeakProblems } from './lab-talk-leak.mjs';
import { PUBLIC_NAMES } from './vendor-talk-leak.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { renderLabs } from './labs.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';

// Lab 09, "Can a talk leak data?" (scripts/lab-talk-leak.mjs). A page about leaks is only worth publishing if it does
// not leak: counts only, never a term, label, figure or finding; the fiction boxed as fiction; and a self-scan by the
// same scanner, bound to the very bytes that ship.
const raw = readFileSync(join('site', TALK_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[TALK_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');
const tile = readFileSync(join('site', TALK_TILE), 'utf8');
const selfScan = JSON.parse(readFileSync(join('site', TALK_SELF_SCAN), 'utf8'));

test('Lab 09 renders, sits on the Labs index after Lab 08 and is in the sitemap', () => {
  assert.ok(page, 'labs/talk-leak/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab08 = index.indexOf('aria-labelledby="lab-tile-red-build"'), lab09 = index.indexOf('aria-labelledby="lab-tile-talk-leak"');
  assert.ok(lab08 >= 0 && lab09 > lab08, 'Lab 09 follows Lab 08');
  assert.match(index, /<span class="technical">LAB 09<\/span><h2 id="lab-tile-talk-leak">Can a talk leak data\?<\/h2>/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/talk-leak/</loc>'));
});

test('the deny-list ships as counts only: 115 terms under 8 labels, no term, label or figure', () => {
  const d = record.denylist;
  assert.deepEqual([d.terms, d.labels, d.errors, d.warns], [115, 8, 105, 10]);
  assert.deepEqual(Object.keys(d).sort(), ['errors', 'hashedAs', 'labels', 'terms', 'warns'], 'no list, no labels, no numbers');
  assert.ok(main.includes('<strong>115 terms</strong> under <strong>8 labels</strong>'));
  for (const text of [raw, main]) assert.doesNotMatch(text, /[0-9a-f]{24}"\s*,\s*"kind"|"label"\s*:|"near"\s*:|"numbers"\s*:|"salt"\s*:/, 'no deny-list entry, label, figure or salt');
  // The tile has a "label" of its own (its lab's number), so it is held to the rest.
  assert.doesNotMatch(tile, /[0-9a-f]{24}"\s*,\s*"kind"|"near"\s*:|"numbers"\s*:|"salt"\s*:/);
  assert.match(textOf(main), /not its terms, not its labels, which say what each term protects, and not its figures/);
});

test('the tests and the fresh scan are real runs, stated with their dates, machine and counts', () => {
  const t = record.tests;
  assert.deepEqual([t.passed, t.failed, t.errors, t.plants.length], [22, 0, 0, 16]);
  assert.ok(main.includes('<strong>22 passed, 0 failed</strong>'));
  const s = record.scan;
  assert.deepEqual([s.verifyProblems, s.errors, s.entries, s.manifests, s.files, s.binary], [0, 0, 1063, 1, 830, 232]);
  assert.deepEqual(s.errorsByKind, {});
  assert.ok(main.includes(`<code>${s.zipSha256}</code>`));
  assert.ok(main.includes(`<strong>${s.verifyProblems} problems, ${s.errors} errors.</strong> ${s.warns} warnings, and ${s.jsDollarDigit} allowed.`));
  assert.match(textOf(main), /The commit the build was made from is not on the private main, so this page names the build by its zip's sha256 instead, and does not cite it\./);
  assert.match(textOf(main), /This page did not test that: it scanned the build's files, it did not watch it run\./, 'no network claim is made');
  // Review 1: no absolute guarantee, and the allowance's limit is said.
  assert.doesNotMatch(textOf(main), /so that it cannot be|any money amount/);
  assert.match(textOf(main), /does not check each one, so a real amount of that shape in a JavaScript string would pass it too/);
});

test('the company on stage is boxed as staged fiction, the planted leaks as authored, and the client is never named', () => {
  const staged = textOf(main.slice(main.indexOf('<div class="lab-panel talk-staged"'), main.indexOf('<div class="lab-panel talk-real"')));
  assert.match(staged, /^ ?Staged /);
  assert.match(staged, /Northwind Labs, a logistics-software firm we made up/);
  assert.match(staged, /A real client, who is never named here\./);
  assert.match(main, /<div class="lab-panel talk-plants" id="plants"><p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US<\/p>/);
  assert.match(main, /<div class="lab-panel talk-hashed" id="hashed"><p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE<\/p>/);
  for (const text of [raw, main, tile]) assert.doesNotMatch(text, /mortgage/i, 'the talk\'s client theme is never named');
});

test('the self-scan stands beside exactly the bytes that ship, found nothing beyond this site\'s own names, and is refused otherwise', () => {
  const files = [Buffer.from(page), readFileSync(join('site', TALK_RECORD)), readFileSync(join('site', TALK_TILE)), readFileSync(join('site', TALK_TEMPLATE))];
  assert.deepEqual(selfScanProblems(selfScan, files, record), []);
  assert.deepEqual(selfScan.findings, {});
  assert.equal(selfScan.scanner, record.vendored.commit);
  assert.ok(selfScan.publicNames > 0, 'the public names it set aside are counted, not hidden');
  assert.deepEqual(PUBLIC_NAMES, ['odin-labs-ai', 'odin-labs.ai', 'odin labs', 'odin-labs', 'odin-rnd', 'open-docs', 'open docs'], 'only this site\'s own public names are set aside');
  // A changed byte in any scanned file, a finding, or another scanner refuses it.
  const edited = [Buffer.from(page.replace('Can a talk leak data?', 'Can a talk leak?')), ...files.slice(1)];
  assert.ok(selfScanProblems(selfScan, edited, record).some(p => /the rendered page has changed since it was scanned/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, findings: { repo: 1 } }, files, record).some(p => /found something beyond/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, scanner: 'f'.repeat(40) }, files, record).some(p => /not the scanner at the record's main/.test(p)));
  assert.ok(selfScanProblems(null, files, record).some(p => /missing/.test(p)));
  // Review 1: the receipt is closed, its findings required and empty, its scanner the one the record cites.
  const { findings, ...noFindings } = selfScan;
  assert.ok(selfScanProblems(noFindings, files, record).some(p => /not exactly the fields/.test(p)), 'findings omitted');
  assert.ok(selfScanProblems({ ...selfScan, findings: { repo: 1, secret: -1 } }, files, record).some(p => /found something beyond/.test(p)), 'counts that cancel out');
  assert.ok(selfScanProblems({ ...selfScan, findings: [] }, files, record).some(p => /found something beyond|did not say/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, extra: 1 }, files, record).some(p => /not exactly the fields/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, scannerSha256: 'a'.repeat(64) }, files, record).some(p => /not the scanner the record cites/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, denylistSha256: 'a'.repeat(64) }, files, record).some(p => /not the deny-list the record cites/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, publicNames: -1 }, files, record).some(p => /not a count/.test(p)));
  assert.ok(selfScanProblems({ ...selfScan, files: selfScan.files.map(f => ({ ...f, note: 'x' })) }, files, record).some(p => /each with its sha256/.test(p)));
});

test('the private commits are cited the way Lab 01 cites them', () => {
  const mc = record.vendored.mainCheck;
  for (const c of [record.vendored, ...record.vendored.cites]) assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  for (const f of record.vendored.files) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
});

const LEAK_SHAPES = [/\/Users\//, /\/home\//, /\b[A-Z]:\\/, /~\/\./, /localhost/i, /\b127\.0\.0\.1\b/, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /:\d{4,5}\b(?!["\d])/,
  /\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]|\bAKIA[0-9A-Z]|-----BEGIN|\bxox[abp]-/, /odin-labs-ai\/(?!odin-rnd)/, /mortgage/i, /be1aa24f/];

test('leak screen: no path, host, credential, other repository, client theme or uncited build commit anywhere it ships', () => {
  const known = new Set(recordHashes(record));
  const masked = text => text.replace(/\b[0-9a-f]{40,64}\b/g, h => (known.has(h) ? 'HASH' : h));
  for (const [name, text] of [['page', main], ['record', raw], ['tile', tile], ['self-scan', JSON.stringify(selfScan)]]) for (const re of LEAK_SHAPES) assert.doesNotMatch(masked(text), re, `${name}: ${re}`);
  assert.deepEqual(pageLeaks(page, recordHashes(record)), [], 'the rendered page passes the screen');
  assert.deepEqual(talkLeakProblems(record), [], 'the record passes its checks and the screen');
  for (const file of ['scripts/lab-talk-leak.mjs', 'scripts/vendor-talk-leak.mjs', 'scripts/schemas/odin-lab-talk-leak.schema.json', 'site/labs/talk-leak/index.html']) {
    assert.deepEqual(screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name')), [], file);
  }
});

test('a planted leak fails the build, in the record and on the page (a failing negative per class)', () => {
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  for (const [plant, reason] of [['/Users/someone/x', /machine path|file path/], ['served on localhost', /local/], ['10.0.0.12', /local/], [credential, /credential/], ['a mortgage lender', /restricted name/], ['the oac repository', /restricted name/], ['odin-labs-ai/some-private-repo', /another repository/], ['it cost €40', /price or currency/]]) {
    const r = clone(); r.tests.how = plant;
    assert.ok(talkLeakProblems(r).some(p => reason.test(p)), `record: ${plant}`);
    assert.ok(pageLeaks(page.replace('</main>', `<p>${plant}</p></main>`), recordHashes(record)).some(p => reason.test(p)), `page: ${plant}`);
  }
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(talkLeakProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.tests.failed = 1; }, /a test failed or errored/);
  refused(r => { r.tests.passed = 21; }, /the page names 6/);
  refused(r => { r.tests.plants.push('secret-other'); }, /not a kind this page knows/);
  refused(r => { r.scan.errors = 1; }, /found no error/);
  refused(r => { r.scan.errorsByKind = { number: 1 }; }, /found no error/);
  refused(r => { r.scan.verifyProblems = 2; }, /the gate found no problem/);
  refused(r => { r.scan.files = 829; }, /not every one of the zip's 1063 but its manifest/);
  refused(r => { r.scan.errorsByKind = { 'a private name': 0 }; }, /not a kind this page knows/);
  refused(r => { r.denylist.warns = 11; }, /do not add up to its terms/);
  refused(r => { r.denylist.label = 'x'; }, /does not match odin-lab-talk-leak v1/);
  refused(r => { r.scan.findings = []; }, /does not match odin-lab-talk-leak v1/);
  refused(r => { r.scan.at = '2099-01-01T00:00:00Z'; r.scan.on = '2099-01-01'; }, /after this build/);
  refused(r => { r.tests.on = '2026-10-01'; }, /not the date of its run/);
  refused(r => { r.vendored.cites[0].commit = 'e'.repeat(40); }, /not shown as part of the private main/);
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-talk-leak-'));
  try {
    for (const file of [TALK_RECORD, TALK_PIN, TALK_TEMPLATE, TALK_SELF_SCAN, TALK_TILE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readTalkLeak(root).scan.files, 830);
    assert.equal(renderTalkLeak(root).pages[TALK_TEMPLATE], page, 'a fixture with the same files renders the same page');
    writeFileSync(join(root, TALK_RECORD), raw.replace('"failed": 0', '"failed": 0 '));
    assert.throws(() => readTalkLeak(root), /record\.sha256: does not pin the sha256/);
    // A re-pinned edit still refuses the page: the self-scan no longer stands beside these bytes.
    const changed = raw.replace(record.tests.how, 'pytest, run again');
    writeFileSync(join(root, TALK_RECORD), changed);
    writeFileSync(join(root, TALK_PIN), `${sha256(changed)}  record.json\n`);
    assert.doesNotThrow(() => readTalkLeak(root));
    assert.throws(() => renderTalkLeak(root), /self-scan refused[\s\S]*has changed since it was scanned/);
    assert.equal(readFileSync(join('site', TALK_PIN), 'utf8'), `${sha256(raw)}  record.json\n`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
