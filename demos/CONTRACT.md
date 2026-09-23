# Recorded Java fixture protocol — schema version 1

Node 22 and JDK 21 execute trusted bundled sources. Temporary directories are cleaned; they are not security sandboxes. No model calls or customer inputs.

Shared exports: runCommand({executable,args,cwd,timeoutMs=30000,maxOutputBytes=1048576}) returns status (completed, timeout, spawn-error, output-limit), exitCode, stdout, stderr, durationMs. Execution uses no shell; bounds terminate the process group. hashInputs({root,relativePaths}) returns SHA256 by relative input path and rejects absolute paths, traversal and symlink escapes. recordProject({outputPath,report}) atomically writes JSON.

Each run.mjs exports runProject({root,javaHome}). Root defaults from module URL. CLI --out writes a report, exiting 0 for passed discrimination, 1 for failed discrimination, 2 for infrastructure or inconclusive results. Expected negative behavior is successful discrimination, not infrastructure failure.

Required report fields: schemaVersion 1, project, projectVersion 0.1.0, mode authored-fixtures, startedAt/completedAt ISO, runtime {node,java,javac}, inputSha256, scope, limitations[], observations[], commands[], metrics[], experimentVerdict (passed, failed, inconclusive). Observation: id, caseId, role (baseline,candidate,negative-control,oracle), expected, actual, verdict (accepted,rejected,inconclusive), reason, commandIds[]. Command: id, executable (java,javac), args[], cwd, status, exitCode, durationMs, stdout, stderr. Metric: id,numerator,denominator,unit,definition. Additional fields may explain provenance.

Raw logs normalize temporary roots to <workdir>, repository roots to <repo>, and Java installation roots to <jdk>. Input hashes cover all owned fixtures, runner, shared helper and this contract. Source revision is captured separately. Hashes establish consistency, not authenticity against an attacker changing every artifact.

Missing assertions, crashes, compile errors and timeouts are inconclusive, never detected defects. Independent expected values and assertion IDs support behavior judgments. Denominators exclude unresolved execution, which is reported separately. Fixtures are authored, not held-out performance or measured ROI. Reproduction and limitations accompany each project.
