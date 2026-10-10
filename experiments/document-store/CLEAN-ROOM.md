# Clean-room protocol — an Odin-owned document store

Authored 2026-10-10. This file governs every input to the document-store work in this directory. It exists so
that whatever Odin later builds stays **ownable**: licensable under Odin's own terms, never derived from code
whose licence would bind Odin's product.

## Why a clean room

MongoDB Community Server is published under the Server Side Public License v1 (SSPL). Copying or translating
SSPL source into an Odin product would make that product a derivative work under SSPL terms, including SSPL
section 13 (offering the program as a service obliges releasing the full "Service Source Code"). The wire
protocol, the BSON format and the observable behaviour of commands are interfaces. They are described in
public specifications and documentation, and independent compatible implementations exist under permissive
licences. FerretDB (Apache-2.0) is the closest precedent; Amazon DocumentDB and Azure Cosmos DB's MongoDB API
are commercial ones.

This is an engineering protocol. It is not legal advice, and the licence posture is a founder decision
(see `DESIGN.md` §Decisions).

## Two tracks, one direction of flow

| Track | May read | Produces | May NOT |
|---|---|---|---|
| **Study** (this pre-registration) | SSPL server source at a pinned commit, official documentation, public specifications, papers, talks, public case studies, Community Server binaries (inspection with Ghidra) | Behavioural notes in our own words, each with a provenance row; the specification | Copy, translate or closely paraphrase source text or code; reproduce test files |
| **Build** (later, separate work) | The specification, permissively licensed code (Apache-2.0 / MIT / BSD) under its licence, the official driver suites under their licences | Odin code | Open SSPL source or study notes beyond the specification |

Information flows only one way: from the study track into `SPEC` (behaviour, wire format, storage and
replication semantics), and from the spec into code. A person or agent who has read SSPL source for this work is
on the study track for that subsystem.

## Provenance rule

Every design input gets one row in `study/provenance.json`:
`{ id, claim, source, licence, accessed }`. `source` is a URL or `repository path @ commit`. A claim without a row
is not used. A scale figure (documents, nodes, requests per second, customer names) is used only when a public
primary source states it. Anything reported to us without a public source is marked as such and never shown as fact.

## Binary inspection boundary

- Allowed: MongoDB **Community** Server builds, downloaded from MongoDB's public download index, with the
  published SHA-256 verified and the bundled `LICENSE-Community.txt` confirmed as SSPL v1 before inspection.
  SSPL contains no clause forbidding inspection, and the corresponding source is public anyway.
- Never: Enterprise Server, Atlas or any binary distributed under an EULA that forbids reverse engineering.
- Inspection output (symbol counts, the address of a symbol) is a measurement. Decompiled code is never
  committed: it is SSPL-derived text.

## What this directory may contain

Our own prose, our own scripts, measurement receipts (hashes, counts, timings) and links. No SSPL source, no
decompiler output, no MongoDB test files (`jstests/` is SSPL). The experiment's test cases are written here
from the public documentation and run through the official Apache-2.0 Node.js driver.
