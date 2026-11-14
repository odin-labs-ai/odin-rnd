// What each committed link card shows (scripts/og-cards.mjs, og-cards-render.mjs). The build pins every card's bytes
// and checks that they decode as a 1200x630 RGB PNG; this test checks what the pixels say. It redraws every card in a
// real Chrome from the text the manifest pins, then compares the redraw with the committed picture in two ways:
//   - the whole card, in 8px blocks: a block "differs" when its mean luma moves by more than 16 of 255;
//   - the big outline lab number, in 8px blocks over that number's box, with a block differing at a mean luma move of
//     more than 4 (the outline is a thin, faint stroke that the whole-card limit cannot see).
// Three controls per card prove the comparison can tell what matters apart: a redraw with another card's heading, a
// redraw with the lab number one higher (numbered cards), and the next committed card.
//
// Measured on 2026-11-13/14:
//   - a redraw of the same text: whole card 0.00% of blocks on macOS Chrome, also with the card shifted by
//     (0.4px, 0.3px); 0.00% to 0.22% on ubuntu-latest Chrome against the macOS-drawn pictures (PR #230, run
//     43550080667). Number box: 0 blocks on macOS (also shifted, at most 1 block at a move of 2).
//   - another heading: 0.92% to 12.40% (ubuntu-latest), 0.94% to 12.35% (macOS);
//   - the lab number one higher: 99 to 260 blocks of the number box (macOS);
//   - Lab 03's card drawn from a description that differed only in its second sentence: 1.28% (macOS);
//   - the next committed card: 5.06% to 12.60%.
// The limits sit between those: a redraw may differ in at most 0.5% of the card and 40 blocks of the number box; each
// heading or next-card control in at least 0.75% of the card; each number control in at least 80 blocks of the number
// box. What this does not resolve: a single changed letter in the heading or the line under it.
//
// Chrome is required on GitHub Actions (ubuntu-latest ships it) and wherever OG_CARDS_RENDER_REQUIRED=1; elsewhere,
// without a Chrome, the test is skipped and says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_HEIGHT, CARD_WIDTH, MANIFEST_PATH, decodePng, readManifest } from './og-cards.mjs';
import { chromeBinary, renderCards } from './og-cards-render.mjs';

export const BLOCK = 8;
export const BLOCK_DELTA = 16;
export const NUMBER_DELTA = 4;
/** At most this share of blocks may differ between a committed card and a redraw of its own text. */
export const SAME_MAX = 0.005;
/** Every heading or next-card control must differ in at least this share of blocks. */
export const CONTROL_MIN = 0.0075;
/** At most this many number-box blocks may differ in a redraw of the same text; a number control needs at least NUMBER_CONTROL_MIN. */
export const NUMBER_SAME_MAX = 40;
export const NUMBER_CONTROL_MIN = 80;

/** Mean luma of each BLOCK x BLOCK block of a decoded 8-bit RGB picture. */
export function blockLuma({ width, height, channels, pixels }) {
  const columns = Math.floor(width / BLOCK);
  const rows = Math.floor(height / BLOCK);
  const out = new Float64Array(columns * rows);
  out.columns = columns;
  for (let y = 0; y < rows * BLOCK; y += 1) {
    for (let x = 0; x < columns * BLOCK; x += 1) {
      const i = (y * width + x) * channels;
      out[Math.floor(y / BLOCK) * columns + Math.floor(x / BLOCK)] += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / (BLOCK * BLOCK);
    }
  }
  return out;
}

/** How many blocks touching a box ({left, right, top, bottom} in pixels) differ by more than `delta`. */
export function differingInBox(a, b, box, delta) {
  assert.equal(a.length, b.length, 'pictures of different sizes');
  const columns = a.columns;
  const rows = a.length / columns;
  let differing = 0;
  for (let row = Math.max(0, Math.floor(box.top / BLOCK)); row < Math.min(rows, Math.ceil(box.bottom / BLOCK)); row += 1) {
    for (let column = Math.max(0, Math.floor(box.left / BLOCK)); column < Math.min(columns, Math.ceil(box.right / BLOCK)); column += 1) {
      if (Math.abs(a[row * columns + column] - b[row * columns + column]) > delta) differing += 1;
    }
  }
  return differing;
}

/** The share of blocks whose mean luma differs by more than BLOCK_DELTA. */
export function differingShare(a, b) {
  assert.equal(a.length, b.length, 'pictures of different sizes');
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i] - b[i]) > BLOCK_DELTA) differing += 1;
  return differing / a.length;
}

const sizeOf = image => { assert.equal(image.width, CARD_WIDTH); assert.equal(image.height, CARD_HEIGHT); return image; };

test('the block comparison sees a changed block and ignores an unchanged one', () => {
  const flat = value => ({ width: 16, height: 16, channels: 3, pixels: Buffer.alloc(16 * 16 * 3, value) });
  const a = blockLuma(flat(40));
  assert.equal(a.length, 4);
  assert.equal(differingShare(a, blockLuma(flat(40))), 0);
  assert.equal(differingShare(a, blockLuma(flat(50))), 0);
  const marked = flat(40);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) marked.pixels.fill(240, (y * 16 + x) * 3, (y * 16 + x) * 3 + 3);
  assert.equal(differingShare(a, blockLuma(marked)), 0.25);
  assert.equal(differingInBox(a, blockLuma(marked), { left: 0, right: 8, top: 0, bottom: 8 }, 16), 1);
  assert.equal(differingInBox(a, blockLuma(marked), { left: 8, right: 16, top: 0, bottom: 16 }, 16), 0);
  assert.equal(differingInBox(a, blockLuma(flat(45)), { left: 0, right: 16, top: 0, bottom: 16 }, 4), 4);
});

const chrome = chromeBinary();
const required = process.env.GITHUB_ACTIONS === 'true' || process.env.OG_CARDS_RENDER_REQUIRED === '1';

test('every committed card shows the text it is pinned to', { skip: !chrome && !required ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 600000 }, async t => {
  assert.ok(chrome, 'Chrome is required here: set CHROME_BIN or install Chrome');
  const cards = [...readManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))).values()];
  assert.ok(cards.length >= 2, 'the manifest pins cards');
  const bare = title => title.replace(/ — Odin Labs R&D$/, '').replace(/^Lab \d+:\s*/, '');
  const bump = title => title.replace(/^Lab (\d+):/, (_, n) => `Lab ${String(Number(n) + 1).padStart(n.length, '0')}:`);
  const own = cards.map(card => ({ page: card.page, inputs: { title: card.title, description: card.description } }));
  const swapped = cards.map((card, n) => {
    const other = cards[(n + 1) % cards.length];
    return { page: card.page, inputs: { title: card.title.replace(bare(card.title), bare(other.title)), description: card.description } };
  });
  const numbered = cards.filter(card => /^Lab \d+:/.test(card.title));
  const bumped = numbered.map(card => ({ page: card.page, inputs: { title: bump(card.title), description: card.description } }));
  const drawn = await renderCards([...own, ...swapped, ...bumped], { chrome });
  const blocks = (png, label) => blockLuma(sizeOf(decodePng(png, label)));
  const committed = cards.map(card => blocks(readFileSync(join('site', card.image)), card.image));
  const failures = [];
  cards.forEach((card, n) => {
    const redraw = blocks(drawn[n].png, `redraw of ${card.page}`);
    const same = differingShare(committed[n], redraw);
    const heading = differingShare(committed[n], blocks(drawn[cards.length + n].png, `heading control for ${card.page}`));
    const next = differingShare(committed[n], committed[(n + 1) % cards.length]);
    let numberLine = '';
    const k = numbered.indexOf(card);
    if (k >= 0) {
      const box = drawn[n].layout.numberBox;
      assert.ok(box, `${card.page} is numbered but its card has no number`);
      const sameNumber = differingInBox(committed[n], redraw, box, NUMBER_DELTA);
      const otherNumber = differingInBox(committed[n], blocks(drawn[2 * cards.length + k].png, `number control for ${card.page}`), box, NUMBER_DELTA);
      numberLine = `; number box: redraw ${sameNumber} blocks, number one higher ${otherNumber}`;
      if (sameNumber > NUMBER_SAME_MAX) failures.push(`${card.page}: the lab number differs from a redraw of its pinned text in ${sameNumber} blocks (limit ${NUMBER_SAME_MAX})`);
      if (otherNumber < NUMBER_CONTROL_MIN) failures.push(`${card.page}: a redraw with the next lab number differs in only ${otherNumber} number blocks; the comparison cannot tell numbers apart`);
    }
    t.diagnostic(`${card.page}: redraw differs in ${(same * 100).toFixed(2)}% of blocks; another heading ${(heading * 100).toFixed(2)}%; the next card ${(next * 100).toFixed(2)}%${numberLine}${drawn[n].layout.lineCut ? '; its line is cut to fit' : ''}`);
    if (same > SAME_MAX) failures.push(`${card.page}: the committed picture differs from a redraw of its pinned text in ${(same * 100).toFixed(2)}% of blocks (limit ${SAME_MAX * 100}%)`);
    if (heading < CONTROL_MIN) failures.push(`${card.page}: a redraw with another heading differs in only ${(heading * 100).toFixed(2)}% of blocks; the comparison cannot tell headings apart`);
    if (next < CONTROL_MIN) failures.push(`${card.page}: the next card differs in only ${(next * 100).toFixed(2)}% of blocks`);
  });
  assert.deepEqual(failures, []);
});
