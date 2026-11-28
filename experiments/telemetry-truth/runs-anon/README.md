# EXP 015 counted rows, as published

56 files, one per scheduled probe run (2026-10-28T00:00Z to 2026-11-04T00:00Z), 448 lines in all: one header, six call rows and one trailer per file. Written by the probe's own capture code (frozen by the pre-registration's sha256 pins) and reduced by `../amendment-01/anonymise.mjs` (pinned in amendment 01). `../results.json` is recomputed from these files in CI by `../amendment-01/analyse-anon.mjs --check` (`scripts/telemetry-truth-anon.test.mjs`), which calls the frozen `analyse()` unchanged.

How to read it:

- **Brokers are letters.** The assignment is private (lab decision, 2026-11-28, same reasoning EXP 016's amendment 01 recorded on 2026-10-23 for the same two brokers). It is not committed here, not even as a hash: with three brokers there are only six possible assignments, so a hash would reveal it.
- **`canonicalModel` is kept.** Every broker's row already normalises it to the same string for the same requested model, so it names no broker. `requestedModel` and `servedModel` are dropped: each broker spells or serves these differently, which is itself a re-identifying detail.
- **No generation-record cross-check.** One broker's API offers a cross-check against its own `usage.cost`; its four fields are dropped here because their mere presence on a row would say which letter that broker is, even lettered. The cross-check stays in the private, named record.
- **`estimateSource` is dropped.** It names the private price-book repository and, for one broker, the broker itself.
- Every measured value — cost, gap, latency, tokens, status, the trailer's key-usage counters — is copied unchanged.
