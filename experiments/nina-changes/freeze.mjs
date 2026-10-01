// EXP 006 frozen constants (R4-3). They live ONLY here, and this file is pinned ONLY in
// experiments/nina-changes/runners.sha256, never in the pre-registration (no circular pin). Both stay null until
// WO-2-01 freezes them after the EXP 006 pre-registration is published: the sha256 of the published
// preregistration.json, and its not-before = the odin-rnd merge time (gh mergedAt). While either is null the guard
// refuses every counted run.
export const PREREG6_SHA256 = null;
export const NOT_BEFORE6 = null;
// EXP 006 amendment 01 (A5): counted runs require the amendment too. The sha256 of the published
// experiments/nina-changes/amendment-01.json, and ITS not-before = the merge time of the odin-rnd pull request that adds
// it (gh mergedAt), which replaces NOT_BEFORE6 as the clock every counted call must start after. Both stay null until
// the re-freeze after the amendment is published; while any of the four constants is null every counted run refuses.
export const AMENDMENT6_SHA256 = null;
export const AMENDMENT6_NOT_BEFORE = null;
