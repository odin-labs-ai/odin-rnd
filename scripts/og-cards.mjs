// Per-lab link cards (rnd-nightshift-1112, og-cards): every lab page and the Labs index share with their own
// 1200x630 picture instead of the one site card. The pictures are committed PNGs under site/assets/og/labs/, drawn by
// scripts/og-cards-render.mjs from each built page's own og:title and og:description, and pinned in
// site/data/og-cards.json: the page, the picture, its sha256, and the exact text it was drawn from.
//
// The build (addOgCardsToDist, before addOpenGraphToDist in scripts/build.mjs) fails closed when:
//   - a lab page (labs/<slug>/index.html whose og:title starts "Lab <n>:") or the Labs index has no card;
//   - a card's picture is missing, its bytes do not match the pinned sha256, or it fails the structural PNG check
//     at 1200x630 (every chunk CRC, IHDR, PLTE rules, IDAT inflating to exactly the rows the size needs, IEND; pngSize);
//   - the page's og:title or og:description no longer match the text the card was drawn from (a stale card);
//   - a PNG sits in assets/og/labs/ without a card (a foreign picture), or a card names a page that does not exist;
//   - a carded page already carries an og:image of its own, or carries the card's og:image with a missing or
//     different og:image:width/height/alt;
//   - a page states og:title/og:description in a form the reader cannot parse (it is not silently read as absent).
// What no check here proves is what a picture shows: the pin binds bytes, a person or agent viewing the card binds content.
// The fix for any of these is the same loop: `pnpm build` (refuses, naming the pages), `node scripts/og-cards-render.mjs`, `pnpm build`.
//
// Pages under labs/ that are not labs (every run, how we decide, the agent space's sub-pages) keep the site card.
// Every function below is string or bytes in, value out, except addOgCardsToDist, the only one that touches files.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

export const MANIFEST_PATH = 'site/data/og-cards.json';
export const CARD_DIR = 'assets/og/labs';
export const SITE_URL = 'https://odin-labs-ai.github.io/odin-rnd/';
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const LABS_INDEX = 'labs/index.html';
const SITE_SUFFIX = ' — Odin Labs R&D';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const toPosix = path => path.split(sep).join('/');

/** Decode the few entities the site writes in attribute values, so the manifest holds plain text. */
export function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[name]);
}

const escapeAttr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function onlyHead(html, label) {
  const heads = [...html.matchAll(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/gi)];
  if (heads.length !== 1) throw new Error(`OG cards: expected one head in ${label}, found ${heads.length}`);
  return heads[0][0];
}

/** Every regular-expression metacharacter escaped, backslash included, so a property name matches only itself. */
export const escapeRegExp = text => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** A tag's attributes as a list of [lower-case name, value], read the way HTML tokenises them (quotes, no quotes, bare). */
export function tagAttributes(tag) {
  const inner = tag.replace(/^<[a-zA-Z][^\s/>]*/, '').replace(/\/?>$/, '');
  const attrs = [];
  for (const m of inner.matchAll(/([^\s"'=<>\/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  }
  return attrs;
}

/** A meta tag's content for an exact property attribute (not data-property); several or a content-less tag throws. */
function metaProperty(head, property, label) {
  const found = [];
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = tagAttributes(tag);
    const props = attrs.filter(([name]) => name === 'property');
    if (props.length > 1) throw new Error(`OG cards: a meta tag in ${label} has more than one property attribute`);
    if (props.length && decodeEntities(props[0][1]).toLowerCase() === property.toLowerCase()) found.push(attrs);
  }
  if (found.length > 1) throw new Error(`OG cards: duplicate ${property} in ${label}`);
  if (!found.length) return undefined;
  const contents = found[0].filter(([name]) => name === 'content');
  if (contents.length !== 1) throw new Error(`OG cards: ${property} in ${label} needs exactly one content attribute`);
  return decodeEntities(contents[0][1]);
}

/** The text a card is drawn from: the built page's og:title and og:description, as plain text. */
export function cardInputs(html, label = 'page') {
  const head = onlyHead(html, label);
  const title = metaProperty(head, 'og:title', label);
  const description = metaProperty(head, 'og:description', label);
  if (!title) throw new Error(`OG cards: ${label} needs an og:title to draw its card from`);
  if (!description) throw new Error(`OG cards: ${label} needs an og:description to draw its card from`);
  return { title, description };
}

/** Whether a built page needs its own card: the Labs index, and every labs/<slug>/index.html that is a numbered lab. */
export function needsCard(page, html) {
  if (page === LABS_INDEX) return true;
  if (!/^labs\/[^/]+\/index\.html$/.test(page)) return false;
  const title = metaProperty(onlyHead(html, page), 'og:title', page);
  return /^Lab \d+:/.test(title ?? '');
}

/** What the picture shows: a kicker ("Lab 05"), a heading, and the one line under it. */
export function cardText({ title, description }) {
  const bare = title.endsWith(SITE_SUFFIX) ? title.slice(0, -SITE_SUFFIX.length) : title;
  const numbered = bare.match(/^(Lab \d+):\s*(.+)$/);
  const kicker = numbered ? numbered[1] : 'Labs';
  const heading = numbered ? numbered[2] : bare;
  return { kicker, heading: heading.charAt(0).toUpperCase() + heading.slice(1), line: description };
}

/** Alternative text that describes the picture rather than repeating the description. */
export function cardAlt(inputs) {
  const { kicker, heading } = cardText(inputs);
  return kicker === 'Labs' ? `Odin Labs R&D link card: ${heading}` : `Odin Labs R&D link card: ${kicker}, ${heading}`;
}

/** Card image file for a page: labs/rogue/index.html -> assets/og/labs/rogue.png; the Labs index -> index.png. */
export function cardImagePath(page) {
  if (page === LABS_INDEX) return `${CARD_DIR}/index.png`;
  const slug = page.match(/^labs\/([^/]+)\/index\.html$/)?.[1];
  if (!slug) throw new Error(`OG cards: no card path for ${page}`);
  return `${CARD_DIR}/${slug}.png`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = bytes => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// Bits per sample allowed per colour type (PNG spec table 11.1), and samples per pixel.
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const PNG_SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Width and height of a PNG that decodes; throws on anything else. Checks the signature, every chunk's length and
 * CRC, IHDR first with a legal depth/colour type and no interlace, at most one PLTE (before IDAT, 1-256 entries,
 * none in greyscale, required for a palette picture, and every palette index in the pixels names an entry), one run
 * of IDAT that inflates to exactly height rows of (1 filter byte + the row's pixel bytes) with legal filter types, and
 * IEND last with nothing after it. Ancillary chunks are skipped, not interpreted. It is a structural check of the PNG
 * format, not a full decoder, and it says nothing about what the picture shows.
 */
export function pngSize(bytes, label = 'image') {
  const fail = why => { throw new Error(`OG cards: ${label} is not a PNG (${why})`); };
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail('no PNG signature');
  let offset = 8;
  let header;
  let palette = false;
  let idatDone = false;
  let ended = false;
  const idat = [];
  while (offset < bytes.length) {
    if (ended) fail('bytes after IEND');
    if (offset + 12 > bytes.length) fail('truncated chunk');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length) fail(`truncated ${type} chunk`);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) fail(`bad CRC on ${type}`);
    if (!header && type !== 'IHDR') fail('IHDR is not the first chunk');
    if (type === 'IHDR') {
      if (header || length !== 13) fail('bad IHDR');
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], compression: data[10], filter: data[11], interlace: data[12] };
      if (!header.width || !header.height) fail('zero size');
      if (!PNG_DEPTHS[header.colour]?.includes(header.depth)) fail('illegal bit depth or colour type');
      if (header.compression !== 0 || header.filter !== 0) fail('unknown compression or filter method');
      if (header.interlace !== 0) fail('interlaced pictures are not accepted');
    } else if (type === 'PLTE') {
      if (palette) fail('more than one PLTE');
      if (idat.length) fail('PLTE after IDAT');
      if (header.colour === 0 || header.colour === 4) fail('PLTE in a greyscale picture');
      const entries = length / 3;
      if (!Number.isInteger(entries) || entries < 1 || entries > 256) fail(`PLTE of ${length} bytes is not 1-256 RGB entries`);
      if (header.colour === 3 && entries > 2 ** header.depth) fail(`PLTE has ${entries} entries, more than ${2 ** header.depth} for bit depth ${header.depth}`);
      palette = entries;
    } else if (type === 'IDAT') {
      if (idatDone) fail('IDAT chunks are not consecutive');
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) fail('IEND carries data');
      ended = true;
    } else if (!(type.charCodeAt(0) & 0x20)) {
      fail(`unknown critical chunk ${type}`);
    }
    if (idat.length && type !== 'IDAT') idatDone = true;
    offset += 12 + length;
  }
  if (!header) fail('no IHDR');
  if (!ended) fail('no IEND');
  if (!idat.length) fail('no IDAT');
  if (header.colour === 3 && !palette) fail('palette picture without PLTE');
  let raw;
  try { raw = inflateSync(Buffer.concat(idat)); } catch { fail('IDAT does not inflate'); }
  const rowBytes = Math.ceil((header.width * header.depth * PNG_SAMPLES[header.colour]) / 8);
  if (raw.length !== header.height * (rowBytes + 1)) fail(`pixel data is ${raw.length} bytes, ${header.height * (rowBytes + 1)} expected`);
  for (let row = 0; row < header.height; row += 1) if (raw[row * (rowBytes + 1)] > 4) fail(`row ${row} has filter type ${raw[row * (rowBytes + 1)]}`);
  if (header.colour === 3) {
    // Every palette index must name an entry. Reconstruct the rows (filters 0-4) and read each index.
    const bpp = Math.max(1, Math.ceil(header.depth / 8));
    let prior = Buffer.alloc(rowBytes);
    for (let row = 0; row < header.height; row += 1) {
      const start = row * (rowBytes + 1);
      const type = raw[start];
      const line = Buffer.from(raw.subarray(start + 1, start + 1 + rowBytes));
      for (let i = 0; i < rowBytes; i += 1) {
        const left = i >= bpp ? line[i - bpp] : 0;
        const up = prior[i];
        const upLeft = i >= bpp ? prior[i - bpp] : 0;
        let add = 0;
        if (type === 1) add = left;
        else if (type === 2) add = up;
        else if (type === 3) add = (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
          add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        line[i] = (line[i] + add) & 0xff;
      }
      for (let x = 0; x < header.width; x += 1) {
        const bit = x * header.depth;
        const index = (line[bit >> 3] >> (8 - header.depth - (bit & 7))) & ((1 << header.depth) - 1);
        if (index >= palette) fail(`pixel ${x},${row} uses palette index ${index}, the PLTE has ${palette} entries`);
      }
      prior = line;
    }
  }
  return { width: header.width, height: header.height };
}

/** Shape check of the manifest; returns the cards keyed by page. */
export function readManifest(manifest) {
  if (manifest?.format !== 'odin-og-cards' || manifest.version !== 1) throw new Error('OG cards: manifest must be format odin-og-cards, version 1');
  if (manifest.width !== CARD_WIDTH || manifest.height !== CARD_HEIGHT) throw new Error(`OG cards: manifest must declare ${CARD_WIDTH}x${CARD_HEIGHT}`);
  if (!Array.isArray(manifest.cards)) throw new Error('OG cards: manifest needs a cards list');
  const byPage = new Map();
  for (const card of manifest.cards) {
    for (const key of ['page', 'image', 'sha256', 'title', 'description']) {
      if (typeof card?.[key] !== 'string' || !card[key]) throw new Error(`OG cards: a card needs a nonempty ${key}`);
    }
    if (!/^[a-f0-9]{64}$/.test(card.sha256)) throw new Error(`OG cards: ${card.page} sha256 must be 64 hex characters`);
    if (card.image !== cardImagePath(card.page)) throw new Error(`OG cards: ${card.page} must use ${cardImagePath(card.page)}, not ${card.image}`);
    if (byPage.has(card.page)) throw new Error(`OG cards: duplicate card for ${card.page}`);
    byPage.set(card.page, card);
  }
  return byPage;
}

/** Check one card's picture bytes against its pin; returns problems (empty when it holds). */
export function checkCardImage(card, bytes) {
  if (!bytes) return [`${card.page}: picture ${card.image} is missing`];
  const problems = [];
  const actual = sha256(bytes);
  if (actual !== card.sha256) problems.push(`${card.page}: picture ${card.image} has sha256 ${actual}, the manifest pins ${card.sha256}`);
  try {
    const { width, height } = pngSize(bytes, card.image);
    if (width !== CARD_WIDTH || height !== CARD_HEIGHT) problems.push(`${card.page}: picture ${card.image} is ${width}x${height}, not ${CARD_WIDTH}x${CARD_HEIGHT}`);
  } catch (error) {
    problems.push(`${card.page}: ${error.message.replace(/^OG cards: /, '')}`);
  }
  return problems;
}

/** Check a page's current text against the text its card was drawn from. */
export function checkCardText(card, inputs) {
  const problems = [];
  if (inputs.title !== card.title) problems.push(`${card.page}: og:title is now "${inputs.title}", the card shows "${card.title}"`);
  if (inputs.description !== card.description) problems.push(`${card.page}: og:description is now "${inputs.description}", the card was drawn from "${card.description}"`);
  return problems;
}

/** Add og:image, its size and its alternative text to one page's head. Idempotent; refuses an authored og:image. */
export function addOgCard(html, card, label = 'page') {
  const head = onlyHead(html, label);
  const url = SITE_URL + card.image;
  const existing = metaProperty(head, 'og:image', label);
  const companions = { 'og:image:width': String(CARD_WIDTH), 'og:image:height': String(CARD_HEIGHT), 'og:image:alt': cardAlt(card) };
  if (existing === url) {
    // Already carded (a second run over the same dist): every companion must be present and exactly what we write.
    for (const [property, value] of Object.entries(companions)) {
      const found = metaProperty(head, property, label);
      if (found !== value) throw new Error(`OG cards: ${label} carries the card's og:image but ${property} is ${found === undefined ? 'missing' : `"${found}"`}, not "${value}"`);
    }
    return html;
  }
  if (existing !== undefined) throw new Error(`OG cards: ${label} already carries og:image ${existing}; a carded page takes its card`);
  for (const property of Object.keys(companions)) {
    if (metaProperty(head, property, label) !== undefined) throw new Error(`OG cards: ${label} carries ${property} without og:image`);
  }
  const tags = [
    `<meta property="og:image" content="${escapeAttr(url)}">`,
    `<meta property="og:image:width" content="${CARD_WIDTH}">`,
    `<meta property="og:image:height" content="${CARD_HEIGHT}">`,
    `<meta property="og:image:alt" content="${escapeAttr(cardAlt(card))}">`,
  ];
  const close = head.match(/<\/head>$/i);
  if (!close) throw new Error(`OG cards: ${label} head does not end with </head>`);
  const carded = `${head.slice(0, -close[0].length)}${tags.join('\n')}\n${close[0]}`;
  const out = html.replace(head, () => carded);
  if (metaProperty(onlyHead(out, label), 'og:image', label) !== url) throw new Error(`OG cards: ${label} did not take its card`);
  return out;
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

/**
 * Every problem with the cards of a built site, as a list (empty when every card holds). Reads the built pages and
 * the pictures in distDir, so it sees the same text and bytes a visitor gets.
 */
export function checkCards({ distDir, manifest }) {
  const cards = readManifest(manifest);
  const problems = [];
  const pages = htmlFiles(join(distDir, 'labs')).map(file => toPosix(relative(distDir, file))).sort();
  const built = new Set(pages);
  for (const page of pages) {
    const html = readFileSync(join(distDir, page), 'utf8');
    if (!needsCard(page, html)) {
      if (cards.has(page)) problems.push(`${page}: has a card but is not a lab page or the Labs index`);
      continue;
    }
    const card = cards.get(page);
    if (!card) { problems.push(`${page}: lab page without a card`); continue; }
    problems.push(...checkCardText(card, cardInputs(html, page)));
    const file = join(distDir, card.image);
    problems.push(...checkCardImage(card, existsSync(file) ? readFileSync(file) : undefined));
  }
  for (const page of cards.keys()) if (!built.has(page)) problems.push(`${page}: has a card but the build made no such page`);
  const pinned = new Set([...cards.values()].map(card => card.image));
  const cardDir = join(distDir, CARD_DIR);
  if (existsSync(cardDir)) {
    for (const name of readdirSync(cardDir).sort()) {
      if (!pinned.has(`${CARD_DIR}/${name}`)) problems.push(`${CARD_DIR}/${name}: a file in the card folder that no card pins`);
    }
  }
  return problems;
}

/** Build step: check every card, then put each one on its page. Fails closed with every problem at once. */
export function addOgCardsToDist({ distDir, manifestPath = MANIFEST_PATH }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const problems = checkCards({ distDir, manifest });
  if (problems.length) {
    throw new Error(`OG cards refused (${MANIFEST_PATH}):\n${problems.join('\n')}\nRedraw and re-pin them: node scripts/og-cards-render.mjs, then pnpm build.`);
  }
  for (const card of readManifest(manifest).values()) {
    const file = join(distDir, card.page);
    const before = readFileSync(file, 'utf8');
    const after = addOgCard(before, card, card.page);
    if (after !== before) writeFileSync(file, after);
  }
}
