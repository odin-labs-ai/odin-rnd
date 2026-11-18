// Browser DOM oracle for built-page tests. The card renderer already requires Chrome in CI and supplies its binary
// lookup; this helper uses the same headless DevTools path for text, layout and resolved-link assertions.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromeBinary } from './og-cards-render.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Each job has `file` or fixture `html`, plus a browser expression whose result is returned by value. It may set a viewport.
 * Built pages use the site's loopback server so their ES modules load as they do on Pages. */
export async function inspectDom(jobs, { chrome = chromeBinary(), siteRoot, timeoutMs = 30000 } = {}) {
  for (const job of jobs) {
    const hasFile = typeof job.file === 'string' && job.file.length > 0;
    const hasHtml = typeof job.html === 'string';
    if (hasFile === hasHtml) throw new Error('Each Chrome job must have exactly one file or HTML fixture');
    if (hasFile && !siteRoot) throw new Error('siteRoot is required for built-page browser checks');
    if (hasFile) {
      const rel = relative(siteRoot, job.file).split(sep).join('/');
      if (rel.startsWith('../') || rel === '..') throw new Error(`Built page outside siteRoot: ${job.file}`);
    }
  }
  if (!chrome) throw new Error('Chrome is required for rendered-page assertions; set CHROME_BIN');
  const dir = mkdtempSync(join(tmpdir(), 'rnd-dom-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(dir, 'profile')}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore', detached: process.platform !== 'win32' });
  let exited = false;
  const gone = new Promise(resolve => child.once('exit', () => { exited = true; resolve(); }));
  let socket;
  let closeBrowser;
  let siteServer;
  let siteUrl;
  try {
    if (siteRoot) {
      siteServer = spawn(process.execPath, [join(dirname(siteRoot), 'scripts', 'serve.mjs')], {
        cwd: dirname(siteRoot), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      siteUrl = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Loopback site server did not start')), timeoutMs);
        let output = '';
        siteServer.stdout.on('data', data => {
          output += data;
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/odin-rnd\//);
          if (match) { clearTimeout(timer); resolve(match[0]); }
        });
        siteServer.once('exit', code => { clearTimeout(timer); reject(new Error(`Loopback site server exited ${code}`)); });
        siteServer.once('error', error => { clearTimeout(timer); reject(error); });
      });
    }
    const portFile = join(dir, 'profile', 'DevToolsActivePort');
    const started = Date.now();
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (exited) throw new Error('Chrome exited before opening DevTools');
      if (Date.now() - started > timeoutMs) throw new Error('Chrome opened no DevTools port');
      await wait(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    socket = new WebSocket(`ws://127.0.0.1:${port.trim()}${path.trim()}`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('Could not reach Chrome DevTools')); });
    let id = 0;
    const pending = new Map();
    const loads = new Map();
    const responses = new Map();
    const responseHits = new Map();
    const responseErrors = [];
    socket.onclose = () => { for (const { reject } of pending.values()) reject(new Error('Chrome DevTools closed')); pending.clear(); };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method === 'Page.loadEventFired' && loads.has(message.sessionId)) {
        loads.get(message.sessionId)();
        loads.delete(message.sessionId);
      } else if (message.method === 'Fetch.requestPaused' && responses.has(message.sessionId)) {
        const fixture = responses.get(message.sessionId);
        const matched = message.params.request.url === fixture.url;
        if (matched) {
          if (message.params.resourceType !== 'Document') responseErrors.push(new Error('The controlled response was not a document request'));
          responseHits.set(message.sessionId, (responseHits.get(message.sessionId) ?? 0) + 1);
        }
        const method = matched ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest';
        const args = matched ? {
          requestId: message.params.requestId, responseCode: fixture.status,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from(fixture.body).toString('base64'),
        } : { requestId: message.params.requestId };
        void send(method, args, message.sessionId).catch(error => responseErrors.push(error));
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Chrome DevTools is closed')); return; }
      id++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    closeBrowser = () => send('Browser.close');
    const values = [];
    for (const [index, job] of jobs.entries()) {
      const file = job.file ?? join(dir, `fixture-${index}.html`);
      if (job.html !== undefined) writeFileSync(join(dir, `fixture-${index}.html`), job.html);
      const rel = job.file ? relative(siteRoot, file).split(sep).join('/') : '';
      const url = (job.file ? new URL(rel, siteUrl).href : pathToFileURL(file).href) + (job.hash ?? '');
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        if (job.viewport) await send('Emulation.setDeviceMetricsOverride', { width: job.viewport.width, height: job.viewport.height, deviceScaleFactor: 1, mobile: false }, sessionId);
        if (job.blockedUrls) {
          await send('Network.enable', {}, sessionId);
          await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
          await send('Network.setBlockedURLs', { urls: job.blockedUrls }, sessionId);
        }
        const loaded = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { loads.delete(sessionId); reject(new Error(`Chrome did not load ${url}`)); }, timeoutMs);
          loads.set(sessionId, () => { clearTimeout(timer); resolve(); });
        });
        const navigation = await send('Page.navigate', { url }, sessionId);
        if (navigation.errorText) throw new Error(navigation.errorText);
        await loaded;
        if (job.clickSelector) {
          if (job.responseFixture) {
            responses.set(sessionId, job.responseFixture);
            await send('Fetch.enable', { patterns: [{ urlPattern: job.responseFixture.url }] }, sessionId);
          }
          if (job.historyPath) {
            const changed = await send('Runtime.evaluate', { expression: `history.replaceState(null, '', location.origin + ${JSON.stringify(job.historyPath)})`, returnByValue: true }, sessionId);
            if (changed.exceptionDetails) throw new Error(changed.exceptionDetails.exception?.description ?? changed.exceptionDetails.text);
          }
          const from = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sessionId);
          const moved = new Promise(resolve => {
            const timer = setTimeout(() => { loads.delete(sessionId); resolve(false); }, job.expectNoNavigation ? 2000 : timeoutMs);
            loads.set(sessionId, () => { clearTimeout(timer); resolve(true); });
          });
          const click = await send('Runtime.evaluate', { expression: `(() => { const link = document.querySelector(${JSON.stringify(job.clickSelector)}); if (!link) throw new Error('Missing citation link'); link.click(); return true; })()`, returnByValue: true }, sessionId);
          if (click.exceptionDetails) throw new Error(click.exceptionDetails.exception?.description ?? click.exceptionDetails.text);
          const navigated = await moved;
          if (responseErrors.length) throw responseErrors[0];
          const at = await send('Runtime.evaluate', { expression: `({ url: location.href, heading: document.querySelector('main h1')?.innerText.trim() ?? '', responseStatus: performance.getEntriesByType('navigation').at(-1)?.responseStatus ?? null })`, returnByValue: true }, sessionId);
          values.push({ navigated, sourceUrl: from.result.value, fixtureHits: responseHits.get(sessionId) ?? 0, ...at.result.value });
          responses.delete(sessionId);
          responseHits.delete(sessionId);
          continue;
        }
        const expression = `new Promise((resolve, reject) => {
          const until = Date.now() + ${timeoutMs};
          const tick = () => {
            if (location.href === ${JSON.stringify(url)} && document.readyState === 'complete') {
              try { resolve(${job.expression}); } catch (error) { reject(error); }
            } else if (Date.now() > until) reject(new Error('page did not load'));
            else setTimeout(tick, 20);
          };
          tick();
        })`;
        const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        values.push(result.value);
      } finally { await send('Target.closeTarget', { targetId }); }
    }
    return values;
  } finally {
    if (closeBrowser && !exited) await Promise.race([closeBrowser().catch(() => {}), wait(5000)]);
    try { socket?.close(); } catch { /* already closed */ }
    await Promise.race([gone, wait(10000)]);
    if (!exited) {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      await gone;
    }
    if (siteServer && !siteServer.killed) siteServer.kill();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
    catch (error) { console.warn(`Chrome DOM test left ${dir}: ${error.message}`); }
  }
}
