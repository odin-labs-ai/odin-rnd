// Per-lab link cards (scripts/og-cards.mjs): the pure checks, the build step over a small disposable dist, and the
// committed manifest against the committed pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CARD_DIR, MANIFEST_PATH, addOgCard, addOgCardsToDist, cardAlt, cardImagePath, cardInputs, cardText, checkCardImage, checkCardText,
  checkCards, escapeRegExp, needsCard, pngSize, readManifest, sha256,
} from './og-cards.mjs';
import { addOpenGraph, addSocialCard } from './site-chrome.mjs';

/** A PNG signature and IHDR chunk of the given size: enough bytes for pngSize, not a viewable picture. */
function pngHeader(width, height, tail = 'pixels') {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return Buffer.concat([bytes, Buffer.from(tail)]);
}

const page = (title, description, extra = '') => `<!doctype html><html><head><title>${title}</title>`
  + `<meta property="og:title" content="${title}"><meta property="og:description" content="${description}">${extra}</head><body></body></html>`;
const ROGUE = page('Lab 05: can an agent go rogue? — Odin Labs R&amp;D', 'One staged poisoned ticket, run twice: &quot;no controls&quot; &amp; the guards.');

test('card text comes from the built og:title and og:description, decoded to plain text', () => {
  const inputs = cardInputs(ROGUE, 'labs/rogue/index.html');
  assert.deepEqual(inputs, { title: 'Lab 05: can an agent go rogue? — Odin Labs R&D', description: 'One staged poisoned ticket, run twice: "no controls" & the guards.' });
  assert.deepEqual(cardText(inputs), { kicker: 'Lab 05', heading: 'Can an agent go rogue?', line: inputs.description });
  assert.equal(cardAlt(inputs), 'Odin Labs R&D link card: Lab 05, Can an agent go rogue?');
  const index = cardInputs(page('Labs — Odin Labs R&amp;D', 'Long-running projects.'), 'labs/index.html');
  assert.deepEqual(cardText(index), { kicker: 'Labs', heading: 'Labs', line: 'Long-running projects.' });
  assert.equal(cardAlt(index), 'Odin Labs R&D link card: Labs');
  assert.throws(() => cardInputs(page('Lab 05: x', ''), 'labs/x/index.html'), /needs an og:description/);
  assert.throws(() => cardInputs(`${ROGUE}${ROGUE}`, 'two'), /expected one head/);
});

test('only numbered lab pages and the Labs index need a card', () => {
  assert.equal(needsCard('labs/index.html', page('Labs', 'x')), true);
  assert.equal(needsCard('labs/rogue/index.html', ROGUE), true);
  assert.equal(needsCard('labs/runs/index.html', page('Every lab run — Odin Labs R&amp;D', 'x')), false);
  assert.equal(needsCard('labs/agent-space/proofs/index.html', page('Lab 01: proofs', 'x')), false);
  assert.equal(needsCard('journal/note.html', ROGUE), false);
  assert.equal(cardImagePath('labs/rogue/index.html'), `${CARD_DIR}/rogue.png`);
  assert.equal(cardImagePath('labs/index.html'), `${CARD_DIR}/index.png`);
  assert.throws(() => cardImagePath('labs/a/b/index.html'), /no card path/);
});

test('escapeRegExp makes every metacharacter literal, backslash included', () => {
  const nasty = 'og:image\\.(a|b)*+?^${}[]';
  assert.ok(new RegExp(`^${escapeRegExp(nasty)}$`).test(nasty));
  assert.equal(new RegExp(escapeRegExp('og:image.alt')).test('og:imageXalt'), false);
});

test('pngSize reads the IHDR size and refuses anything else', () => {
  assert.deepEqual(pngSize(pngHeader(1200, 630)), { width: 1200, height: 630 });
  assert.throws(() => pngSize(Buffer.from('GIF89a, not a png at all, padded out')), /not a PNG/);
  assert.throws(() => pngSize(pngHeader(1200, 630).subarray(0, 20)), /not a PNG/);
});

test('a picture holds only with its pinned bytes at 1200x630; one flipped byte is refused', () => {
  const bytes = pngHeader(1200, 630);
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, sha256: sha256(bytes) };
  assert.deepEqual(checkCardImage(card, bytes), []);
  const flipped = Buffer.from(bytes);
  flipped[flipped.length - 1] ^= 0x01;
  assert.match(checkCardImage(card, flipped).join('\n'), /has sha256 [a-f0-9]{64}, the manifest pins/);
  const small = pngHeader(600, 315);
  assert.match(checkCardImage({ ...card, sha256: sha256(small) }, small).join('\n'), /is 600x315, not 1200x630/);
  assert.match(checkCardImage(card, undefined).join('\n'), /is missing/);
});

test('a card drawn from older text is stale', () => {
  const inputs = cardInputs(ROGUE);
  const card = { page: 'labs/rogue/index.html', ...inputs };
  assert.deepEqual(checkCardText(card, inputs), []);
  assert.match(checkCardText(card, { ...inputs, description: 'New words.' }).join('\n'), /og:description is now "New words\."/);
  assert.match(checkCardText(card, { ...inputs, title: 'Lab 05: renamed' }).join('\n'), /og:title is now "Lab 05: renamed"/);
});

test('the manifest is shape-checked', () => {
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, sha256: 'a'.repeat(64), title: 't', description: 'd' };
  const manifest = cards => ({ format: 'odin-og-cards', version: 1, width: 1200, height: 630, cards });
  assert.equal(readManifest(manifest([card])).get(card.page), card);
  assert.throws(() => readManifest({ ...manifest([card]), width: 600 }), /1200x630/);
  assert.throws(() => readManifest(manifest([card, card])), /duplicate card/);
  assert.throws(() => readManifest(manifest([{ ...card, image: 'assets/og/odin-rnd-og-image.png' }])), /must use assets\/og\/labs\/rogue\.png/);
  assert.throws(() => readManifest(manifest([{ ...card, sha256: 'XYZ' }])), /64 hex/);
  assert.throws(() => readManifest(manifest([{ ...card, description: '' }])), /nonempty description/);
});

test('addOgCard adds og:image, its size and alt text once, and refuses an authored og:image', () => {
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, ...cardInputs(ROGUE) };
  const out = addOgCard(ROGUE, card, card.page);
  const expected = ROGUE.replace('</head>', '<meta property="og:image" content="https://odin-labs-ai.github.io/odin-rnd/assets/og/labs/rogue.png">\n'
    + '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
    + '<meta property="og:image:alt" content="Odin Labs R&amp;D link card: Lab 05, Can an agent go rogue?">\n</head>');
  assert.equal(out, expected);
  assert.equal(addOgCard(out, card, card.page), out);
  const authored = page('Lab 05: x', 'y', '<meta property="og:image" content="https://example.org/a.png">');
  assert.throws(() => addOgCard(authored, card, card.page), /already carries og:image/);
  assert.throws(() => addOgCard(page('Lab 05: x', 'y', '<meta property="og:image:alt" content="z">'), card, card.page), /og:image:alt without og:image/);
});

test('after the card, the site-wide passes add no second og:image and give the large X card', () => {
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, ...cardInputs(ROGUE) };
  const out = addSocialCard(addOpenGraph(addOgCard(ROGUE, card, card.page), card.page), card.page);
  assert.equal(out.match(/property="og:image"/g).length, 1);
  assert.match(out, /og:image" content="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/assets\/og\/labs\/rogue\.png"/);
  assert.match(out, /<meta name="twitter:card" content="summary_large_image">/);
});

test('the build step checks a whole dist and fails closed with every problem', () => {
  const root = mkdtempSync(join(tmpdir(), 'og-cards-'));
  try {
    const dist = join(root, 'dist');
    const write = (path, body) => { mkdirSync(join(dist, path, '..'), { recursive: true }); writeFileSync(join(dist, path), body); };
    const labsIndex = page('Labs — Odin Labs R&amp;D', 'Long-running projects.');
    write('labs/index.html', labsIndex);
    write('labs/rogue/index.html', ROGUE);
    write('labs/runs/index.html', page('Every lab run — Odin Labs R&amp;D', 'Every run.'));
    const rogue = pngHeader(1200, 630, 'rogue');
    const index = pngHeader(1200, 630, 'index');
    write(`${CARD_DIR}/rogue.png`, rogue);
    write(`${CARD_DIR}/index.png`, index);
    const entry = (pagePath, html, bytes) => ({ page: pagePath, image: cardImagePath(pagePath), sha256: sha256(bytes), ...cardInputs(html) });
    const good = { format: 'odin-og-cards', version: 1, width: 1200, height: 630, cards: [entry('labs/index.html', labsIndex, index), entry('labs/rogue/index.html', ROGUE, rogue)] };
    assert.deepEqual(checkCards({ distDir: dist, manifest: good }), []);

    const problems = checkCards({ distDir: dist, manifest: { ...good, cards: [good.cards[0], { ...good.cards[1], page: 'labs/gone/index.html', image: cardImagePath('labs/gone/index.html') }] } });
    assert.match(problems.join('\n'), /labs\/rogue\/index\.html: lab page without a card/);
    assert.match(problems.join('\n'), /labs\/gone\/index\.html: has a card but the build made no such page/);
    assert.match(problems.join('\n'), /assets\/og\/labs\/rogue\.png: a file in the card folder that no card pins/);
    assert.match(checkCards({ distDir: dist, manifest: { ...good, cards: [...good.cards, entry('labs/runs/index.html', page('Every lab run — Odin Labs R&amp;D', 'Every run.'), rogue)] } }).join('\n'),
      /labs\/runs\/index\.html: has a card but is not a lab page/);

    const manifestPath = join(root, 'og-cards.json');
    writeFileSync(manifestPath, JSON.stringify({ ...good, cards: [good.cards[0]] }));
    assert.throws(() => addOgCardsToDist({ distDir: dist, manifestPath }), /OG cards refused[\s\S]*lab page without a card[\s\S]*node scripts\/og-cards-render\.mjs/);
    assert.equal(readFileSync(join(dist, 'labs/rogue/index.html'), 'utf8'), ROGUE);

    writeFileSync(manifestPath, JSON.stringify(good));
    addOgCardsToDist({ distDir: dist, manifestPath });
    assert.match(readFileSync(join(dist, 'labs/rogue/index.html'), 'utf8'), /og:image" content="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/assets\/og\/labs\/rogue\.png"/);
    assert.match(readFileSync(join(dist, 'labs/index.html'), 'utf8'), /assets\/og\/labs\/index\.png/);
    assert.doesNotMatch(readFileSync(join(dist, 'labs/runs/index.html'), 'utf8'), /og:image/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every committed card picture matches its pin and is a 1200x630 PNG', () => {
  const cards = readManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  assert.ok(cards.has('labs/index.html'), 'the Labs index has a card');
  assert.ok(cards.size >= 2, 'lab pages have cards');
  for (const card of cards.values()) {
    assert.deepEqual(checkCardImage(card, readFileSync(join('site', card.image))), [], card.page);
  }
});
