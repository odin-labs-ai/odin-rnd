# CI Witness — proposed scoped pilot

Status: proposal for discussion, 20 September 2026. No engagement or measured customer outcome is implied.

## Decision and fit

Can the failure be reproduced and corrected?

One known environment-sensitive Java failure in a trusted nonproduction test suite.

## Buyer inputs

A runnable fixture; approved environment configurations; target assertion and expected boundary and regression outcomes.

## Deliverable

A controlled matrix, baseline/reproducer/correction transcripts and an acceptance receipt with unresolved cases disclosed.

## Acceptance to agree

The same target failure reproduces; the correction passes its target, boundary and regression checks without suppressing them.

## Proposed limit and exclusions

Proposed delivery cap: 12 engineering hours, subject to inspecting inputs and agreeing the scope. This is a planning hypothesis, not a service promise or a measured effort/savings estimate. Stop and report when the agreed cap or stop condition is reached; any extension needs a new agreement.

Excluded: General autonomous diagnosis or repair, production changes, flaky-rate estimates and arbitrary untrusted code.

## Evaluation

Agree the current-workflow baseline, comparable cases and success threshold before execution. Record setup, execution, human review, rework, unresolved cases, tool costs and full labor cost for both baseline and candidate workflow. Report accepted outcomes and total cost; do not infer savings from fixture detection counts.

## Before data or work

Agree scope, fees, access, permitted data, retention/deletion, ownership, acceptance and delivery terms before sharing any code or data. Start with a non-sensitive description. This file sends nothing. Prepare a brief at https://odin-labs-ai.github.io/odin-rnd/work-with-us/#brief and choose whether to contact Odin manually.

Public mechanism: https://odin-labs-ai.github.io/odin-rnd/projects/ci-witness/

## ROI worksheet — complete with buyer evidence

All values are blank; savings are unmeasured. Compare like-for-like accepted work, including failed attempts and human review.

| Input | Baseline | Pilot |
| --- | --- | --- |
| Setup and execution hours | | |
| Human review and rework hours | | |
| Accepted outcomes / unresolved work | | |
| Task frequency per agreed period | | |
| Fully loaded labor rate | | |
| Tool and infrastructure costs | | |
| Pilot fee / recurring fee if agreed | | |

Compare baseline total cost with candidate total cost including the pilot fee. Keep one-time setup separate from recurring effort; do not extrapolate beyond a stated frequency and period. Released engineering capacity is time available for other work. Realized cash savings require evidenced reductions in actual spending and must be reported separately. Fixture execution time does not translate into human time saved.

For Odin's delivery economics, separately record all delivery, preparation, review, rework and support hours at full labor cost, plus tooling and infrastructure costs. Contribution equals agreed revenue less those full delivery costs. Do not substitute customer savings or a proposed hour cap for measured contribution.
