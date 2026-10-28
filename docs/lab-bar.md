# The lab bar, as checks

A results lab on this site cites private work by hash, pins its record and screens what it shows. This page lists the parts of that bar a machine checks on every build, and the parts it does not.

## What is checked

Two blueprints in `.ai/blueprints/` hold the bar. `scripts/labs-bar-blueprint.test.mjs` grades the real tree with the released engine, then plants each violation in a disposable copy, requires a failing verdict that names the planted file, removes it and requires a pass again.

`rnd-labs-kit-boundary` reads the import graph of the results-lab builders: `scripts/lab-engine-history.mjs`, `scripts/lab-rogue.mjs` and `scripts/lab-rogue-tamper.mjs`.

- **Every results-lab builder imports `scripts/lab-kit.mjs`.** The kit holds the one cite sentence, the pin check, the record contract, the page screen and the marked boxes, so a lab that skips it cites and screens by its own rules.
- **No results-lab builder imports `scripts/lab-dispatch-publish.mjs` directly.** The kit re-exports the publisher's screen and adds the page checks on top. Reaching past it gets the screen without those checks.

`rnd-labs-bar` reads the results-lab builders, the lab pages, the lab records and the workflows, line by line.

- **A commit that is only on a lane is cited only through the kit's `laneCite`.** Its sentence ("…cited by hash, on a pushed branch that is not yet part of the private main…") may come from `scripts/lab-kit.mjs` and nowhere else. A builder, a lab page or a lab record that writes that wording out by hand fails. This holds the shape of the cite, not the facts behind it: whether a commit really is only on a lane is the kit's check (`laneCiteProblems`), against what the record holds. `laneCite` arrives in the kit with pull request #112 and is not on main yet. Until it lands, no page cites a lane commit at all, and this rule passes because nothing writes the wording.

- **No money figure on a lab page or in a lab record** (`site/labs/**`, `site/data/labs/**`). Three kinds of line fail:
  - a plain currency sign next to a digit;
  - a currency sign written in any encoding, such as a JSON `\u` escape, an HTML entity like `&#36;` or `&euro;`, or a percent code. These fail anywhere, digit or not, because no lab text needs an encoded currency sign;
  - a plain sign followed by an encoded character, or a currency code or word next to a number.

  This rule reads source lines; it is not a decoder. Two things still escape it: a figure split across lines or tags (`$<b>12</b>`), and an obfuscation it has no pattern for.
- **Every workflow job runs on one approved GitHub-hosted label.** This repository is public, so a self-hosted runner must never take a job from it. Any line in `.github/workflows/` (`.yml` or `.yaml`) that names `runs-on`, with the key quoted or not, in block or flow style, fails unless it is exactly one of: `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`, `ubuntu-24.04-arm`, `ubuntu-22.04-arm`, `macos-latest`, `macos-15`, `macos-14`, `macos-13`, `windows-latest`, `windows-2025`, `windows-2022`. A list, a runner group, an alias, a matrix expression or any other label fails too, on purpose. The rule relies on one assumption: no self-hosted runner that can serve this repository carries one of those names. On 28 October 2026 the repository had no runners of its own. Organization runner groups are not visible from here.
- **No workflow calls a reusable workflow from another repository**: that workflow's `runs-on` lives where this rule cannot read it.
- **No workflow carries an escaped character** (`\u…`, `\U…`, `\x…`). A double-quoted YAML key can spell `runs-on` without containing the text, and no workflow here needs an escape.

Run from the repository root:

```sh
pnpm exec bce validate --blueprint .ai/blueprints/rnd-labs-kit-boundary.engineering-blueprint.json
pnpm exec bce run --blueprint .ai/blueprints/rnd-labs-kit-boundary.engineering-blueprint.json --ct-repo . --no-pin --extractor ast --out kit-report.json
pnpm exec bce validate --blueprint .ai/blueprints/rnd-labs-bar.engineering-blueprint.json
pnpm exec bce run --blueprint .ai/blueprints/rnd-labs-bar.engineering-blueprint.json --ct-repo . --no-pin --extractor line-scan --out bar-report.json
node --test scripts/labs-bar-blueprint.test.mjs
```

Read each report's `verdict`, `coverage` and `violations`; a finished command is not a pass.

## Why two blueprints

The engine's import-graph profile reads JavaScript and TypeScript modules only and refuses page, record and workflow files, and a required import exists only in that profile. So the import rules and the line rules are two blueprints over one bar.

## What is not checked here, and where it lives

- **The leak screen of the built site.** These blueprints read the committed templates and records, not the built pages. Screening all of `dist/` before the deploy is the leak gate's job; that gate is proposed in pull request #114 and is not on main yet.
- **A cited commit is part of the private main.** A record may say `onMain: true` only with a main check, and the commit must be an ancestor of that main. That is a rule across fields and across repositories. A line pattern cannot hold it, so the lab validators hold it: the kit's record contract and each lab's own checks. Even there, "part of main" means what the record holds; this public repository cannot ask the private one.
- **The publish workflow keeps its leak gate step.** The engine has no rule that requires a line to be present, so once the gate lands this stays with its own tests, which pin the step order.
- **The list of results-lab builders.** It is written out, not matched by a pattern, because other lab scripts import the publisher's screen for good reasons. A new results lab joins the list in its own pull request.

## How it is enforced

A failing verdict fails the `verify` job, and the Pages deploy needs that job, so a violation never reaches the live site. The repository has no required checks, so a red pull request is reported, not blocked from merging. Both blueprints stay drafts until review, like the factory blueprint.
