# EXP 006 — nina reviews the change (bundle 1, phase A: code, $0)

EXP 005 measured nina 0.34.0's reviewer, but in 131 of 180 runs its own fence refused the git forms the reviewer
uses, so the reviewer audited the clean base tree. EXP 006 re-measures on the same corpus with a fence that allows
those read forms inside the workspace, and adds a pre-registered manipulation check: a run counts as having seen the
change only if its recorded tool calls show it obtained the diff.

Nothing here has made a paid call. The live probe (matrix v6) and the pre-registration come next.

| File | What it is |
|---|---|
| `denial-census.mjs`, `denial-census.json` | WO-1-01. EXP 005's 317 refused git commands by exact form, each mapped ALLOW-IN-FENCE6 / STAYS-DENIED (+ reason); per report, the first refused form and whether the run later tried a form fence6 allows. |
| `fence6.mjs` | The fence: fence5's deny rules and OS sandbox unchanged, plus allow rules for `git`, `git --no-pager`, `git -C <ws>`, `git -C <ws> --no-pager` × diff/status/show/log. Parameterised prefixes; the open questions the live probe must answer; an offline client model (it proves nothing about the client). |
| `run_reviewer6.mjs` | The runner (own argv with `--output-format stream-json --verbose`, loop, record builder, fixture guard). |
| `stream6.mjs` | NDJSON parser and the harness-failure rule (EXP 005 amendment 01's, translated only for stream-json). |
| `spend6.mjs` | $60 cap and $10 pre-counted ceiling enforced in code; unknown cost charged the upper bound; never a $0 line. |
| `guard6.mjs`, `freeze.mjs`, `runners.sha256` | The counted-run guard. `freeze.mjs` holds null until the freeze, and every counted run refuses while it does. |
| `matrix6.mjs` | Isolation matrix v6: v5's rows plus R32–R46 (the new forms), controls C9–C16, info row I47; the judge scans every tool output. |
| `base-lines.mjs`, `base-lines.json` | The sha256 of every trimmed line of the real staged base commit (3e35e4e2…), nina's files included. |
| `fingerprints.mjs`, `change-fingerprints.json` | Per item: `+` lines not in the base, `-` lines, added/deleted/renamed paths. |
| `diff-seen.mjs` | The classifier: rule (a) a sign-matched whole diff line in a successful git output; rule (b) a `??` entry plus a Read/Grep of the added file. |
| `results6.mjs` | The scorer: EXP 005's bar verbatim (its own `spotlightVerdict`), BLIND scored as an error, the manipulation check, diff-seen-only figures beside. |
| `vendored-exp005.mjs` | Byte-identical copies of the EXP 005 private helpers EXP 006 needs (slice-tested against `fixtures/exp005-b2dbb1fd/`). |
| `fixtures/fake-claude-stream.mjs`, `fixtures/synthetic6.mjs` | The stream-json fake and the synthetic tool calls (tests and the rehearsal only). |

Layer 1 (the text rules) is best-effort; layer 2, the OS sandbox, is the boundary.

## Running the paid bundles (2 and 3): one worktree, one runner at a time

- **One worktree.** Bundles 2 and 3 run from ONE worktree, `.worktrees/exp006-run` (made from odin-rnd main once
  this record is merged), one after the other. The pending sidecar `spend-ledger.pending.jsonl` and the run lock are per
  worktree (both are gitignored and never committed), so a second worktree would not see the first one's pending
  calls.
- **The run lock.** Every paid invocation (practice, probe, pre-run probe, counted) creates
  `experiments/nina-changes/run.lock` exclusively (O_EXCL) for its whole run and removes it at the end. A second
  runner refuses while it exists; two concurrent runners could otherwise each pass the spend check and overshoot the
  cap by one call. A lock left by a killed runner is removed by the operator only after checking that no runner is
  running (fail closed).
- **Intent lines.** Before each paid spawn the runner appends an intent line to the sidecar and clears it once the
  real ledger line is written. Any line left in the sidecar makes every later call refuse until the operator
  reconciles it.
- **Reconciling a leftover line.** Append ONE ledger line for the call, charged at the upper bound the intent line
  recorded, then remove that line from the sidecar:

  ```json
  {"ts":"<intent ts>","gate":"reviewer","kind":"<intent kind>","id":"<intent id>","run":<intent run>,"costUsd":<intent upperBoundUsd>,"costBasis":"upper-bound","reportedCostUsd":null,"fixture":false,"reconciled":true,"prereg6Sha256":"<frozen sha, prerun-matrix only>"}
  ```

  A `prerun-matrix` line without a `prereg6Sha256` counts as the pre-run probe of the CURRENT frozen
  pre-registration, so no second pre-run probe can be made (fail closed).
