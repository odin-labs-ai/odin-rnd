// Browser DOM oracle for built-page tests. The card renderer already requires Chrome in CI and supplies its binary
// lookup; this helper uses the same headless DevTools path for text, layout and resolved-link assertions.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromeBinary } from './og-cards-render.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Each job has `file` or fixture `html`, plus a browser expression whose result is returned by value. */
export async function inspectDom(jobs, { chrome = chromeBinary(), timeoutMs = 30000 } = {}) {
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
  try {
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
      if (job.html !== undefined) writeFileSync(file, job.html);
      const url = pathToFileURL(file).href;
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        const loaded = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { loads.delete(sessionId); reject(new Error(`Chrome did not load ${url}`)); }, timeoutMs);
          loads.set(sessionId, () => { clearTimeout(timer); resolve(); });
        });
        const navigation = await send('Page.navigate', { url }, sessionId);
        if (navigation.errorText) throw new Error(navigation.errorText);
        await loaded;
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
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
    catch (error) { console.warn(`Chrome DOM test left ${dir}: ${error.message}`); }
  }
}
