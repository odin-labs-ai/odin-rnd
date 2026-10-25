# Freeze notes: how each advocate veto was handled (2026-10-25)

Both reviews are verbatim in `reviews/`. Every veto was accepted. Where the two reviewers differed, the resolution is
stated here and frozen in `PREREG.md`.

| # | From | Veto | Resolution in PREREG.md |
|---|---|---|---|
| P1 | PostgreSQL | S1: "json loses indexing" is false | **Accepted.** The draft's table and prediction were wrong: expression GIN / B-tree indexes on `(payload::jsonb …)` over a `json` column are legal. The PostgreSQL arm is `json` plus expression indexes, with a stored generated `jsonb` column as a second variant. |
| P2 | PostgreSQL | S2: the outbox is unspecified (a `bigserial` cursor drops late commits) | **Accepted.** A commit-order-safe outbox (an `xid8` horizon) plus a `pgoutput` logical-decoding arm. LISTEN/NOTIFY is a reference only. |
| P3 | PostgreSQL | S3: rule asymmetry | **Accepted.** "Append-only" means the **application role** cannot update or delete (a PostgreSQL REVOKE; a MongoDB custom role with find + insert). Server-side or owner-role expiry is allowed in both arms. Physical and visible lag are reported separately. |
| P4 / M5 | both | No primary metric, margin or component definition | **Accepted.** One primary metric per scenario, a 20 % median margin in ≥ 4 of 5 paired repetitions, reproduced. The component checklist is frozen, with a tie-break only at a difference of ≥ 2. |
| P5 | PostgreSQL | Image defaults are a strawman | **Accepted.** Equal explicit tuning on both arms: memory, cache, `shm`, `work_mem`, parallel workers. |
| P6 | PostgreSQL | Extension policy | **Accepted.** Pinned derived images are allowed; each extension counts as a component; a no-extension variant is always run. |
| M1 | MongoDB | S1 decode and placement | **Accepted.** The payload is a nested field; PyMongo 4.x decodes to `dict` (`RawBSONDocument` for the byte check); one serializer rule for both arms; the oracle uses dot-notation queries only. Both arms hash the bytes the client reads back (P1). |
| M2 | MongoDB | S3 grace must follow the configured interval | **Accepted.** Two cells: (a) default 60 s cadences, grace 150 s at 1× / 240 s at 10×; (b) tuned 5 s cadences, grace 30 s / 60 s. RBAC is MongoDB's append-only mechanism. |
| M3 | MongoDB | S2 retention must be equalised | **Accepted.** Oplog (`oplogMinRetentionHours` / size) and slot (`max_slot_wal_keep_size`) are set to the same disk budget for the frozen downtime. Lost history is classified the same way in both arms. A token-plus-effect transaction is allowed (and the PostgreSQL equivalent is too). |
| M4 | MongoDB | Storage path | **Accepted** (the PostgreSQL review asked for the same): named volumes on the WSL2 ext4 disk, never NTFS bind mounts. `pg_test_fsync` / `fio` and mongod's filesystem warning are recorded. |

## Where the reviewers differed
- **The margin.**
  - The MongoDB review proposed 20 % on the median, in 4 of 5 paired repetitions, reproduced. It argued against
    NOTE 003's 30 % bar, which was set for adding a new platform primitive; this study asks about fit.
  - The PostgreSQL review proposed no number, but asked that a component tie-break only fire at a difference of at
    least 2.
  - Both are adopted.
- **S5, failover** (MongoDB review). **Out of scope for this run, named as the next study.**
  - A fair PostgreSQL arm needs streaming replication with Patroni and etcd (at least 6 containers in all). On one
    10 GB Docker host that is a memory and stability risk to both arms.
  - It is MongoDB's home ground, so it is named explicitly. The run does not imply anything about it.
- **Search / vector search.** Not verified here, so out of scope. It is named next to S5 for the next study.
