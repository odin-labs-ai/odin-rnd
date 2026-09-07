# Publishing the workshop

The website source is `site/`. The build emits only `dist/`; development documents, draft release copy, dependencies and local review files are not part of the Pages artifact.

Keep the public project name and Pages prefix `odin-rnd`. The `github-pages` environment receives only the verified artifact from `Public experiments & Pages`. The first deployment uses GitHub's workflow-based Pages setting.

## A new experiment

Add a supported released upstream recipe to `scripts/run-experiments.mjs`, with a human question and a precise method. Update the deliberate three-recipe presence check, add a selector through the generated data and review the outcome. Do not invent a result or turn a failed recipe into a pass to publish a page. A changed upstream output format is a failed experiment until the parser and its meaningful negative cases are reviewed together.

For failure before a report exists, inspect the failed workflow step. A retained report's own revision, time and run URL must be used to identify it. Workflow artifacts expire after 90 days; a durable longitudinal archive is a future extension, not a capability claimed by this edition.

## A new field note

Use a dated article under `site/journal/`, add it to the floor and sitemap, and state:

1. The question or change in ordinary language.
2. What actually happened and in what environment.
3. Why it matters, with measured and expected benefits distinguished.
4. A public source trail, or an explicit internally evidenced boundary.
5. What remains open and what the next experiment could establish.

Link public repositories and source revisions. Check that old availability statements still describe the linked material; the paper archive predates the public BCE engine release. Never promote a dated observation into a current fleet claim.

## Publication checks

Run the experiments, transcript negative tests, static build and site check. Inspect desktop and mobile in the browser: navigation, station selection, blueprint view, every recipe, transcript, command copy and articles. Verify the deployed `data/site.json` revision and `data/experiments.json` CI URL against the completed Pages workflow. Read the public pages anonymously.

The current claim check rejects known private hosts/customer names, tracking scripts and links outside the approved public repository set. It is a tripwire, not a full semantic privacy or claim audit; review copy and raw experiment output as well.
