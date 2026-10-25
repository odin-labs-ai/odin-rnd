# Lab 02 (proposal): "Kill the database mid-session: does anyone notice?" (design draft, private, not yet pre-registered)

Drafted 2026-10-25 by the design author. The founder chose it as Lab 02 ("1 2 and 3": failover first, then the company
store as Lab 03). The ledger is in the private repository. EXP 020 named failover as its next
study (S5: "MongoDB's home ground, so it is named explicitly").

## The question
While the agent space is live (visitors asking, agents answering, every answer written as a proof record, and the
floor following a feed), the database's primary dies. Three things decide whether visitors notice:
1. **Does an acknowledged answer get lost?**
2. **How long can nobody write?**
3. **Does the live feed carry on, without a gap or a double?**

Which store answers each, with the fewest operational parts, when each gets its best realistic HA design? The verdict
is per scenario. There is no overall winner.

## The workload (Odin's own)
- A seeded stream of agent-space writes: proof records (the agent space's own proof-record shape) at a steady rate,
  each acknowledged to its "visitor" (a client).
- A feed consumer turns the records into lens marks.
- The workload runs from the same client container as EXP 020, with pinned drivers.

## Arms (each with its best realistic HA design; three database nodes each, the same limits)
- **MongoDB 8.0:** a 3-member replica set, keyFile + auth.
  - Writes: `w: majority, j: true`, retryable writes on, the driver's server discovery.
  - Feed: a change stream, resumed with `startAfter` across the election.
  - Election settings: the defaults, plus one tuned cell.
- **PostgreSQL 16 + Patroni + etcd (3 members):**
  - Writes: synchronous replication (`synchronous_mode: true`), so an acknowledged commit exists on a standby.
  - The client: libpq multi-host with `target_session_attrs=read-write` (no proxy), plus a variant behind HAProxy.
  - Feed: the **commit-order-safe outbox**. The table is replicated, so it survives a failover. PostgreSQL 16's
    logical slots do not move to a standby on failover (failover slots arrive in 17), so pgoutput is reported as a
    labelled variant.
  - Patroni's loop / ttl: the defaults, plus one tuned cell.
- **The same host as EXP 020** (Windows + WSL2 Docker), on named volumes. Runs only after EXP 020 ends, with the PAUSE
  rule.

## Scenarios
- **F1, `kill -9` of the primary under load.** Seeded instants, five per cell.
- **F2, a partitioned primary.** `docker network disconnect` of the primary: it keeps running and is cut off. This
  tests split-brain: a write the old primary accepts but can never make durable.
- **F3, a planned switchover:** `replSetStepDown`, against `patronictl switchover`.

Measured per fault:
- **Gate:** 0 acknowledged writes lost, and 0 duplicated effects in the feed.
- **Primary metric:** the client-visible write outage, from the fault to the first acknowledged write after it.
- **Also:**
  - failed and retried writes;
  - feed gap and duplicates;
  - the time to a resumed feed;
  - writes accepted by a cut-off primary (F2);
  - components.

## Fairness (as EXP 020)
- Both advocate reviews come before the freeze, with veto power, and are published verbatim.
- Each arm's HA tuning is one documented cell at defaults plus one tuned cell. Detection times are reported, so
  neither side's defaults decide alone.
- Components are counted with EXP 020's checklist, including every HA process: Patroni agents, etcd members, and
  HAProxy if used. MongoDB pays for its members, keyFile and oplog.
- Five repetitions per cell, plus a reproduction. Every outcome is published.

## Predictions (the design author's, written now)
- **Gate:** both arms pass with these settings. With async replication, PostgreSQL would lose acknowledged writes on
  a kill; that is why the arm uses synchronous mode.
- **Outage:** `both-fit` once both are tuned. At the defaults, MongoDB is shorter (an election timeout of about 10 s,
  against Patroni's ttl of about 30 s).
- **Feed:** `both-fit` on the outbox arm. The pgoutput variant breaks on failover under PostgreSQL 16.
- **Components:** **`mongodb-fits`**. The replica set elects itself; PostgreSQL needs Patroni on each node and an etcd
  quorum, so at least 4 parts more. High confidence, but counted, not assumed.

## On the Labs page
- A live session runs: visitors ask, and the agents answer with proof cards.
- We pull the plug on the database's primary.
- The clip shows the outage clock, every answer accounted for, and the feed catching up.
- The proof cards carry the per-scenario verdicts.
