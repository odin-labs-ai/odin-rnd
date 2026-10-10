# An Odin-owned document store: design study

Authored 2026-10-10. Status: **design + pre-registered experiment (EXP 010), not yet run.** Every input follows
[`CLEAN-ROOM.md`](CLEAN-ROOM.md); every external claim has a row in [`study/provenance.json`](study/provenance.json)
(ids in square brackets). The study notes are in [`study/architecture-notes.md`](study/architecture-notes.md).

## The question

Odin wants a document database it **owns**: one it can run, change and ship under its own terms. It also wants the
parts of MongoDB's design that let it run very large production systems. Three questions sit underneath:

1. What does Odin actually do with document-shaped data today?
2. Which parts of MongoDB's design carry its scale, and which are interface (what a client can observe)?
3. What is the cheapest path to an owned store that speaks that interface, and how would we know it is good enough?

## 1. What Odin does with document-shaped data today (measured 2026-10-10)

We read the platform's own code (read-only). We describe it here without private detail.

- **One engine family.** PostgreSQL (15/16, with pgvector) plus Redis. No document database or document-database
  driver is a dependency anywhere in the platform.
- **The memory service is a versioned key-value store.** One JSONB value per (namespace, key), a full history row
  per version, metadata indexes only. Its query model filters on namespace, key, owner, time and dependency;
  **it never filters on fields inside the value**. Writes replace the whole value.
- **Querying inside JSON is rare and mostly done in application code.** We found one database-side nested-field
  predicate (a compare-and-set guard), two containment queries and one nested `jsonb_set`. The common pattern is:
  fetch a namespace, then filter and sort in application code.
- **Relational models carry JSON columns.** 35 of 69 models in the largest schema have at least one JSON column
  (property bags, policies, results). They are updated by read-modify-write in application code.
- **Transactions, counters and locks are used.** Examples: multi-row transactions with an audit row, version
  counters, an advisory lock.
- **Known pain points.** All four are recorded in internal decision records.
  - TTL expiry by application sweep collides with an append-only trigger on the same table.
  - Aggregation loads whole JSON values into application memory.
  - JSONB **reorders keys**, which broke a hash chain. The fix stored the payload as text.
  - The change feed is in-process only: no persistence, no resume.
- **Scale.** A representative memory store holds about 15.5k rows (~270 MB), growing by tens to hundreds of rows a day.

The frozen list of 26 operation classes, each marked used or not used with the code evidence, is in
`preregistration.json` under `operations`.

## 2. What carries MongoDB's scale (summary of the study notes)

| Mechanism | Why it scales | Interface or implementation? |
|---|---|---|
| Document as the unit of atomicity | Most writes need no cross-row coordination | Interface: single-document atomicity is observable |
| One log, three jobs: oplog = replication stream + recovery redo + change feed | No second log; timestamps unify majority reads, snapshots, rollback and change streams [R-01, S-08, CS-02] | Implementation, but write/read concern semantics are interface |
| Tunable consistency per operation (`w`, `j`, `readConcern`) | Fast paths stay fast | Interface. Weak combinations lost acknowledged writes in published Jepsen analyses [J-01..J-05] |
| Memcmp-comparable index keys in a compressed B-tree with a bounded cache | Cheap comparisons, bounded memory | Implementation; only the comparison **order** is interface [S-03] |
| Range sharding behind stateless routers with versioned routing caches; online migration | Horizontal growth without downtime | Mostly implementation; the admin command surface is interface [K-04, K-06] |
| The driver ecosystem: wire protocol, server discovery, retryable writes | Every language works against any compliant server | **The real compatibility surface** [W-04, W-10] |

Public production lessons we will design against:
- A working set larger than RAM gives unpredictable latency [C-08, C-09].
- Monotonic shard keys create hot shards [K-10].
- Connection storms led one operator to build a multiplexing proxy [C-07].
- Weak default concerns are the dominant correctness hazard [J-01..J-05].

Sourced large-scale deployments include Stripe's DocDB (>5M queries/s, >2,000 shards, built on MongoDB Community) [C-01] and Coinbase (~700 clusters) [C-02].

On xAI: we found **no public primary source**, as of 2026-10-10, that xAI runs MongoDB in production or at what scale. We found job postings that list MongoDB as a skill, and plugin partnerships. Neither is a deployment claim [X-01..X-05]. We make no claim about it.

## 3. Licences that bound the design (verified 2026-10-10)

| Component | Licence | Consequence |
|---|---|---|
| MongoDB server | SSPL v1 | Study only. Section 13 obligations if Odin offered it as a service. No code reuse. |
| WiredTiger storage engine | GPL-2.0 or GPL-3.0 | Not embeddable in an Odin product |
| MongoDB documentation and driver specifications | CC BY-NC-SA 3.0 | Paraphrase and cite; never copy text or test fixtures |
| Official drivers (Node, Go, Java, Python, C) | Apache-2.0 | Usable as clients and as the conformance oracle |
| BSON specification | CC0 | Free to use |
| FerretDB v2 | Apache-2.0 | Fork rights; wire-protocol layer over PostgreSQL |
| DocumentDB PostgreSQL extension | MIT | Fork rights; the BSON type and operator engine inside PostgreSQL |

## 4. Options

| | Option | What "own" means | Cost (order of magnitude) | Main risk |
|---|---|---|---|---|
| A | Run MongoDB itself (Community self-hosted, or a commercial licence) | Not owned: licensed | Days | Lock-in. SSPL §13 obligations would apply if Odin **offered database functionality to third parties as a service** (for example tenant-facing database access); using MongoDB behind Odin's own application is a different case. Where that line falls for a tenant platform is a legal question. |
| B | **Adopt FerretDB v2 + DocumentDB on Odin's existing PostgreSQL** | Pinned forks under Apache-2.0/MIT; Odin's own spec, governance and operations | Weeks | Compatibility gaps; younger project; performance relative to MongoDB |
| C | Build Odin's own wire layer over PostgreSQL | Fully owned code | Months | Rebuilds what B already provides; years of edge cases |
| D | Build a new engine (storage, replication, sharding) | Fully owned engine | Years, with a storage team | Correctness (see the Jepsen history); no measured need at current scale |
| E | Stay on PostgreSQL JSONB and fix the four pains directly | Already owned | Days to weeks | Delivers no wire compatibility |

## 5. Recommendation

**B first, gated by measurement; C only for measured gaps; not D.**

- **B reuses everything Odin already operates.** PostgreSQL, pgvector, per-tenant database isolation and the
  backup paths all stay. It adds a wire-compatible front door that any MongoDB driver can use.
- **"Owning" it means three things:**
  - a pinned fork of permissively licensed code;
  - the clean-room specification in this directory;
  - Odin's governance layer (audit, append-only collections, version history) as Odin code on top.
- **D is not justified.** The measured workload is small (tens of thousands of documents), and MongoDB's scale
  machinery solves problems Odin does not have yet.
- **B also addresses two of today's four pains:**
  - BSON documents keep key order, which removes the JSONB reordering hazard.
  - A real change-stream interface is possible because PostgreSQL has a write-ahead log. Whether FerretDB exposes
    one is something the experiment checks, not something we assume.
- **E stays the fallback** if the experiment refutes B for Odin's operations.

The licence posture and build-versus-adopt choice are founder decisions. This document recommends; it does not decide.

## 6. The experiment (EXP 010, pre-registered in `preregistration.json`)

"Does a permissively licensed, PostgreSQL-backed wire layer answer like MongoDB on the operations Odin uses?"

- **Method.** Differential testing at $0, with no model calls.
  - 61 commands, written from the public documentation, run through the official Apache-2.0 Node.js driver.
  - Each command runs against the MongoDB Community 9.0.2 image (reference) and FerretDB 2.7.0 with DocumentDB
    (candidate), both pinned by digest.
  - A frozen comparator (`scripts/document-store-compare.mjs`) decides whether a client could tell the two replies
    apart. Its teeth are tested: every planted divergence is caught, and every unobservable difference is ignored.
- **Where it runs.** The counted run executes on a GitHub Actions runner, not a laptop. The runner script is
  published as an amendment before any counted run, the same way EXP 008's analysis script was.
- **Primary measure.** The share of the 55 cases on operations Odin uses where the candidate is indistinguishable
  from the reference.
- **Decision rule, fixed now.**
  - **≥ 95%** → adopt B.
  - **80–95%** → adopt B and build the gaps (C, scoped to the failing classes).
  - **< 80%** → B is refuted for Odin's needs; fall back to E, and C becomes the question.

## 7. The reverse-engineering toolchain

Recorded in [`toolchain/README.md`](toolchain/README.md):
- Ghidra 12.1.4 and a Ghidra MCP server (pyghidra-mcp 0.2.7), installed sandboxed, with no system-wide change.
- A headless symbol walk over the MongoDB Community 9.0.2 `mongod` binary.
- An independent `nm` census as a cross-check.

The toolchain measures; it never extracts code. Decompiler output is SSPL-derived and is not committed.
