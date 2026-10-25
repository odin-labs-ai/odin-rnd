# Lab 02 v1.1: how the review round of the runner protocol was resolved

v1 (`8e55a4bb`, PREREG sha256 `905df050…`) was frozen but not yet published. Building its runner (private commit `66a6e072`)
surfaced 12 ambiguities, written up as A1–A12 in `runner/PROTOCOL-LAB02.md`. Both advocates reviewed them, fresh and
read-only: `reviews/v1.1-mongodb-advocate.md` (4 vetoes) and `reviews/v1.1-postgresql-advocate.md` (2 vetoes), both
verbatim. Every veto is accepted. Where the two disagree, this file says who decides and why. No cell had run when
this was written; the smoke cells come after.

## The one disagreement: the tuned PostgreSQL cell (A2)
- **The MongoDB advocate:** accept the literal floor 20 / 1 / 3, provided false failovers count (its V3).
- **The PostgreSQL advocate (veto V1):** 20 / 1 / 3 is a validator floor, not a production setting, and buys nothing:
  detection is about ttl - loop_wait / 2, so about 18 s at 20 / 4 / 8 against about 19.5 s at 20 / 1 / 3. Its proposed
  rule: "the most aggressive documented, supported setting" on both arms.
- **Resolved: 20 / 4 / 8**, with 20 / 1 / 3 as a labelled line (a steady cell + F1). Each advocate decides its own
  arm's best realistic design, 20 / 4 / 8 is the value the frozen PREREG expected and both advocates predicted with,
  and MongoDB's frozen 5000 / 1000 already meets the restated rule. V3 is adopted anyway (below), so the tuned cells
  on both arms carry their false-failover risk.

## Accepted, in both reviews or by one without objection
| | Resolution |
|---|---|
| A1 / MDB V4 | F3's compared number: the median over the 8 threads of the longest ack gap that ends in (t_fault, hold end]. The literal "fault to first ack" is published too. F1 / F2a / F2b keep the literal rule. |
| A3 | One arm passes the gate and the other fails: the passing arm fits, labelled `gate-only`. PostgreSQL's gate is judged per variant (below). |
| A4 | (a) a fault verdict is gate + outage only; components are their own verdict. (b) "same direction" on seed 2 = the median of the 5 paired differences has the winner's sign. (c) the reproduction is all 5 repetitions on seed 2. |
| A5 | Retention is charged on both arms: MongoDB keeps its oplog-window alarm; PostgreSQL gains a physical-slot WAL-retention alarm. `outbox-growth-alarm` is dropped (the outbox is the proof table). `idempotency-key` is counted on neither arm (the same mechanism on both). Both counts are published with every entry. |
| A6 | F1b's MongoDB supervisor is a 1 s restart loop (the systemd equivalent), not a component; F1b stays labelled. |
| A7 | All PostgreSQL feed variants run in every PostgreSQL cell. Plus one labelled block bounding that overhead: outbox only, `wal_level=replica`, no slots, F1 at both timings, 5 repetitions on seed 1. |
| A8 | PostgreSQL's accepted-never-acked count is made exact: before the heal in F2a / F2b, the old primary (now a standby that cannot reach the leader, not yet rewound) is read for this cell's ids. Both arms' numbers then sit in one column, both exact. |
| A9, A10, A12 | As proposed: an unrecovered thread is an infinite outage (the cell is valid, never re-run); HAProxy only with `--labelled`; the durable-acknowledgement rules R3 / R4 define "acknowledged". |
| A11 / MDB V1 | Not the best of two per repetition (both advocates: a min of two noisy samples tilts toward PostgreSQL). One PostgreSQL variant per (timing, fault): among the variants that pass **every** cell on both seeds, the lowest median of the seed-1 repetition medians; it is used for all pairs on both seeds. The same rule picks one feed variant per scenario. The per-repetition best is still published. |
| MDB V2 | The change-stream consumer keeps one `MongoClient` per process and re-opens `watch(start_after=token)` on resume; it is closed on exit. |
| MDB V3 | False failovers count: ≥ 1 false failover in an arm's steady cell at a timing means that arm cannot get `-fits` at that timing (its lines become `both-fit`, flagged `unstable`). A steady cell's gate failure fails that arm's gate at that timing. |
| MDB R9 / PG V2 | "Caught up" is time on both arms: lag ≤ 1 s (PostgreSQL: `replay_lag` from the leader). PostgreSQL's full redundancy also requires, on every replica, the permanent slot present, `pending_restart` false, and `synchronous_standby_names` listing both standbys; that time counts in time-to-redundancy. |

## Code findings (fixed before the smoke cells)
- `verdict.py`: PostgreSQL passed the gate when each repetition had *some* passing variant. Now a variant passes only
  if all its cells on both seeds pass.
- `lab02_client.py`: `NotPrimaryError` (11602 / 91 can follow a local apply) is ambiguous; a PostgreSQL connect-phase
  failure (nothing sent) is not. Both affect diagnostic counts only; the readback decides the gate.
- `measures.py`: `ack_gaps` is bounded to (t_fault, hold end].
- The manifest records the effective MongoDB server-selection wait under CSOT (5 s, capped by `timeoutMS`, not the
  PREREG's 30 s).

## Recorded and published (not vetoes)
- The etcd leader at each fault (a killed node that also leads etcd changes detection to about ttl + 1 s).
- The libpq dead-host cost (`connect_timeout` 2 s per reconnect when the dead host is listed first), in the
  rediscovery split.
- **The single-copy window (raised by the PostgreSQL advocate, for fairness to MongoDB):** the smoke cells check the
  new primary's `synchronous_standby_names` in its first seconds and log acks made while it was empty. If any appear,
  the compared PostgreSQL variant becomes `synchronous_mode_strict: true` (strict ANY 1 has majority's durability in
  three nodes and does not block while one standby lives).

## Predictions
Both advocates updated theirs in their reviews (published, verbatim). The v1 predictions stay in PREREG v1 in git
history; v1.1's predictions section quotes both updates.
