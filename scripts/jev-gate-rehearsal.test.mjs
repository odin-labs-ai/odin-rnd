import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkRecords, defaultScanRoots, renderRunnerPins, REPO_ROOT, runnerCodeShas, scrubTempPath, sha256,
} from '../experiments/jev-gate/runner-guard.mjs';
import { corpusItems, runReviewer } from '../experiments/jev-gate/run_reviewer.mjs';
import { assertPublishable, computeResults } from '../experiments/jev-gate/results.mjs';

// EXP 005 bundle-3 refute r2, the class fix. A rehearsal builds counted-shaped records for the full corpus with
// the REAL record builders (the model call stubbed, the record marked rehearsal), then feeds them through the REAL
// computeResults under non-fixture/counted semantics — the same code path a counted run takes to assemble its
// record. So any record-level field the scorer asserts but a builder omits (as amendment02Sha256 was omitted by
// the reviewer, refute r2 B1) turns this test RED. No gate is called.
//
// The rehearsal covers RECORD-LEVEL fields (parent/amendment/amendment02 sha, mode, notBefore, code), which is
// where R2-B1 lived. The per-call entries here are hand-written STUBS, not built by reviewerRun (reviewer) or
// jev_call/run_laya (Jev/Laya): those spawn a model/stage a workspace. Per-call fields are covered instead by the
// fake-claude and fake-Jev-server end-to-end tests. Only the one per-call field the scorer asserts for a counted
// run — startedAt after the not-before time — is exercised here (refute r3 N-r3-4).
//
// Bundle-4 refute r5-B1: the rehearsal now also carries a counted pre-flight RECORD and stamps it exactly as a
// counted run does (run-time head + scrubbed roots + record sha), and computeResults scores every non-fixture run
// through checkPreflightForScoring with no rehearsal exemption. So a scorer check that a real counted run's record
// could not satisfy after commit (as the live-git-HEAD/temp-root/path check could not) turns this test RED.
//
// The reviewer builder runs everywhere (no Python). The Jev and Laya builders are run_gates.py, which needs the
// corpus .venv; when it is absent (CI, a fresh clone) only that half is skipped, so the class guard still protects
// the reviewer builder everywhere (refute r3 N-r3-3).

const DIR = 'experiments/jev-gate';
const VENV = `${DIR}/.venv/bin/python`;
const havePython = existsSync(VENV);

function pyRehearsal(gate, dir, preflightRecord) {
  const out = join(dir, `${gate}.json`);
  const r = spawnSync(VENV, [`${DIR}/run_gates.py`, '--gate', gate, '--rehearsal', '--preflight-record', preflightRecord, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, `run_gates.py --rehearsal --gate ${gate} failed: ${r.stderr}`);
  return JSON.parse(readFileSync(out, 'utf8'));
}

// A valid, current counted pre-flight record (no scan): current git HEAD, the scrubbed default scan roots, the
// runners.sha256 file's own sha, an empty copies list and a scan that ended a minute ago. This is byte-shaped
// exactly like the record runner-guard.mjs --preflight --write-record writes, so the runners' run-time check
// (checkPreflightRecord) accepts it and the scorer's checkPreflightForScoring re-checks the run's stamps against it.
function writeSyntheticPreflight(dir) {
  const endedAt = new Date(Date.now() - 60e3).toISOString();
  const rec = {
    kind: 'answer-key-preflight', mode: 'counted', ok: true,
    scanned: defaultScanRoots().scannable.map(scrubTempPath), skipped: [], copies: [],
    vanished: 0, permissionSkipped: 0, durationMs: 0, override: null,
    startedAt: new Date(Date.now() - 120e3).toISOString(), endedAt,
    runnersSha256: sha256(readFileSync(join(REPO_ROOT, `${DIR}/runners.sha256`))),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    sha256: null,
  };
  rec.sha256 = sha256(JSON.stringify({ ...rec, sha256: null }));
  const path = join(dir, 'preflight.json');
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
  return { path, rec };
}

const ASSERTED_FIELDS = ['parentSha256', 'amendmentSha256', 'amendment02Sha256', 'notBefore', 'code', 'mode'];

test('end-to-end rehearsal: the real record builders produce records the real scorer accepts under counted semantics', async (t) => {
  const { prereg, amendment, stamp } = checkRecords({ mode: 'counted' });
  assert.equal(stamp.fixture, false);
  assert.equal(stamp.mode, 'counted');
  const labels = JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8'));
  const baselines = JSON.parse(readFileSync(`${DIR}/baselines.json`, 'utf8'));
  const items = corpusItems();

  const dir = mkdtempSync(join(tmpdir(), 'jev-gate-rehearsal-'));
  try {
    const { path: preflightPath, rec: preflight } = writeSyntheticPreflight(dir);

    // The reviewer builder runs unconditionally (no Python needed). It now carries a pre-flight record and stamps
    // it exactly as a counted run does (bundle-4 r5-B1); it is no longer exempt from the scorer's pre-flight check.
    const reviewer = await runReviewer({ rehearsal: true, items, preflightRecord: preflightPath });
    assert.equal(reviewer.rehearsal, true);
    assert.equal(reviewer.fixture, false);
    assert.equal(reviewer.mode, 'counted');
    assert.equal(reviewer.head, preflight.head, 'a rehearsal stamps the run-time head');
    assert.equal(reviewer.pins?.preflight?.sha256, preflight.sha256, 'a rehearsal commits to the pre-flight record sha');
    assert.equal(reviewer.pins?.preflight?.endedAt, preflight.endedAt);
    assert.deepEqual(reviewer.pins?.preflightRoots, preflight.scanned, 'a rehearsal stamps the scanned roots');
    assert.equal(reviewer.calls.length, items.length * prereg.gates.reviewer.k);

    let jev = null, laya = null;
    if (havePython) {
      jev = pyRehearsal('jev', dir, preflightPath);
      laya = pyRehearsal('laya', dir, preflightPath);
      for (const [g, rec] of [['jev', jev], ['laya', laya]]) {
        assert.equal(rec.rehearsal, true, `${g} record is a rehearsal`);
        assert.equal(rec.fixture, false, `${g} record is non-fixture`);
        assert.equal(rec.mode, 'counted', `${g} record is counted`);
        assert.equal(rec.calls.length, items.length, `${g} covers every corpus item`);
        assert.equal(rec.head, preflight.head, `${g} stamps the run-time head`);
        assert.equal(rec.preflight?.sha256, preflight.sha256, `${g} commits to the pre-flight record sha`);
        assert.deepEqual(rec.preflightRoots, preflight.scanned, `${g} stamps the scanned roots`);
      }
    } else {
      t.diagnostic(`no ${VENV}: skipping the Jev/Laya half; the reviewer builder is still checked below`);
    }

    const gates = havePython ? ['jev', 'laya', 'reviewer'] : ['reviewer'];
    const runs = () => (havePython ? { jev, laya, reviewer } : { reviewer });

    // The real scorer accepts the records under counted semantics, WITH the committed pre-flight record: no throw,
    // non-fixture, complete (not partial), tagged rehearsal so it can never be published.
    const result = computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs(), preflight });
    assert.equal(result.fixture, false);
    assert.equal(result.rehearsal, true, 'a rehearsal result is tagged so it can never be published');
    assert.equal(result.partial, null, 'full coverage: not partial');
    assert.throws(() => assertPublishable(result), /rehearsal/, 'a rehearsal result is never publishable');
    if (havePython) {
      assert.ok(result.criteria.every(c => c.state !== null), 'every criterion has a state when all gates ran');
      assert.ok(['PASS', 'FAIL'].includes(result.spotlight.verdict));
    }

    // The class guard: every record-level field the scorer asserts, removed from a builder's record, turns scoring
    // RED (reviewer everywhere; Jev/Laya when the venv is present).
    for (const field of ASSERTED_FIELDS) {
      for (const gate of gates) {
        const broken = structuredClone(runs());
        delete broken[gate][field];
        assert.throws(
          () => computeResults({ prereg, amendment, stamp, labels, baselines, runs: broken, preflight }),
          `removing ${field} from the ${gate} record did not turn scoring RED`,
        );
      }
    }

    // The pre-flight path is now covered by the class guard (refute r5-B1): scoring needs the committed record, and
    // a run that did not stamp the head or commit to the record sha turns scoring RED.
    assert.throws(
      () => computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs() }),
      /pre-flight/i, 'scoring with no committed pre-flight record must refuse',
    );
    for (const gate of gates) {
      const noHead = structuredClone(runs());
      delete noHead[gate].head;
      assert.throws(
        () => computeResults({ prereg, amendment, stamp, labels, baselines, runs: noHead, preflight }),
        `removing head from the ${gate} record did not turn scoring RED`,
      );
      const noStamp = structuredClone(runs());
      if (noStamp[gate].pins) delete noStamp[gate].pins.preflight;
      delete noStamp[gate].preflight;
      assert.throws(
        () => computeResults({ prereg, amendment, stamp, labels, baselines, runs: noStamp, preflight }),
        `removing the pre-flight stamp from the ${gate} record did not turn scoring RED`,
      );
    }
    // A tampered committed record (a field changed without re-hashing) refuses at scoring.
    const tampered = structuredClone(preflight);
    tampered.vanished = 999;
    assert.throws(
      () => computeResults({ prereg, amendment, stamp, labels, baselines, runs: runs(), preflight: tampered }),
      /altered/,
    );

    // The one per-call field the scorer asserts for a counted run: a call that started at the not-before time is rejected.
    const early = structuredClone(runs());
    early.reviewer.calls[0].startedAt = stamp.notBefore;
    assert.throws(() => computeResults({ prereg, amendment, stamp, labels, baselines, runs: early, preflight }), /not after the not-before/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
