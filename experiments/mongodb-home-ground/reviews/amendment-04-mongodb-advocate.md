Reviewer: an independent model reviewer (Claude, fresh context), read-only, 2026-10-26, before S2's verdict; no counted cell opened. Brief: the nine interpretations proposed for EXP 020 amendment 04 (report code at private commit `ce98d208`). Published verbatim.

**MongoDB advocate, EXP 020 S2 interpretations (proposed amendment 04): 8 ACCEPT, 1 VETO (item 8).**

Files I read: the brief, PREREG.md, PROTOCOL-S2.md, s2_report.py, client/s2.py, the Lab 04 A10 sign-offs and results/s2/DISTURBANCES.md. I did not open any counted cell.

1. **ACCEPT.** This is the A4b convention, and it applies to both arms the same way. A zero median does not count as agreeing. The code (`apply_rule`) already does this.
2. **ACCEPT.** "Beats by ≥ 20 %" means the winner is at least 20 % lower, so the winner's p95 ≤ 0.8 × the other's. This is the stricter of the two readings, and it binds both arms equally.
3. **ACCEPT, checked against the code.** `mongo_consume` resumes only by `start_after` on the stored token. It has no try/except, no handling for ChangeStreamHistoryLost, and no `find` over `source`. So if the oplog window runs out, the resume point is lost. Oplog sizing and the oplog alarm are needed for correctness, which is the Lab 04 PostgreSQL advocate's own condition for counting them. Outbox = 0 matches the A10 reading that both advocates signed. Condition: the report must also publish the literal-bullet counts (5 / 6 / 4), because PREREG says "both counts published". `COMPONENTS` in s2_report.py still holds the literal list and must change.
4. **ACCEPT.** It is secondary, labelled as favouring PostgreSQL, and never decides.
5. **ACCEPT.** This matches PREREG's `invalid` when "a cell is incomplete". The reason is shown.
6. **ACCEPT.** Extra file names are visible in the report and cannot be swapped in.
7. **ACCEPT.** A variant that fails the gate has no comparison to make. The cells it failed are shown.
8. **VETO.** Alternative: the report reads every heavy-work window flagged in DISTURBANCES.md, in a table a script can read. It refuses, the same way it refuses on a missing cell, when any top-level counted cell's run (`t0` to its end) overlaps one of those windows. It also lists by name the cells kept under light overlap. Reason: the disturbance rule says such a cell "is discarded and re-run", and trusting the directory has already failed twice. `pgoutput-x1-rep4-seed2` stayed counted from 17:05 to about 20:00, and five cells from 13:07–14:18 stayed counted until 21:35. Checking by name alone cannot work, because a re-run reuses the name. Amendment 03 shows that load on the host hit the MongoDB arm hardest.
9. **ACCEPT.** It uses the same gate set, and only the seed changes.

**Naming:** call it "EXP 020 amendment 04". PROTOCOL-S2.md already has a runner amendment 04.
