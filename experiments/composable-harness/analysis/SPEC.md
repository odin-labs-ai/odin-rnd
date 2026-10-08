# EXP 009 analysis spec

This file describes what `analysis/analyse.mjs` computes. The code is the definition; this file states the same rules in prose for the pre-registration.

The analysis is pure: records in, one result record out.
- It reads no labels and calls no model.
- `scripts/composable-harness-analyse.test.mjs` covers every rule below with synthetic rows.

**Amendment rule:** both this file and `analyse.mjs` go into the prereg file map. Changing either after the prereg is an amendment, and it resets the not-before clock.

## P1: temporal equivalence (H1 against R0)

**Trial rows:** a trial row is `{ arm: 'H1', trial, divergences }`.

**What counts as a divergence.** A divergence is either of these:

- **Snapshot divergence:** after an operation, H1's inside-boundary projection differs from the projection of R0 for the same loaded set (`arms/run.mjs`, `projection`). The projection covers:
  - the kernel registry;
  - the mlx pin;
  - the cache-validity counts (keys carrying a stale pin);
  - the process-wide probes (listeners, timers, env, globals). Each of these is taken as a delta from its own process's baseline, which is recorded before any scheduled component loads.

  Cache **contents** are deliberately left out. A fresh process has not evaluated what a long-lived one has, so only a key from a stale pin counts.
- **Decision divergence:** after an evaluation, H1's decisions differ from R0's for the same (loaded set, item). Decisions are `lint` and `grep` as `REJECT`/`ACCEPT`, and `yesno` as `{ decision, p }` with p to 6 decimal places.

**Verdict.** Let n be the number of H1 trials and k the number of trials with at least one divergence.
- **refuted:** k > 0.
- **supported:** k = 0 and n ≥ 381. At that size, the 95% Wilson upper bound is ≤ 1%.
- **underpowered:** k = 0 and n < 381.

## P2: spatial soundness (the blind corpus)

### Running a config

`arms/p2.mjs` runs each config:
- Only **enabled** plugins are loaded, by the corpus spec's rule. A plugin's injects are its needs, sorted.
- A `withdraw` event unloads the plugin, and a `restore` event loads it again.
- The census is read after the last event.

### The census-to-corpus mapping: absent ⇔ excluded

The corpus spec reports a plugin as `excluded` when either:
- it is not enabled, or
- it has been withdrawn and not restored.

The kernel never loads the first kind and has unloaded the second. Either way the plugin is **absent** from the census.

`censusMap(census, registry)` therefore gives every registered name a status: its census status when the census lists it, and `excluded` when it does not. A census row for a name that the config does not register is an error.

This mapping is the one reading of the corpus spec's gap that lane A disclosed (`NOTES.md`, "Spec gap, disclosed"): a withdrawn plugin is reported as `excluded` until it is restored.

### Per-plugin and per-config outcome (`classifyKernel`)

| Kernel status | `expected` status | Outcome |
|---|---|---|
| equal to `expected` | (any) | correct |
| `active` | anything else | **silent-inert** |
| not `active` | `active` | **false-inactive** |
| any other mismatch (e.g. different missing keys) | | mislabelled |

The config's outcome is the worst plugin outcome, ranked silent-inert > false-inactive > mislabelled > correct.

### The baseline (`classifyBaseline`)

This reads a row of `baseline/outputs.json`, the real odin-agent extension filter run unchanged:

| Row | Outcome |
|---|---|
| clean, not signalled | correct |
| clean, signalled | false-inactive |
| faulty, signalled | correct |
| faulty, unsignalled, with `silentInert` | silent-inert |
| faulty, unsignalled, with only `silentDropped` | silent-dropped |

### Verdict

`p2Rows` joins the configs, the kernel census and the baseline by config id.

- **supported:** 0 silent-inert and 0 false-inactive kernel configs.
- **refuted:** any silent-inert or false-inactive kernel config.
- **mislabelled:** counted and reported. It does not by itself refute the claim, which is about silent inertness.

**Secondary (decides nothing):** an exact two-sided McNemar test on kernel-correct against baseline-correct per config. It is the binomial test on the discordant pairs (b, c).

### Disclosure

P2 has no seed and is deterministic. The pipeline was exercised on the real corpus during instrument development. The pre-registration must state that P2's outcome was therefore computable before registration, and that what P2 tests is the census mechanism against a blind-authored oracle, not an unknown future draw.

## Secondary results (decide nothing)

**S1: H2 residue.**
- Each H2 trial runs from an empty registry and is torn down by hand at the end.
- Its residue is every probe of O that differs from the observation taken before the trial, plus anything left in the H2 registry or on its event bus.
- S1 reports the share of H2 trials with residue against the 10% line.
- H2's decision mismatches against R0 are reported beside S1 and decide nothing. H2's registry never cascades, by design, so mismatches are expected.
- **Observed alike.** H2's own Node process runs with TMPDIR inside the trial's scratch root, so its components' temp files are observed. The model server child and the R0 children are harness code, shared with H1, and run with the same TMPDIR H1's child gets. Otherwise the model runtime's own first-use cache directory (`import mlx_lm` creates `$TMPDIR/torchinductor_<user>`) counts as H2 residue, an artifact H1 is never exposed to. Practice run 1 showed exactly that in 10 of 10 trials before the wiring was fixed (`NOTES.md`).

**S2: teeth.** K1 planted leaks detected (out of 12), and K2 residue probes.

**S3: time to ready.** The medians for H1 and R0. Samples taken during a window breach are excluded and counted.

## Validity gates

If any gate fails, the record is uninformative: every claim's verdict becomes `uninformative`, never a pass. A gate whose record is missing fails (fail closed).

| Gate | Passes when |
|---|---|
| k1-teeth | K1 detects ≥ 11 of its 12 planted leaks. |
| r0-rerun | The seeded 10% R0 re-run is byte-identical. |
| r0-restart | R0 is self-equivalent across a restart. |
| pins | The pins verify, and the kernel sha is in the prereg file map. |
| leases | Every measured block held a window lease. |
