# Runs of 12 November 2026

Three sessions, all on the same machine that night, all kept as they are. Each log's first row (`"kind":"session"`)
names the sha256 of the runner, scorer, fixture and questions it ran with.

- `rows.jsonl` is the published session, and the record is built from it. It ran with the current runner and scorer.
- `rows-first-session.jsonl`: its last two cells (qwen3:32b, the forced question, bare and with the harness) did not
  start, because the machine's one-minute load was above the runner's ceiling of 40 when they were due. Rather than
  publish a table with a hole, the whole session was run again.
- `rows-second-session.jsonl`: complete. A review then found two defects in the runner and scorer: a test suite that
  could not be launched would have been taken as a failing one, and a path that is empty after normalising (such as
  `fixture/`) was dropped rather than counted as invented. Neither changed a score in these logs (no reply names such a
  path, and the suite ran each time), but the published record must be bound to the fixed files, so the session was
  run a third time with them.

Every cell the sessions share has the same wrong-PASS and invented-file counts, and the second and third sessions
returned the same 200 replies byte for byte: the seeds are fixed per run, so the run is reproducible on this machine
(which also means the ten runs of a cell are ten seeds, not ten independent draws of an unseeded model).
