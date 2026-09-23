# Test Witness

Run with Node 22 and JDK 21 installed:

```sh
JAVA_HOME=/path/to/jdk-21 node demos/test-witness/run.mjs --out /tmp/test-witness.json
```

This executes actual javac/java commands over trusted public fixtures. Five independent declared expected results cover ordinary totals, half-up rounding, below-threshold ordering, threshold discount and negative quantity validation. Three variants seed one defect each. Weak tests pass without finding them; strong tests must pass correct code and identify the exact corresponding assertion. Always-pass and always-fail suites emit structurally valid assertion records but ignore implementation behavior and are rejected. The runner separately verifies exact assertion fields, unique IDs, literal oracle values, status/value agreement, summary totals and exit codes; malformed evidence is inconclusive. Missing checks and an unknown crash remain inconclusive. Compile errors and timeouts never count as defects.

The mechanism is reproducible acceptance of test evidence. Tests and defects were authored together; this is not held-out performance, automated test generation, proof of all behavior, or measured ROI. Proposed pilot: supplied non-sensitive Java module and acceptance examples; deliver a scoped test-evidence report under an agreed delivery-hour cap, with customer savings and broader correctness unmeasured. No customer material or live agents are involved.
