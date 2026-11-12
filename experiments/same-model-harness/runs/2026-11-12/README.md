# Run of 12 November 2026

- `rows.jsonl` is the published session: every cell ran, and the record is built from it.
- `rows-first-session.jsonl` is the session before it, kept as it is. Its last two cells (qwen3:32b, the forced
  question, bare and with the harness) did not start: the machine's one-minute load was above the runner's ceiling of
  40 when they were due. Rather than publish a table with a hole, the whole session was run again, with the same
  runner, scorer, fixture and questions, minutes later. The cells both sessions ran agree on every wrong PASS and invented-file count (the seeds are fixed per run);
  the comparison is in the pull request that added this lab.
