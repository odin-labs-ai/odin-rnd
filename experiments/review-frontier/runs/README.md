# EXP 017 run files

One file per counted run (`<seat>-<a|b>.json`), written by `runner/collect.mjs` from the private run directory. `analyse.mjs` reads every `*.json` here and nothing else.

Fields that need a gloss:

- `harnessExit` is the exit code of the private review-recall harness. **2 is that harness's own recall gate failing**: it wants at least 90% of defects caught, and no seat came close. The run itself finished. Exit 3 would mean the run's spend cap stopped it, and that never happened.
- `complete` is true when the harness wrote its scorer report and all 58 reviews are present. It holds for all 8 runs, so `complete: true` beside `harnessExit: 2` is expected.
- `keyUsageUsd` reads the shared, dedicated key's usage counter at the run's start and end. Up to three runs were in flight at once, so only the window's first and last readings give a total; no single run's difference is that run's own cost. Per-review cost is in `reviews[].costUsd`.
- `reviews[].servedModel` is `null` only for a review that got no response on either attempt. That happened once, in Flash run b.
