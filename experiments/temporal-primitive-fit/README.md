# Temporal application primitive fit

This is a separate follow-up to the frozen document-fit experiment. It tests MongoDB's application-storage case against two PostgreSQL designs for each workload. It does not use MongoDB as Temporal server persistence.

Read `PROTOCOL.md` and `protocol.json` for the frozen hypotheses, decision thresholds and exclusions. A positive outcome is workload-specific; an inconclusive or PostgreSQL-favoring result is equally valid.

## Runtime ownership

Node 22 and the pinned package dependencies are required. `runtime.mjs` can bootstrap isolated local native PostgreSQL, MongoDB replica-set and Temporal development-server processes. Its `bootstrap(root, sourceRoot)` verifies source binary digests against the previous runtime provenance, copies binaries only, refuses existing state or occupied ports, and creates new state. It must only be called after protocol and source review authorize an uncounted validation run. It never adopts a preexisting service. Ports are PostgreSQL 55739, MongoDB 27329 and Temporal 17539. The Temporal development server uses its own SQLite file.

Set `TPF_RUNTIME_ROOT` to that isolated runtime root. A root `frozen-source.json` maps every experiment source/protocol/dependency file to its SHA-256. Counted runs and reproductions verify it before opening any data-changing adapter and again at completion, including the complete source-file set. Uncounted preflight/smoke may record current hashes before the freeze exists.

```sh
pnpm install --frozen-lockfile
pnpm test
TPF_RUNTIME_ROOT=/absolute/owned/runtime pnpm preflight
TPF_RUNTIME_ROOT=/absolute/owned/runtime node run.mjs --smoke
TPF_RUNTIME_ROOT=/absolute/owned/runtime pnpm experiment
TPF_RUNTIME_ROOT=/absolute/owned/runtime pnpm reproduce
```

Preflight reads runtime identity and frozen hashes without resetting datasets. Smoke retains its own explicitly uncounted run. Reproduction uses the separately frozen seed and repetition count; never pool its rows with the main run.

## Measurement and evidence

A bounded pool assigns a fixed sequence of operations to each lane. Every arm receives the same trace. Latency wraps the adapter call, including actual driver/network serialization and PostgreSQL full-document reconstruction. Result hashes and independent oracle comparisons run after the timed pool. Warmups are excluded. Distributed profiles first materialize all 64 mutable paths on the ten active records; setup/preconditioning time and state are recorded separately. Cell harness throughput includes deterministic trace generation and runner scheduling overhead and excludes post-cell verification and evidence serialization.

The session kernels compare full JSONB, a PostgreSQL hot-field/base-and-override design, and Mongo native document mutation. Query kernels compare JSONB GIN, a typed attribute relation, and Mongo wildcard indexing. Separate records and bounded JSON payloads keep this experiment distinct from unbounded embedded histories.

Every actual session snapshot is compared in full against the independent oracle before replacing only the reconstructable synthetic cold body with its byte count and SHA-256 in retained evidence. Each run retains source and fixture hashes, raw per-operation JSONL, full attribute snapshots, compact session snapshot projections with SHA-256 cold-body digests, database/index diagnostics, sampled owned-process RSS and disk usage, host context, successful checks and failures. Runtime resource limits include the isolated runtime directory and owned services; this is observation rather than an operating-system resource reservation. Other host work can influence local timings.

After the kernels, real Temporal workflows perform 30 CAS updates across the three session arms. A deliberately lost activity acknowledgment retries and verifies the intended version/value; duplicate workflow IDs are rejected and one mutation history per arm is replayed against the same code. This is bounded reconciliation on dedicated isolated records, not a general exactly-once receipt implementation, production persistence test, or workflow-version migration proof. Its timings do not enter the kernel comparison.

Failures retain their run directories. A failed or interrupted run cannot be silently treated as a completed result. The bootstrap/runtime helpers act only on verified owned executable and data-directory identities. Stop only those processes with `OwnedRuntime.load().shutdown()` after all validation and reproduction are complete.

## macOS durability amendment

This tier now refuses to start adapter mutations unless live PostgreSQL reports `fsync=on`, `synchronous_commit=on`, `full_page_writes=on` and `wal_sync_method=fsync_writethrough`, with no pending restart. The observed settings are recorded in the manifest. Bootstrap configures these settings explicitly. The interrupted earlier main run used `open_datasync`; its source and evidence are preserved as excluded, never pooled with the amended protocol.

MongoDB retains majority+journal acknowledgment. Inspection of pinned MongoDB/WiredTiger source describes a possible full-flush branch, but this experiment has not traced the actual syscall branch. The amendment reduces an identified platform confound; it does not prove identical physical write-cache flushing, power-loss recovery, or production durability. Linux deployment-target validation remains separate.
