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
| 7 | Only src/config may use process.env; files in src/domain, src/app and src/infra must not contain process.env anywhere. | `env-not-in-domain`, `env-not-in-app`, `env-not-in-infra` |
| 8 | Files in src/config may use only these environment variables, written as process.env.NAME: PORT, DATABASE_URL, LOG_LEVEL, SMTP_HOST, SMTP_FROM, INVOICE_PREFIX. Any other process.env name, or process.env[...], is not allowed. | `config-env-allowlist` |

The five `forbiddenDependency` constraints read the AST import graph (direct edges only, including
`import type`, `export ... from` and string-literal `import()`; an import whose target cannot be
resolved fails the boundary closed). The four `forbiddenPattern` constraints are per-line content
matches, so they also match comments. `rules.txt` words lines 7 and 8 to say exactly that ("must not
contain process.env anywhere").

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
also records the removed family and the size cap. The corpus has 60 patches, `corpus/c001.patch` to
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
intended target of at least 2 drift items.

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
corpus   fcf7d61b214ced984c1073abc3b8a0ba6551b489efc9e01d2104c142390a7e47  (sha256 of corpus.sha256)
inputs   b18397b6918542b2413425bb82fa2e0b44ad794f0dad852302e0a552e48d4dac  (sha256 of inputs.json)
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
| rules.txt alone | 235 | |
| largest state (c047) | 902 | 989 |
| median state | 452 | |
| largest full sequence | 937 | 1024 |
| truncated inputs | 0 of 60 | 0 |
| planted negative control | 3,100 tokens, refused | |

State sizes by bce label: RED 340–617 tokens (median 439), GREEN 364–902 (median 455.5). The
largest items are a clean refactor (c047) and a clean feature (c020); size is not a strong cue for the label.

## Reproduce

Node 22 and the frozen lockfile (`pnpm install --frozen-lockfile`), from the repository root:

```sh
node experiments/jev-gate/bce-contract.mjs          # GREEN and RED controls
node experiments/jev-gate/teeth.mjs                 # base, teeth and probes -> teeth-report.json
node experiments/jev-gate/author-corpus.mjs --check # patches regenerate byte for byte
node experiments/jev-gate/label.mjs --check         # full bce re-label, byte for byte
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

## Limits

- bce reads direct import edges. A breach that only happens transitively, through a file outside
  the governed scope, is invisible to it, so that family was removed rather than labelled wrong.
- The four `forbiddenPattern` rules are line matches, so a comment that contains `process.env` in a
  governed layer is RED. `rules.txt` states the rule that way. The corpus does not plant that case.
- All 60 patches were written by one author, who also wrote the rules. An independent review of the
  corpus against the quotas (bundle 1, WO-07) happens before the hashes are published.
