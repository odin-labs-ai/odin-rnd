PostgreSQL advocate, EXP 020 amendment 02 (S2 pairing). I did not open any S2 result file.

Reviewer: an independent model reviewer (Claude, fresh context), read-only, 2026-10-25, before S2's verdict was computed. The brief it reviewed: the rule and the paragraph verbatim from the odin-rnd orchestrator's mm-036, plus the interim ordering the runner's owner had posted earlier. Published verbatim.

(1) THE RULE: ACCEPT.
Picking the best of two noisy samples in each repetition biases the result toward PostgreSQL. Both EXP 021 advocates rejected that for this reason (FREEZE-NOTES-v1.1, A11), and I agree. PREREG compares against "the other store's best variant". A single variant, chosen by its median, meets that wording honestly. The per-repetition minimum does not, because it splices two different designs together.

The gate is judged per variant, on every cell and both seeds. That holds PostgreSQL to the same standard as MongoDB's single arm.

Using the same variant for the component tie-break is also fair. A deployment runs one design, so PostgreSQL may not take its lag from pgoutput and its component count from the outbox.

Choosing on seed-1 data and then comparing on seed 1 slightly favours PostgreSQL, because the chosen variant's seed-1 numbers are lucky by selection. Seed 2 is a test on data the choice never saw, so this is acceptable. I do not ask for anything more in PostgreSQL's favour.

(2) THE PARAGRAPH: VETO, on completeness only. As written, it does not say which rule it replaces or what was seen. Without that, a reader cannot tell which way any bias could run. Exact rewording (keep the text and add these two sentences after "...selects using seed-1 results."):

> It replaces PROTOCOL-S2.md's pairing (per repetition, the better passing PostgreSQL variant), which favours PostgreSQL. The interim seed-1 results seen were: pgoutput had the lowest median lag p95, then MongoDB, then the outbox.

(3) The secondary analysis must also report, labelled and never deciding a verdict:
- the gate outcome for every PostgreSQL variant in every cell, on both seeds;
- for each scale, the selection statistic for each candidate (the median of seed-1 per-cell p95), so readers can check the choice;
- each passing PostgreSQL variant run on its own against MongoDB under the unchanged verdict rule, as well as the per-repetition best;
- the component count of each variant, with the checklist items listed;
- the variant that a seed-2-based selection would have picked, and whether it matches the seed-1 choice;
- a one-line statement of whether the verdict at each scale differs between the primary rule, the per-repetition best and each single variant.
