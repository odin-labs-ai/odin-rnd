# EXP 011 eligibility criteria (FROZEN 2026-10-10 before any item exists; applied to rule text only)

Input: `exp011-not-rules.json`, the 50 EXP 007 primary rules with final class `not` (ruleId, plugin, inputKind, kind, text, context). It was extracted from odin-rnd origin/main census + census-attempt-2 records and rules/{plugin}.json.

A rule is ELIGIBLE iff ALL of the following hold:
- E1. A violation of the rule can be shown as a change to source files of a small TypeScript project (tens of files). The change may include tests and docs. A task statement in `TASK.md` may be present in the base commit as context.
- E2. Whether a given change violates the rule can be decided from the repository contents plus `TASK.md` alone: no conversation, no transcript, no tool call, no runtime traces, no commit message.
- E3. The rule's meaning does not depend on a withheld rubric, threshold or score that is not in its text or context.
- E4. The rule is not specific to Rust (one fixture language: TypeScript).
- E5. The rule is not about the reviewing tool or product itself (meta rules about hooks, verdict formats, rule-instruction wording).

Otherwise the rule is EXCLUDED, with exactly one primary reason code:
- X-PROCESS: a process or conversation rule (E2);
- X-TRANSCRIPT;
- X-TOOLCALL;
- X-COMMIT: needs commit metadata;
- X-WITHHELD (E3);
- X-RUST (E4);
- X-META (E5);
- X-OTHER: explain.

The decision is per rule, with a one-sentence reason quoting the rule text. If unsure, EXCLUDE, and mark `uncertain: true`.

Kill floor (pre-registered): fewer than 10 eligible rules → EXP 011 is published as "too few buildable rules".
