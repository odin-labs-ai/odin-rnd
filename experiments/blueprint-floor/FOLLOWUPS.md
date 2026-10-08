# EXP 007: follow-ups for stage 2

Recorded after the stage-1 results review (results refute r2). Not part of any pinned file. Each item is to be fixed in the
stage-2 amendment's code, before any stage-2 call.

1. **The gate does not re-derive a record's class.** The pinned census gate (`census-gate.mjs`) recomputes the score from
   the records and checks each record's shape, calls, ledger lines and `final` against the scorer's `finalClass`, but it
   does not re-derive `translator.classAfterMechanical` from the translator's raw answer and the whitelist / validate /
   teeth checks. A consistent rewrite of a record's class (with `final` and `results.json` regenerated) therefore passes
   the gate. Stage 1 closes this in the site layer only: `scripts/blueprint-floor-results-site.mjs` pins the results
   sha256 and the git tree/blob ids of `census/`, `census-attempt-2/`, `practice/`, the ledger and `results.json` at the
   results commit `b57e4ec`. Stage 2: the gate re-runs the mechanical checks from each record's raw answer (or the raw
   store) and requires the recorded classes to equal them.
2. **The run-directory prefix named the experiment.** Each census call ran in a fresh temp directory whose name began
   `exp007-census`, visible to the models; the R6-1 canary terms did not include `exp007`. Stage 2: a neutral prefix, and
   the experiment id among the canary terms (disclosed on the results page as found in review after the run).
