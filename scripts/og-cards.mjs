// Per-lab link cards (rnd-nightshift-1112, og-cards): every lab page and the Labs index share with their own
// 1200x630 picture instead of the one site card. The pictures are committed PNGs under site/assets/og/labs/, drawn by
// scripts/og-cards-render.mjs from each built page's own og:title and og:description, and pinned in
// site/data/og-cards.json: the page, the picture, its sha256, and the exact text it was drawn from.
//
// The build (addOgCardsToDist, before addOpenGraphToDist in scripts/build.mjs) fails closed when:
//   - a lab page (labs/<slug>/index.html whose og:title starts "Lab <n>:") or the Labs index has no card;
//   - a card's picture is missing, its bytes do not match the pinned sha256, or it is not a 1200x630 PNG;
//   - the page's og:title or og:description no longer match the text the card was drawn from (a stale card);
//   - a PNG sits in assets/og/labs/ without a card (a foreign picture), or a card names a page that does not exist;
//   - a carded page already carries an og:image of its own.
// The fix for any of these is the same loop: `pnpm build` (refuses, naming the pages), `node scripts/og-cards-render.mjs`, `pnpm build`.
//
// Pages under labs/ that are not labs (every run, how we decide, the agent space's sub-pages) keep the site card.
// Every function below is string or bytes in, value out, except addOgCardsToDist, the only one that touches files.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

function metaProperty(head, property, label) {
  const found = [...head.matchAll(new RegExp(`<meta\\b[^>]*\\bproperty="${property.replace(/[.:]/g, '\\$&')}"[^>]*>`, 'gi'))];
  if (found.length > 1) throw new Error(`OG cards: duplicate ${property} in ${label}`);
  if (!found.length) return undefined;
  const content = found[0][0].match(/\bcontent="([^"]*)"/i)?.[1];
  if (content === undefined) throw new Error(`OG cards: ${property} needs content in ${label}`);
  return decodeEntities(content);
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

/** Width and height from a PNG's IHDR chunk; throws on anything that is not a PNG. */
export function pngSize(bytes, label = 'image') {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(`OG cards: ${label} is not a PNG`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
  if (existing === url) return html;
  if (existing !== undefined) throw new Error(`OG cards: ${label} already carries og:image ${existing}; a carded page takes its card`);
  for (const property of ['og:image:width', 'og:image:height', 'og:image:alt']) {
    if (metaProperty(head, property, label) !== undefined) throw new Error(`OG cards: ${label} carries ${property} without og:image`);
  }
  const tags = [
    `<meta property="og:image" content="${escapeAttr(url)}">`,
    `<meta property="og:image:width" content="${CARD_WIDTH}">`,
    `<meta property="og:image:height" content="${CARD_HEIGHT}">`,
    `<meta property="og:image:alt" content="${escapeAttr(cardAlt(card))}">`,
  ];
  return html.replace(head, () => head.replace('</head>', () => `${tags.join('\n')}\n</head>`));
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
