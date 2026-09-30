// EXP 006 counted-run guard. The EXP 006 runner calls checkRun6 before anything else. It refuses unless:
//   - EXP 005's records are the published bytes (runner-guard checkRecords: prereg 30bdcf07…, amendment 01 5ddd8df9…,
//     every file they pin, including the corpus 'a83b222a…', labels, inputs and rules) and amendment 02 is 75d231c2…;
//   - the corpus sha and the base commit are EXP 005's (I4): corpus.sha256 a83b222a…, base commit 3e35e4e2…;
//   - the live EXP 006 code equals experiments/nina-changes/runners.sha256 (every EXP 006 file and every jev-gate
//     module EXP 006 imports) — a counted run refuses on any difference, a probe/practice/fixture run records it;
//   - for a COUNTED run: the frozen constants in freeze.mjs are set, the EXP 006 pre-registration on disk hashes to
//     PREREG6_SHA256, and now is after NOT_BEFORE6. While freeze.mjs holds null, every counted run refuses.
// A REHEARSAL (the model call stubbed by the committed stream-json fake) runs the counted record builder and scorer
// under supplied rehearsal pins when the freeze is still null; its record is marked rehearsal and never publishable.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMENDMENT_02_SHA256, checkRecords, REPO_ROOT, sha256 } from '../jev-gate/runner-guard.mjs';
import { NOT_BEFORE6, PREREG6_SHA256 } from './freeze.mjs';

export const CORPUS_SHA256 = 'a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9';
export const BASE_COMMIT = '3e35e4e274932a61bc0d92f378f8d506a9bb4ce0';
export const PREREG6 = 'experiments/nina-changes/preregistration.json';
export const RUNNER6_PINS = 'experiments/nina-changes/runners.sha256';
/** EXP 006's own files, then every jev-gate module it imports (directly or through another), then check.mjs (read by scrub6). */
export const RUNNER6_FILES = [
  'experiments/nina-changes/run_reviewer6.mjs', 'experiments/nina-changes/fence6.mjs', 'experiments/nina-changes/matrix6.mjs',
  'experiments/nina-changes/stream6.mjs', 'experiments/nina-changes/spend6.mjs', 'experiments/nina-changes/scrub6.mjs',
  'experiments/nina-changes/guard6.mjs', 'experiments/nina-changes/freeze.mjs', 'experiments/nina-changes/vendored-exp005.mjs',
  'experiments/nina-changes/diff-seen.mjs', 'experiments/nina-changes/fingerprints.mjs', 'experiments/nina-changes/base-lines.mjs',
  'experiments/nina-changes/change-fingerprints.json', 'experiments/nina-changes/base-lines.json', 'experiments/nina-changes/results6.mjs', 'experiments/nina-changes/spotlight-gate.mjs', 'experiments/nina-changes/matrix6-attempts.mjs',
  'experiments/nina-changes/denial-census.mjs', 'experiments/nina-changes/fixtures/fake-claude-stream.mjs',
  'experiments/jev-gate/run_reviewer.mjs', 'experiments/jev-gate/runner-guard.mjs', 'experiments/jev-gate/results.mjs',
  'experiments/jev-gate/metrics.mjs', 'experiments/jev-gate/lint.mjs', 'experiments/jev-gate/bce-contract.mjs',
  'scripts/check.mjs',
];

export const runner6CodeShas = (root = REPO_ROOT) => Object.fromEntries(RUNNER6_FILES.map(rel => [rel, sha256(readFileSync(join(root, rel)))]));
export const renderPins6 = shas => Object.entries(shas).map(([rel, h]) => `${h}  ${rel}\n`).join('');
export function readPins6(root = REPO_ROOT) {
  const path = join(root, RUNNER6_PINS);
  if (!existsSync(path)) refuse(`${RUNNER6_PINS} is missing`);
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { const [h, rel] = l.split('  '); return [rel, h]; }));
}

function refuse(message) {
  const error = new Error(`EXP 006 guard refused: ${message}`);
  error.code = 'EGUARD6';
  throw error;
}

export const MODES6 = ['counted', 'practice', 'probe', 'rehearsal'];

/**
 * Returns {prereg, amendment, amendment02, stamp}. `fixture` (tests) records fixture:true and skips the pin and freeze
 * checks; `rehearsalPins` {prereg6Sha256, notBefore} stand in for a null freeze in a rehearsal only.
 */
export function checkRun6({ mode, root = REPO_ROOT, now = new Date(), fixture = false, rehearsalPins = null, freeze = { PREREG6_SHA256, NOT_BEFORE6 } } = {}) {
  if (!MODES6.includes(mode)) refuse(`unknown mode ${mode}`);
  if (rehearsalPins && mode !== 'rehearsal') refuse('rehearsal pins are for a rehearsal only');
  if (fixture && mode === 'rehearsal') refuse('a rehearsal is a non-fixture dry check; do not combine it with fixture mode');
  // EXP 005's records, as published (the same guard EXP 005's runners call), practice mode: the counted clock and the
  // amendment-02 not-before are EXP 005's own and are not EXP 006's gate.
  const { prereg, amendment, stamp: s5 } = checkRecords({ root, mode: 'practice' });
  const a2Bytes = readFileSync(join(root, 'experiments/jev-gate/amendment-02.json'));
  if (sha256(a2Bytes) !== AMENDMENT_02_SHA256) refuse('experiments/jev-gate/amendment-02.json is not the published amendment 02');
  const amendment02 = JSON.parse(a2Bytes);
  if (sha256(readFileSync(join(root, 'experiments/jev-gate/corpus.sha256'))) !== CORPUS_SHA256) refuse('the corpus is not EXP 005\'s (corpus.sha256)');
  if (amendment.changes.reviewer.workspace.baseCommit?.sha !== BASE_COMMIT) refuse('amendment 01 does not pin EXP 005\'s base commit');

  const code = runner6CodeShas(root);
  const pinned = fixture ? null : readPins6(root);
  const codeMatches = pinned !== null && JSON.stringify(pinned) === JSON.stringify(code);
  if (!fixture && mode === 'counted' && !codeMatches) refuse(`the EXP 006 code differs from ${RUNNER6_PINS} (${Object.keys(code).filter(k => pinned[k] !== code[k]).join(', ') || 'file list'})`);
  if (mode === 'rehearsal' && !codeMatches) refuse(`a rehearsal runs the pinned code: the EXP 006 code differs from ${RUNNER6_PINS}`);

  let prereg6Sha256 = null, notBefore = null, rehearsal = false;
  if (mode === 'counted' && !fixture) {
    if (!freeze.PREREG6_SHA256 || !freeze.NOT_BEFORE6) refuse('counted runs wait for the freeze: PREREG6_SHA256 and NOT_BEFORE6 in freeze.mjs are null');
    ({ prereg6Sha256, notBefore } = checkFrozen(root, now, freeze));
  } else if (mode === 'rehearsal') {
    rehearsal = true;
    if (freeze.PREREG6_SHA256 && freeze.NOT_BEFORE6) ({ prereg6Sha256, notBefore } = checkFrozen(root, now, freeze));
    else {
      if (!/^[0-9a-f]{64}$/.test(rehearsalPins?.prereg6Sha256 ?? '') || !Number.isFinite(Date.parse(rehearsalPins?.notBefore))) refuse('a rehearsal before the freeze needs rehearsalPins {prereg6Sha256, notBefore}');
      ({ prereg6Sha256, notBefore } = rehearsalPins);
      if (!(now.getTime() > Date.parse(notBefore))) refuse('the rehearsal not-before is not in the past');
    }
  }
  return {
    prereg, amendment, amendment02,
    stamp: {
      fixture, rehearsal, mode: mode === 'rehearsal' ? 'counted' : mode, prereg6Sha256, notBefore, code, codeMatchesPins: codeMatches,
      parentSha256: s5.parentSha256, amendmentSha256: s5.amendmentSha256, amendment02Sha256: AMENDMENT_02_SHA256,
      corpusSha256: CORPUS_SHA256, baseCommit: BASE_COMMIT,
    },
  };
}

/** Refuses unless every pinned file exists under `root` and hashes to its pin. */
export function checkPinned6(files, root = REPO_ROOT) {
  for (const [rel, want] of Object.entries(files)) {
    if (!existsSync(join(root, rel))) refuse(`the EXP 006 pre-registration pins ${rel}, which is missing`);
    const have = sha256(readFileSync(join(root, rel)));
    if (have !== want) refuse(`the EXP 006 pre-registration pins ${rel} at ${want}; it hashes to ${have}`);
  }
}

function checkFrozen(root, now, freeze) {
  const path = join(root, PREREG6);
  if (!existsSync(path)) refuse(`${PREREG6} is missing`);
  const got = sha256(readFileSync(path));
  if (got !== freeze.PREREG6_SHA256) refuse(`${PREREG6} hashes to ${got}, not the frozen ${freeze.PREREG6_SHA256}`);
  // Every file the pre-registration pins must still hash to its pin (the classifier, scorer, runner, spotlight gate…).
  checkPinned6(JSON.parse(readFileSync(path, 'utf8')).files ?? {}, root);
  const nb = Date.parse(freeze.NOT_BEFORE6);
  if (!Number.isFinite(nb) || !/Z$/.test(freeze.NOT_BEFORE6)) refuse(`NOT_BEFORE6 ${freeze.NOT_BEFORE6} is not an ISO 8601 UTC time`);
  if (!(now.getTime() > nb)) refuse(`it is ${now.toISOString()}, not after the EXP 006 not-before ${freeze.NOT_BEFORE6}`);
  return { prereg6Sha256: got, notBefore: freeze.NOT_BEFORE6 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--write-pins')) {
    writeFileSync(join(REPO_ROOT, RUNNER6_PINS), renderPins6(runner6CodeShas()));
    console.log(`wrote ${RUNNER6_PINS}`);
    process.exit(0);
  }
  try {
    const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'counted';
    const { stamp } = checkRun6({ mode });
    console.log(JSON.stringify({ ok: true, ...stamp, code: undefined }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}
