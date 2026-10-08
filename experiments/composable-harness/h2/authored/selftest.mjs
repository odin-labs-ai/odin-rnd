import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRegistry } from './registry.mjs';
import lint from './components/lint.mjs';
import grep from './components/grep.mjs';
import mlxModel from './components/mlx.model.mjs';
import yesnoGate from './components/yesno-gate.mjs';
import memoCache from './components/memo-cache.mjs';
import spendCounter from './components/spend-counter.mjs';

const SERVER_SRC = `
import http from 'node:http';
const port = Number(process.argv[2]);
const srv = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return;
  }
  if (req.method === 'POST' && req.url === '/v1/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'echo:' + j.prompt, pin: process.env.FAKE_PIN, opts: j }));
    });
    return;
  }
  res.writeHead(404); res.end();
});
srv.listen(port, '127.0.0.1');
process.on('SIGTERM', () => { srv.close(() => process.exit(0)); srv.closeAllConnections(); });
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Record every temp dir created (the spend-counter's included) to check cleanup.
const createdDirs = [];
const realMkdtemp = fs.mkdtemp;
fs.mkdtemp = async (...a) => {
  const d = await realMkdtemp(...a);
  createdDirs.push(d);
  return d;
};

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'h2-selftest-'));
try {
  const serverPath = path.join(tmp, 'fake-mlx-server.mjs');
  await fs.writeFile(serverPath, SERVER_SRC);
  const ledgerPath = path.join(tmp, 'ledger.jsonl');
  const port = await freePort();
  const bus = new EventEmitter();

  const calls = { lint: 0, grep: 0, readout: 0 };
  const deps = {
    bus,
    lintRun: async (item) => {
      calls.lint++;
      return { ok: true, item };
    },
    grepRun: (pattern, text) => {
      calls.grep++;
      return new RegExp(pattern).test(text);
    },
    readout: async (model, item, stratum) => {
      calls.readout++;
      const r = await model.complete('decide ' + item.sha, { stratum });
      return { decision: r.text ? 'yes' : 'no', p: 0.9 };
    },
  };

  const modelConfig = (pin) => ({
    pin,
    server: { command: process.execPath, args: [serverPath, String(port)], port, env: { FAKE_PIN: pin } },
    readyPath: '/health',
    readyTimeoutMs: 10000,
    deps,
  });

  const reg = createRegistry();

  // A gate registered before its needs is skipped, with sorted missing keys.
  await reg.register(yesnoGate, { stratum: 's1', deps });
  assert.deepEqual(reg.list(), [{ name: 'yesno-gate', status: 'skipped: missing memo, missing model' }]);
  await reg.unregister('yesno-gate');
  assert.deepEqual(reg.list(), []);

  // 1. Register all six in dependency order.
  await reg.register(lint, { deps });
  await reg.register(grep, { deps });
  await reg.register(memoCache, { deps });
  await reg.register(spendCounter, { flushMs: 50, ledgerPath, deps });
  await reg.register(mlxModel, modelConfig('pin-a'));
  await reg.register(yesnoGate, { stratum: 's1', deps });
  assert.ok(reg.list().every((e) => e.status === 'registered'), JSON.stringify(reg.list()));
  assert.throws(() => reg.provide('lint', {}));

  // 2. Call each service once.
  const lintRes = await reg.get('lint').run('item-1');
  assert.equal(lintRes.ok, true);
  assert.equal(reg.get('lint').runs, 1);
  assert.equal(reg.get('grep').run('a+b', 'xaaab'), true);
  assert.equal(reg.get('grep').cache.size, 1);
  const memo = reg.get('memo');
  memo.set('x', 1);
  assert.deepEqual(memo.keys(), ['x']);
  memo.clear();
  const spend = reg.get('spend');
  spend.add('llm', 0.25);
  assert.equal(spend.total(), 0.25);
  const model = reg.get('model');
  const c = await model.complete('hello', { max_tokens: 3 });
  assert.equal(c.text, 'echo:hello');
  assert.equal(c.pin, 'pin-a');
  assert.deepEqual(model.prefixKeys(), ['pin-a\u0000hello']);
  const gate = reg.get('gate');
  const d1 = await gate.decide({ sha: 'abc' });
  const d2 = await gate.decide({ sha: 'abc' });
  assert.deepEqual(d1, { decision: 'yes', p: 0.9 });
  assert.deepEqual(d2, d1);
  assert.equal(calls.readout, 1);
  bus.emit('pin-changed');
  assert.deepEqual(memo.keys(), []);
  assert.equal(bus.listenerCount('pin-changed'), 1);
  assert.equal(calls.lint, 1);
  assert.equal(calls.grep, 1);

  // Reconfigure the model with a new pin, by hand: no cascade, so the gate is
  // unregistered first and re-registered after (its owner handles it).
  const oldModel = model;
  await reg.unregister('yesno-gate');
  await reg.reconfigure('mlx.model', modelConfig('pin-b'));
  assert.deepEqual(oldModel.prefixKeys(), []);
  const model2 = reg.get('model');
  assert.equal(model2.pin, 'pin-b');
  const c2 = await model2.complete('hello');
  assert.equal(c2.pin, 'pin-b');
  assert.ok(model2.prefixKeys().every((k) => k.startsWith('pin-b\u0000')));
  await reg.register(yesnoGate, { stratum: 's1', deps });

  // 3. Unregister all in reverse order.
  const grepSvc = reg.get('grep');
  const spendDirs = createdDirs.filter((d) => path.basename(d).startsWith('spend-counter-'));
  assert.equal(spendDirs.length, 1);
  assert.ok(await exists(spendDirs[0]));
  for (const name of ['yesno-gate', 'mlx.model', 'spend-counter', 'memo-cache', 'grep', 'lint']) {
    await reg.unregister(name);
  }
  assert.deepEqual(reg.list(), []);
  for (const k of ['lint', 'grep', 'model', 'gate', 'memo', 'spend']) assert.equal(reg.has(k), false, k);
  assert.equal(bus.listenerCount('pin-changed'), 0);
  assert.equal(grepSvc.cache.size, 0);
  assert.deepEqual(model2.prefixKeys(), []);
  assert.equal(await exists(spendDirs[0]), false);
  const ledger = (await fs.readFile(ledgerPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'llm');
  // The port must be free again (child exited).
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(resolve));
  });
  assert.deepEqual(process.getActiveResourcesInfo().filter((r) => r === 'Timeout' || r === 'ChildProcess'), []);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log('OK');
