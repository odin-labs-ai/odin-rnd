# EXP 016 counted rows, as published

`counted-2026-10-23.jsonl` (sha256 `c2ebf156067e53c598f3051aaf9c097400d2c8b5dd570021c4712f43fbd9ea0d`) holds the counted run's 720 calls: one header line, 720 call rows and one trailer. It was written by `run.mjs` (frozen by the pre-registration) and reduced by `../amendment-01/anonymise.mjs` (sha256 `e2ef44a18f89143a…`, pinned in amendment 01). `../results.json` and `../spend-ledger.jsonl` are recomputed from this file in CI by `../amendment-01/analyse-anon.mjs --check`, which calls the frozen `analyse()` unchanged (`scripts/broker-same-model-amendment.test.mjs`).

How to read it:

- **Brokers are letters.** The assignment is private (founder decision, 2026-10-23). It is not committed here, not even as a hash: with three brokers there are only six possible assignments, so a hash would reveal it. Any change to the assignment would need a new, dated amendment.
- **No served model ids.** Amendment 01 drops `servedModel` and `servedProvider`, because each broker spells them differently. For every call, `servedFamily` and `servedMatches` (from the frozen `lib.mjs`) say whether the requested model answered. As a result, `servedModels` and `servedProviders` are empty in `results.json` by design.
- **`ok`** follows the frozen record: HTTP 200 with non-empty answer text. A Sonnet answer that hit the 400-token limit after writing some text is `ok`, with `finishReason: "length"`. One that hit the limit before writing any text is a failure (`errorClass: "empty-answer"`). Those calls were still billed, so they carry a `costUsd`. A 503 carries none.
- **Spend.** The broker-reported costs sum to $1.3987. The trailer's `spentUsdCounted` ($1.4995) is the runner's own spend-stop counter, which charges every call without a reported cost at its worst case ($0.0144 per Sonnet call, ×7 HTTP 503s). That conservative count is never a bill.
- **Identical answers across brokers** (the same `answerSha256`) happen on the GPT-4o mini arm, which ran at temperature 0. That is expected of the same model, not a sign of a swap.
- The first rows of each slot share a timestamp: the three brokers in a slot are called at the same moment, in parallel.
