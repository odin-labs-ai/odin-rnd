# EXP 020 S2 runner protocol (fixed before any counted cell)

The pre-registration (odin-rnd EXP 020, publish `0af2c486`; here `../PREREG.md`, sha256 `83f35a8c…`) freezes the S2
question, arms, gate, primary metric and verdict rule. This file fixes what the PREREG left to the runner. It is
committed and posted to this lab **before** the first counted S2 cell, and any later change is a dated amendment.

## Definitions
- **Events:** each carries an id (`<tag>-<i>`), the producer's clock time `t`, and a 2,048-byte payload.
  - The **effect** of an event is one sink row / document keyed by its id, with `n` (the times applied) and
    `t_applied`.
  - Producer and consumer run in the same client container, so lag uses one clock.
- **Scales:** 1× = **20 events/s**, 10× = **200 events/s**.
  - Both are below the host's measured sync ceiling (`pg_test_fsync`: `fdatasync` ≈ 540 ops/s), so lag is not a
    disk-throughput test.
  - The producer uses 8 writer threads, each event scheduled at t0 + i / rate. The rate met is recorded as
    `start_late_p95_ms`.
- **Exactly once, the same on every arm:**
  - Each consumer writes the effect and its cursor in **one transaction**: the MongoDB resume token; the pgoutput LSN;
    the outbox (xid8, seq).
  - After a crash it resumes from that cursor: MongoDB with `startAfter`; pgoutput skips data at or below the
    committed LSN; the outbox runs `(xid, seq) > cursor AND xid < pg_snapshot_xmin(pg_current_snapshot())`.
- **Frozen consumer settings:**
  - MongoDB: `watch([$match insert])`, `maxAwaitTimeMS = 200`, `batchSize = 100`; the post-batch resume token is
    persisted while idle.
  - pgoutput: proto v1, one publication on the source table, flush feedback after each applied message.
  - Outbox: a 50 ms poll interval and a batch of 100.
- **Producer retries:** a write that fails (a database restart) reconnects and retries the same id. A duplicate-key
  error on a retry counts as the first attempt having committed.
- **The retention budget:** 990 MiB on both arms (MongoDB's minimum oplog size).
  - MongoDB: `replSetResizeOplog`.
  - PostgreSQL: `max_slot_wal_keep_size = 990MB`.
  - The outbox's retention is its own table, so it has no slot.
  - Readings at the start and at the end of the downtime: oplog bytes and window; slot retained bytes and
    `wal_status`.

## One cell (`s2_cell.py`)
| Phase | What happens | Counted | Smoke |
|---|---|---|---|
| A steady | the consumer runs, events at the scale's rate | 60 s | 10 s |
| B faults | events; the consumer is `kill -9`ed 3 times at seeded instants (restarted after 1 s); the database container is restarted once at a seeded instant (30–70 % into B) | 120 s | 30 s |
| C downtime | the consumer is stopped, events keep coming | **600 s** | 20 s |
| drain | until every event of A + B + C is applied | ≤ 900 s | ≤ 120 s |

- **Primary metric:** phase A's lag p95 (t_applied − t).
- **Gate:** lost = 0 and duplicated = 0 over phases B + C.
- **Seeds:** the fault instants come from `seed × 1000 + rep`.
- **A drain timeout is reported as such.** The events not applied count as lost.

## The cell plan
- **Size:** 3 arms (mongo, pgoutput, outbox) × 2 scales × 5 paired repetitions (seed 1), plus a reproduction on seed
  2 with the same matrix. That is **60 cells, about 15–17 minutes each**.
- **Order:** the arm order rotates by repetition (mongo → pgoutput → outbox, then pgoutput → outbox → mongo, …).
- **Pairing:** one pair = MongoDB against the **best PostgreSQL variant** of that repetition. Best is the lower lag
  p95 among the variants that pass the gate.
- **The verdict** follows PREREG: a ≥ 20 % median lag difference in ≥ 4 of 5 pairs, the same direction in the
  reproduction, else components (a difference of ≥ 2).
- **Smoke cells** (`--smoke`) are never counted, and their file names start with `smoke-`.

## Components per arm (the PREREG checklist; filled in by both advocates' rules, published with the result)
- **MongoDB:** replica set (`replSet` + `rs.initiate`), keyFile, oplog sizing, an oplog-window alarm, the cursor
  collection.
- **pgoutput:** `wal_level = logical` (a restart), a publication, a slot, `max_slot_wal_keep_size`, a slot-retention
  alarm, the cursor table.
- **Outbox:** an xid8 column + index, the cursor table, and a poll loop, plus an outbox-growth alarm (no cleanup job in
  this test).

## Runner amendments (dated, before any counted cell is kept)
Two cells counted on 2026-10-25 05:21–05:52 (`mongo-x1-rep0-seed1`, `pgoutput-x1-rep0-seed1`) are **discarded**:
filming overlapped them (`results/s2/DISTURBANCES.md`). The plan is stopped and restarts only after both amendments
below. No counted cell is kept from the code before them.

- **Amendment 01 (2026-10-25): the pgoutput cursor is the commit LSN.**
  - The first pgoutput cell **lost 1 event**. The consumer skipped changes at or below the last *change* LSN, but
    logical decoding streams transactions in commit order. With 8 concurrent writers, a transaction that started
    earlier can commit later, so its insert looked applied.
  - **Fix:** the cursor is the transaction's commit LSN (the Begin message's `final_lsn`), and a source transaction is
    applied whole.
  - **Check:** two 10× smoke cells, 0 lost / 0 duplicated. This was a runner bug, not a PostgreSQL behaviour.
- **Amendment 02 (2026-10-25): every arm applies in batches.**
  - At 10× (200 events/s), **all three consumers fell behind** with one apply transaction per event. Lag p50 was
    MongoDB 4.7 s, outbox 1.75 s and pgoutput 0.75 s. Phase A was then measuring per-transaction commit cost, not the
    change feed. That is a strawman for every arm, MongoDB's `w: majority, j: true` multi-document transaction most of
    all.
  - **Fix (the same structure on all arms):** apply up to `BATCH = 100` available events in **one** transaction, with
    the cursor at the batch's end:
    - MongoDB: the events of one change-stream batch (`try_next` until the batch ends), with a `bulk_write` and the
      last change's token;
    - outbox: one poll's rows, with the last (xid, seq);
    - pgoutput: committed source transactions, until 100 rows or until the stream is idle (`read_message`), with the
      last commit LSN; flush feedback is sent only after the apply commits.
  - Exactly-once is unchanged: the effects and the cursor are still in one transaction.
- **The disturbance rule:**
  - A counted cell that overlapped other heavy work on the host is discarded and re-run.
  - `results/s2/PAUSE` stops the plan between cells while such work runs.
- **Amendment 03 (2026-10-25): the producer's schedule starts after its payloads and connections exist.**
  - The producer built its 2,000 × 2 KB payloads one random character at a time, *inside* the timed window. So every
    event started late (start-late p95 1.3–38 s), and the rate arrived in bursts.
  - It hit both arms, MongoDB's far harder under the cell's load: its 10× producer needed 50.7 s for 10 s of events.
    Measured idle, MongoDB takes 4 ms per `w: majority, j: true` insert, and 8 threads manage ~957 inserts/s. So it
    was the harness, not the store.
  - **Fix:** seeded random bytes, hex-encoded (fast), and the writers are created before t0. The check, at 200
    events/s: start-late p95 34.6 ms (MongoDB) and 0 ms (PostgreSQL) before the writers moved out of the window.
- **The cell lock:** `results/s2/cell.lock` (pid) refuses a second cell on the stack. Two smoke cells once overlapped
  and shared tables; those files are marked invalid in `smoke-history/`.
- **Amendment 04 (2026-10-25): the MongoDB consumer applies once its locally buffered changes are exhausted.**
  - After amendment 02, the MongoDB arm flushed a batch only when `try_next()` returned `None`, which means an
    **empty getMore**. At 1× (20 events/s), every 200 ms await window caught a few events, so the batch filled
    towards 100 events: lag p50 2.5 s / p95 4.75 s, worse than at 10×.
  - **Fix:** apply when the cursor's local buffer is empty (PyMongo 4.10.1's `CommandCursor._data`, private but
    pinned). That is the rule pgoutput already follows (an idle stream).
  - **Check:** MongoDB at 1× 5.4 / 11.4 ms (p50 / p95), at 10× 11.3 / 29.3 ms. 0 lost, 0 duplicated.
  - **The clean smoke of 03 + 04, all arms** (seeds 45 / 46, uncounted): lag p95 at 1× / 10×:
    - MongoDB 11.4 / 29.3 ms;
    - pgoutput 3.1 / 26.2 ms;
    - outbox 51.9 / 52.9 ms.
    - Every cell 0 lost and 0 duplicated, through kills, a database restart and a downtime. Producers on schedule
      (start-late p95 0 ms).
