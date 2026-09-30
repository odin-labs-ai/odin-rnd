// A complete counted-shaped EXP 006 reviewer run record made by the REAL builder and loop (runReviewer6, mode
// rehearsal: the committed stream-json fake stands in for the model, no workspace, no spend), for tests only. The
// rehearsal test and the spotlight test share it; nothing here is written outside the caller's scratch directory.
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultScanRoots, REPO_ROOT, scrubTempPath, sha256 } from '../experiments/jev-gate/runner-guard.mjs';
import { RUNNER6_PINS } from '../experiments/nina-changes/guard6.mjs';
import { FAKE_CLAUDE6, runReviewer6 } from '../experiments/nina-changes/run_reviewer6.mjs';

/** Rehearsal pins: a synthetic pre-registration sha and a not-before an hour ago (freeze.mjs stays null). */
export const rehearsalPins = () => ({ prereg6Sha256: sha256('EXP 006 rehearsal: not a pre-registration'), notBefore: new Date(Date.now() - 3600e3).toISOString() });

/** A counted pre-flight record for the rehearsal, bound to the committed pins file and this commit. */
export function writeSyntheticPreflight(dir) {
  const endedAt = new Date(Date.now() - 60e3).toISOString();
  const rec = {
    kind: 'answer-key-preflight', mode: 'counted', ok: true, scanned: defaultScanRoots().scannable.map(scrubTempPath), skipped: [], copies: [],
    vanished: 0, permissionSkipped: 0, durationMs: 0, override: null, startedAt: new Date(Date.now() - 120e3).toISOString(), endedAt,
    runnersSha256: sha256(readFileSync(join(REPO_ROOT, RUNNER6_PINS))), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(), sha256: null,
  };
  rec.sha256 = sha256(JSON.stringify({ ...rec, sha256: null }));
  const path = join(dir, 'preflight.json');
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
  return { path, rec };
}

/**
 * Runs the real builder over `items` × k with the fake playing one mode per call (in call order), inside `dir`
 * (a scratch directory the caller owns and removes). Returns {run, preflight, pins}.
 */
export async function buildReviewerRun({ dir, items, modes, pins = rehearsalPins() }) {
  const saved = { PATH: process.env.PATH, FAKE6_MODES: process.env.FAKE6_MODES, FAKE6_STATE: process.env.FAKE6_STATE };
  try {
    chmodSync(FAKE_CLAUDE6, 0o755);
    symlinkSync(FAKE_CLAUDE6, join(dir, 'claude'));
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.FAKE6_MODES = modes.join(',');
    process.env.FAKE6_STATE = join(dir, 'state');
    const { path: preflightPath, rec: preflight } = writeSyntheticPreflight(dir);
    const run = await runReviewer6({ out: join(dir, 'reviewer.json'), mode: 'rehearsal', items, rehearsalPins: pins, preflightRecord: preflightPath, log: () => {} });
    return { run, preflight, pins };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
