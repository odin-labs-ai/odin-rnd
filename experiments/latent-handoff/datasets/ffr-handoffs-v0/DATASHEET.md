# latent-handoff-telemetry v0: datasheet

A de-identified `ffr.v1@ad3aec7c87bc` dataset of agent-step telemetry. Every row comes from an already-public source. It is part of EXP 008 (latent-handoff), the cross-family KV handoff experiment on public baselines.

- **Rows:** 482 (`dataset-v0.jsonl`, one JSON object per line, sorted by `eventId`; sha256 `8b39a717200b6722f6e0f3674e662495610cad6e8bdc5de9fb84b83d4e972fba`)
- **Days covered:** 2026-09-29 to 2026-10-01 (UTC, day resolution)
- **Licence:** CC-BY-4.0
- **Built from:** published odin-rnd commit `c765d460966d88d3bc0c05defa27fa1e4d1739cf` (origin `git@github.com:odin-labs-ai/odin-rnd.git`), by `export-public-v0.mjs` (odin-labs). The build is deterministic: the same commit and salt give byte-identical files.
- **Tenant floor used:** the live `protected-tenants.json` (release fingerprint `b78605200d9c9fb6`, an HMAC under the private salt).

## Sources (closed allowlist, all read from that commit)

| source | what | rows |
|---|---|---|
| `odin-rnd-record` | experiment gate-run records (`experiments/*/results/*.json`, `kind: gate-run`, `fixture: false`), one row per call | 482 |
| `exp008-emitter` | EXP 008 `ffr.v1` emitter rows | 0 |
| `synthetic` | synthetic items | 0 |

Nothing comes from private factory logs, transcripts, ledgers, routing rows or verdict rows.

Record files: 15. Gate-run records: 6. Fixture records skipped: 0. Fixture calls skipped: 0. Calls read: 482.

## Fields

Each row is `ffr.v1@ad3aec7c87bc`, rebuilt field by field from closed shapes. No free text from a source is copied.

- `actor.model` is always `null`. Only `actor.modelFamily` is kept, taken from an exact-id lookup.
- `ts` is the UTC day (`YYYY-MM-DDT00:00:00Z`).
- `agentStep.taskType` and `quality.tags` are `gate-<name>` from a closed list of gate names that are already public; any other name is `null`. `agentStep.durationMs` is the call's end-to-end latency.
- `usage.costUsd` is `estimated`: a listed price, or the API-equivalent price for subscription calls. A local model with no price is `null` with a reason. Zero is never used to mean unknown.
- `usage.prefillTok` is filled only where the record names input tokens explicitly.
- Every `null` usage field carries a reason from a closed list.
- `runId`, `stepId`, `parentStepId`, `eventId` and `sourceRowHash` are HMAC-SHA256 under a per-release salt that stays private. They keep source ids out of this file.
- **What the salt does not do:** the sources are public, so a row can still be matched to its public record by its values (day, gate, duration, cost). Nothing in this file is more identifying than the public records themselves.

| modelFamily | rows |
|---|---:|
| `claude` | 362 |
| `unknown` | 120 |

| taskType | rows |
|---|---:|
| `gate-jev` | 60 |
| `gate-laya` | 60 |
| `gate-reviewer` | 362 |

Rows with a cost: 422. Rows with input tokens: 60.

## Exclusions and fences

- **Tenant exclusion:** the live `protected-tenants.json` always applies, to every field of the raw input (the whole record and the call, including fields later hashed or dropped) and again to the output. An extra floor can only add to it. If any floor is unreadable, nothing is written. Excluded rows are reported as one count, `tenant-exclusion`, without saying which rule matched.
- **Rows excluded by the tenant floor:** 0 (a floor name anywhere counts, as written, squashed, or as a case/separator variant; a name lying entirely inside a digest-looking hex string does not, nor does one that starts in the middle of a word and runs across punctuation or spaces into the next word, unless it is the name exactly as written).
- **All drops:** none.
- **Private-term scan:** runs over the exact bytes of both files before anything is written, matching each term both literally and with separators removed (so case, space, underscore and hyphen variants are caught). A hit writes nothing.
- **Closed-shape assertion:** every string field must match the shape allowed at its path, and no gate or tag may contain a known model id. A failure writes nothing.

## Known limits

- v0 contains EXP 005 and EXP 006 gate calls only. EXP 008 rows join once its emitter runs.
- These records hold no prefill or time-to-first-token timings. The latency is end to end.
- Reviewer costs are API-equivalent estimates for subscription calls, not invoices.
- The floor scan over raw records covers every field, free text included. It may drop a clean call that happens to contain a floor name inside a longer word. It keeps a call that contains a floor name only in the two shapes above.
