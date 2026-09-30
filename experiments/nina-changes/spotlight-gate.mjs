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

/**
 * The gate from the records' bytes (null for a missing file). Anything missing, unparseable, unbound or failing gives
 * {shown:false, reason}. Open: {shown:true, results, decision, measuredOn} (the run's endedAt, for the markup).
 */
export function gateFromBytes({ resultsBytes, decisionBytes, reviewerBytes = null }) {
  if (!resultsBytes) return closed('no results record');
  if (!decisionBytes) return closed('no spotlight decision record');
  let results, decision, run = null;
  try { results = JSON.parse(resultsBytes); } catch { return closed('the results record is not JSON'); }
  try { decision = JSON.parse(decisionBytes); } catch { return closed('the spotlight decision is not JSON'); }
  try { checkDecision(resultsBytes, decision); } catch (error) { return closed(error.message); }
  if (!entryShown({ results, decision })) return closed('the gate is closed: bar, manipulation check, eligibility or held');
  try { run = reviewerBytes ? JSON.parse(reviewerBytes) : null; } catch { return closed('the reviewer run record is not JSON'); }
  if (!run?.endedAt) return closed('no measured date in the reviewer run record');
  return { shown: true, reason: null, results, decision, measuredOn: run.endedAt };
}

/** The one entry point: read the committed records under `root` and decide. */
export function gateOpen(root = '.') {
  const bytes = rel => (existsSync(join(root, rel)) ? readFileSync(join(root, rel)) : null);
  return gateFromBytes({ resultsBytes: bytes(RESULTS_PATH), decisionBytes: bytes(DECISION_PATH), reviewerBytes: bytes(REVIEWER_RUN_PATH) });
}
