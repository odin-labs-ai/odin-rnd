// EXP 006's spotlight decision, AUTOMATIC and pre-registered (R2-7; the pre-registration's spotlightDecision): a
// spotlight-decision record with held: false is written if and only if the bar PASSES, the manipulation check PASSES
// and an independent results refute SHIPped (named here); otherwise held: true, naming every condition that failed.
// Nobody chooses held. Not pinned: whether nina's entry shows is still decided only by the pinned spotlight-gate.mjs,
// which re-checks this record's fields (kind, resultsSha256, reviewerSha256, a boolean held) against the results and
// the reviewer run record bytes; this file writes exactly those fields, plus the reason, the date and the refute.
//
//   node experiments/nina-changes/write-decision6.mjs [--refute-ship <refute report sha or id>] [--decided-on YYYY-MM-DD]
//   node experiments/nina-changes/write-decision6.mjs --dir <scratch> --rehearsal [--refute-ship <id>]
//
// The results in the directory are first recomputed by the frozen scorer (write-results6 check6) and must match their
// bytes, so the decision is made on the committed record exactly.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../jev-gate/runner-guard.mjs';
import { checkDecision, gateFromBytes } from './spotlight-gate.mjs';
import { check6, FILES, isCommittedDir, RESULTS_DIR, sha256 } from './write-results6.mjs';
import { lintRecord6 } from './scrub6.mjs';

/** A refute report's sha or id: a short token, never prose (it is published). */
export const REFUTE_REF = /^[A-Za-z0-9][A-Za-z0-9._:#/-]{2,119}$/;

function refuse(message) {
  const error = new Error(`write-decision6 refused: ${message}`);
  error.code = 'EDECISION6';
  throw error;
}

/**
 * The conditions of the pre-registered rule, each {id, met, failed}: `failed` is the plain sentence the results page
 * shows when the condition is not met. Read only from the results record and the named refute.
 */
export function conditions6(results, refuteShip = null) {
  const m = results.manipulation;
  return [
    { id: 'complete', met: results.partial === null, failed: 'the run is partial, and a partial run decides nothing' },
    { id: 'bar', met: results.partial === null && results.spotlight?.verdict === 'PASS', failed: `the bar was not met (${(results.spotlight?.reasons ?? []).join('; ') || results.spotlight?.verdict})` },
    { id: 'manipulation', met: m?.state === 'PASS', failed: m?.state === null || m?.state === undefined ? 'the manipulation check was not decided (partial run)' : `the manipulation check failed: ${m.blind} of ${m.countedRuns} runs were diff-blind, more than the ${m.maxBlindRuns} of ${m.denominator} allowed` },
    { id: 'eligible', met: results.spotlightEligible === true, failed: 'the results record does not mark the spotlight eligible' },
    { id: 'refute', met: typeof refuteShip === 'string' && REFUTE_REF.test(refuteShip), failed: 'no independent results refute SHIP is named yet' },
  ];
}

/** The decision record for these bytes. held is false only when every condition is met. */
export function decide6({ resultsBytes, reviewerBytes, refuteShip = null, decidedOn }) {
  if (refuteShip !== null && !REFUTE_REF.test(refuteShip)) refuse(`--refute-ship ${JSON.stringify(refuteShip)} is not a refute report sha or id`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn ?? '') || !Number.isFinite(Date.parse(decidedOn))) refuse(`decidedOn ${decidedOn} is not a YYYY-MM-DD date`);
  const results = JSON.parse(resultsBytes);
  if (results?.kind !== 'results' || results.experiment !== 'EXP 006') refuse('not an EXP 006 results record');
  const conds = conditions6(results, refuteShip);
  const failed = conds.filter(c => !c.met);
  const held = failed.length > 0;
  // Eligibility is the bar and the manipulation check together: named only when it is the one that failed.
  const named = failed.some(c => c.id !== 'eligible') ? failed.filter(c => c.id !== 'eligible') : failed;
  const decision = {
    schemaVersion: 1, kind: 'spotlight-decision', resultsSha256: sha256(resultsBytes), reviewerSha256: sha256(reviewerBytes), held,
    reason: held
      ? `Held by the pre-registered rule: ${[...new Set(named.map(c => c.failed))].join('; ')}.`
      : `Not held, by the pre-registered rule: the bar PASSES, the manipulation check PASSES (${results.manipulation.blind} of ${results.manipulation.countedRuns} runs diff-blind, at most ${results.manipulation.maxBlindRuns} allowed), and the independent results refute SHIPped (${refuteShip}).`,
    decidedOn,
    refute: refuteShip === null ? null : { verdict: 'SHIP', ref: refuteShip },
  };
  checkDecision(resultsBytes, decision); // the fields the pinned gate requires, checked by the gate's own function
  // The two shas were computed here from the bytes (EXP 006 amendment 01, A1); the refute token is scanned like any text.
  const findings = lintRecord6(decision, 'spotlight-decision.json', [[['resultsSha256'], decision.resultsSha256], [['reviewerSha256'], decision.reviewerSha256]]);
  if (findings.length) refuse(`the decision leaks: ${findings.join('; ')}`);
  return decision;
}

/** Recomputes the results in `dir`, decides, writes spotlight-decision.json. Returns {decision, gate}. */
export function writeDecision6({ root = REPO_ROOT, dir = RESULTS_DIR, refuteShip = null, decidedOn = new Date().toISOString().slice(0, 10), rehearsal = false } = {}) {
  if (rehearsal && isCommittedDir(root, dir)) refuse(`a rehearsal decision is never written into ${RESULTS_DIR}; pass --dir <scratch>`);
  const { bytes, reviewerBytes, record } = check6({ root, dir });
  if (Boolean(record.rehearsal) !== rehearsal) refuse(record.rehearsal ? 'the results are a rehearsal: pass --rehearsal' : '--rehearsal was given for results that are not a rehearsal');
  const decision = decide6({ resultsBytes: bytes, reviewerBytes, refuteShip, decidedOn });
  const at = resolve(root, dir);
  writeFileSync(join(at, FILES.decision), `${JSON.stringify(decision, null, 2)}\n`);
  const decisionBytes = readFileSync(join(at, FILES.decision));
  return { decision, gate: gateFromBytes({ resultsBytes: bytes, decisionBytes, reviewerBytes }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const valued = ['--dir', '--refute-ship', '--decided-on'];
  const bad = argv.filter((a, i) => a.startsWith('--') && ![...valued, '--rehearsal'].includes(a) && !valued.includes(argv[i - 1]));
  if (bad.length) { console.error(`usage: write-decision6.mjs [--refute-ship <id>] [--decided-on YYYY-MM-DD] [--dir <results dir> --rehearsal] (unknown ${bad.join(' ')})`); process.exit(2); }
  try {
    const dir = at('--dir') ?? RESULTS_DIR;
    if (!existsSync(join(resolve(REPO_ROOT, dir), FILES.results))) throw new Error(`write-decision6 refused: no results record in ${dir}`);
    const { decision, gate } = writeDecision6({ dir, refuteShip: at('--refute-ship') ?? null, decidedOn: at('--decided-on'), rehearsal: argv.includes('--rehearsal') });
    console.log(`wrote ${join(dir, FILES.decision)}: held ${decision.held}. ${decision.reason}`);
    console.log(`the pinned gate: ${gate.shown ? 'OPEN (nina\'s entry renders)' : `closed — ${gate.reason}`}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
