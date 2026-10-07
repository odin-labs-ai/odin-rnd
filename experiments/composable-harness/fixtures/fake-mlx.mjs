#!/usr/bin/env node
// FIXTURE: a stand-in for mlx_gate.py that speaks the same JSON-lines protocol with no MLX and no model. pYesBin is a
// deterministic function of (pin, state); the prefix cache is the same "<pin>:<sha256>" LRU; activeBytes grows with it.
// Like the real child, it creates a per-user runtime cache directory in its TMPDIR on start and never removes it
// (mlx_gate.py's `import mlx_lm` creates $TMPDIR/torchinductor_<user>), so a fake run exercises that too.
//   node fake-mlx.mjs --model-key <key> [--prefix-cache N]
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

mkdirSync(join(tmpdir(), 'fake-mlx-runtime-cache'), { recursive: true });

const argv = process.argv.slice(2);
const at = (flag, d) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : d);
const pin = at('--model-key');
const max = Number(at('--prefix-cache', '8'));
const sha = s => createHash('sha256').update(s).digest('hex');
const cache = new Map();
const out = o => process.stdout.write(`${JSON.stringify(o)}\n`);

function evaluate(state) {
  const key = `${pin}:${sha(`prefix:${state}`)}`;
  const cached = cache.has(key);
  cache.delete(key);
  cache.set(key, true);
  while (cache.size > max) cache.delete(cache.keys().next().value);
  const u = parseInt(sha(`${pin}\n${state}`).slice(0, 12), 16) / 2 ** 48;
  const lpYes = Math.log(u + 1e-9), lpNo = Math.log(1 - u + 1e-9);
  return { ok: true, pin, prefixKey: key, cached, lpYes, lpNo, pYesBin: 1 / (1 + Math.exp(lpNo - lpYes)) };
}

// --http PORT: mlx_gate.py's HTTP mode (GET /health, POST /v1/completions; a first line "item:<sha>" is stripped).
const httpPort = at('--http');
if (httpPort !== undefined) {
  const { createServer } = await import('node:http');
  createServer((req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/v1/completions') return reply(404, { ok: false });
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let prompt = JSON.parse(body).prompt;
      if (prompt.startsWith('item:')) prompt = prompt.slice(prompt.indexOf('\n') + 1);
      reply(200, evaluate(prompt));
    });
  }).listen(Number(httpPort), '127.0.0.1');
} else {
  out({ ready: true, pid: process.pid, pin, activeBytes: 0 });
  createInterface({ input: process.stdin }).on('line', line => {
    const req = JSON.parse(line);
    if (req.op === 'quit') process.exit(0);
    if (req.op === 'memory') return out({ ok: true, activeBytes: cache.size * 1_000_000 });
    if (req.op === 'keys') return out({ ok: true, prefixKeys: [...cache.keys()] });
    if (req.op !== 'eval') return out({ ok: false, error: `unknown op ${req.op}` });
    out(evaluate(req.state));
  });
}
