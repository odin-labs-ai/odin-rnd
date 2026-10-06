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
