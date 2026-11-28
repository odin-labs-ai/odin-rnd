import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOWS, health, main, openRecordsPRs, renderLines, workflowRuns } from './rnd-factory-health.mjs';

function withFetch(t, handler) {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), calls.length); };
  return calls;
}

function withConsole(t) {
  const real = { log: console.log, error: console.error };
  t.after(() => { console.log = real.log; console.error = real.error; });
  const out = [], err = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  return { out, err };
}

const run = (overrides = {}) => ({
  conclusion: 'success', status: 'completed', html_url: 'https://example.invalid/run', created_at: '2026-11-01T00:00:00Z', ...overrides,
});

test('workflowRuns reads the right path, reverses to oldest-first, and maps the fields', async t => {
  const calls = withFetch(t, () => new Response(JSON.stringify({
    workflow_runs: [run({ created_at: '2026-11-03T00:00:00Z' }), run({ created_at: '2026-11-02T00:00:00Z', conclusion: 'failure' }), run({ created_at: '2026-11-01T00:00:00Z' })],
  }), { status: 200 }));
  const runs = await workflowRuns({ repo: 'odin-labs-ai/odin-labs', file: 'lab-waiting.yml' }, 'tok', 3);
  assert.equal(calls[0].url, 'https://api.github.com/repos/odin-labs-ai/odin-labs/actions/workflows/lab-waiting.yml/runs?per_page=3');
  assert.equal(calls[0].init.headers.authorization, 'bearer tok');
  assert.deepEqual(runs.map(r => r.createdAt), ['2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z']);
  assert.deepEqual(runs.map(r => r.conclusion), ['success', 'failure', 'success']);
});

test('workflowRuns caps at n even when GitHub answers more', async t => {
  withFetch(t, () => new Response(JSON.stringify({ workflow_runs: [run(), run(), run(), run()] }), { status: 200 }));
  const runs = await workflowRuns({ repo: 'r', file: 'f.yml' }, 'tok', 2);
  assert.equal(runs.length, 2);
});

test('workflowRuns throws a readable error on a non-200 answer, naming the path', async t => {
  withFetch(t, () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
  await assert.rejects(workflowRuns({ repo: 'odin-labs-ai/x', file: 'y.yml' }, 'tok'), /y\.yml.*404.*Not Found/s);
});

test('openRecordsPRs keeps only records/* and data/broker-probe-* heads, drops everything else, sorted oldest first', async t => {
  withFetch(t, () => new Response(JSON.stringify([
    { number: 1, title: 'a', head: { ref: 'records/rogue-20261101-010000' }, created_at: '2026-11-02T00:00:00Z', html_url: 'u1' },
    { number: 2, title: 'b', head: { ref: 'feature/unrelated' }, created_at: '2026-11-01T00:00:00Z', html_url: 'u2' },
    { number: 3, title: 'c', head: { ref: 'data/broker-probe-2026-W47-43824588528' }, created_at: '2026-11-01T00:00:00Z', html_url: 'u3' },
  ]), { status: 200 }));
  const prs = await openRecordsPRs('tok');
  assert.deepEqual(prs.map(p => p.number), [3, 1]);
  assert.equal(prs[0].headRefName, 'data/broker-probe-2026-W47-43824588528');
});

test('openRecordsPRs pages until a short page, then stops', async t => {
  const calls = withFetch(t, (url, n) => {
    const page = n === 1
      ? Array.from({ length: 100 }, (_, i) => ({ number: i, title: 't', head: { ref: 'records/x' }, created_at: '2026-11-01T00:00:00Z', html_url: 'u' }))
      : [{ number: 999, title: 't', head: { ref: 'records/y' }, created_at: '2026-11-02T00:00:00Z', html_url: 'u' }];
    return new Response(JSON.stringify(page), { status: 200 });
  });
  const prs = await openRecordsPRs('tok');
  assert.equal(calls.length, 2); // page=1 (100, full -> continue), page=2 (1, short -> stop)
  assert.equal(prs.length, 101);
});

test('health() captures a per-workflow error without failing the other workflows', async t => {
  withFetch(t, url => (url.includes('lab-waiting.yml')
    ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 })
    : url.includes('/pulls')
      ? new Response(JSON.stringify([]), { status: 200 })
      : new Response(JSON.stringify({ workflow_runs: [run()] }), { status: 200 })));
  const report = await health('tok', { runs: 1 });
  assert.equal(report.format, 'odin-rnd-factory-health');
  assert.equal(report.version, 1);
  assert.equal(report.workflows.length, WORKFLOWS.length);
  const waiting = report.workflows.find(w => w.file === 'lab-waiting.yml');
  assert.equal(waiting.runs.length, 0);
  assert.match(waiting.error, /500/);
  const others = report.workflows.filter(w => w.file !== 'lab-waiting.yml');
  assert.ok(others.every(w => w.runs.length === 1 && !w.error));
  assert.deepEqual(report.openRecordsPRs, []);
});

test('health() records an openRecordsPRs error separately and still reports every workflow', async t => {
  withFetch(t, url => (url.includes('/pulls')
    ? new Response(JSON.stringify({ message: 'nope' }), { status: 403 })
    : new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 })));
  const report = await health('tok');
  assert.deepEqual(report.openRecordsPRs, []);
  assert.match(report.openRecordsPRsError, /403/);
  assert.equal(report.workflows.length, WORKFLOWS.length);
});

test('renderLines draws a green/red/pending grid and the open-PR line', () => {
  const report = {
    workflows: [
      { repo: 'r', file: 'a.yml', runs: [run(), run({ conclusion: 'failure' }), run({ status: 'in_progress', conclusion: null })] },
      { repo: 'r', file: 'b.yml', runs: [], error: 'unreachable' },
    ],
    openRecordsPRs: [{ number: 261, headRefName: 'data/broker-probe-2026-W47-x' }],
  };
  const lines = renderLines(report);
  assert.equal(lines[0], 'r/a.yml: 🟢🔴⏳');
  assert.equal(lines[1], 'r/b.yml: (no runs) ERROR: unreachable');
  assert.equal(lines[2], '1 open records/data PR(s): #261 (data/broker-probe-2026-W47-x)');
});

test('renderLines says so when nothing is open', () => {
  assert.equal(renderLines({ workflows: [], openRecordsPRs: [] })[0], '0 open records/data PR(s)');
});

test('main() refuses cleanly with no token, before any network call', async t => {
  const { err } = withConsole(t);
  delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN;
  const code = await main([]);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /GH_TOKEN/);
});

test('main() --json prints exactly health()\'s report', async t => {
  withFetch(t, url => (url.includes('/pulls') ? new Response(JSON.stringify([]), { status: 200 }) : new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 })));
  const { out } = withConsole(t);
  const writes = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = chunk => { writes.push(chunk); return true; };
  t.after(() => { process.stdout.write = realWrite; });
  process.env.GH_TOKEN = 'tok';
  const code = await main(['--json', '--runs', '2']);
  delete process.env.GH_TOKEN;
  assert.equal(code, 0);
  assert.equal(out.length, 0);
  const report = JSON.parse(writes.join(''));
  assert.equal(report.format, 'odin-rnd-factory-health');
});

test('main() rejects a bad --runs value before making any call', async t => {
  const { err } = withConsole(t);
  process.env.GH_TOKEN = 'tok';
  const code = await main(['--runs', '0']);
  delete process.env.GH_TOKEN;
  assert.equal(code, 2);
  assert.match(err.join('\n'), /--runs/);
});
