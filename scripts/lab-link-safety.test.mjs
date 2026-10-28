import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LINK_PIN, LINK_RECORD, LINK_TEMPLATE, linkSafetyProblems, readLinkSafety, renderLinkSafety } from './lab-link-safety.mjs';
import { fixturesOf, LABELS_FILE, parseList } from './vendor-link-safety.mjs';
import { pageLeaks, recordHashes } from './lab-kit.mjs';
import { renderLabs } from './labs.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';
import { addScreenNames, namesRestricted } from './lab-dispatch-publish.mjs';
// Synthetic restricted names, added to the screen for these tests: a real one is never spelled in this public repo.
addScreenNames('zarquon', 'zarquonbank', 'zarquonbanks');

// Lab 07, "Can data trick a click?" (scripts/lab-link-safety.mjs). The page is only worth publishing if what is real
// (the defect, the fix, the test run) and what is authored (the fixtures) are told apart, every number is the record's,
// and no poisoned URL reaches the page as itself.
const raw = readFileSync(join('site', LINK_RECORD), 'utf8');
const record = JSON.parse(raw);
const pages = renderLabs();
const page = pages[LINK_TEMPLATE];
const main = page.split('<main id="main">')[1].split('</main>')[0];
const textOf = html => html.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const clone = () => JSON.parse(raw);
const sha256 = s => createHash('sha256').update(s).digest('hex');
const boxOf = (cls, end = '</div></div>') => { const at = main.indexOf(`<div class="lab-panel ${cls}"`); assert.ok(at >= 0, cls); return main.slice(at, main.indexOf(end, at) + end.length); };
const tile = readFileSync('site/data/labs/link-safety-tile.json', 'utf8');

test('Lab 07 renders, sits on the Labs index after Lab 05 and is in the sitemap', () => {
  assert.ok(page, 'labs/link-safety/index.html is rendered');
  const index = pages['labs/index.html'];
  const lab05 = index.indexOf('aria-labelledby="lab-tile-rogue"'), lab07 = index.indexOf('aria-labelledby="lab-tile-link-safety"');
  assert.ok(lab05 >= 0 && lab07 > lab05, 'Lab 07 follows Lab 05');
  assert.match(index, /<span class="technical">LAB 07<\/span><h2 id="lab-tile-link-safety">Can data trick a click\?<\/h2>/);
  assert.match(index, /<a href="\.\.\/labs\/link-safety\/index\.html">/);
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/link-safety/</loc>'));
});

test('the fixtures are boxed as authored, and every count beside them is the length of the record\'s own list', () => {
  const box = main.slice(main.indexOf('<div class="lab-panel link-fixtures"'), main.indexOf('<section', main.indexOf('<div class="lab-panel link-fixtures"')));
  assert.match(box, /^<div class="lab-panel link-fixtures" id="fixtures"><p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US<\/p>/);
  assert.match(textOf(box), /Each one is an attack or a good URL we made up, not one found in the wild\./);
  for (const [id, list, words] of [['poison', record.poison, 'poisoned URLs: every one refused'], ['lookalikes', record.lookalikes, 'lookalikes: links with no allowlist, refused under it'], ['good', record.good, 'good URLs: kept as they are'], ['openers', record.unsafeLines, 'unsafe opener lines: every one caught'], ['safe-lines', record.safeLines, 'safe lines: none flagged']]) {
    assert.ok(box.includes(`<h3 class="lab-subhead" id="${id}">${list.length} ${words}</h3>`), id);
  }
  // The generated counts, as the gap check found them on the engine's main: 30 poisoned, 3 lookalikes, 3 good, 28
  // unsafe and 11 safe lines. A changed test changes these with it, through the vendor, never by hand.
  assert.deepEqual([record.poison, record.lookalikes, record.good, record.unsafeLines, record.safeLines].map(l => l.length), [30, 3, 3, 28, 11]);
  // One table row per fixture, each showing its own label and verdicts, in the record's order.
  const rows = [...box.matchAll(/<tr><td>([\s\S]*?)<\/td>((?:<td>[^<]*<\/td>)+)<\/tr>/g)];
  assert.equal(rows.length, record.poison.length + record.lookalikes.length + record.good.length + record.unsafeLines.length + record.safeLines.length);
  const said = { refused: 'refused', kept: 'a link' };
  [...record.poison, ...record.lookalikes, ...record.good].forEach((x, i) => {
    assert.ok(textOf(rows[i][1]).trim().toLowerCase().startsWith(x.label.toLowerCase()), x.label);
    assert.equal(rows[i][2], `<td>${said[x.open]}</td><td>${said[x.allowlisted]}</td>`, x.label);
  });
  // No fixture count appears outside the box.
  const outside = main.replace(box, '');
  assert.doesNotMatch(textOf(outside), /\b(?:30|28|11) (?:poisoned|unsafe|safe)\b|poisoned URLs|opener lines/);
});

test('the old code\'s red/green figures are the note\'s, boxed as a summary this page cannot reproduce, and appear nowhere else', () => {
  const box = boxOf('link-summary', '</p></div>');
  assert.match(box, /<p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE<\/p>/);
  const o = record.note.oldCode, nc = record.note.newCode;
  assert.deepEqual([o.tests, o.failed, o.passed, nc.passed], [83, 66, 17, 83]);
  assert.ok(box.includes(`<strong>${o.failed} failed, ${o.passed} passed</strong>, of ${o.tests}`));
  assert.match(textOf(box), /This is the note's table, not a run of ours: the old code is not on this site, and we did not run it again\./);
  assert.doesNotMatch(textOf(main.replace(box, '')), /\b(?:66|83)\b|17 passed/, 'the note\'s figures only in its box');
  assert.doesNotMatch(textOf(main), /misses 6|6 misses/, 'no count the record does not hold');
});

test('the defect is boxed as real, and the test run is stated with its date, machine and counts', () => {
  const real = textOf(boxOf('link-real', '</ul></div>'));
  assert.match(real, /^ ?Real /);
  assert.match(real, /A click opened it\. The server's old rule took plain http on any host/);
  const t = record.run.tests;
  assert.deepEqual([t.total, t.passed, t.failed, t.skipped], [7, 7, 0, 0]);
  assert.ok(main.includes(`<strong>${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped</strong>, of ${t.total}`));
  assert.equal(record.run.host, 'a Mac');
  for (const f of [...record.vendored.files, ...record.note.files]) assert.ok(main.includes(`<code>${f.sha256}</code>`), f.role);
  assert.ok(main.includes(`At most ${record.maxLength} characters`), 'the length cap is the rule\'s own');
});

test('both private commits are cited the way Lab 01 cites them, each against its own main', () => {
  for (const block of [record.vendored, record.note]) {
    const mc = block.mainCheck;
    for (const c of block.cites) assert.ok(main.includes(`Private commit <code>${c.commit.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${mc.main.slice(0, 8)}</code> on <time datetime="${mc.checked}">${mc.checked}</time>; this page cannot check it, anyone with access can.`), c.commit);
  }
});

test('no poisoned URL reaches the page, the record or the tile as itself', () => {
  for (const [name, text] of [['page', page], ['record', raw], ['tile', tile], ['labels', readFileSync(LABELS_FILE, 'utf8')]]) {
    for (const re of [/javascript:alert/i, /evil\.(?:io|example)/, /\b1\.2\.3\.4\b/, /xn--/, /[\u202e\u200b\u0456\uff47]/, /win\.ini/, /onmouseover/]) assert.doesNotMatch(text, re, `${name}: ${re}`);
  }
  // Every label in the labels file names a fixture in the record, and every fixture shown by a label has one.
  const labels = JSON.parse(readFileSync(LABELS_FILE, 'utf8'));
  const urls = [...record.poison, ...record.lookalikes, ...record.good];
  assert.deepEqual(Object.keys(labels.urls).sort(), urls.map(x => x.sha256).sort());
  for (const x of urls) assert.equal(x.label, labels.urls[x.sha256]);
  const byLabel = [...record.unsafeLines, ...record.safeLines].filter(x => x.shown === null);
  assert.deepEqual(Object.keys(labels.sinks).sort(), byLabel.map(x => x.sha256).sort());
  for (const x of [...record.unsafeLines, ...record.safeLines]) if (x.shown !== null) assert.equal(x.sha256, sha256(x.shown), 'a shown line is the line its sha256 names');
});

test('the vendor parses the fixture lists as literals and evaluates no code of the test', () => {
  assert.deepEqual(parseList(`[\n  'a' + 'b'.repeat(3), "c\\td", '\\u0456', // a comment\n  'e\\\\f',\n]`), ['abbb', 'c\td', '\u0456', 'e\\f']);
  assert.deepEqual(parseList('[]'), []);
  // The review's escape, and every other shape of code, is refused, never run.
  for (const hostile of ["[this.constructor.constructor('return process')().version]", "['a', process.exit(1)]", "[`x${1}`]", "['a'.toString()]", "['a', require('node:fs')]", "['a'] + x", "[('a')]", "['a' 'b']", "['\\x41']"]) {
    assert.throws(() => parseList(hostile), /only string literals are read/, hostile);
  }
  const src = `const GOOD = ['https://github.com/x'];\nconst POISON = [\n  'javascript:x',\n];\nconst LOOKALIKES = ['https://github.com.example/x'];\n  const UNSAFE = [\n    "window.open(u)", "a[b]",\n  ];\n    for (const line of ["window.open(v)"]) {\n        assert.equal(auditText('fixture', line).length, 1, 'x');\n  const SAFE = ["openSafe(u)"];\n`;
  const f = fixturesOf(src);
  assert.deepEqual([f.GOOD, f.POISON, f.LOOKALIKES, f.UNSAFE, f.SAFE], [['https://github.com/x'], ['javascript:x'], ['https://github.com.example/x'], ['window.open(u)', 'a[b]', 'window.open(v)'], ['openSafe(u)']]);
  assert.throws(() => fixturesOf(src.replace("'javascript:x',", "'javascript:x', globalThis.process,")), /only string literals are read/);
  assert.throws(() => fixturesOf('const GOOD = [];'), /second list/);
  assert.doesNotMatch(readFileSync('scripts/vendor-link-safety.mjs', 'utf8'), /node:vm|\bnew Function\b|\beval\(/, 'the vendor has no evaluator at all');
});

// The leak screen: on the rendered page, the record, the tile and the labels.
const LEAK_SHAPES = [/\/Users\//, /\/home\//, /\b[A-Z]:\\/, /~\/\./, /localhost/i, /\b127\.0\.0\.1\b/, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, /:\d{4,5}\b(?!["\d])/,
  /\bghp_|\bgithub_pat_|\bsk-[A-Za-z0-9]|\bAKIA[0-9A-Z]|-----BEGIN|\bxox[abp]-/, /odin-labs-ai\/(?!odin-rnd)/];

test('leak screen: no machine path, local host, address, port, credential, other repository or client theme anywhere it ships', () => {
  for (const [name, text] of [['page', main], ['record', raw], ['tile', tile], ['labels', readFileSync(LABELS_FILE, 'utf8')]]) {
    for (const re of LEAK_SHAPES) assert.doesNotMatch(text, re, `${name}: ${re}`);
    assert.ok(!namesRestricted(text), `${name}: a restricted name`);
  }
  assert.deepEqual(pageLeaks(page, recordHashes(record)), [], 'the rendered page passes the screen');
  assert.deepEqual(linkSafetyProblems(record), [], 'the record passes its checks and the screen');
  for (const file of ['scripts/lab-link-safety.mjs', 'scripts/vendor-link-safety.mjs', 'scripts/schemas/odin-lab-link-safety.schema.json', LABELS_FILE, 'site/labs/link-safety/index.html']) {
    assert.deepEqual(screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name')), [], file);
  }
});

test('the screen catches what it says it catches on this page (a failing negative per class)', () => {
  const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
  for (const [inject, reason] of [['/Users/someone/x', /machine path/], ['served on localhost', /local host/], ['10.0.0.12', /local host/], ['port :6488', /local host/], [credential, /credential/], ['a zarquonbank lender', /restricted name/], ['the zarquon repository', /restricted name/], ['odin-labs-ai/some-private-repo', /another repository/], ['it cost €40', /price or currency/], ['javascript:alert(1) at https://evil.io/x', /a link to somewhere other than this lab/]]) {
    assert.ok(pageLeaks(page.replace('</main>', `<p>${inject}</p></main>`), recordHashes(record)).some(p => reason.test(p)), inject);
  }
  assert.ok(pageLeaks(page.replace('</main>', '<p>id <code>1234567890abcdef</code></p></main>'), recordHashes(record)).some(p => /long internal id|a hash the record does not hold/.test(p)), 'a hex token the record does not hold');
});

test('the record is refused when it would make the page say something untrue', () => {
  const refused = (change, re) => { const r = clone(); change(r); assert.ok(linkSafetyProblems(r).some(p => re.test(p)), String(re)); };
  refused(r => { r.poison[3].open = 'kept'; }, /every poisoned URL is refused/);
  refused(r => { r.poison[0].allowlisted = 'kept'; }, /every poisoned URL is refused/);
  refused(r => { r.lookalikes[1].allowlisted = 'kept'; }, /every lookalike is refused under the allowlist/);
  refused(r => { r.lookalikes[0].open = 'refused'; }, /a lookalike is a link without the allowlist/);
  refused(r => { r.good[0].open = 'refused'; }, /every good URL is kept/);
  refused(r => { r.good.find(x => x.host === 'other').allowlisted = 'kept'; }, /keeps a good URL on its host and refuses one on another/);
  refused(r => { r.good.find(x => x.host === 'allowlisted').allowlisted = 'refused'; }, /keeps a good URL on its host and refuses one on another/);
  refused(r => { r.lookalikes[0].host = 'allowlisted'; }, /a lookalike is a link on another host/);
  refused(r => { r.unsafeLines[5].caught = 0; }, /catches every unsafe opener line/);
  refused(r => { r.safeLines[2].caught = 1; }, /lets every safe line through/);
  refused(r => { r.unsafeLines[0].label = 'x'; }, /shown as it is, or by its label/);
  refused(r => { r.good[1].sha256 = r.good[0].sha256; }, /two fixtures are the same/);
  refused(r => { r.run.tests.failed = 1; r.run.tests.passed = 6; }, /a test failed/);
  refused(r => { r.run.tests.passed = 6; }, /do not add up/);
  refused(r => { r.note.oldCode.passed = 18; }, /oldCode: failed and passed do not add up/);
  refused(r => { r.note.newCode.passed = 82; }, /the new code did not pass the same tests/);
  refused(r => { r.allowlist = ['github.com', 'example.org']; }, /the page names github\.com as the allowlist/);
  refused(r => { r.run.at = '2099-01-01T00:00:00Z'; r.run.on = '2099-01-01'; }, /after this build/);
  refused(r => { r.run.on = '2026-10-01'; }, /not the date of its run/);
  refused(r => { r.note.cites[0].commit = 'f'.repeat(40); }, /not shown as part of the private main/);
  refused(r => { r.vendored.cites[0].commit = 'e'.repeat(40); }, /not shown as part of the private main/);
  refused(r => { r.vendored.from = 'read from /Users/someone/engine'; }, /machine path|file path/);
  refused(r => { r.poison[0].label = 'a javascript: URL from https://evil.io/x'; }, /a link to somewhere other than this lab/);
  refused(r => { r.poison[0].url = 'javascript:alert(1)'; }, /does not match odin-lab-link-safety v1/);
  refused(r => { r.poison[0].open = 'maybe'; }, /does not match odin-lab-link-safety v1/);
});

test('the record is pinned: a changed byte refuses the build until the pin is re-written', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-link-safety-'));
  try {
    for (const file of [LINK_RECORD, LINK_PIN, LINK_TEMPLATE]) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), readFileSync(join('site', file))); }
    assert.equal(readLinkSafety(root).run.at, record.run.at);
    assert.equal(renderLinkSafety(root).pages[LINK_TEMPLATE], page, 'a fixture with the same files renders the same page');
    writeFileSync(join(root, LINK_RECORD), raw.replace('"failed": 0', '"failed": 0 '));
    assert.throws(() => readLinkSafety(root), /record\.sha256: does not pin the sha256/);
    const changed = raw.replace(record.poison[0].label, 'something else entirely');
    writeFileSync(join(root, LINK_RECORD), changed);
    writeFileSync(join(root, LINK_PIN), `${sha256(changed)}  record.json\n`);
    assert.doesNotThrow(() => readLinkSafety(root));
    assert.equal(readFileSync(join('site', LINK_PIN), 'utf8'), `${sha256(raw)}  record.json\n`, 'the committed pin is the committed record\'s');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
