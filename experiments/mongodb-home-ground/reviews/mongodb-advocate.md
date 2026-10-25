# MongoDB advocate review of DESIGN.md (draft 4595905e)

Reviewer: an independent model reviewer (Claude, fresh context), briefed to make sure MongoDB gets its best realistic
design and to veto strawmen. 2026-10-25, before the freeze. Kept verbatim; how each veto was handled is in
`../FREEZE-NOTES.md`.

## Summary
The draft takes on the right questions: the four pain points are each a native MongoDB mechanism. As written, though,
several unstated defaults could still handicap MongoDB without anyone intending it. Four things are missing:
- **Primary metrics and margins.** Neither is defined per scenario.
- **S3 grace.** It is not tied to the TTL monitor interval.
- **S2 retention.** It compares an unbounded slot with a capped oplog without equalising them.
- **S1 field order.** Order preservation depends on the driver's decode type, and that is not pinned.

Every fix below uses documented features. None is exotic tuning.

## Per scenario

**S1, order-preserving records**
- **Best design.**
  - Put the hashed payload in a nested field (`payload`), not at the top level. On insert the server moves `_id` to
    the first position, so a top-level design would be a strawman.
  - BSON keeps field order on insert and on full replacement.
  - Pin the driver and decode type. PyMongo 4.x decodes to `dict`, which keeps insertion order. `RawBSONDocument` gives
    the exact stored bytes. In Go, `bson.D` or `bson.Raw` keep order; `bson.M` does not. In Node, plain objects move
    integer-like keys (`"1"`, `"2"`) to the front.
- **Fairness.** "Without a canonicalisation layer" must mean the same for both arms: one deterministic serializer that
  emits keys in stored order. That is serialization, not canonicalisation.
- **Nested queries.**
  - Use dot-notation predicates on ordinary or compound indexes.
  - The oracle must not use exact embedded-document equality (`{payload.sub: {...}}`). That match depends on field
    order, and it would penalise MongoDB for a choice made in the query rather than in the store.
- **Storage.** Record `blockCompressor` (default snappy; zstd is available) and PostgreSQL TOAST compression (pglz or
  lz4). Either use the defaults on both arms or the best setting on both.

**S2, durable, resumable change feed**
- **Best design.**
  - `watch()` with a `$match` on operationType.
  - Persist `ChangeStream.resume_token` after every batch, including empty ones (the post-batch resume token), so the
    token advances while the stream is idle.
  - Resume with `startAfter`, which also survives an invalidate event (4.2+).
  - Rely on the driver's automatic resume for resumable errors.
  - Write the effect and the token in **one multi-document transaction**. That gives exactly-once effects, so the
    consumer needs no idempotency layer.
  - Use `fullDocument: "required"` with `changeStreamPreAndPostImages` (6.0+) only if updates matter. Inserts carry the
    full document anyway. Avoid `updateLookup`: it returns the current document, not the document at the time of the
    change.
- **Retention fairness.**
  - A replication slot keeps WAL without limit unless `max_slot_wal_keep_size` is set. The oplog is capped.
  - Set `storage.oplogMinRetentionHours` (4.4+) or the oplog size (`replSetResizeOplog`) from the frozen consumer
    downtime.
  - Bound the PostgreSQL slot equally, by disk bytes.
  - Report the bytes retained during the downtime, not the "window" alone.
- **Lag.** Freeze `maxAwaitTimeMS` and `batchSize` per arm, and record them.
- **Restart.** The oplog survives a restart with `j: true`. Each arm must record which components (keyfile,
  `rs.initiate`) are needed to come back.

**S3, TTL on append-only data**
- **Best design.**
  - A TTL index with `expireAfterSeconds: 0` on a per-document `expireAt` Date. TTL needs a single-field index on a
    date field.
  - Append-only through **RBAC**: a custom role with only the `find` and `insert` actions on the collection. The TTL
    monitor is an internal process and is not blocked by that role.
  - The test that the rule holds: an update by the app user must fail with Unauthorized (code 13).
  - Auth must be on (keyfile on a replica set). `$jsonSchema` cannot forbid updates; do not use it for this.
- **Timing.**
  - The TTL monitor wakes every 60 s by default. This is the documented `ttlMonitorSleepSecs` setParameter, settable at
    startup. A large deletion pass can take longer than one cycle.
  - So the worst-case lag at the defaults is 60 s plus the pass time.
- **Proposed cells.**
  - **(a) Defaults.** MongoDB at 60 s, the PostgreSQL sweep at 60 s. Grace: 150 s at 1×, 240 s at 10×.
  - **(b) Tuned.** `ttlMonitorSleepSecs=5` and a 5 s sweep. Grace: 30 s at 1×, 60 s at 10×.
- **Logical visibility.** If a read filter (`expireAt > now`, indexed) is allowed, allow it for both arms. Report
  physical deletion lag separately.

**S4, server-side aggregation**
- **Best design.**
  - Put `$match` and `$sort` first so they can use an index. The optimizer projects only the fields later stages need,
    so `$group` sees small documents.
  - Use `$sortByCount`, `$bucket` and `$setWindowFields` (5.0+) where they fit. Recent versions run `$group` on the
    slot-based engine.
- **Limits to design around.**
  - Each stage has a 100 MB memory limit. `allowDiskUse` is on by default since 6.0 (`allowDiskUseByDefault`); set it
    explicitly anyway.
  - `$facet` returns one document capped at 16 MB, and its sub-pipelines cannot use indexes. Allow separate concurrent
    pipelines as an alternative.
- **Wire bytes.** Driver compression (zstd, snappy, zlib) is off by default. Keep it off and say so, or else report it
  as a separate cell.
- **Cache.** Set `--wiredTigerCacheSizeGB` explicitly (about 3 GB within the 10 GB Docker limit), matched against
  PostgreSQL's `shared_buffers` and `effective_cache_size`. Report warm and cold runs.

## Missing scenarios (one machine, Docker)
1. **S5, failover correctness.**
   - Run a three-member replica set as three containers. Kill the primary under write load.
   - Measure acknowledged writes with `w: majority`, retryable writes, and a change stream resuming across the
     election.
   - The PostgreSQL equivalent is streaming replication plus Patroni with etcd.
   - Correctness and component count only; one host cannot measure HA performance. This is MongoDB's home ground, and
     it does not need sharding.
2. **S2 variant, transactional consumer.** Exactly-once through the token-plus-effect transaction against
   PostgreSQL's equivalent.
3. **Search.** I believe MongoDB 8.2 Community has search and vector search in public preview (the local search
   process, mongot), but I have not checked that here; verify before citing it. The draft keeps search out of scope,
   so at most note it.

## Vetoes
1. **S1 decode and placement.** The payload must be a nested field, the driver must be PyMongo with `dict` or
   `RawBSONDocument`, and the serializer rule must be the same for both arms. The oracle must use dot-notation queries
   only.
2. **S3 grace.** The grace must come from the configured interval on both arms, with matching cadences, as in cells (a)
   and (b). RBAC must be allowed as MongoDB's append-only mechanism.
3. **S2 retention.** Size the oplog for the frozen downtime with `oplogMinRetentionHours`, bound the slot with
   `max_slot_wal_keep_size`, and compare equal disk budgets. The token may be persisted in a transaction.
4. **Storage path.** Data goes on named Docker volumes inside the WSL2 VM (ext4), never on Windows bind mounts. Record
   mongod's startup filesystem warning: it recommends XFS.
5. **Undefined gates.** Freeze one primary metric and one margin per scenario.
   - S1: correctness, then nested-query p95.
   - S2: correctness, then lag p95, then components.
   - S3: correctness, then components.
   - S4: p95.
   - Proposed margin: at least 20% on the median, in 4 of 5 paired repetitions, reproduced. Do not reuse NOTE 003's 30%
     screening bar; that bar was for adding a new primitive.

## Predictions (honest)
- **S1: both-fit.** PostgreSQL text plus a stored generated JSONB column with GIN, or an expression index over `json`,
  likely matches on correctness and query speed. MongoDB wins on storage, which is not the primary metric.
- **S2: mongodb-fits, moderate confidence.** Both arms should be correct. MongoDB needs fewer parts than logical
  decoding. Against a simple outbox poller the parts gap narrows, but MongoDB should win on lag.
- **S3: mongodb-fits** on components if the cadences match. The risk: PostgreSQL with a REVOKE plus partition drops is
  also few parts.
- **S4: both-fit, leaning postgres-fits at 10×.** PostgreSQL's hash aggregation is strong. Both should clearly beat the
  application-side baseline.
