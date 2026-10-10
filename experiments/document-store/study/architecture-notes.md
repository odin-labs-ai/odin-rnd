# MongoDB architecture: clean-room study notes

Status: study notes for a clean-room specification. Accessed 2026-10-10.
Provenance: every design input has a row in `provenance.json` (ids in square brackets, e.g. [W-03]).

## 0. Legal hygiene and what was studied

- **Server source studied:** `github.com/mongodb/mongo`, tag **`r8.3.11`**, which resolves to commit **`d51fe566b2363d00213be1467f65443149a8c475`** (committed 2026-09-11) [G-01].
  - It was a shallow, blobless, sparse clone covering only `src/mongo/{rpc,transport,db/repl,db/s,s,db/query,db/pipeline,db/storage,base,bson}`, WiredTiger `src/include` and `src/docs`, `docs/`, and the top-level files.
  - Every `path` cited below means `mongodb/mongo:<path>@d51fe566`. Several upstream READMEs embed links to older SHAs; those are not our pin and are not reused.
- **Why this tag:** `downloads.mongodb.org/full.json` lists **9.0.2** as a `production_release` (dated 2026-09-17), but the public GitHub repo has only `r9.0.0-alpha*` tags for 9.x. `r8.3.11` is therefore the newest tag that both exists publicly and is marked `production_release` in full.json [G-02]. We make no claim here about LTS or rapid-release status.
- **Licences (details in §9):**
  - Server: **SSPL v1** [L-01].
  - Vendored WiredTiger: **GPL v2 or v3**, not SSPL [L-02].
  - mongodb/specifications **and** the MongoDB docs: **CC BY-NC-SA 3.0**. Neither is Apache-2.0 [L-03, L-04].
- **Rules applied to these notes:**
  - No source text, README prose, tables or examples are reproduced.
  - Constants, flag bits, opcodes, error codes and knob defaults are recorded as facts. Mechanisms are paraphrased.
  - The "must specify" items are *observable behaviour*: what a client or driver can detect on the wire.

---

## 1. Wire protocol

**What it does.** Drivers talk to the server over a framed binary request/response protocol on TCP, Unix sockets, or TLS. Every request is a "command" whose body is a BSON document.

**Framing.**
- Every message starts with a 16-byte little-endian header: `messageLength`, `requestID`, `responseTo` and `opCode`, each an int32.
- Opcodes still known at this pin [W-01] (`src/mongo/rpc/message.h`):

  | Opcode | Value | Status |
  |---|---|---|
  | `OP_REPLY` | 1 | legacy reply |
  | `OP_QUERY` | 2004 | legacy |
  | `OP_GET_MORE`, `OP_INSERT`, `OP_UPDATE`, `OP_DELETE`, `OP_KILL_CURSORS` | 2005, 2002, 2001, 2006, 2007 | enum entries; legacy CRUD opcodes are no longer served (see below) |
  | `OP_COMPRESSED` | 2012 | current |
  | `OP_MSG` | 2013 | current |

  2008–2011 were internal 3.2-era command opcodes, now removed.
- **Message size limit:** the maximum message is **48,000,000 bytes**, i.e. 48 × 1000 × 1000 [W-02] (`rpc/message.h`).

**BSON limits.**
- A user document is at most **16 MiB** (16 × 1024 × 1024 bytes).
- Internally the server allows 16 MiB + 16 KiB, so command envelopes fit around a maximal document [W-03] (`src/mongo/bson/util/builder.h`).
- BSON itself is specified at bsonspec.org, which is dedicated CC0 [L-05].

**OP_MSG** (`src/mongo/rpc/op_msg.{h,cpp}`) [W-04]. After the header comes a uint32 `flagBits`, then one or more *sections*, then an optional CRC-32C checksum.

Flag bits:

| Bit | Name | Meaning |
|---|---|---|
| 0 | `checksumPresent` | A 4-byte CRC-32C trailer is present. It covers every byte of the message (header included) except the trailer itself. A mismatch fails with `ChecksumMismatch` (288). |
| 1 | `moreToCome` | Sender is not waiting for a reply (fire-and-forget). Used on replies to stream exhaust responses. |
| 16 | `exhaustAllowed` | Client accepts multiple replies to one request. |

- **Required vs optional bits:** the low 16 bits are "required". An unknown bit set in that range is rejected with `IllegalOpMsgFlag` (223). The high 16 bits are optional and are ignored if unknown.

Section kinds:

| Kind | Name | Rules |
|---|---|---|
| 0 | body | Exactly one BSON document per message. |
| 1 | document sequence | int32 size, a C-string identifier, then concatenated BSON documents. It lets bulk payloads such as `documents` for insert travel outside the 16 MiB body. Duplicate identifiers raise `TooManyDocumentSequences` (233). |
| 2 | security token | Internal/multitenancy use; rejected when unauthorised. |
| any other | — | Error 40432. |

- **Logical request:** the server merges sequences into the body as arrays, so a command is logically one document.
- **Command addressing:** the database is named by the `$db` field in the body. The command name is the first field.

**Legacy OP_QUERY and the handshake.**
- At this pin OP_QUERY is accepted only for `hello`, `isMaster` and `ismaster`. A "temporarily allowed" set also exists: `_isSelf`, `authenticate`, `buildinfo`/`buildInfo`, `saslStart` and `saslContinue`. Anything else fails with `UnsupportedOpQueryCommand` (352) [W-05] (`rpc/check_allowed_op_query_cmd.cpp`).
- So the very first message a driver sends may be an OP_QUERY `hello`/`isMaster` against `admin.$cmd`. Once wire version support for OP_MSG (enum `SUPPORTS_OP_MSG` = 6) is negotiated, everything is OP_MSG.
- `helloOk: true` in the handshake lets a client switch from `isMaster` to `hello`. The server echoes it back [W-06] (`db/repl/README.md` §helloOk).
- **Hello response fields** a driver relies on (field names as per driver SDAM spec):
  - `maxWireVersion` and `minWireVersion`.
  - `maxBsonObjectSize`, `maxMessageSizeBytes` and `maxWriteBatchSize`. The last is **100,000** [W-07] (`db/query/write_ops/write_ops.h`).
  - `isWritablePrimary`/`secondary`, `setName`, `hosts`, `topologyVersion`, `logicalSessionTimeoutMinutes`, `compression`, `saslSupportedMechs`, `connectionId`.
- **Wire version enum** (`db/wire_version.h`): named steps run 0..14, then `LATEST_WIRE_VERSION` is defined relative to a generated multiversion constant. The numeric value for 8.3 was **not** resolved at this pin; the generated file was outside the sparse set [W-08].

**OP_COMPRESSED** (`transport/message_compressor_*.{h,cpp}`) [W-09].
- Layout: an OP_COMPRESSED header wraps the original opcode (int32), the uncompressed size (int32), a compressor id (uint8), then the compressed bytes.
- Compressor ids: noop = 0, snappy = 1, zlib = 2, zstd = 3. 255 is reserved as "extended".
- The algorithm is negotiated by a `compression: [...]` array in the handshake.
- Decompression is bounded by `MaxMessageSizeBytes`.
- Some commands (e.g. auth/handshake) are never compressed. This comes from the driver compression spec and was not verified in source [W-14].

**Command dispatch** (`docs/command_dispatch.md`, `transport/README.md`, `transport/session_workflow.h`) [W-10].
- Each accepted connection gets a `Session`, and a per-session workflow loop parses one request at a time. One work item is in flight per connection, so ordering is strict per connection.
- The workflow hands the request to a role-specific entry point: shard/mongod or router/mongos.
- Commands live in a global registry built at startup, and most are parsed through IDL-generated typed request structs.
- Ingress admission control and flow control throttle work before execution.
- **Exhaust:** after each reply, the server synthesises the next request itself until the cursor is done. This is how streaming `hello` (server monitoring) and exhaust `getMore` work.

**Cursors** (`db/query/client_cursor/*`) [W-11].
- `find` and `aggregate` return `{cursor: {id, ns, firstBatch}}`. `getMore` returns `nextBatch`.
- Cursor id **0** means exhausted or closed.
- Idle "mortal" cursors are reaped after `cursorTimeoutMillis` = **600,000 ms** (10 min).
- Per-batch user data is capped at about 16 MiB (`kMaxBytesToReturnToClientAtOnce = BSONObjMaxUserSize`). The first batch default of 101 documents is a docs claim and was not located in the IDL at this pin [W-15].
- The cursor manager is partitioned with per-partition latches and generates random ids.
- Unknown or expired id: `CursorNotFound` (43).
- Tailable/awaitData cursors back capped collections and change streams.

**Error model** (`src/mongo/base/error_codes.yml`, 397 entries) [W-12].
- Replies carry `ok: 1|0`, `errmsg`, `code` and `codeName`.
- Write commands put per-document errors in `writeErrors[]` and replication errors in `writeConcernError`.
- `errorLabels[]` drive driver retry logic:
  - `TransientTransactionError` means retry the whole transaction.
  - `UnknownTransactionCommitResult` means retry the commit.
  - `RetryableWriteError` means retry a retryable write.
- Codes a clone must reproduce exactly, because drivers branch on them:

  | Code | Name |
  |---:|---|
  | 11000 | DuplicateKey |
  | 10107 | NotWritablePrimary |
  | 13435 | NotPrimaryNoSecondaryOk |
  | 11602 | InterruptedDueToReplStateChange |
  | 189 | PrimarySteppedDown |
  | 91 | ShutdownInProgress |
  | 112 | WriteConflict |
  | 251 | NoSuchTransaction |
  | 225 | TransactionTooOld |
  | 50 | MaxTimeMSExpired |
  | 64 | WriteConcernTimeout (name at this pin) |
  | 13388 | StaleConfig |
  | 43 | CursorNotFound |
  | 286 | ChangeStreamHistoryLost |
  | 326 | OplogQueryMinTsMissing |
  | 10334 | BSONObjectTooLarge |
  | 146 | ExceededMemoryLimit |

- The YAML groups codes into categories such as NotPrimaryError, RetriableError, NetworkError and Interruption. Drivers infer much of the same behaviour, so category membership is observable.

**What makes it scale.**
- Commands are self-describing documents, and document sequences avoid copying bulk payloads.
- Exhaust/streaming replies remove round trips for monitoring and tailing.
- Compression is negotiated per connection.

**Failure modes / lessons.**
- Thread-per-connection plus connection storms are a real production failure mode. Coinbase built a connection-multiplexing sidecar for exactly this [C-07].
- Legacy opcode removal broke old drivers, which is why the error text points to an upgrade.

**Must specify (observable) vs may choose.**
- *Must:**
  - Header layout, opcodes 2013/2012 (and OP_QUERY handshake acceptance).
  - Flag-bit semantics, including rejection of unknown required bits.
  - Section kinds 0/1, CRC-32C semantics, and the size limits advertised in `hello`.
  - Cursor id 0 semantics; batch fields `firstBatch`/`nextBatch`.
  - Error codes, codeNames and errorLabels for every condition a driver retries on.
  - `hello` field set; compressor ids.
- *May choose:*
  - Threading model (thread-per-conn vs async reactor).
  - Internal command registry and parser technology.
  - Cursor id generation (must be non-zero int64, should be unguessable).
  - Batch sizing below the caps.
  - Supporting fewer compressors (advertise only what you support).

---

## 2. Storage engine

**What it does.** Persists collections and indexes with snapshot isolation, timestamps (for replication) and crash recovery.

**Layering** (`db/storage/README.md`) [S-01].
- A **KV engine** (WiredTiger) sits under a storage API that exposes three things:
  - A **RecordStore** per collection: an ordered map from RecordId to BSON bytes.
  - A **SortedDataInterface** per index: ordered keys pointing at RecordIds.
  - A **RecoveryUnit**: the per-operation storage transaction.
- **RecordId:** a storage-assigned int64 for normal collections, or a binary string (the `_id` encoding) for clustered collections. With the KV engine the RecordId is stable across updates, which matters because every index entry points at it.
- Each collection and each index is its own WiredTiger table (an "ident"). A MongoDB-side catalog table (`_mdb_catalog`) maps namespaces to idents [S-02] (`db/storage/wiredtiger/README.md`).
- Create and drop are two non-atomic steps: create the table and then reference it, or unreference it and then drop it. A crash between them leaves a dangling table that is garbage-collected at restart.

**Index key format: KeyString** (`db/storage/key_string/README.md`) [S-03].
- Index keys are re-encoded from BSON into a **memcmp-comparable byte string**. Byte order matches BSON's cross-type comparison order, and numerically equal values of different types compare equal.
- Descending components are stored byte-inverted. An `Ordering` bitmask records which components are inverted; compound keys have up to 64 parts.
- A side channel, **TypeBits**, records the original numeric type so a key can be decoded back to the exact BSON value.
- An end marker separates the key from an appended RecordId. Query-only "discriminator" bytes sort just below or above all entries with that key prefix, which yields inclusive and exclusive bounds.
- Entries per index type:
  - Non-unique indexes and (since 6.0) unique secondary indexes store `key+RecordId`, so duplicate keys are distinct entries.
  - The `_id` index stores the key alone, with the RecordId in the value.
- **Lesson recorded upstream:** unique-key-only entries caused false uniqueness violations during parallel, out-of-order oplog application on secondaries. That is why the RecordId moved into the key.

**MVCC and timestamps** [S-04].
- The storage contract is snapshot isolation. The first read establishes the snapshot.
- Conflicting writers get a `WriteConflictException`, and the server transparently aborts and retries the operation. It surfaces as `WriteConflict` (112) inside multi-document transactions.
- Every replicated write is tagged with a commit timestamp equal to its oplog timestamp. Readers can read "as of" a timestamp, which is how majority, snapshot and secondary batch-boundary reads work.
- In WiredTiger the newest version lives in the B-tree. Older versions needed by older readers spill into a single shared **history store** table keyed by (btree id, key, start ts, counter) [S-05] (WiredTiger `src/docs/arch-hs.dox`).

**B-tree, cache, eviction** [S-06] (WiredTiger `arch-btree.dox`, `arch-cache.dox`, `arch-eviction.dox`; `db/storage/wiredtiger/README.md` §Cache-Pressure).
- Tables are row-store B-trees; column-store also exists.
- In-memory pages carry update chains. Pages are converted ("reconciled") to a compact on-disk format when written.
- The cache tracks clean and dirty bytes. Eviction is an approximate-LRU server plus worker threads.
- Three regimes:
  - Below the *target*: no eviction.
  - Between *target* and *trigger*: background eviction only.
  - Above *trigger*: application threads are conscripted into eviction, so latency spikes.
- **Upstream failure lesson:** large or long-running transactions pin uncommittable state in cache, which leads to application-thread recruitment and stalls, worst during stepdown and shutdown. A dedicated `TransactionTooLargeForCache` error exists (`db/storage/README.md`).
- **LSM:** no LSM source files exist anywhere under the vendored WiredTiger tree at this pin (checked with `git ls-tree`). When or why LSM left is not asserted here [S-07].

**Checkpoints and journal** [S-08] (`db/storage/README.md` §Checkpoints/§Journaling; WiredTiger `arch-checkpoint.dox`).
- A checkpoint is a consistent snapshot written at the **stable timestamp**: everything at or before the majority-committed point, nothing after. Frequency comes from `storage.syncPeriodSecs`.
- A write-ahead log ("journal") covers changes since the last checkpoint. In a replica set only the oplog and some `local` tables are journaled; user collections are not. After a crash the server:
  1. opens the last stable checkpoint;
  2. replays the oplog forward from it.
- Durable `j:true` means "oplog entry flushed to the journal". The default journal flush interval is 100 ms [S-09] (`db/repl/README.md` timestamp glossary).
- **Rollback-to-stable** discards everything newer than the stable timestamp. Both replication rollback and startup use it.

**The oplog as a storage citizen** [S-10] (`db/storage/README.md` §Oplog; `wiredtiger/README.md` §Oplog Truncation).
- The oplog is `local.oplog.rs`, a capped collection keyed by timestamp. It is truncated by size or by `minRetentionHours`, but never past the points replication still needs.
- **Oplog holes:** concurrent writers reserve timestamps before committing, so commits can land out of order. Oplog readers therefore read only up to a computed "no holes" point (`oplogReadTimestamp`/`all_durable`). Otherwise a secondary could skip an entry that commits late.
- **A clone with concurrent writers must reproduce this visibility rule** whenever it exposes the oplog or change streams.

**What makes it scale.**
- Document-level concurrency (MVCC) and compression.
- Memcmp-comparable keys, which make B-tree comparisons cheap.
- Checkpoints plus a small journal, so recovery is bounded.
- Separating the history store keeps the hot tree small.

**Failure modes / lessons.**
- Working set exceeding RAM gives unpredictable latency. Discord's 2015 MongoDB experience was exactly this: "data and the index could no longer fit in RAM" [C-08].
- Foursquare's 2010 outage was one shard exceeding RAM, plus fragmentation from small documents [C-09].
- Cache-pressure stalls; long transactions pinning history.

**Must specify vs may choose.**
- *Must (observable):*
  - Snapshot reads; read-your-writes per session.
  - Atomic single-document writes.
  - Index ordering identical to BSON comparison order, including cross-type order and numeric equivalence across int/long/double/decimal. Collation applies where requested.
  - Unique index semantics.
  - Durability meaning of `j:true` and `w:"majority"`.
  - `WriteConflict` surfaced only inside transactions.
  - Capped-collection and oplog ordering.
- *May choose freely:*
  - B-tree vs LSM vs anything else.
  - Key encoding (KeyString itself is an implementation detail, but some memcmp encoding is the obvious design).
  - Table-per-index vs shared tables.
  - Checkpoint/journal design.
  - Cache policy and page format.
  - MVCC implementation, which can be undo-log or version-chain.

---

## 3. Replication

**What it does.** A replica set is one primary plus secondaries (up to 50 members per the heartbeat rationale in `db/repl/README.md`; the 7-voting-member cap is a docs claim [R-12]). Primaries log every write; secondaries copy and replay the log; elections pick a new primary on failure.

**Oplog mechanics** (`db/repl/README.md` §Doing a Write, §Oplog Fetching/Persistence/Application) [R-01].
- On the primary, an observer hook writes an oplog entry **in the same storage transaction** as the user write.
- Entries are rewritten to be **idempotent**, e.g. an increment becomes a set of the resulting value. Multi-operation writes produce one entry per operation.
- Replication is **pull-based**, and each secondary runs a pipeline:
  1. Picks a sync source, which can be another secondary (chaining).
  2. Tails its oplog with an awaitData/exhaust cursor.
  3. Buffers entries in memory.
  4. A writer thread persists batches to its own oplog and flushes the journal.
  5. An applier applies batches **in parallel**. Entries are partitioned by document so per-document order is preserved. Collection-level/DDL entries run in a batch of their own.
- The secondary's reads are served at the batch boundary, `lastApplied`, so readers never see a half-applied batch.

**Protocol (pv1, Raft-derived)** (`db/repl/README.md` §Elections, §Heartbeats, §Reconfiguration) [R-02].
- **Terms and OpTimes:** every oplog entry carries (timestamp, term), and comparisons are by (term, ts).
- **Heartbeats:** every 2 s, all-to-all. The cost is quadratic in member count, which is the stated reason for the 50-member cap.
- **Elections:**
  - A node stands when it has seen no primary for `electionTimeoutMillis` (default 10 s), on a priority takeover, or on a catch-up takeover (default 30 s).
  - It runs a **dry-run** first (no term bump), so a doomed candidate does not depose a healthy primary.
  - Then the real election: bump the term, vote for itself, send `replSetRequestVotes`.
  - Voters refuse a stale term, a config mismatch, a wrong set name, a candidate behind them in log, or a second vote in the same term.
  - The last vote is persisted durably (`local.replset.election`) so a restart cannot double-vote.
  - An arbiter refuses to vote when it sees a healthy primary of equal or higher priority (anti-flapping).
- **New primary:** it catches up to the freshest secondary before accepting writes.
- **Election handoff:** a voluntary stepdown asks a chosen secondary to step up immediately, skipping the timeout.
- **Reconfiguration** uses a "safe reconfig" protocol, formally specified in TLA+ and in a published paper (arXiv 2102.11960). Its invariants are ElectionSafety and NeverRollbackCommitted [R-03].

**Commit point, write concern, read concern** [R-04].
- The **majority commit point** is the highest OpTime replicated (written, or journaled if configured) on a majority. It spreads to secondaries via heartbeats and oplog-fetch metadata, and is accepted only if it is in the same term as their log.
- **Write concern** `w:N|"majority"`, `j`, `wtimeout`:
  - The client thread blocks until the condition holds.
  - "majority" also waits for the committed snapshot to include the write.
  - The implicit default is `w:"majority"`, falling back to `w:1` with certain arbiter topologies (MongoDB docs) [R-05].
  - A timeout surfaces as `writeConcernError` code 64.
- **Read concern levels:**
  - `local`, the default: newest data on the node; on a secondary, `lastApplied`.
  - `available`: like local, but on a sharded secondary it does not wait for routing metadata, so it can return orphans.
  - `majority`: reads at the committed snapshot. Never sees data that can roll back; may be stale.
  - `linearizable`: primary only, single-document. After reading, the primary writes a no-op and waits for majority, proving it was still primary.
  - `snapshot`: point-in-time at `atClusterTime`, or by default a hole-free timestamp.
- **Caveat stated upstream:** outside `snapshot`, a long read may yield and resume on a newer snapshot. So a multi-document scan is *not* point-in-time [R-04].

**Rollback** (`db/repl/README.md` §Rollback: Recover To A Timestamp) [R-06].
- **Trigger:** a node whose log diverges (it holds writes from an older term that the new primary lacks) finds the common point with its sync source.
- **Sequence:**
  1. Enter `ROLLBACK`, kill user operations, bump a durable rollback id (RBID).
  2. Abort prepared transactions.
  3. Optionally write rolled-back documents to rollback files.
  4. **Recover to the stable timestamp.**
  5. Truncate the oplog after the common point.
  6. Re-apply forward from the sync source.
- Only writes that never reached majority can be rolled back. That is precisely the gap that `w:1` acknowledgements fall into.

**Causal consistency and sessions** (`db/s/README_sessions_and_transactions.md`) [R-07].
- Logical sessions: an `lsid` UUID plus a user id; records are reaped after 30 minutes idle.
- Every reply gossips `$clusterTime` (signed) and `operationTime`.
- A causally consistent session sends `afterClusterTime` = last seen `operationTime`, and the node waits until it has applied that far. Jepsen 3.6.4 showed this guarantee only holds with **majority read and write concern** [J-04].

**Retryable writes** [R-08].
- The driver attaches `lsid` and `txnNumber`; the server assigns each statement a `stmtId`.
- Each retryable oplog entry carries lsid, txnNumber, stmtId and `prevOpTime`, forming a backward-linked per-session chain.
- `config.transactions` holds one row per session: the last txnNumber and the last write's OpTime.
- On a retry, the primary sees which stmtIds already committed and rebuilds the original response from the oplog instead of re-executing.
- Session history is copied along with chunk migrations, so retries survive resharding and migration.
- The `RetryableWriteError` label exists so that drivers can retry. The exact retry-once rule is driver-spec behaviour [W-13].

**Transactions** [R-09] (`db/repl/README.md` §Transactions; `db/s/README_sessions_and_transactions.md`).
- **Replica-set transactions:**
  - Executed inside one storage transaction and committed as a single `applyOps`-style oplog entry, or a chain of entries for large transactions.
  - Reads are speculative. On commit with `w:majority`, the server waits until what was read is majority-committed; a read-only transaction does this via a no-op write.
  - Local and majority read concerns behave identically inside a transaction.
  - Snapshot uses `atClusterTime` or `all_durable`.
- **Cross-shard transactions** use 2PC:
  - Each shard prepares (majority-committed `prepareTransaction`); a coordinator shard decides; participants commit at a common commit timestamp.
  - Prepared transactions must survive failover and cannot be killed.
  - Readers that hit a prepared document block on a "prepare conflict".
  - mongos optimises commit by participant count: 0 participants means no-op; 1 participant commits directly; read-only participants commit individually; otherwise mongos coordinates 2PC.
  - A `recoveryToken` lets another mongos learn the outcome.
- Default `transactionLifetimeLimitSeconds` is 60 s. Docs claim, unverified [R-11].

**What makes it scale.**
- Pull-based, chained replication.
- Parallel appliers partitioned by document.
- Commit-point gossip rather than a synchronous quorum on every write: `w:1` is fast, and majority costs one round of acknowledgements.
- Flow control throttles primary writes to keep majority lag under about 10 s by default [R-10].

**Failure modes / lessons (Jepsen and others)** [J-01..J-05].
- **2013 (2.4.3):** acknowledged writes were lost at every write concern below majority, and even majority lost a few. The verdict was "neither AP nor CP".
- **2015 (2.6.7):** stale and dirty reads even with majority writes and primary reads.
- **2017 (3.4.0-rc3):**
  - pv0 lost acknowledged writes by design.
  - pv1 had term bugs that were fixed.
  - 3.4.1 passed linearizability with pv1 plus majority writes plus linearizable reads.
- **2018 (3.6.4):** causal sessions were silently non-causal unless both concerns were majority.
- **2020 (4.2.6):** snapshot isolation was violated even at the strongest concerns: read skew, cyclic dependencies (about 10% of transactions with no faults injected), and duplicate writes. A retry bug was patched for 4.2.8.
- **Lesson for a clone:** weak defaults and silent acceptance of weak concern combinations are the dominant correctness hazard. A clone should either default to majority/majority or document the gap.

**Must specify vs may choose.**
- *Must (observable):*
  - Write and read concern semantics, including which combinations give which guarantee.
  - `hello` topology fields, `topologyVersion`, and stepdown error codes and labels.
  - Oplog entry format, **if** the clone exposes the oplog or claims compatibility with oplog-tailing tools.
  - Retryable-write idempotence across failover.
  - Transaction error labels; `$clusterTime`/`operationTime` gossip.
  - Rollback is invisible to majority readers.
- *May choose:*
  - Consensus algorithm (Raft, Multi-Paxos, or a single-writer log on shared storage).
  - Push vs pull replication; applier parallelism.
  - Heartbeat topology; election timeouts.
  - Whether to support `w:1` at all, since stricter is allowed.
  - Physical vs logical log, as long as an oplog *view* is synthesised where it is exposed.

---

## 4. Sharding

**Components.**
- **Config server replica set (CSRS):** holds routing metadata (`config.collections`, `config.chunks`, databases, shards) and runs the **balancer** on its primary.
- **Shards:** replica sets.
- **mongos routers:** stateless; they cache routing tables.
- The config server can also act as a data shard ("config shard"); this is a docs claim, not traced in source here [K-01].

**Data placement.**
- A collection is split into contiguous **chunks**, i.e. key ranges, on the shard key. Hashed and range keys are both supported.
- The default maximum chunk ("range") size is **128 MiB** [K-02] (`src/mongo/s/balancer_configuration.cpp`).
- Each chunk keeps a placement version and a short **history** of former owners, retained `minSnapshotHistoryWindowInSeconds` (default 300 s), so snapshot reads can route to where data *was* [K-03].

**Routing** (`s/query/README.md`) [K-04].
- mongos targets the shard(s) whose ranges intersect the predicate on the shard key. Otherwise it broadcasts (scatter-gather) and merges results.
- Each request carries the router's **placement version**. If the shard's version is newer, the shard returns `StaleConfig` (13388); the router refreshes from the CSRS and retries.
- One routing-table snapshot is used for all shards of a query.
- Shards keep migrated-away ranges alive while existing cursors need them (a "range preserver").
- Non-snapshot cross-shard reads are roughly read-committed, not a point-in-time view.

**Aggregations split.** Each stage declares distributed logic. The router pushes as much as possible to shards and merges the rest on mongos or on a chosen merging shard; `$lookup` is placement-aware [K-05] (`s/query/README_aggregation.md`).

**Migrations** (`db/s/README_migrations.md`) [K-06].
- The CSRS asks the donor shard to move a range.
- The recipient clones documents, then repeatedly pulls the **transfer-mods** delta (writes made during cloning).
- The donor enters a write-blocking critical section, then a read+write-blocking one, and commits through the CSRS, which bumps the version. Both sides then release.
- Session (retryable-write) history migrates in parallel.
- A shard is either donor or recipient at a time, never both.
- Old data is removed later by an asynchronous, rate-limited **range deleter**. Until then **orphans** exist and are hidden by per-shard ownership filtering.
- A new primary resumes an in-flight migration from a persisted document.

**Balancer** (`db/s/balancer/README.md`) [K-07].
- Runs on the CSRS primary, in rounds, with three policies:
  - **Chunk selection** prioritises, in order: ranges on draining shards; zone violations; then moving data from the most-loaded to the least-loaded shard by data size.
  - **Defragmentation** merges small chunks.
  - **Auto-merger** (7.0+) merges contiguous chunks on the same shard once their history is no longer needed.
- A chunk larger than twice the max size that cannot split (too many identical shard-key values) is marked **jumbo** and skipped.
- The upstream README defines "balanced" only as equal data per shard. The numeric trigger threshold the docs describe (difference greater than 3× range size) was **not located in source at this pin** and is recorded as a docs claim [K-08].

**Resharding** (`db/s/resharding/README.md`) [K-09].
- Three state machines: coordinator on the CSRS, donor, and recipient.
- Each donor records a `minFetchTimestamp` via a no-op write. The coordinator picks the highest one as `cloneTimestamp`. Recipients clone at that snapshot, then apply donors' oplog.
- Writes block briefly when recipients reach strict consistency; commit then swaps the temporary collection in.
- A quiesced coordinator document de-duplicates retries.

**Shard-key choice and hot shards.**
- `analyzeShardKey` reports cardinality, frequency, **monotonicity**, and sampled read/write distribution [K-10].
- **Upstream lesson:** monotonic keys (timestamps, ObjectIds) send every insert to the last chunk, which creates a hot shard. Low-cardinality keys create jumbo chunks.
- Foursquare 2010 is the canonical public post-mortem: one shard outgrew RAM, and migration did not free memory because small-document fragmentation remained [C-09].

**What makes it scale.**
- Range partitioning with stateless routers and cached, versioned metadata, where staleness is corrected lazily.
- Online migrations and resharding; a parallel shard-local pipeline.
- Stripe reports 5M+ queries/s over 2,000+ shards on a MongoDB-Community-derived system [C-01].

**Must specify vs may choose.**
- *Must (observable):*
  - The mongos command surface: `shardCollection`, `reshardCollection`, `moveChunk`/`moveRange`, `balancerStart`/`Stop`, `sh.*` helpers; `config.*` collection shapes **if** tools read them.
  - `StaleConfig` handling is internal to a router-equivalent and normally never reaches clients.
  - Orphan invisibility.
  - Shard-key update rules (docs describe shard-key value updates as allowed since 4.2; not traced in source).
  - Behaviour of targeted vs broadcast queries.
- *May choose:*
  - Range vs hash vs dynamic partitioning; chunk sizes; balancing policy.
  - Whether routers are separate processes.
  - The metadata store (any consensus-backed store).
  - Migration protocol.
  - Even shared-storage designs that avoid data movement altogether.

---

## 5. Query planner and execution

**Pipeline overview** (`db/query/README_QO.md`) [Q-01].
1. `find`, `count`, `distinct`, `update`, `delete` and `findAndModify` parse into a **CanonicalQuery**: a normalised MatchExpression plus projection and sort.
2. `aggregate` parses into a **Pipeline** of stages, gets heuristic rewrites, and pushes its prefix down into the find layer where possible.
3. The **plan enumerator** produces candidate QuerySolutions over the available indexes.
4. A ranker picks the winner. The plan executor runs it against the storage API.

**Enumeration limits** (`db/query/query_optimization_knobs.idl`) [Q-02].
- At most **64** indexed solutions.
- At most **10** alternatives per OR, and a cap on AND intersections.

**Multi-planning (classic runtime ranking)** [Q-03].
- All candidates run round-robin in a **trial period**.
- The trial ends when one plan produces **101** results (`internalQueryPlanEvaluationMaxResults`), or after max(**10,000** works, **0.3** × collection size) (`internalQueryPlanEvaluationWorks`, `…CollFraction`), or when a plan hits EOF.
- Plans are scored on productivity per work unit, with bonuses for e.g. covering or no blocking sort.
- **Cost-based ranker:** CE modes are automatic, histogram, sampling, heuristic and exact. The default automatic strategy uses CBR **only when multi-planning produced no results** (`automaticCEPlanRankingStrategy` default `CBRForNoMultiplanningResults`) [Q-04].

**Plan cache** (`db/query/plan_cache/README.md`) [Q-05].
- An in-memory LRU map keyed by **plan-cache shape**: predicate shape, sort, projection and collation, but *not* constants (with some index-eligibility discriminators). Size is capped at **5%** of memory (`planCacheSize`).
- **Lifecycle:**
  - A new winner is inserted **inactive**, together with its "works".
  - A later run that is as good or better **activates** it. A worse run raises the bar to min(new, 2 × old).
  - Active entries skip planning entirely.
  - If a cached plan's trial exceeds **10×** its recorded works (`internalQueryCacheEvictionRatio`), it is deactivated and the query is replanned.
- Any DDL on the collection (index create/drop/hide, collection drop) clears its entries.
- **Upstream failure mode:** **multiplanning storms**. After a flush, many concurrent queries of the same shape all multi-plan at once, causing CPU spikes.
- Plan pinning and query settings exist to force plans [Q-05].

**SBE vs classic** (`db/query/query_execution_knobs.idl`) [Q-06].
- Two execution engines exist:
  - The **classic** engine: a tree of PlanStages with `work()` calls.
  - The **Slot-Based Execution (SBE)** engine: compiled slot-based plans that are cacheable after parameterisation.
- The knob `internalQueryFrameworkControl` defaults to **`trySbeRestricted`**. SBE is used only when the pipeline contains pushdown-eligible heavy stages ($group, $lookup, time-series unpack, search); otherwise classic is used. `forceClassicEngine` and `trySbeEngine` are the other values.
- The SBE plan cache also caches single-solution plans, to skip compilation.

**Aggregation** (`db/pipeline/README.md`) [Q-07].
- Inter-stage rewrites:
  - Swap `$match` earlier.
  - Coalesce `$sort`+`$limit`, and adjacent `$match` or `$skip`/`$limit`.
  - Dependency analysis decides which fields are needed, enabling covered plans.
- Per-stage rewrites follow.
- Blocking stages ($sort, $group) have memory caps: **100 MiB** defaults for blocking sort and for `$group` (`stage_memory_limit_knobs.idl`). Beyond the cap they spill to disk, or fail with `ExceededMemoryLimit` (146) if `allowDiskUse` is false.

**Index selection observable behaviour.**
- `explain` output (queryPlanner, executionStats, allPlansExecution) and `hint` are what clients see.
- `$planCacheStats` and `planCacheClear` are user-visible.
- Collation must match for an index to be eligible. Multikey (array) indexes change bounds and covering rules.

**Must specify vs may choose.**
- *Must:*
  - Query and aggregation **semantics**: operators, type-bracketing comparison, array matching, null/missing handling, collation, and sort order of mixed types.
  - The `hint` contract.
  - Error codes for memory limits.
  - Field presence and shape of `explain` to the extent tools parse it (`winningPlan.stage`, `IXSCAN`/`COLLSCAN` names are widely parsed).
  - Cursor batching.
- *May choose:*
  - Optimiser algorithm (rule-based, cost-based, multi-plan trials).
  - Plan cache design; execution engine (vectorised, compiled, Volcano).
  - Spill strategy below the advertised limits.
- *Note:* FerretDB v2 / DocumentDB translate the language into PostgreSQL plans instead — a clear precedent that the planner is free [P-01].

---

## 6. Change streams

**What it does.** `aggregate` with a leading `$changeStream` stage returns a **tailable cursor** of change events: inserts, updates, replaces, deletes, DDL, placement and topology events. Scope can be a collection, a database or the whole cluster (`docs/change_streams.md`) [CS-01].

**Mechanism** [CS-02].
- The `$changeStream` stage expands into internal stages:
  1. An oplog-match filter.
  2. Transaction unwinding: an `applyOps` entry fans out into its individual events.
  3. Transform to the event shape.
  4. Invalidate check (for collection/db scope).
  5. Resumability check.
  6. Optional pre-image lookup (`fullDocumentBeforeChange`, from a pre-images collection) and post-image lookup (`fullDocument: updateLookup` re-reads the current document).
  7. The user's `$match`/`$project`.
  8. Optional large-event splitting (`$changeStreamSplitLargeEvent`) for events above 16 MiB.
- **Sharded clusters:** mongos splits the pipeline. Shards (and the config server) run the event-producing part; mongos runs `$mergeCursors`, topology-change handling (opening cursors on newly added shards), and resume-token enforcement.
- **Merge rule:** mongos must hold back until every shard cursor has either returned events or reported "nothing up to time T". Shards emit high-watermark tokens for this, so sharded streams have higher latency than replica-set streams.

**Guarantees, as stated upstream** [CS-03].
- **Ordering:** events arrive in oplog order within the scope. Across shards they are merged deterministically by cluster time.
- **Durability:** only **majority-committed** events are emitted, so nothing emitted can roll back.
- **Exactly-once:** each matching event is emitted once, with no skips.
- **Resumability:** resume via `resumeAfter`, `startAfter` (also valid after an invalidate) or `startAtOperationTime`. Only one may be given.

**Resume tokens** [CS-04].
- Every event's `_id` is `{_data: <hex string>}`, an opaque, versioned (currently **v2**) encoding. It contains:
  - cluster time;
  - token type (event vs **high-watermark**);
  - position within a transaction;
  - an invalidate flag;
  - optionally the collection UUID and an event identifier.
- A high-watermark token for time T sorts before every real event at T or later.
- Tokens are only valid for a stream opened with the same pipeline: a different `$match` may not find the token.
- **Errors:**
  - `ChangeStreamHistoryLost` (286) if the token has fallen off the oplog.
  - `OplogQueryMinTsMissing` (326) if the requested start time predates the oldest oplog entry.

**What makes it scale.** It reuses the replication log; there is no second log. Filters are pushed into the oplog scan. The design powers MongoDB's own tools (mongosync, Atlas Search, resharding) [CS-01].

**Failure modes.**
- Oplog window too small leads to history loss.
- `updateLookup` returns the *current* document, not the one at the event time.
- Large pre/post images exceed 16 MiB.
- Sharded latency is bounded by the slowest shard's idle heartbeat.

**Must specify vs may choose.**
- *Must:*
  - Event document shape: `operationType`, `ns`, `documentKey`, `updateDescription`, `fullDocument`, `clusterTime`, `txnNumber`/`lsid`, `wallTime`.
  - Token opacity plus total order.
  - Majority-only emission; exactly-once.
  - The resume options and their mutual exclusion.
  - Error codes 286/326; invalidate semantics.
- *May choose:*
  - Token encoding. It must be opaque and comparable; drivers treat it as opaque, but byte-compatibility is required if a clone must accept tokens minted by real MongoDB, e.g. live migration.
  - How events are sourced (a WAL, logical decoding, a CDC table).
  - Pre-image storage.

---

## 7. What makes it scale (synthesis)

1. **A document as the unit of atomicity and locality.** Most workloads need no cross-row coordination, so single-document MVCC writes are cheap. Multi-document ACID transactions are opt-in (4.0 for replica sets, 4.2 cross-shard) and costlier.
2. **One log does three jobs.** The oplog is the replication stream, the recovery redo source (stable checkpoint plus oplog replay), and the change-data-capture feed. Timestamps flow from the oplog into storage (commit timestamps), which unifies majority reads, snapshot reads, rollback-to-stable and change streams.
3. **Tunable consistency per operation** (`w`, `j`, readConcern, readPreference). Fast paths stay fast; the cost is correctness hazards when weak combinations are used (Jepsen §3).
4. **Cheap index comparisons.** Memcmp-comparable keys and a compressed B-tree with a bounded cache.
5. **Range sharding behind stateless routers** with versioned, lazily-corrected routing caches. Data movement happens online: migrations with critical sections, resharding by clone + oplog apply.
6. **Driver ecosystem contracts.** Server discovery and monitoring (streaming `hello`), retryable reads and writes, and connection pools are specified across all drivers. This is the true compatibility surface a clone must satisfy.

**Sourced production scale** (all primary, see §10):

| Organisation | Reported scale |
|---|---|
| Stripe DocDB (a MongoDB Community derivative) | >5M QPS, >2,000 shards, >5,000 collections, petabytes, 99.999% uptime [C-01] |
| Coinbase | about 700 clusters [C-02] |
| Toyota Connected | 20 Atlas databases serving more than 9M vehicles [C-03] |
| eBay (2017) | over 3,000 non-relational instances; 50-member replica set [C-04] |
| Baidu (talk) | 600 nodes / 160 shards / 200B docs [C-05] |
| Forbes | 140M users [C-06] |

---

## 8. xAI finding (verbatim)

**No public primary source found as of 2026-10-10** that xAI (the Grok company) uses MongoDB in production, nor at what scale [X-01..X-05].

What exists:
1. **Three live xAI job postings** (Greenhouse board `xai`) list MongoDB among databases a candidate should know: Backend Engineer – API, London; Software Engineer, Data Center – Memphis; Sr. IT Data Engineer. This is a skills requirement, not a deployment claim.
2. **Partnerships only.**
   - xAI's Grok Build Plugin Marketplace (2026-06-11) lists a MongoDB plugin.
   - MongoDB's 2026-08-13 press release mentions Grok Build integration.
   - Neither states that xAI uses MongoDB internally.
3. **Name trap:** MongoDB's 2015 press release and MongoWorld talk concern **x.ai Inc.**, the "Amy" scheduling-assistant startup. That is a different company from Musk's xAI and must not be cited as xAI usage.

**Searched:**
- "xAI MongoDB"
- "site:mongodb.com xAI Grok"
- "x.ai careers job MongoDB"
- "MongoDB earnings call xAI customer"
- "xAI MongoDB Atlas internal database Grok backend uses MongoDB"
- "job-boards.greenhouse.io xai MongoDB"
- "MongoDB.local 2026 xAI speaker Grok database"
- "Dev Ittycheria xAI MongoDB customer Grok"
- "MongoDB Grok Build plugin announcement Managed MCP Server xAI"
- The full xAI Greenhouse API (303 postings).

Earnings-call transcripts (Q4 FY26, Q1/Q2 FY27) were checked only through search snippets, so the result there is "not found in snippets", not "verified absent".

---

## 9. Licence landscape (verified 2026-10-10)

| Artifact | Licence | How verified | Implication for us |
|---|---|---|---|
| mongodb/mongo server | **SSPL v1** (AGPL for releases before 2018-10-16) | `LICENSE-Community.txt` read at pin; README | Study only; no code or text reuse. Behaviour may be reimplemented. |
| WiredTiger (vendored + wiredtiger/wiredtiger) | **GPL-2.0 or GPL-3.0**, commercial licence from MongoDB | `src/third_party/wiredtiger/LICENSE` read at pin; `gh api` (NOASSERTION) | Cannot be linked into an Apache-2.0 product without GPL obligations. Do not embed; design our own storage or use a permissive engine. |
| mongodb/specifications (driver + wire specs, incl. `source/message/OP_MSG.md`) | **CC BY-NC-SA 3.0 US** — *not Apache-2.0* | `LICENSE.md` heading; `gh api` NOASSERTION | Spec **text** must not be copied into the public repo, given the non-commercial and share-alike terms. Implementing the behaviour it describes is a separate matter. Cite and paraphrase only. Flag for legal review. |
| MongoDB docs (mongodb/docs) | **CC BY-NC-SA 3.0** (per content READMEs) | repo READMEs; site footer shows only ©MongoDB | Same as above: paraphrase, never paste. |
| Official drivers: go, java, node, python, c (incl. libbson), libbson (archived) | **Apache-2.0** | `gh api … .license` | Can be used as test clients and conformance harnesses, and even vendored with attribution. Their spec *test fixtures* (JSON/YAML) live in the specifications repo, which is CC BY-NC-SA, so check before vendoring tests. |
| BSON spec (bsonspec.org) | **CC0** (site footer) | site footer; mongodb/bsonspec.org repo README | Freely usable. |
| FerretDB | **Apache-2.0** (latest v2.7.0, 2025-11-10) | `gh api` | v2 is a wire-protocol proxy translating MongoDB 5.0+ protocol to SQL, over PostgreSQL + the DocumentDB extension. This is a precedent for "wire-compatible, not code-derived". |
| DocumentDB Postgres extension (microsoft/documentdb → documentdb/documentdb) | **MIT** | `gh api`; README; Linux Foundation press release 2025-08-25 (joined LF under MIT) | A permissive engine we could build on, or study freely. |
| Amazon DocumentDB | proprietary service | AWS compatibility page; FAQ via fetch summary | The compatibility page claims MongoDB 4.0/5.0/8.0 API compatibility. The FAQ reportedly says DocumentDB does not use MongoDB SSPL code, but that text was obtained through a fetch summary and may be paraphrased, so re-verify before citing. This is a commercial wire-compat precedent. |
| Azure Cosmos DB for MongoDB (RU) / Azure DocumentDB (ex-vCore) | proprietary service | Microsoft Learn | RU supports server versions 3.2–4.2. Azure DocumentDB is "built on DocumentDB", does not run MongoDB code, and "SSPL doesn't apply". |

**Takeaway.**
- The *protocol* and *behaviour* are reimplementable. Three large vendors and FerretDB do so commercially.
- The *texts* that describe them (server source, docs and driver specs) are SSPL or CC BY-NC-SA. Our public repo must contain only paraphrase plus citations.
- The Apache-2.0 drivers are the safest conformance oracle.

---

## 10. Claims we could not source, or kept as docs-only

- **The numeric `LATEST_WIRE_VERSION` for 8.3.** It is defined via a generated multiversion constant outside the sparse checkout.
- **The balancer migration threshold of 3× range size.** Docs claim; not located in source.
- **The find first-batch default of 101 documents.** Docs claim; not located in IDL at pin. This is a different constant from the planner's 101-result trial cutoff.
- **`transactionLifetimeLimitSeconds` default of 60 s.** Docs claim; not verified at pin.
- **Which commands are never compressed.** From the driver compression spec; not verified in source [W-14].
- **Drivers retry once on `RetryableWriteError`.** Driver-spec behaviour; not fetched [W-13].
- **The 7-voting-member cap.** Docs claim [R-12].
- **Amazon DocumentDB FAQ "no SSPL code" wording.** Obtained via a fetch summary and possibly paraphrased; re-verify [P-03].
- **Why and when LSM was removed from WiredTiger.** Only its absence at the pin is observed.
- **Whether the implicit default `w:"majority"` arrived in 5.0.** Not confirmed from a fetched page.
- **Coinbase connection-storm figures (10–20K connections per host).** The blog returned 403; search-snippet only. The mongobetween README itself is primary.
- **Azure DocumentDB (vCore) supported MongoDB versions.** Search snippets only.
- **xAI usage/scale.** See §8: none found.
