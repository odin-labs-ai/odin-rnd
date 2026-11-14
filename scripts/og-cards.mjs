// Per-lab link cards (rnd-nightshift-1112, og-cards): every lab page and the Labs index share with their own
// 1200x630 picture instead of the one site card. The pictures are committed PNGs under site/assets/og/labs/, drawn by
// scripts/og-cards-render.mjs from each built page's own og:title and og:description, and pinned in
// site/data/og-cards.json: the page, the picture, its sha256, and the exact text it was drawn from.
//
// Which pages need a card is not guessed from their HTML: it is the Labs index plus every lab the build itself listed
// in dist/data/index.json (scripts/find-build.mjs; type "lab"). A page under labs/ whose og:title reads like a lab but
// that the index does not list is refused, and so is a listed lab whose og:title does not carry its own number.
//
// The head of a page this step reads is not parsed the way a browser would parse arbitrary HTML. It must be in the one
// form the site writes: `<!doctype html>`, `<html>` (optionally lang="..."), `<head>`, then only <meta>, <link> and
// <title> elements, every attribute double-quoted or bare, no '<' or '>' inside a value, every '&' one of &amp; &lt;
// &gt; &quot; &apos; &#39; or a numeric reference, then `</head>`. Anything else in that head (a comment, a script, a
// style, single quotes, an unquoted value, an unknown entity, a repeated attribute) is refused, not interpreted, so no
// text that a browser or crawler would read differently can satisfy or dodge a check. After the head, a page may hold
// no <meta> at all (not even inside a comment or a script) and no second <head>.
//
// The build (addOgCardsToDist, before addOpenGraphToDist in scripts/build.mjs) fails closed when:
//   - a lab page or the Labs index has no card, or a card names a page that is not one of them or does not exist;
//   - a card's picture is missing, its bytes do not match the pinned sha256, or it does not decode as an 8-bit RGB,
//     non-interlaced 1200x630 PNG of only IHDR, IDAT and IEND (every chunk CRC, every row's filter undone to pixels);
//   - the page's og:title or og:description no longer match the text the card was drawn from (a stale card);
//   - a file sits in assets/og/labs/ that no card pins;
//   - a carded page already carries an og:image, an og:image:* or a twitter:image of its own, or carries the card's
//     og:image with a missing or different og:image:width/height/alt;
//   - a page this step reads breaks the head form above.
// What the picture shows is checked outside the build: scripts/og-cards-visual.test.mjs redraws every card from its
// pinned text in a real Chrome (required on GitHub Actions) and compares it block by block with the committed picture,
// against controls with another heading, another lab number and another card (see that file for what it resolves).
// A missing, stale or unpinned card is fixed by `node scripts/og-cards-render.mjs` and another `pnpm build`; every
// other refusal names a page or the manifest to fix by hand.
//
// Pages under labs/ that are not labs (every run, how we decide, the agent space's sub-pages) keep the site card.
// Every function below is string or bytes in, value out, except checkCards and addOgCardsToDist, which read dist/.
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
export const SITE_INDEX = 'data/index.json';
const SITE_SUFFIX = ' — Odin Labs R&D';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const toPosix = path => path.split(sep).join('/');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * An attribute value as plain text. Only &amp; &lt; &gt; &quot; &apos; and numeric references (&#39;, &#x3a;) are
 * decoded; any other '&' throws rather than being read one way here and another way by a browser.
 */
export function decodeEntities(text, label = 'page') {
  return text.replace(/&[^;]*;?/g, ref => {
    const named = /^&([a-z]+);$/.exec(ref);
    if (named && Object.hasOwn(NAMED, named[1])) return NAMED[named[1]];
    const numeric = /^&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));$/.exec(ref);
    if (numeric) {
      const code = numeric[1] !== undefined ? Number(numeric[1]) : parseInt(numeric[2], 16);
      // NUL, C1 controls, surrogates and anything past Unicode are remapped by HTML parsers; refuse them instead.
      if (code === 0 || (code >= 0x80 && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) {
        throw new Error(`OG cards: ${label} has the character reference ${ref}, which HTML does not read as written`);
      }
      return String.fromCodePoint(code);
    }
    throw new Error(`OG cards: ${label} has "${ref.slice(0, 20)}" in an attribute; only &amp; &lt; &gt; &quot; &apos; and numeric references are read`);
  });
}

const escapeAttr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const WS = '[ \\t\\n\\r\\f]';
const PREFIX = new RegExp(`^<!doctype html>${WS}*<html(?: lang="[A-Za-z-]+")?>${WS}*<head>`, 'i');
const SPACE = new RegExp(`${WS}*`, 'y');
const TITLE = /<title>[^<]*<\/title>/y;
const VOID = new RegExp(`<(meta|link)((?:${WS}+[a-z][a-z0-9-]*(?:="[^"<>]*")?)*)${WS}*/?>`, 'y');
const ATTR = new RegExp(`${WS}+([a-z][a-z0-9-]*)(?:="([^"<>]*)")?`, 'g');
const HEAD_CLOSE = /<\/head>/iy;

/**
 * Read a page's head in the one form the site writes (see the top of this file) and return its <meta> elements as
 * { attrs: Map(name -> decoded value) }, plus where the head's closing tag starts. Throws on anything else.
 */
export function readHead(html, label = 'page') {
  const fail = why => { throw new Error(`OG cards: ${label} ${why}`); };
  const prefix = PREFIX.exec(html);
  if (!prefix) fail('does not start with <!doctype html>, <html> and <head> in the form the site writes');
  const metas = [];
  const links = [];
  let at = prefix[0].length;
  for (;;) {
    SPACE.lastIndex = at; SPACE.exec(html); at = SPACE.lastIndex;
    HEAD_CLOSE.lastIndex = at;
    if (HEAD_CLOSE.test(html)) break;
    TITLE.lastIndex = at;
    if (TITLE.test(html)) { at = TITLE.lastIndex; continue; }
    VOID.lastIndex = at;
    const tag = VOID.exec(html);
    if (!tag) {
      fail(`has ${JSON.stringify(html.slice(at, at + 40))} in its head; og-cards reads only <meta>, <link> and <title> with double-quoted or bare attributes (no comment, script, style, '<' or '>' in a value)`);
    }
    const attrs = new Map();
    for (const [, name, value] of tag[2].matchAll(ATTR)) {
      if (attrs.has(name)) fail(`has a <${tag[1]}> with the ${name} attribute twice`);
      attrs.set(name, decodeEntities(value ?? '', label));
    }
    (tag[1] === 'meta' ? metas : links).push({ attrs });
    at = VOID.lastIndex;
  }
  const rest = html.slice(at + '</head>'.length);
  if (new RegExp(`<meta(?=${WS}|/|>|$)`, 'i').test(rest)) fail('has a <meta> after its head (meta tags belong in the head, not in a comment, script or the body)');
  if (new RegExp(`<head(?=${WS}|/|>|$)`, 'i').test(rest)) fail('has a second <head>');
  return { metas, links, close: at };
}

/** The content of the one meta with exactly this property (lower case); undefined when there is none. */
function metaProperty(head, property, label) {
  const found = head.metas.filter(meta => meta.attrs.get('property') === property);
  if (found.length > 1) throw new Error(`OG cards: duplicate ${property} in ${label}`);
  if (!found.length) return undefined;
  const content = found[0].attrs.get('content');
  if (content === undefined) throw new Error(`OG cards: ${property} in ${label} needs a content attribute`);
  return content;
}

/**
 * Every og: or twitter: name must be written exactly: one token, in lower case, on a <meta>, and for og: as
 * property=. A value a crawler might read as that name in another way (padded, upper case, one token of several, on a
 * <link>) is refused rather than skipped, because the checks here would not see it.
 */
function checkMetaNames(head, label) {
  const tags = [...head.metas.map(tag => ['meta', tag]), ...head.links.map(tag => ['link', tag])];
  for (const [element, { attrs }] of tags) {
    for (const key of ['property', 'name', 'rel']) {
      const value = attrs.get(key);
      if (value === undefined) continue;
      const tokens = value.toLowerCase().split(/[ \t\n\r\f]+/).filter(Boolean);
      const named = tokens.find(token => /^(og|twitter):/.test(token));
      if (named === undefined) continue;
      if (element !== 'meta' || key === 'rel') throw new Error(`OG cards: ${label} has ${named} on a <${element} ${key}=>; it belongs on a <meta>`);
      if (value !== named) throw new Error(`OG cards: ${label} spells a meta ${key} "${value}"; write it "${named}"`);
      if (key === 'name' && named.startsWith('og:')) throw new Error(`OG cards: ${label} gives ${named} as name=, not property=`);
    }
  }
}

/** The text a card is drawn from: the built page's og:title and og:description, as plain text. */
export function cardInputs(html, label = 'page') {
  const head = readHead(html, label);
  checkMetaNames(head, label);
  const title = metaProperty(head, 'og:title', label);
  const description = metaProperty(head, 'og:description', label);
  if (!title) throw new Error(`OG cards: ${label} needs an og:title to draw its card from`);
  if (!description) throw new Error(`OG cards: ${label} needs an og:description to draw its card from`);
  return { title, description };
}

/** The lab pages the build listed in dist/data/index.json, as a Map of page -> lab number ("05"). */
export function listedLabs(index) {
  if (!Array.isArray(index?.items)) throw new Error(`OG cards: ${SITE_INDEX} has no items list`);
  const labs = new Map();
  for (const item of index.items.filter(entry => entry?.type === 'lab')) {
    const number = /^lab-(\d+)$/.exec(item.id ?? '')?.[1];
    if (!number || typeof item.href !== 'string' || !/^labs\/[^/]+\/index\.html$/.test(item.href)) {
      throw new Error(`OG cards: ${SITE_INDEX} lists a lab as ${JSON.stringify({ id: item.id, href: item.href })}`);
    }
    if (labs.has(item.href)) throw new Error(`OG cards: ${SITE_INDEX} lists ${item.href} twice`);
    labs.set(item.href, number);
  }
  return labs;
}

/**
 * Whether a built page needs its own card: the Labs index, and every lab in the site index. A listed lab's og:title
 * must start "Lab <its number>:"; an unlisted labs/<slug>/index.html whose og:title starts like a lab is refused.
 */
export function needsCard(page, html, labs) {
  if (page === LABS_INDEX) return true;
  if (!/^labs\/[^/]+\/index\.html$/.test(page)) return false;
  const head = readHead(html, page);
  checkMetaNames(head, page);
  const title = metaProperty(head, 'og:title', page) ?? '';
  const number = labs.get(page);
  if (number !== undefined) {
    if (!title.startsWith(`Lab ${number}: `)) throw new Error(`OG cards: ${page} is Lab ${number} in ${SITE_INDEX} but its og:title is "${title}"`);
    return true;
  }
  if (/^\W*lab\W*\d/i.test(title)) throw new Error(`OG cards: ${page} has the og:title "${title}" but ${SITE_INDEX} lists no such lab`);
  return false;
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
const CHANNELS = { 2: 3 };

/**
 * Decode a PNG of the one kind the card renderer writes: 8-bit RGB, not interlaced, and nothing but IHDR, IDAT and IEND
 * (no alpha, palette, gamma, colour profile or text chunk that could change what a viewer sees or carry other bytes).
 * Checks the signature, every chunk's length and CRC, IHDR first, one run of IDAT, IEND last with nothing after it,
 * then inflates the pixel data and undoes every row's filter. Returns { width, height, channels, pixels } (pixels:
 * height rows of width*3 bytes). Anything else throws.
 */
export function decodePng(bytes, label = 'image') {
  const fail = why => { throw new Error(`OG cards: ${label} is not a card PNG (${why})`); };
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail('no PNG signature');
  let offset = 8;
  let header;
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
      if (header.depth !== 8 || !CHANNELS[header.colour]) fail(`bit depth ${header.depth}, colour type ${header.colour}; a card is 8-bit RGB`);
      if (header.compression !== 0 || header.filter !== 0) fail('unknown compression or filter method');
      if (header.interlace !== 0) fail('interlaced pictures are not accepted');
    } else if (type === 'IDAT') {
      if (idatDone) fail('IDAT chunks are not consecutive');
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) fail('IEND carries data');
      ended = true;
    } else {
      fail(`a ${type} chunk; a card holds only IHDR, IDAT and IEND`);
    }
    if (idat.length && type !== 'IDAT') idatDone = true;
    offset += 12 + length;
  }
  if (!header) fail('no IHDR');
  if (!ended) fail('no IEND');
  if (!idat.length) fail('no IDAT');
  let raw;
  try { raw = inflateSync(Buffer.concat(idat)); } catch { fail('IDAT does not inflate'); }
  const channels = CHANNELS[header.colour];
  const rowBytes = header.width * channels;
  if (raw.length !== header.height * (rowBytes + 1)) fail(`pixel data is ${raw.length} bytes, ${header.height * (rowBytes + 1)} expected`);
  const pixels = Buffer.alloc(header.height * rowBytes);
  for (let row = 0; row < header.height; row += 1) {
    const type = raw[row * (rowBytes + 1)];
    if (type > 4) fail(`row ${row} has filter type ${type}`);
    const source = row * (rowBytes + 1) + 1;
    const line = row * rowBytes;
    for (let i = 0; i < rowBytes; i += 1) {
      const left = i >= channels ? pixels[line + i - channels] : 0;
      const up = row ? pixels[line - rowBytes + i] : 0;
      const upLeft = row && i >= channels ? pixels[line - rowBytes + i - channels] : 0;
      let add = 0;
      if (type === 1) add = left;
      else if (type === 2) add = up;
      else if (type === 3) add = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[line + i] = (raw[source + i] + add) & 0xff;
    }
  }
  return { width: header.width, height: header.height, channels, pixels };
}

/** Width and height of a card PNG once it has decoded (decodePng); throws on anything else. */
export function pngSize(bytes, label = 'image') {
  const { width, height } = decodePng(bytes, label);
  return { width, height };
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

/** The four tags the build writes for a card, in order; nothing else may carry og:image, og:image:* or twitter:image. */
export function cardTags(card) {
  return [
    ['og:image', SITE_URL + card.image],
    ['og:image:width', String(CARD_WIDTH)],
    ['og:image:height', String(CARD_HEIGHT)],
    ['og:image:alt', cardAlt(card)],
  ];
}

/** Add og:image, its size and its alternative text to one page's head. Idempotent; refuses an authored image. */
export function addOgCard(html, card, label = 'page') {
  const head = readHead(html, label);
  checkMetaNames(head, label);
  const tags = cardTags(card);
  for (const { attrs } of head.metas) {
    if (['name', 'property'].some(key => /^twitter:image/.test(attrs.get(key) ?? ''))) throw new Error(`OG cards: ${label} carries its own twitter:image; a carded page takes its card`);
  }
  const imageMetas = head.metas.filter(({ attrs }) => /^og:image(?::|$)/.test(attrs.get('property') ?? ''));
  if (imageMetas.length) {
    // Already carded (a second run over the same dist): exactly our four tags, each once, with our values.
    const url = tags[0][1];
    const existing = metaProperty(head, 'og:image', label);
    if (existing !== url) {
      throw new Error(existing === undefined
        ? `OG cards: ${label} carries ${imageMetas[0].attrs.get('property')} without og:image`
        : `OG cards: ${label} already carries og:image ${existing}; a carded page takes its card`);
    }
    for (const [property, value] of tags) {
      const found = metaProperty(head, property, label);
      if (found !== value) throw new Error(`OG cards: ${label} carries the card's og:image but ${property} is ${found === undefined ? 'missing' : `"${found}"`}, not "${value}"`);
    }
    if (imageMetas.length !== tags.length) throw new Error(`OG cards: ${label} carries og:image tags the card does not write`);
    return html;
  }
  const lines = tags.map(([property, value]) => `<meta property="${property}" content="${escapeAttr(value)}">`);
  const out = `${html.slice(0, head.close)}${lines.join('\n')}\n${html.slice(head.close)}`;
  const carded = readHead(out, label);
  for (const [property, value] of tags) {
    if (metaProperty(carded, property, label) !== value) throw new Error(`OG cards: ${label} did not take its card (${property})`);
  }
  return out;
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

/** The labs the build listed, read from distDir/data/index.json; a missing index is a refusal with its own message. */
export function readListedLabs(distDir) {
  const file = join(distDir, SITE_INDEX);
  if (!existsSync(file)) throw new Error(`OG cards: ${SITE_INDEX} is missing from ${distDir}; the site index (scripts/find-build.mjs) must be built first`);
  return listedLabs(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Every problem with the cards of a built site, as a list (empty when every card holds). Reads the built pages, the
 * site index and the pictures in distDir, so it sees the same text and bytes a visitor gets.
 */
export function checkCards({ distDir, manifest }) {
  const cards = readManifest(manifest);
  if (!existsSync(join(distDir, 'labs'))) throw new Error(`OG cards: ${distDir}/labs is missing; build the lab pages first`);
  const labs = readListedLabs(distDir);
  const problems = [];
  const pages = htmlFiles(join(distDir, 'labs')).map(file => toPosix(relative(distDir, file))).sort();
  const built = new Set(pages);
  for (const page of [LABS_INDEX, ...labs.keys()]) if (!built.has(page)) problems.push(`${page}: listed but the build made no such page`);
  for (const page of pages) {
    const html = readFileSync(join(distDir, page), 'utf8');
    let wanted;
    try { wanted = needsCard(page, html, labs); } catch (error) { problems.push(error.message.replace(/^OG cards: /, '')); continue; }
    if (!wanted) {
      if (cards.has(page)) problems.push(`${page}: has a card but is not a lab page or the Labs index`);
      continue;
    }
    const card = cards.get(page);
    if (!card) { problems.push(`${page}: lab page without a card`); continue; }
    try { problems.push(...checkCardText(card, cardInputs(html, page))); } catch (error) { problems.push(error.message.replace(/^OG cards: /, '')); }
    // The tags can go on this page (no own og:image, og:image:* or twitter:image): checked here, before any page is
    // written, so every refusal is reported at once.
    try { addOgCard(html, card, page); } catch (error) { problems.push(error.message.replace(/^OG cards: /, '')); }
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

/** Build step: check every card and page, then put each card on its page. Refuses with every problem at once, before writing. */
export function addOgCardsToDist({ distDir, manifestPath = MANIFEST_PATH }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const problems = checkCards({ distDir, manifest });
  if (problems.length) {
    throw new Error(`OG cards refused (${MANIFEST_PATH}):\n${problems.join('\n')}\nA missing, stale or unpinned card: node scripts/og-cards-render.mjs, then pnpm build. Any other line names a page or the manifest to fix.`);
  }
  for (const card of readManifest(manifest).values()) {
    const file = join(distDir, card.page);
    const before = readFileSync(file, 'utf8');
    const after = addOgCard(before, card, card.page);
    if (after !== before) writeFileSync(file, after);
  }
}
