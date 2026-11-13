// Draw the per-lab link cards (scripts/og-cards.mjs) and pin them in site/data/og-cards.json. Run by a person or an
// agent, never by CI: it needs a local Chrome or Chromium (CHROME_BIN, else the usual install paths). The build only
// checks what this writes.
//
// The loop: `pnpm build` (refuses, naming the pages whose card is missing or stale; the lab pages are already in dist/
// by then), `node scripts/og-cards-render.mjs`, `pnpm build`. A card whose text and picture still hold is left as it is, so a re-run
// changes nothing; `node scripts/og-cards-render.mjs --all` redraws every card. A .png in site/assets/og/labs/ that no
// current lab page uses (a lab removed or renamed) is deleted, so the loop also clears the build's "no card pins" refusal.
//
// Each card is a 1200x630 page drawn from the built page's og:title and og:description only, with the site's own
// fonts and logo inlined, so the picture shows exactly the words the page states about itself.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CARD_DIR, CARD_HEIGHT, CARD_WIDTH, MANIFEST_PATH, cardImagePath, cardInputs, cardText, checkCardImage, checkCardText, needsCard, readManifest, sha256,
} from './og-cards.mjs';

const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const font = file => `data:font/woff2;base64,${readFileSync(join('site/assets/fonts', file)).toString('base64')}`;

/** The card as one self-contained HTML page (no network, no file it does not inline). */
export function cardHtml(inputs, page) {
  const { kicker, heading, line } = cardText(inputs);
  const number = kicker.match(/\d+$/)?.[0] ?? '';
  const path = page === 'labs/index.html' ? 'odin-rnd/labs/' : `odin-rnd/${page.replace(/index\.html$/, '')}`;
  const logo = readFileSync('site/assets/odin-logo.svg', 'utf8').replace(/\s(role|aria-label)="[^"]*"/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Space Grotesk';src:url('${font('SpaceGrotesk-Variable.woff2')}') format('woff2');font-weight:300 700}
@font-face{font-family:'Manrope';src:url('${font('Manrope-Variable.woff2')}') format('woff2');font-weight:200 800}
@font-face{font-family:'JetBrains Mono';src:url('${font('JetBrainsMono-Variable.woff2')}') format('woff2');font-weight:100 800}
*{box-sizing:border-box;margin:0}
html,body{width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;overflow:hidden}
body{background:#11302a;color:#f3f6ef;font-family:Manrope,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(243,246,239,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(243,246,239,.035) 1px,transparent 1px);background-size:42px 42px}
.number{position:absolute;right:40px;top:96px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:300px;line-height:1;letter-spacing:-.06em;color:transparent;-webkit-text-stroke:2px rgba(255,122,69,.28)}
.top{position:absolute;left:48px;right:48px;top:34px;height:70px;display:flex;align-items:center;gap:16px;border-bottom:1px solid rgba(243,246,239,.16);padding-bottom:4px}
.top svg{width:40px;height:44px}
.brand{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:400;letter-spacing:-.01em}
.main{position:absolute;left:48px;top:150px;width:${number ? 740 : 1060}px}
.kicker{font-family:'JetBrains Mono',monospace;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#ff7a45;margin-bottom:22px}
h1{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:-.035em;line-height:1.06;font-size:66px;text-wrap:balance}
p{margin-top:26px;font-size:27px;line-height:1.4;color:#b9cdc2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.foot{position:absolute;left:48px;right:48px;bottom:30px;padding-top:18px;border-top:1px solid rgba(243,246,239,.16);display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:18px;color:#9fb7aa;letter-spacing:.02em}
</style></head><body>
<div class="grid"></div>${number ? `<div class="number">${escapeHtml(number)}</div>` : ''}
<div class="top">${logo}<span class="brand">OdinLabs / R&amp;D</span></div>
<div class="main"><div class="kicker">${escapeHtml(kicker)}</div><h1 id="h">${escapeHtml(heading)}</h1><p id="p">${escapeHtml(line)}</p></div>
<div class="foot"><span>${escapeHtml(path)}</span><span>Odin Labs R&amp;D · Labs</span></div>
<script>
document.fonts.ready.then(() => {
  // The heading takes at most three lines; then it shrinks (not below 44px) until the whole line under it clears
  // the footer rule. Only if even that fails is the line cut to the whole lines that fit, the rest ellipsised.
  const h = document.getElementById('h');
  const p = document.getElementById('p');
  const LIMIT = 528;
  let size = 66;
  const setSize = value => { size = value; h.style.fontSize = value + 'px'; };
  while (size > 40 && h.getBoundingClientRect().height > size * 1.06 * 3 + 2) setSize(size - 2);
  p.style.webkitLineClamp = 'unset';
  while (size > 44 && p.getBoundingClientRect().bottom > LIMIT) setSize(size - 2);
  let lines = 4;
  p.style.webkitLineClamp = String(lines);
  while (lines > 1 && p.getBoundingClientRect().bottom > LIMIT) { lines -= 1; p.style.webkitLineClamp = String(lines); }
  document.body.dataset.ready = '1';
});
</script></body></html>`;
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error('og-cards: no Chrome or Chromium found; set CHROME_BIN');
  return found;
}

const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const complete = file => existsSync(file) && readFileSync(file).subarray(-8).equals(IEND);

/** Headless Chrome may linger after writing its screenshot, so wait for a complete PNG, then stop it. */
async function render(html, out, chrome) {
  const dir = mkdtempSync(join(tmpdir(), 'og-card-'));
  try {
    const file = join(dir, 'card.html');
    const shot = join(dir, 'card.png');
    writeFileSync(file, html);
    const child = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(dir, 'profile')}`, `--window-size=${CARD_WIDTH},${CARD_HEIGHT}`, '--virtual-time-budget=4000',
      `--screenshot=${shot}`, pathToFileURL(file).href,
    ], { stdio: 'ignore' });
    let exited = false;
    child.on('exit', () => { exited = true; });
    const started = Date.now();
    while (!complete(shot)) {
      if (exited && !complete(shot)) throw new Error(`og-cards: Chrome exited without a screenshot for ${out}`);
      if (Date.now() - started > 60000) { child.kill('SIGKILL'); throw new Error(`og-cards: no screenshot after 60 s for ${out}`); }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    writeFileSync(out, readFileSync(shot));
    if (!exited) { child.kill('SIGKILL'); await new Promise(resolve => (exited ? resolve() : child.once('exit', resolve))); }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

const htmlFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
});

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = process.argv.includes('--all');
  const distDir = 'dist';
  if (!existsSync(join(distDir, 'labs'))) throw new Error('og-cards: run pnpm build first; the cards are drawn from the built lab pages in dist/');
  const old = existsSync(MANIFEST_PATH) ? readManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))) : new Map();
  const chrome = chromeBinary();
  const cards = [];
  for (const page of htmlFiles(join(distDir, 'labs')).map(file => relative(distDir, file).split(sep).join('/')).sort()) {
    const html = readFileSync(join(distDir, page), 'utf8');
    if (!needsCard(page, html)) continue;
    const inputs = cardInputs(html, page);
    const image = cardImagePath(page);
    const target = join('site', image);
    const previous = old.get(page);
    const holds = previous && !checkCardText(previous, inputs).length && !checkCardImage(previous, existsSync(target) ? readFileSync(target) : undefined).length;
    if (all || !holds) {
      await render(cardHtml(inputs, page), target, chrome);
      console.log(`drew ${image} for ${page}`);
    }
    const bytes = readFileSync(target);
    const problems = checkCardImage({ page, image, sha256: sha256(bytes) }, bytes);
    if (problems.length) throw new Error(`og-cards: ${problems.join('; ')}`);
    cards.push({ page, image, sha256: sha256(bytes), title: inputs.title, description: inputs.description });
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ format: 'odin-og-cards', version: 1, width: CARD_WIDTH, height: CARD_HEIGHT, cards }, null, 1)}\n`);
  console.log(`pinned ${cards.length} cards in ${MANIFEST_PATH}`);
  const pinned = new Set(cards.map(card => card.image));
  const cardDir = join('site', CARD_DIR);
  for (const name of existsSync(cardDir) ? readdirSync(cardDir).sort() : []) {
    if (pinned.has(`${CARD_DIR}/${name}`)) continue;
    if (!name.endsWith('.png')) throw new Error(`og-cards: ${CARD_DIR}/${name} is not a card picture; move it out of the card folder by hand`);
    unlinkSync(join(cardDir, name));
    console.log(`removed ${CARD_DIR}/${name}: no lab page uses it`);
  }
}
