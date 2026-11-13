// What each committed link card shows (scripts/og-cards.mjs, og-cards-render.mjs). The build pins every card's bytes
// and checks that they decode at 1200x630; this test checks what the pixels say. It redraws every card in a real
// Chrome from the text the manifest pins (renderCards refuses a draw whose fonts did not load or whose page does not
// show that kicker, heading and line), then compares the redraw with the committed picture block by block. Two
// controls per card prove the comparison can tell text apart: the committed picture against a redraw with another
// card's heading in place of its own, and against the next committed card.
//
// Measured on 2026-11-13 (macOS Chrome, 8px blocks, a block "differs" when its mean luma moves more than 16 of 255):
// a redraw of the same text differed in 0 blocks of 11,700, also when the whole card was shifted by a fraction of a
// pixel (0.4px, 0.3px) to stand in for another rasteriser; a description that changed only in its second sentence
// differed in 1.28% of blocks; another card in at least 5.06%. The limits below sit between those.
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
/** At most this share of blocks may differ between a committed card and a redraw of its own text. */
export const SAME_MAX = 0.002;
/** Every control must differ in at least this share of blocks. */
export const CONTROL_MIN = 0.005;

/** Mean luma of each BLOCK x BLOCK block of a decoded 8-bit RGB(A) picture. */
export function blockLuma({ width, height, channels, pixels }) {
  const columns = Math.floor(width / BLOCK);
  const rows = Math.floor(height / BLOCK);
  const out = new Float64Array(columns * rows);
  for (let y = 0; y < rows * BLOCK; y += 1) {
    for (let x = 0; x < columns * BLOCK; x += 1) {
      const i = (y * width + x) * channels;
      out[Math.floor(y / BLOCK) * columns + Math.floor(x / BLOCK)] += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / (BLOCK * BLOCK);
    }
  }
  return out;
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
});

const chrome = chromeBinary();
const required = process.env.GITHUB_ACTIONS === 'true' || process.env.OG_CARDS_RENDER_REQUIRED === '1';

test('every committed card shows the text it is pinned to', { skip: !chrome && !required ? 'no Chrome on this machine (required on GitHub Actions)' : false, timeout: 600000 }, async t => {
  assert.ok(chrome, 'Chrome is required here: set CHROME_BIN or install Chrome');
  const cards = [...readManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))).values()];
  assert.ok(cards.length >= 2, 'the manifest pins cards');
  const bare = title => title.replace(/ — Odin Labs R&D$/, '').replace(/^Lab \d+:\s*/, '');
  const own = cards.map(card => ({ page: card.page, inputs: { title: card.title, description: card.description } }));
  const swapped = cards.map((card, n) => {
    const other = cards[(n + 1) % cards.length];
    return { page: card.page, inputs: { title: card.title.replace(bare(card.title), bare(other.title)), description: card.description } };
  });
  const drawn = await renderCards([...own, ...swapped], { chrome });
  const committed = cards.map(card => blockLuma(sizeOf(decodePng(readFileSync(join('site', card.image)), card.image))));
  const failures = [];
  cards.forEach((card, n) => {
    const same = differingShare(committed[n], blockLuma(sizeOf(decodePng(drawn[n].png, `redraw of ${card.page}`))));
    const heading = differingShare(committed[n], blockLuma(sizeOf(decodePng(drawn[cards.length + n].png, `heading control for ${card.page}`))));
    const next = differingShare(committed[n], committed[(n + 1) % cards.length]);
    t.diagnostic(`${card.page}: redraw differs in ${(same * 100).toFixed(2)}% of blocks; another heading ${(heading * 100).toFixed(2)}%; the next card ${(next * 100).toFixed(2)}%${drawn[n].layout.lineCut ? '; its line is cut to fit' : ''}`);
    if (same > SAME_MAX) failures.push(`${card.page}: the committed picture differs from a redraw of its pinned text in ${(same * 100).toFixed(2)}% of blocks (limit ${SAME_MAX * 100}%)`);
    if (heading < CONTROL_MIN) failures.push(`${card.page}: a redraw with another heading differs in only ${(heading * 100).toFixed(2)}% of blocks; the comparison cannot tell headings apart`);
    if (next < CONTROL_MIN) failures.push(`${card.page}: the next card differs in only ${(next * 100).toFixed(2)}% of blocks`);
  });
  assert.deepEqual(failures, []);
});
