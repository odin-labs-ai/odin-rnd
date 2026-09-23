# Migration Witness

An executable acceptance demonstration for an authored invoice-formatting component. Before and after are hand-authored Java sources, not an automatic migration, transformation engine or LLM agent. No ROI has been measured.

With Node 22 and JDK 21 installed, from the repository root:

```sh
JAVA_HOME=/path/to/jdk-21 node demos/migration-witness/run.mjs --out /tmp/migration-witness.json
```

The runner uses JAVA_HOME/bin/java and javac, or PATH if JAVA_HOME is absent. It executes only trusted bundled sources using bounded shell-free commands. It removes its owned temporary directories in finally; these are not security sandboxes. Exit 0 means the discrimination experiment passed, 1 means it failed, and 2 means infrastructure was inconclusive. Expected rejection of a negative control is not an experiment failure.

`fixtures/cases.tsv` independently declares literal expected results: half-cent currency rounding, trimmed Unicode names, UTC day rollover from an offset, leap-day negative rounding, invalid and empty amounts, and an invalid calendar date. Both versions must satisfy those seven expectations and agree pairwise. A separate blank-customer case intentionally changes Guest to ERROR_CUSTOMER and is excluded from preservation. No expectations are generated from either implementation.

Each real Java execution emits ASSERT markers with Base64 UTF-8 actual values and a SUMMARY count. The runner checks marker coverage, expected values, summary consistency and exit status. The syntactically valid rounding regression must compile and be rejected. A rounding bug enabled in both versions gives pairwise equality on preservation cases but fails the independent oracle. Broken Java is inconclusive, never a behavior defect. Receipts retain normalized command transcripts, actual versions, hashes and scoped counts.

A proposed pilot would take a trusted component, dependency/runtime assumptions and buyer-approved examples as inputs, and deliver an independently specified acceptance suite and before/after evidence. Acceptance would cover only the agreed examples and explicitly approved intentional changes. General equivalence, automatic rewriting, production rollout and savings claims are excluded. Proposed delivery cap: 16 engineering hours for one component, subject to agreement after inspecting inputs. This is a planning limit, not a measured effort or savings estimate.
