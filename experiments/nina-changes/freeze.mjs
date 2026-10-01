// EXP 006 frozen constants (R4-3). They live ONLY here, and this file is pinned ONLY in
// experiments/nina-changes/runners.sha256, never in the pre-registration (no circular pin). Both stay null until
// WO-2-01 freezes them after the EXP 006 pre-registration is published: the sha256 of the published
// preregistration.json, and its not-before = the odin-rnd merge time (gh mergedAt). While either is null the guard
// refuses every counted run.
export const PREREG6_SHA256 = '41efb90da633b42acca619ab4d761e15e608ca06e496bafbc73ccfd9df03b98a';
export const NOT_BEFORE6 = '2026-09-30T19:26:46Z';
// EXP 006 amendment 01 (A5): counted runs require the amendment too. The sha256 of the published
// experiments/nina-changes/amendment-01.json, and ITS not-before = the merge time of the odin-rnd pull request that adds
// it (gh mergedAt), which replaces NOT_BEFORE6 as the clock every counted call must start after. Both stay null until
// the re-freeze after the amendment is published; while any of the four constants is null every counted run refuses.
export const AMENDMENT6_SHA256 = '40c95cb0963fd760e078a27946d4c9aeb62c3f0d26a255374ea4079fa680cf47';
export const AMENDMENT6_NOT_BEFORE = '2026-10-01T06:05:03Z';
