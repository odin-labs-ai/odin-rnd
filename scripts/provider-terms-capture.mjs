// Re-read the provider terms pages the way site/data/provider-terms.json was read (vp-grow-odin-r-d bundle-2 WO-05).
//
//   PROVIDER_TERMS_PLAYWRIGHT=<dir that holds node_modules/playwright> node scripts/provider-terms-capture.mjs [--out <dir>]
//
// For each provider: a fresh headless Chromium context opens the terms url (waitUntil domcontentloaded), waits
// 4 seconds for client-side rendering, and takes document.body.innerText. It prints, per provider, the sha256 of that
// text, whether it equals the recorded textSha256, and whether every quoted passage (each part between [...] markers of a
// verbatim quote, or the closest clause a 'no clause found' quote cites between single quotes) is still in the text. With --out it
// also writes <id>.txt, so the text behind a hash can be kept. Playwright is not a dependency of this site: the
// script needs a local install and needs network, so it is a manual tool, never part of pnpm test or the build.
//
// A re-render can hash differently from the recorded one even when the terms did not change (page chrome, cookie
// banners, dynamic navigation); the quotes are the part a reader can always check against the live page.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadTerms } from './provider-terms.mjs';

/** The passages of a record's quote that must appear verbatim in the page text. */
export function quotedPassages(quote) {
  if (quote.startsWith('no clause found')) return [...quote.matchAll(/'([^']{20,})'/g)].map(m => m[1]);
  return quote.split('[...]').map(part => part.trim()).filter(part => part.length >= 20);
}

async function main() {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const dir = process.env.PROVIDER_TERMS_PLAYWRIGHT;
  if (!dir) throw new Error('set PROVIDER_TERMS_PLAYWRIGHT to a directory whose node_modules holds playwright');
  const { chromium } = createRequire(join(dir, '_.js'))('playwright');
  const terms = loadTerms();
  if (out) mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [id, entry] of Object.entries(terms.providers)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
      const text = await page.evaluate(() => document.body.innerText);
      await context.close();
      const sha = createHash('sha256').update(text).digest('hex');
      const missing = quotedPassages(entry.quote).filter(passage => !text.includes(passage));
      if (out) writeFileSync(join(out, `${id}.txt`), text);
      console.log(JSON.stringify({ id, sha256: sha, matchesRecord: sha === entry.textSha256, quotesFound: missing.length === 0, missing }));
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
