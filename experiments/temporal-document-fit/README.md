# MongoDB / PostgreSQL JSONB with Temporal

This isolated experiment asks whether flexible work-order/session data gives MongoDB a useful advantage over PostgreSQL typed columns plus JSONB. Read the frozen [protocol](PROTOCOL.md) first. A successful local run establishes tested mechanisms, not a production-adoption recommendation.

## Reproduce

Use Node 22 and pnpm 10.11.1. Install this directory's dependencies, independently of the website:

```sh
cd experiments/temporal-document-fit
pnpm install --frozen-lockfile
pnpm test
TDF_RUNTIME_ROOT=/absolute/path/to/owned/runtime pnpm preflight
TDF_RUNTIME_ROOT=/absolute/path/to/owned/runtime pnpm experiment
```

The runtime is deliberately external to this public repository. It must contain the exact pinned binaries and fresh synthetic data directories. Obtain PostgreSQL 16.15, MongoDB 8.0.15 and Temporal CLI 1.9.1 (server 1.32.0) from the sources recorded in `protocol.json` and the execution manifest. Record executable SHA-256 hashes and download provenance. Directory layout:

```text
$RUNTIME_ROOT/postgres/bin/{postgres,pg_ctl,initdb}
$RUNTIME_ROOT/mongo/bin/mongod
$RUNTIME_ROOT/temporal/temporal
$RUNTIME_ROOT/state/{postgres,mongo,temporal}
$RUNTIME_ROOT/owned-runtime.json
$RUNTIME_ROOT/runtime-provenance.json
```

Initialize PostgreSQL with `initdb -D "$RUNTIME_ROOT/state/postgres" -U experiment -A trust`; it contains synthetic data and binds loopback only. Launch with `pg_ctl -D "$RUNTIME_ROOT/state/postgres" -l "$RUNTIME_ROOT/state/postgres.log" -o '-h 127.0.0.1 -p 55439 -k /tmp -c shared_buffers=128MB -c fsync=on -c synchronous_commit=on' -w start`. Launch MongoDB with `mongod --dbpath "$RUNTIME_ROOT/state/mongo" --bind_ip 127.0.0.1 --port 27029 --replSet experiment --wiredTigerCacheSizeGB 0.25 --logpath "$RUNTIME_ROOT/state/mongo.log" --pidfilepath "$RUNTIME_ROOT/state/mongo.pid" --fork`. Initialize the one-member `experiment` replica set on `127.0.0.1:27029`. Launch Temporal with `temporal server start-dev --ip 127.0.0.1 --port 17239 --db-filename "$RUNTIME_ROOT/state/temporal/history.db" --headless`.

Before launching, refuse any port collision. Record only PIDs from these launches. `owned-runtime.json` contains `{root,postgresPid,mongoPid,temporalPid,ports:{postgres:55439,mongodb:27029,temporal:17239}}`. After cold restores the runner also retains `data:{postgres,mongodb}`; keep it for subsequent runs. `runtime-provenance.json` records download URLs, versions, hashes and which publisher checksums were verified. The controller uses macOS `lsof`, `ps` and `du` and verifies executable and data-directory identity before any stop. It never attaches to arbitrary listening services. All original and copied database directories are retained.

`node run.mjs --smoke` runs explicitly uncounted correctness and evolution integration checks through Temporal and records their receipts, without timing cells or process-fault tests.

`pnpm preflight` is explicitly uncounted and writes a report. It checks owned process identity, dependencies, actual Temporal worker startup, both stores and source/runtime manifests. It resets the synthetic application schema. For native adapter integration tests, set `TDF_DATABASE_TESTS=1 pnpm test`; these also reset that schema. Do not run integration tests while an experiment is active.

## What the runner measures

One shared workflow and activity implementation runs both adapters. Database I/O occurs inside real Temporal activities, including evolution, correctness and snapshot collection. Dedicated worker processes demonstrate a real crash after committed database work. Activity retries use the same logical operation ID. Workflow start deduplication, duplicate/unauthorized signals, history replay, connection outage, durable restart and clean cold filesystem restore are observed separately from timing.

Five paired repetitions each use concurrency 1 and 10, 1,000 fixtures and exactly 1,000 attempted operations per arm/cell: 20 cells and 20,000 measured attempts. Each cell starts from a reset fixture and both stores' model-field index, with 100 uncounted warm-up operations on disjoint IDs. The pair's arm order alternates. Raw operation rows retain method, request, response projection, attempt count, database elapsed time and Temporal schedule-to-resolution elapsed time. Temporal elapsed time excludes client workflow-start overhead; database time excludes response hashing and telemetry. Responses are projected after the database call to bounded IDs/core fields/payload hashes so workflow-history payloads remain below transport limits.

E3 backfill is split across bounded 100-record activities inside one shared workflow; no activity timeout is increased to fit the migration. Setup/evolution controls have one attempt, avoiding overlapping whole-suite resets after a timeout.

The independent oracle checks intended values, event/receipt/version correspondence, read projections and duplicate-effect negative controls. It does not use agreement between stores as proof. Schema evolution uses shared application semantics, PostgreSQL native changed-path JSONB updates and MongoDB `$set`/`$unset`. Shared business validation reduces differences by design: the result is a compatibility observation, not independent developer-productivity evidence. Native index definitions, plans and storage sizes are retained per arm. Both can evolve without primary table/collection schema changes.

The monitor samples owned process RSS/CPU observations and experiment disk usage every two seconds. Limits are 30 minutes, 4 GiB combined owned RSS and 10 GiB experiment files. This is observational enforcement on an unrestricted host, not a kernel resource partition. A limit, failure or missing case retains partial evidence and prevents a positive outcome. Cell timeout is 120 seconds; activity attempts are 30 seconds with at most three attempts; fault recovery is capped at 120 seconds. No count is silently reduced.

## Evidence and publication boundary

Each run writes `$RUNTIME_ROOT/runs/<run-id>/` with `manifest.json`, `report.json`, `cells.json`, `faults.json`, `evolution.json`, raw `operations.jsonl`, `activity-attempts.jsonl`, resource samples, synthetic snapshots, replay histories and worker logs. The manifest freezes protocol/source/lockfile hashes, exact fixture and pinned dependency/binary versions before counting; final checks reject source drift. Failed runs remain present. Reports distinguish `mechanisms-supported`, `mechanisms-failed` and `inconclusive` and never infer a production adoption decision.

Publish only reviewed sanitized evidence. Manifest paths use `$RUNTIME_ROOT` and `$SOURCE_ROOT`; worker/client identities are generic. Raw worker logs, ownership records and unreviewed stack traces stay local. Native exact launch commands remain in the private runtime journal; normalized commands accompany public evidence. Do not publish entire runtime directories.

Local timings describe this host. Production choice still requires the actual query/workflow mix, operational cost, retention/size distribution, deployment topology, migration cost and recovery/latency targets under a separately frozen protocol.
