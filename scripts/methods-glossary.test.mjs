// How we test (site/methods/index.html; mission rnd-site-human PR 2, 2026-11-16; the founder found the site "too
// technical / jargon" and "hard to navigate"). The page opens in plain words, then explains the lab's words in a
// glossary (#glossary, one entry per word, ids glossary-<entry>), and folds each method step's dense text under "The
// details" without deleting it. The home's "What we've found" links the first use of each lab word to its entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { builtCopy } from './test-build.mjs';
import { stripBlocks, stripTags } from './test-html-text.mjs';
import { bannedIn, jargonIn, readable } from './plain-words.mjs';
import { fillClaim } from './lab-pages.mjs';

const PAGE = 'site/methods/index.html';
const html = readFileSync(PAGE, 'utf8');

/** The glossary entries in page order: { id, term, definition (HTML of its first paragraph), body }. */
export function glossaryEntries(page) {
  const list = page.match(/<dl class="glossary-list">([\s\S]*?)<\/dl>/)?.[1] ?? '';
  return [...list.matchAll(/<div id="glossary-([a-z0-9-]+)"><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)]
    .map(([, id, term, body]) => ({ id, term: stripTags(term).trim(), definition: body.match(/^<p>([\s\S]*?)<\/p>/)?.[1] ?? '', body }));
}

/** The opening a visitor reads first: the hero and "How we test, in plain words", without the folded details. */
export function opening(page) {
  const hero = page.match(/<section class="company-hero[\s\S]*?<\/section>/)?.[0] ?? '';
  const plain = page.match(/<section\b[^>]*\sid="in-plain-words"[\s\S]*?<\/section>/)?.[0] ?? '';
  return stripBlocks(hero + plain, ['details']);
}

const sentences = text => text.trim().split(/(?<=[.!?])\s+(?=[A-Z“"])/).filter(Boolean);

test('the glossary: at least the plan\'s terms, each a plain definition of one or two sentences, ids unique', () => {
  const entries = glossaryEntries(html);
  assert.ok(entries.length >= 25, `the glossary explains the plan's terms (found ${entries.length})`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no id is used twice on the page');
  // PLAN B2's surface words, each explained by an entry (by its anchor).
  for (const id of ['station', 'pre-registered', 'counted-run', 'arm', 'seat', 'value-frontier', 'gate', 'refuted', 'fixture', 'harness',
    'broker', 'blind-run', 'source-card', 'record-hash', 'frozen-analysis', 'census', 'strict-ack', 'jev', 'laya', 'nina', 'linter',
    'green-red', 'same', 'kv-cache', 'latent-handoff', 'silent-inert', 'system-1', 'machine-names']) {
    assert.ok(entries.some(e => e.id === id), `#glossary-${id} is in the glossary`);
  }
  for (const e of entries) {
    const words = readable(e.definition).trim();
    assert.ok(words.length >= 20, `${e.term}: a definition in words`);
    assert.ok(sentences(words).length <= 2, `${e.term}: one or two sentences, found ${sentences(words).length}: ${words}`);
    const example = e.body.match(/<p class="glossary-example">([\s\S]*?)<\/p>/)?.[1];
    if (example) assert.match(example, /^<strong>Example:<\/strong> /, `${e.term}: an example is labelled as one`);
  }
  // The hash disclaimer is said once more, site-wide, in the glossary: a hash identifies bytes, not truth.
  assert.match(entries.find(e => e.id === 'record-hash').definition, /does not show that the experiment was right or that a claim is true|not that the experiment was right/);
});

test('every glossary anchor exists and is linked: the index lists each entry once, and every glossary link lands on one', () => {
  const ids = new Set(glossaryEntries(html).map(e => e.id));
  const index = html.match(/<nav class="glossary-index"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const listed = [...index.matchAll(/href="#glossary-([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.deepEqual([...listed].sort(), [...ids].sort(), 'the index links every entry, and only entries');
  assert.equal(new Set(listed).size, listed.length, 'each entry once in the index');
  // Every glossary link in the sources: the methods page itself, the home, and the findings' phrase links.
  const home = readFileSync('site/index.html', 'utf8');
  const links = [...html.matchAll(/href="#glossary-([a-z0-9-]+)"/g), ...home.matchAll(/href="methods\/#glossary-([a-z0-9-]+)"/g)].map(m => m[1]);
  const proof = JSON.parse(readFileSync('site/data/lab-proof.json', 'utf8'));
  for (const c of proof.claims) for (const [phrase, entry] of Object.entries(c.glossary ?? {})) {
    assert.ok(c.text.includes(phrase), `${c.id}: its text uses '${phrase}'`);
    links.push(entry);
  }
  assert.deepEqual(links.filter(id => !ids.has(id)), [], 'glossary links with no entry');
});

test('a finding\'s glossary phrase links once, on the home only, and a phrase the text does not use stops the build', () => {
  const claim = { id: 'c', text: 'Brokers and brokers again, a negative result.', glossary: { brokers: 'broker', 'negative result': 'refuted' } };
  const read = () => null;
  assert.equal(fillClaim(read, claim, ''), 'Brokers and brokers again, a negative result.', 'no links unless asked for (the lab on a page)');
  assert.equal(fillClaim(read, claim, '', { glossary: true }),
    'Brokers and <a class="glossary-link" href="methods/#glossary-broker">brokers</a> again, a <a class="glossary-link" href="methods/#glossary-refuted">negative result</a>.',
    'the phrase as written, first use only');
  assert.throws(() => fillClaim(read, { ...claim, glossary: { sellers: 'broker' } }, '', { glossary: true }), /not in its text/);
  assert.throws(() => fillClaim(read, { ...claim, glossary: { brokers: 'Broker A' } }, '', { glossary: true }), /not a slug/);
  assert.throws(() => fillClaim(read, { ...claim, text: 'One {n} result.', glossary: { '{n}': 'record' } }, '', { glossary: true }), /number|brace/);
});

test('the page opens in plain words: none of the banned lab words, short sentences, and the five things it must say', () => {
  const first = opening(html);
  assert.ok(first.includes('id="in-plain-words"'), 'the plain opening is on the page');
  const text = readable(first);
  assert.deepEqual(bannedIn(text), [], 'say it plainly (PLAN B3), or move the term into the glossary or the details');
  assert.deepEqual(jargonIn(text), [], 'none of the home page\'s listed lab words either');
  for (const s of sentences(readable(first.match(/<div class="company-prose method-opening">[\s\S]*$/)[0]))) {
    assert.ok(s.split(/\s+/).length <= 25, `at most about 25 words a sentence (PLAN B1): ${s}`);
  }
  // What we test, planned in writing, what a limit means, results that did not hold up, why some are exploratory.
  const heads = [...first.matchAll(/<h3>([^<]*)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(heads, ['What we test.', 'Planned in writing before it runs.', 'What a limit means.', 'When a result does not hold up.', 'Why some results are exploratory.']);
  for (const entry of ['pre-registered', 'limit', 'refuted', 'exploratory']) assert.ok(first.includes(`href="#glossary-${entry}"`), `the opening links ${entry}`);
  assert.match(text, /stays published/, 'a result that did not hold up stays published');
  assert.match(text, /not a check by an outside team/, 'a rerun by our own team is not outside replication');
});

test('nothing was deleted: the earlier opening, the dated corrections and every step stay, the dense text folded under "The details"', () => {
  assert.ok(html.includes('<p>A public number should have an inspectable method, date and source boundary.'), 'the earlier opening, folded');
  for (const date of ['2026-11-01', '2026-11-02']) assert.ok(html.includes(`<time datetime="${date}">`), `the ${date} source date`);
  assert.equal([...html.matchAll(/<time datetime="2026-11-02">/g)].length, 2, 'both 2 November 2026 notes');
  for (const id of ['pre-registration', 'freezing', 'spend', 'refutation', 'review', 'reproduce', 'limits']) {
    const section = html.match(new RegExp(`<section\\b[^>]*\\sid="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';
    assert.match(section, /<p class="method-plain">In short: /, `${id}: a plain first line`);
    assert.match(section, /<details class="method-details"><summary>The details[^<]* <span aria-hidden="true">\+<\/span><\/summary>/, `${id}: its detail folded, not deleted`);
  }
  // A dated correction is named, with its date, in the summary a reader sees closed.
  assert.match(html, /<summary>The details, and a wording correction of 2 November 2026 /);
  // The site-wide standard every page's boundary note links stays open.
  const standard = html.match(/<section\b[^>]*\sid="publication-standard"[\s\S]*?<\/section>/)[0];
  assert.ok(!standard.includes('<details'), '#publication-standard is not folded');
  assert.ok(standard.includes('A hash identifies bytes; it does not validate the experiment or establish that a claim is true.'));
});

test('as built: the home links the first use of each lab word in "What we\'ve found" to its glossary entry, and every glossary link in the site resolves', { timeout: 600_000 }, () => {
  const dist = join(builtCopy(), 'dist');
  const methods = readFileSync(join(dist, 'methods', 'index.html'), 'utf8');
  const ids = new Set(glossaryEntries(methods).map(e => e.id));
  assert.ok(ids.size >= 25, 'the built page carries the glossary');
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const at = home.search(/<section\b[^>]*\sid="findings"/);
  const findings = home.slice(at, home.indexOf('</section>', at));
  // Walk the section's text in order, noting the glossary link (if any) each piece of text sits in.
  const pieces = [];
  let link = null;
  for (const m of findings.matchAll(/(<[^>]+>)|([^<]+)/g)) {
    if (m[1]) {
      const open = /^<a\b[^>]*\shref="methods\/#glossary-([a-z0-9-]+)"/.exec(m[1]);
      if (open) link = open[1]; else if (/^<\/a>/.test(m[1])) link = null;
    } else pieces.push({ text: m[2], link });
  }
  const FIRST_USE = {
    limit: /\blimit\b/i,
    record: /\brecord\b/i,
    'pre-registered': /\bplanned in writing\b/i,
    exploratory: /\bexploratory\b/i,
    'uncertainty-range': /\buncertainty ranges?\b/i,
    broker: /\bbrokers?\b/i,
    refuted: /\bnegative result\b|\bdid not hold up\b/i,
  };
  for (const [entry, word] of Object.entries(FIRST_USE)) {
    assert.ok(ids.has(entry), `#glossary-${entry} exists`);
    const first = pieces.find(p => word.test(p.text));
    assert.ok(first, `"What we've found" uses ${word}`);
    assert.equal(first.link, entry, `the first use of ${word} links methods/#glossary-${entry}: "${first.text.trim()}"`);
  }
  // Every link to a glossary entry anywhere in the built site lands on one.
  const broken = [];
  const walk = dir => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  for (const file of walk(dist).filter(f => f.endsWith('.html'))) {
    const rel = posix.normalize(file.slice(dist.length + 1).replaceAll('\\', '/'));
    for (const m of readFileSync(file, 'utf8').matchAll(/\shref="([^"#]*)#glossary-([^"]+)"/g)) {
      const target = posix.normalize(posix.join(posix.dirname(rel), m[1] || posix.basename(rel)));
      if (!/^methods\/(?:index\.html)?$/.test(target.replace(/\/$/, '/')) || !ids.has(m[2])) broken.push(`${rel}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(broken, [], 'glossary links that do not land on an entry');
});
