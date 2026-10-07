// EXP 007 amendment 01 (founder: "Amend, then re-call once (Recommended)"): which census rules may be re-called, once.
// The rule lives in experiments/blueprint-floor/amendment-01.json (pinned by sha256 in freeze.mjs once published); this
// module only applies it. It is pinned in runners.sha256, and both the runner (--mode recall) and the gate import it, so
// they cannot disagree about eligibility.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AMENDMENT_PATH = 'experiments/blueprint-floor/amendment-01.json';
export const ATTEMPT2_DIR = 'experiments/blueprint-floor/census-attempt-2';
const sha256 = text => createHash('sha256').update(text).digest('hex');

/** The amendment record under `root`, or null when the file is absent. */
export const loadAmendment = root => (existsSync(join(root, AMENDMENT_PATH)) ? JSON.parse(readFileSync(join(root, AMENDMENT_PATH), 'utf8')) : null);

/**
 * Is this committed attempt-1 census record eligible for the one re-call? Only when its translator call ended with the
 * amendment's harness failure (nonzero-exit), its raw client output is byte for byte the amendment's message (which
 * begins with the stable prefix), and the recorded rawSha256 is that text's sha256. Anything else is not eligible.
 */
export function isEligibleForRecall(rec, amendment) {
  const e = amendment?.eligibility;
  const t = rec?.translator;
  if (!e || typeof e.message !== 'string' || !e.message.startsWith(e.messagePrefix) || sha256(e.message) !== e.messageSha256) return false;
  if (!t || t.called !== true || t.lost) return false;
  return t.harnessFailure === e.harnessFailure
    && typeof t.raw === 'string' && t.raw === e.message
    && t.rawSha256 === sha256(t.raw)
    && t.classAfterMechanical === 'error';
}

/**
 * Refute A1 N1: a usage-limit refusal by the client ("You've hit your ... limit", printed as the whole answer with a
 * non-zero exit). The runner stops its invocation at the first one, so a limit cannot burn through the remaining rules.
 */
export const isClientLimitRefusal = call => call?.harnessFailure === 'nonzero-exit' && typeof call.raw === 'string' && /^You've hit your [^\n]*limit/.test(call.raw);

/**
 * Refute A1 N2: the recomputed eligible set must be exactly the set the amendment pins (the attempt-1 translator call
 * ids, sorted, and their sha256). Returns the problems (empty when it matches).
 */
export function eligiblePinProblems(eligibleRecords, amendment) {
  const pinned = amendment?.eligibility?.eligibleCallIds;
  const got = eligibleRecords.map(r => r?.translator?.callId).sort();
  if (!Array.isArray(pinned)) return ['the amendment pins no eligible set'];
  if (sha256(JSON.stringify(pinned)) !== amendment.eligibility.eligibleCallIdsSha256) return ['the pinned eligible set does not match its sha256'];
  if (JSON.stringify(got) !== JSON.stringify(pinned)) return [`the eligible set (${got.length}) is not the ${pinned.length} attempt-1 calls the amendment pins`];
  return [];
}
