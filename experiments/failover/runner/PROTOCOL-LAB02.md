# Lab 02 runner protocol (runner protocol, not a PREREG amendment)

Written 2026-10-25 by the design author, before any Lab 02 container has run. `../PREREG.md` (frozen v1) is the contract:
arms, workload, faults, measures, gate, repetitions and verdict rule. This file fixes only what the PREREG leaves to the
runner. Where filling a gap could change a PREREG measure, it was **not** done silently: it was listed as a proposed
amendment (A1–A12) for the founder and this lab. **v1.1 (2026-10-25):** both advocates reviewed A1–A12 (6 vetoes, all
accepted); the resolution is `../FREEZE-NOTES-v1.1.md`, the reviews are `../reviews/v1.1-*.md`, and the code now
implements it ([Amendments and their resolutions](#amendments-and-their-resolutions-v11)). Any later change to this
file is a dated runner amendment, as in EXP 020's `PROTOCOL-S2.md`.

## Files
| File | What it is |
|---|---|
| `compose-mongo.yml` | MongoDB 8.0 PSS: `mongo1..3` + the keyFile generator + the client |
| `compose-pg.yml`, `pg-node/` | 3 nodes of PG16 + Patroni 4 (`etcd3:`) + an etcd 3.5 member; the node image; the HAProxy profile |
| `client/lab02_client.py` | in the client container: writers, observer, control port, feeds, oracle |
| `lab02.py` | host: `check`, `up`, `apply`, `probe`, `manifest`, `down`, `wipe` |
| `lab02_cell.py` | host: one cell |
| `lab02_plan.py` | host: the counted matrix, resumable |
| `lab02_verdict.py` | host: the verdicts from the cell files |
| `lab02lib/` | the pure parts (seeds, plan, measures, observer, verdict, components, gates, faults, retry, proof records) |
| `tests/` | the unit tests: `py -m pytest tests -q`, offline, about a second |

## Gates before any cell
- **Publication.** No counted cell runs before this lab publishes the pre-registration. `lab02_plan.py` and
  `lab02_cell.py` (without `--smoke`) refuse to start unless `runner/PUBLISHED.json` exists with
  `{"odin_rnd_publish_sha": "<git sha>"}`. The runner never writes that file. The sha goes into every counted cell's
  JSON and the manifest.
- **No other benchmark.** Lab 02 refuses to start while EXP 020 S2 holds its cell lock
  (EXP 020 S2's cell-lock file, with a live pid). The plan waits while
  `results/lab02/PAUSE` exists, between cells, as S2 does.
- **The cell lock.** `results/lab02/cell.lock` holds the pid of the running cell. A second cell refuses to start. A
  stale lock (dead pid) is replaced.
- **The memory gate.** An arm's stack starts only with **at least 7 GiB free** on the host, and only if the Docker VM
  has at least 7 GiB in total. Each arm is 3 nodes × 2 GB, plus the client (1 GB). Never two stacks at once: the plan
  wipes both before each block.
- **The disturbance rule (EXP 020).** A counted cell that overlapped other heavy work on the host (filming, another
  benchmark, a full test run) is moved to `results/lab02/invalid/` with the reason, and re-run.

## The stacks
- **Topology.** Two networks per stack, `app` (client traffic) and `ha` (peer and replication traffic). Every node has a
  static address on both (`lab02lib/topology.py`). The same hostname resolves to a node's `ha` address inside the nodes
  and to its `app` address inside the client (per-container `extra_hosts`). So `docker network disconnect` of `ha` cuts
  the peers but not the client (F2b), and the replica set / Patroni configs name one host per member.
- **No restart policy.** A killed node stays dead until the runner heals it.
- **MongoDB.** `mongo:8.0.12`. 3 members, priority 1 / votes 1, no arbiter. keyFile + auth. `--wiredTigerCacheSizeGB 0.75`.
  2 GB / 2 CPU each. `rs.initiate` and the root user are created by `lab02.py up` through the localhost exception.
- **PostgreSQL.** `postgres:16.10-bookworm` + `patroni[etcd3,psycopg3]==4.0.6` + `quay.io/coreos/etcd:v3.5.21`, one image
  (`pg-node/Dockerfile`). `initdb --data-checksums`, `use_pg_rewind`, `synchronous_commit=on`, `hot_standby_feedback=on`,
  `wal_level=logical`, a Patroni permanent logical slot `lab02_perm`, `shared_buffers` 512 MB /
  `effective_cache_size` 1 GB / `work_mem` 16 MB (a quarter / half of the 2 GB node).
  - The bootstrap uses classic sync. Quorum sync (ANY 1) is put in force by `patronictl edit-config` in `lab02.py up`,
    before any cell. Reason: Patroni 4.0.6's validator types `bootstrap.dcs.synchronous_mode` as a boolean ("quorum is
    not a boolean", measured on 2026-10-25), although the runtime accepts `quorum`.
- **Pinning.** Images are pinned by tag in the files. `lab02.py manifest` records their digests at run time.
- **Secrets.** Passwords are generated on first use into `.secrets/lab02.env` (gitignored). The keyFile is generated
  inside its own Docker volume. Neither is ever committed.

## The client and the workload
- **Proof records.** Shaped like the agent space's own proof records (id, t, agent, asked_by, question ≤ 240, answer ≤ 600,
  why ≤ 300, source, sources, via, ok, ms, lens), padded to about 2,048 bytes of JSON.
  - Ids are chosen by the client, `<agent>-<cell token>-<n>`.
  - The content is seeded by (seed, rep, fault), so both arms of a pair write the same bytes.
  - The records are built before the writers' clock starts (EXP 020 amendment 03).
- **Writers.** 8 threads at 20 writes/s in total. Record *i* is due at t0 + i / 20, on thread *i* mod 8. A late write
  is written at once, and its lateness is recorded (`start_late_p95_ms`).
- **One shared retry loop** (`lab02lib/retry.py`, the same code on both arms): the same id, 0.5 s backoff, a 90 s budget
  from the first attempt's start, after which no new attempt starts. A duplicate on a retry means the first attempt
  committed: it is acknowledged (`dup_acked`). Every failed attempt is logged with its kind and whether it was
  ambiguous. A duplicate on a *first* attempt (`dup_first`) is a runner bug and invalidates the cell.
- **MongoDB writes.** `bulk_write([InsertOne])` with `{w: "majority", j: true}` explicit.
  - URI: a seed list of all 3 members, `replicaSet=rs0`, `retryWrites` / `retryReads`, `timeoutMS=5000`,
    `serverSelectionTimeoutMS=30000`, monitoring at its default.
  - **Hidden driver retries** are logged by a PyMongo `CommandListener`. A thread-local attempt context separates the
    driver's internal retry from the application's (`hidden-retries.jsonl`).
- **PostgreSQL writes.** One connection per writer thread.
  - libpq multi-host `host=pg1,pg2,pg3 target_session_attrs=read-write connect_timeout=2 tcp_user_timeout=5000
    keepalives=1 keepalives_idle=5 keepalives_interval=1 keepalives_count=3`, `statement_timeout` 5 s.
  - `INSERT … ON CONFLICT (id) DO NOTHING` plus `SELECT pg_current_xact_id()`, in one transaction (R4).
- **The feeds.** Effect and cursor are written in one transaction, with EXP 020 S2's rules (amendments 01–04: the
  commit-LSN cursor; batches of up to 100; MongoDB applies once its local buffer is empty; `maxAwaitTimeMS` 200 /
  `batchSize` 100 / a 50 ms outbox poll).
  - Each consumer resumes from its persisted cursor after any error (0.5 s pause).
  - MongoDB: a change stream with `startAfter` the persisted token (read concern majority).
  - PostgreSQL runs **three consumers in every cell, each with its own sink**: the commit-order-safe outbox (`xid8`,
    `seq`); pgoutput on the Patroni permanent slot; and plain pgoutput on a client-created slot (the labelled failing
    variant). The plain consumer recreates a missing slot at the current position, as a naive application would, so
    its gap shows in the oracle.

## One cell (`lab02_cell.py`)
| Phase | What happens | Counted | Smoke |
|---|---|---|---|
| pre | Wait until fully redundant. Put the timing cell and variant in force (`lab02.py apply`, recorded). Wait until fully redundant again. Fresh rows (`setup`). Start the feed consumers. On PostgreSQL, take etcd's metrics | ≤ 300 s | ≤ 180 s |
| session | The writers, the observer (every node every 250 ms) and the control port start. Clock offset: 20 samples over the loopback control port, minimum round trip | | |
| steady | Writes run until the seeded fault instant | 30–60 s | 8–12 s |
| fault | The injector runs (below). Stamped on the host, then converted to the client clock | | |
| hold | The fault stays in place: at least `HOLD_MIN`, and 5 s past every thread's first ack after the fault, never beyond `HOLD_MAX` | 45–180 s | 20–90 s |
| heal | F1: `docker start`. F2a / F2b: `docker network connect --ip <same address>`. F1b / F3: nothing to heal | | |
| redundancy | Wait until fully redundant: every node up, exactly one writable, the others streaming and caught up | ≤ 600 s | ≤ 300 s |
| tail | Writes continue, then the writers stop (a write in its retry budget finishes) | 20 s | 10 s |
| drain | The oracle is polled until every non-labelled feed has every committed record | ≤ 180 s | ≤ 60 s |
| oracle | MongoDB: every node's `rollback/` directory is streamed to the client and this cell's ids are kept. PostgreSQL: etcd's metrics again. Then the readback and the measures | | |
| teardown | Kill the consumers. Copy the raw logs to `results/lab02/raw/<cell>/` (gitignored; their sha256 go in the cell JSON). The stack stays up for the block's next cell | | |

- **Steady cells** (`--fault steady`): 600 s of writes with no fault (smoke: 60 s). They measure false failovers and the
  gate in a quiet phase.
- **"Caught up"** means lag ≤ 1 s on both arms (v1.1 R9): MongoDB optime lag; PostgreSQL `replay_lag` from the
  leader's `pg_stat_replication` (0 when NULL and fully replayed).
- **PostgreSQL's full redundancy** also requires, on every replica (v1.1, the PostgreSQL advocate's V2): the permanent
  slot present (except on the A7 overhead stack), Patroni `pending_restart` false, and the leader's
  `synchronous_standby_names` naming it. That time counts in time-to-redundancy.
- **The seeds.** The fault instant is `random.Random("lab02:<seed>:<rep>:<fault>").uniform(window)`. It never depends on
  the arm or the variant, so both arms of a pair are faulted at the same offset into identical write streams. The
  values are pinned by a unit test.

## Faults (`lab02lib/faults.py`)
| | Injector (host) | Heal |
|---|---|---|
| F1 | `docker kill -s KILL lab02-<primary>` | `docker start` |
| F1b (labelled) | `kill -9` of mongod (pid file of the node's restart loop) / of the postmaster (`postmaster.pid`); the node's supervisor restarts it | none |
| F2a | `docker network disconnect` from `ha`, then from `app` | reconnect both, same addresses |
| F2b | `docker network disconnect` from `ha` only | reconnect, same address |
| F3 | MongoDB: `replSetStepDown` 60 s, `secondaryCatchUpPeriodSecs` 10, against the primary. PostgreSQL: `patronictl switchover --leader <primary> --candidate <sync standby> --force` (a streaming quorum / sync standby, chosen by seed) | none |

- **Partition method.** One method on both arms, `docker network disconnect` (FREEZE-NOTES M8). It is recorded in the
  cell JSON.
- **Recovery before the next fault.** Every next fault waits for full recovery: the redundancy wait above, then the
  next cell's own redundancy check. A cell that never reaches full redundancy marks the stack for a rebuild, and the
  plan rebuilds it before the next cell.

## Measures (`lab02lib/measures.py`, `lab02lib/observe.py`)
- **The clocks.** Acks, observer samples and feed effects are stamped with the client container's clock, which the
  database containers share (one WSL2 kernel). The host's injector stamps are converted with the measured offset; the
  offset and its uncertainty (half the best round trip) are in every cell JSON.
- **t_fault and t_effect.** `t_fault` is when the injector command is issued. `t_effect` is when it returns, for F1,
  F1b, F2a and F2b: by then the fault has certainly taken effect. For F3, `t_effect` is `t_fault`. See A1.
- **The primary metric: client-visible write outage, per writer thread.** The first acknowledged write with
  t_ack > t_effect, minus t_fault. The cell reports the median over the 8 threads (the compared number) and the max.
  - A thread with no such ack in the cell counts as infinite. The median is then unbounded (null) only if half or
    more of the threads never recovered.
- **F3's compared number (v1.1 A1).** The median over the 8 threads of the longest ack gap that ends in
  (t_fault, hold end]. The literal "fault to first ack" is published too. F1 / F1b / F2a / F2b compare the literal
  rule. Every cell carries `compared` = {metric, median, max}.
- **Also reported:**
  - **The longest single write.** t_ack − t_first, across retries.
  - **Ack gaps.** Per thread, the longest silence between consecutive acks ending in (t_fault, hold end] (bounded).
  - **Feed resume.** The first effect applied for a record acknowledged after the fault, minus the first ack after the
    fault (the MongoDB advocate's rule, so the write outage is not counted twice). Reported per feed variant.
  - **Detection / promotion / rediscovery.** From the observer:
    - detection: a surviving node stops naming the old primary;
    - promotion: a node other than the old primary is writable;
    - rediscovery: the first ack after promotion;
    - the libpq dead-host cost: per thread, the seconds spent connecting between the fault and its first ack after it
      (`connect_timeout` 2 s per reconnect when the dead host is listed first), median and max.
  - **The etcd leader at each fault** (PostgreSQL), and whether it was the old primary (detection is then about
    ttl + 1 s).
  - **The single-copy window** (PostgreSQL): acks made while the writable node's `synchronous_standby_names` was empty,
    and for how long. If the smoke cells show any, the compared PostgreSQL variants become `synchronous_mode_strict:
    true` (`lab02_plan.py --strict`; `lab02_verdict.py` flags it).
  - **Time to full redundancy.** From the heal (F1, F2a, F2b) or from the fault (F1b, F3).
  - **False failovers** in the steady cells: changes of the writable node, plus term bumps that kept it.
  - **etcd fsync latency.** The difference of `etcd_disk_wal_fsync_duration_seconds` between the two scrapes, per
    member (count, mean, p50 / p99 bucket bounds).
  - **Retries.** Retried ids, attempts, `dup_acked`, ids given up, hidden driver retries, and sync-cancel warnings.

## The oracle and the gate
- **Readback.** Every id of the cell is read back from the final primary: MongoDB with read concern majority;
  PostgreSQL from the new primary, through the multi-host read-write connection.
  - **lost** = acknowledged and absent. The gate needs 0.
  - **phantom** = present but never written. The gate needs 0.
  - **Ambiguous** ids are attempts that ended in an error that may have committed and were never acknowledged. The
    readback resolves them (`ambiguous_committed` / `ambiguous_not_committed`).
- **Feeds.** For each feed variant:
  - duplicated effects (n > 1);
  - missing effects (a committed record without its effect);
  - phantom effects (an effect without a committed record).
  - Every feed variant's pass and resume time are kept per cell. The scenario's verdict picks **one** feed variant
    that passes in every cell (v1.1 A11; see the verdict). Plain pgoutput is labelled and never rescues the gate.
- **Accepted but never acknowledged (F2b's own number, never a loss).**
  - MongoDB: the cell's ids in any member's rollback files.
  - PostgreSQL (v1.1 A8, exact): in F2a / F2b, before the heal, the old primary (cut off, demoted, not yet rewound) is
    read over its local socket for this cell's ids; minus those acknowledged before the fault took effect.
  - Each is reported as `accepted_never_acked` (absent at the end) and `accepted_later_rewritten` (a retry wrote it
    again), plus the upper bound `unacked_absent`, in one column for both arms. The sync-cancel warning count (v1's
    lower bound) is still published.

## The verdict (`lab02lib/verdict.py`, `lab02_verdict.py`)
- **Per (timing cell, fault), one PostgreSQL variant (v1.1 A11 / MDB V1).** Among the non-labelled variants that pass
  **every** cell on both seeds (and their steady cells at that timing), the lowest median of the seed-1 repetition
  medians; it is used for all pairs on both seeds. The per-repetition best is published only. The same rule picks
  one feed variant per arm and scenario (it must pass in every cell).
- **A variant passes the gate** only if all its cells on both seeds pass (v1 let PostgreSQL pass with some variant
  per repetition: fixed).
- **False failovers (v1.1 MDB V3).** An arm with ≥ 1 false failover in a steady cell at a timing cannot get `-fits`
  at that timing: its lines become `both-fit`, flagged `unstable`. A steady cell's gate failure fails that arm's gate
  at that timing.
- **The outage rule.** An arm fits when its median outage is at most 0.8 × the other's in at least 4 of the 5 seed-1
  pairs, and the seed-2 reproduction points the same way (A4). Otherwise `both-fit`.
- **The gate.** `neither` if neither arm passes. If exactly one arm passes, that arm fits, labelled `gate-only` (A3).
- **invalid.** Any missing or invalid counted cell makes that scenario `invalid`.
- **Components.** A separate verdict (A4): an arm fits with at least 2 fewer component kinds, given the gate.
- **Labelled lines.** Their own lines, never the compared arm: F1b; HAProxy; `floor/F1` (Patroni at the validator
  floor against MongoDB's tuned F1); `overhead:<timing>/F1` (A7, seed 1 only).

## Components (`lab02lib/components.py`, EXP 020's checklist, counted in kinds; processes published too)
| Arm | Kinds | Processes beyond the data members |
|---|---|---|
| MongoDB | replica set, keyFile, oplog-window alarm, feed cursor collection: **4** | 0 |
| PostgreSQL + outbox | Patroni, etcd, synchronous mode, replication role + hba, checksums + rewind, physical-slot WAL-retention alarm, outbox xid8 column + index, feed cursor table, outbox poll loop: **9** | 6 (3 Patroni, 3 etcd) |
| PostgreSQL + permanent slot | the 6 common kinds + `wal_level`, publication, permanent slot, `hot_standby_feedback`, slot-retention alarm, cursor table: **12** | 6 |
| + HAProxy (labelled) | +1 | +1 |

Data members cancel. Defaults are not counted: `w: majority`, `retryWrites`, an unchanged oplog size, and the timing
cells (not needed for correctness). v1.1 A5: retention is charged on both arms; `outbox-growth-alarm` is dropped (the
outbox is the proof table); the idempotency key is counted on neither arm.

## The plan (`lab02_plan.py`)
- **Size.** 5 repetitions per (arm, variant, timing, fault) on seed 1, then the same matrix on seed 2. MongoDB: 1
  variant; PostgreSQL: quorum + classic; 2 timings (PostgreSQL tuned = **20 / 4 / 8**, v1.1 A2); 5 faults. That is
  **300 fault cells**, plus **12 steady cells** (one per arm, variant, timing and seed).
- **Labelled lines in the plan (v1.1):** the Patroni validator floor (timing `floor`, quorum: a steady cell per seed +
  F1 in every repetition, 12 cells, on the PostgreSQL blocks' stack); the A7 overhead block (variant `outbox-only`:
  outbox only, `wal_level=replica`, no slots, `hot_standby_feedback` off; F1 at both timings, 5 repetitions on seed
  1, 10 cells, each repetition its own `lab02.py up --overhead` block). **334 cells** in all. With `--labelled`,
  HAProxy adds 104 more. With `--strict`, the compared PostgreSQL variants are `quorum-strict` / `classic-strict`.
- **Order.** Blocks of (seed, rep, arm). The arm order alternates by repetition, and the fault order rotates by
  repetition. Each block starts from a freshly wiped stack: memory gate, `up`, the validator probe (PostgreSQL), and a
  manifest.
- **Resume.** A cell already in `results/lab02/` is skipped, so a resume runs the same command.
- **Invalid cells.** A runner failure (an injector or heal error, a session that never answered, a runner exception) is
  written to `results/lab02/invalid/` and re-run, at most twice. Arm outcomes are **valid** results, never re-run: no
  recovery within the hold, no full redundancy within the budget, a feed that never drains.
- **Duration.** About 3–6 minutes per fault cell and 11 per steady cell, plus about 3 minutes per block bring-up. That
  is **26–30 hours** in all.

## The run manifest (`lab02.py manifest`, one per block)
- Image ids and repo digests (including the pg-node base images), `docker version`, and `docker info` (memory, CPUs,
  kernel).
- Free host memory.
- The client's driver versions: Python, PyMongo, psycopg, psycopg2.
- The server versions and settings:
  - MongoDB: version, FCV, replica set settings and members, cache bytes;
  - PostgreSQL: version, `data_checksums`, `synchronous_standby_names`, `wal_level`, `hot_standby_feedback`, …;
  - Patroni's dynamic config, the Patroni and etcd versions.
- The **Patroni validator probe** (`results/lab02/patroni-validator.json`): the floors, the floor cell derived from
  them, the frozen tuned cell 20 / 4 / 8 and whether the validator accepts it, and the validator's own words for the
  first rejected value.
- MongoDB's **effective server-selection wait** under CSOT (5 s: capped by `timeoutMS`, not the PREREG's 30 s).
- The runner's git head and dirty flag, the PREREG's sha256, and `PUBLISHED.json`.

## Runner decisions (within the PREREG's latitude; listed so they can be checked)
- **R1** Two networks with static addresses and per-container name resolution (above).
- **R2** The client clock is the measuring clock; the host's offset is measured over the loopback control port.
- **R3** MongoDB: a duplicate counts as committed only if the reply carries no write-concern error. `bulk_write` is used
  because its error keeps `writeConcernErrors`, which `insert_one`'s `DuplicateKeyError` drops.
- **R4** PostgreSQL:
  - A commit that returns with the sync-cancel warning is **not** acknowledged (FREEZE-NOTES M6 / P2).
  - Each write transaction also calls `pg_current_xact_id()`. That forces a commit record, so a duplicate-on-retry
    (which inserts nothing) still waits for the synchronous standby. Without it, a retry against a cut-off old primary
    would return "duplicate" at once, for a row committed only locally, and that row would be lost on rewind.
- **R5** MongoDB nodes run mongod under a restart loop with a 1 s delay, the equivalent of systemd `Restart=always`. F1b
  needs some supervisor, and Patroni plays that role on the PostgreSQL side. See A6.
- **R6** One `MongoClient` for the 8 writer threads (PyMongo's recommended pattern); one libpq connection per writer
  thread on PostgreSQL.
- **R7** PostgreSQL runs all three feed variants in every cell, on separate sinks. See A7.
- **R8** The phase lengths in the cell table.
- **R9** The caught-up threshold: 1 s on both arms (v1.1; v1 had 1 MiB on PostgreSQL).
- **R13 (v1.1)** One `MongoClient` per change-stream consumer process, `watch(start_after=token)` re-opened on resume,
  closed on exit (TERM, then KILL after 2 s). `NotPrimaryError` is ambiguous; a PostgreSQL connect-phase failure is
  not (diagnostic counts only; the readback decides the gate).
- **R10** PostgreSQL bootstraps with classic sync; quorum is applied by `edit-config` (the validator finding above).
- **R11** The plain pgoutput consumer recreates a missing slot.
- **R12** The PostgreSQL keepalive values (idle 5 / interval 1 / count 3) and the memory settings.

## Amendments and their resolutions (v1.1)
Proposed by the runner (v1), reviewed by both advocates, resolved in `../FREEZE-NOTES-v1.1.md` (2026-10-25). The code
implements every resolution; each has a unit test with a negative that the v1 behaviour fails (`tests/test_v11.py`).

- **A1. When the outage starts, and F3.** Resolved: F3's compared number is the median over the threads of the
  longest ack gap ending in (t_fault, hold end]; `ack_gaps` is bounded to that window; the literal number is
  published. F1 / F2a / F2b keep the literal rule (t_fault = the injector's issue; "after" = past its return).
- **A2. Patroni's tuned cell.** Resolved: **20 / 4 / 8** (the PostgreSQL advocate's veto V1). The validator floor
  (20 / 1 / 3 on 4.0.6) is a labelled line: a steady cell + F1. The probe checks that 20 / 4 / 8 is accepted.
- **A3. Only one arm passes the gate.** Resolved: that arm fits, labelled `gate-only`; PostgreSQL's gate is judged per
  variant.
- **A4. The verdict's reading.** Resolved as proposed: (a) a fault verdict is gate + outage only, components are their
  own verdict; (b) "same direction" = the sign of the median of the 5 seed-2 paired differences; (c) the reproduction
  is all 5 repetitions on seed 2.
- **A5. The component counts.** Resolved: MongoDB 4, PostgreSQL + outbox 9. A physical-slot WAL-retention alarm is
  added; `outbox-growth-alarm` is dropped; the idempotency key is counted on neither arm.
- **A6. The F1b supervisor on MongoDB.** Resolved as proposed: a 1 s restart loop, not a component; F1b labelled.
- **A7. PostgreSQL feed variants in one cell.** Resolved: kept, plus the labelled overhead block (outbox only,
  `wal_level=replica`, no slots, F1 at both timings, 5 repetitions on seed 1).
- **A8. F2b's accepted-never-acked on PostgreSQL.** Resolved: made exact, by reading the old primary before the heal
  in F2a / F2b; both arms' numbers sit in one column.
- **A9. Unrecovered threads.** Resolved as proposed: infinite in the median; the cell is valid, never re-run.
- **A10. HAProxy.** Resolved as proposed: only with `--labelled`.
- **A11. The best PostgreSQL variant.** Resolved: one variant per (timing, fault), among those passing every cell on
  both seeds, the lowest median of the seed-1 repetition medians, used for all pairs; one feed variant per scenario
  by the same rule; the per-repetition best is published only.
- **A12. The durable-acknowledgement rules R3 / R4.** Resolved as proposed: they define "acknowledged".

Also resolved in v1.1 (no A-number): MDB V2 (one change-stream client per process, R13), MDB V3 (false failovers and
steady gates count), R9 / PG V2 (caught up in seconds; PostgreSQL's rejoin state in full redundancy), the code
findings (a variant passes only with all its cells; ambiguity classes; bounded `ack_gaps`; the effective selection
wait in the manifest), and the recorded items (the etcd leader, the libpq dead-host cost, the single-copy window and
the switch to strict mode if it fires).

## Before the first smoke cell (in a PAUSE window, after S2)
1. **S2 has finished, or is paused** (its `results/s2/PAUSE`, its cell lock gone). Its stack is stopped, so the memory
   gate passes. Nothing else heavy runs.
2. **MongoDB.** `py lab02.py up --arm mongo`. The first pull of `mongo:8.0.12` checks that the tag exists; if it does
   not, pin the nearest 8.0.x tag in a dated runner amendment. Then `py lab02.py manifest --arm mongo`. Then
   `py lab02_cell.py --smoke` for F1, F1b, F2a, F2b, F3 and `steady`, on `pss` / `default`. Then
   `py lab02.py wipe --arm mongo`.
3. **PostgreSQL.** `py lab02.py up --arm pg` (builds the node image). Then `py lab02.py probe`: check the floors and the
   tuned cell. Then a manifest, the same smoke cells on `quorum` / `default`, one tuned smoke cell, then wipe.
4. **Check in the smoke files:**
   - quorum is in force (`synchronous_standby_names` = `ANY 1 (…)`), and the single-copy window check is 0 (else
     run the plan with `--strict`);
   - the A7 overhead stack comes up (`lab02.py up --arm pg --overhead`: `wal_level=replica`, no slots);
   - in F2a / F2b the old primary is readable before the heal (A8);
   - the permanent slot exists on the replicas and the `slot` feed resumes after F1;
   - psycopg2's replication connection honours the multi-host `target_session_attrs`;
   - F2b shows sync-cancel warnings (PostgreSQL) / rollback files (MongoDB) being counted;
   - the clock uncertainty is ≤ 5 ms;
   - the observer runs at about 4 Hz per node;
   - the drain works, and the oracle's feed and gate fields are filled;
   - `start_late_p95_ms` is near 0 outside the outage.
5. **Hand-off.** Post the smoke results and this protocol to this lab. A1–A12 are resolved (v1.1, above). This lab
   publishes, `PUBLISHED.json` is written with the publish sha, and only then `py lab02_plan.py`.
