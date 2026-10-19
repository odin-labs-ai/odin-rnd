# MongoDB or PostgreSQL JSONB for Temporal application data?

Protocol authored 2026-10-19. Planning artifact; no result is implied. Machine-readable settings are in `protocol.json`. This is a new application-persistence experiment, distinct from EXP 010's MongoDB wire-compatibility comparison. It does not change EXP 010's frozen protocol or execution rules.

## Question and falsification

Does MongoDB make evolving, document-shaped work-order/session data materially easier to handle than PostgreSQL typed columns plus JSONB, while preserving the same correctness under Temporal retries? Both databases accepting flexible JSON is insufficient evidence. The local experiment tests concrete evolution tasks and failure mechanisms. If both arms perform those tasks correctly with comparable changes, the thesis that document shape alone requires MongoDB is unsupported within these bounds. A MongoDB advantage is a reason for further evaluation, never a local production-adoption verdict.

The primary evidence is a per-task evolution and correctness matrix, not a composite score. Record source changes, backfills, index operations, compatibility defects and operator steps per task. Count application/adaptor changes separately from shared harness work. These observations are not general developer-productivity estimates. Latency is descriptive only.

## Isolated arms

- PostgreSQL application store: one isolated native server or container, `fsync=on`, `synchronous_commit=on`, typed tenant/id/status/version/schema-version/time fields, JSONB variable payload, separate events and operation receipts.
- MongoDB application store: one isolated single-member replica set, `writeConcern={w:'majority',j:true}`, primary reads, explicit transaction settings, bounded work-item documents, separate events and operation receipts. Transactions atomically combine state, receipt and event changes.
- One identical real Temporal workflow and activity implementation per arm, using the same Temporal CLI development-server version and persistent local SQLite configuration. Database I/O occurs only in activities. This tests orchestration mechanisms; it does not validate production Temporal persistence, PostgreSQL-backed Temporal, replica failover, or high availability.

Use loopback-only endpoints, unique experiment-owned directories and ports, synthetic data, pinned binary versions and recorded SHA-256 hashes. Never connect to an existing database service, inspect customer data, or terminate a process without an experiment-owned PID record. A native execution manifest replaces container digests with executable hashes and exact launch commands. Record server settings, driver versions, host resources and protocol hash before counted operations. Initial verified executable versions are PostgreSQL 16.15, MongoDB 8.0.15 and Temporal CLI 1.9.1 / server 1.32.0; retain their exact hashes in the execution manifest. Reserved local ports are PostgreSQL 55439, MongoDB 27029 and Temporal 17239; abort on collision rather than attaching to the listener.

Allow native indexes and physical designs, but identical logical semantics and returned projections. PostgreSQL starts with tenant/id uniqueness, tenant/status/time/id pagination indexes without an initial model-field index. MongoDB receives equivalent unique and compound indexes, also without the model-field index. E2 alone creates the PostgreSQL expression index and MongoDB model-field index. Timing cells use the post-E2 indexed state in both arms. Freeze and publish DDL/index definitions before counted measurements. Index construction belongs in the evolution task, not a hidden setup advantage.

## Data and shared adapter contract

Seed 1,000 records over 10 synthetic tenants using a recorded seed. Alternate work-order/session shapes with optional tool metadata, nested properties and arrays; initial payloads are 1–8 KiB. Records have `tenantId`, `id`, `status`, `version`, `schemaVersion`, `createdAt`, `updatedAt`, and `payload`. Status transitions are `open -> approved -> completed`; completed records reject further business mutations. Events are separate append-only records with `(tenantId,id,sequence)`, operation ID and event payload. Neither arm embeds an ever-growing history.

Adapter methods (implementation names may differ if the manifest maps them):

```text
reset(seedRecords)
create(record, opId)
get(tenantId, id)
patch({tenantId,id,expectedVersion,patch,opId})
appendCheckpoint({tenantId,id,expectedVersion,checkpoint,opId})
listOpen({tenantId,limit,after})
history({tenantId,id,limit,afterSequence})
queryPayload({tenantId,path,value,limit})
evolve({phase: 'add-index' | 'backfill-v2'})
inspectInvariants()
close()
```

Every mutation returns `{status: applied|duplicate|conflict|not_found, version}` or a typed validation/authorization error. `opId` uniqueness is tenant-scoped. Check an existing receipt before expected-version evaluation: identical replay returns the original result without a second event or version increment; reuse with different canonical request content is rejected. Receipt, business mutation and event append commit atomically. Successful mutation increments version exactly once; checkpoint sequence follows that version. Canonical JSON hashing uses the same sorted-key encoding in both arms, not raw JSONB/BSON byte order. Reject unsafe JSON keys, non-finite numbers, integers outside the JavaScript safe-integer range and payloads above 64 KiB equally; transcripts are references, not inline blobs.

An authenticated synthetic identity is passed to a shared authorization wrapper independently of request tenant IDs. Wrong-tenant get, mutation, history, listing and workflow signal attempts must fail without data exposure. This establishes tested application authorization only; it does not claim database-enforced tenant isolation. Use deterministic workflow IDs and stable logical operation IDs across activity retries. Workflow-start deduplication must be tested explicitly; no atomic application-database/Temporal transaction is claimed.

## Evolution tasks

1. **E1, optional shape:** old/new readers consume the same mixed corpus; new writers add optional `payload.agent.model`, old writers patch an unrelated field without dropping it. Missing and explicit null remain distinguishable.
2. **E2, queried field:** add a tenant-scoped equality query/index for `payload.agent.model`; compare results before/after index creation against the fixture oracle, including absent fields, and record plans/index sizes. No application full-table filtering is substituted for database predicates.
3. **E3, representation migration:** v1 has integer `payload.priority`; v2 adds `payload.priorityV2={level:<same integer>}`. Mixed readers prefer v2 and fall back to v1. Backfill in bounded batches using version guards; old writes update the legacy field and invalidate the derived field, new writes update both. Retry backfill after interruption. Confirm no lost concurrent edits, unknown-field preservation, compatible rollback to v1 readers and idempotent repeated backfill. Do not delete v1 during this tier.

Keep exact fixtures and expected outputs in the run manifest. Record whether schema changes require DDL or only application/index changes. Both can legitimately evolve without changing the primary table/collection schema.

## Correctness and fault cases

Run separately from timing, with an oracle built from intended operations and receipts rather than agreement between the two adapters alone:

- duplicate same operation; different payload under reused operation ID; two writers with the same expected version (one winner); terminal update rejection;
- abort before commit; commit then fail the activity before acknowledgment; worker restart and retry the same activity; connectivity interruption with bounded retry; restart only the owned database then verify durable receipts/events;
- duplicate workflow start after losing client acknowledgment; duplicate approval signals; workflow history replay using the same workflow code;
- cross-tenant direct ID/read/write/list/history/signal attempts; wrong checkpoint ordering; payload-limit rejection;
- interrupted/repeated E3 backfill with concurrent edits;
- quiescent cold backup/restore: stop the owned database cleanly, copy its complete data directory into a fresh owned directory, start that copy with the same pinned binary (reuse the reserved port only after the original has stopped), then check record/version/receipt/event invariants; this is a cold filesystem-restore mechanism, not online backup or point-in-time recovery;
- deliberate negative control that appends a second event for one logical operation: the oracle must reject it. If missed, the run is invalid and no comparison conclusion is issued.

For every acknowledged successful operation, state must match its receipt, with one event, no missing accepted update and no forbidden transition. Failed conflicts must produce no effects. Restored state must equal the backup's declared quiescent snapshot. Preserve failed attempts. Classify adapter bugs, oracle defects, environment failures and database limitations separately; a bug is not proof of inherent database unsuitability. A missing fault case is reported as missing, not passed.

## Bounded local mechanism tier

Five paired repetitions, each with concurrency 1 and 10, 1,000 seeded records and 1,000 attempted operations per arm/cell. This is 20 arm/cells and 20,000 measured attempts. Use the same seeded workload per pair; alternate PostgreSQL-first and MongoDB-first. Reset each cell; run 100 uncounted warm-up operations on disjoint IDs. Operation mix: 40% get, 20% list-open, 20% nested-field patch, 10% checkpoint append, 10% payload query. Precompute targets to avoid unintended conflicts in the descriptive timing mix; explicit conflict/hot-key cases remain in the correctness suite. Run the evolution suite once per arm/pair on a fresh fixture.

Caps: 120 seconds per timing cell, 30 seconds per activity attempt, at most 3 attempts, 120 seconds per fault recovery, 30 minutes for the entire local run, 4 GiB combined experiment-process resident memory, 10 GiB total experiment files. Monitor owned processes and terminate only owned processes on a measured budget overrun; native RSS accounting is an observed limit rather than a kernel-enforced cgroup. At capacity or timeout, stop safely and retain partial evidence as inconclusive. Record memory/CPU observations and avoid claiming equal resource isolation on an unrestricted host. No paid runners or external services are required. A runtime failure produces a failed run record; never silently lower counts or omit failures.

Report attempted/completed/error counts, latency distributions per repetition and operation, throughput, retries, recovery time, storage/index size and evolution steps. Keep database-call timing separate from end-to-end Temporal timing. Correlated requests are not independent replications; five paired repeats do not support population-wide tail-latency claims.

## Outcome and future decision tier

Local outcomes: `mechanisms-supported`, `mechanisms-failed`, or `inconclusive`, plus whether the evolution thesis is supported, unsupported within tested bounds, or unresolved. All required correctness controls and cases must pass for `mechanisms-supported`. Do not infer modeling superiority from fewer lines alone or latency superiority from this host. Missing tests, invalid negative control, or unequal semantics prevent a positive local conclusion.

A future adoption decision requires a separately frozen protocol with actual workload frequencies, scale, absolute recovery/latency targets, operational budget, deployment/replication topology, migration plan and independently reviewed evidence. Proposed starting matrix: 100 tenants, 100,000 records, concurrency 1/10/50, five paired repeats, 60-second warm-up and at least five minutes plus 10,000 completed operations per repetition. It already costs at least three hours before faults/setup. Include production-like Temporal persistence and matched durability/failover tests; resolve limits before running. This future tier is neither executed nor required to complete the bounded mechanism tier.

## Primary sources checked 2026-10-19

- [PostgreSQL JSONB indexing and document concurrency](https://www.postgresql.org/docs/current/datatype-json.html).
- [MongoDB document size and BSON](https://www.mongodb.com/docs/manual/core/document/).
- [MongoDB write concern](https://www.mongodb.com/docs/manual/reference/write-concern/).
- [MongoDB embedding and consistency](https://www.mongodb.com/docs/manual/data-modeling/enforce-consistency/embed-data/).
- [Temporal activity idempotency](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/activities/activity-definition.mdx).
