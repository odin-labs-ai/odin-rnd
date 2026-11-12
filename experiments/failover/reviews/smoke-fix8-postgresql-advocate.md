Reviewer: an independent model reviewer (Claude, fresh context), PostgreSQL advocate, read-only, 2026-11-08, on runner fix #8 (full redundancy in classic sync mode) found by the smoke run. Published verbatim.

**Verdict: ACCEPT.** I am attaching one recommended tightening. It benefits MongoDB's fairness, not PostgreSQL's.

**Format check (Patroni 4.0.6, `patroni/postgresql/sync.py`, `set_synchronous_standby_names`).**
- In quorum mode, whenever the sync set is non-empty, Patroni builds `f'{prefix}{num} ({...})'` with `prefix = 'ANY '`. So quorum mode always writes `ANY n (...)`. An empty set becomes `*`, which is then wrapped as `ANY 1 (*)`.
- In classic mode, one standby is written as the bare quoted name (`next(iter(sync))`). Two or more are written as `n (a,b)`, without the `FIRST` keyword. An empty set in strict mode is written as a bare `*`.
- The docs say only the leader and the standbys listed in the `/sync` key may be promoted, and `synchronous_node_count` defaults to 1 (https://patroni.readthedocs.io/en/latest/replication_modes.html).
- So a bare `"pg2"` can only come from classic mode. Changing the V2 test case to `ANY 1 (pg2)` was correct.

**Fairness.** By design, classic sync with `synchronous_node_count: 1` has one synchronous standby, and the second replica runs asynchronously. Requiring every replica to be named would score a correct, healthy cluster as "never redundant". That penalises PostgreSQL for how the feature is built, not for any real loss of redundancy. The new classic rule asks for one named synchronous standby, every other replica streaming with lag at or under 1 s, the slot present, and no pending restart. That is a realistic test and does not water down V2. Quorum mode keeps V2 unchanged.

**Recommended tightening (not a veto condition).** The classic branch currently accepts a bare `*`, which strict mode writes when no standby has been picked yet. It also accepts a name that is not one of the current replicas. With `*`, Patroni's `/sync` key lists no standby, so there is no node that can be promoted. If the rule accepts it, PostgreSQL could be counted as redundant up to one HA loop early, which favours PostgreSQL. Quorum mode has the same gap with `ANY 1 (*)`. The rule I would prefer:

> classic: the parsed names, excluding `*`, include at least one current non-writable replica; optionally, that replica's `/cluster` role is `sync_standby`. quorum: every replica named, `*` not accepted. All the other checks stay as they are.

The tests should add a case where `*` returns False in both modes.
