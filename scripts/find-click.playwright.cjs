// With pnpm serve running and Playwright and Chrome installed, run
// NODE_PATH="$(npm root -g)" node --test scripts/find-click.playwright.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

test('typing failover and clicking the first result once opens the field note', async t => {
  const base = process.env.RND_PREVIEW_URL || 'http://127.0.0.1:4173/odin-rnd/';
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(new URL('find/', base).href);
  const search = page.locator('#find-search');
  await search.click();
  await search.pressSequentially('failover');
  const first = page.locator('#find-results h3 a').first();
  assert.equal(await first.getAttribute('href'), '../journal/failover-results.html');
  await first.click();
  await page.waitForURL(new URL('journal/failover-results.html', base).href, { timeout: 5000 });
});
