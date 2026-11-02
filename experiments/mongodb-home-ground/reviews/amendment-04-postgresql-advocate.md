Reviewer: an independent model reviewer (Claude, fresh context), read-only, 2026-10-26, before S2's verdict; no S2 result files opened. Brief: the nine interpretations proposed for EXP 020 amendment 04 (report code at private commit `ce98d208`). Published verbatim.

**PostgreSQL advocate, EXP 020 S2, amendment 04 review**

1. **ACCEPT.** "Same direction" means the sign of the median seed-2 paired difference. A zero has no direction, so it cannot count for either store. This is the same rule Lab 03 used for A4b.

2. **ACCEPT.** "Winner <= 0.8 x other" means the winner's p95 is 20 % lower than the loser's. It treats both stores the same way, and it is the stricter of the two readings.

3. **ACCEPT the counts 4 / 5 / 0**, checked against the code:
   - **MongoDB 4.** Transactions and change streams need the replica set. The replica set runs with auth, so it needs the keyFile (compose.yml). `mongo_consume` resumes only through `start_after` with the stored token. There is no catch and no `find` fallback, so if the oplog window runs out, the resume point is lost. That makes oplog sizing and the window alarm needed for correctness. This is unlike Lab 04, where a fallback existed.
   - **pgoutput 5.** `wal_level=logical` is needed. The publication and the slot are persistent objects, created in `pg_setup`. Bullet 6 names the slot-retention alarm.
   - **Outbox 0.** It needs no setting. compose.yml sets `wal_level`, `max_wal_senders=4` and `max_replication_slots=4` on every variant. The last two are below PostgreSQL 16's defaults of 10 and are needed by no arm.
   - **For the record (against PostgreSQL only):** PostgreSQL's default `max_slot_wal_keep_size=-1` keeps the slot's WAL without limit. So the cap is arguably the Retention rule's equal-budget condition (`budget()`), not a correctness need, and pgoutput could be 4. I am not asking for that change. The best variant (outbox, 0) decides the tie-break. On the old pairing the gap is 4 vs 4 or 4 vs 5, and neither reaches 2, so no verdict changes either way.

4. **ACCEPT.** This is secondary only, and it is defined before any result is seen.

5. **ACCEPT.** It matches PREREG's `invalid` ("a cell is incomplete") and keeps the reason visible.

6. **ACCEPT.** These are the frozen matrix's names, and every ignored file is listed.

7. **ACCEPT.** PROTOCOL-S2 defines "best" among the variants that pass the gate. Publishing failing variants as excluded meets "every variant, every outcome".

8. **VETO.** Alternative: the report reads the cell names flagged in `DISTURBANCES.md` and refuses to run while any of them is outside `discarded/`. Reason: the doctrine says explicit > implicit and everything must be reproducible. Moving the files by hand is a step a stranger cannot check. The check works the same for both stores and costs one parse.

9. **ACCEPT.** The gates already span both seeds, so the candidate set is the same. Breaking ties on seed-2 values is the only reading consistent with a seed-2 selection.

Files read:
- PREREG.md 40–127
- PROTOCOL-S2.md 40–90
- runner/client/s2.py (all)
- runner/compose.yml
- runner/s2_report.py (the constants and COMPONENTS references)
- lab02 reviews/a10-*.md

No S2 result files were opened.
