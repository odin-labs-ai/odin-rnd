# EXP 009 instrument: blind corpus, blind H2, real-filter baseline (bundle 3, WO-03 and WO-04)

These are build notes. Nothing here is a measured result, and nothing here has been run on a counted seed.

## WO-03: two blind authors

| Artifact | Author | Brief | Frozen digest (`FREEZE.json`) |
|---|---|---|---|
| `corpus/authored/`: 120 configs, `index.json`, and the author's `gen.mjs` and `verify.mjs` | author A, a history-free agent | `corpus/SPEC.md` only | `corpus` tree |
| `h2/authored/`: the plain registry, six hand-dispose components, and a self-test | author B, a separate history-free agent | `h2/SPEC.md` only | `h2` tree |

### How the authors were fenced

- Each author's whole prompt was a working directory and a pointer to its SPEC.md. The prompt carried no mission context, no kernel, no probe list and no paths into this repository.
- `fence/fence-audit.mjs` scanned each author's complete tool-call log for two things:
  - absolute paths outside its fence (author B was also allowed the OS temp directory);
  - forbidden terms in any read or command (its own written code excluded).
- The results are in `fence/author-a.json` and `fence/author-b.json`. Both read `FENCE-HELD`: one Read each (its own SPEC.md), 0 out-of-fence paths and 0 forbidden-term calls.
- Each log file records only counts, the pattern used and the transcript's sha256. No paths and no transcript text are published.

### How the labels are checked

`scripts/composable-corpus.test.mjs` does **not** trust author A's `verify.mjs`. It re-derives every `expectedAtBoot` and every `expected` from the spec rules with its own implementation, and checks that each label follows from `intended`. All 120 configs agree with it.

### Spec gap, disclosed

The spec says a withdrawn plugin acts "as if it had been removed", but it never named the status that plugin itself reports.

- Author A documented a reading at `verify.mjs` line 2: a withdrawn plugin is reported as `excluded` until it is restored.
- The independent oracle adopts that reading.
- It affects only the withdrawn provider's own row in `provider-withdrawn` and `withdraw/restore` configs. Their dependents' statuses, and every label, are the same under either reading.
- The spec bytes are frozen as written. When this corpus is mapped onto the kernel census, a withdrawn component is an unloaded one, so it is absent from the census rather than reported as `excluded`.

## WO-04: the real-filter baseline

The baseline runs odin-agent's extension filter and its proven-core floor **unchanged**, imported in place from two detached, read-only odin-suite worktrees:

| Pin | Commit | Role |
|---|---|---|
| pre | `d6431af9` | the parent of the 2026-09-28 commit that added the `q` trio to the floor |
| current | `2d522f50` | the plan's pinned origin/main |

- **What changes between the pins:** `extension-filter.ts` is byte-identical at both (sha256 in `baseline/SOURCE.json`). Only the floor differs: 25 entries before, 28 after.
- **What is published:** per-config outputs, the source sha256s and the commit ids. The private source is not vendored (founder D4). `scripts/composable-baseline.test.mjs` asserts that no file here is a copy of a private source file.
- **Name mapping:** synthetic floor slots map by position, in memory only (`baseline/driver.mjs`). `core-NN` maps to pre floor[NN-1]; `q`, `q-release` and `q-resume` map to the three entries the current floor appends. Real names never reach a file.
- **Dependencies:** the import chain needs `@odinlabs-ai/skill-contracts` at the version odin-agent pins (0.7.0), plus `tsx`. Both were installed into a sidecar directory outside every repository and symlinked as `odin-agent/node_modules`, which odin-suite's `.gitignore` covers. `git status` in both worktrees is empty before and after the run, and the runner refuses otherwise.
- **Byte identity:** a second run with `--check` reproduces `outputs.json`, `summary.json` and `SOURCE.json` byte for byte.

### What the baseline shows (descriptive, decides nothing)

- **Fidelity:** the filter keeps exactly the plugins the spec calls enabled at boot in 120 of 120 configs. The synthetic world therefore models the real filter's enable rule.
- **Signals:** the filter emits **no** diagnostic in any config: 0 of 60 faulty and 0 of 60 clean.
- **Historical case:** every `floor-epoch-drop` config reproduces it. On the pre-floor pin, `q` is dropped with no diagnostic.
- **Silent faults:**
  - In 44 faulty configs, an intended plugin is kept although it cannot work (an unmet or withdrawn need).
  - In 16, an intended plugin is removed.
  - Neither kind is signalled.

### Reproduce

```
node experiments/composable-harness/baseline/run-baseline.mjs \
  --suite-git <odin-suite clone> \
  --pre-wt <detached worktree at d6431af9> \
  --current-wt <detached worktree at 2d522f50> \
  --deps <dir with node_modules: @odinlabs-ai/skill-contracts@0.7.0, tsx@4.23.1> \
  --check
```

## Practice run 1: the H2 `outside.scratch` finding (2026-10-03)

The first windowed practice run (practice seed, practice pins `qwen3-0.6b-practice` / `llama-3.2-1b-practice`, not EXP 008's weights) reported S1 residue in 10 of 10 H2 trials, always and only on `outside.scratch`. That was a measurement artifact, not H2 residue.

- **What was there.** Every trial's scratch root held one empty directory, `torchinductor_<user>`. Nothing else: no spend-counter temp directory, no partial file.
- **Who made it.** The model server child, not H2's code. `import mlx_lm` (in `components/mlx_gate.py`) creates `$TMPDIR/torchinductor_<user>` on import and never removes it. Checked in isolation: importing `mlx.core` or `transformers` alone creates nothing; importing `mlx_lm` creates exactly that directory.
- **Why only H2 showed it.** `arms/h2.mjs` points this process's TMPDIR at the trial's scratch root, so that H2's own Node temp directories are observed. The model child and every R0 child spawned during the H2 arm inherited that TMPDIR. H1's kernel component runs the same `mlx_gate.py` with the ordinary TMPDIR, where the directory already exists and nothing observes it. The two arms were not observed alike.
- **The fix (glue only).** The model child H2 is handed (`h2Config`) and every R0 child (`r0Client`) now run with the TMPDIR in effect before the H2 arm starts: the one H1's child gets. H2's Node process still runs with TMPDIR in the scratch root, so a temp directory an H2 component leaves behind is still seen. `runH2` also applies O's warm-up rule before its first observation; it had relied on the earlier phases of the dry run to have warmed the process. Nothing under `h2/` and nothing in `probes/observation-set.json` changed.
- **Proof on the fake child.** `fixtures/fake-mlx.mjs` now creates a `fake-mlx-runtime-cache` directory in its TMPDIR on start, as the real child does. `scripts/composable-harness-arms.test.mjs` ("H2 and H1 are observed alike") runs one H2 trial that loads, uses, pin-swaps and unloads the model: no residue, an empty scratch root, and the runtime cache present in the ordinary TMPDIR. The negative control runs the same trial with the old wiring (child TMPDIR = scratch) and gets exactly `["outside.scratch"]`. A `--fake` dry run (3 trials) after the fix reports H2 residue in 0 of 3 trials.
- **Not fixed here, and deciding nothing.** H2 reported decision mismatches in 7 of 10 trials and `fetch failed` errors in 5. H2's registry never cascades, by design, so mismatches are expected (S1 reports them and they decide nothing). The errors also occur on the fake child under high load. They are H2's own behaviour and are left as measured.

## Limits

- The corpus is synthetic, written from a spec that the plan's author also wrote. The baseline's 120/120 agreement shows the spec matches the real filter's enable rule; it does not show that the fault classes are representative.
- The real filter has no notion of needs, so it cannot signal any of these faults. The baseline is the "no census" condition, not a competing census.
