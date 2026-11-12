Review: the MongoDB advocate (an independent model reviewer, Claude, fresh context), 2026-11-10, on the EXP 021 result page and amendment 03 drafts.

Inputs read: `RESULT-PAGE-DRAFT.md`, `AMENDMENT-03-DRAFT.md`, `PREREG.md`, `FREEZE-NOTES-v1.1.md`, `runner/PROTOCOL-LAB02.md` (verdict and components sections), `runner/lab02lib/verdict.py`, `runner/lab02_verdict.py`, `runner/lab02lib/components.py` (by calling `count`), `runner/results/lab02/VERDICT.json` (sha256 `d2e7a029…e9fb`, it matches), `DISTURBANCES.md` (its current version), `discarded/` (48 files), all 334 counted cell files, the 14 PostgreSQL smoke cells, `SHA256SUMS`, `plan.log`, `supervise.log`. Read only. Nothing else was written.

## What I checked, and what held
- **Every per-pair number (120 rows) matches `VERDICT.json` `pairs`.** The "not compared" variant column matches each cell's `result.compared.median`. The 20 F3 literal-outage rows match `result.outage.median`.
- **The selection medians are correct (all 16).** They are the median of the 5 seed-1 `result.compared.median`. The chosen variant is the lower one in all 8 scenarios.
- **Verdicts, gates, feeds, wins, reproduction medians and basis** match `VERDICT.json` for all 13 lines. `flags` is empty, so no `unstable` line exists.
- **The gates table is exact, row by row.**
  - MongoDB: 104 / 104 valid, 104 write-pass, 271105 acknowledged, 0 lost / phantom / dup-first / ambiguous, 234 rewritten.
  - classic-strict: 296414 acknowledged, 3030 single-copy acks in 2 windows, 257 rewritten.
  - quorum-strict: 350184 acknowledged, 12537 in 12 windows, 263 rewritten.
  - outbox-only: 24188 acknowledged, 1565 in 1 window.
- **The feed table is exact.** stream 101 / 104 (97 / 100 resumed), plain 50 / 104 and 52 / 116, outbox and slot all passing.
- **The steady cells:** all 14 pass with 0 false failovers.
- **The strict-switch smoke list matches the smoke files.** The only window is quorum default F1b: 236 acks, 10.0 s.
- **The components numbers match `VERDICT.json` `components`:** 4 / 12 kinds, 0 / 6 processes, pg_feed `slot`, all 16 items.
- **Amendment 03, counts:** 334 counted (320 fault + 14 steady), 7 `invalid/`, 20 smoke, 22 plan starts, 19 FAILED lines, 8 supervisor starts, 19 restarts. `SHA256SUMS` holds 6020 lines.
- **Amendment 03, hashes:** `VERDICT.json`, `SHA256SUMS` and `plan.log` match. Two do not (§5 below).

## What the MongoDB F2b cells say (the gate failure, exactly)
From `mongo-pss-*-F2b-*.json` → `result.gate` and `result.oracle`:
- **3 of the 20 F2b cells failed the gate.** At default, 2 of 10: `rep1-seed1` and `rep3-seed2`. At tuned, 1 of 10: `rep3-seed2`. (The task's "2 of 10" is right for default only. The page must give both timings.)
- **In each failing cell:**
  - `gate.write_pass` = true, and `oracle.lost.count` = 0 / `phantom.count` = 0 / `dup_first.count` = 0;
  - `gate.reasons` = "no feed variant passed (duplicated / missing / phantom effects)";
  - `oracle.feeds.stream.duplicated.count` = 1, with `missing` 0 and `phantom` 0.
  - The duplicated ids were `mira-39447ff0-1058`, `mira-baa96510-1124` and `mira-092b221c-1124`.
- **All 20 MongoDB F2b cells passed the write gate.** Every one had rolled-back writes (`accepted_later_rewritten` 7–9, `accepted_never_acked` 0). The failing cells had 9, 9 and 8, the same as the passing ones.
- **What the cells record about the consumer.** In each failing cell, `result.feed_events.stream` shows a `WTimeoutError` (code 50, MaxTimeMSExpired, on `w: majority, j: true`) on the consumer's own effect + token write, followed by a `resume`. Passing F2b cells show the same kinds of error. So the cell files do not, on their own, establish a mechanism beyond "a duplicated effect after a write-concern timeout and resume during the peer-only partition". The page should say no more than that.
- **Outage, as a fact the page already prints and should not leave implicit.** In all 20 F2b pairs MongoDB's compared outage was shorter than the chosen PostgreSQL variant's (per-pair tables). Under the frozen rule (A3) outages are not compared when exactly one arm passes the gate. The verdict is therefore correct as `postgres-fits`, `gate-only`.

## Result page, section by section

**What we asked / the arms / How we ran it / the strict switch / The rule: ACCEPT.** They agree with PREREG v1.1 and FREEZE-NOTES-v1.1 (A1, A2, A3, A4, A11, MDB V3) and with `verdict.py`. One wording fix to rule 5, AMEND:
> 5. Components are their own verdict: an arm fits with ≥ 2 fewer component kinds, given the gate. "The gate" is the arm's gate over every compared scenario (`lab02_verdict.py`: all `<timing>/<fault>` lines, F1b included, floor and overhead lines excluded); if exactly one arm passes it, that arm fits, labelled `gate-only` (A3).

**Result (headline and compared table): AMEND.** The numbers are right. Without a cause, though, "`postgres-fits` in 2 of 8" reads as an outage or durability result, and it is neither. Add directly under the headline:
> The 2 `postgres-fits` lines are `gate-only`: MongoDB failed the F2b gate on its feed, not on writes. In 3 of its 20 F2b cells (default: rep1-seed1, rep3-seed2; tuned: rep3-seed2) the change-stream feed recorded one effect twice (1 duplicated, 0 missing, 0 phantom). All 20 cells passed the write gate: 0 lost, 0 phantom acknowledged writes. Each failing cell's feed log shows a `w: majority` write-concern timeout on the consumer's effect write, then a resume. The cells do not establish the mechanism further. Under the frozen rule (FREEZE-NOTES-v1.1 A3) outages are not compared when one arm fails the gate. In all 20 F2b pairs MongoDB's outage was the shorter one (tables below).

**Labelled lines: ACCEPT.**

**Components: AMEND (exact text).** The draft line is accurate but incomplete in two ways that matter.
- It hides that the kind count went MongoDB's way by 8.
- It does not say how `slot` was picked. The runner takes the most-chosen PostgreSQL feed over all `<timing>/<fault>` lines. On the 8 compared lines that is a 4–4 tie (outbox: F1, F2a; slot: F2b, F3). The 2 labelled F1b lines (slot) broke the tie. FREEZE-NOTES-v1.1 A5 / PROTOCOL A5 froze the count as "PostgreSQL + outbox 9".

Replace the paragraph with:
> **Components (its own verdict): `postgres-fits`, `gate-only`.** This is decided by the gate, not by the count: MongoDB failed the F2b gate (its feed; above), and under the frozen rule an arm that alone passes the gate fits (A3, PROTOCOL "given the gate"). On kinds alone the rule's test (≥ 2 fewer) is met by MongoDB: 4 kinds against PostgreSQL's 12 with the `slot` feed, or 9 with the `outbox` feed (the count frozen in FREEZE-NOTES-v1.1 A5). Processes: MongoDB 0 extra, PostgreSQL 6 extra (3 Patroni, 3 etcd), either feed. The runner counted PostgreSQL with `slot`, the feed chosen most often over all `<timing>/<fault>` lines. The 8 compared lines split 4–4, and the 2 labelled F1b lines (slot) decided it. Data-bearing members cancel on both sides.

Keep both item lists. Add the outbox list (9) beside the slot list (12) from `components.count("pg", "outbox")`.

**Per-pair numbers: ACCEPT** (all 120 rows verified).

**What MongoDB did well: AMEND.** Replace the second bullet so that it carries the feed result honestly next to the write result:
> - **`pss` passed the write gate in all 104 of its counted cells**, with 0 lost acknowledged writes over 271105 acknowledged. Its change-stream feed passed 101 of 104; the 3 failures were one duplicated effect each, all in F2b (the cause of both `gate-only` lines).

Add:
> - **The shortest outage in every compared pair it was allowed to contest:** in the 6 `mongodb-fits` scenarios it was ≥ 20 % shorter in 30 of 30 seed-1 pairs, and the seed-2 sign agreed in all 6. Its F3 ack gap was 0.40–0.80 s against 3.46–10.60 s.

**What PostgreSQL did well: ACCEPT.** Optionally change "(– of 5 seed-1 pairs, gate-only)" to "(gate-only: MongoDB's feed failed the F2b gate)" for symmetry with the above.

**Gates: AMEND.** The single-copy numbers under strict are printed with no comment. After the pre-registered switch, the reader would expect them to be 0. They are not. 11 counted cells logged acknowledgements while the writable node's `synchronous_standby_names` was empty: 10 strict plus the labelled outbox-only cell. Most windows were 75–92 s long, and 3 of them are in the F2b cells of the `quorum-strict` variant that won F2b. Add under the single-copy line:
> These windows occurred after the strict switch: 15567 acknowledgements in 10 strict cells, 1 window each (the other 4 of the 14 windows logged no acknowledgement) (classic-strict default F1 rep1-seed1 and tuned F1 rep4-seed2; quorum-strict default F1 rep1-seed1, default F2b rep1-seed2 and rep3-seed1, floor F1 rep4-seed2, tuned F1 rep0-seed1 and rep4-seed2, tuned F1b rep1-seed2 (1 ack, 0.017 s), tuned F2b rep2-seed1), most of them 75–92 s long. The frozen gate counts lost writes, not single-copy acknowledgements, so no verdict changes, and no write was lost. Their cause (a real single-copy interval or an observer artefact) is not established by the cell files. Until it is, the claim that the strict PostgreSQL variants matched `w: majority`'s durability throughout is not shown by this run.

**Disturbances: VETO as drafted.** It reports 22 discards and leaves out 26 of the 48 files in `discarded/`. That includes 6 of the 7 MongoDB discards. The only MongoDB discard it shows is `mongo-pss-tuned-F1-rep3-seed1`. It omits `mongo-pss-default-F3-rep3-seed1`, `mongo-pss-tuned-F3-rep4-seed1`, `mongo-pss-tuned-F2a-rep4-seed1`, `mongo-pss-default-F3-rep0-seed2`, `mongo-pss-default-F2b-rep4-seed2` and `mongo-pss-tuned-F1b-rep4-seed2`. One of those is an F2b cell, the scenario MongoDB lost on the gate, so its discard and re-run must be visible. Lifted when the section carries what the current `DISTURBANCES.md` already reconciles:
- the summary table (2 + 16 + 4 + 6 + 20 = 48), with windows H and K–N;
- the open window I, with its five unresolved seed-2 files named;
- window J (the stop of every python.exe, no cell running);
- the 3 marked cells that left no file;
- the 7 `invalid/` files.

The "Checks" mismatch line then goes away, and the page should say "48 discarded counted-cell files, all re-run". The generator counted only the first three tables, so fix it or hand-edit the section.

**Limits: AMEND.** Add two bullets:
> - **Single-copy windows under strict** (see Gates): not gated by the frozen rule; cause not established.
> - **Window I is open:** five counted seed-2 PostgreSQL files (`pg-quorum-strict-default-F3-rep0-seed2`, `pg-classic-strict-default-{F1,F1b,F2a,F2b}-rep0-seed2`) may overlap sketch 7b's test suites; the operator has not given I's end time. None is a MongoDB cell and none is in F2b's compared variant, but the page must say so rather than imply a clean record.

**Checks: AMEND.** Resolve the mismatch with the reconciliation above. Also note that `DISTURBANCES.md` was edited after `SHA256SUMS` (current sha256 `c13174ec…0a6f`; `SHA256SUMS` has `f04fef34…9036`). Re-sum before publishing.

**Predictions: VETO (missing).** The page has no predictions table, and the PREREG froze predictions for this PC and both advocates. A pre-registered result page without them is not publishable. Lifted by adding this table (outcomes from `VERDICT.json`; ranges from the per-pair tables):

| Prediction (PREREG v1.1) | Who | Outcome | Right? |
|---|---|---|---|
| Gate passes on both arms | this PC; MongoDB advocate | MongoDB failed F2b (feed: 3 of 20 cells, one duplicated effect each); PostgreSQL passed | wrong |
| F1 `mongodb-fits`, default and tuned | all three | `mongodb-fits` at both | right |
| F2a `mongodb-fits`, default and tuned | all three | `mongodb-fits` at both | right |
| F2b `mongodb-fits`, default and tuned | all three | `postgres-fits`, `gate-only`, at both | wrong |
| F3 `both-fit` (leaning MongoDB, low) | this PC; MongoDB advocate | `mongodb-fits` at both | wrong |
| F3 `mongodb-fits` ~55 % / `both-fit` ~45 %, low | PostgreSQL advocate | `mongodb-fits` at both | right (its 55 % side) |
| Components `mongodb-fits`, high | all three | `postgres-fits`, `gate-only`; on kinds MongoDB 4 vs 12 (slot) / 9 (outbox) | wrong (on kinds: right) |
| Feed `both-fit` (outbox) | this PC; both advocates | no feed verdict exists in the rule; PostgreSQL outbox and slot passed every cell; MongoDB's stream failed 3 F2b cells | not testable as stated |
| F1 default: MongoDB ~11–16 s vs PostgreSQL ~30–42 s | MongoDB advocate | MongoDB 10.62–20.87 s, PostgreSQL (classic-strict) 25.55–36.59 s | partly |
| F1 default: ~11–13 s vs 23–33 s | PostgreSQL advocate | as above | partly |
| F1 tuned: MongoDB ~6–10 s vs PostgreSQL ~20–24 s | MongoDB advocate (review) | MongoDB 10.10–10.40 s, PostgreSQL (quorum-strict) 20.52–23.49 s | PostgreSQL right; MongoDB just above |
| F1 tuned: ~5.5–7 s vs 19–23 s | PostgreSQL advocate | as above | PostgreSQL right; MongoDB wrong |
| F3 gap: MongoDB ~1–3 s vs PostgreSQL ~2–6 s | MongoDB advocate (review) | MongoDB 0.40–0.80 s, PostgreSQL 3.46–10.60 s | wrong (both better / worse than said) |
| F1b (labelled): PostgreSQL shorter, moderate | MongoDB advocate (review) | `both-fit` at both timings (default: PostgreSQL ≥ 20 % shorter in 2 of 5; tuned: MongoDB in 1 of 5) | wrong as a verdict; PostgreSQL often shorter at default |

Also cite the v1 lines that PREREG keeps as frozen (MongoDB advocate v1: F1 tuned `both-fit`; components ~5 vs 14–15), marked as superseded by v1.1.

## Amendment 03, section by section
- **§1 The run: ACCEPT.**
- **§2 Cells: ACCEPT** (verified).
- **§3 Discards: VETO as drafted.** Same defect and same remedy as the page's Disturbances section. "22 counted cell runs" must become the 48-file reconciliation, by cause (2 / 16 / 4 / 6 / 20), with H, K–N, I (open), J, the 3 marked-no-file cells and all 7 MongoDB discards named.
- **§4 Restarts: AMEND.** Say it is a snapshot as of 15:25:34. `supervise.log` now has 3 more lines (15:25:34 the amendment draft, 15:25:37 the drafts commit `8508cd82…`, 15:25:37 "supervise done"), so "3 finish attempts" is out of date.
- **§5 Hashes: AMEND.**
  - `DISTURBANCES.md` is now `c13174ece428dc180232c3e3451607dd49a1d0ab05e01bd54f3a0d8a601a0a6f`. Its 15:29:06 reconciliation edit came after `SHA256SUMS` was made.
  - `supervise.log` is now `e5cc4e61ee03c52af61a7b38cb3388a2b07974932e2aa147c0922f2da19e820a`.
  - Re-sum `SHA256SUMS` and list the final hashes, or label the table "as of the 15:25 finish" and add the current two.
- **§6 Verdict as reported: AMEND.** After the two F2b lines and the components line, add "(MongoDB failed the F2b gate on its feed: one duplicated effect in 3 of 20 cells; 0 lost writes)".
- **Checks: AMEND.** As on the page.

## Vetoes
1. **Disturbances (page) and §3 (amendment):** 26 of 48 discards are left out, among them 6 of 7 MongoDB discards and one MongoDB F2b cell. Lifted by publishing the reconciliation.
2. **Predictions (page):** the frozen predictions are missing. Lifted by adding the table above.

No veto on the verdicts. Every compared, labelled and components verdict follows the frozen rule as implemented, including both `gate-only` lines and the `gate-only` components line.
