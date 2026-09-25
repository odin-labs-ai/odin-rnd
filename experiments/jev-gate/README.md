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
