# EXP 021 · Lab 03: does anyone notice when the primary dies? — result

## What we asked
While an agent workload writes proof records and a feed turns them into marks, the database's primary fails. Which store keeps every acknowledged write and the feed intact, with the shortest client-visible write outage and the fewest operational component kinds, when each gets its best realistic high-availability design? The study is pre-registered. It gives a verdict per fault scenario and a separate one for components, and declares no overall winner.

The arms:
- **MongoDB 8.0.12:** a replica set of 3 data members (3 data-bearing, no arbiter; priority 1 / votes 1 each, i.e. PSS). Writes use `w: majority`, `j: true`; the client is PyMongo 4.10.1 with retryable writes and reads.
- **PostgreSQL 16.10 + Patroni 4.0.6 + etcd 3.5.21:** 3 nodes, each running PostgreSQL, Patroni and an etcd member. The client is psycopg 3.2.3 / libpq multi-host with `target_session_attrs=read-write`. The compared variants are `classic-strict`, `quorum-strict` (the strict switch below says why).
- **The feed, both arms:** the effect and its cursor are written in one transaction. MongoDB uses a change stream (`stream`); PostgreSQL runs a commit-order-safe outbox (`outbox`) and pgoutput with a Patroni permanent logical slot (`slot`) in every cell, and plain pgoutput (`plain`) as a labelled variant expected to fail after a failover.

## How we ran it
**Faults** (each fault waits for full recovery before the next):

| | Fault | How | Counted |
|---|---|---|---|
| F1 | node death | `docker kill -s KILL` of the primary's node container | compared |
| F1b | process death (labelled) | only `mongod` / the postmaster is killed | labelled, never decides |
| F2a | full isolation | the primary is disconnected from both networks (client and peer) | compared |
| F2b | peer-only partition | the primary is disconnected from the peer network only: the client still reaches it | compared |
| F3 | planned switchover | `replSetStepDown` against `patronictl switchover --candidate <sync standby> --force` | compared |

- **The fault instant** is seeded per (seed, repetition, fault), the same on both arms of a pair, between 30 s and 60 s after the writers start.
- **The compared number.** F1 / F2a / F2b: the client-visible write outage, from the fault to the first acknowledged write after it, per writer thread; the median over the 8 threads is used. F3 (a planned switchover has no instant that stops writes): the median over the threads of the longest gap between acknowledged writes that ends after the switchover; the literal fault-to-first-ack number is published too.

**Timings** (as in force in the cells):

| Arm | default | tuned |
|---|---|---|
| MongoDB | `electionTimeoutMillis` 10000 / `heartbeatIntervalMillis` 2000 | `electionTimeoutMillis` 5000 / `heartbeatIntervalMillis` 1000 |
| PostgreSQL | ttl 30 / loop_wait 10 / retry_timeout 10 | ttl 20 / loop_wait 4 / retry_timeout 8 |

- **Tuned** is each arm's most aggressive documented, supported setting. For Patroni that is ttl at its validator's floor with `loop_wait + 2 × retry_timeout = ttl` (validator floors recorded: ttl 20 / loop_wait 1 / retry_timeout 3; values below them rejected).

**Labelled lines** (published, never part of a compared verdict):
- **The Patroni floor:** PostgreSQL at ttl 20 / loop_wait 1 / retry_timeout 3 (a steady cell per seed + F1 in every repetition), compared only against MongoDB's tuned F1, on its own line `floor/F1`.
- **The feed-overhead block** (`outbox-only`): outbox only, no slots, `wal_level=replica`, F1 at both timings, seed 1 only, on lines `overhead:<timing>/F1`. It bounds what running the slot feeds costs the compared PostgreSQL cells.
- **F1b** (process death) runs in every block and gets its own lines; it never decides.

**Repetitions.** 5 paired repetitions on seed 1 + 5 paired repetitions on seed 2 (seed 2 is the reproduction) per (timing, fault), plus one 10-minute steady cell per (arm, variant, timing, seed) for false failovers. The arm order alternates and the fault order rotates by repetition.

**The strict switch.** The pre-registration says: if a smoke cell shows writes acknowledged while the new primary's `synchronous_standby_names` was empty (one copy only), the compared PostgreSQL variants become the `synchronous_mode_strict` ones.
- Smoke cell `quorum` default F1b: 1 window(s), 10 s with an empty list, 236 writes acknowledged with one copy.
- Smoke cell `classic-strict` default F1: 0 window(s), 0 single-copy acknowledgements.
- Smoke cell `quorum-strict` default F1: 0 window(s), 0 single-copy acknowledgements.
- Smoke cell `quorum-strict` default F1b: 0 window(s), 0 single-copy acknowledgements.
- Smoke cell `quorum-strict` default F2a: 0 window(s), 0 single-copy acknowledgements.
- Smoke cell `quorum-strict` default F2b: 0 window(s), 0 single-copy acknowledgements.
- Smoke cell `quorum-strict` default F3: 0 window(s), 0 single-copy acknowledgements.
- Smoke cell `quorum-strict` default steady: 0 window(s), 0 single-copy acknowledgements.
- The other non-strict smoke cells (`quorum` default F1, F2a, F2b, F3, steady; `quorum` tuned F1): 0 window(s).
- So the rule fired, and the counted plan ran the strict variants. The non-strict numbers exist only as smoke context and never count.
- **The strict variants still logged single-copy windows in counted cells** (see Gates): 15567 acknowledgements in 10 strict cells. The frozen rule says nothing about single-copy windows after the switch, so they change no verdict.

**The rule** (lab02lib/verdict.py, applied by the verdict script):
1. A variant passes the gate only when all its cells on both seeds pass (0 lost acknowledged writes, 0 phantom, its feed complete) and its steady cells at that timing pass.
2. PostgreSQL is one variant per (timing, fault): among the passing variants, the lowest median of its seed-1 repetition medians. It is used for every pair on both seeds. The same rule picks one feed.
3. An arm fits when its compared number is ≤ 0.8 × the other's (at least 20 % shorter) in ≥ 4 of the 5 seed-1 pairs, and the median of the seed-2 paired differences has the winner's sign. Otherwise `both-fit`.
4. One arm alone passing the gate fits, labelled `gate-only`; neither passing is `neither`; a missing or invalid cell is `invalid`. A false failover in an arm's steady cell at that timing turns its `-fits` into `both-fit` (flagged `unstable`).
5. Components are their own verdict: ≥ 2 fewer component kinds (PREREG). Only one arm passing the gate fits, labelled `gate-only` (PREREG; FREEZE-NOTES-v1.1 A3). The runner applies the gate first ("given the gate", `PROTOCOL-LAB02.md`; `verdict.py` `components_verdict`), and an arm's gate here is its gate over every `<timing>/<fault>` line (`lab02_verdict.py`: F1b included, the floor and overhead lines excluded).

## Result
**`mongodb-fits` in 6 of 8 compared scenarios; `postgres-fits` in 2 of 8 compared scenarios.**

<!-- compared-verdicts:start -->
| Scenario | Compared number | Gate (MongoDB / PostgreSQL) | PostgreSQL variant chosen (seed-1 median of repetition medians, s) | Feed chosen (MongoDB / PostgreSQL) | Seed-1 pairs ≥ 20 % shorter (MongoDB / PostgreSQL) | Reproduction: seed-2 median paired difference, MongoDB − PostgreSQL (s) | Basis | Verdict |
|---|---|---|---|---|---|---|---|---|
| `default/F1` | outage | pass / pass | **classic-strict** 30.0085; quorum-strict 31.0843 | stream / outbox | 5 / 0 | -24.9642 | outage | `mongodb-fits` |
| `default/F2a` | outage | pass / pass | classic-strict 36.4803; **quorum-strict** 31.6126 | stream / outbox | 5 / 0 | -9.7462 | outage | `mongodb-fits` |
| `default/F2b` | outage | fail / pass | classic-strict 35.1823; **quorum-strict** 34.9322 | – / slot | – | – | gate-only | `postgres-fits`, `gate-only` |
| `default/F3` | ack gap | pass / pass | **classic-strict** 3.486; quorum-strict 3.5377 | stream / slot | 5 / 0 | -3.1118 | outage | `mongodb-fits` |
| `tuned/F1` | outage | pass / pass | classic-strict 25.5066; **quorum-strict** 20.9965 | stream / outbox | 5 / 0 | -10.9708 | outage | `mongodb-fits` |
| `tuned/F2a` | outage | pass / pass | **classic-strict** 21.7231; quorum-strict 21.8199 | stream / outbox | 5 / 0 | -10.2184 | outage | `mongodb-fits` |
| `tuned/F2b` | outage | fail / pass | classic-strict 25.3821; **quorum-strict** 22.4697 | – / slot | – | – | gate-only | `postgres-fits`, `gate-only` |
| `tuned/F3` | ack gap | pass / pass | classic-strict 3.5394; **quorum-strict** 3.5 | stream / slot | 5 / 0 | -9.0009 | outage | `mongodb-fits` |
<!-- compared-verdicts:end -->

**Why MongoDB fails the F2b gate (both timings).** The 2 `postgres-fits` lines are `gate-only`, and the gate failed on MongoDB's feed, not on its writes.
- In 3 of its 20 F2b cells (default: `rep1-seed1`, `rep3-seed2`, 2 of 10; tuned: `rep3-seed2`, 1 of 10) the change-stream feed recorded one effect twice (`oracle.feeds.stream.duplicated.count` 1; 0 missing, 0 phantom; ids `mira-39447ff0-1058`, `mira-baa96510-1124`, `mira-092b221c-1124`). The gate reason is "no feed variant passed (duplicated / missing / phantom effects)". Each timing's verdict uses its own 10 cells, so each fails on its own.
- All 20 MongoDB F2b cells passed the write gate: 0 lost, 0 phantom, 0 duplicate-first, 0 accepted-never-acknowledged.
- A rollback (7 to 9 accepted-later-rewritten writes) happened in all 20 cells, the 17 that passed included (the 3 failing cells: 9, 9, 8). Each failing cell's stream log shows a `w: majority` write-concern timeout (`WTimeoutError`, code 50) and then a resume; passing F2b cells show the same kind of error. The cells do not establish the mechanism beyond that.
- None of the 3 failing cells is a re-run of a discarded cell.
- On outage MongoDB was shorter in all 20 F2b pairs: ≤ 0.8 × PostgreSQL in 5 of 5 seed-1 pairs at default and 4 of 5 at tuned (rep 3: 0.807); seed-2 median differences −13.4819 s (default) and −9.9683 s (tuned). Under the frozen rule (FREEZE-NOTES-v1.1 A3) outages are not compared when only one arm passes the gate; this is context, not a verdict.

How the columns are computed: the gate, the chosen variant and feed, the wins, the reproduction median and the basis are copied from VERDICT.json. The selection medians are the rule's own number (the median of the 5 seed-1 repetition medians per variant), recomputed from the cell files and checked against the verdict's choice. No ratio is shown; the 20 % margin is the rule's test of each pair (pair counted when one arm's number ≤ 0.8 × the other's).

**Labelled lines (published, never deciding):**

| Line | What it is | Gate (MongoDB / PostgreSQL) | PostgreSQL variant | Seed-1 pairs ≥ 20 % shorter (MongoDB / PostgreSQL) | Reproduction median diff (s) | Basis | Outcome |
|---|---|---|---|---|---|---|---|
| `default/F1b` | process death (labelled) at the default timing | pass / pass | quorum-strict | 0 / 2 | – | outage rule not met | `both-fit` |
| `floor/F1` | the Patroni validator floor against MongoDB's tuned cell | pass / pass | quorum-strict | 5 / 0 | -13.3935 | outage | `mongodb-fits` |
| `overhead:default/F1` | feed-overhead block (outbox only, wal_level=replica, non-strict quorum, seed 1 only; so it bounds the slot feeds' cost only up to the strict / non-strict difference) | pass / pass | outbox-only | 5 / 0 | – | outage | `mongodb-fits` |
| `overhead:tuned/F1` | feed-overhead block (outbox only, wal_level=replica, non-strict quorum, seed 1 only; so it bounds the slot feeds' cost only up to the strict / non-strict difference) | pass / pass | outbox-only | 5 / 0 | – | outage | `mongodb-fits` |
| `tuned/F1b` | process death (labelled) at the tuned timing | pass / pass | quorum-strict | 1 / 0 | – | outage rule not met | `both-fit` |

**Components (its own verdict): `postgres-fits`, `gate-only`.** It is decided by the gate, not by the count: MongoDB failed the F2b gate (its feed; above), and an arm that alone passes the gate fits (rule 5). On kinds alone the rule's test (≥ 2 fewer) is met by MongoDB: 4 kinds against PostgreSQL's 12 with the `slot` feed, or 9 with the `outbox` feed (the count frozen in FREEZE-NOTES-v1.1 A5). Processes: MongoDB 0 extra, PostgreSQL 6 extra (3 Patroni, 3 etcd), with either feed. The runner counted PostgreSQL with `slot`, the feed chosen most often over all `<timing>/<fault>` lines: the 8 compared lines split 4–4 (outbox: F1, F2a; slot: F2b, F3), and the 2 labelled F1b lines (slot) decided it. Data-bearing members cancel on both sides.
- **MongoDB:** replica-set (S); keyfile (O); oplog-window-alarm (A); feed-cursor-collection (O).
- **PostgreSQL:** patroni (P, 3 processes); etcd (P, 3 processes); synchronous-mode (S); replication-role-hba (O); rewind-hygiene (S); physical-slot-wal-retention-alarm (A); wal-level-logical (S); publication (O); permanent-logical-slot (O); hot-standby-feedback (S); slot-retention-alarm (A); feed-cursor-table (O).
- **PostgreSQL with the `outbox` feed** (`components.count("pg", "outbox")`: 9 kinds, 6 processes): patroni (P, 3 processes); etcd (P, 3 processes); synchronous-mode (S); replication-role-hba (O); rewind-hygiene (S); physical-slot-wal-retention-alarm (A); outbox-xid8-column-index (O); feed-cursor-table (O); outbox-poll-loop (P, 0 processes).

## Per-pair numbers
Each value is one cell's compared number (the median over the writer threads), in seconds. MongoDB and the chosen PostgreSQL variant are copied from VERDICT.json (`pairs`); the other PostgreSQL variant is copied from its cell files and is never compared. `∞` is a thread that never recovered.

### `default/F1`
| seed | rep | MongoDB | PostgreSQL classic-strict (chosen) | quorum-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 20.8747 | 36.114 | 33.0889 |
| 1 | 1 | 11.3844 | 29.8535 | 28.5148 |
| 1 | 2 | 11.7253 | 25.5455 | 33.0877 |
| 1 | 3 | 20.8585 | 30.0085 | 26.535 |
| 1 | 4 | 11.7061 | 35.6122 | 31.0843 |
| 2 | 0 | 10.6234 | 35.1979 | 34.6929 |
| 2 | 1 | 11.6237 | 36.5879 | 26.0014 |
| 2 | 2 | 12.0563 | 25.7791 | 33.5461 |
| 2 | 3 | 10.6318 | 36.5632 | 36.5894 |
| 2 | 4 | 10.6219 | 36.4862 | 26.3305 |

### `default/F2a`
| seed | rep | MongoDB | PostgreSQL quorum-strict (chosen) | classic-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 17.9804 | 35.263 | 36.6929 |
| 1 | 1 | 24.3601 | 31.6126 | 36.4665 |
| 1 | 2 | 18.9057 | 27.1676 | 36.4803 |
| 1 | 3 | 17.6783 | 35.8478 | 26.7534 |
| 1 | 4 | 17.31 | 26.3557 | 36.9779 |
| 2 | 0 | 22.8177 | 27.4471 | 30.392 |
| 2 | 1 | 17.3902 | 27.1364 | 27.2846 |
| 2 | 2 | 22.747 | 35.5858 | 30.4969 |
| 2 | 3 | 17.9072 | 26.9111 | 29.0806 |
| 2 | 4 | 17.8998 | 31.4367 | 26.779 |

### `default/F2b`
| seed | rep | MongoDB | PostgreSQL quorum-strict (chosen) | classic-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 21.3407 | 34.9322 | 35.1823 |
| 1 | 1 | 20.6212 | 34.7721 | 31.7653 |
| 1 | 2 | 11.5919 | 35.1138 | 35.4585 |
| 1 | 3 | 11.9317 | 35.2664 | 34.7369 |
| 1 | 4 | 18.7645 | 34.9186 | 35.2247 |
| 2 | 0 | 11.8708 | 25.3527 | 26.4443 |
| 2 | 1 | 24.6039 | 35.1731 | 35.0665 |
| 2 | 2 | 18.6989 | 26.544 | 34.6283 |
| 2 | 3 | 10.7093 | 34.6824 | 35.2797 |
| 2 | 4 | 17.3537 | 34.775 | 34.8777 |

### `default/F3`
F3's compared number is the ack gap; the literal fault-to-first-ack outage is published beside it.

| seed | rep | MongoDB | PostgreSQL classic-strict (chosen) | quorum-strict (not compared) | literal outage MongoDB | literal outage PostgreSQL |
|---|---|---|---|---|---|---|
| 1 | 0 | 0.4064 | 9.4733 | 3.5377 | 0.2153 | 0.2186 |
| 1 | 1 | 0.4091 | 3.486 | 3.4878 | 0.1911 | 0.1931 |
| 1 | 2 | 0.4601 | 3.477 | 9.4647 | 0.2218 | 0.2213 |
| 1 | 3 | 0.4133 | 3.4696 | 9.4984 | 0.2122 | 0.2109 |
| 1 | 4 | 0.4048 | 9.5098 | 3.5096 | 0.202 | 0.2049 |
| 2 | 0 | 0.5696 | 10.5967 | 11.0007 | 0.188 | 0.1969 |
| 2 | 1 | 0.4705 | 3.4577 | 3.5051 | 0.1864 | 0.2124 |
| 2 | 2 | 0.4054 | 3.5172 | 9.4842 | 0.2209 | 0.2216 |
| 2 | 3 | 0.4084 | 9.4474 | 3.4861 | 0.2024 | 0.2056 |
| 2 | 4 | 0.4052 | 3.4826 | 3.5158 | 0.2188 | 0.2209 |

### `tuned/F1`
| seed | rep | MongoDB | PostgreSQL quorum-strict (chosen) | classic-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 10.372 | 20.5154 | 21.2844 |
| 1 | 1 | 10.1554 | 20.9535 | 28.4465 |
| 1 | 2 | 10.3417 | 23.2344 | 25.9996 |
| 1 | 3 | 10.1319 | 23.4946 | 25.5066 |
| 1 | 4 | 10.1035 | 20.9965 | 20.4853 |
| 2 | 0 | 10.3157 | 21.2865 | 20.7147 |
| 2 | 1 | 10.1743 | 20.6273 | 25.8467 |
| 2 | 2 | 10.2784 | 23.1617 | 21.2878 |
| 2 | 3 | 10.2149 | 21.1519 | 20.7715 |
| 2 | 4 | 10.3996 | 23.2241 | 21.2461 |

### `tuned/F2a`
| seed | rep | MongoDB | PostgreSQL classic-strict (chosen) | quorum-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 15.0905 | 21.4601 | 19.2918 |
| 1 | 1 | 15.3246 | 21.7231 | 21.1791 |
| 1 | 2 | 17.5226 | 27.0087 | 21.8199 |
| 1 | 3 | 15.1017 | 23.6467 | 23.5799 |
| 1 | 4 | 10.3435 | 21.5856 | 26.2289 |
| 2 | 0 | 8.4645 | 24.0302 | 24.2352 |
| 2 | 1 | 15.2968 | 24.9611 | 27.0395 |
| 2 | 2 | 11.7142 | 21.9326 | 22.2591 |
| 2 | 3 | 15.2115 | 26.7197 | 26.53 |
| 2 | 4 | 15.3415 | 22.0069 | 27.0393 |

### `tuned/F2b`
| seed | rep | MongoDB | PostgreSQL quorum-strict (chosen) | classic-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 10.2644 | 25.2823 | 25.4456 |
| 1 | 1 | 10.3535 | 21.915 | 24.8087 |
| 1 | 2 | 15.187 | 22.1809 | 25.3821 |
| 1 | 3 | 18.1776 | 22.5257 | 25.0092 |
| 1 | 4 | 15.5153 | 22.4697 | 25.5279 |
| 2 | 0 | 0.4209 | 24.9474 | 24.8596 |
| 2 | 1 | 15.1499 | 25.1182 | 25.0907 |
| 2 | 2 | 15.2096 | 25.0191 | 21.3435 |
| 2 | 3 | 17.1324 | 21.8529 | 22.4139 |
| 2 | 4 | 10.1288 | 24.8483 | 21.0104 |

### `tuned/F3`
F3's compared number is the ack gap; the literal fault-to-first-ack outage is published beside it.

| seed | rep | MongoDB | PostgreSQL quorum-strict (chosen) | classic-strict (not compared) | literal outage MongoDB | literal outage PostgreSQL |
|---|---|---|---|---|---|---|
| 1 | 0 | 0.4051 | 3.5492 | 3.5394 | 0.2152 | 0.2163 |
| 1 | 1 | 0.4087 | 3.4977 | 9.4364 | 0.1917 | 0.1928 |
| 1 | 2 | 0.653 | 9.5907 | 3.4959 | 0.2228 | 0.2222 |
| 1 | 3 | 0.4043 | 3.4687 | 3.4779 | 0.2107 | 0.2096 |
| 1 | 4 | 0.4174 | 3.5 | 11.8295 | 0.2027 | 0.1997 |
| 2 | 0 | 0.8028 | 9.5888 | 3.503 | 0.1868 | 0.2009 |
| 2 | 1 | 0.4841 | 9.485 | 3.4649 | 0.2145 | 0.2126 |
| 2 | 2 | 0.4083 | 3.5595 | 9.4404 | 0.2198 | 0.2208 |
| 2 | 3 | 0.4048 | 9.4439 | 3.4954 | 0.2039 | 0.2029 |
| 2 | 4 | 0.4053 | 9.4726 | 3.4703 | 0.2197 | 0.2188 |

### `default/F1b` (labelled)
| seed | rep | MongoDB | PostgreSQL quorum-strict (this line's variant) | classic-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 10.5922 | 10.132 | 5.1485 |
| 1 | 1 | 10.5497 | 5.161 | 10.1673 |
| 1 | 2 | 10.6465 | 10.1704 | 15.168 |
| 1 | 3 | 10.6335 | 10.1437 | 5.1473 |
| 1 | 4 | 10.3992 | 5.1456 | 10.1417 |
| 2 | 0 | 11.691 | 10.1631 | 13.4551 |
| 2 | 1 | 11.1804 | 5.159 | 5.1454 |
| 2 | 2 | 10.4928 | 10.1534 | 15.1971 |
| 2 | 3 | 10.4065 | 5.1556 | 10.1416 |
| 2 | 4 | 10.4115 | 10.1703 | 5.188 |

### `floor/F1` (labelled)
| seed | rep | MongoDB tuned | PostgreSQL quorum-strict (this line's variant) |
|---|---|---|---|
| 1 | 0 | 10.372 | 23.1595 |
| 1 | 1 | 10.1554 | 23.0906 |
| 1 | 2 | 10.3417 | 25.5418 |
| 1 | 3 | 10.1319 | 25.5209 |
| 1 | 4 | 10.1035 | 23.7439 |
| 2 | 0 | 10.3157 | 23.7092 |
| 2 | 1 | 10.1743 | 23.8598 |
| 2 | 2 | 10.2784 | 23.2594 |
| 2 | 3 | 10.2149 | 26.298 |
| 2 | 4 | 10.3996 | 23.2542 |

### `overhead:default/F1` (labelled)
| seed | rep | MongoDB | PostgreSQL outbox-only (this line's variant) |
|---|---|---|---|
| 1 | 0 | 20.8747 | 36.5217 |
| 1 | 1 | 11.3844 | 28.5349 |
| 1 | 2 | 11.7253 | 28.0406 |
| 1 | 3 | 20.8585 | 28.3539 |
| 1 | 4 | 11.7061 | 34.915 |

### `overhead:tuned/F1` (labelled)
| seed | rep | MongoDB | PostgreSQL outbox-only (this line's variant) |
|---|---|---|---|
| 1 | 0 | 10.372 | 23.2208 |
| 1 | 1 | 10.1554 | 20.9795 |
| 1 | 2 | 10.3417 | 26.0382 |
| 1 | 3 | 10.1319 | 25.5441 |
| 1 | 4 | 10.1035 | 23.2173 |

### `tuned/F1b` (labelled)
| seed | rep | MongoDB | PostgreSQL quorum-strict (this line's variant) | classic-strict (not compared) |
|---|---|---|---|---|
| 1 | 0 | 6.0304 | 10.3991 | 5.2045 |
| 1 | 1 | 6.1232 | 5.1586 | 5.1817 |
| 1 | 2 | 5.9074 | 5.1431 | 5.1645 |
| 1 | 3 | 6.3441 | 5.1469 | 5.1539 |
| 1 | 4 | 5.8809 | 5.1586 | 5.1437 |
| 2 | 0 | 6.073 | 10.2492 | 5.1761 |
| 2 | 1 | 5.4802 | 5.1475 | 5.1846 |
| 2 | 2 | 5.7471 | 5.1539 | 5.2309 |
| 2 | 3 | 5.2107 | 5.1485 | 10.1576 |
| 2 | 4 | 5.8821 | 10.1639 | 5.1654 |

## What MongoDB did well
- **`mongodb-fits` in 6 of 8 compared scenarios:** `default/F1` (5 of 5 seed-1 pairs, reproduction -24.9642 s); `default/F2a` (5 of 5 seed-1 pairs, reproduction -9.7462 s); `default/F3` (5 of 5 seed-1 pairs, reproduction -3.1118 s); `tuned/F1` (5 of 5 seed-1 pairs, reproduction -10.9708 s); `tuned/F2a` (5 of 5 seed-1 pairs, reproduction -10.2184 s); `tuned/F3` (5 of 5 seed-1 pairs, reproduction -9.0009 s).
- **The shortest outage in every compared pair it was allowed to contest:** in the 6 `mongodb-fits` scenarios it was ≥ 20 % shorter in 30 of 30 seed-1 pairs, and the seed-2 sign agreed in all 6. Its F3 ack gap was 0.40–0.80 s against 3.46–10.60 s.
- **Shorter outage in all 20 F2b pairs** as well (see the note under the Result table). F2b went to PostgreSQL on the feed gate alone.
- **`pss` passed the write gate in all 104 of its counted cells**, with 0 lost acknowledged writes over 271105 acknowledged. Its change-stream feed passed 101 of 104; the 3 failures were one duplicated effect each, all in F2b (the cause of both `gate-only` lines).
- **Fewest component kinds:** 4 against PostgreSQL's 12 (slot feed) or 9 (outbox), and 0 extra processes against 6. The components verdict is `postgres-fits` only through the gate (see Components).
- **`pss` had no false failover** in its 4 steady cells.

## What PostgreSQL did well
- **`postgres-fits` (`gate-only`) in 2 of 8 compared scenarios, `default/F2b` and `tuned/F2b`.** Both come from the feed gate: both variants' `outbox` and `slot` feeds passed every F2b cell, while MongoDB's change stream duplicated one effect in 3 of its 20. On outage PostgreSQL was slower in every F2b pair.
- **`classic-strict` passed the write gate in all 104 of its counted cells**, with 0 lost acknowledged writes over 296414 acknowledged.
- **`classic-strict` had no false failover** in its 4 steady cells.
- **`quorum-strict` passed the write gate in all 116 of its counted cells**, with 0 lost acknowledged writes over 350184 acknowledged.
- **`quorum-strict` had no false failover** in its 6 steady cells.
- **Its `outbox` feed (`classic-strict`) passed in all 104 cells.**
- **Its `slot` feed (`classic-strict`) passed in all 104 cells.**
- **Its `outbox` feed (`quorum-strict`) passed in all 116 cells.**
- **Its `slot` feed (`quorum-strict`) passed in all 116 cells.**

## Gates
Sums and counts over every counted cell file (fault and steady cells; the labelled lines included, on their own rows). Nothing here is a new statistic.

| Arm | Variant | Cells (valid) | Write gate passed | Acknowledged writes | Lost acknowledged | Phantom | Duplicate-first | Ambiguous (resolved by the oracle) | Single-copy acks (windows) |
|---|---|---|---|---|---|---|---|---|---|
| MongoDB | pss | 104 (104) | 104 of 104 | 271105 | 0 | 0 | 0 | 0 | 0 (0) |
| PostgreSQL | classic-strict | 104 (104) | 104 of 104 | 296414 | 0 | 0 | 0 | 0 | 3030 (2) |
| PostgreSQL | outbox-only (labelled) | 10 (10) | 10 of 10 | 24188 | 0 | 0 | 0 | 0 | 1565 (1) |
| PostgreSQL | quorum-strict | 116 (116) | 116 of 116 | 350184 | 0 | 0 | 0 | 0 | 12537 (12) |

**Accepted but never acknowledged** (F2a / F2b only; exact on both arms, never counted as a loss):

| Arm | Variant | Accepted, never acknowledged | Accepted, later rewritten |
|---|---|---|---|
| MongoDB | pss | 0 | 234 |
| PostgreSQL | classic-strict | 0 | 257 |
| PostgreSQL | quorum-strict | 0 | 263 |

**Feeds** (a feed passes a cell when it has every effect once, none missing, none phantom; "resumed" counts the fault cells where it passed with a recorded resume):

| Arm | Variant | Feed | Passed | Resumed after the fault |
|---|---|---|---|---|
| MongoDB | pss | stream | 101 of 104 | 97 of 100 |
| PostgreSQL | classic-strict | outbox | 104 of 104 | 100 of 100 |
| PostgreSQL | classic-strict | slot | 104 of 104 | 100 of 100 |
| PostgreSQL | classic-strict | plain (labelled) | 50 of 104 | 46 of 100 |
| PostgreSQL | outbox-only | outbox | 10 of 10 | 10 of 10 |
| PostgreSQL | quorum-strict | outbox | 116 of 116 | 110 of 110 |
| PostgreSQL | quorum-strict | slot | 116 of 116 | 110 of 110 |
| PostgreSQL | quorum-strict | plain (labelled) | 52 of 116 | 46 of 110 |

**Single-copy acknowledgements under strict:** `classic-strict` 3030 acks in 2 windows over 104 cells; `quorum-strict` 12537 acks in 12 windows over 116 cells.
- These windows occurred after the strict switch. 15567 acknowledgements fell in 10 strict cells, 1 window each (the other 4 of the 14 windows logged no acknowledgement): `classic-strict` default F1 rep1-seed1 and tuned F1 rep4-seed2; `quorum-strict` default F1 rep1-seed1, default F2b rep1-seed2 and rep3-seed1, tuned F1 rep0-seed1 and rep4-seed2, tuned F2b rep2-seed1 and floor F1 rep4-seed2 (each 75–92 s with an empty list, 1505 to 2171 acks); and `quorum-strict` tuned F1b rep1-seed2 (0.017 s, 1 ack). 3 of them are F2b cells of `quorum-strict`, the variant chosen for both F2b lines. The labelled, non-strict `outbox-only` default F1 rep1-seed1 logged 1565 acks in 78 s.
- The frozen gate counts lost writes, not single-copy acknowledgements, so no verdict changes, and no acknowledged write was lost in any of these cells. Their cause (a real single-copy interval or the observer reading the wrong node) is not established by the cell files.

**Steady cells** (10 minutes, no fault; false failovers):

| Arm | Variant | Timing | Seed | Gate | False failovers |
|---|---|---|---|---|---|
| MongoDB | pss | default | 1 | pass | 0 |
| MongoDB | pss | default | 2 | pass | 0 |
| MongoDB | pss | tuned | 1 | pass | 0 |
| MongoDB | pss | tuned | 2 | pass | 0 |
| PostgreSQL | classic-strict | default | 1 | pass | 0 |
| PostgreSQL | classic-strict | default | 2 | pass | 0 |
| PostgreSQL | classic-strict | tuned | 1 | pass | 0 |
| PostgreSQL | classic-strict | tuned | 2 | pass | 0 |
| PostgreSQL | quorum-strict | default | 1 | pass | 0 |
| PostgreSQL | quorum-strict | default | 2 | pass | 0 |
| PostgreSQL | quorum-strict | floor | 1 | pass | 0 |
| PostgreSQL | quorum-strict | floor | 2 | pass | 0 |
| PostgreSQL | quorum-strict | tuned | 1 | pass | 0 |
| PostgreSQL | quorum-strict | tuned | 2 | pass | 0 |

## Predictions (frozen) against the result
The frozen lines are PREREG v1.1's (this PC's, unchanged since v1, and both advocates' "v1.1 updates"). The v1 lines are kept as frozen in PREREG.md, superseded by v1.1, and not re-scored here. Outcomes are from VERDICT.json; ranges from the per-pair tables.

| Who | Prediction (PREREG v1.1) | Result | Right? |
|---|---|---|---|
| This PC | the gate passes on both arms | MongoDB failed the F2b gate at both timings (feed: 3 of 20 cells, one duplicated effect each); PostgreSQL passed | no |
| This PC | F1 / F2a / F2b `mongodb-fits`, default and tuned | F1, F2a `mongodb-fits` at both; F2b `postgres-fits`, `gate-only`, at both | F1, F2a yes; F2b no |
| This PC | F3 `both-fit` | `mongodb-fits` at both timings | no |
| This PC | feed `both-fit` (outbox) | the rule has no separate feed verdict; PostgreSQL's outbox and slot passed every cell; MongoDB's stream 101 of 104 | not scorable as stated |
| This PC | components `mongodb-fits` | `postgres-fits`, `gate-only` (kinds 4 against 12 / 9 meet the kinds test for MongoDB) | no by verdict; yes by kinds |
| MongoDB advocate | F1 default `mongodb-fits`, high (about 11–16 s against 30–42 s) | `mongodb-fits`; MongoDB 10.62–20.87 s, PostgreSQL (classic-strict) 25.55–36.59 s | verdict yes; ranges partly |
| MongoDB advocate | F1 tuned `mongodb-fits`, moderate-high | `mongodb-fits` | yes |
| MongoDB advocate | F2a / F2b as F1 | F2a `mongodb-fits` at both; F2b `postgres-fits`, `gate-only`, at both | F2a yes; F2b no |
| MongoDB advocate | F3 `both-fit`, leaning MongoDB, low | `mongodb-fits` at both timings | no (the lean was right) |
| MongoDB advocate | components `mongodb-fits`, high | `postgres-fits`, `gate-only` | no by verdict; yes by kinds |
| PostgreSQL advocate | F1 / F2a / F2b `mongodb-fits`, high (tuned about 5.5–7 s against 19–23 s) | F1, F2a yes; F2b `postgres-fits`, `gate-only`; tuned F1 MongoDB 10.10–10.40 s, PostgreSQL (quorum-strict) 20.52–23.49 s | F1, F2a yes; F2b no; the PostgreSQL range yes, the MongoDB range no |
| PostgreSQL advocate | F3 `mongodb-fits` about 55 % / `both-fit` about 45 %, low | `mongodb-fits` at both timings | yes (its 55 % side) |
| PostgreSQL advocate | feed `both-fit` | as for this PC | not scorable as stated |
| PostgreSQL advocate | components `mongodb-fits`, high | `postgres-fits`, `gate-only` | no by verdict; yes by kinds |

Nobody predicted a MongoDB feed failure in F2b.

## Disturbances and how we handled them
- **The rule (the same as the earlier change-feed study's).** A counted cell that overlapped heavy foreign work on the PC (browsers, builds, installs, test suites, container work, model loads, big disk sweeps) is discarded, kept (never deleted), and re-run by resuming the plan with the same command. Pauses between cells, with no cell running, disturb nothing.
- **Pauses between cells:** 6, none with a cell running.
- **48 counted cell runs were discarded and re-run** (all kept in `discarded/`; `DISTURBANCES.md` → "Summary: every file in `discarded/`"):

| Cause | Windows | Count | Rule |
|---|---|---|---|
| foreign heavy work seen by the lab (a lease and a browser; a local package registry) | inside a running cell (`-disturbed-`) | 2 | heavy foreign work in a cell discards it |
| other sessions' own reports of unleased heavy work | A, B, C | 16 (8 + 3 + 5) | the reported window widened by 1 min each side; every overlapping cell discarded |
| a local model load, found by hand | D, E, F, G | 4 | a model load (a new model server) in a cell discards it; idle overhead does not |
| this lab's own agents running test suites | H | 6 | test suites are heavy work; agents need a lease |
| a local model load, the LLM guard | H (1), K (6), L (4), M (3), N (6) | 20 | the same, applied by `lab03_llm_guard.py` at cell end |
| this lab's own agents (sketch 7b) | I | 0 (open, below) | as H |
| **total** | | **48** | |

- **The 7 MongoDB discards** (all re-run): `mongo-pss-tuned-F1-rep3-seed1` (G); `mongo-pss-default-F3-rep3-seed1`, `mongo-pss-tuned-F3-rep4-seed1`, `mongo-pss-tuned-F2a-rep4-seed1` (K); `mongo-pss-default-F3-rep0-seed2` (M); `mongo-pss-default-F2b-rep4-seed2`, `mongo-pss-tuned-F1b-rep4-seed2` (N). The other 41 are PostgreSQL cells, among them 7 F2b cell runs: 3 moved by the guard (`pg-quorum-strict-tuned-F2b-rep4-seed1` K, `pg-quorum-strict-default-F2b-rep0-seed2` L, `pg-quorum-strict-tuned-F2b-rep0-seed2` M) and 4 in the `-disturbed-`, A, C and H windows. The per-window cell lists are in `DISTURBANCES.md`.
- **None of MongoDB's 3 failing F2b cells is a re-run of a discarded cell.**
- **Open, window I** (sketch 7b's agents' test suites, 11-08 22:45 onwards, end time not recorded): 5 counted files that were not discarded have mtimes inside it: `pg-quorum-strict-default-F3-rep0-seed2` and `pg-classic-strict-default-{F1,F1b,F2a,F2b}-rep0-seed2`. Whether they overlapped heavy work cannot be decided from the record. One of them, `pg-classic-strict-default-F1-rep0-seed2` (35.1979 s), is a compared seed-2 value (`default/F1`); all 5 seed-2 differences there are negative, so removing it would not change the verdict's sign. None is a MongoDB cell and none is in F2b's compared variant.
- **Window J** (11-09 about 01:32): every python.exe on the PC stopped, the plan included. No cell was running and nothing was discarded.
- **3 marked cells left no file** (logged "done but no file"); the plan re-ran them as pending.
- **Not disturbances:** 7 harness-invalid files in `invalid/` (5 smoke, 2 counted), re-run by the plan; the memory-gate exits.
- **The limit:** some windows are the other sessions' own accounts of when their work ran, widened by a minute on both sides, so an overlap outside them cannot be ruled out.

## Limits
- **One machine, one OS stack:** a Windows host running Docker (Docker Desktop 4.56.0 (214940)) on WSL2, kernel `6.18.54.1-microsoft-standard-WSL2`; the Docker VM had 6 CPUs and 10431369216 bytes (9.7 GiB) of memory. Both arms ran their 3 nodes as containers on that one host.
- **Single host, so the partitions are simulated** with `docker network disconnect` on one Docker host (two networks: client and peer). Real multi-host networks, disks and clocks are out of scope.
- **Scope of the designs:** a MongoDB PSS replica set against PostgreSQL with Patroni and etcd and a libpq multi-host client. HAProxy and pg_auto_failover are not primary arms; sharding and Kubernetes operators are out of scope.
- **Strict only.** The compared PostgreSQL variants are the `synchronous_mode_strict` ones, because the pre-registered single-copy check fired; the non-strict variants were measured only in smoke cells.
- **The selection leans slightly toward PostgreSQL.** Its variant is chosen on seed 1 and compared on the same seed-1 data. Seed 2's numbers are out of sample; its gate outcomes are not (a variant must pass every cell on both seeds).
- **F1b is labelled** (a process kill is not the node death the comparison is about) and never decides.
- **Strict did not remove the observer's single-copy windows** (see Gates): 10 counted strict cells logged acknowledgements while `synchronous_standby_names` was empty, with 0 lost acknowledged writes. The frozen gate does not count them and their cause is not established, so this run does not show that the strict variants kept two copies throughout.
- **Window I is open** (see Disturbances): five counted seed-2 PostgreSQL files may overlap sketch 7b's test suites; the end time of I has not been given.

## Publication integrity note (11 November 2026)
The original frozen SHA256SUMS is retained in the private evidence archive, unchanged (sha256 16ec00d2d1f3b9e462934d09dd376154dc3ed4c4cf5e7705ccf160a6c808f98a; 6020 entries). It lists an earlier DISTURBANCES.md hash, f04fef34188eb9ccc140c86460138f123acfaa6bfef88098a9e5e09bef389036. It does not verify the later reconciliation cited here, whose hash is c13174ece428dc180232c3e3451607dd49a1d0ab05e01bd54f3a0d8a601a0a6f. The supervisor log also changed after the 15:25 draft; its final version is pinned at later private commit dc62a35fbb3a534738738d983cc24e3359dc9d6f. At d5e74de7 its hash was f6c8342b8e16e3ded02fd1adf80d4513a9c3b67687388c55044237679dbd23ce; the final cited log hashes e5cc4e61ee03c52af61a7b38cb3388a2b07974932e2aa147c0922f2da19e820a, rather than that draft's 5699fc7c074a5d241648eef60b41a0b5dda10c4ce30b34b997ad0d718bf3313a.

Instead of overwriting the frozen manifest, publication-sources.json pins the later source versions separately, and final-document-hashes.sha256 pins this publication's documents. The generator's earlier 22/48 discard mismatch is corrected by the complete 48-file reconciliation above. This additive accounting closes the publication-document identity gap; it does not establish that all raw records match the original manifest.

The source result and amendment drafts are from private revision d5e74de709cfe0ab0e6ef575cdefd28bdaf6ae97, dated 10 November 2026. Source result advocate reviews requested corrections and include vetoes. They are published as earlier draft reviews, not final acceptance. The later result draft incorporates remedies; final independent publication review is a separate landing requirement. Raw cells and runner remain private, so this is an internally evidenced study, not a publicly rerunnable experiment or an independent replication.

## Sources
All paths are relative to the experiment directory.

| Claim | File and key |
|---|---|
| Verdicts, basis, labels, flags | `runner/results/lab02/VERDICT.json` → `scenarios.<timing>/<fault>.verdict`, `.basis`, `.label`, `.flags`, `.labelled_fault`, `.compared_metric` |
| Gate per scenario | `runner/results/lab02/VERDICT.json` → `scenarios.*.gates.mongo`, `.gates.pg` |
| PostgreSQL variant and feed chosen | `runner/results/lab02/VERDICT.json` → `scenarios.*.pg_variant`, `.feeds.mongo`, `.feeds.pg` |
| Selection medians | `runner/results/lab02/pg-<variant>-<timing>-<fault>-rep<r>-seed1.json` → `result.compared.median`; median of the 5 per `runner/lab02lib/verdict.py` `median_of_medians` |
| Wins and reproduction | `runner/results/lab02/VERDICT.json` → `scenarios.*.wins`, `.repro_median_diff` |
| Per-pair numbers | `runner/results/lab02/VERDICT.json` → `scenarios.*.pairs."1"`, `.pairs."2"`; the variant not compared and F3's literal outage: `runner/results/lab02/<cell>.json` → `result.compared.median`, `result.outage.median` |
| Labelled lines | `runner/results/lab02/VERDICT.json` → `scenarios."floor/F1"`, `scenarios."overhead:<timing>/F1"`, `scenarios."<timing>/F1b"` |
| F2b gate cause | `runner/results/lab02/mongo-pss-*-F2b-*.json` → `result.oracle.feeds.stream.duplicated`, `result.oracle.accepted_later_rewritten`, `result.gate.write_pass`, `result.gate.reasons`, `result.gate.feeds.stream.resume`, `result.feed_events.stream` |
| Predictions | `PREREG.md` → "Predictions (frozen with this file)", "v1.1 updates" |
| Components | `runner/results/lab02/VERDICT.json` → `components` (`verdict`, `basis`, `mongo_kinds`, `pg_kinds`, `mongo_processes`, `pg_processes`, `pg_feed`, `items`); `runner/lab02lib/components.py` |
| Gate sums (lost, phantom, duplicate-first, ambiguous, accepted-never-acked) | `runner/results/lab02/<cell>.json` → `result.oracle.lost.count`, `.phantom.count`, `.dup_first.count`, `.ambiguous`, `.acked`, `.accepted_never_acked`, `.accepted_later_rewritten`; `result.gate.write_pass` |
| Feeds | `runner/results/lab02/<cell>.json` → `result.gate.feeds.<feed>.pass`, `.resume`, `.labelled` |
| Single-copy acknowledgements | `runner/results/lab02/<cell>.json` → `result.single_copy.acks`, `.windows`, `.empty_s` |
| Steady cells | `runner/results/lab02/<arm>-<variant>-<timing>-steady-seed<s>.json` → `result.false_failovers.total`, `result.gate.pass` |
| Timings in force | `runner/results/lab02/<cell>.json` → `in_force.before` (MongoDB), `in_force.ttl` / `.loop_wait` / `.retry_timeout` / `.synchronous_mode_strict` (PostgreSQL) |
| Validator floors | `runner/results/lab02/patroni-validator.json` → `floors`, `tuned`, `rejected_below` |
| Versions and host | `runner/results/lab02/manifest-mongo-20261110T142047Z.json` → `client.server.version`, `client.pymongo`, `client.server.write_concern`, `docker_info`; `runner/results/lab02/manifest-pg-20261110T091252Z.json` → `client.server.version`, `patroni_version`, `etcd_version`, `client.psycopg` |
| Fault window and thread count | `runner/results/lab02/<cell>.json` → `phases.WINDOW`, `result.outage.threads` |
| The strict switch | `runner/results/lab02/smoke-pg-*.json` → `result.single_copy`; `PREREG.md` (Arms), `FREEZE-NOTES-v1.1.md` (the single-copy window) |
| Rule constants | `runner/lab02lib/verdict.py` → `SHORTER`, `NEED_WINS`, `REPS`, `FEWER_KINDS` |
| Disturbances and discards | `runner/results/lab02/DISTURBANCES.md` (pause and discard tables, windows A to N, "Summary: every file in `discarded/`"); `runner/results/lab02/discarded/`; `runner/results/lab02/invalid/` |
| Question, arms, faults, out of scope | `PREREG.md` (Question, Arms, Faults, Out of scope); `FREEZE-NOTES.md`; `FREEZE-NOTES-v1.1.md` |

VERDICT.json sha256: `d2e7a0294d9158f1db6bba89b180a72d03135359a2dc02672fbbcee4b233e9fb`.
