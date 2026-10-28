# The lab bar, as checks

A results lab on this site cites private work by hash, pins its record and screens what it shows. This page lists the parts of that bar a machine checks on every build, and the parts it does not.

## What is checked

Two blueprints in `.ai/blueprints/` hold the bar. `scripts/labs-bar-blueprint.test.mjs` grades the real tree with the released engine, then plants each violation in a disposable copy, requires a failing verdict that names the planted file, removes it and requires a pass again.

`rnd-labs-kit-boundary` reads the import graph of the results-lab builders: `scripts/lab-engine-history.mjs`, `scripts/lab-rogue.mjs` and `scripts/lab-rogue-tamper.mjs`.

- **Every results-lab builder imports `scripts/lab-kit.mjs`.** The kit holds the one cite sentence, the pin check, the record contract, the page screen and the marked boxes, so a lab that skips it cites and screens by its own rules.
- **No results-lab builder imports `scripts/lab-dispatch-publish.mjs` directly.** The kit re-exports the publisher's screen and adds the page checks on top. Reaching past it gets the screen without those checks.

`rnd-labs-bar` reads the lab pages, the lab records and the workflows, line by line.

- **No money figure on a lab page or in a lab record** (`site/labs/**`, `site/data/labs/**`): a currency sign or code next to a number.
- **Every workflow job runs on a GitHub-hosted runner.** This repository is public. A `runs-on:` line that is not one hosted label (`ubuntu-…`, `macos-…`, `windows-…`) fails, so a self-hosted runner never takes a job from it. A label list, a runner group or a matrix expression fails too, on purpose: none is used today, and each would be a reviewed change.

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
- **A cited commit is part of the private main.** A record may say `onMain: true` only with a main check, and the commit must be an ancestor of that main. That is a rule across fields and across repositories. A line pattern cannot hold it, so the lab validators hold it: the kit's record contract and each lab's own checks.
- **The publish workflow keeps its leak gate step.** The engine has no rule that requires a line to be present, so once the gate lands this stays with its own tests, which pin the step order.
- **The list of results-lab builders.** It is written out, not matched by a pattern, because other lab scripts import the publisher's screen for good reasons. A new results lab joins the list in its own pull request.

## How it is enforced

A failing verdict fails the `verify` job, and the Pages deploy needs that job, so a violation never reaches the live site. The repository has no required checks, so a red pull request is reported, not blocked from merging. Both blueprints stay drafts until review, like the factory blueprint.
