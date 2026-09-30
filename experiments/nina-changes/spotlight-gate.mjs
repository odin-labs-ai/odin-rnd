// EXP 006's spotlight gate (refute r2 B1): the COMPLETE show/hide predicate for nina's entry, pinned by the
// pre-registration and re-checked by the counted guard, so what a PASS publishes cannot be changed without an
// amendment. The markup renderer (scripts/nina-changes-spotlight.mjs) imports this and holds no gate logic; its
// figures come from the results record.
//
// EXP 005's card gate `spotlightShown` is CARRIED byte-identical below (the R4-1 pattern; a slice test compares it with
// scripts/jev-gate-results-site.mjs at b2dbb1fd, committed as fixtures/exp005-b2dbb1fd/jev-gate-results-site.mjs.txt):
// that file is EXP 005's site renderer and is not pinned here, so importing it would leave the gate unpinned.
import { createHash } from 'node:crypto';

export const spotlightShown = data => data.results.spotlight.verdict === 'PASS' && data.decision?.held === false;

/**
 * Shown only when ALL hold: the results record's spotlight bar PASSES, its manipulation check PASSES, its
 * spotlightEligible is exactly true, and the committed decision says held, as a boolean, is false (EXP 005's gate
 * above, with the boolean made explicit). Anything missing, non-boolean or failing hides the entry.
 */
export const entryShown = data => Boolean(data?.results?.spotlight)
  && spotlightShown(data)
  && data.results.manipulation?.state === 'PASS'
  && data.results.spotlightEligible === true
  && typeof data.decision?.held === 'boolean' && data.decision.held === false;

/** The decision record must be a spotlight-decision on exactly these results bytes, with an explicit boolean held. */
export function checkDecision(resultsBytes, decision) {
  if (decision?.kind !== 'spotlight-decision') throw new Error('the spotlight decision is not a spotlight-decision record');
  const sha = createHash('sha256').update(resultsBytes).digest('hex');
  if (decision.resultsSha256 !== sha) throw new Error('the spotlight decision was made on another results record');
  if (typeof decision.held !== 'boolean') throw new Error('the spotlight decision must say explicitly (true or false) whether the spotlight is held');
  return decision;
}
