import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROOFS_PAGE, proofIndex, proofProblems, renderProofs, stillFor } from './lab-proofs.mjs';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDispatches, renderLabs } from './labs.mjs';

// The proof-card explorer (founder plan 8): every proof id a published dispatch shows has an entry with its record
// exactly as published. These tests read the committed dispatches; the edits are made in memory on copies.
const dispatches = readDispatches();
const pages = renderLabs();
const page = pages[PROOFS_PAGE];
const unescape = v => v.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');

test('every proof id a published dispatch shows has an entry, and every field in it is the published string', () => {
  assert.ok(dispatches.length > 0, 'a dispatch is published');
  assert.deepEqual(proofProblems(page, dispatches), []);
  const ids = [...proofIndex(dispatches).keys()];
  assert.ok(ids.includes('juno-381dbb-1'));
  for (const id of ids) assert.match(page, new RegExp(`<article class="proof-entry" id="proof-${id}"`), id);
  for (const d of dispatches) for (const q of d.questions) for (const name of ['to', 'text', 'answer', 'why', 'source', 'evidence']) {
    const m = page.match(new RegExp(`<span data-field="${d.session}/${q.id}/${name}">([^<]*)</span>`));
    assert.ok(m, `${d.session}/${q.id}/${name} is shown`);
    assert.equal(unescape(m[1]), q[name], `${d.session}/${q.id}/${name} is byte for byte the published text`);
  }
  assert.match(page, /Every answer has a card that says where it came from\. Here are all of them/);
});

test('a proof cited on two cards shows both, each with its own still; a still is shown only when published', () => {
  const odin = page.slice(page.indexOf('id="proof-odin-381dbb-1"'), page.indexOf('</article>', page.indexOf('id="proof-odin-381dbb-1"')));
  assert.match(odin, /Shown on 2 cards\./);
  assert.match(odin, /stills\/01-s1-q1\.png/);
  assert.match(odin, /stills\/04-s1-q4\.png/);
  assert.match(odin, / · a follow-up/);
  const noStills = dispatches.map(d => ({ ...d, stills: [] }));
  assert.doesNotMatch(renderProofs(noStills), /<img /);
  assert.match(renderProofs(noStills), /In the <a href="[^"]+clip\.webm">session recording<\/a>/);
  assert.match(renderProofs([]), /NO PROOF CARD YET/);
});

test('the gate refuses a changed field, a missing entry, an extra entry and a screened word', () => {
  const swap = (from, to) => page.replace(from, to);
  const q = dispatches[0].questions[2];
  const key = `${dispatches[0].session}/${q.id}`;
  const cases = [
    [swap(`<span data-field="${key}/answer">`, `<span data-field="${key}/answer">Edited. `), new RegExp(`${key}/answer is not the published text`)],
    [swap(`<span data-field="${key}/why">`, `<span data-field="${key}/whyx">`), new RegExp(`${key}/why \\(proof ${q.evidence}\\) is not shown`)],
    [swap(`id="proof-${q.evidence}"`, `id="proof-${q.evidence}-gone"`), new RegExp(`proof ${q.evidence} has no entry[\\s\\S]*an entry for proof ${q.evidence}-gone`)],
    [swap('Every proof card.', `Every proof card, filmed in ${[...'nrooH'].reverse().join('')}.`), /a place name in "Every proof card, filmed in/],
    [swap('Back to Lab 01', 'See config.py'), /a file path or file name in "See config\.py"/],
  ];
  for (const [html, expected] of cases) assert.match(proofProblems(html, dispatches).join('\n'), expected, String(expected));
});

test('the dispatch cards and the story page link each proof to its entry, and the Lab 01 page links the explorer', () => {
  const lab = pages['labs/agent-space/index.html'];
  for (const id of proofIndex(dispatches).keys()) assert.match(lab, new RegExp(`<a href="proofs/#proof-${id}"><code>evidence ${id}</code></a>`), id);
  assert.match(lab, /<a href="proofs\/">Every proof card, in one place\.<\/a>/);
  const story = pages['labs/agent-space/story/index.html'];
  const storyProofs = [...story.matchAll(/<a href="\.\.\/proofs\/#proof-([a-z0-9-]+)">proof <code>([a-z0-9-]+)<\/code><\/a>/g)];
  assert.ok(storyProofs.length > 0, 'the story cites proofs');
  for (const [, anchor, id] of storyProofs) { assert.equal(anchor, id); assert.match(page, new RegExp(`id="proof-${id}"`), id); }
  assert.ok(readFileSync('site/sitemap.xml', 'utf8').includes('<loc>https://odin-labs-ai.github.io/odin-rnd/labs/agent-space/proofs/</loc>'));
});

// Review 1 of #103: each case passed the first gate.
test('the screen covers the whole body (header, footer, alt text) and a page without body or main fails closed', () => {
  const town = [...'nrooH'].reverse().join('');
  assert.match(proofProblems(page.replace('>Contact Odin<', `>Contact Odin in ${town}<`), dispatches).join('\n'), /a place name in "/);
  assert.match(proofProblems(page.replace('alt="The moment in the recording', `alt="Seen in ${town}, the moment`), dispatches).join('\n'), /a place name in "Seen in/);
  assert.match(proofProblems(page.replace('<main id="main">', '<div id="main">').replace('</main>', '</div>'), dispatches).join('\n'), /no <main in the page; nothing can be checked/);
});

test('each question shows exactly its published still, and nothing else; the still rule is stills/NN-<question id>.png', () => {
  const d = dispatches[0], q = d.questions[0], key = `${d.session}/${q.id}`;
  const other = d.stills.find(s => s !== stillFor(d, q));
  assert.match(proofProblems(page.replace(`data-still="${key}" src="../../../${stillFor(d, q)}"`, `data-still="${key}" src="../../../${other}"`), dispatches).join('\n'), new RegExp(`${key} does not show exactly its published still`));
  assert.match(proofProblems(page.replace('<main id="main">', '<main id="main"><img src="../../../assets/odin-logo.svg" alt="">'), dispatches).join('\n'), /an image that is not a dispatch still/);
  const without = dispatches.map(x => ({ ...x, stills: x.stills.filter(s => !s.endsWith(`-${q.id}.png`)) }));
  assert.match(proofProblems(page, without).join('\n'), new RegExp(`${key} shows a still, but its dispatch publishes none for it`));
  assert.equal(stillFor({ stills: ['assets/x/stills/01-xs1-q1.png'] }, { id: 's1-q1' }), null, 'a longer name ending in the id is not its still');
  assert.equal(stillFor({ stills: ['assets/x/stills/01-s1-q1.png', 'assets/x/stills/02-s1-q1.png'] }, { id: 's1-q1' }), null, 'two candidates are not one still');
});

test('the Lab 01 link to the explorer appears only when the explorer is rendered', () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-proofs-'));
  try {
    for (const dir of ['labs', 'data/labs']) mkdirSync(join(root, dir), { recursive: true });
    cpSync('site/labs', join(root, 'labs'), { recursive: true, filter: src => !src.includes('labs/agent-space/story') && !src.includes('labs/agent-space/proofs') });
    cpSync('site/data/labs/agent-space.json', join(root, 'data/labs/agent-space.json'));
    cpSync('site/data/labs/delivery', join(root, 'data/labs/delivery'), { recursive: true });
    const lab = renderLabs(root)['labs/agent-space/index.html'];
    assert.doesNotMatch(lab, /href="proofs\//);
    assert.match(pages['labs/agent-space/index.html'], /<a href="proofs\/">Every proof card, in one place\.<\/a>/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
