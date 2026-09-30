# EXP 007 census protocol (stage 1)

Question: which of a gate's rules need a model at all? For each rule a listed plugin ships, a blind translator writes the constraints a deterministic checker (bce-engine 0.3.1) would need, and says how much of the rule they decide. Mechanical checks and an independent adjudicator can only lower that answer. This file is the protocol in prose; `protocol.mjs` is the same in code, `scorer.mjs` is the scorer, and both are pinned by sha256 in `preregistration.json`.

## The rules

The eight plugins, their pins, what counts as one rule and what is excluded are fixed in `rules/selection.json` and listed in `rules/SELECTION.md`. The primary stratum is every rule that passes the inclusion test; hunch's 1,011 specification rules are a secondary stratum, a seeded sample of 30, reported separately and never in the median. Each rule file (`rules/<plugin>.json`) carries the verbatim text, the source path and line at the pin, and the sha256 of each source file.

## The translator (blind)

One fresh process per rule. `protocol.mjs` builds the prompt from exactly five fields of a rule ({ruleId, text, inputKind, flags, context}). The user message carries: an opaque id (`item-<first 12 hex of sha256("exp007-census-v1:" + ruleId)>`, which the runner maps back); the input kind; the "Applies to" line (the context: the rule's match target and application condition, one factual sentence per source group plus the rule's own file globs, with a glob that names the plugin shown as `<tool>`; absent when the source defines none); the regex flags, for a regex rule; the rule's verbatim text (the one text field pinned per plugin); and the materialisation contract (`contract.md`; `contract-module-graph.md` for the positive controls only), which lists the only accepted constraint types with one generic example each. The pinned system prompt is the rest. It never sees a case, a label, a plugin evaluation file, abide's own type field, another rule's class, or any result; no plugin name, source path, stratum or control word appears in a prompt. Tests prove both.

It answers one JSON object: {ruleId, class: expressible | partial | not, constraints, coverage, residual, probes: {violating, compliant}, rationale (at most 80 words)}.

Class definitions (pre-registered):

- expressible: the constraints alone decide the rule as written on every input of its kind (no residual);
- partial: the constraints decide a strict, non-empty subset (for example the flagrant forms) and a residual question is required for the rest;
- not: no accepted constraint decides any non-trivial part.

## Mechanical checks (code, no model)

In order: the answer parses and matches the schema; every constraint type is in the vocabulary (`whitelist.json`); the checker's own `bce validate` passes on a blueprint holding the constraints; for a regex rule with /i, the flags check (no forbiddenPattern carries an upper-case letter, literal or escaped, nor an escape the check cannot verify: the adapter lower-cases an /i rule's input before the checker runs, so case-insensitivity holds by construction); and teeth through the adapter (every violating probe, one or a list, makes the constraints FAIL, the compliant probe makes them PASS, and each constraint alone makes at least one violating probe FAIL). g and d change no verdict; any other flag cannot be checked mechanically and caps the class at partial. A pinned class cap from a rule's source group (pi-verdict's 8 write-only path rules: at most partial) turns an expressible answer, which has no residual, into not; such a rule reaches partial only when the translator answers partial with a residual. The first failure lowers the class once: expressible becomes partial if a residual was given, else not; partial becomes not. The downgrade is recorded with the failing check. A pattern the checker's regex guard refuses is recorded in a separate engine-limit category. An answer that is not a JSON object with a valid class is a harness failure: class error, counted as not, and listed.

## The adjudicator (independent)

A separate process, a different pinned model, no tools. Its user message carries the same opaque id, the input kind, the "Applies to" line, the regex flags, the rule's verbatim text, the translator's answer verbatim, a summary of the mechanical results (schema, vocabulary, validation, teeth, the flags check for flagged rules, both classes), the flag-semantics sentence for flagged rules and the stated class; the pinned system prompt is the rest; no case. It answers {ruleId, verdict: confirm | dispute, proposedClass, reason}. The final class is the class after the mechanical checks if confirmed; if disputed, the lower of the two (not < partial < expressible), so a dispute can only lower expressibility. Translator-adjudicator agreement is reported as Cohen's kappa over the three classes, with its n and the dispute list; rules whose translator or adjudicator call ended in error are excluded; computed over all census rules including controls. A harness failure of the adjudicator is class error, counted as not.

## Controls (disclosed, outside every median)

- Positive: EXP 005's `rules.txt` rules 2 to 8, verbatim (`controls/positive.json`); the EXP 005 blueprint enforces each of them, and they are graded as EXP 005 graded them (typescript-module-graph over `src/**/*.ts`).
- Negative: six semantic rules, each needing meaning or intent (`controls/negative.json`); they take the same plugin-surface path as the plugin rules.

Calibration bar: at least 6 of 7 positive controls final expressible or partial, and at most 1 of 6 negative controls final expressible. A miss is published and the census reported as "translator uncalibrated"; it is not silently re-run.

## Metrics

- Per plugin: expressible share = final expressible / rules in the primary stratum, with n; the partial share beside it.
- Headline: the median across plugins of the expressible share (strict). A plugin whose primary stratum is empty has no share; it is listed and not counted.
- Also reported: the median before disputes; the median with partial counted as 0.5 (sensitivity, not decisive); the secondary stratum; the controls; kappa and disputes; downgrades and engine limits; errors; and the agreement of abide's rules' final class with abide's own type (lint ~ expressible, model ~ partial or not, unenforceable and deferred reported as they are).
- Kill (pre-registered): a median expressible share below 25% refutes the premise; stage 2 is cancelled and the census is the result.

## Calls, pins and spend

Translator claude-opus-5-5, adjudicator claude-sonnet-5, through the Claude Code client recorded in the pre-registration, effort high, one attempt per call, each call as `claude -p --model <pin> --effort high --tools "" --strict-mcp-config --setting-sources project --no-session-persistence --system-prompt-file <pinned prompt file> --output-format json` in a fresh empty directory outside any repository, with an environment built from an allowlist and no fallback model. Every call is metered and ledgered under the $100 cap; the census ceiling is $40. None of this runs in bundle 1: bundle 1 makes no model call at all.
