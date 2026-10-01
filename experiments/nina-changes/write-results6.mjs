// EXP 006 WO-3-02: the results record, written from the committed run by the frozen scorer. Not pinned: it computes
// nothing itself. It reads the counted reviewer run record (results/reviewer.json), the committed answer-key pre-flight
// record, EXP 005's records through the EXP 006 guard, the labels and the committed fingerprints, calls the pinned
// computeResults6, runs the pinned publication check, and writes results/results.json (JSON, two-space indent, the
// scorer's own key order, a trailing newline) plus results/preflight.json, the byte copy of the pre-flight record the
// scorer bound. The same function recomputes for --check and for the build, so the committed bytes are always what the
// frozen scorer gives for the committed run.
//
//   node experiments/nina-changes/write-results6.mjs [--preflight <record>]              write (counted, after the freeze)
//   node experiments/nina-changes/write-results6.mjs --check                             recompute; byte-equal or exit 1
//   node experiments/nina-changes/write-results6.mjs --dir <scratch> --rehearsal         a rehearsal, marked, never publishable
//   node experiments/nina-changes/write-results6.mjs --partial                           a partial counted run (decides nothing)
//
// A fixture run record is always refused. A rehearsal record is refused without --rehearsal, and a rehearsal is never
// written into the committed results directory. A partial run is refused without --partial: it is published only as
// "decides nothing", and asking for that is explicit.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../jev-gate/runner-guard.mjs';
import { checkRun6, PREREG6 } from './guard6.mjs';
import { assertPublishable6, computeResults6 } from './results6.mjs';
import { headerDigests6 } from './run_reviewer6.mjs';
import { lintRecord6 } from './scrub6.mjs';
import { DECISION_PATH, RESULTS_PATH, REVIEWER_RUN_PATH } from './spotlight-gate.mjs';

export const RESULTS_DIR = dirname(RESULTS_PATH);
export const PREFLIGHT_PATH = `${RESULTS_DIR}/preflight.json`;
export const PREREG6_PIN = 'experiments/nina-changes/preregistration.sha256';
export const FINGERPRINTS = 'experiments/nina-changes/change-fingerprints.json';
export const LABELS = 'experiments/jev-gate/labels.json';
export const FILES = { results: 'results.json', reviewer: 'reviewer.json', preflight: 'preflight.json', decision: 'spotlight-decision.json' };
// The file names inside a results directory are the pinned gate's (results, reviewer run, decision), never retyped.
for (const [k, p] of [['results', RESULTS_PATH], ['reviewer', REVIEWER_RUN_PATH], ['decision', DECISION_PATH]]) if (join(RESULTS_DIR, FILES[k]) !== p) throw new Error(`write-results6: ${p} is not in ${RESULTS_DIR}`);

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const renderResults6 = record => `${JSON.stringify(record, null, 2)}\n`;

function refuse(message) {
  const error = new Error(`write-results6 refused: ${message}`);
  error.code = 'ERESULTS6';
  throw error;
}

const abs = (root, p) => (isAbsolute(p) ? p : join(root, p));
/** True when `dir` is the committed results directory of `root`. */
export const isCommittedDir = (root, dir) => resolve(abs(root, dir)) === resolve(root, RESULTS_DIR);

/** The EXP 006 pre-registration, checked against its committed pin (preregistration.sha256). */
export function loadPrereg6(root = REPO_ROOT) {
  const bytes = readFileSync(join(root, PREREG6));
  const pin = readFileSync(join(root, PREREG6_PIN), 'utf8').split(/\s+/)[0];
  if (sha256(bytes) !== pin) refuse(`${PREREG6} does not hash to its pin in ${PREREG6_PIN}`);
  return { record: JSON.parse(bytes), sha256: pin };
}

/**
 * Scores the run record in `dir` (default: the committed results directory) with the frozen scorer. Returns
 * {record, bytes, preflightBytes, reviewerBytes}. `preflightFrom` is the pre-flight record to bind (default: the copy
 * already in `dir`). Refuses a fixture record always, a rehearsal without `rehearsal`, a partial run without
 * `allowPartial`, anything the scorer or the publication check refuses, and a record whose text leaks (lintRecord6).
 */
export function score6({ root = REPO_ROOT, dir = RESULTS_DIR, preflightFrom = null, rehearsal = false, allowPartial = false } = {}) {
  if (rehearsal && isCommittedDir(root, dir)) refuse(`a rehearsal is never written into ${RESULTS_DIR}; pass --dir <scratch>`);
  const at = abs(root, dir);
  const reviewerFile = join(at, FILES.reviewer);
  if (!existsSync(reviewerFile)) refuse(`no reviewer run record at ${join(dir, FILES.reviewer)}`);
  const reviewerBytes = readFileSync(reviewerFile);
  const run = JSON.parse(reviewerBytes);
  if (run?.fixture !== false) refuse('the reviewer run record is a FIXTURE; a fixture is never scored for publication');
  if (Boolean(run.rehearsal) !== rehearsal) refuse(run.rehearsal ? 'the reviewer run record is a rehearsal: pass --rehearsal (the output is marked and unpublishable)' : '--rehearsal was given for a run record that is not a rehearsal');
  const partialRefusal = reasons => `the run is partial (${reasons}); a partial run decides nothing and is written only with --partial`;
  if (run.partial && !allowPartial && !rehearsal) refuse(partialRefusal(run.partial.reason ?? 'the runner stopped'));
  const preflightFile = preflightFrom ? abs(root, preflightFrom) : join(at, FILES.preflight);
  if (!existsSync(preflightFile)) refuse(`no pre-flight record at ${preflightFrom ?? join(dir, FILES.preflight)}`);
  const preflightBytes = readFileSync(preflightFile);

  // EXP 005's records, the EXP 006 code pins and (counted) the freeze, through the guard the runner itself called.
  const { prereg, amendment, stamp } = rehearsal
    ? checkRun6({ mode: 'rehearsal', root, rehearsalPins: { prereg6Sha256: run.prereg6Sha256, amendment6Sha256: run.amendment6Sha256, notBefore: run.notBefore } })
    : checkRun6({ mode: 'counted', root });
  const fingerprintBytes = readFileSync(join(root, FINGERPRINTS));
  const record = computeResults6({
    exp005: { prereg, amendment }, bar6: loadPrereg6(root).record.bar, labels: JSON.parse(readFileSync(join(root, LABELS), 'utf8')), run,
    fingerprints: JSON.parse(fingerprintBytes), fingerprintsSha256: sha256(fingerprintBytes), stamp, preflight: JSON.parse(preflightBytes),
  });
  if (record.partial !== null && !allowPartial && !rehearsal) refuse(partialRefusal(record.partial.map(p => p.reason).join(', ')));
  if (rehearsal) {
    if (record.rehearsal !== true) refuse('a rehearsal must produce a record marked rehearsal');
    let publishable = true;
    try { assertPublishable6(record); } catch { publishable = false; }
    if (publishable) refuse('a rehearsal record passed the publication check');
  } else assertPublishable6(record);
  const bytes = Buffer.from(renderResults6(record));
  // EXP 006 amendment 01 (A1): only digests computed here are exempt from the restricted-term scan. The results header
  // carries the guard's own record and code shas (the runner's headerDigests6 of this stamp); the pre-flight record's
  // runnersSha256 and sha256 were just recomputed and checked by the scorer (checkPreflightForScoring).
  const preflight = JSON.parse(preflightBytes);
  for (const [name, value, digests] of [['results.json', record, headerDigests6(stamp, prereg)], ['preflight.json', preflight, [[['runnersSha256'], preflight.runnersSha256], [['sha256'], preflight.sha256]]]]) {
    const findings = lintRecord6(value, name, digests);
    if (findings.length) refuse(`${name} leaks: ${[...new Set(findings)].slice(0, 5).join('; ')}`);
  }
  return { record, bytes, preflightBytes, reviewerBytes };
}

/** Writes results.json (and the pre-flight copy) into `dir`. Committed results are immutable: different bytes refuse. */
export function write6(opts = {}) {
  const { root = REPO_ROOT, dir = RESULTS_DIR } = opts;
  const out = score6(opts);
  const at = abs(root, dir);
  const target = join(at, FILES.results);
  if (existsSync(target) && !readFileSync(target).equals(out.bytes)) refuse(`${join(dir, FILES.results)} exists with other bytes; results are written once (use --check)`);
  mkdirSync(at, { recursive: true });
  writeFileSync(target, out.bytes);
  const preflightTarget = join(at, FILES.preflight);
  if (!existsSync(preflightTarget)) writeFileSync(preflightTarget, out.preflightBytes);
  else if (!readFileSync(preflightTarget).equals(out.preflightBytes)) refuse(`${join(dir, FILES.preflight)} exists with other bytes`);
  return { ...out, sha256: sha256(out.bytes) };
}

/**
 * Recomputes the results in `dir` and asserts byte equality with the written results.json. Rehearsal and partial are
 * read from the written record itself (a check reproduces what was written, and still refuses a rehearsal in the
 * committed directory). Returns {record, bytes, sha256}.
 */
export function check6({ root = REPO_ROOT, dir = RESULTS_DIR } = {}) {
  const target = join(abs(root, dir), FILES.results);
  if (!existsSync(target)) refuse(`no results record at ${join(dir, FILES.results)}`);
  const written = readFileSync(target);
  const parsed = JSON.parse(written);
  const out = score6({ root, dir, rehearsal: parsed.rehearsal === true, allowPartial: parsed.partial !== null });
  if (!out.bytes.equals(written)) refuse(`${join(dir, FILES.results)} differs from what the frozen results6.mjs computes from the committed run`);
  return { ...out, sha256: sha256(written) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const known = new Set(['--dir', '--preflight', '--rehearsal', '--partial', '--check']);
  const bad = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && !['--dir', '--preflight'].includes(argv[i - 1]));
  if (bad.length) { console.error(`usage: write-results6.mjs [--dir <results dir>] [--preflight <record>] [--rehearsal] [--partial] [--check] (unknown ${bad.join(' ')})`); process.exit(2); }
  const dir = at('--dir') ?? RESULTS_DIR;
  try {
    if (argv.includes('--check')) {
      const { sha256: digest } = check6({ dir });
      console.log(`PASS ${join(dir, FILES.results)} recomputes byte for byte (sha256 ${digest})`);
    } else {
      const { sha256: digest, record } = write6({ dir, preflightFrom: at('--preflight') ?? null, rehearsal: argv.includes('--rehearsal'), allowPartial: argv.includes('--partial') });
      console.log(`wrote ${join(dir, FILES.results)} (sha256 ${digest})${record.rehearsal ? ' — REHEARSAL, unpublishable' : ''}; bar ${record.spotlight.verdict}, manipulation ${record.manipulation.state ?? 'none (partial)'}, spotlight eligible ${record.spotlightEligible}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
