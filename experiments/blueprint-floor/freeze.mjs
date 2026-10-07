// EXP 007 frozen constants (WO-2-01). They live ONLY here, and this file is pinned ONLY in
// experiments/blueprint-floor/runners.sha256, never in the pre-registration (no circular pin).
//   PREREG_SHA256: the sha256 of experiments/blueprint-floor/preregistration.json as published (its .sha256 file and the
//     served copy at https://odin-labs-ai.github.io/odin-rnd/data/blueprint-floor/preregistration.json agree).
//   NOT_BEFORE: the merge time of the odin-rnd pull request that published it (odin-rnd #25, merge commit 292ccac1), read
//     with: gh pr view 25 -R odin-labs-ai/odin-rnd --json mergedAt   ->   {"mergedAt":"2026-10-03T12:09:42Z"}
// The census guard (census-guard.mjs) refuses every practice and counted call while either is null, and every counted
// call that does not start strictly after NOT_BEFORE.
export const PREREG_SHA256 = 'ee56929ab38de831d618a41b9a2f359d814fc01849d273060e590669e94c9edb';
export const NOT_BEFORE = '2026-10-03T12:09:42Z';
export const SERVED_URL = 'https://odin-labs-ai.github.io/odin-rnd/data/blueprint-floor/preregistration.json';

// EXP 007 amendment 01 (re-call once the 37 translator calls the client's monthly spend limit refused). Both stay null
// until the amendment is published on odin-rnd main: AMENDMENT01_SHA256 = the sha256 of the published
// experiments/blueprint-floor/amendment-01.json, AMENDMENT01_NOT_BEFORE = the merge time of the odin-rnd pull request that
// adds it (gh pr view <n> -R odin-labs-ai/odin-rnd --json mergedAt). While either is null, --mode recall refuses.
export const AMENDMENT01_SHA256 = null;
export const AMENDMENT01_NOT_BEFORE = null;
export const SERVED_AMENDMENT01_URL = 'https://odin-labs-ai.github.io/odin-rnd/data/blueprint-floor/amendment-01.json';
