// Per-lab link cards (scripts/og-cards.mjs): the pure checks, the build step over a small disposable dist, and the
// committed manifest against the committed pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  CARD_DIR, MANIFEST_PATH, SITE_INDEX, addOgCard, addOgCardsToDist, cardAlt, cardImagePath, cardInputs, cardText, checkCardImage, checkCardText,
  checkCards, decodeEntities, decodePng, listedLabs, needsCard, pngSize, readHead, readManifest, sha256,
} from './og-cards.mjs';
import { addOpenGraph, addSocialCard } from './site-chrome.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A real 8-bit RGB PNG of the given size (filter 0 rows); `seed` varies the pixels so two pictures differ. */
function png(width, height, seed = 'pixels', { rows = height, depth = 8, colour = 2 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = colour;
  const rowBytes = Math.ceil((width * depth * ({ 0: 1, 2: 3, 3: 1, 6: 4 }[colour])) / 8);
  const raw = Buffer.alloc(rows * (rowBytes + 1));
  Buffer.from(seed).copy(raw, 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The old fixture shape: a signature and an IHDR of the right size, then junk. Not a picture. */
function headerOnly(width, height) {
  const bytes = Buffer.alloc(24);
  SIGNATURE.copy(bytes, 0); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return Buffer.concat([bytes, Buffer.from('not a viewable picture')]);
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
  assert.throws(() => cardInputs(`${ROGUE}${ROGUE}`, 'two'), /a <meta> after its head/);
});

const LABS = new Map([['labs/rogue/index.html', '05']]);

test('the Labs index and every lab the site index lists need a card; nothing is guessed from a title', () => {
  assert.equal(needsCard('labs/index.html', page('Labs', 'x'), LABS), true);
  assert.equal(needsCard('labs/rogue/index.html', ROGUE, LABS), true);
  assert.equal(needsCard('labs/runs/index.html', page('Every lab run — Odin Labs R&amp;D', 'x'), LABS), false);
  assert.equal(needsCard('labs/agent-space/proofs/index.html', page('Lab 01: proofs', 'x'), LABS), false);
  assert.equal(needsCard('journal/note.html', ROGUE, LABS), false);
  // A listed lab must carry its own number; an unlisted page that reads like a lab is refused, not skipped.
  assert.throws(() => needsCard('labs/rogue/index.html', page('Lab 06: can an agent go rogue?', 'x'), LABS), /is Lab 05 in data\/index\.json but its og:title is "Lab 06/);
  assert.throws(() => needsCard('labs/new/index.html', page('Lab 07: new lab', 'x'), LABS), /og:title "Lab 07: new lab" but data\/index\.json lists no such lab/);
  assert.throws(() => needsCard('labs/new/index.html', page(' lab 7 - new lab', 'x'), LABS), /lists no such lab/);
  assert.equal(cardImagePath('labs/rogue/index.html'), `${CARD_DIR}/rogue.png`);
  assert.equal(cardImagePath('labs/index.html'), `${CARD_DIR}/index.png`);
  assert.throws(() => cardImagePath('labs/a/b/index.html'), /no card path/);
});

test('the site index is read strictly', () => {
  assert.deepEqual([...listedLabs({ items: [{ type: 'lab', id: 'lab-05', href: 'labs/rogue/index.html' }, { type: 'note', id: 'n', href: 'journal/x.html' }] })], [['labs/rogue/index.html', '05']]);
  assert.throws(() => listedLabs({}), /has no items list/);
  assert.throws(() => listedLabs({ items: [{ type: 'lab', id: 'lab-05', href: 'labs/rogue/' }] }), /lists a lab as/);
  assert.throws(() => listedLabs({ items: [{ type: 'lab', id: 'lab-05', href: 'labs/rogue/index.html' }, { type: 'lab', id: 'lab-06', href: 'labs/rogue/index.html' }] }), /twice/);
});

test('pngSize reads the size of a card PNG that decodes and refuses anything else', () => {
  const good = png(1200, 630);
  assert.deepEqual(pngSize(good), { width: 1200, height: 630 });
  assert.throws(() => pngSize(Buffer.from('GIF89a, not a png at all, padded out')), /not a card PNG \(no PNG signature\)/);
  assert.throws(() => pngSize(good.subarray(0, 20)), /not a card PNG \(truncated/);
  assert.throws(() => pngSize(headerOnly(1200, 630)), /not a card PNG/);
  assert.throws(() => pngSize(good.subarray(0, good.length - 12)), /not a card PNG \(no IEND\)/);
  assert.throws(() => pngSize(Buffer.concat([good, Buffer.from('x')])), /not a card PNG \(bytes after IEND|truncated chunk\)/);
  const badCrc = Buffer.from(good); badCrc[40] ^= 0x01;
  assert.throws(() => pngSize(badCrc), /not a card PNG \(bad CRC/);
  assert.throws(() => pngSize(png(1200, 630, 'short', { rows: 629 })), /not a card PNG \(pixel data is/);
  const tiny = png(2, 1);
  assert.throws(() => pngSize(Buffer.concat([SIGNATURE, chunk('IHDR', tiny.subarray(16, 29)), chunk('IDAT', deflateSync(Buffer.from([9, 0, 0, 0, 0, 0, 0]))), chunk('IEND', Buffer.alloc(0))])), /filter type 9/);
  // Only what the renderer writes: 8-bit RGB, not interlaced, and no chunk but IHDR, IDAT and IEND.
  assert.throws(() => pngSize(png(8, 2, 'x', { depth: 1, colour: 0 })), /bit depth 1, colour type 0/);
  assert.throws(() => pngSize(png(8, 2, 'x', { colour: 3 })), /colour type 3/);
  assert.throws(() => pngSize(png(8, 2, 'x', { colour: 6 })), /colour type 6; a card is 8-bit RGB/);
  assert.throws(() => pngSize(png(8, 2, 'x', { depth: 16 })), /bit depth 16/);
  const plain = png(8, 2);
  const insert = extra => Buffer.concat([plain.subarray(0, 33), extra, plain.subarray(33)]);
  assert.throws(() => pngSize(insert(chunk('PLTE', Buffer.alloc(3)))), /a PLTE chunk; a card holds only IHDR, IDAT and IEND/);
  assert.throws(() => pngSize(insert(chunk('tRNS', Buffer.alloc(6)))), /a tRNS chunk/);
  assert.throws(() => pngSize(insert(chunk('gAMA', Buffer.alloc(4)))), /a gAMA chunk/);
  assert.throws(() => pngSize(insert(chunk('tEXt', Buffer.from('k\0v')))), /a tEXt chunk/);
});

test('decodePng undoes every row filter to the real pixels', () => {
  // 2x5 RGB; each row uses a different filter type (0 none, 1 sub, 2 up, 3 average, 4 Paeth).
  const want = [
    [10, 20, 30, 40, 50, 60], [15, 25, 35, 45, 55, 65], [200, 100, 50, 25, 12, 6], [1, 2, 3, 250, 251, 252], [99, 98, 97, 3, 2, 1],
  ];
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const raw = [];
  want.forEach((row, y) => {
    const prior = y ? want[y - 1] : [0, 0, 0, 0, 0, 0];
    const left = i => (i >= 3 ? row[i - 3] : 0);
    const upLeft = i => (i >= 3 ? prior[i - 3] : 0);
    const predict = [() => 0, i => left(i), i => prior[i], i => (left(i) + prior[i]) >> 1, i => paeth(left(i), prior[i], upLeft(i))][y];
    raw.push(y, ...row.map((value, i) => (value - predict(i) + 256) & 0xff));
  });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(5, 4); ihdr[8] = 8; ihdr[9] = 2;
  const bytes = Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
  const decoded = decodePng(bytes);
  assert.deepEqual({ width: decoded.width, height: decoded.height, channels: decoded.channels }, { width: 2, height: 5, channels: 3 });
  assert.deepEqual([...decoded.pixels], want.flat());
});

test('a picture holds only with its pinned bytes at 1200x630; one flipped byte is refused', () => {
  const bytes = png(1200, 630);
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, sha256: sha256(bytes) };
  assert.deepEqual(checkCardImage(card, bytes), []);
  const flipped = Buffer.from(bytes);
  flipped[flipped.length - 1] ^= 0x01;
  assert.match(checkCardImage(card, flipped).join('\n'), /has sha256 [a-f0-9]{64}, the manifest pins/);
  const small = png(600, 315);
  assert.match(checkCardImage({ ...card, sha256: sha256(small) }, small).join('\n'), /is 600x315, not 1200x630/);
  assert.match(checkCardImage(card, undefined).join('\n'), /is missing/);
  const fake = headerOnly(1200, 630);
  assert.match(checkCardImage({ ...card, sha256: sha256(fake) }, fake).join('\n'), /is not a card PNG/);
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
  // The card's own og:image already present: idempotent only when every companion tag is exactly what we write.
  const url = '<meta property="og:image" content="https://odin-labs-ai.github.io/odin-rnd/assets/og/labs/rogue.png">';
  assert.throws(() => addOgCard(ROGUE.replace('</head>', `${url}</head>`), card, card.page), /og:image:width is missing/);
  assert.throws(() => addOgCard(out.replace('content="630"', 'content="315"'), card, card.page), /og:image:height is "315", not "630"/);
  assert.throws(() => addOgCard(out.replace('Can an agent go rogue?">', 'Something else">'), card, card.page), /og:image:alt is "Odin Labs R&D link card: Lab 05, Something else"/);
});

test('a head is read only in the form the site writes; anything else is refused, not interpreted', () => {
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, ...cardInputs(ROGUE) };
  const ours = 'https://odin-labs-ai.github.io/odin-rnd/assets/og/labs/rogue.png';
  const tags = '<meta property="og:image" content="' + ours + '"><meta property="og:image:width" content="1200">'
    + '<meta property="og:image:height" content="630"><meta property="og:image:alt" content="Odin Labs R&amp;D link card: Lab 05, Can an agent go rogue?">';
  // eced23d9 #95/#96: the card's four tags inside a comment are not a card; the comment itself is refused.
  assert.throws(() => addOgCard(ROGUE.replace('</head>', `<!-- ${tags} --></head>`), card, card.page), /has "<!-- <meta property=\\"og:image\\"[^]*no comment/);
  // eced23d9 #6: a '>' inside a quoted value no longer cuts a tag short and hides a foreign og:image behind it.
  const quoted = ROGUE.replace('</head>', '<meta data-note=">" property="og:image" content="https://example.org/foreign.png"></head>');
  assert.throws(() => addOgCard(quoted, card, card.page), /has "<meta data-note=\\">\\" property/);
  // eced23d9 #13: the same trick on a new lab's og:title no longer makes it look unnumbered.
  const newLab = '<!doctype html><html><head><meta data-note=">" property="og:title" content="Lab 07: new lab"><meta property="og:description" content="d"></head></html>';
  assert.throws(() => needsCard('labs/new/index.html', newLab, LABS), /og-cards reads only <meta>, <link> and <title>/);
  // Single quotes, unquoted values, scripts, styles, upper-case tags: refused.
  for (const extra of ["<meta property='og:image' content='x'>", '<meta property=og:image content=x>', '<script>var a = "</head>";</script>',
    '<style>p{}</style>', '<META property="og:image" content="x">', '<meta property="og:image" content="a"b">', '<base href="/">']) {
    assert.throws(() => readHead(ROGUE.replace('</head>', `${extra}</head>`), 'p'), /og-cards reads only/, extra);
  }
  // A repeated attribute is refused, whichever comes first.
  assert.throws(() => readHead(ROGUE.replace('</head>', '<meta property="og:image" content="a" content="b"></head>'), 'p'), /content attribute twice/);
  assert.throws(() => readHead(ROGUE.replace('</head>', '<meta property="og:x" property="og:image" content="a"></head>'), 'p'), /property attribute twice/);
  // After the head: no meta anywhere (body, comment, script) and no second head.
  for (const body of ['<meta property="og:image" content="x">', `<!-- ${tags} -->`, '<script>"<meta property=og:image>"</script>', '<META\nproperty="og:image">']) {
    assert.throws(() => readHead(ROGUE.replace('<body>', `<body>${body}`), 'p'), /a <meta> after its head/, body);
  }
  assert.throws(() => readHead(ROGUE.replace('<body>', '<body><head></head>'), 'p'), /a second <head>/);
  assert.throws(() => readHead(`<!-- x -->${ROGUE}`, 'p'), /does not start with/);
  // data-property is not property and data-content is not content: exact attribute names only.
  const lookalike = '<!doctype html><html><head><meta data-property="og:title" content="Lab 08: hidden"><meta property="og:title" data-content="Lab 08: decoy" content="Lab 05: real"><meta property="og:description" content="d"></head></html>';
  assert.equal(cardInputs(lookalike, 'x').title, 'Lab 05: real');
});

test('attribute values decode only references HTML reads the same way; a spelt-out og:image is still og:image', () => {
  assert.equal(decodeEntities('R&amp;D &lt;a&gt; &quot;q&quot; &apos;s&#39; og&#58;image &#x3A;'), 'R&D <a> "q" \'s\' og:image :');
  assert.throws(() => decodeEntities('a &colon; b'), /only &amp; &lt; &gt; &quot; &apos; and numeric references/);
  assert.throws(() => decodeEntities('R&D'), /only &amp;/);
  assert.throws(() => decodeEntities('&amp'), /only &amp;/);
  assert.throws(() => decodeEntities('&#0;'), /does not read as written/);
  assert.throws(() => decodeEntities('&#x80;'), /does not read as written/);
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, ...cardInputs(ROGUE) };
  // A property written with a numeric reference is the property it decodes to.
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta property="og&#58;image" content="https://example.org/a.png"></head>'), card, card.page), /already carries og:image https:\/\/example\.org\/a\.png/);
  // Spellings a crawler might honour are refused rather than skipped.
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta property="OG:IMAGE" content="x"></head>'), card, card.page), /spells a meta property "OG:IMAGE"/);
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta property=" og:image" content="x"></head>'), card, card.page), /spells a meta property " og:image"/);
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta name="og:image" content="x"></head>'), card, card.page), /gives og:image as name=/);
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta name="twitter:image" content="x"></head>'), card, card.page), /its own twitter:image/);
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta property="og:image:url" content="x"></head>'), card, card.page), /og:image:url without og:image/);
  // A name as one token of several, or on a <link>, is refused too (eced23d9 follow-up, review 91f64642 #3).
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta property="og:image x" content="x"></head>'), card, card.page), /spells a meta property "og:image x"; write it "og:image"/);
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<meta property="x og:image" content="x"></head>'), card, card.page), /spells a meta property "x og:image"/);
  assert.throws(() => addOgCard(ROGUE.replace('</head>', '<link property="og:image" href="x"></head>'), card, card.page), /og:image on a <link property=>/);
});

test('an authored og:image cannot hide behind data-content, and an upper-case </HEAD> still takes the card', () => {
  const card = { page: 'labs/rogue/index.html', image: `${CARD_DIR}/rogue.png`, ...cardInputs(ROGUE) };
  const ours = 'https://odin-labs-ai.github.io/odin-rnd/assets/og/labs/rogue.png';
  const sneaky = ROGUE.replace('</head>', `<meta property="og:image" data-content="${ours}" content="https://example.org/foreign.png">`
    + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta property="og:image:alt" content="Odin Labs R&amp;D link card: Lab 05, Can an agent go rogue?"></head>');
  assert.throws(() => addOgCard(sneaky, card, card.page), /already carries og:image https:\/\/example\.org\/foreign\.png/);
  const upper = ROGUE.replace('</head>', '</HEAD>');
  const out = addOgCard(upper, card, card.page);
  assert.match(out, /og:image" content="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/assets\/og\/labs\/rogue\.png">[\s\S]*<\/HEAD>/);
  assert.equal(addOgCard(out, card, card.page), out);
  // Carded, plus one more og:image:* the card does not write: refused.
  assert.throws(() => addOgCard(out.replace('</HEAD>', '<meta property="og:image:type" content="image/png"></HEAD>'), card, card.page), /og:image tags the card does not write/);
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
    const indexJson = items => write(SITE_INDEX, JSON.stringify({ items }));
    indexJson([{ type: 'lab', id: 'lab-05', href: 'labs/rogue/index.html' }]);
    const rogue = png(1200, 630, 'rogue');
    const index = png(1200, 630, 'index');
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
    // A lab the index lists but the build did not make, and a page that reads like a lab the index does not list.
    indexJson([{ type: 'lab', id: 'lab-05', href: 'labs/rogue/index.html' }, { type: 'lab', id: 'lab-09', href: 'labs/missing/index.html' }]);
    write('labs/sneaky/index.html', page('Lab 10: not listed', 'x'));
    const listed = checkCards({ distDir: dist, manifest: good }).join('\n');
    assert.match(listed, /labs\/missing\/index\.html: listed but the build made no such page/);
    assert.match(listed, /labs\/sneaky\/index\.html has the og:title "Lab 10: not listed" but data\/index\.json lists no such lab/);
    rmSync(join(dist, 'labs/sneaky'), { recursive: true });
    indexJson([{ type: 'lab', id: 'lab-05', href: 'labs/rogue/index.html' }]);
    rmSync(join(dist, SITE_INDEX));
    assert.throws(() => checkCards({ distDir: dist, manifest: good }), /data\/index\.json is missing/);
    assert.throws(() => checkCards({ distDir: join(root, 'nowhere'), manifest: good }), /nowhere\/labs is missing/);
    indexJson([{ type: 'lab', id: 'lab-05', href: 'labs/rogue/index.html' }]);

    const manifestPath = join(root, 'og-cards.json');
    writeFileSync(manifestPath, JSON.stringify({ ...good, cards: [good.cards[0]] }));
    assert.throws(() => addOgCardsToDist({ distDir: dist, manifestPath }), /OG cards refused[\s\S]*lab page without a card[\s\S]*node scripts\/og-cards-render\.mjs/);
    assert.equal(readFileSync(join(dist, 'labs/rogue/index.html'), 'utf8'), ROGUE);

    // Two pages with their own og:image: both refused in one report, and no page is written (review 91f64642 #4).
    const authored = extra => (html => html.replace('</head>', `${extra}</head>`));
    write('labs/index.html', authored('<meta property="og:image" content="https://example.org/a.png">')(labsIndex));
    write('labs/rogue/index.html', authored('<meta name="twitter:image" content="https://example.org/b.png">')(ROGUE));
    writeFileSync(manifestPath, JSON.stringify(good));
    assert.throws(() => addOgCardsToDist({ distDir: dist, manifestPath }), error => /labs\/index\.html already carries og:image/.test(error.message) && /labs\/rogue\/index\.html carries its own twitter:image/.test(error.message));
    assert.doesNotMatch(readFileSync(join(dist, 'labs/index.html'), 'utf8'), /assets\/og\/labs\/index\.png/);
    write('labs/index.html', labsIndex);
    write('labs/rogue/index.html', ROGUE);
    addOgCardsToDist({ distDir: dist, manifestPath });
    assert.match(readFileSync(join(dist, 'labs/rogue/index.html'), 'utf8'), /og:image" content="https:\/\/odin-labs-ai\.github\.io\/odin-rnd\/assets\/og\/labs\/rogue\.png"/);
    assert.match(readFileSync(join(dist, 'labs/index.html'), 'utf8'), /assets\/og\/labs\/index\.png/);
    assert.doesNotMatch(readFileSync(join(dist, 'labs/runs/index.html'), 'utf8'), /og:image/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every committed card picture matches its pin and decodes as a 1200x630 card PNG', () => {
  const cards = readManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  assert.ok(cards.has('labs/index.html'), 'the Labs index has a card');
  assert.ok(cards.size >= 2, 'lab pages have cards');
  for (const card of cards.values()) {
    assert.deepEqual(checkCardImage(card, readFileSync(join('site', card.image))), [], card.page);
  }
});
