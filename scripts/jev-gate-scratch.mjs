// A signal-safe scratch dir for the jev-gate tests (bundle-3 refute r4 hygiene).
//
// Several tests copy the answer files (labels.json, inputs.json, corpus.sha256, manifest.json, baselines.json)
// into a temp dir. `finally`, `after()` and `TemporaryDirectory` clean those up on normal exit and on assertion
// failures, but NOT when the run is interrupted (Ctrl-C) or killed (a `pkill` or a test-timeout SIGTERM). A
// killed run then strands the copy in a scanned temp root, where the counted answer-key pre-flight later refuses
// (the exact way the commander's scan found six stranded copies). So every scratch dir made here is also removed
// on SIGINT, SIGTERM and SIGHUP, and on process exit, as a backstop to the caller's own cleanup.
//
// A SIGKILL (kill -9) cannot be caught, so it can still strand a copy; the counted pre-flight is the catch for
// that case, and the operator runs it before a counted run.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = new Set();
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const cleanup = () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* already gone */ } } };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { cleanup(); process.exit(1); });
}

/** Make a `jev-gate-<label>-XXXX` temp dir that is removed on exit and on SIGINT/SIGTERM/SIGHUP. */
export function scratchDir(label = 'scratch') {
  install();
  const dir = mkdtempSync(join(tmpdir(), `jev-gate-${label}-`));
  made.add(dir);
  return dir;
}

/** Remove a scratch dir now (a test's own finally/after); the signal/exit backstop still covers a killed run. */
export function removeScratch(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  made.delete(dir);
}
