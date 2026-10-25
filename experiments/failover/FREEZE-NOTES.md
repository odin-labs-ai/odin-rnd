# Lab 02 failover: freeze notes (2026-10-25)

Both advocate reviews are verbatim in `reviews/`. All 16 vetoes were accepted. Where the two reviews differed, the
resolution is below and frozen in `PREREG.md`.

| # | From | Veto | Resolution |
|---|---|---|---|
| M1 | MongoDB | Topology | PSS: 3 data members, priority 1 / votes 1, no arbiter; 2 GB per node, equal on both arms |
| M2 / P3 | both | Client timeouts and retries | MongoDB `timeoutMS` 5 s and `serverSelectionTimeoutMS` 30 s; libpq `connect_timeout` 2, `tcp_user_timeout` 5000 ms, keepalives, `statement_timeout` 5 s. **One** shared application retry loop (the same id, 0.5 s backoff, a 90 s budget). PostgreSQL gets an idempotency key (`ON CONFLICT DO NOTHING`), counted as a component. Hidden driver retries are logged (CommandListener). |
| M3 / P1 | both | Kill | F1 = node death (`docker kill -s KILL` of the node container) on both arms. A process-only kill is labelled F1b on both arms. Each next fault waits for full recovery, and the rejoin time is reported. |
| M4 / P6 | both | Tuned-cell parity | **Resolved differently from M4's equal-5 s proposal**, because P6 shows Patroni cannot reach it (the validator's ttl floor). Each arm's tuned cell is its **minimum validator-passing** setting: MongoDB `electionTimeoutMillis` 5000 / `heartbeatIntervalMillis` 1000; Patroni the lowest values its pinned validator accepts with `loop_wait + 2 × retry_timeout ≤ ttl` (expected ttl 20 / loop_wait 4 / retry_timeout 8). The validator output is recorded. False failovers in a steady phase count against the arm that has them. |
| M5 | MongoDB | Component counting | Data-bearing members cancel on both sides. Defaults (`w: majority`, `retryWrites`) are not components. Verdict on component **kinds**; process counts published too. |
| M6 / P2 | both | F2 cannot show split-brain | Two networks, `app` and `ha`. F2a = full isolation (both). F2b = peer-only (`ha`): the client still reaches the old primary. Writes accepted but never acknowledged (MongoDB rollback; PostgreSQL's cancelled sync wait that commits locally, then pg_rewind) are reported as their own number, never as losses. |
| M7 | MongoDB | Feed | Effect and cursor in one transaction; EXP 020 S2's resume rules and amendment 04's buffer rule; `maxAwaitTimeMS` / `batchSize` at the S2 values |
| M8 | MongoDB | Host | PAUSE + the cell lock. One partition method on both arms (`docker network disconnect`), recorded. |
| P4 | PostgreSQL | etcd v2 | Patroni's `etcd3:` section is mandatory; versions pinned |
| P5 | PostgreSQL | Quorum sync | `synchronous_mode: quorum` (ANY 1) is the best cell; classic `synchronous_mode: true` is a variant; `synchronous_commit = on` |
| P7 | PostgreSQL | The best feed variant | The outbox (primary) **and** pgoutput + Patroni permanent logical slots (`hot_standby_feedback = on`). Plain pgoutput on PG16 is a labelled failing variant. |
| P8 | PostgreSQL | Rejoin hygiene | `initdb --data-checksums` + `use_pg_rewind`. Time to full redundancy is reported on both arms. |

## Out of scope (named next)
- Multi-host networks (a single Docker host).
- Sharding.
- HAProxy and pg_auto_failover as primary arms; both are labelled variants at most, because each is a single point of
  failure on one host.
- Kubernetes operators.
