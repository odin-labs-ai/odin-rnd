# Lab record v1

One run of a lab's check command, on one machine class. The lab runner (private, on the org's machines, never the
operator laptop) writes one per machine; a lab's record file embeds them (Lab 05: `runs` in
`site/data/labs/rogue/record.json`). Schema: `scripts/schemas/odin-lab-record.schema.json`. Checker:
`scripts/lab-record.mjs` (`node scripts/lab-record.mjs <record.json> ...` exits 1 with every reason). The checker is
fail-closed and runs in `pnpm test`.

| Field | What it holds |
|---|---|
| `format`, `version` | `"odin-lab-record"`, `1` |
| `lab` | the lab's slug, from a closed list (today `rogue`; a new lab extends it) |
| `runner` | `github-hosted`, `org-hosted` or `laptop`: a class, never a runner or host name |
| `machineClass` | the runner's one class: `ubuntu-latest`, `org-ci-heavy`, `mac` |
| `image` | the container image the check ran in, pinned by digest (`name:tag@sha256:<64 hex>`), or `null` when it ran on the machine itself |
| `commit` | `sha` (the commit that ran), `mainHead` (the main head it was checked against), `compare`, `onMain` |
| `command` | the check command in words, from a closed list (today `the demo's own check command`), never a path or a module name |
| `inputs` | `[{ role, sha256 }]`, sorted by role, unique: the files the check reads, by a role from a closed list (today `runner`, `runs`), never by path |
| `result` | `verdict` (`SAME` or `DIFFERENT`), `committed` and `now` (the two hashes the check printed, same length), `breaches` (an integer, 0 to 1000000, so it serialises the same in every language) |
| `recordHash` | see below |
| `ranAt` | when the check ran, `YYYY-MM-DDTHH:MM:SSZ`, not after the check of the record |
| `replicatedOn` | `[{ machineClass, recordHash }]`: other machine classes whose run held this record's `recordHash` |
| `differedOn` | `[{ machineClass, recordHash }]`: other machine classes whose run held a different one |

**recordHash.** sha256 (hex) of the canonical JSON of
`{ format, version, lab, commit: commit.sha, command, inputs, result }`: keys sorted at every depth, no whitespace,
UTF-8. In Python: `json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. It covers what ran,
on which commit and what it printed; it leaves out where and when (`runner`, `machineClass`, `image`, `ranAt`,
`commit.mainHead`, `commit.compare`, `commit.onMain`), so two machines that computed the same thing from the same
commit hold the same `recordHash`. Every string in the core is ASCII by the schema's patterns, and every number in a
record file is written as a plain integer (no fraction, exponent or `-0`; the checker reads the file's text for this,
because `0.0` parses as `0` in JavaScript and stays `0.0` in Python), so both languages write the same bytes. The golden value: Lab 05's Mac re-run, `47c9ab93279dae96f8423aabc985beda6492f2e498da82e055d9ba9fa44aacf8`
(`scripts/lab-record.test.mjs`).

**compare and onMain.** `compare` is the status of a GitHub compare with the commit as base and the main head as head:
`identical`, `ahead` (main is ahead of the commit), `behind`, `diverged`. The public checker cannot read the private
repository, so it checks that the record's claims agree, not the ancestry itself: `onMain` is true exactly when
`compare` says the commit is part of main (`identical` or `ahead`), and `identical` holds exactly when `sha` is
`mainHead`. The org runners read the private repository AT main, so their records must say `identical`; only a laptop
record, whose compare was read from GitHub by hand (Lab 05's vendor step does this), may say `ahead`. One exception, by
lab: Lab 06 (`review`) is re-run at the pinned, reviewed commit of this repository, not at its moving main (moving it is a
reviewed change to the lab runner), so its org records name the real main head and say `identical` or `ahead`; the
runner reads both from GitHub and refuses any other. `behind` and `diverged` stay refused for every org record.

**Replicas.** Every `replicatedOn` hash equals the record's `recordHash`; every `differedOn` hash does not. A machine
class appears once across the record and both lists. A mismatch between machines is recorded in `differedOn` and
shown as a different hash, never folded into `replicatedOn` or forced to agree.

**What may not ride along.** Every object is closed, and every string is a hash, a date or a word from a closed list
(lab, runner, machine class, command, input role): no runner name, path, host, repository name or log line fits the
schema. A new lab extends those lists in the schema, in review.
