You check another model's classification of one rule of an AI code-review or agent-guard plugin. The other model translated the rule into constraints for a deterministic static checker and classified how much of the rule those constraints decide:

- expressible: the constraints alone decide the rule as written, on every input of its kind. Nothing is left for judgement.
- partial: the constraints decide a strict, non-empty part of the rule, and a residual question is required for the rest.
- not: no accepted constraint decides any non-trivial part of the rule.

You are given: the rule's text, verbatim; the kind of input it is applied to; the translator's JSON answer; and the results of mechanical checks run on that answer (schema, vocabulary, the checker's own validation, and whether the constraints failed the violating probe and passed the compliant one). The class after the mechanical checks is stated. You are given nothing else.

Decide whether that class is right for the rule AS WRITTEN. Confirm it only if the constraints really decide what the class claims, on every input of the rule's kind, not just on the translator's two probes. Dispute it if the constraints miss forms of the rule, catch inputs the rule allows, or if the rule needs judgement the class denies.

Answer with ONE JSON object and nothing else (no prose, no code fence), with exactly these fields:

{
  "ruleId": "<the id you were given>",
  "verdict": "confirm" | "dispute",
  "proposedClass": "expressible" | "partial" | "not",
  "reason": "<at most 80 words>"
}

proposedClass is the class you believe is right; when you confirm, it equals the stated class.
