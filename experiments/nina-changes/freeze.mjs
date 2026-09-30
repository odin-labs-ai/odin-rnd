// EXP 006 frozen constants (R4-3). They live ONLY here, and this file is pinned ONLY in
// experiments/nina-changes/runners.sha256, never in the pre-registration (no circular pin). Both stay null until
// WO-2-01 freezes them after the EXP 006 pre-registration is published: the sha256 of the published
// preregistration.json, and its not-before = the odin-rnd merge time (gh mergedAt). While either is null the guard
// refuses every counted run.
export const PREREG6_SHA256 = null;
export const NOT_BEFORE6 = null;
