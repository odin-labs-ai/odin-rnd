# First-edition validation

Observed 7 September 2026. This document records implementation checks; the deployed record is `data/site.json`, and the experiment run is linked from `data/experiments.json`. CI regenerates those records for the actual publication revision.

- Node 22.22.2 and pnpm 10.11.1 used locally. Public npm bce-engine 0.3.0 version and integrity matched its released declaration before installation.
- Three real packaged recipes: TypeScript module layering, Python module layering and configuration allowlisting. Each produced clean score 100, drift score 60, the named violation, and a successful discrimination experiment. Full transcripts and hashes are retained in the generated JSON.
- Transcript negative cases reject missing GREEN/RED, wrong recipe, changed format and failed process. A deliberately altered experiment-input digest was rejected by the site check; the original generated record was restored.
- Static checks passed for local resources, anchors, duplicate IDs, the defined public-export tripwire, transcript hashes and actual experiment-input hashes.
- Chromium desktop 1440×1000 and mobile 390×844: station selection, blueprint toggle, recipe selection, transcript inspection and clipboard copy passed. Articles had no horizontal overflow. No page errors or failed resource requests were observed locally.
- With JavaScript disabled, the first real transcript and score remain readable. At 320px the page had no horizontal overflow. Keyboard focus began at the working skip link.
- Axe 4.11.1 reported no WCAG A/AA violations on the home page and both articles. Its home-page color-contrast check remained automated-incomplete; this is not a WCAG conformance certification.
- The independent finish review requested two changes: journal metadata placement and authored research icons. Both were corrected in one batch and scored resolved after the desktop/mobile confirmation captures. No redesign was requested.

The factory drawing is authored SVG geometry. The mechanical style detector used a reduced parser and cannot establish complete compliance. Its advisory about a blueprint grid was reviewed against the actual drawing-board use.

The independent review is a source/screenshot review. It does not replicate the internal rollout case or establish a productivity benefit. The separate public CI and anonymous Pages publication checks supply deployment evidence.
