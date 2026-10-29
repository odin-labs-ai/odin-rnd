import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kit from './lab-kit.mjs';
import * as engine from './lab-engine-history.mjs';
import * as rogue from './lab-rogue.mjs';
import { screenHits } from './lab-dispatch-publish.mjs';
import { renderLabs } from './labs.mjs';
import { namesRestricted } from './lab-dispatch-publish.mjs';
// Made-up restricted names (random per run, added to the lab screen): a real one is never spelled in this public repo.
import { SYN_REPO, SYN_THEME } from './test-synthetic-names.mjs';

// The lab kit (scripts/lab-kit.mjs). Lab 01's engine history and Lab 05 are built on it, so their own tests hold the
// refactor; these hold the kit itself, and give every class the leak screen guards a planted value that fails a build.
const { box, BOX_LABELS, cite, decode, instantProblems, onMainCommits, pageLeaks, parsePin, pinProblems, readPinned, realInstant, recordHashes, screenRecord, sha256, sidecarPinProblems, vendoredProblems } = kit;
const MAIN = 'a1b2c3d4'.repeat(5), ON_MAIN = 'b2c3d4e5'.repeat(5), LANE = 'c3d4e5f6'.repeat(5);
const NOW = new Date('2026-10-27T12:00:00Z');

// A minimal lab built on the kit alone: a pinned record, the kit's vendored contract, its text screened, a page
// rendered from it and screened as a whole. A planted leak anywhere must fail it.
const fixture = () => ({
  format: 'odin-lab-kit-fixture', version: 1,
  vendored: {
    from: 'a demo in a private repository, read at one commit',
    mainCheck: { main: MAIN, how: 'a compare of each cited commit against the private main head', checked: '2026-10-27', commits: [ON_MAIN] },
    cites: [{ commit: ON_MAIN, at: '2026-10-26T09:00:00Z', what: 'the run record' }],
    files: [{ role: 'record', what: 'the run record', sha256: 'd'.repeat(64) }],
  },
  finding: 'Every command was refused.',
});
const FILE = 'data/labs/fixture/record.json', PIN = 'data/labs/fixture/record.sha256';
const render = r => `<main id="main"><p>${kit.escape(r.finding)}</p><p>${r.vendored.cites.map(c => cite(c, r.vendored.mainCheck)).join(' ')}</p></main>`;
function buildFixture(record, { page = render } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lab-kit-'));
  try {
    mkdirSync(join(root, 'data/labs/fixture'), { recursive: true });
    const bytes = `${JSON.stringify(record, null, 1)}\n`;
    writeFileSync(join(root, FILE), bytes);
    writeFileSync(join(root, PIN), `${sha256(bytes)}  record.json\n`);
    const r = readPinned({ root, file: FILE, pin: b => sidecarPinProblems(root, b, { pinFile: PIN, file: FILE, vendor: 'the vendor script' }),
      check: rec => [...vendoredProblems(rec.vendored, { where: FILE, now: NOW }), ...screenRecord(rec, FILE)], refused: 'fixture refused' });
    const html = page(r);
    const leaks = pageLeaks(html, recordHashes(r), { onMain: onMainCommits(r.vendored.mainCheck) });
    if (leaks.length) throw new Error(`fixture page fails the screen:\n  ${leaks.join('\n  ')}`);
    return html;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('Lab 01 and Lab 05 are built on the kit: one cite, one clock, one leak screen', () => {
  assert.equal(engine.cite, cite);
  assert.equal(engine.realInstant, realInstant);
  assert.equal(rogue.pageLeaks, pageLeaks);
  assert.equal(rogue.recordHashes, recordHashes);
  for (const file of ['scripts/lab-engine-history.mjs', 'scripts/lab-rogue.mjs']) {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /from '\.\/lab-kit\.mjs'/, file);
    assert.doesNotMatch(src, /createHash|const escape =|const sha256 =|function realInstant|const LEAKS|=> `Private commit/, `${file} holds no copy of the kit`);
  }
  assert.equal(cite({ commit: ON_MAIN }, { main: MAIN, checked: '2026-10-27' }), `Private commit <code>${ON_MAIN.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${MAIN.slice(0, 8)}</code> on <time datetime="2026-10-27">2026-10-27</time>; this page cannot check it, anyone with access can.`);
});

test('one pin, two committed shapes: a sha256sum line and a JSON pin read the same way', () => {
  const bytes = Buffer.from(JSON.stringify({ vendored: { sourceSha256: 'e'.repeat(64), mainCheck: { main: MAIN } } }));
  const line = parsePin(`${sha256(bytes)}  record.json\n`, { pinFile: 'p' });
  const json = parsePin({ format: 'f', version: 1, file: 'site/x/record.json', fileSha256: sha256(bytes), sourceSha256: 'e'.repeat(64), commit: MAIN }, { pinFile: 'p', format: 'f', file: 'site/x/record.json' });
  assert.deepEqual([line.problems, json.problems], [[], []]);
  assert.equal(line.pin.fileSha256, json.pin.fileSha256);
  const opts = { pinFile: 'p', file: 'x/record.json', vendor: 'v' };
  assert.deepEqual(pinProblems(bytes, line.pin, opts), []);
  assert.deepEqual(pinProblems(bytes, json.pin, opts), []);
  // A changed byte refuses both shapes until the pin is re-written.
  const changed = Buffer.from(`${bytes} `);
  for (const pin of [line.pin, json.pin]) assert.match(pinProblems(changed, pin, opts).join(), /p: does not pin the sha256 of x\/record\.json .*re-vendor with v/);
  // A line naming another file, a JSON pin naming another main head or source, an unreadable pin: each refused.
  assert.match(pinProblems(bytes, parsePin(`${sha256(bytes)}  other.json\n`, { pinFile: 'p' }).pin, opts).join(), /names other\.json, not record\.json/);
  assert.match(pinProblems(bytes, { ...json.pin, commit: ON_MAIN }, opts).join(), /is not the main head the record was checked against/);
  assert.match(pinProblems(bytes, { ...json.pin, sourceSha256: '0'.repeat(64) }, opts).join(), /sourceSha256 0{64} is not the record's/);
  assert.match(parsePin('not a pin', { pinFile: 'p' }).problems.join(), /not a sha256sum line/);
  assert.match(parsePin(null, { pinFile: 'p' }).problems.join(), /p: missing/);
  assert.match(parsePin({ format: 'g', version: 1 }, { pinFile: 'p', format: 'f' }).problems.join(), /missing, or not f v1/);
  assert.match(parsePin({ format: 'f', version: 1, file: 'y', sourceSha256: 'z', commit: 'abc' }, { pinFile: 'p', format: 'f', file: 'x' }).problems.join('\n'), /file is not x\n.*sourceSha256 is not a sha256\n.*commit is not a 40-hex commit/);
});

test('the build is fail-closed: an absent record renders nothing, a broken one throws with every reason', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-kit-'));
  try {
    const read = () => readPinned({ root, file: FILE, pin: b => sidecarPinProblems(root, b, { pinFile: PIN, file: FILE, vendor: 'v' }), check: () => ['a check'], refused: 'refused' });
    assert.equal(read(), null);
    mkdirSync(join(root, 'data/labs/fixture'), { recursive: true });
    writeFileSync(join(root, FILE), '{');
    assert.throws(read, e => /^refused:/.test(e.message) && /record\.sha256: missing/.test(e.message) && /not JSON/.test(e.message) && !/a check/.test(e.message));
    writeFileSync(join(root, FILE), '{}');
    assert.throws(read, e => /record\.sha256: missing/.test(e.message) && /a check/.test(e.message), 'the pin and the check are both reported');
    // A present record that parses to something other than an object is refused, never taken for an absent one, even
    // when it is correctly pinned.
    for (const value of ['null', '0', '[]', '"x"']) {
      writeFileSync(join(root, FILE), value);
      writeFileSync(join(root, PIN), `${sha256(value)}  record.json\n`);
      assert.throws(read, e => /not a JSON object/.test(e.message), value);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  assert.match(buildFixture(fixture()), /Every command was refused\./, 'the clean fixture builds');
});

test('dates: a fake date or one after the build is refused', () => {
  assert.deepEqual(instantProblems('2026-10-26T09:00:00Z', 'at', NOW), []);
  assert.deepEqual(instantProblems('2026-10-27', 'at', NOW), []);
  assert.match(instantProblems('2026-02-30', 'at', NOW).join(), /not a real date/);
  assert.match(instantProblems('2026-10-26T24:00:00Z', 'at', NOW).join(), /not a real date/);
  assert.match(instantProblems('2027-01-01T00:00:00Z', 'at', NOW).join(), /after this build/);
});

test('a lane-only commit is never cited: the record contract and the page screen both refuse it', () => {
  const r = fixture();
  r.vendored.cites.push({ commit: LANE, at: '2026-10-26T10:00:00Z', what: 'a newer variant' });
  assert.match(vendoredProblems(r.vendored, { where: FILE, now: NOW }).join(), /c3d4e5f6 is not shown as part of the private main a1b2c3d4; a commit only on a lane is never cited/);
  assert.throws(() => buildFixture(r), /a commit only on a lane is never cited/);
  // On the page: a hash the record does not hold is refused; one it holds is not.
  assert.throws(() => buildFixture(fixture(), { page: rec => `${render(rec)}<p>see commit <code>${LANE.slice(0, 8)}</code></p>` }), /a hash the record does not hold \(c3d4e5f6\)/);
  assert.doesNotThrow(() => buildFixture(fixture(), { page: rec => `${render(rec)}<p>file <code>${'d'.repeat(12)}</code></p>` }));
  // A lane-only commit hidden in another field of the record is still never cited: cite() refuses it, and a cite
  // sentence written by hand is refused by the page screen.
  const hidden = { ...fixture(), note: LANE };
  assert.throws(() => buildFixture(hidden, { page: rec => `${render(rec)}<p>${cite({ commit: LANE }, rec.vendored.mainCheck)}</p>` }), /a commit only on a lane is never cited/);
  const byHand = `${render(hidden)}<p>Private commit <code>${LANE.slice(0, 8)}</code>, cited by hash, checked as part of the private main <code>${MAIN.slice(0, 8)}</code></p>`;
  assert.throws(() => buildFixture(hidden, { page: () => byHand }), /a cited commit not shown as part of the private main \(c3d4e5f6\)/);
  assert.throws(() => cite({ commit: LANE }, { main: MAIN, checked: '2026-10-27', commits: [ON_MAIN] }), /never cited/);
  // On Lab 05's real page the cite check is live: with no commit allowed, every cite sentence is refused.
  const lab05 = renderLabs()[rogue.ROGUE_TEMPLATE];
  const lab05Record = rogue.readRogue();
  assert.ok(pageLeaks(lab05, recordHashes(lab05Record), { onMain: [] }).filter(p => /a cited commit not shown/.test(p)).length >= 4);
  const bad = fixture();
  bad.vendored.mainCheck.commits = ['xyz'];
  assert.match(vendoredProblems(bad.vendored, { where: FILE, now: NOW }).join(), /mainCheck\/commits: not a list of 40-hex commits/);
  assert.match(vendoredProblems({ ...fixture().vendored, files: [] }, { where: FILE, now: NOW }).join(), /each source file once/);
  assert.match(vendoredProblems({ ...fixture().vendored, cites: [] }, { where: FILE, now: NOW }).join(), /no cited commit/);
  // Provenance said in words: where it was read, how main was checked, what each cite and file is, each file's role.
  const omit = edit => { const r = fixture(); edit(r.vendored); return vendoredProblems(r.vendored, { where: FILE, now: NOW }).join('\n'); };
  assert.match(omit(v => { delete v.from; }), /vendored\/from: missing/);
  assert.match(omit(v => { v.mainCheck.how = ' '; }), /mainCheck\/how: missing/);
  assert.match(omit(v => { delete v.cites[0].what; }), /cites\/0\/what: missing/);
  assert.match(omit(v => { v.files = [{ sha256: 'd'.repeat(64) }]; }), /files\/0\/role: missing[\s\S]*files\/0\/what: missing/);
});

// The leak screen, class by class: each planted value fails the fixture's build, in the record and on the page. The
// client theme and the private repository are planted by words the screen knows only by their hash; the game
// publisher is on the same hashed list, and is not spelled in this public repository.
const credential = ['gh', 'p_', 'x'.repeat(36)].join('');
const CLASSES = [
  ['a local path', ['/Users/someone/work', '/home/someone/x', 'C:\\work'], /machine path|file path/],
  ['a host, port or IP', ['served on localhost', '10.0.0.12', 'the box at :6488'], /local host|local or IP address/],
  ['a client name (the talk theme)', [`a ${SYN_THEME} lender`, `${SYN_THEME.toUpperCase()}S, Inc.`], /restricted name/],
  ['a private repository name', [`the ${SYN_REPO} repository`, 'odin-labs-ai/some-private-repo'], /restricted name|another repository/],
  ['a credential', [credential, 'Authorization: Bearer abc123'], /credential/],
  ['a money figure', ['it cost €40', 'about $12.00', '12 USD a run'], /price or currency amount/],
];

test('the leak screen has a failing negative for every class it guards', () => {
  for (const [name, plants, reason] of CLASSES) for (const plant of plants) {
    // In the record only: a string field the page does not show.
    assert.throws(() => buildFixture({ ...fixture(), note: plant }), e => /^fixture refused:/.test(e.message) && reason.test(e.message), `${name} in the record: ${plant}`);
    // On the page only (the record is clean).
    assert.throws(() => buildFixture(fixture(), { page: rec => `${render(rec)}<p>${kit.escape(plant)}</p>` }), e => reason.test(e.message), `${name} on the page: ${plant}`);
  }
  // Encoded on the page, as a browser would show it: still caught.
  for (const [encoded, reason] of [['odin-labs-ai&#47;some-private-repo', /another repository \(as shown\)/], ['odin-labs-ai&#x2f;x', /another repository/], ['odin-labs-ai&#47;<wbr>some-private-repo', /another repository \(as shown\)/], ['<span>/Us</span><span>ers/someone</span>', /machine path/], ['odin-labs-ai&#47;<label>some-private-repo</label>', /another repository/], ['odin-labs-ai/<x-made-up>some-private-repo</x-made-up>', /another repository/], ['local<output>host</output>', /local host/], ['<p>odin-labs-ai/</p><p>some-private-repo</p>', /another repository/], ['odin-labs-ai/odin-rnd-private', /another repository/], ['<span>local<script>x()</script>host</span>', /local host/], ['local<style>p{}</style>host', /local host/], ['ghp&lowbar;x', /character reference this screen does not decode \(&lowbar;\)/], ['ghp&UnderBar', /does not decode/], ['C&colon;\\work', /does not decode/], ['local<!-- x > y -->host', /local host/], ['<span title="<!--">localhost<!-- --></span>', /local host/], ['<span title="<!--">it cost €40<!-- --></span>', /price or currency/], ['1 < it cost €40 > 2', /price or currency/], ['<span title="<!--">local&#104;ost ><!-- --></span>', /local host/], ['<span title=">">localhost</span>', /local host/], ["<span data-x='<!--'>it cost €40</span><!-- -->", /price or currency/], ['<textarea>localhost</textarea>', /local host/], ['<!-->local&#104;ost<!-- -->', /local host/], ['<span a=x=">&#8364;40</span>', /price or currency/], ['<script\u00a0>&#8364;40</script>', /price or currency/], ['<style\u00a0x>it cost €40</style>', /price or currency/], ['<script></scriptx>it cost €40</script>', /price or currency/], ['<textarea><!--</textarea>it cost €40', /price or currency/], ['<title><span></title>it cost €40', /price or currency/], ['<xmp>local<b>host</xmp>', /local host/], ['<plaintext>it cost €40', /price or currency/], ['<template>it cost €40</template>', /price or currency/], ['<span>local<script data-x="' + '\u0130'.repeat(12) + '">0</script x>host</span>', /local host/], ['<span>it cost €<script data-x="' + '\u0130'.repeat(12) + '">0</script x>40</span>', /price or currency/], ["<span a=x'y>it cost €40</span> '", /price or currency/], ['<span a = "q" b c=d/e>it cost €40</span>', /price or currency/], ['<span title="<script>">localhost</span><script>x</script>', /local host/], ['local\u200bhost', /local host|local or IP address/], ['local&#8203;host', /local host/], ['l\u043ecalhost', /local host/], ['\u202etsohlacol', /text direction control/], ['&constructor;', /does not decode/], ['Odin-Labs-AI/secret', /another repository/], ['<a href="https://github.com/odin-labs-ai%2Fsecret">x</a>', /another repository/], ['&#47;Users&#47;someone', /machine path/], ['local&#104;ost', /local host/], ['&#8364;40', /price or currency/]]) {
    assert.throws(() => buildFixture(fixture(), { page: rec => `${render(rec)}<p>${encoded}</p>` }), e => reason.test(e.message), encoded);
  }
  assert.equal(decode('a&#47;b&#x2F;c&amp;#47;'), 'a/b/c&#47;', 'decoded once, &amp; last');
  assert.equal(decode('&lt;x&gt; &amp;lt; &mdash; &lowbar;'), '<x> &lt; \u2014 &lowbar;', 'only the known names; an unknown one is left for pageLeaks to refuse');
  assert.deepEqual(pageLeaks('<main><p>R&amp;D &lt;agent&gt; &quot;x&quot; &mdash; &amp;lowbar;</p></main>').filter(p => /does not decode/.test(p)), [], 'the known names, and an escaped unknown one, pass');
  assert.equal(kit.stripTags('a<<b>i>c<x>/Users'), 'ac/Users', 'a tag rebuilt by removing an inner one is removed too');
  // The tokenizer reads markup as HTML does: quoted attributes hide nothing and are never shown.
  assert.equal(kit.shownText('<p title="<!--">local&#104;ost ><!-- --></p>'), 'local&#104;ost >');
  assert.equal(kit.shownText('a<!-- x > y -->b<script>if (a < b) c()</script>c<style>p{}</style>d'), 'abcd');
  assert.equal(kit.shownText('a<!-->b<!--->c<!-- x --!>d<!-- -->e'), 'abcde', 'abrupt and --!> comment ends, as HTML closes them');
  assert.equal(kit.shownText('<span a=x=">t</span>'), 't', 'a quote inside an unquoted value is a character of it');
  assert.equal(kit.shownText('<script\u00a0>t</script>'), 't', 'U+00A0 is not tag whitespace: an unknown element, shown');
  assert.equal(kit.shownText('<script>a</scriptx>b</script >c'), 'c', 'raw text ends only at a real end tag');
  assert.equal(kit.shownText('<textarea><!--</textarea>x<xmp><b>y</xmp>z'), '<!--x<b>yz', 'RCDATA and RAWTEXT hold "<" literally');
  assert.equal(kit.shownText('<p =x a = "b>c" d=\'e"f\' g>t</p>'), 't');
  assert.equal(kit.shownText("<a href='x>y' title=\"q'r\">t</a> 1 < 2 <b"), 't 1 < 2 ');
  assert.equal(kit.shownText('<p>a</p><span>b</span><br>c', { breaks: true }), '\na\nb\nc');
  // This lab's own repository is not another repository.
  assert.deepEqual(pageLeaks('<main><p><a href="https://github.com/odin-labs-ai/odin-rnd/blob/main/README.md">odin-labs-ai/odin-rnd</a></p></main>').filter(p => /another repository/.test(p)), []);
  // A lane-only sha is the sixth class: held above, by the record contract and the page screen.
  assert.doesNotThrow(() => buildFixture(fixture()), 'the clean fixture still builds');
});

test('a restricted name is screened by hash, in any case and glued to other words, and never spelled in the list', () => {
  // A synthetic name stands in for the client theme: the real one is listed by hash and never spelled in this repo.
  for (const text of [SYN_THEME, `${SYN_THEME.toUpperCase()} advice`, `${SYN_THEME}lender`]) assert.ok(screenHits(text).some(h => /restricted name/.test(h.reason)), text);
  const terms = readFileSync('scripts/lab-screen-terms.json', 'utf8');
  assert.ok(JSON.parse(terms).names.every(h => /^[0-9a-f]{64}$/.test(h)), 'listed by hash, never spelled');
});

test('the marked boxes say what they are in their own label', () => {
  assert.equal(box('estimate', { cls: 'x-estimate', id: 'estimate', body: '<p>b</p>' }), '<div class="lab-panel x-estimate" id="estimate"><p class="technical">AN ESTIMATE, NOT A MEASUREMENT</p><p>b</p></div>');
  assert.equal(BOX_LABELS.judge, '<p class="technical">A SEPARATE AI REVIEWER, NOT A HUMAN</p>');
  assert.equal(BOX_LABELS.summary, '<p class="technical">SUMMARY ONLY, NOT REPRODUCIBLE HERE</p>');
  assert.equal(BOX_LABELS.fixture, '<p class="technical">AN AUTHORED FIXTURE, WRITTEN BY US</p>');
  assert.equal(box('staged', { cls: 's', body: '' }), '<div class="lab-panel s"><h3>Staged</h3></div>');
  assert.throws(() => box('verified', { cls: 's', body: '' }), /no such kind/);
  assert.throws(() => box('real', { cls: 's" onclick="x', body: '' }), /plain names/);
});

test('the kit and the screen terms name no restricted name', () => {
  for (const file of ['scripts/lab-kit.mjs']) assert.deepEqual(screenHits(readFileSync(file, 'utf8')).filter(h => h.reason.startsWith('a restricted name')), [], file);
});

test('a known hash with a long run of digits is masked even glued to the next element\'s text; unknown, the digits are refused', () => {
  // About a third of sha256 hex strings hold a run of 9 or more digits (this one: 10). In a feed the hash can sit
  // right against the next element's text, with no word boundary between them.
  const H = '20ca7b014adc7ad7f9c6d7e60d3025bf707fcad53a7956953430a7fc2db94148';
  const xml = `<feed><entry><id>tag:odin-labs-ai.github.io,2026:odin-rnd/labs/rogue/runs/org-ci-heavy/2026-10-29T07:26:11Z/${H}</id><title>Lab 05: a run, record ${H.slice(0, 12)}, SAME</title><summary>record hash ${H}; SAME.</summary></entry></feed>`;
  assert.deepEqual(kit.pageLeaks(xml, [H]), []);
  assert.ok(kit.pageLeaks(xml, []).some(p => /long internal id/.test(p)), 'the same text without the hash known is refused');
  assert.ok(kit.pageLeaks(`<p>run 7956953430 of ${H}</p>`, [H]).some(p => /long internal id/.test(p)), 'a bare long number next to a known hash is still refused');
  // The lead's planted negatives (2026-10-29): a 12-digit number in a title, and an unknown digest, in the same feed.
  const other = 'f93aa8884095601234567890abcdef0123456789abcdef0123456789abcdef01';
  assert.ok(kit.pageLeaks(xml.replace('<title>Lab 05', '<title>Lab 05 run 123456789012'), [H]).some(p => /long internal id/.test(p)), 'a 12-digit number in a title is refused');
  assert.ok(kit.pageLeaks(xml.replace('record hash ' + H, 'record hash ' + other), [H]).some(p => /long internal id|a hash the record does not hold/.test(p)), 'an unknown digest with a digit run is refused');
});
