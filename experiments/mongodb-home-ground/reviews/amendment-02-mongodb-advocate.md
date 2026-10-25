MongoDB advocate, EXP 020 amendment 02 (the S2 pairing rule)

Reviewer: an independent model reviewer (Claude, fresh context), read-only, 2026-10-25, before S2's verdict was computed; told not to open S2's result files. The brief it reviewed: the rule and the paragraph verbatim from the odin-rnd orchestrator's mm-036, plus the interim ordering the runner's owner had posted earlier. Published verbatim.

(1) THE RULE: ACCEPT.
This is the A11 rule that both EXP 021 advocates agreed on. It drops the per-repetition best-of-two, which takes the lower of two noisy samples in every pair and so tilts toward PostgreSQL. Picking one variant per scale and keeping it for both seeds and for the component tie-break is consistent. Judging the gate per variant matches the verdict.py fix. Choosing the variant on seed-1 and then comparing on the same seed-1 data still leans slightly toward PostgreSQL, because the lowest of the candidate medians is chosen. That lean is small, and PREREG does say "best variant", so I accept it. Two clarifications should go into the amendment text. They do not change the decision:
- Ties: if two candidates have the same selection median, pick the one with the lower seed-1 mean of the per-cell lag p95.
- Symmetry: MongoDB has one arm, so it must pass every counted cell at a scale, on both seeds. That is the same standard PostgreSQL's chosen variant meets.

(2) THE PARAGRAPH: VETO, narrow. Replace the third sentence with this:
"The interim seed-1 results seen were the order of the lag p95 medians: pgoutput lowest, then MongoDB, then the outbox. The same seed-1 results that select the variant are then used in the comparison, which leans slightly toward PostgreSQL. We chose the rule the EXP 021 advocates of both sides had already agreed was fair (EXP 021 FREEZE-NOTES-v1.1, A11). We did not write a new rule with this data in view, although the choice to adopt A11 here was made with it in view."
Reason: the brief says the interim order is disclosed, but the paragraph does not state it. Also, "rather than one picked with the data in view" can be read as saying the data played no part in the decision. Keep the other sentences as written.

(3) THE SECONDARY ANALYSIS must also report the following:
- The selection numbers for every candidate at each scale: the seed-1 median of the per-cell lag p95, and the gate result for each cell on each seed. This includes any variant that was excluded, with the reason.
- Each PostgreSQL variant compared with MongoDB on its own, under the full verdict rule, for both seeds. A reader can then see the result whichever variant had been chosen.
- Whether choosing on seed 2 would have picked the same variant (a stability check).
- Whether the verdict under the protocol's per-repetition best differs from the primary verdict, stated in one line.
- The component counts for each variant.
