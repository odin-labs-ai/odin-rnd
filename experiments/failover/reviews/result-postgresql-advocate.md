Review: the PostgreSQL advocate (an independent model reviewer, Claude, fresh context), 2026-11-10, on the EXP 021 result page and amendment 03 drafts.

Read: `RESULT-PAGE-DRAFT.md`, `AMENDMENT-03-DRAFT.md`, `PREREG.md`, `FREEZE-NOTES-v1.1.md`, `runner/PROTOCOL-LAB02.md` (verdict section, A3 to A5), `runner/lab02lib/verdict.py`, `runner/lab02_verdict.py`, `runner/results/lab02/VERDICT.json` (sha256 `d2e7a029…e9fb`, matches), all 20 `mongo-pss-*-F2b-*.json`, every counted cell file (re-summed), the smoke cells, `discarded/`, `invalid/` and `DISTURBANCES.md`. Nothing was run except read-only scripts over the JSON.

## What I checked and found correct
- **Every per-pair number** in the 13 per-pair tables (MongoDB, the chosen and the not-compared PostgreSQL variant, F3's literal outages) against each cell's `result.compared.median` / `result.outage.median`: 0 mismatches.
- **The Result table**: gates, chosen variant, chosen feed, wins, reproduction medians and basis match VERDICT.json in all 8 rows. The selection medians I recomputed by hand for default/F1, default/F2b, default/F3 and tuned/F2b: all match.
- **The Gates, Accepted-never-acknowledged, Feeds and Steady tables**: re-summed over the 334 counted cells. All match: MongoDB 104 cells, 271105 acked, 0 lost, stream 101 of 104; classic-strict 104 / 296414 / 0, single-copy 3030 (2); quorum-strict 116 / 350184 / 0, single-copy 12537 (12); outbox-only 10 / 24188 / 0, single-copy 1565 (1); accepted-later-rewritten 234 / 257 / 263; plain 50 of 104 and 52 of 116.
- **Amendment 03 counts**: 334 counted = 320 fault + 14 steady; 22 plan starts (1 + 21 resumes); 19 FAILED lines; 8 supervisor starts, 19 restarts, 3 finish attempts; 20 smoke files; 7 `invalid/` files. VERDICT.json, plan.log and SHA256SUMS hashes match.

## The F2b cause, from the cells (`result.oracle` and `result.gate`)
- MongoDB failed the F2b gate in **3 of its 20 F2b cells: 2 of 10 at default** (`mongo-pss-default-F2b-rep1-seed1`, `mongo-pss-default-F2b-rep3-seed2`) **and 1 of 10 at tuned** (`mongo-pss-tuned-F2b-rep3-seed2`). The brief's "2 of 10" holds only at default. Each timing's verdict uses its own 10 cells, so each one fails on its own.
- In each of the 3: `gate.write_pass` true, `oracle.lost` 0, `phantom` 0, `dup_first` 0, `ambiguous` 0, `accepted_never_acked` 0, acked = present. The only failure is `oracle.feeds.stream.duplicated.count` = 1 (ids `mira-39447ff0-1058`, `mira-baa96510-1124`, `mira-092b221c-1124`), with 0 missing and 0 phantom. The gate reason is "no feed variant passed (duplicated / missing / phantom effects)".
- "After a rollback": every one of the 20 MongoDB F2b cells has `accepted_later_rewritten` 7 to 9 (`accepted_source` rollback-files), the 17 passing cells included. So a rollback happened in all 20. A duplicate appeared in 3 of them. The cells do not show that the rollback caused the duplicate. Stream resume was 28.06 s and 37.13 s in the two default failures and 0.0012 s in the tuned one.
- None of the 3 failing cells is a re-run of a discarded cell. All 3 are first runs, so selection by re-running cannot explain them.

## Per section of the result page

### What we asked / How we ran it (faults, timings, compared number): ACCEPT
These match PREREG v1.1 and FREEZE-NOTES-v1.1 (A1, A2).

### The strict switch: AMEND
The list leaves out the 6 non-strict smoke cells that showed 0 windows. The page also never says that the strict variants still showed single-copy windows in counted cells. Replace the last bullet with:
> - The other non-strict smoke cells (`quorum` default F1, F2a, F2b, F3, steady; `quorum` tuned F1): 0 windows.
> - So the rule fired, and the counted plan ran the strict variants. The non-strict numbers exist only as smoke context and never count.
> - **The strict variants still showed single-copy windows in counted cells.** The observer logged acknowledgements while the new primary's `synchronous_standby_names` was empty in 10 strict cells: `classic-strict` default F1 rep1 s1 and tuned F1 rep4 s2; `quorum-strict` default F1 rep1 s1, default F2b rep1 s2 and rep3 s1, tuned F1 rep0 s1 and rep4 s2, tuned F2b rep2 s1, and floor F1 rep4 s2. Each window lasted 75 to 92 s and covered 1505 to 2171 acks. One more, `quorum-strict` tuned F1b rep1 s2, lasted 0.017 s with 1 ack. The cells do not show the cause, which could be a real single-copy window or the observer reading the wrong node. No acknowledged write was lost in any of them. The frozen rule says nothing about single-copy windows after the switch, so they change no verdict.

### The rule (5 points): AMEND point 5 only
The frozen PREREG says only "≥ 2 fewer component kinds". The "given the gate" clause comes from `runner/PROTOCOL-LAB02.md` and `verdict.py`. Replace point 5 with:
> 5. Components are their own verdict: ≥ 2 fewer component kinds (PREREG). The runner protocol (`PROTOCOL-LAB02.md`, "given the gate"; `verdict.py` `components_verdict`) applies the gate first. An arm counts as failing it when it fails the gate in any compared scenario, and then the arm that passes fits, labelled `gate-only`.

### Result table (compared verdicts): ACCEPT the numbers, AMEND the F2b rows
The numbers are exact. But "fail / pass" with no reason lets a reader think MongoDB lost writes. Add directly under the table:
> **Why MongoDB fails the F2b gate (both timings):** its change-stream feed duplicated one effect in 2 of 10 default F2b cells and 1 of 10 tuned F2b cells, with 0 missing and 0 phantom. Its writes passed in all 20 F2b cells: 0 lost, 0 phantom, 0 duplicate-first. A rollback (7 to 9 rewritten writes) happened in all 20 cells, including the 17 that passed, so the cells do not show that the rollback caused the duplicate. PostgreSQL's two F2b wins are therefore feed-gate wins, not outage wins. On outage MongoDB was shorter in every F2b pair: ≤ 0.8 × PostgreSQL in 5 of 5 seed-1 pairs at default and 4 of 5 at tuned (rep 3: 0.807), with seed-2 median differences of −13.4819 s and −9.9683 s. Had its gate passed, the outage rule would have read `mongodb-fits` in both. This is published as context and is not a verdict.

### Labelled lines: AMEND one row
The `outbox-only` cells ran non-strict (`in_force.synchronous_mode_strict` false, quorum), while the compared variants are strict, and the row does not say so. In both `overhead:*` rows, change "What it is" to:
> feed-overhead block (outbox only, wal_level=replica, **non-strict quorum**, seed 1 only; so it bounds the slot feeds' cost only up to the strict / non-strict difference)

### Components: VETO as drafted; ACCEPT with this exact text
As drafted, "**Components (its own verdict): `postgres-fits`**" reads as a PostgreSQL win on components. On the frozen measure, PostgreSQL has 3 times MongoDB's kinds. I will not let my arm be credited with that. Replace the paragraph's first sentence with:
> **Components (its own verdict): `postgres-fits`, `gate-only`. This is not a component-count win for PostgreSQL.** By kinds, the frozen measure, MongoDB has 4 and PostgreSQL 12 with the `slot` feed (9 with the `outbox` feed, which also passed every PostgreSQL cell), so MongoDB has 8 (or 5) fewer kinds and the kinds rule alone would read `mongodb-fits`. The verdict is `postgres-fits` only because the runner applies the gate first (rule 5), and MongoDB failed the gate in `default/F2b` and `tuned/F2b` on the feed (one duplicated change-stream effect in 3 of 20 F2b cells; writes passed). Processes: MongoDB 0 extra, PostgreSQL 6 extra (3 Patroni, 3 etcd). Data-bearing members cancel on both sides.

Keep the two item lists unchanged. They match VERDICT.json.

### Per-pair numbers: ACCEPT
0 mismatches against the cells.

### What MongoDB did well: AMEND
The draft lists component kinds only under PostgreSQL, and MongoDB is the arm that did well there. Add:
> - **Fewest component kinds:** 4 against PostgreSQL's 12 (slot feed) or 9 (outbox), and 0 extra processes against 6. The components verdict is `postgres-fits` only through the gate (see Components).
> - **Shorter outage in every F2b pair** as well (see the note under the Result table). F2b went to PostgreSQL on the feed gate alone.

### What PostgreSQL did well: VETO two bullets; ACCEPT the rest
Replace the first bullet with:
> - **`postgres-fits` (`gate-only`) in 2 of 8 compared scenarios, `default/F2b` and `tuned/F2b`.** Both come from the feed gate: both variants' `outbox` and `slot` feeds passed every F2b cell, while MongoDB's change stream duplicated one effect in 3 of its 20. On outage PostgreSQL was slower in every F2b pair.

Delete the last bullet, "**Components: `postgres-fits`** (gate-only)". PostgreSQL did not do well on components. The verdict and its reason stay in the Components section.

Add, for honesty about what it did not do well:
> - **Not without a caveat:** the strict variants still logged single-copy windows in 11 counted cells (see The strict switch), with 0 lost acknowledged writes.

The remaining bullets (write gate 104 of 104 and 116 of 116, 0 false failovers, outbox and slot feeds 104 of 104 and 116 of 116) are exact. ACCEPT.

### Gates: ACCEPT
Re-summed exactly. Only the strict-switch text above is needed to explain the single-copy column.

### Disturbances: VETO as drafted; ACCEPT with this replacement
The draft discloses 22 of the 48 discarded counted-cell files. It leaves out window H (6, this lab's own agents' test suites), the LLM guard's 20 moves (H 1, K 6, L 4, M 3, N 6, among them `mongo-pss-default-F2b-rep4-seed2` and 3 PostgreSQL F2b cells), the open window I, the window J stop and the 3 marked cells that left no file. Its "Checks" section still shows the 22 / 48 mismatch. `DISTURBANCES.md` now reconciles all 48, so its hash differs from the one in amendment 03 (see below). Replace the "22 counted cell runs…" bullet and its table with a table built from `DISTURBANCES.md` → "Summary: every file in `discarded/`", plus these bullets:
> - **48 counted cell runs were discarded and re-run** (all kept in `discarded/`): 2 for foreign heavy work seen by the lab; 16 for other sessions' unleased heavy work (A 8, B 3, C 5); 4 for model loads found by hand (D, E, F, G); 6 for this lab's own agents running test suites (H); and 20 moved by the LLM guard for a model load inside a cell (H 1, K 6, L 4, M 3, N 6). The per-window cell lists are in `DISTURBANCES.md`.
> - **Open, window I** (sketch 7b's agents' test suites, 11-08 22:45 onwards, end time not recorded): 5 counted files that were not discarded have mtimes inside it: `pg-quorum-strict-default-F3-rep0-seed2` and `pg-classic-strict-default-{F1,F1b,F2a,F2b}-rep0-seed2`. Whether they overlapped heavy work cannot be decided from the record. One of them, `pg-classic-strict-default-F1-rep0-seed2` (35.1979 s), is a compared seed-2 value. Removing it would not change any verdict's sign.
> - **Window J** (11-09 about 01:32): every python.exe on the PC stopped, including the plan. No cell was running and nothing was discarded.
> - **3 marked cells left no file** (logged "done but no file"). The plan re-ran them as pending.
> - None of MongoDB's 3 failing F2b cells is a re-run of a discarded cell.

Then delete the "Checks" section or make it empty. It must not be published with an open mismatch.

### Limits: AMEND (add one bullet)
> - **Strict did not remove the observer's single-copy windows.** 11 counted strict cells logged acks while `synchronous_standby_names` was empty, with 0 losses and the cause not established (see The strict switch).

The rest: ACCEPT. That includes the bullet about the selection leaning toward PostgreSQL, which is fair.

### Predictions: AMEND (the section is missing)
PREREG requires the frozen predictions to be scored. Add before "Disturbances":
> ## Predictions (frozen) against the result
> | Who | Prediction | Result | Right? |
> |---|---|---|---|
> | This PC | gate passes on both arms | MongoDB failed the F2b gate (feed) at both timings | no |
> | This PC | F1 / F2a / F2b `mongodb-fits`, default and tuned | F1, F2a `mongodb-fits`; F2b `postgres-fits` `gate-only` | F1, F2a yes; F2b no |
> | This PC | F3 `both-fit` | `mongodb-fits` at both timings | no |
> | This PC | feed `both-fit` (outbox) | no separate feed verdict; outbox passed every PostgreSQL cell, stream 101 of 104 | partly |
> | This PC | components `mongodb-fits` | `postgres-fits` `gate-only` (kinds 4 vs 12 favour MongoDB) | no by verdict, yes by kinds |
> | MongoDB advocate (v1.1) | F1 default `mongodb-fits`, about 11–16 s against 30–42 s | `mongodb-fits`; MongoDB 10.62–20.87 s, PostgreSQL (classic-strict) 25.55–36.59 s | verdict yes; ranges roughly |
> | MongoDB advocate (v1.1) | F1 tuned `mongodb-fits` | `mongodb-fits` | yes |
> | MongoDB advocate (v1.1) | F2a / F2b as F1 | F2a yes; F2b `postgres-fits` `gate-only` | F2a yes; F2b no |
> | MongoDB advocate (v1.1) | F3 `both-fit`, leaning MongoDB | `mongodb-fits` | no (leaning right) |
> | MongoDB advocate (v1.1) | components `mongodb-fits` | `postgres-fits` `gate-only` | no by verdict, yes by kinds |
> | PostgreSQL advocate (v1.1) | F1 / F2a / F2b `mongodb-fits`; tuned about 5.5–7 s against 19–23 s | F1, F2a yes; F2b `postgres-fits` `gate-only`; tuned F1 MongoDB 10.10–10.40 s, PostgreSQL (quorum-strict) 20.52–23.49 s | F1, F2a yes; F2b no; MongoDB's tuned magnitude no (about 10 s, not 5.5–7) |
> | PostgreSQL advocate (v1.1) | F3 `mongodb-fits` about 55 % / `both-fit` about 45 % | `mongodb-fits` | yes |
> | PostgreSQL advocate (v1.1) | feed `both-fit` | as for this PC | partly |
> | PostgreSQL advocate (v1.1) | components `mongodb-fits`, high | `postgres-fits` `gate-only` | no by verdict, yes by kinds |
> Nobody predicted a MongoDB feed failure in F2b. The v1 lines (PREREG, kept as frozen) are published in PREREG.md and are not re-scored here.

### Sources: ACCEPT
Add one row: "F2b gate cause | `mongo-pss-*-F2b-*.json` → `result.oracle.feeds.stream.duplicated`, `result.oracle.accepted_later_rewritten`, `result.gate.write_pass`, `result.gate.reasons`".

## Per section of amendment 03

### §1 The run: AMEND (add one bullet)
> - **Stopped without a FAILED line:** 2026-11-09 about 01:32 (window J, `DISTURBANCES.md`). Every python.exe on the PC stopped, the plan included, while it waited between cells on the shared PAUSE. The operator resumed it at 01:35:39.

Otherwise ACCEPT. The resume and stop lines, their counts and the cell UTC span are consistent with plan.log.

### §2 Cells: ACCEPT
334 = 320 + 14, 20 smoke, 7 invalid (5 smoke, 2 counted). All checked.

### §3 Discards: VETO as drafted; ACCEPT with the same replacement as the page's Disturbances
Replace "22 counted cell runs" and its table with the 48-file summary and the window I / J / marked-cell bullets above. Delete the mismatch line.

### §4 Restarts: ACCEPT
8 / 19 / 3 checked against the listed lines.

### §5 Hashes: AMEND
The current sha256 of `DISTURBANCES.md` is `c13174ece428dc180232c3e3451607dd49a1d0ab05e01bd54f3a0d8a601a0a6f` (the draft has `f04fef34…`). The current sha256 of `supervise.log` is `e5cc4e61ee03c52af61a7b38cb3388a2b07974932e2aa147c0922f2da19e820a` (the draft has `5699fc7c…`). Both files changed after the draft was made. Publish the hashes of the versions the final page cites, and re-hash `SHA256SUMS` if it is regenerated. VERDICT.json, plan.log and SHA256SUMS match today.

### §6 Verdict as reported: AMEND one line
Change "components: `postgres-fits` (gate-only)." to:
> components: `postgres-fits` (gate-only: MongoDB failed the F2b feed gate; by kinds MongoDB 4, PostgreSQL 12 with slot / 9 with outbox, which alone would read `mongodb-fits`).

### Checks: VETO while the mismatch line stands
Resolve it as in §3.

## Vetoes (must be resolved before publishing)
1. Page Components paragraph and the "Components: `postgres-fits`" bullet under "What PostgreSQL did well": they credit PostgreSQL with a component win that comes only from MongoDB's F2b feed gate.
2. Page "What PostgreSQL did well", first bullet: the F2b wins must be stated as feed-gate wins, with PostgreSQL slower on outage in every pair.
3. Page Disturbances and amendment §3: they disclose 22 of the 48 discards and leave out H, the LLM guard's moves K to N, the open window I and window J.
4. Page and amendment "Checks": an open mismatch must not be published.
