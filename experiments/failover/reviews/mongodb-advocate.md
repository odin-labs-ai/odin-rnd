# MongoDB advocate review of Lab 02 failover DESIGN.md (draft 8f4fe300)

Reviewer: an independent model reviewer (Claude, fresh context), briefed to give MongoDB its best realistic HA design
and to veto strawmen. 2026-10-25, before the freeze. Kept verbatim.

## Summary
The scenario mix is right for MongoDB, and the design does not set up a strawman on purpose. It is still too loose to
freeze. Six things are unspecified, and each could quietly cost MongoDB, or either arm, the result:
- the topology (an arbiter is not ruled out);
- client timeouts during a partition;
- what "kill" means;
- how detection-time tuning is made equal;
- how components are counted;
- how the hidden driver retries are counted.

I raise 8 vetoes below, each with a fix.

## Arm: MongoDB's best realistic HA design
- **Topology:** three data-bearing members (PSS), all `priority: 1` and `votes: 1`. **No arbiter.** With PSA, losing
  one data node leaves `w: majority` unsatisfiable. Settings: keyFile plus auth, `chainingAllowed: true` (the
  default), `writeConcernMajorityJournalDefault: true` (the default).
- **Write concern:** since 5.0 the implicit default for PSS is `w: majority`. Pass `{w: "majority", j: true}`
  explicitly anyway, and record it.
- **Election settings:** default cell with `electionTimeoutMillis` 10000, `heartbeatIntervalMillis` 2000,
  `catchUpTimeoutMillis` -1 and `enableElectionHandoff` true. The tuned cell is defined in veto V4.
- **Memory:** set it explicitly per member, for example `--memory` 2 GB with `wiredTigerCacheSizeGB` 0.75. Three
  4 GB members do not fit on a 10 GB host. Use the same per-node budget for PostgreSQL.
- **Client (PyMongo 4.10):**
  - Connect with a seed list of all 3 members, `replicaSet=`, `retryWrites=true` (the default) and `retryReads=true`.
  - Leave server monitoring on its default (`serverMonitoringMode=auto`, which streams against 4.4+). Topology
    changes are then pushed, so `heartbeatFrequencyMS` (10 s) barely matters.
  - When the driver sees a new primary with a higher `(electionId, setVersion)`, it marks the old one Unknown.
  - Set an explicit `timeoutMS` (client-side operation timeout, CSOT) of about 5 s per attempt. Without it, a write in
    flight to a partitioned primary hangs, because `socketTimeoutMS` has no default. See V2.
  - Set `serverSelectionTimeoutMS` to at least 30 s, so a retry waits for the election instead of failing.
- **Writes:** use `insert_one` / `bulk_write` with a client-chosen unique `_id`. If the proof write is a
  multi-document transaction, use `with_transaction`. It retries `TransientTransactionError` and an
  `UnknownTransactionCommitResult` commit.
- **Feed:** `watch()` with read concern majority, which is the only option. Rolled-back writes are therefore never
  emitted. The driver resumes once on a resumable error with its cached token and re-runs server selection. The
  application resumes from the token it stored with the effect in one transaction. `resumeAfter` is enough;
  `startAfter` is only needed after an invalidate. Either is fine.

## Per scenario
- **F1, kill -9.** Fair only if "kill" means the whole node on both arms (`docker kill -s KILL <container>`). If only
  the postgres process is killed, Patroni restarts it locally and that is not a failover.
  - MongoDB: the secondaries call an election after `electionTimeoutMillis` (plus a small randomised offset). The new
    primary takes about 10–12 s at the defaults.
  - Before the next seeded fault, require all 3 members healthy and the old primary rejoined, with the rejoin time
    reported. MongoDB rejoins with no extra parts. Patroni needs `use_pg_rewind` plus `wal_log_hints` or data
    checksums, and those are counted.
- **F2, partition.** This is the right test for MongoDB. A primary that cannot see a majority for
  `electionTimeoutMillis` steps down.
  - Writes it accepted after the cut never reach `w: majority`, so they are never acknowledged. On rejoin they roll
    back into `rollback/` files.
  - Report "accepted, never acknowledged, rolled back" separately from "acknowledged". The gate counts only
    acknowledged writes.
  - `docker network disconnect` also cuts the client. Add **F2b**: separate replication and client networks, with
    only the peer link cut. The client then keeps reaching the old primary. That is the real split-brain case for
    both arms.
- **F3, switchover.** `replSetStepDown` (`stepDownSecs` 60, `secondaryCatchUpPeriodSecs` 10). It waits for an
  electable secondary to catch up, then election handoff starts the election at once. Since 4.2 a step-down kills
  writes in progress, not every connection.

## Measurement fairness
- **Equal detection budget.** In the tuned cell both arms get the same nominal detection budget, and each arm's false
  failovers during a steady phase count against that arm.
- **Equal client timeouts.** PyMongo's `timeoutMS` is matched by libpq's `connect_timeout`, `tcp_user_timeout`,
  keepalives and `statement_timeout`. One application retry loop serves both arms: the same id, the same backoff, the
  same total budget (at least 90 s). A duplicate-key error on a retry means the first attempt committed.
- **Hidden driver retries.** PyMongo's one internal retry is invisible to the application. Log it through a
  `CommandListener` so it is counted but not penalised. That retry's server-side dedupe (session plus `txnNumber`,
  via the replicated `config.transactions`) is a real feature and should be named.
- **The outage clock.** Measure from the fault to the first acknowledgement, per writer thread, against the producer's
  schedule (median and max over the 8 threads). Also report the longest single-write latency.
- **Feed resume.** "Time to resumed feed" counts from the first acknowledged write after the fault, so the write
  outage is not counted twice.
- **The gate oracle.** After the cell, read every acknowledged id back with majority read concern from the final
  primary.

## Vetoes
1. **V1, topology.** Fix PSS, no arbiter, equal priorities, and per-node memory equal on both arms.
2. **V2, client timeouts.** Fix explicit `timeoutMS` (MongoDB) and `tcp_user_timeout` / `statement_timeout` (libpq),
   plus one shared application retry loop. Without this, F2 measures TCP hangs, not the stores.
3. **V3, the kill.** Kill = `docker kill -s KILL` of the node container on both arms. Gate each next fault on a full
   recovery, and report rejoin time.
4. **V4, tuned-cell parity.** Use one shared nominal detection target, for example 5 s:
   - MongoDB: `electionTimeoutMillis` 5000, `heartbeatIntervalMillis` 1000.
   - Patroni: an equivalent `ttl` / `loop_wait` / `retry_timeout` that satisfies `loop_wait + 2 × retry_timeout ≤ ttl`.
   - Each arm's false elections count against it. Never put a sub-second MongoDB timeout against a 10 s Patroni ttl,
     or the reverse.
5. **V5, component counting.** Data-bearing nodes cancel out (3 mongod against 3 postgres). The draft's "MongoDB pays
   for its members" counts MongoDB's replicas while PostgreSQL's standbys go free, and that must be removed.
   - `w: majority` and `retryWrites` are defaults, so they are not components.
   - Patroni ×3 and etcd ×3 are counted as processes even if they are co-located.
6. **V6, F2b.** Add the peer-only partition. Report rolled-back unacknowledged writes as their own number, never as
   losses.
7. **V7, the feed.** Effect and token go in one transaction. Resume follows the EXP 020 S2 rules. Pin the
   private-buffer rule from amendment 04. Fix `maxAwaitTimeMS` / `batchSize` at the S2 values.
8. **V8, the host.** Keep PAUSE and the cell lock. Use one partition method on both arms (disconnect, or an
   in-container iptables DROP with `NET_ADMIN`) and record which. Disconnect timing on Docker depends on ARP and ICMP,
   so it varies.

## Predictions (MongoDB advocate)
- **F1:**
  - Gate: both pass.
  - Default outage: MongoDB about 10–13 s; Patroni about 30–40 s (`ttl` 30 plus `loop_wait`). Verdict at the
    defaults: **`mongodb-fits`**.
  - Tuned: MongoDB about 5–7 s against Patroni's equivalent. Verdict: **`both-fit`**, leaning MongoDB, low confidence.
  - Feed: 0 gaps and 0 duplicates; it resumes within about 1 s of the new primary.
- **F2:**
  - Gate: both pass. MongoDB acknowledges 0 writes on the cut-off primary.
  - Rolled back: a few writes, up to the number of writer threads per attempt window.
  - Outage: close to F1's, so the same verdicts as F1.
- **F3:** MongoDB about 1–3 s, Patroni about 2–5 s. Verdict: **`both-fit`**.
- **Components** (EXP 020 checklist, data nodes cancelling):
  - MongoDB: replica-set config, keyFile, oplog sizing, oplog-window alarm, feed cursor collection. **About 5.**
  - PostgreSQL:
    - Patroni ×3 and etcd ×3;
    - `synchronous_mode`;
    - `use_pg_rewind` plus `wal_log_hints`;
    - the replication role / `pg_hba` entry;
    - the outbox's xid8 column and index, cursor table, poll loop and growth alarm;
    - HAProxy, if used.
  - That makes **about 14–15** for PostgreSQL. Verdict: **`mongodb-fits`**, high confidence.
