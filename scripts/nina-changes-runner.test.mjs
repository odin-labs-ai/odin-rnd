import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusItems, DEFAULT_TARBALL } from '../experiments/jev-gate/run_reviewer.mjs';
import { FAKE_CLAUDE6, runReviewer6 } from '../experiments/nina-changes/run_reviewer6.mjs';
import { MATRIX_ROWS6 } from '../experiments/nina-changes/matrix6.mjs';
import { removeScratch, scratchDir } from './jev-gate-scratch.mjs';

// EXP 006 runner end to end against the committed stream-json fake: the real staging (EXP 005's stageWorkspace, the
// pinned nina tarball), the real argv, spawn, parser, record builder, spend guard and matrix judge. No model is called.
// Needs the pinned nina tarball, which CI does not have (local only), like EXP 005's runner e2e.

const haveTarball = existsSync(DEFAULT_TARBALL);
const e2e = { skip: haveTarball ? false : `no pinned nina tarball at the default cache path (local only)`, timeout: 900_000 };

async function withFake(modes, fn) {
  const dir = scratchDir('nc-e2e');
  const saved = { PATH: process.env.PATH, FAKE6_MODES: process.env.FAKE6_MODES, FAKE6_STATE: process.env.FAKE6_STATE, FAKE6_LOG: process.env.FAKE6_LOG, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  try {
    chmodSync(FAKE_CLAUDE6, 0o755);
    symlinkSync(FAKE_CLAUDE6, join(dir, 'claude'));
    Object.assign(process.env, { PATH: `${dir}:${process.env.PATH}`, FAKE6_MODES: modes, FAKE6_STATE: join(dir, 'state'), FAKE6_LOG: join(dir, 'fake.jsonl'), ANTHROPIC_API_KEY: 'must-be-stripped' });
    const log = () => (existsSync(join(dir, 'fake.jsonl')) ? readFileSync(join(dir, 'fake.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : []);
    return await fn(dir, log);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    removeScratch(dir);
  }
}

test('fixture run: seen / -C / blind / harness failures are staged, spawned, parsed, classified and charged', e2e, async () => {
  await withFake('seen,seen-dash-c,blind,badline,noresult,nocost', async (dir, log) => {
    const ledgerPath = join(dir, 'ledger.jsonl');
    const run = await runReviewer6({ out: join(dir, 'run.json'), ledgerPath, mode: 'counted', fixture: true, items: corpusItems(['c004', 'c013']), log: () => {} });
    assert.equal(run.partial, null);
    assert.equal(run.fixture, true);
    const [seen, dashC, blind, badline, noresult, nocost] = run.calls;
    assert.deepEqual([seen.diffSeen.seen, seen.diffSeen.rule, seen.decision, seen.harnessFailure], [true, 'a', 'REJECT', null], 'c004 seen by git diff');
    assert.deepEqual([dashC.diffSeen.seen, dashC.gitToolDenials], [true, 0], 'git -C <ws> --no-pager diff runs under fence6');
    assert.ok(dashC.toolCalls.some(t => t.input.command === 'git -C <ws>/repo --no-pager diff' && t.isError === false), 'recorded scrubbed');
    assert.deepEqual([blind.diffSeen.seen, blind.gitToolDenials, blind.decision], [false, 1, 'ACCEPT'], 'a refused redirect-to-file, then no fallback: blind');
    assert.equal(badline.harnessFailure, 'unparseable-ndjson-line');
    assert.equal(noresult.harnessFailure, 'no-final-result-line');
    assert.deepEqual([nocost.id, nocost.costUsd, nocost.harnessFailure], ['c013', null, null]);
    // c013 (add-only, a new directory): the fake read the added file after `?? src/jobs/` → seen by rule (b).
    assert.deepEqual([run.calls[3].diffSeen.rule, run.calls[4].diffSeen.seen, nocost.diffSeen.rule], [null, false, 'b']);
    // The child saw no billing key, its own NINA_DATA and TMPDIR under the run dir, and EXP 005's git isolation.
    for (const l of log()) {
      assert.deepEqual(l.billedKeys, []);
      assert.match(l.tmpdir, /nina-changes-reviewer-[A-Za-z0-9]{6}\/tmp$/);
      assert.equal(l.gitConfigGlobal, '/dev/null');
      assert.ok(l.argv.includes('stream-json') && l.argv.includes('--verbose'));
    }
    // One ledger line per call; the unknown cost is charged the upper bound, never $0.
    const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 6);
    assert.deepEqual(lines.map(l => l.costBasis), ['api-equivalent', 'api-equivalent', 'api-equivalent', 'upper-bound', 'upper-bound', 'upper-bound']);
    assert.ok(lines.every(l => l.costUsd > 0 && l.fixture === true));
    // Scrubbed at write time: no run dir or home path in the record.
    const text = readFileSync(join(dir, 'run.json'), 'utf8');
    assert.doesNotMatch(text, /nina-changes-reviewer-|\/Users\//);
    assert.ok(run.calls.every(c => c.hook.ran && c.hooksConfigured.length > 0), 'nina hooks recorded');
  });
});

test('the spend guard stops before a call that would cross the cap (a partial run, no call made)', e2e, async () => {
  await withFake('seen', async (dir, log) => {
    const ledgerPath = join(dir, 'ledger.jsonl');
    writeFileSync(ledgerPath, `${JSON.stringify({ ts: '2026-09-30T00:00:00Z', gate: 'reviewer', kind: 'counted', id: 'x', run: 1, costUsd: 59.5, costBasis: 'api-equivalent', fixture: true })}\n`);
    const run = await runReviewer6({ out: join(dir, 'run.json'), ledgerPath, mode: 'counted', fixture: true, items: corpusItems(['c004']), log: () => {} });
    assert.equal(run.partial.reason, 'spend');
    assert.deepEqual([run.partial.limit, run.partial.askFork], ['cap', true]);
    assert.equal(run.calls.length, 0);
    assert.equal(log().length, 0, 'no call was made');
  });
});

test('matrix v6 under fence6: every row held and every control worked (fake client); a leaking client is caught in tool outputs', e2e, async () => {
  await withFake('fenced,leak', async dir => {
    const probe = await runReviewer6({ out: join(dir, 'm1.json'), ledgerPath: join(dir, 'l.jsonl'), mode: 'probe', probe: 'matrix', fixture: true, log: () => {} });
    const m = probe.calls[0].matrix;
    const leaked = Object.entries(m.rows).filter(([, r]) => r.leaked).map(([k]) => k);
    assert.deepEqual(leaked, [], 'no row leaked');
    for (const r of MATRIX_ROWS6) assert.ok(r in m.rows, `row ${r} judged`);
    const failed = Object.entries(m.controls).filter(([, c]) => !c.worked).map(([k]) => k);
    assert.deepEqual(failed, [], 'every control worked');
    assert.equal(m.info.i47.fileAppeared, false, 'the in-workspace redirect was refused by the model client');
    assert.equal(m.passed, true);
    assert.equal(probe.calls[0].probePassed, true);
    const leak = await runReviewer6({ out: join(dir, 'm2.json'), ledgerPath: join(dir, 'l.jsonl'), mode: 'probe', probe: 'matrix', fixture: true, log: () => {} });
    const lm = leak.calls[0].matrix;
    assert.equal(lm.fenced, false);
    assert.ok(lm.rows.r17.leaked && lm.rows.r39.leaked && lm.rows.r32.leaked, 'secrets that reached only tool outputs are caught');
    assert.doesNotMatch(leak.calls[0].result, /CANARY-R17-/, 'the report itself stayed silent');
    assert.equal(leak.calls[0].probePassed, false);
  });
});
