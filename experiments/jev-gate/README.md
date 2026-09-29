# EXP 005 — Jev as a fast gate: corpus and ground truth

This directory holds the inputs of EXP 005. The corpus, the ground-truth labels and the gate inputs
are fixed and hashed here before any gate (Jev, Laya or an LLM reviewer) sees them. Nothing in this
directory calls a model or a network API.

The question EXP 005 asks: given only a unified diff and a plain-language statement of the
architecture rules, can a fast typed-decision model tell whether the change breaks a rule? The
ground truth is not a human judgement. It is the released blueprint engine
([bce-engine](https://www.npmjs.com/package/bce-engine) 0.3.1) run on the real tree after the
change.

## bce contract

`bce-contract.mjs` pins how one tree is scored:

1. The tree is copied into a fresh temporary directory. If there is a patch, `git apply --check`
   and then `git apply` run on it. The directory becomes a git repository with exactly one commit,
   made under a fixed identity and a fixed date, so the same tree always gets the same commit sha.
2. The engine runs as
   `node node_modules/bce-engine/dist/cli.js run --blueprint <bp> --ct-repo <dir> --extractor ast --out <json>`.
   The `ast` extractor is pinned.
3. The exit code and the JSON report must agree. Exit 0 with verdict `pass`, score 100 and no
   violations is **GREEN**. Exit 1 with verdict `fail`, a score below 100 and at least one violation
   is **RED**. Any other combination throws; it is never recoded into a label. The installed engine
   version must be exactly 0.3.1.

`controls/` holds a GREEN tree and a RED tree with their own one-rule blueprint. Run both on demand:

```sh
node experiments/jev-gate/bce-contract.mjs
# green control: exit 0, verdict pass, score 100, 0 violation(s)
# red control: exit 1, verdict fail, score 60, 1 violation(s) [control-domain-no-app]
```

`scripts/jev-gate-bce.test.mjs` runs both controls and feeds forged reports to prove that every
disagreement between the exit code and the report throws.

## Base codebase, blueprint and rules

`base/` is a small layered TypeScript service (orders, customers, invoices): `src/domain`,
`src/app` (use cases and ports), `src/infra` (Postgres repositories, SMTP mailer, HTTP routes,
with `src/infra/index.ts` as the one public surface), `src/config` and `src/main.ts` as the
composition root. `test/` sits outside `src/` and is not governed.

`blueprint.json` uses the `typescript-module-graph` extraction over `src/**/*.ts`. `rules.txt` states
the same rules in plain language, one per line, with no rule ids. It is the rules part of every gate
input. Line 1 of `rules.txt` defines the scope and what counts as an import; each later line maps to
blueprint constraints as follows (the table is checked by `scripts/jev-gate-blueprint.test.mjs`):

| Line | Rule in rules.txt | Blueprint constraint(s) |
|---|---|---|
| 2 | Files in src/domain must not import anything from src/app. | `domain-no-app` |
| 3 | Files in src/domain must not import anything from src/infra. | `domain-no-infra` |
| 4 | Files in src/domain must not import anything from src/config. | `domain-no-config` |
| 5 | Files in src/domain and src/app must not import the pg package. | `core-no-pg` |
| 6 | Files in src/app may use infrastructure only through src/infra/index.ts; they must not import any file in a folder inside src/infra. | `app-no-infra-internals` |
| 7 | Files in src/domain, src/app and src/infra must not contain process.env anywhere, comments included. | `env-not-in-domain`, `env-not-in-app`, `env-not-in-infra` |
| 8 | In src/config, process.env.NAME is allowed only for these names: PORT, DATABASE_URL, LOG_LEVEL, SMTP_HOST, SMTP_FROM, INVOICE_PREFIX. Anywhere in a src/config file, comments included, process.env.NAME with any other name and process.env[...] are not allowed; other forms, such as destructuring or process.env?.NAME, are not covered. | `config-env-allowlist` |

The five `forbiddenDependency` constraints read the AST import graph (direct edges only, including
`import type`, `export ... from` and string-literal `import()`; an import whose target cannot be
resolved fails the boundary closed). The four `forbiddenPattern` constraints are per-line content
matches, so they also match comments. `rules.txt` words lines 7 and 8 to say exactly that
("comments included"). Line 8 also names the forms bce does not see (destructuring,
`process.env?.NAME`), and line 7 does not govern `src/main.ts`, because bce does not. Each wording
was probed with bce on base plus one line; no corpus item sits on those boundaries.

### Teeth and probes (WO-02 T-4)

`node experiments/jev-gate/teeth.mjs` scores the base (GREEN, score 100) and one hand mutation per
constraint. Each mutation turns the tree RED on its own constraint and on no other one. The result is
recorded in `teeth-report.json`, and the blueprint test reproduces it.

The same script probes the two drift families the plan marked as risky, before the corpus spec was
fixed:

| Probe | bce | Consequence for the corpus spec |
|---|---|---|
| a domain file adds `export { … } from '../infra/…'` | RED (`domain-no-infra`) | kept, as the family "re-export from a governed file" |
| a domain file adds `export * from '../infra/…'` | RED (`domain-no-infra`) | kept, same family |
| a domain file imports a new ungoverned barrel `src/shared/index.ts` that re-exports infra | GREEN | **removed**: bce reads direct edges only and cannot see a transitive re-export. The plain-language rules do not forbid it either |
| app imports `src/infra/index.ts`, which now re-exports an `infra/db` internal | GREEN | not drift under the rules (the index is the sanctioned surface); not used as a drift family |
| a domain file adds a string-literal `import('../infra/…')` | RED (`domain-no-infra`) | kept, as the family "dynamic import" |
| a domain file adds a computed `` import(`../infra/${name}`) `` | RED (4 domain constraints, unresolved import) | kept, same family |

So the "transitive via re-export" family of the original plan is narrowed to a re-export written
in a governed file, and the transitive variant is recorded as removed.

## Corpus (WO-03)

`corpus-spec.json` fixed the category quotas before any patch was written, in its own commit. It
also records the removed family and the size cap. Its `amendments` list records, with dates and
reasons, what changed after the WO-07 review: the quotas did not change, the families' descriptions
were widened (see "Review round 1 → fixes"). The corpus has 60 patches, `corpus/c001.patch` to
`corpus/c060.patch`:

| Family | Author intent | Quota | bce RED | bce GREEN |
|---|---|---:|---:|---:|
| reverse-layer-import (domain imports app or config) | drift | 6 | 6 | 0 |
| infra-leak (domain imports infra or pg; app imports pg or an infra subfolder) | drift | 5 | 5 | 0 |
| forbidden-config-key (unlisted env name or `process.env[...]` in config; `process.env` outside config) | drift | 9 | 9 | 0 |
| reexport-from-governed-file (`export … from` a forbidden module) | drift | 5 | 5 | 0 |
| dynamic-import (literal or computed `import()`) | drift | 5 | 5 | 0 |
| feature-add | clean | 8 | 0 | 8 |
| refactor-rename | clean | 6 | 0 | 6 |
| allowed-import-near-forbidden (near-miss) | clean | 7 | 0 | 7 |
| test-only-change (near-miss) | clean | 4 | 0 | 4 |
| comment-or-doc-mention (near-miss) | clean | 5 | 0 | 5 |
| **Total** | | **60** | **30** | **30** |

16 of the 30 clean items (more than a third) are near-misses. Every blueprint constraint is the
intended target of at least 2 drift items (domain-no-app 5, domain-no-infra 5, core-no-pg 4,
domain-no-config 4, app-no-infra-internals 3, config-env-allowlist 3, and 2 each for the three
env-not-in rules).

Rule keywords do not give the label away. Near-misses use them where the rules allow them (pg in
`src/infra/db`, `src/app` importing `src/config` or `../infra/index`, infra importing app and
config, `src/main.ts` loading an infra internal with `import()`, a `src/jobs` file importing infra
internals, allowlisted `process.env` reads), and five RED items carry no keyword on an added code
line (`process.env` in a comment in `src/domain`, `src/app`, `src/infra` and `src/config`, and
`import pg from "pg"` in double quotes).

`author-corpus.mjs` is the authoring source. Each item is a list of edits to `base/`; the script
turns it into a `git diff` with rename detection and 3 lines of context. Ids are neutral: a seeded
shuffle (seed 5005) assigns `c001…c060`, so the id order does not follow the families. The
author's intent (family, intended label, target rule) is in `manifest.json`. Neither file is a gate
input. `node experiments/jev-gate/author-corpus.mjs --check` regenerates every patch byte for byte.

## Ground-truth labels (WO-04)

`node experiments/jev-gate/label.mjs` applies each patch to a fresh copy of `base/`, commits it in
a fresh repository and scores it with the contract above. `labels.json` records, per item, bce's
label (RED/GREEN), score, violated rules and violation locations, next to the author's intended
label. **bce's label is the truth.** An item whose intended label differs from bce's is flagged
`disagree: true`. It stays in the corpus unchanged, is excluded from the primary metrics, and is
reported as a sensitivity analysis. A bce crash would be recorded as `EXCLUDED` with its reason.

Result: 30 RED, 30 GREEN, 0 excluded, **0 disagreements** between intent and bce. Two runs are
byte-identical (`node experiments/jev-gate/label.mjs --check`).

At the rule level, one item differs from what its author targeted, although its label agrees:

| Item | Intended | bce |
|---|---|---|
| c006 (computed `` import(`../infra/db/${kind}-repository`) `` in `src/domain`) | RED on `domain-no-infra` | RED on `core-no-pg`, `domain-no-app`, `domain-no-config`, `domain-no-infra`: an unresolved import fails every domain boundary closed |

`corpus.sha256` pins everything the labels depend on, one `<sha256>  <path>` line per file:
`base/`, `corpus/`, `blueprint.json`, `rules.txt`, `gate-question.json`, `corpus-spec.json`,
`manifest.json` and `labels.json`. Check it with `shasum -a 256 -c corpus.sha256` from this
directory. The sha256 of `corpus.sha256` itself is the corpus hash:

```text
corpus   a83b222a1a4a64cc81ac755c827a47009baa2bb91b036e351e71422cc8d526a9  (sha256 of corpus.sha256)
inputs   6bfb2b8d52376cbd22c8a34f5f986fe67ad68a0c587da862ba6b56e77e966a34  (sha256 of inputs.json)
```

## Leakage lint and tests (WO-05)

`lint.mjs` checks every gate-facing text: the patches, `rules.txt`, the question, and each built
state. It refuses:

- a family name from `corpus-spec.json` as a whole word anywhere, hyphenated or spaced;
- a blueprint rule id as a whole word anywhere;
- a label word (`drift`, `clean`, `violation`, `red`, `green`, …) as a whole token in a path, a
  patch file name or a hunk header. Tokens split on non-alphanumerics, so ordinary code such as
  `cleanup()` passes;
- a private path, an email address or a credential-shaped string.

The Node tests run in `pnpm test`:

| Test file | What it proves |
|---|---|
| `scripts/jev-gate-bce.test.mjs` | the pinned engine version and extractor; GREEN and RED controls; forged reports throw |
| `scripts/jev-gate-blueprint.test.mjs` | `bce validate`; the rules.txt ↔ constraint table above; base GREEN; one discriminating RED per rule; the probe results |
| `scripts/jev-gate-corpus.test.mjs` | quotas; neutral contiguous ids; `git apply --check` for every patch; byte-for-byte regeneration; label consistency; a 5-item bce spot-check; `corpus.sha256` recomputed; the lint on the corpus and its planted negative controls (both a family name in code and label words in a path, id and hunk header; `cleanup()` passes); no private paths, emails or credentials in this directory; runtime under 60 s |
| `scripts/jev-gate-baselines.test.mjs` | both baselines are deterministic, read only the gate view, and reproduce `baselines.json` with their script sha256 |
| `scripts/jev-gate-inputs.test.mjs` | `inputs.sha256`; the verbatim question; the state construction; no label fields in the inputs; the pre-cut counts; the negative control; with the tokenizer installed, a byte-for-byte rebuild |

CI re-runs bce on 5 items rather than all 60, to stay inside the publish time budget. The full
re-label is `node experiments/jev-gate/label.mjs --check`.

## Gate inputs (WO-06)

Every gate gets the same input:

```text
state    = rules.txt + "\n\n" + <the unified diff>
question = gate-question.json   {"type": "noul", "instructions": "Does this change break any of these rules?"}
```

The question is stored once, verbatim, and `inputs.json` refers to it by sha256. `inputs.json`
holds, for each item, the state, its sha256, the patch sha256, and its Laya token counts. It holds
no labels. `inputs.sha256` pins it.

**Truncation is ruled out, not only flagged.** Laya's `build_sequence`
(`../laya-vs-jev/laya_inputs.py`) always cuts its input to fit, so checking its output would prove
nothing. `laya_count.py` runs Laya's real tokenizer (the pinned files of the EXP 004 recording,
sha256-checked) and measures every part **before** the cut. It refuses an input when any of these
holds:

- an option is longer than 48 tokens;
- the options budget is under 16;
- the question head is over its budget, or over `head_max_len` 256;
- the state is longer than the room left under `max_len` 1024.

For inputs that fit, it also checks that `build_sequence` returns exactly the uncut sequence. This
is the same refuse-if-it-does-not-fit rule that `../laya-vs-jev/run.py` applies to options. Every
build also runs a planted too-long input, which must be refused, or the build fails.

| Measure | Value | Limit |
|---|---:|---:|
| question head tokens | 13 | budget 238 (≤ 256) |
| option tokens (false / true) | 9 / 7 | 48 each |
| room for the state | 989 | max_len 1024 minus the prefix |
| rules.txt alone | 256 | |
| largest state (c047) | 923 | 989 |
| median state | 474 | |
| largest full sequence | 958 | 1024 |
| truncated inputs | 0 of 60 | 0 |
| planted negative control | 3,100 tokens, refused | |

State sizes by bce label: RED 361–658 tokens (median 465), GREEN 372–923 (median 475.5). The
largest items are a clean refactor (c047) and a clean feature (c020); size is not a strong cue for the label.

## Comparison baselines

Two deterministic, model-free baselines are registered before any gate runs. Each reads only
`inputs.json`, the exact state a gate sees, never the labels or the manifest.
`experiments/jev-gate/baselines.mjs` scores them against `labels.json` (disagree and excluded items
left out) and records each result in `baselines.json`, next to the sha256 of the script and of the
library and the sha256 of the inputs and labels it was scored on. A gate result is reported next to
these two numbers, not on its own.

| Baseline | What it does | Accuracy | Missed RED | False reject |
|---|---|---:|---:|---:|
| (a) `scripts/jev-gate-heuristic-grep.mjs` | the WO-07 reviewer's keyword grep (`heur.py` H1c), ported as is: RED when an added non-comment line under `src/` contains `process.env`, `'pg'`, `../infra`, `../app`, `../config` or `import(` | 0.70 (42/60) | 5 | 13 |
| (b) `scripts/jev-gate-heuristic-lint.mjs` | a line-regex linter written from `rules.txt`: resolves relative specifiers against the file path, checks `process.env` in comments too, skips comments for imports only | 0.9833 (59/60) | 0 | 1 (c001: a trailing comment that reads `from 'pg'`) |

The linter scores high, and that is the honest result: the rules are mechanical, so a 25-line linter
that knows them nearly solves the corpus. It is the bar a gate has to meet. The grep is the bar for
"reads the keywords, not the rules".

## Review round 1 → fixes

The independent WO-07 review of the first corpus (sha256 of `corpus.sha256`
`fcf7d61b…0a7e47`) returned FIX-NEEDED. The founder's decision (2026-09-26) was to harden the leaky
items and to publish the simple heuristics as pre-registered baselines. Each finding and what changed:

| Finding | What changed |
|---|---|
| F1 (blocking): the keyword grep scored 0.92 with 0 missed RED | Near-misses were re-authored so allowed code uses the rule keywords, and five RED items break a rule with no keyword on an added code line (see "Corpus"). The same grep now scores 0.70 and misses 5 RED items (c009, c021, c024, c026, c041). Both the grep and a regex linter are committed as baselines (above). |
| F2: six RED patches looked wrong whatever the rules say | Rewritten as working features: c028 moves the payment term into a constant in the use case and uses it as the domain default; c040 adds a credit-limit check that takes the app's `CustomerRepository`; c046 builds an invoice reference from settings loaded with `import()`; c052 exports invoices as CSV through a lazily loaded `src/infra/files/csv.ts`; c045 checks whether an invoice exists with a `pg.Client` it queries and closes; c023 adds a database health check that uses `createPool`. |
| F3: EXP 004 bias | No separate change. EXP 004 had no code rows; the risk was that F1 rewarded surface tokens. With F1 fixed, surface tokens are wrong 18 times out of 60 (baseline a). |
| F4: c006 reddens 4 rules | No change: the label is right under `rules.txt`. Any per-rule analysis excludes c006 or says it includes it; the accept/reject metric uses it as is. |
| F5: `rules.txt` and bce disagreed on three edge cases | Lines 7 and 8 reworded (see "Base codebase, blueprint and rules"). Probed with bce 0.3.1: `process.env.HOME` in `src/main.ts` GREEN; `export const { STRIPE_SECRET_KEY } = process.env` in config GREEN; `process.env?.STRIPE_SECRET_KEY` in config GREEN; a config comment naming `process.env.NODE_ENV` RED; a config comment naming `process.env.PORT` GREEN; a domain comment containing `process.env` RED. No item sits on the first three. |
| F6: inputs leakage | Clean in round 1; unchanged. The inputs test still refuses any label field and lints every state. |
| F7: quotas | Unchanged: 60 items, 30/30, 16 near-misses, every rule targeted at least twice. `corpus-spec.json` records two dated amendments: widened family descriptions, and the new `rules.txt` size (256 tokens, still inside the room). |
| F8: zero disagreements | Still zero after re-labelling. The new boundary items (comments containing `process.env`, `"pg"`, `../infra/index`, `src/jobs`) agree with the author because `rules.txt` now words each boundary; they are contested by the baselines instead (18 grep errors, 1 linter error). |

## Review round 2 → pre-registered analysis notes

The second WO-07 review (corpus sha256 `a83b222a…`) returned SHIP. Its five non-blocking findings are
recorded here and in `preregistration.json` before any gate runs. None of them changes a patch, a label
or `rules.txt`, so the corpus hash stays `a83b222a…`.

- **R2-1, comment-only RED items.** Four of the 30 RED items are RED only because a comment names
  `process.env` in a governed layer or an unlisted variable in config: c009, c021, c026, c041. They are
  fair under `rules.txt` (lines 7 and 8 cover comments), but they are not architectural drift in the
  usual sense, and 4 of 30 is more than the 10% missed-drift threshold on its own. The primary metric
  is unchanged. Beside it, missed drift is reported split into the 26 code-level RED items and the 4
  comment-only ones. For each `env-not-in-*` rule, one of its two target items is a comment, so
  per-rule results for those rules are half comment artefacts. The grep baseline's 5 misses are these
  4 comment-only items plus c024 (R2-4); a grep that kept comments would miss none.
- **R2-2, criterion 4 stated plainly** (founder, 2026-09-26: "Keep it, state it plainly"). The better
  model-free baseline is the linter, and it misses 0 of the 30 RED items. So criterion 4 says: Jev
  must miss 0 of 30 RED items, abstentions included, because the better baseline misses 0. This tests
  whether Jev applies mechanical rules as well as a linter, not rules a linter cannot express. bce's
  ground truth is regex-shaped by construction, so a refutation on criterion 4 alone does not
  generalise to rules that are not mechanical; testing that needs a follow-on corpus.
- **R2-3, `rules.txt` line 6 boundary.** See Limits. `rules.txt` is not reworded, because that would
  move the corpus hash with no label change.
- **R2-4, c024.** Its `"pg"` import is the only double-quoted import in the corpus. It was written
  that way on purpose, to dodge the keyword grep, which looks for `'pg'`. The label (RED on
  `core-no-pg`) is unaffected, because bce reads the import, not its quotes.
- **R2-5, reviewer isolation.** `preregistration.json` pins it: the LLM reviewer runs in a scratch git
  repository that holds only the base app at the base commit, `rules.txt`, the files `nina compose`
  writes, and the change applied on top. No odin-rnd checkout, `labels.json`, `manifest.json`,
  `baselines.json` or corpus file is reachable; its working directory and tools are limited to that
  repository. The reviewer still has repository access where Jev and Laya see only the diff, and that
  asymmetry is disclosed as a limit.

## Reproduce

Node 22 and the frozen lockfile (`pnpm install --frozen-lockfile`), from the repository root:

```sh
node experiments/jev-gate/bce-contract.mjs          # GREEN and RED controls
node experiments/jev-gate/teeth.mjs                 # base, teeth and probes -> teeth-report.json
node experiments/jev-gate/author-corpus.mjs --check # patches regenerate byte for byte
node experiments/jev-gate/label.mjs --check         # full bce re-label, byte for byte
node scripts/jev-gate-heuristic-grep.mjs --check    # baseline (a), recorded in baselines.json
node scripts/jev-gate-heuristic-lint.mjs --check    # baseline (b), recorded in baselines.json
pnpm test
```

Rebuilding `inputs.json` needs Laya's tokenizer (no model is loaded or run). Fetch the pinned Laya
files once as in `../laya-vs-jev/README.md` ("Reproduce"); they land in `~/.cache/odin-rnd/laya`.
Then install only the tokenizer dependencies, at the versions pinned in
`../laya-vs-jev/requirements.txt`:

```sh
cd experiments/jev-gate
uv venv -p 3.12 .venv
VIRTUAL_ENV=$PWD/.venv uv pip install tokenizers==0.23.2 numpy==2.5.3
cd ../..
node experiments/jev-gate/gate-input.mjs --check
```

`LAYA_TOKENIZER_PYTHON` and `LAYA_CACHE` override the interpreter and the cache location. Without
the tokenizer, the inputs test checks the recorded counts and skips only the rebuild.

## Gate runners and results (bundle 3)

Every runner first runs `runner-guard.mjs --check`, which refuses unless:
- `preregistration.json` is the published file (sha `30bdcf07…`, hard-coded);
- `amendment-01.json`, and for a counted run `amendment-02.json`, are the published amendments;
- every file either record pins still matches its hash, and the runner and results code matches `runners.sha256`;
- the not-before time has passed — amendment 01's (`2026-09-28T12:01:15Z`) for a practice run, amendment 02's
  (`2026-09-28T18:36:49Z`) for a counted run.

The two amendment shas and their not-before times are constants in `runner-guard.mjs`, frozen by the freeze
commit after each amendment merged; they were `null`, and every runner refused, until then. All four are now set.

The answer-key pre-flight scans the temp roots the operator can read for a byte-for-byte copy of an answer file,
records the root-owned roots it skips (covered by the reviewer sandbox's denyRead), and refuses on any copy, a
real scan error, or no scannable root. It is done **once, before the run, not per runner**: the fleet's temp had
grown so large that a per-runner scan took over an hour, past the runner's timeout, so a counted run could never
start (bundle 4). Instead the operator runs `runner-guard.mjs --preflight --mode counted --write-record <path>`
once — the full scan, no timeout — which writes a **self-hashed** pre-flight **record** (ok, the roots scanned and
skipped, copies, vanished, permissionSkipped, durationMs, startedAt/endedAt, the `runners.sha256` value, the git
HEAD, and its own sha256 over all of the above). The self-hash is an integrity and freshness check against
mistakes, **not a signature**: the operator is trusted, and the reviewer runs in a sandbox that can neither reach
outside its workspace nor read the temp roots, so a hand-forged record is outside the threat model. The record's
paths are scrubbed (the per-user temp dir to `<tmp>`, home to `~`) so it can be committed with the results.

Each counted runner then **requires** that record (`--preflight-record <path>`) and, at RUN time, refuses unless it
is a counted `answer-key-preflight`, `ok` is true with an **empty copies list**, no override was used, its scrubbed
roots equal the current default set, its `runners.sha256` and HEAD equal the current ones, and its `endedAt` is
after amendment 02's not-before and within **2 h** of the run. Each runner then stamps its run-time HEAD, the
scanned roots, and the record's sha and endedAt into its own run record, and the record itself is **committed with
the results**. `computeResults` re-checks the committed record against **what the run recorded** — its self-hash,
kind/mode/ok/no-override/empty-copies, its `runners.sha256` against the run's own code pins, its HEAD and roots
against the run's stamps, and `endedAt` within 2 h before that gate's first call — and never against the scorer's
live git HEAD, temp roots or a path on disk. That is what lets a committed run be re-scored after later commits, in
a fresh checkout and under any `TMPDIR` (refute r5). A **practice** run still scans inline
(`JEV_GATE_PREFLIGHT_ROOTS` may override its roots; refused in counted). The scan is never part of `--check`, so
`--check` stays fast.

The pre-flight is a scan **at one instant, before the run**: neither a copy created *during* the run nor one
stranded in the **up-to-2 h gap between the scan and the run's first call** (for example by a `pnpm test`
interrupted with SIGKILL after the record was written) is caught by it — the reviewer sandbox's denyRead of the
temp roots is the boundary for those (that was true of the per-loop scan too), and the 2 h window keeps that gap
short. On this machine the counted scan walks a busy `/private/tmp` and the per-user temp dir and can take **tens
of minutes** (about 10–15 min at load 14–39, longer as the fleet's temp grows); with no timeout on the one
record-writing scan, it always completes. A practice scan over the **default** roots would hit that same size and
so exceed `run_gates.py`'s 600 s practice ceiling; a practice run therefore uses the recorded
`JEV_GATE_PREFLIGHT_ROOTS` override at a small clean directory, which scans well inside the ceiling.

| File | What it runs |
|---|---|
| `run_gates.py --gate jev\|laya` | Jev and Laya. It imports the EXP 004 call and MLX code (`../laya-vs-jev/run.py`, `laya_mlx.py`, `laya_inputs.py`) and `laya_count.py`, and asserts that their pins equal the pre-registered ones. It keeps Jev's `Date` header, never the key or any other header. An input that would be cut is refused, never cut. |
| `run_reviewer.mjs` | nina 0.34.0's reviewer, k runs per change. It follows the REVISION-5.3 order: the base app, then nina extracted from the pinned tarball (integrity checked), `init`/`compose` with the amendment's argv, `.gitignore`, `rules.txt`, one `base` commit under the pinned identity (its sha asserted against the amendment), then the change applied and left uncommitted. After that it runs `claude -p` with the pre-registered flags, billing keys stripped as `nina eval` strips them. `--probe isolation` runs the canary probe. |
| `results.mjs` | The run-record schema, every pre-registered metric (Wilson and paired Newcombe through `metrics.mjs`), the five criteria, and the spotlight verdict, whose thresholds are read from the amendment. `assertPublishable` refuses any record carrying the FIXTURE banner. |

The runners share the spend ledger, `spend-ledger.jsonl`, one line per paid call, and its stop rule; a counted
run appends to that committed ledger, never a fresh file, so its cap continues from the recorded total. The
reviewer runner also applies the hang-stop, and a counted run covers the whole corpus in one invocation so its
counters span the whole run. Both write their record after every call, with `partial` set to `in-progress` until
the loop finishes and `null` only then; `results.mjs` also treats a run that does not cover the corpus (the
reviewer: exactly k runs per item) as partial, so a crash or a truncated run gives no criterion a state.

`fixtures/` holds a FIXTURE amendment and FIXTURE pins, used by tests only; `--pins` switches them on
and marks everything written with the FIXTURE banner. It also holds a fake `claude`
(`fixtures/fake-claude.mjs`) and the committed outputs of each runner against fakes
(`fixtures/gate-runs/`). A fixture run refuses unless `claude` on PATH resolves to that fake, and a
counted run refuses if it does. This rule exists because a fake that was not executable once let a
smoke run fall through to the real client (mission ledger, 2026-09-28).

```sh
pnpm test                                                    # schema, metrics, guard, reviewer runner (fake claude)
experiments/jev-gate/.venv/bin/python -m unittest experiments/jev-gate/test_run_gates.py   # fake Jev server, fake Laya model
```

The fakes prove the mechanics: staging, the pinned argv, parsing, failure classes, the spend and
hang stops, and the fact that the tool restriction is passed and recorded. Only a live run can prove:
- that Claude Code denies WebFetch, non-git Bash, and reads outside the repository under these flags (the isolation probe);
- what the hooks do inside a real run;
- that the MLX port answers these inputs.

## Dry run (bundle 3 WO-04), 28–29 Sep 2026

Amendment 02 (the reviewer fence) merged on odin-rnd main at 2026-09-28T18:36:49Z (#14). The runner constants
are frozen to it, so a counted gate run now passes the guard. The dry run ran on practice rows only, in practice
mode. `practice/practice-rows.json` holds three rows, p01 to p03, written by `practice/author-practice.mjs`;
they are not in the corpus, not hashed into it, and never scored. No corpus id appears in any dry-run record, and
every record validates against the run schema with `fixture: false` and carries the code hashes of the runner
that made it.

**Which runner made which record.** The dry-run records were re-made on the committed runner as the refute rounds
corrected the code:
- `dry-run/postmerge-matrix.json` — the post-merge isolation matrix probe, `run_reviewer.mjs 0e568a1e…`.
- `dry-run/jev-practice-frozen.json`, `dry-run/laya-practice-frozen.json` — Jev and Laya on the practice rows,
  `run_gates.py 7fc9e702…`. Amendment 02's pinned `dry-run/jev-practice.json` and `laya-practice.json` (the
  12:13Z records, made by an earlier `run_gates.py` before amendment 02) are left byte-for-byte unchanged.
- `dry-run/reviewer-practice.json` — the k=3 reviewer practice run, made during freeze-2 on the freeze commit's
  `run_reviewer.mjs 8232fcc…`; a practice record (never scored), left as made.

The bundle-3 refute round 2 (`d24a6b4`) re-pinned the runners again (the reviewer's `amendment02Sha256` field, the
pre-flight, the rehearsal mode) under a `$0`, no-paid-call constraint, so these dry-run records were **not** re-run:
their `code` hashes are from the previous commit, and the round-2 changes do not alter what a Jev, Laya or isolation
matrix run measures (the reviewer command, fence settings and gate calls are unchanged).

**Post-merge isolation matrix probe (pinned in amendment 02's not-before), practice mode.** The full v5 matrix
(R1–R31 with R8B, R8C, R19B; controls C1–C8) has run several times as the runner was corrected, and every run
passed: all 33 escape rows held, all 8 controls worked, no canary leaked, nina client `2.1.280` pinned. The
published record is the fix round's single run (`0e568a1e`, $0.4592440), which overwrote freeze-2's third at the
same output path. The overwritten runs are freeze-2's three (`8232fcc` $0.3872224, `e1e8d735` $0.4260008,
`a3e40f0b` $0.3607016); their ledger lines remain as evidence, and each passed.

| Gate | Practice rows | Result | Cost |
|---|---|---|---|
| Jev (`jev-1.13.0` served) | p01, p02, p03 | ACCEPT (p 0.04), REJECT (0.97), REJECT (0.99); Date header kept, none excluded | $0.00016 per call |
| Laya (MLX) | p01, p02, p03 | ACCEPT on all three (confidence 0.59–0.63); local | none |
| nina reviewer (0.34.0, fence5, k=3) | p01, p02, p03 | p01 ACCEPT ×3, p02 REJECT ×3, p03 REJECT ×3; 0 harness failures; every change's 3 runs agree | mean $0.2062, max $0.2513 per run |

These are practice rows written for this dry run; they exercise the runners end to end, not any gate's accuracy.
The fix round made three Jev practice runs (nine ledger lines, about $0.00144); only the last (`jev-practice-frozen.json`)
survives. The first was overwritten because its record held an unscrubbed per-user temp path — which is why
`run_gates.py` now scrubs its records — and the second was overwritten by the re-run after that scrub was re-pinned.

**Spend and projection.** The spend total is what a counted run's guard computes: amendment 02's alreadySpentUsd
($5.5808946) plus the raw `costUsd` of every ledger line after its merge, summed at full precision and rounded
once, at the end, to 7 dp — **$9.0720692**. (Rounding once at the end is the rule. The amendment-01 path — its own
already-rounded baseline plus the earlier lines — lands one unit lower at the 7th decimal because amendment 02
folded three 9-dp Jev costs into its figure; the guard uses the amendment-02 figure.) The reviewer's spend
reserve is `max(largest reviewer call, alreadySpentUsd)` = $5.5808946, so the cap trips once spend passes about
**$94.42** — conservative, but literal to the pre-registration, which was written when that figure was cents.

The full measured run (bundle 4, 60 corpus changes) projects from the dry run's per-call costs:
- Jev: 60 × $0.00016 = $0.01. Laya: $0.
- The reviewer: 180 runs (60 × k=3) at the dry run's mean $0.2062 (max $0.2513) → $37.1 (max $45.2), plus one
  pre-run isolation matrix probe (about $0.4).
- **Projected full run: about $37.6 at the mean, $45.7 at the largest**, or about **$47–55 including spend so
  far** — under the $100 cap. A counted run appends to the committed `spend-ledger.jsonl`, so its cap continues
  from this total, not a fresh file at $5.58.

**Answer-key pre-flight.** The pre-flight scans only the temp roots the operator can read (the user's own T dir,
`/private/tmp`, the var/tmp roots) and records the root-owned `var/folders` buckets it cannot read as skipped —
they are covered by the reviewer sandbox's denyRead, so a counted run no longer fails closed on them. It looks for
the answer files **under their own names** (`labels.json`, `manifest.json`, `corpus.sha256`, `inputs.json`,
`baselines.json`), matching name and size in one `find` pass (the name test comes before `-type f`, so it stats
only the handful of files named like an answer file, not the whole tree) and confirming each candidate by sha256.
A copy saved under a **different** name is **not** detected here; that case rests on Layer 2, the reviewer
sandbox's denyRead of the temp roots (see Limits). The walk prunes `node_modules`, `.git` and, to skip the bulk
of the Claude session-scratch tool-output, `find -path '*/claude-*/*/tasks'`. Because `*` also spans `/` in
`find -path`, this prunes **any** directory named `tasks` that lies below a `claude-*` path component, not only the
tool-output dirs — so a repository's own `tasks/` **is** pruned when the checkout sits under a `claude-*` temp dir
(an agent clone in the session-scratch). That over-prune is harmless here: the answer files live under
`experiments/jev-gate/`, never in a `tasks/` dir, so pruning `tasks/` cannot hide an answer-file copy under its own
name. A file that vanishes mid-scan (another process deleting a temp entry, `ENOENT`) and an
unreadable subtree strictly inside a scanned root are benign — counted as `vanished` / `permissionSkipped` in the
record, not a scan failure. But a scan that did **not finish** — `find` killed by a signal, a non-zero exit with
no benign line to explain it, an `fts_*` traversal abort, or an error about a scanned root itself — fails closed
and refuses, so an unfinished scan is never mistaken for a clean one. The scan's duration is recorded. It refuses
while any answer-file copy is found, or when no root is scannable. `JEV_GATE_PREFLIGHT_ROOTS` is
refused in a counted run and, in a practice run, must name existing dirs; the roots used are recorded, never a
silent bypass. The frozen Jev/Laya dry-run records used a practice override pointing at a clean directory
(recorded), so the practice pre-flight scanned only that dir. For a counted run the operator now runs this scan
**once**, before the run, into a self-hashed pre-flight record (`--preflight --mode counted --write-record`) with no
timeout, and each counted runner requires that record instead of scanning itself (see the runner section above);
`run_gates.py` no longer scans in counted mode, so its old 3600 s scan ceiling is gone. On this machine the scan
walks a busy `/private/tmp` and the per-user temp dir and takes tens of minutes (about **10–15 min** at load
14–39, longer as the fleet's temp grows). Two earlier real counted scans found stray answer-key copies that killed
test runs had stranded in the per-user temp dir — a `test-build.mjs` build copy and a `test_run_gates.py`
tempfile — and correctly refused; those tests now clean up on exit and on SIGINT/SIGTERM, and the stray copies
were purged (destructive-action emit, cycle `exp005-fix3`). At the freeze-2 scan 15 answer-key copies were
present under `/private/tmp`, in a sibling refute session's worktrees; they were covered by the sandbox denyRead
(the R29 proof) and have since been removed with founder approval.

## Limits

- bce reads direct import edges. A breach that only happens transitively, through a file outside
  the governed scope, is invisible to it, so that family was removed rather than labelled wrong.
- The four `forbiddenPattern` rules are line matches, so a comment that contains `process.env` in a
  governed layer is RED. `rules.txt` states the rule that way, and the corpus plants that case four
  times.
- `rules.txt` line 6 has two clauses, and bce enforces only the second: a file in `src/app` that
  imports a file directly in `src/infra` other than `index.ts` (for example `src/infra/mail.ts`, not in
  a subfolder) is GREEN in bce, although the first clause ("only through src/infra/index.ts") reads as
  forbidding it. No corpus item sits on that boundary; the only app → infra-root import (c050) goes
  through `../infra/index`. Future items stay off it.
- All 60 patches were written by one author, who also wrote the rules. An independent review of the
  corpus against the quotas (bundle 1, WO-07) happens before the hashes are published; round 1 and
  its fixes are recorded above, and the hardened corpus goes back for a second round.
- The reviewer's pre-registered allow rule `Bash(git diff:*)` matches only as a command prefix, so
  ordinary in-workspace git forms — `git --no-pager diff`, `git -C <ws> diff`, a redirect to `$TMPDIR` —
  are denied and the reviewer must fall back to the plain forms. Each practice run hit one to three such
  denials. The pinned command is not changed; instead every reviewer call records `gitToolDenials`, the
  count of ordinary git commands the rule refused, so bundle 4 can report the friction. It is not in
  amendment 02's limits; bundle 4's limits state it.
- The answer-key pre-flight detects a copy only when it keeps an answer file's **own name** and its exact
  bytes (name and size in `find`, then sha256). A byte-for-byte copy saved under a different name — `labels.json`
  as `labels-copy.json`, or `inputs.json.bak` — is **not** detected, and neither is a reformatted or
  re-serialised file. Amendment 02 describes the pre-flight as refusing on "a byte-for-byte copy of labels.json";
  the name-first narrowing (a size-only walk is too slow on a ~97k-entry `/private/tmp`) means it catches the
  answer files under their own names, no more. The reviewer sandbox's denyRead of the temp roots, not the
  pre-flight, is the boundary that stops the reviewer reading any such copy; the pre-flight is a second line.
  Bundle 4's limits state this.
