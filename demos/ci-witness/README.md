# CI Witness

Recorded local fixture demonstration, not an autonomous diagnosis or repair service. From the repository root with Node 22 and JDK 21 available:

```sh
JAVA_HOME=/path/to/jdk-21 node demos/ci-witness/run.mjs --out /tmp/ci-witness.json
```

The runner compiles and executes trusted bundled Java. Each case executes baseline, identical controlled reproducer, hand-authored correction, unrelated failure, suppressed checks, surviving regression, and unknown exception in that fixed order. The explicit matrix uses Amsterdam near UTC midnight, Turkish lowercasing, reversed input order, and legacy configuration. All processes receive explicit timezone and locale; ordering and configuration cases receive their own explicit inputs. UTF-8 compilation and execution preserve the Turkish assertion evidence.

The independent JSON oracle declares expected and baseline values. Verification requires exact target assertion identity/value, one case-specific boundary and both regression assertions, check count and process exit. A correction must retain four checks. The seeded regression passes the target assertion but fails the arithmetic check and is rejected. Missing checks and unrelated failures are rejected. Unknown exceptions remain inconclusive rather than receiving a guessed diagnosis. An expected negative control counts toward successful discrimination, not toward a passed behavioral test. Four deliberately unknown executions stay visible in the unresolved denominator.

Exit 0 means all 32 expected discrimination observations (28 executions and four boundary observations) matched; 1 means a mismatch; 2 means infrastructure or unexpected inconclusive evidence. Reports include actual compiler/runtime versions, normalized command output, exits, timings and hashes of source, runner, shared helper and execution contract. Owned temporary directories are cleaned even on error; this is not a security sandbox. Only trusted bundled fixtures are supported. No random trials, flaky-rate claims, AI calls, inferred customer ROI or held-out performance claims apply. Hashes establish consistency, not authenticity against an attacker rewriting all artifacts. The aggregate recorder supplies source revision metadata.

## Proposed scoped pilot

Buyer question: can one known environment-sensitive Java failure be reproduced with a specific assertion and verified correction while preserving agreed regression checks? Proposed deliverable: a controlled matrix, baseline/reproducer/correction transcripts and an acceptance receipt for one trusted nonproduction test suite. Buyer inputs: runnable fixture, approved environment configurations and explicit expected outcomes. Acceptance: intended failure reproduced, same assertion passes after correction, all agreed regression checks execute and pass, unresolved cases disclosed. Proposed delivery cap: 12 engineering hours, subject to fixture readiness. Excludes production changes, arbitrary untrusted code, general autonomous repair, statistical reliability claims and savings promises. Demand and value require discovery and measured pilot evidence.

Each corrected case also records an independent oracle observation: leap-day noon remains the leap day, German sharp-s lowercasing remains intact, a sorted three-item sequence retains all items, and an explicit relaxed configuration overrides the strict default. The same implementation functions serve target and boundary inputs. These declared boundary cases do not establish general correction safety.
