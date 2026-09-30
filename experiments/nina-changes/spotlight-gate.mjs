// EXP 006's spotlight gate (refute r2 B1, r3 B1): the ONLY place that decides whether nina's entry shows, pinned by
// the pre-registration and re-checked by the counted guard. It owns every gating input: the results and decision
// paths, reading them, the decision-results sha256 binding and the predicate, all behind one entry point, gateOpen(root).
// The markup renderer (scripts/nina-changes-spotlight.mjs, unpinned) renders only what gateOpen returns.
//
// EXP 005's card gate `spotlightShown` is CARRIED byte-identical below (the R4-1 pattern; a slice test compares it with
// scripts/jev-gate-results-site.mjs at b2dbb1fd, committed as fixtures/exp005-b2dbb1fd/jev-gate-results-site.mjs.txt):
// that file is EXP 005's site renderer and is not pinned here, so importing it would leave the gate unpinned.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREREG6_SHA256 } from './freeze.mjs';
import { assertPublishable6 } from './results6.mjs';

export const RESULTS_PATH = 'experiments/nina-changes/results/results.json';
export const DECISION_PATH = 'experiments/nina-changes/results/spotlight-decision.json';
export const REVIEWER_RUN_PATH = 'experiments/nina-changes/results/reviewer.json';

export const spotlightShown = data => data.results.spotlight.verdict === 'PASS' && data.decision?.held === false;

/**
 * The predicate: the results record's spotlight bar PASSES, its manipulation check PASSES, its spotlightEligible is
 * exactly true, and the decision says held, as a boolean, is false (EXP 005's gate above, the boolean made explicit).
 */
export const entryShown = data => Boolean(data?.results?.spotlight)
  && spotlightShown(data)
  && data.results.manipulation?.state === 'PASS'
  && data.results.spotlightEligible === true
  && typeof data.decision?.held === 'boolean' && data.decision.held === false;

/** The decision must be a spotlight-decision on exactly these results bytes, with an explicit boolean held. */
export function checkDecision(resultsBytes, decision) {
  if (decision?.kind !== 'spotlight-decision') throw new Error('the spotlight decision is not a spotlight-decision record');
  const sha = createHash('sha256').update(resultsBytes).digest('hex');
  if (decision.resultsSha256 !== sha) throw new Error('the spotlight decision was made on another results record');
  if (typeof decision.held !== 'boolean') throw new Error('the spotlight decision must say explicitly (true or false) whether the spotlight is held');
  return decision;
}

const closed = reason => ({ shown: false, reason, results: null, decision: null, measuredOn: null });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The gate from the records' bytes (null for a missing file) and the frozen constants (freeze.mjs by default; tests
 * inject a synthetic freeze the way the rehearsal does, never by committing one). It opens only for a REAL, COMPLETE,
 * COUNTED EXP 006 measurement under THIS frozen pre-registration (refute r4 B1), all of:
 *   the results record: kind "results", experiment "EXP 006", fixture false, not a rehearsal, partial null, its
 *     prereg6Sha256 equal to the frozen PREREG6_SHA256 (which must be set), and EXP 005's publication gate passing;
 *   the decision: a spotlight-decision naming these results bytes by sha256 AND the reviewer run record by sha256
 *     (decision.reviewerSha256 — the chosen binding), with a boolean held;
 *   the reviewer run record: bound as above, not fixture, not a rehearsal, the same prereg6Sha256, with an endedAt
 *     (the "Measured" date comes only from it);
 *   and the predicate entryShown.
 * Anything else gives {shown:false, reason}. Open: {shown:true, results, decision, measuredOn}.
 */
export function gateFromBytes({ resultsBytes, decisionBytes, reviewerBytes = null, freeze = { PREREG6_SHA256 } }) {
  if (!resultsBytes) return closed('no results record');
  if (!decisionBytes) return closed('no spotlight decision record');
  if (!reviewerBytes) return closed('no reviewer run record');
  let results, decision, run;
  try { results = JSON.parse(resultsBytes); } catch { return closed('the results record is not JSON'); }
  try { decision = JSON.parse(decisionBytes); } catch { return closed('the spotlight decision is not JSON'); }
  try { run = JSON.parse(reviewerBytes); } catch { return closed('the reviewer run record is not JSON'); }
  if (results?.kind !== 'results') return closed('the results record is not kind "results"');
  if (results.experiment !== 'EXP 006') return closed('the results record is not EXP 006\'s');
  if (results.fixture !== false) return closed('the results record is a fixture');
  if (results.rehearsal) return closed('the results record is a rehearsal');
  if (results.partial !== null) return closed('the results record is partial');
  if (!freeze?.PREREG6_SHA256) return closed('the pre-registration is not frozen (freeze.mjs PREREG6_SHA256 is null)');
  if (results.prereg6Sha256 !== freeze.PREREG6_SHA256) return closed('the results were made under another pre-registration than the frozen one');
  try { assertPublishable6(results); } catch (error) { return closed(`the results record is not publishable: ${error.message}`); }
  try { checkDecision(resultsBytes, decision); } catch (error) { return closed(error.message); }
  if (decision.reviewerSha256 !== sha256(reviewerBytes)) return closed('the spotlight decision does not name this reviewer run record');
  if (run?.fixture !== false) return closed('the reviewer run record is a fixture');
  if (run.rehearsal) return closed('the reviewer run record is a rehearsal');
  if (run.prereg6Sha256 !== results.prereg6Sha256) return closed('the reviewer run record was made under another pre-registration');
  if (!run.endedAt) return closed('no measured date in the reviewer run record');
  if (!entryShown({ results, decision })) return closed('the gate is closed: bar, manipulation check, eligibility or held');
  return { shown: true, reason: null, results, decision, measuredOn: run.endedAt };
}

/** The one entry point: read the committed records under `root` and decide, under the committed freeze.mjs. */
export function gateOpen(root = '.') {
  const bytes = rel => (existsSync(join(root, rel)) ? readFileSync(join(root, rel)) : null);
  return gateFromBytes({ resultsBytes: bytes(RESULTS_PATH), decisionBytes: bytes(DECISION_PATH), reviewerBytes: bytes(REVIEWER_RUN_PATH) });
}
