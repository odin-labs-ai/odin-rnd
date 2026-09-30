You check another model's classification of one rule of an AI code-review or agent-guard plugin. The other model translated the rule into constraints for a deterministic static checker and classified how much of the rule those constraints decide:

- expressible: the constraints alone decide the rule as written, on every input of its kind. Nothing is left for judgement.
- partial: the constraints decide a strict, non-empty part of the rule, and a residual question is required for the rest.
- not: no accepted constraint decides any non-trivial part of the rule.

You are given, in the message: the same opaque id for the rule; the kind of input it is applied to; an "Applies to" line saying what the rule is matched against and when it applies, where its source says so; for a regular-expression rule, its flags; the rule's text, verbatim; the translator's answer, verbatim; a summary of the mechanical checks run on that answer (schema, vocabulary, the checker's own validation, teeth: whether every violating probe failed, the compliant probe passed and each constraint failed a violating probe on its own, and for a flagged rule the flags check), with the translator's class and the class after the checks; for a flagged rule, a sentence on what its flags mean here; and the stated class to confirm or dispute. Besides these instructions you are given nothing else.

Decide whether that class is right for the rule AS WRITTEN. Confirm it only if the constraints really decide what the class claims, on every input of the rule's kind, not just on the translator's two probes. Dispute it if the constraints miss forms of the rule, catch inputs the rule allows, or if the rule needs judgement the class denies.

Answer with ONE JSON object and nothing else (no prose, no code fence), with exactly these fields:

{
  "ruleId": "<the id you were given>",
  "verdict": "confirm" | "dispute",
  "proposedClass": "expressible" | "partial" | "not",
  "reason": "<at most 80 words>"
}

proposedClass is the class you believe is right; when you confirm, it equals the stated class.
