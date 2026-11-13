// Draw the per-lab link cards (scripts/og-cards.mjs) and pin them in site/data/og-cards.json. Run by a person or an
// agent with a local Chrome or Chromium (CHROME_BIN, else the usual install paths). The build only checks what this
// writes; CI calls renderCards() again in scripts/og-cards-visual.test.mjs to redraw every card and compare it with the
// committed picture.
//
// The loop: `pnpm build` (refuses, naming the pages whose card is missing or stale; the lab pages are already in dist/
// by then), `node scripts/og-cards-render.mjs`, `pnpm build`. A card whose text and picture still hold is left as it is, so a re-run
// changes nothing; `node scripts/og-cards-render.mjs --all` redraws every card. A .png in site/assets/og/labs/ that no
// current lab page uses (a lab removed or renamed) is deleted, so the loop also clears the build's "no card pins" refusal.
//
// Each card is a 1200x630 page drawn from the built page's og:title and og:description only, with the site's own
// fonts and logo inlined. renderCards() drives Chrome over the DevTools protocol: it captures a card only after its
// fonts have loaded and its fitting script has finished, and only once the page shows the kicker and heading it was
// given, whole, with the given line under it (cut to whole lines with an ellipsis when it is too long to fit).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CARD_DIR, CARD_HEIGHT, CARD_WIDTH, MANIFEST_PATH, cardImagePath, cardInputs, cardText, checkCardImage, checkCardText, needsCard, readListedLabs,
  readManifest, sha256,
} from './og-cards.mjs';

/** The footer rule's top edge: the line under the heading must end above it. */
const LINE_LIMIT = 528;
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
  const LIMIT = ${LINE_LIMIT};
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

export function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(path => existsSync(path));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Draw cards in one headless Chrome over the DevTools protocol. For each card: load its page, wait until its fonts have
 * loaded and its fitting script has finished (body[data-ready]), check what the page shows, then capture exactly
 * 1200x630 CSS pixels at scale 1. Returns [{ png, layout }] in input order. Throws when Chrome is missing, a font did
 * not load, the heading or kicker is not the text it was given, the heading does not fit, or the line under it does not
 * start with the given description.
 */
export async function renderCards(jobs, { chrome = chromeBinary(), timeoutMs = 60000 } = {}) {
  if (!chrome) throw new Error('og-cards: no Chrome or Chromium found; set CHROME_BIN');
  const dir = mkdtempSync(join(tmpdir(), 'og-card-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run',
    '--no-default-browser-check', '--font-render-hinting=none', `--user-data-dir=${join(dir, 'profile')}`,
    `--window-size=${CARD_WIDTH},${CARD_HEIGHT}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  let socket;
  try {
    const portFile = join(dir, 'profile', 'DevToolsActivePort');
    const started = Date.now();
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (exited) throw new Error('og-cards: Chrome exited before it opened the DevTools port');
      if (Date.now() - started > timeoutMs) throw new Error('og-cards: Chrome opened no DevTools port within the time limit');
      await wait(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    socket = new WebSocket(`ws://127.0.0.1:${port.trim()}${path.trim()}`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('og-cards: could not reach Chrome DevTools')); });
    let id = 0;
    const pending = new Map();
    const events = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`og-cards: DevTools ${message.error.message}`)); else resolve(message.result);
      } else if (message.method) events.push(message);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const results = [];
    for (const { inputs, page } of jobs) {
      const file = join(dir, `card-${results.length}.html`);
      writeFileSync(file, cardHtml(inputs, page));
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Emulation.setDeviceMetricsOverride', { width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.enable', {}, sessionId);
      await send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `new Promise((resolve, reject) => {
          const limit = Date.now() + ${timeoutMs};
          const tick = () => {
            if (document.body && document.body.dataset.ready === '1') {
              const box = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
              const h = document.getElementById('h'); const p = document.getElementById('p');
              resolve({
                fonts: [...document.fonts].map(f => ({ family: f.family.replace(/['"]/g, ''), status: f.status })),
                kicker: document.querySelector('.kicker').textContent, heading: h.textContent, line: p.textContent,
                headingBox: box(h), lineBox: box(p), headingFontPx: parseFloat(getComputedStyle(h).fontSize),
                headingOverflows: h.scrollWidth > h.clientWidth + 1,
                lineClamp: getComputedStyle(p).webkitLineClamp, lineCut: p.scrollHeight > p.clientHeight + 1,
                viewport: { width: innerWidth, height: innerHeight },
              });
            } else if (Date.now() > limit) reject(new Error('the card never became ready'));
            else setTimeout(tick, 50);
          };
          tick();
        })`,
      }, sessionId);
      if (exceptionDetails) throw new Error(`og-cards: ${page}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      const layout = result.value;
      const want = cardText(inputs);
      const problems = [];
      if (layout.viewport.width !== CARD_WIDTH || layout.viewport.height !== CARD_HEIGHT) problems.push(`viewport ${layout.viewport.width}x${layout.viewport.height}`);
      for (const family of ['Space Grotesk', 'Manrope', 'JetBrains Mono']) {
        if (!layout.fonts.some(font => font.family === family && font.status === 'loaded')) problems.push(`font ${family} did not load`);
      }
      if (layout.kicker !== want.kicker) problems.push(`kicker shows "${layout.kicker}", not "${want.kicker}"`);
      if (layout.heading !== want.heading) problems.push(`heading shows "${layout.heading}", not "${want.heading}"`);
      if (layout.line !== want.line) problems.push(`line holds "${layout.line}", not "${want.line}"`);
      if (layout.headingOverflows) problems.push('a word of the heading is wider than its column');
      if (layout.headingBox.top < 0 || layout.headingBox.right > CARD_WIDTH || layout.headingBox.bottom > layout.lineBox.top) problems.push('heading does not sit whole above the line');
      if (layout.lineBox.bottom > LINE_LIMIT) problems.push(`line runs to ${layout.lineBox.bottom}px, past the footer rule at ${LINE_LIMIT}px`);
      if (problems.length) throw new Error(`og-cards: ${page}: ${problems.join('; ')}`);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT, scale: 1 }, captureBeyondViewport: false }, sessionId);
      await send('Target.closeTarget', { targetId });
      results.push({ png: Buffer.from(shot.data, 'base64'), layout });
    }
    return results;
  } finally {
    try { socket?.close(); } catch { /* already closed */ }
    if (!exited) { child.kill('SIGKILL'); await new Promise(resolve => (exited ? resolve() : child.once('exit', resolve))); }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

const htmlFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = process.argv.includes('--all');
  const distDir = 'dist';
  if (!existsSync(join(distDir, 'labs'))) throw new Error('og-cards: run pnpm build first; the cards are drawn from the built lab pages in dist/');
  const old = existsSync(MANIFEST_PATH) ? readManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))) : new Map();
  const labs = readListedLabs(distDir);
  const wanted = [];
  for (const page of htmlFiles(join(distDir, 'labs')).map(file => relative(distDir, file).split(sep).join('/')).sort()) {
    const html = readFileSync(join(distDir, page), 'utf8');
    if (!needsCard(page, html, labs)) continue;
    const inputs = cardInputs(html, page);
    const image = cardImagePath(page);
    const target = join('site', image);
    const previous = old.get(page);
    const holds = previous && !checkCardText(previous, inputs).length && !checkCardImage(previous, existsSync(target) ? readFileSync(target) : undefined).length;
    wanted.push({ page, inputs, image, target, redraw: all || !holds });
  }
  const redraw = wanted.filter(card => card.redraw);
  const drawn = redraw.length ? await renderCards(redraw) : [];
  redraw.forEach((card, n) => { writeFileSync(card.target, drawn[n].png); console.log(`drew ${card.image} for ${card.page}${drawn[n].layout.lineCut ? ' (the line under the heading is cut to fit)' : ''}`); });
  const cards = [];
  for (const { page, inputs, image, target } of wanted) {
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
