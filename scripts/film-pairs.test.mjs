// The dist pass for the films' MP4 copies (scripts/film-pairs.mjs): who writes a pair, how many pairs each built page
// carries, and which built files may name a WebM. The copies themselves are tested in scripts/film-fallbacks.test.mjs. The fixture
// is a real committed copy (the 2026-11-08 session clip and its MP4), linked into a temporary site root once.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FALLBACKS_FILE, readFallbacks } from './film-fallbacks.mjs';
import { filmSources, startFilmLedger } from './film-sources.mjs';
import { addFilmFallbacks, HOME, pagePairs, textMentions } from './film-pairs.mjs';
import { renderLabs } from './labs.mjs';

// A <video> start tag as the generators write it.
const V = '<video controls preload="none" playsinline poster="p.webp" aria-label="A film">';
const REAL = readFallbacks('site').fallbacks.find(entry => entry.webm === 'assets/labs/agent-space/session-2026-11-08/clip.webm');
const place = (from, to) => { mkdirSync(dirname(to), { recursive: true }); try { linkSync(from, to); } catch { copyFileSync(from, to); } };
const ROOT = mkdtempSync(join(tmpdir(), 'film-pairs-'));
for (const file of [REAL.webm, REAL.mp4]) place(join('site', file), join(ROOT, file));
mkdirSync(join(ROOT, dirname(FALLBACKS_FILE)), { recursive: true });
writeFileSync(join(ROOT, FALLBACKS_FILE), JSON.stringify({ ...JSON.parse(readFileSync(join('site', FALLBACKS_FILE), 'utf8')), fallbacks: [REAL] }));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const fixture = () => ({ root: ROOT });

// The fixture's film, as a generator writes it at '../../' and as a hand-written home page pins it.
const FILM = 'assets/labs/agent-space/session-2026-11-08/clip.webm';
const PAIR_AT = up => `<source src="${up}${FILM}" type="video/webm"><source src="${up}assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`;
const HOME_FIXTURE = { page: 'index.html', webm: FILM, player: `<figure class="m">${V}${PAIR_AT('')}` };
const HOME_PAGE = `<main>${HOME_FIXTURE.player}</video></figure></main>`;
const LAB_PAGE = `<main>${V}${PAIR_AT('../../')}</video></main>`;

/**
 * A built site for the fixture film: its copy in dist, the pinned home page, a generated page that plays the film once
 * (the ledger says 1) and any `files` given. Returns the dist pass's result, or the error it threw.
 */
const LAB = 'labs/agent-space/index.html';
const wrote = (n = 1, file = LAB) => new Map([[file, new Map([[FILM, n]])]]);
function distRun(files = {}, { written = wrote(), home = HOME_PAGE, lab = LAB_PAGE } = {}) {
  const { root } = fixture();
  const dist = mkdtempSync(join(tmpdir(), 'film-fallbacks-dist-'));
  try {
    // The copy is linked, never written: no test writes to a path the fixture links.
    assert.ok(!(REAL.mp4 in files) && !(REAL.webm in files), 'a test must not write over a linked copy');
    place(join(root, REAL.mp4), join(dist, REAL.mp4));
    const all = { 'index.html': home, 'labs/agent-space/index.html': lab, ...files };
    for (const [file, text] of Object.entries(all)) if (text !== null) { mkdirSync(join(dist, file, '..'), { recursive: true }); writeFileSync(join(dist, file), text); }
    try { return { result: addFilmFallbacks({ distDir: dist, root, written, home: HOME_FIXTURE }), home: readFileSync(join(dist, 'index.html'), 'utf8') }; } catch (error) { return { error }; }
  } finally { rmSync(dist, { recursive: true, force: true }); }
}
const refused = (run, pattern, label) => { assert.ok(run.error, `${label}: refused`); assert.match(run.error.message, pattern, label); };

test('a generator writes the WebM <source> and its MP4 copy in one call, and the ledger counts each pair it writes', () => {
  const { root } = fixture();
  try {
    assert.equal(filmSources('../../', FILM, 'video/webm', root), PAIR_AT('../../'));
    assert.equal(filmSources('', FILM, 'video/webm;codecs=vp9', root), `<source src="${FILM}" type="video/webm;codecs=vp9"><source src="assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`);
    assert.equal(filmSources('../../', 'assets/labs/agent-space/session-2026-11-08/no-copy.webm', 'video/webm', root), '<source src="../../assets/labs/agent-space/session-2026-11-08/no-copy.webm" type="video/webm">', 'no copy: the WebM alone, which the dist pass then refuses');
    const close = startFilmLedger();
    filmSources('../../', FILM, 'video/webm', root); filmSources('', FILM, 'video/webm', root);
    filmSources('', 'assets/labs/agent-space/session-2026-11-08/no-copy.webm', 'video/webm', root);
    assert.throws(() => startFilmLedger(), /already open/);
    assert.deepEqual([...close()], [[FILM, 2]]);
    filmSources('', FILM, 'video/webm', root);
    for (const [up, webm, type] of [['/', FILM, 'video/webm'], ['../', `../${FILM}`, 'video/webm'], ['', 'assets/./f.webm', 'video/webm'], ['', 'assets/f.webm" onerror="x', 'video/webm'],
      ['', 'assets/f.WEBM', 'video/webm'], ['', 'assets/f.webm#t=1', 'video/webm'], ['', 'https://example.org/f.webm', 'video/webm'], ['', FILM, 'video/mp4'], ['', FILM, 'video/webm" x="'], ['x/', FILM, 'video/webm']])
      assert.throws(() => filmSources(up, webm, type, root), /not a plain relative path to a WebM with a WebM type/, JSON.stringify([up, webm, type]));
  } finally { /* the shared root stays until after() */ }
});

test('the generators write every pair the built pages carry, and the ledger counts exactly those (the committed site)', () => {
  const record = readFallbacks('site'), byWebm = new Map(record.fallbacks.map(e => [e.webm, e]));
  const close = startFilmLedger();
  const pages = renderLabs();
  const written = close();
  const found = new Map();
  for (const [file, html] of Object.entries(pages)) {
    const r = textMentions(html, file, byWebm);
    assert.deepEqual(r.unpaired, [], file);
    for (const [webm, n] of r.found) found.set(webm, (found.get(webm) ?? 0) + n);
  }
  assert.deepEqual([...found].sort(), [...written].sort());
  assert.ok(written.size >= 6, 'every lab film but the home page\'s own is written by a generator');
  const perPage = pagePairs(pages, written);
  assert.deepEqual([...perPage.keys()], ['labs/agent-space/index.html'], 'the generated players are all on the Lab 01 page');
  // A played pair in the rendered text that filmSources() did not count (a hand copy in a template) is refused.
  const copied = { ...pages, 'labs/agent-space/index.html': pages['labs/agent-space/index.html'].replace('</main>', `${V}${filmSources('../../', 'assets/labs/agent-space/films/agent-space-30s.webm')}</video></main>`) };
  assert.throws(() => pagePairs(copied, written), /rendered pages carry pairs filmSources\(\) did not write:\n  assets\/labs\/agent-space\/films\/agent-space-30s\.webm: 2 on the pages, 1 written/);
});

test('the home page carries its pinned player, both sources, exactly once, and the dist pass writes nothing', () => {
  const committed = readFileSync('site/index.html', 'utf8');
  assert.equal(committed.split(HOME.player).length, 2, 'site/index.html carries HOME.player exactly once');
  assert.ok(HOME.player.endsWith('<source src="assets/labs/agent-space/progress/hq-on-duty.webm" type="video/webm;codecs=vp9,opus"><source src="assets/labs/agent-space/progress/hq-on-duty.mp4" type="video/mp4">'));
  const run = distRun();
  assert.ifError(run.error);
  assert.deepEqual(run.result, { films: 1, pairs: 2 });
  assert.equal(run.home, HOME_PAGE, 'the home page is left byte for byte');
  refused(distRun({}, { home: '<main>no film</main>' }), /pinned home player .* is not on the page/, 'pin missing');
  refused(distRun({}, { home: HOME_PAGE + HOME_PAGE }), /pinned home player .* more than once/, 'pin twice');
  refused(distRun({}, { home: HOME_PAGE.replace(/<source src="[^"]+\.mp4" type="video\/mp4">/, '') }), /pinned home player .* is not on the page/, 'the MP4 source taken out');
  refused(distRun({}, { home: HOME_PAGE.replace('</video>', `${PAIR_AT('')}</video>`) }), /index\.html: 2 WebM-then-MP4 <source> pairs of .*clip\.webm, but the build wrote 1 there/, 'a second pair beside the pin');
  // The stated limit (OUT in #243, follow-on in #228): where the hand-written home player sits is not judged. Wrapped by
  // hand in a comment or a template it keeps its one pair and passes. This keeps the limit visible; it is not a claim
  // that such a page plays.
  for (const wrap of [h => `<!-- ${h} -->`, h => `<template>${h}</template>`]) assert.ifError(distRun({}, { home: wrap(HOME_PAGE) }).error);
});

test('a copy no page plays, and a WebM with no copy, are refused', () => {
  refused(distRun({}, { written: new Map(), lab: '<main>no film</main>', home: HOME_PAGE.replace(FILM, 'assets/other.webm') }), /clip\.webm has an MP4 copy but no page plays it/, 'unplayed copy');
  // The count is bound to the page (fb705fa9 item 3): a pair the build wrote on one page that turns up on another is refused.
  refused(distRun({ 'labs/agent-space/notes/index.html': `<main>${V}${PAIR_AT('../../../')}</video></main>` }, { lab: '<main>no film</main>' }), /labs\/agent-space\/index\.html: 0 WebM-then-MP4 <source> pairs of .*clip\.webm, but the build wrote 1 there/, 'moved to another page');
  refused(distRun({ 'labs/x/index.html': `${V}<source src="../../assets/labs/agent-space/session-2026-11-08/no-copy.webm" type="video/webm"></video>` }), /labs\/x\/index\.html: ".*no-copy\.webm.*" names a WebM outside the paired forms/, 'no copy');
  refused(distRun({}, { written: wrote(2) }), /labs\/agent-space\/index\.html: 1 WebM-then-MP4 <source> pairs of .*clip\.webm, but the build wrote 2 there/, 'a written pair that never reached dist');
});

// #228 item 1: a hand copy of the exact player text into an inert place, on a generated page, on another page or in
// another kind of file. The build wrote 1 pair on the lab page and 1 on the home page; a copy adds one where none was
// written, or makes the lab page's count 2, and is
// refused whatever the context, so no tokenizer has to know that the context is inert.
test('a copy of the exact player, in any inert place or any other file, is a pair the build did not write and is refused (#228 item 1)', () => {
  const player = `${V}${PAIR_AT('../../')}</video>`;
  const inert = {
    comment: `<!-- ${player} -->`, script: `<script>const t = '${player}';</script>`, template: `<template>${player}</template>`,
    'nested template': `<template><template></template>${player}</template>`, 'quoted attribute': `<div data-x='${player}'></div>`,
    svg: `<svg><foreignObject>${player}</foreignObject></svg>`, 'svg parent': `<svg>${player}</svg>`, math: `<math>${player}</math>`,
    textarea: `<textarea>${player}</textarea>`, title: `<title>${player}</title>`, xmp: `<xmp>${player}</xmp>`, noscript: `<noscript>${player}</noscript>`,
    'iframe srcdoc': `<iframe srcdoc='${player}'></iframe>`, style: `<style>/* ${player} */</style>`, 'plain text after plaintext': `<plaintext>${player}`,
    'select option': `<select><option>${player}</option></select>`,
  };
  for (const [label, html] of Object.entries(inert)) {
    refused(distRun({ 'labs/agent-space/index.html': LAB_PAGE.replace('</main>', `${html}</main>`) }), /WebM-then-MP4 <source> pairs of .*clip\.webm, but the build wrote|names a WebM outside the paired forms/, `${label}, on the generated page`);
    refused(distRun({ 'labs/agent-space/notes/index.html': `<main>${html.replaceAll('../../', '../../../')}</main>` }), /labs\/agent-space\/notes\/index\.html: (1 WebM-then-MP4 <source> pairs of .*clip\.webm, but the build wrote 0 there|.*names a WebM outside the paired forms)/, `${label}, on another page`);
  }
  const home = `<source src="${FILM}" type="video/webm"><source src="assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`;
  for (const [file, text] of Object.entries({ 'assets/labs/agent-space/session-2026-11-08/frame.svg': `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>${home.replaceAll('assets/labs/agent-space/session-2026-11-08/', '')}</foreignObject></svg>`,
    'feed.xml': `<feed><content type="html">${home}</content></feed>`, 'player.js': `document.body.insertAdjacentHTML('beforeend', '${home}');`, 'notes.txt': home, 'readme.md': home }))
    refused(distRun({ [file]: text }), /: 1 WebM-then-MP4 <source> pairs of .*clip\.webm, but the build wrote 0 there|names a WebM outside the paired forms/, file);
  // The WebM half alone, copied anywhere, is a WebM mention outside a pair.
  for (const html of Object.values(inert)) refused(distRun({ 'x/index.html': html.replace(/<source src="[^"]+\.mp4" type="video\/mp4">/, '') }), /names a WebM outside the paired forms/, html);
});

// #228 item 2: hand-built tokenizer cases. Nothing is tokenized any more: a full pair is counted wherever it sits and
// the WebM half alone is a mention; each case is refused.
test('hand-built tokenizer cases are refused, with or without a full pair (#228 item 2)', () => {
  const pair = PAIR_AT('../../');
  const cases = [
    `<video title=${' '.repeat(16)}"a > b" controls>${pair}</video>`, `<video title=${' '.repeat(40)}"a > b" src="../../${FILM}" controls></video>`,
    `<p data-x=a"b>${V}${pair}</video></p>`, `<p data-x=a="q><video title="x>y" src="../../${FILM}" controls></video>`,
    `<p>a --> b</p>${V}${pair}</video>`, `<p>a --> b</p><!-- ${V}${pair}</video> -->`, `<!--->${V}${pair}</video>`, `<!---> <video controls src="../../${FILM}"></video>`,
    `<!--- <i a=' --><video title="it's>" src="../../${FILM}" controls></video>`, `<!--- ${V}${pair}</video> --->`,
    `<script><!-- x='<script>'; y='</script>'; ${pair} </script>`, `<script><!-- x='<script>'; y='</script>'; document.querySelector('video').src = '../../${FILM}';</script>`,
    `<!-->${V}${pair}</video>`, `<!--!>${pair}--!>`, `<?php ${pair} ?>`, `<![CDATA[${pair}]]>`, `</ ${pair}>`];
  for (const html of cases) refused(distRun({ 'labs/agent-space/index.html': LAB_PAGE.replace('</main>', `${html}</main>`) }), /WebM-then-MP4 <source> pairs of .*, but the build wrote|names a WebM outside the paired forms/, html);
});

// #228 item 3: spellings. A pair is counted only in its one plain form; any other spelling of a WebM path is read
// after character references, %XX escapes and control characters are spelled out, and refused.
test('fragment and query aliases, escapes, references and their compositions are refused (#228 item 3)', () => {
  const spellings = [
    `<source src="other.webm#/../../../${FILM}" type="video/webm">`, `<source src="other.webm?/../../../${FILM}" type="video/webm">`,
    `<source src="../../${FILM}#t=0" type="video/webm"><source src="../../assets/labs/agent-space/session-2026-11-08/clip.mp4#t=0" type="video/mp4">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/clip&#46;webm" type="video/webm"><source src="../../assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/clip&period;webm" type="video/webm">`, `<source src="../../assets/labs/agent-space/session-2026-11-08/clip.&#x77;ebm">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/clip%2e%77ebm">`, `<source src="../../assets/labs/agent-space/session-2026-11-08/clip&percnt;2ewebm">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/clip%2e\nWebM">`, `<source src="../../assets/labs/agent-space/session-2026-11-08/clip%2E&NewLine;WebM">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/clip.we&Tab;bm">`, `<source src="../../assets/labs/agent-space/session-2026-11-08/clip.WEBM" type="video/mp4">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/clip.web&#109" type="video/mp4">`, `<source src="../../assets/labs/agent-space/session-2026-11-08/clip.web&#X6D;">`,
    `<source src="/odin-rnd/${FILM}" type="video/webm"><source src="/odin-rnd/assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`,
    `<source src="../../assets/labs/agent-space/session-2026-11-08/./clip.webm" type="video/webm"><source src="../../assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`,
    `<source src="../../assets/x/../labs/agent-space/session-2026-11-08/clip.webm" type="video/webm"><source src="../../assets/x/../labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`,
    `<source src="../../${FILM}" type="video/webm"><source src="../../assets/labs/agent-space/session-2026-11-08/other.mp4" type="video/mp4">`,
    `<source src="../../${FILM}" type="video/webm;x=&quot;"><source src="../../assets/labs/agent-space/session-2026-11-08/clip.mp4" type="video/mp4">`];
  for (const html of spellings) refused(distRun({ 'labs/agent-space/index.html': LAB_PAGE.replace('</main>', `${html}</main>`) }), /WebM-then-MP4 <source> pairs of .*, but the build wrote|names a WebM outside the paired forms/, html);
  // Letters that only look like "webm" (fullwidth, Cyrillic) name no file a browser fetches; the English word and plain links pass.
  for (const html of ['<p>The ｗｅｂｍ letters are fullwidth.</p>', '<p>The w\u0435bm letters hold a Cyrillic e.</p>', '<p>The web makes this easy, a web model.</p>', '<p>The films are recorded as WebM, with an MP4 copy.</p>', '<p>MP4 and WebM.</p>',
    `<a href="../../${FILM}">download the film</a>`, '<p>The films are WebM files: <a href="https://example.org/f.webm">https://example.org/f.webm</a></p>', '<p title="&#99999999;">x</p>'])
    assert.ifError(distRun({ 'labs/x/index.html': html }).error);
  for (const html of ['<p>x.WebM</p>', '<p>MP4/WebM</p>', '<p>WebMs</p>', '<p>A tag in prose: &lt;video src=x.webm&gt;</p>', `<a href="../../${FILM}"><b>the film</b></a>`,
    `<a class="x" href="../../${FILM}">play</a>`, `<a href="../../${FILM}" onclick="v.src=this.href">play</a>`, `<embed src="../../${FILM}">`, `<video src="../../${FILM}"></video>`])
    refused(distRun({ 'labs/x/index.html': html }), /names a WebM outside the paired forms/, html);
});

// #228 item 4: every file of the built site is read, not only .html. JSON is data: a string there may name a WebM only
// as a plain path or URL, a WebM type or the English word, and a key also as a field name.
test('every built file is read, and JSON may name a WebM only as data (#228 item 4)', () => {
  for (const [file, text] of Object.entries({ 'player.js': `v.src = 'assets/labs/agent-space/session-2026-11-08/clip.webm';`, 'style.css': `.x { background: url(session-2026-11-08/clip.webm); }`,
    'feed.xml': `<feed><link href="clip.web&#109;"/></feed>`, 'page.htm': '<video src="f.webm"></video>', 'page.xhtml': '<video src="f.webm"/>', 'notes': 'f.webm',
    'data/x.json': JSON.stringify({ html: `<video src="${FILM}"></video>` }), 'data/y.json': JSON.stringify({ src: `${FILM}#t=1` }), 'data/z.json': `{"src": "${FILM.replace('.webm', '.we\\u0062m')}#t=1"}`,
    'data/k.json': JSON.stringify({ [`<source src="${FILM}">`]: 1 }), 'data/l.jsonl': `{"a":1}\n{"x":"see f.webm here"}\n`, 'data/broken.json': `{"src": "${FILM}"`, 'site.webmanifest': JSON.stringify({ icons: [{ src: 'f.webm#x' }] }) }))
    refused(distRun({ [file]: text }), /names a WebM/, file);
  const data = { 'data/films.json': JSON.stringify({ webm: FILM, webmSha256: 'a', mime: 'video/webm;codecs=vp9,opus', url: `https://odin-labs-ai.github.io/odin-rnd/${FILM}`, note: 'Encoded from the WebM, likeness not identity.', [`site/${FILM}`]: 'b' }),
    'data/runs.jsonl': `{"src":"${FILM}"}\n{"type":"video/webm"}\n` };
  assert.ifError(distRun(data).error);
  // Media, fonts and archives are not read: an archive downloads, it does not render.
  assert.ifError(distRun({ 'data/raw.tar.gz': 'f.webm', 'assets/x.webm': 'f.webm', 'assets/font.woff2': 'f.webm' }).error);
});

test('the dist pass refuses a published copy whose bytes are not the record\'s', () => {
  const { root } = fixture();
  const dist = mkdtempSync(join(tmpdir(), 'film-fallbacks-dist-'));
  try {
    mkdirSync(join(dist, dirname(REAL.mp4)), { recursive: true });
    const good = readFileSync(join(root, REAL.mp4)), bad = Buffer.from(good);
    bad[bad.length - 1] ^= 1;
    writeFileSync(join(dist, 'assets/labs/agent-space/session-2026-11-08/clip.mp4'), bad);
    writeFileSync(join(dist, 'index.html'), V + '<source src="assets/labs/agent-space/session-2026-11-08/clip.webm" type="video/webm"></video>');
    assert.throws(() => addFilmFallbacks({ distDir: dist, root }), /is not in .* with its recorded sha256/);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});
