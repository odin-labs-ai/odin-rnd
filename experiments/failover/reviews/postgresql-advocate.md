# PostgreSQL advocate review of Lab 02 failover DESIGN.md (draft 8f4fe300)

Reviewer: an independent model reviewer (Claude, fresh context), briefed to give PostgreSQL 16 its best realistic HA
design and to veto strawmen. 2026-10-25, before the freeze. Kept verbatim.

## Summary
The draft picks the right shape: Patroni, synchronous replication, the outbox feed, and libpq multi-host as the
baseline. It has four real holes, though. "kill -9" is not defined at node level. F2 cannot detect split-brain as
written. Client timeouts and retries are not matched between the arms. And the "both-fit once tuned" outage
prediction is too generous to PostgreSQL. I file 8 vetoes below. Even after the fixes, I expect MongoDB to win the
F1/F2 outage metric honestly.

## Arm (best realistic PostgreSQL HA)
- **Topology:** 3 containers, each running PG16, Patroni 4.x and an etcd member (co-located). This tolerates any one
  node loss, the same as a 3-member replica set. A separate 1-etcd setup has fewer processes but makes etcd a single
  point of failure, so it is not an equal guarantee. Report it as a labelled variant at most.
- **Images:** official `postgres:16` (pinned digest) plus a pinned derived layer with `pip install patroni[etcd3]`,
  and `quay.io/coreos/etcd:v3.5.x` for the etcd binary. Patroni's repo ships a Dockerfile and compose demo but no
  official published image. Spilo (`ghcr.io/zalando/spilo-*`) exists but bundles a lot of extras; avoid it.
- **Patroni must use the `etcd3:` section, not `etcd:`.** `etcd:` speaks the v2 API, which etcd 3.4+ disables by
  default and 3.6 removes.
- **Durability equal to `w: majority, j: true`:** `synchronous_commit = on` (remote flush), not `remote_write`.
  - Best cell: `synchronous_mode: quorum` (Patroni 4.0+), which gives `ANY 1 (pg2, pg3)`. This is the closest
    analogue to "any majority".
  - Second variant: classic `synchronous_mode: true` with `synchronous_node_count: 1`.
  - `synchronous_mode_strict: false` for the single-fault gate, with the strict setting reported as a variant.
  - Keep `maximum_lag_on_failover` at its default. In sync mode Patroni only promotes a synchronous standby anyway.
- **Rejoin:** `use_pg_rewind: true` needs `wal_log_hints=on` or data checksums. Use `initdb --data-checksums`.
- **Timing:**
  - Defaults are `ttl 30 / loop_wait 10 / retry_timeout 10`.
  - The rule is `loop_wait + 2*retry_timeout ≤ ttl`. Patroni's validator also enforces a minimum ttl (I believe 20;
    check it in the pinned version).
  - So a realistic tuned cell is about `ttl 20 / loop_wait 4 / retry_timeout 8`. The draft implies PostgreSQL can
    match MongoDB's tuned ~2–5 s election. It cannot. Say so.
- **Client:** psycopg 3 / libpq with
  `host=pg1,pg2,pg3 target_session_attrs=read-write connect_timeout=2 tcp_user_timeout=… keepalives=1`. libpq treats a
  `connect_timeout` below 2 as 2.
- **HAProxy variant:** `option httpchk OPTIONS /primary`, `http-check expect status 200`, port 8008,
  `inter 1s fall 2 rise 2`, `on-marked-down shutdown-sessions`. Count it as a component and note it is a single point
  of failure on one host.
- **Rejected alternatives:**
  - pg_auto_failover's monitor is itself a single point of failure (not an equal guarantee) and the project's release
    cadence is slow. Allow it only as a labelled "fewest parts" variant.
  - CloudNativePG needs a Kubernetes control plane (kind/k3d), which is more parts, not fewer.
  - Stolon is unmaintained.
  - repmgr has no fencing.
- **Feed variants:**
  - The outbox is the main variant. xids are WAL-logged, so the xid8 horizon continues on the new primary.
  - Add **pgoutput + Patroni permanent logical slots**. Patroni 2.1+ copies the slot to replicas and advances it with
    `pg_replication_slot_advance`; it needs `hot_standby_feedback=on`. Redelivery after failover is absorbed by the
    commit-LSN cursor.
  - The `pg_failover_slots` extension (EDB, PG11–16) is an alternative.
  - Plain pgoutput on PG16 remains the labelled failing variant.

## Per scenario
- **F1:**
  - Define the fault as **node death on both arms**: `docker kill -s KILL <container>`, no restart policy.
  - kill -9 of the postmaster alone is a different fault. Patroni survives and restarts PG locally with no failover.
    Run it only as labelled F1b, and against mongod-only kill on the MongoDB side.
- **F2:**
  - As written it is degenerate. `docker network disconnect` also cuts the *client* off, so "writes accepted by a
    cut-off primary" is trivially 0 on both arms.
  - Fix: use two networks, `app` and `ha`. F2a disconnects both (full isolation). F2b disconnects only `ha`
    (asymmetric: the client still reaches the old primary).
  - In F2b, the old primary's sync-rep commits hang. If the client cancels, PostgreSQL commits **locally** with the
    warning "canceling wait for synchronous replication". The client must treat that as *not acknowledged*.
  - Patroni demotes itself after retry_timeout. pg_rewind later removes those rows, which is analogous to a MongoDB
    rollback.
- **F3:**
  - `patronictl switchover --candidate <sync standby> --force` against `replSetStepDown` (with its default secondary
    catch-up).
  - Patroni checkpoints and does a clean shutdown, so the window is seconds.

## Measurement fairness
- **Equal client policy:** the same per-operation deadline (PyMongo `timeoutMS` against libpq `tcp_user_timeout`
  plus a socket deadline), the same reconnect backoff, and **one retry** on each side.
- MongoDB's retryable writes are exactly-once by txnNumber. PostgreSQL gets the equivalent: an idempotency key (proof
  id PK, `ON CONFLICT DO NOTHING`). Count it as a component.
- **Ambiguous commits** are resolved by the oracle, not counted as lost.
- **Split the outage** into detection, promotion/election and client rediscovery, so the verdict shows which part
  costs the time.
- **Also report** time back to full redundancy (rewind/rollback plus catch-up).
- **Components:**
  - Count **kinds** for the verdict and publish **processes** too. Data members count on neither side.
  - PostgreSQL: Patroni, etcd, the sync settings, a replication role + pg_hba, checksums/rewind, and HAProxy if used.
  - MongoDB: replica set, keyFile, oplog sizing + alarm.
  - etcd fsync latency on WSL2 is recorded, with its own memory limit, counted against the PostgreSQL arm.

## Vetoes
1. **Undefined kill.** Fix: F1 = node death on both arms. Process-only kill is F1b on both arms.
2. **F2 cannot show split-brain.** Fix: F2a (full isolation) plus F2b (asymmetric, two networks). The cancelled
   sync-wait is classified as not acked.
3. **Unmatched client timeouts and retries.** Fix: equal deadlines and backoff, one retry each, PostgreSQL idempotency
   key allowed.
4. **Patroni `etcd:` (v2) would break on modern etcd.** Fix: mandate `etcd3:` and pin versions.
5. **The quorum sync mode is missing.** Fix: `synchronous_mode: quorum` is the best cell; classic sync mode is a
   variant.
6. **The tuned cell is underspecified.** Fix: freeze exact values that pass the validator, and record the validator
   output.
7. **The PostgreSQL feed's best variant is missing.** Fix: add pgoutput + Patroni permanent slots. The "best variant"
   rule applies.
8. **No rejoin hygiene.** Fix: data checksums + `use_pg_rewind`. Report time to full redundancy on both arms.

## Predictions (honest)
- **Gate:** both pass for F1–F3 on outbox and quorum-sync. Plain pgoutput on PG16 fails the feed gate after failover.
  pgoutput + permanent slots passes, with redelivery deduplicated.
- **F1 outage:** **`mongodb-fits`**.
  - Defaults: MongoDB about 11–14 s against PostgreSQL about 22–33 s.
  - Tuned: MongoDB about 4–7 s against PostgreSQL about 13–20 s, because of the ttl floor.
  - Confidence moderate-high. F1b (process kill) leans PostgreSQL, but it is not a failover.
- **F2 outage:** `mongodb-fits`, for the same reason. Acked writes from a cut-off primary: 0 on both arms.
- **F3:** `both-fit`, leaning MongoDB (around 1–3 s against around 2–5 s).
- **Feed:** `both-fit` on the outbox.
- **Components:** `mongodb-fits`, at least +2 kinds (Patroni, etcd). High confidence.
