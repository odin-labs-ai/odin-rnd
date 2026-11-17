// Plain openings on every field note, and each plan paired with its result (mission rnd-site-human PR 4, 2026-11-17; the
// founder found the site "too technical / jargon" and "hard to navigate"; PLAN A4). Each note opens, right after its own
// header, with In short (two plain sentences), What we found (for a plan not run yet: what would count as a yes), Why it
// matters and a one-line Limit, then the note as its generator wrote it; the record's identifiers sit, verbatim, in closed
// "How we checked" folds (scripts/note-openings.mjs, run by scripts/site-sections.mjs, from site/data/note-openings.json).
// The same shape as scripts/lab-openings.test.mjs, for the notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { bannedIn, jargon, plainBanned } from './plain-words.mjs';
import { blockText, CHECKED_OPEN, CHECKED_SUMMARY, elementEnd, glossaryIds, pageLinks, renderOpening, resolveHref, siteReader, statesNumber } from './lab-pages.mjs';
import { foldNoteChecks, NOTE_OPENING_SECTION, NOTE_OPENINGS_CONFIG, notePairs, noteStage, openNote, openNotePages, withoutNoteOpening } from './note-openings.mjs';
import { renderJournalIndex } from './site-sections.mjs';

const config = JSON.parse(readFileSync(join('site', NOTE_OPENINGS_CONFIG), 'utf8'));
const notes = readdirSync('site/journal').filter(n => n.endsWith('.html')).map(n => `journal/${n}`).sort();
const read = siteReader('site');
const ids = glossaryIds('site');
const banned = [...jargon, ...plainBanned];
const openingOf = html => html.match(NOTE_OPENING_SECTION)?.[0];
const sample = { short: 'We asked a plain question. The answer was plain too.', found: [[{ quote: 'caught 26 of 60' }]], why: 'It helps you choose.', limit: 'Our own cases.' };
const notePage = (body, header = '<header class="article-header"><h1>A note</h1><p class="article-meta">RESEARCH NOTE</p></header>') =>
  `<!doctype html><html><body><main id="main" class="article-shell"><a class="article-back" href="../journal/">Back</a>${header}<article class="article-body">${body}</article></main></body></html>`;
const BODY = '<h2>The result</h2><p>The model caught 26 of 60 tries.</p><p>This page is rendered from results.json, whose sha256 is 1f3c2b9a8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a.</p><p>Records keep commit 3e35e4e274932a61bc0d92f378f8d506a9bb4ce0 too.</p><ul><li>One plain item.</li><li>Pinned at 55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851.</li></ul><p>The verdict stands, at commit 5d056765aa01.</p>';

test('every field note has an opening in the config, and the config names no other page', () => {
  assert.deepEqual(Object.keys(config.notes).sort(), notes);
  assert.ok(notes.length >= 24, 'twenty-four notes or more');
});

test('the opening fails closed on a note as on a lab page: a number in plain words, a quote the note does not hold, a banned word, a third sentence, a plan flag that is not true', () => {
  const pageText = 'The model caught 26 of 60 tries.';
  const render = change => renderOpening(read, 'journal/x.html', { ...sample, ...change }, { pageText, up: '../', glossaryIds: ids, shell: 'note' });
  assert.ok(render({}));
  assert.throws(() => render({ why: 'It helps you choose from 4 models.' }), /plain words state a number/);
  assert.throws(() => render({ why: 'It helps both of you choose.' }), /plain words state a number/);
  assert.throws(() => render({ found: [[{ quote: 'caught 27 of 60' }]] }), /the note no longer says|the page no longer says/);
  assert.throws(() => render({ why: 'It was pre-registered.' }), /banned lab word/);
  assert.throws(() => render({ limit: 'Our own fixtures.' }), /banned lab word/);
  assert.throws(() => render({ short: 'We asked. We answered. We said more.' }), /two sentences/);
  assert.throws(() => render({ plan: 'yes' }), /'plan' is true or absent/);
  assert.throws(() => render({ price: 'none' }), /unknown field/);
  assert.match(render({ plan: true }), /<h3 class="lab-opening-head" id="opening-found">Not run yet: what would count as a yes<\/h3>/);
  assert.match(render({}), /^<section class="note-opening lab-opening" id="in-short" aria-labelledby="in-short-title"><h2 id="in-short-title">In short<\/h2>/);
});

test('a note opens right after its own header, and taking the opening and the folds out gives back the note byte for byte', () => {
  const page = notePage(BODY);
  const out = openNote(read, 'journal/x.html', page, sample, { ids });
  const header = out.indexOf('</header>', out.indexOf('<header class="article-header"')) + '</header>'.length;
  assert.ok(out.startsWith('<section class="note-opening', header), 'the opening follows the header');
  assert.ok(out.indexOf('id="in-short"') < out.indexOf('<article class="article-body">'), 'before the note');
  assert.equal(withoutNoteOpening(out), page, 'nothing reworded or removed');
  assert.equal(foldNoteChecks(foldNoteChecks(page)), foldNoteChecks(page), 'folding twice changes nothing');
  assert.throws(() => openNote(read, 'journal/x.html', out, sample, { ids }), /already has an opening/);
  assert.match(blockText(openingOf(out)), /the record’s identifiers sit under “How we checked”/);
  const plain = notePage('<p>No identifier here.</p>');
  assert.doesNotMatch(blockText(openingOf(openNote(read, 'journal/x.html', plain, sample, { ids }))), /How we checked/, 'no fold, no promise of one');
});

test('the folds: a provenance line, a hash or a commit goes under How we checked; headings, plain lines and a verdict stay in view; a list keeps its plain items', () => {
  const out = foldNoteChecks(notePage(BODY));
  const visible = out.replace(/<details\b[\s\S]*?<\/details>/g, ' ');
  assert.match(visible, /<h2>The result<\/h2>/);
  assert.match(visible, /The model caught 26 of 60 tries\./);
  assert.match(visible, /The verdict stands, at commit 5d056765aa01\./, 'a verdict stays in view, identifiers and all');
  assert.match(visible, /<li>One plain item\.<\/li>/);
  assert.doesNotMatch(visible, /This page is rendered from/);
  assert.doesNotMatch(visible, /3e35e4e274932a61bc0d92f378f8d506a9bb4ce0|55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/);
  // The two neighbouring provenance paragraphs share one fold; the list item's text is folded inside its <li>.
  assert.equal(out.split(CHECKED_OPEN).length - 1, 2);
  assert.match(out, /<li><details class="method-details lab-checked"><summary>How we checked/);
  for (const at of [...out.matchAll(/<details class="method-details lab-checked">/g)].map(m => m.index)) {
    const fold = out.slice(at, elementEnd(out, at));
    assert.ok(fold.startsWith(CHECKED_OPEN), `each fold is titled "${CHECKED_SUMMARY}", closed`);
    assert.doesNotMatch(fold.slice(0, fold.indexOf('</summary>')), /\bopen\b/);
  }
});

test('the folds keep every committed note\'s text: unfolded, each is byte for byte the committed page, and every hash is still on it', () => {
  for (const rel of notes) {
    const page = readFileSync(join('site', rel), 'utf8');
    const folded = foldNoteChecks(page, rel);
    assert.equal(withoutNoteOpening(folded), page, `${rel}: nothing reworded or removed`);
    for (const h of page.match(/\b[0-9a-f]{40,64}\b/g) ?? []) assert.ok(folded.includes(h), `${rel}: ${h.slice(0, 12)} kept`);
    const body = folded.slice(folded.indexOf('<article class="article-body">'));
    for (const at of [...body.matchAll(/<details class="method-details lab-checked">/g)].map(m => m.index)) {
      assert.doesNotMatch(body.slice(at, elementEnd(body, at)), /<h[1-6]\b/, `${rel}: no heading inside a fold`);
    }
  }
});

test('the plain words of every opening carry no digit and no number word, and no banned lab word, quotes included; In short is two sentences', () => {
  for (const [rel, o] of Object.entries(config.notes)) {
    for (const part of ['short', 'found', 'why', 'limit']) {
      const segments = part === 'found' ? o.found.flat() : [o[part]].flat();
      for (const s of segments) {
        if (typeof s === 'string') assert.ok(!statesNumber(s), `${rel} ${part}: "${s}" states a number`);
        else assert.ok(s.quote !== undefined || s.value || s.window, `${rel} ${part}: a segment is words, a quote, a value or a window`);
        if (typeof s === 'string' || s.quote) assert.deepEqual(bannedIn(typeof s === 'string' ? s : s.quote, banned), [], `${rel} ${part}`);
      }
    }
    assert.ok(o.found.length >= 1 && o.found.length <= 3, `${rel}: one to three findings`);
    if (o.plan !== undefined) assert.equal(o.plan, true, `${rel}: plan is true or absent`);
    const short = [o.short].flat().map(s => (typeof s === 'string' ? s : s.quote)).join('');
    assert.equal(short.split(/(?<=[.?!])\s+(?=[A-Z])/).length, 2, `${rel}: In short is two sentences`);
  }
});

test('plans and results: each pair is published, each result links back to its plan in its own text, and EXP 009\'s plan is the one page whose own text never linked its result', () => {
  const pairs = notePairs(config);
  assert.ok(pairs.length >= 10);
  const unlinked = [];
  for (const p of pairs) {
    for (const href of [p.plan, p.result]) assert.ok(existsSync(join('site', href)), `${p.exp}: ${href} is published`);
    assert.ok(config.notes[p.result], `${p.exp}: its result is a field note with an opening`);
    assert.ok(pageLinks(readFileSync(join('site', p.result), 'utf8'), p.result, p.plan), `${p.result} links back to its plan ${p.plan}`);
    if (p.plan.endsWith('.html') && !pageLinks(readFileSync(join('site', p.plan), 'utf8'), p.plan, p.result)) unlinked.push(p.exp);
  }
  assert.deepEqual(unlinked, ['EXP 009'], 'the opening is the link for EXP 009; every other plan page already linked its result');
  assert.equal(config.notes['journal/composable-harness-pre-registration.html'].plan, true);
  assert.equal(noteStage('journal/composable-harness-pre-registration.html', config), 'Plan, result published');
  assert.equal(noteStage('journal/composable-harness-results.html', config), 'Result');
  assert.equal(noteStage('journal/latent-handoff-pre-registration.html', config), 'Plan, not run yet');
  assert.equal(noteStage('journal/why-open-the-floor.html', config), null);
});

test('the notes list says where each note stands in its pair, in words; without stages it is as before', () => {
  const items = [
    { type: 'note', id: 'note-a', title: 'The plan', date: '2026-10-03', stage: 'note', summary: 'Plan.', href: 'journal/composable-harness-pre-registration.html' },
    { type: 'note', id: 'note-b', title: 'The result', date: '2026-10-09', stage: 'note', summary: 'Result.', href: 'journal/composable-harness-results.html' },
  ];
  const stages = new Map(items.map(i => [i.href, noteStage(i.href, config)]));
  const html = renderJournalIndex(items, { stages });
  assert.match(html, /<span class="update-kind technical">FIELD NOTE · RESULT<\/span>/);
  assert.match(html, /<span class="update-kind technical">FIELD NOTE · PLAN, RESULT PUBLISHED<\/span>/);
  assert.equal(renderJournalIndex(items), renderJournalIndex(items, { stages: null }));
});

test('openNotePages leaves a test dist without the config\'s notes alone, and refuses an unconfigured note when required', () => {
  const dir = mkdtempSync(join(tmpdir(), 'note-openings-'));
  try {
    mkdirSync(join(dir, 'journal'));
    writeFileSync(join(dir, 'journal/other.html'), notePage('<p>x</p>'));
    assert.deepEqual(openNotePages({ distDir: dir }), []);
    assert.equal(readFileSync(join(dir, 'journal/other.html'), 'utf8'), notePage('<p>x</p>'));
    assert.throws(() => openNotePages({ distDir: dir, required: true }), /no opening for journal\/other\.html/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('as built: every note opens with the four parts in order, right after its header; plans and results link each other; the folds are closed', { timeout: 600_000 }, () => {
  const dist = join(builtCopy(), 'dist');
  assert.deepEqual(JSON.parse(readFileSync(join(dist, 'data/note-openings.json'), 'utf8')), config, 'the built data is the committed config');
  for (const rel of notes) {
    const html = readFileSync(join(dist, rel), 'utf8');
    const opening = openingOf(html);
    assert.ok(opening, `${rel}: has an opening`);
    assert.equal(html.split('id="in-short"').length - 1, 1, `${rel}: one opening`);
    // Right after the note's own header: only its "On this page" list may sit between them.
    const header = html.indexOf('</header>', html.indexOf('<header class="article-header"')) + '</header>'.length;
    const between = html.slice(header, html.indexOf(opening)).replace(/<nav class="toc[\s\S]*?<\/nav>/, '').trim();
    assert.equal(between, '', `${rel}: the opening follows the header`);
    assert.ok(html.indexOf(opening) < html.indexOf('<article class="article-body">'), `${rel}: before the note`);
    const text = blockText(opening);
    let at = -1;
    for (const part of ['In short', config.notes[rel].plan ? 'Not run yet: what would count as a yes' : 'What we found', 'Why it matters', 'Limit:']) {
      const next = text.indexOf(part, at + 1);
      assert.ok(next > at, `${rel}: "${part}" comes next`);
      at = next;
    }
    const short = blockText(opening.match(/<p class="lab-opening-short">([\s\S]*?)<\/p>/)[1]);
    assert.equal(short.split(/(?<=[.?!])\s+(?=[A-Z])/).length, 2, `${rel}: In short is two sentences`);
    assert.ok(short.split(/\s+/).length <= 60, `${rel}: In short is short`);
    assert.deepEqual(bannedIn(text, banned), [], `${rel}: no banned lab word in the opening`);
    assert.equal(opening.match(/<p class="lab-limit lab-opening-limit"><strong>Limit:<\/strong>/g)?.length, 1, `${rel}: one limit line`);
    for (const m of opening.matchAll(/\shref="([^"]+)"/g)) {
      const [path, hash] = m[1].split('#');
      const target = resolveHref(rel, path);
      assert.ok(existsSync(join(dist, target)), `${rel}: ${m[1]} lands on a built file`);
      if (hash) assert.ok(readFileSync(join(dist, target), 'utf8').includes(`id="${hash}"`), `${rel}: ${m[1]} lands on its anchor`);
    }
    for (const [phrase, entry] of Object.entries(config.notes[rel].glossary ?? {})) {
      assert.equal(opening.split(`href="../methods/#glossary-${entry}">${phrase}</a>`).length - 1, 1, `${rel}: '${phrase}' links its glossary entry at its first use`);
    }
    for (const f of html.matchAll(/<details class="method-details lab-checked">/g)) assert.ok(html.startsWith(CHECKED_OPEN, f.index), `${rel}: a closed "${CHECKED_SUMMARY}" fold`);
  }
  for (const p of notePairs(config)) {
    const result = readFileSync(join(dist, p.result), 'utf8');
    assert.ok(pageLinks(openingOf(result), p.result, p.plan), `${p.result}: its opening links its plan`);
    assert.ok(pageLinks(result, p.result, p.plan), `${p.result} links its plan`);
    if (p.plan.endsWith('.html')) {
      const plan = readFileSync(join(dist, p.plan), 'utf8');
      assert.ok(pageLinks(openingOf(plan), p.plan, p.result), `${p.plan}: its opening links its result`);
    }
  }
  const journal = readFileSync(join(dist, 'journal/index.html'), 'utf8');
  const kindOf = href => /<span class="update-kind technical">([^<]*)<\/span>/.exec(journal.split(`<a href="../${href}">`)[1] ?? '')?.[1];
  assert.match(kindOf('journal/composable-harness-pre-registration.html'), / · PLAN, RESULT PUBLISHED$/);
  assert.match(kindOf('journal/composable-harness-results.html'), / · RESULT$/);
  assert.match(kindOf('journal/latent-handoff-pre-registration.html'), / · PLAN, NOT RUN YET$/);
});
