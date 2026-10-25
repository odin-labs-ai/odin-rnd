# PostgreSQL advocate review of DESIGN.md (the design draft)

Reviewer: an independent model reviewer (Claude, fresh context), briefed to make sure PostgreSQL gets its best
realistic design and to veto strawmen. 2026-10-25, before the freeze. Kept verbatim; how each veto was handled is in
`../FREEZE-NOTES.md`.

## Summary
The study is worth running and the framing is honest. As drafted, though, it handicaps PostgreSQL in four ways:
- **A factual error in S1.** The prediction says "`json` loses indexing", which is false.
- **A loss trap in S2.** The outbox is unspecified, and a plain identity cursor drops rows by design.
- **A rule that favours MongoDB in S3.** The append-only rule is written so a partition drop or an owner-role delete
  could count as a "bypass", while MongoDB's TTL deletes would not.
- **Gaps that decide verdicts.** There is no primary metric or margin, no definition of a component, and no server
  tuning (the image defaults are a strawman).

These are fixable before the design is frozen. The vetoes below say how.

## Per scenario

**S1, order-preserving records.**
- **Best PostgreSQL design:** keep the payload in a `json` column. `json` stores the exact input text, so key order,
  whitespace and duplicate keys survive. Index it with expressions on that column:
  - `CREATE INDEX ON ev USING gin ((payload::jsonb) jsonb_path_ops)` for `@>` / `@?` queries;
  - B-tree indexes on `((payload::jsonb #>> '{a,b}'))` for equality and range.
  - The `json`→`jsonb` cast is immutable, so this is legal. The query must use the identical expression.
- **No duplicated storage needed.** A `GENERATED ALWAYS AS (payload::jsonb) STORED` column (PostgreSQL 12+) is a second
  variant, not the only one.
- **Chain check:** the hash is computed over the `json` text read back as-is, with no canonicalisation.
- **MongoDB's arm is the one that needs care.** The chain only verifies if BSON → JSON re-serialisation reproduces the
  exact bytes: int32 / int64 / double (`1.0` against `1`), Unicode escapes, number formatting. The gate must hash the
  bytes the client reads back, for both arms.

**S2, durable, resumable change feed.**
- **Two real PostgreSQL arms.**
  - **(a) Logical decoding** with `pgoutput` (built in; needs a publication and `wal_level = logical`, which takes a
    restart). The consumer resumes from `confirmed_flush_lsn` and de-duplicates by LSN.
    - `test_decoding` ships in contrib.
    - `wal2json` is **not** in the official image. It needs a derived image with `apt install postgresql-16-wal2json`
      from the PGDG repository the image already configures.
    - Slots are crash-safe across a restart.
    - `max_slot_wal_keep_size` (PostgreSQL 13+) caps retention. Going past it invalidates the slot, which is the
      equivalent of MongoDB's `ChangeStreamHistoryLost` when the oplog rolls over.
  - **(b) Transactional outbox** that is commit-order safe. A bare `bigserial` cursor skips rows whose lower id commits
    later. Use one of:
    - an `xid8` column with `WHERE xid < pg_snapshot_xmin(pg_current_snapshot())`;
    - a serialised counter;
    - `FOR UPDATE SKIP LOCKED` claim-and-delete, for the queue shape.
- **LISTEN/NOTIFY:** a reference arm only. It is not durable and payloads are capped at 8000 bytes.

**S3, TTL on append-only data.**
- **Enforce append-only by privileges in both arms.**
  - PostgreSQL: the application role gets `INSERT, SELECT` only, and `UPDATE, DELETE, TRUNCATE` are revoked. A trigger
    is optional.
  - MongoDB has no triggers anyway: a custom role with `find` + `insert`.
- **Best PostgreSQL design: native range partitions on `expires_at`, not on the creation time.** Expire with
  `ALTER TABLE … DETACH PARTITION … CONCURRENTLY` (PostgreSQL 14+) and then `DROP TABLE`.
  - A partition drop fires no row triggers and takes no application update path.
  - Variant: a batched `DELETE` run by the owner role, with an index on `expires_at`, plus autovacuum.
- **Read-time visibility.** A row-level security policy `USING (expires_at > now())` (or a view) gives near-zero
  readable lag. MongoDB expiry is coarse: the TTL monitor runs every 60 s (`ttlMonitorSleepSecs`) and lags under load.
- **Scheduling.**
  - `pg_cron` and `pg_partman` are not in the official image. They need PGDG packages, and `pg_cron` also needs
    `shared_preload_libraries`.
  - A no-extension variant is valid: a scheduler sidecar or the consumer process runs the DDL.

**S4, server-side aggregation.**
- **SQL toolkit:** `GROUP BY` plus `GROUPING SETS` / `ROLLUP` and `FILTER (WHERE …)`. This gives `$facet`-like output
  in one scan. Add `LATERAL jsonb_to_recordset` / `jsonb_path_query` for arrays.
- **Indexes and statistics:** expression or stored generated columns on group keys, and `CREATE STATISTICS` on
  expressions (PostgreSQL 14+).
- **Parallel query:** `max_parallel_workers_per_gather` at 4 or more.
- **Compression and TOAST.** Rows average about 17 KB, so they are stored out of line in TOAST.
  - Test `default_toast_compression = lz4`, after checking that the image build supports it.
  - Generated columns avoid detoasting the whole value per row. That is legitimate if MongoDB is allowed matching
    indexes.

## Metric definitions
- **Primary metric and margin per scenario** (proposed):

  | Scenario | Primary metric |
  |---|---|
  | S1 | read p95 of the chain check plus the nested query |
  | S2 | lag p95 |
  | S3 | expiry lag p95 (physical) and write p95 during expiry |
  | S4 | p95 at 10× |

- **Component** = each item in a frozen checklist, counted by both advocates, with both lists published. A count of 1
  each for:
  - every process or container beyond the database server;
  - every extension not in core;
  - every server setting changed off its default and required for correctness;
  - every persistent non-data object: a slot, publication, trigger, policy, partition scheme (one per scheme, not one
    per child), TTL index or role;
  - every scheduled job;
  - every safety alarm an operator must watch.
- **MongoDB pays its own costs under this checklist:**
  - the `replSet` setting plus `rs.initiate`;
  - a `keyFile` (mandatory with replication and access control enabled);
  - oplog sizing (`oplogSizeMB` / `oplogMinRetentionHours`);
  - an oplog-window alarm;
  - the custom role.
- **Tie-breaker:** fire it only when the difference is at least 2 components. With a difference of 1, the verdict is
  `both-fit`.

## Confounds
- **Storage path:** use named volumes on the WSL2 ext4 virtual disk, never bind mounts from NTFS. Run `pg_test_fsync`
  and `fio --fsync=1` inside each container and record the results.
- **Equal memory and CPU:** equal `--memory` / `--cpus`.
  - Set `shared_buffers` to about 25% of the limit (the default is 128 MB) and `work_mem` to about 64 MB (the default
    is 4 MB).
  - Set `--shm-size` to at least 1 GB. Docker's 64 MB default breaks parallel hash.
  - Set the WiredTiger cache explicitly to the same budget.
- **After loading:** run `VACUUM ANALYZE` and `CHECKPOINT` before each cell. Record checkpoint and autovacuum events
  during runs. MongoDB checkpoints every 60 s.
- **Cache state:** either both warm or both cold. `drop_caches` in the WSL VM affects both arms equally.
- **Client:** run it in a container on the same Docker network (no Windows→WSL NAT).
- **Drivers:** pin versions (psycopg 3.x, pymongo 4.x) and use equal pool sizes. Server-side prepared statements are
  allowed. Account for client-side decode cost (dict parsing in each driver).

## Vetoes
1. **S1 "json loses indexing".** Fix: correct the pain-point table and the prediction. The PostgreSQL arm uses `json`
   plus expression GIN / B-tree indexes as above. Both arms hash the bytes the client reads back.
2. **S2 outbox unspecified.** Fix: require a commit-order-safe outbox (`xid8` horizon or serialised counter) and a
   `pgoutput` arm. Make `max_slot_wal_keep_size` equal the oplog size in bytes. Classify exceeding retention (slot
   invalidated against history lost) identically.
3. **S3 rule asymmetry.** Fix: define "append-only" as "the application role cannot update or delete". Allow
   server-side or owner-role expiry in both arms. Pin one grace value no smaller than both the partition width and the
   60 s TTL interval, and report physical lag and visible lag separately.
4. **No primary metric or margin, and no component definition.** Fix: freeze the table and checklist above.
5. **Image defaults.** Fix: equal, explicit memory tuning per the Confounds section.
6. **Extension policy.** Fix: allow pinned derived images (`pg_cron`, `wal2json`, `pg_partman`) with each extension
   counted as a component, and always include a no-extension variant.

## Predictions
- **S1: `both-fit`, leaning `postgres-fits`.** `json` verifies trivially; MongoDB's pass depends on its serialiser.
  Expression indexes serve the nested query.
- **S2: `both-fit`.** Lag will be comparable with `pgoutput`. MongoDB likely has less consumer code, but the component
  difference should be about 1 once `keyFile` and oplog sizing are counted.
- **S3: `mongodb-fits` on components is plausible.** PostgreSQL partitions should show lower write p95 during expiry
  (no delete churn) and tighter visible lag with row-level security.
- **S4: `both-fit`.** PostgreSQL is possibly faster at 10× with parallel query and generated columns. Both beat the
  application-side baseline by a wide margin.
