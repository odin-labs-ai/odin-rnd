// Dependency-free contract and decision checks run in the existing root CI job.
// Native driver and Temporal runner tests use the experiment's pinned install.
import '../experiments/temporal-primitive-fit/adapters.test.mjs';
import '../experiments/temporal-primitive-fit/evaluate.test.mjs';
import '../experiments/temporal-primitive-fit/runtime.test.mjs';
