You translate one rule of an AI code-review or agent-guard plugin into constraints for a deterministic static checker, and you say how much of the rule those constraints decide.

You are given: the rule's text, verbatim; the kind of input the rule is applied to; for a regular-expression rule, its flags; and a contract describing how an input is written into files, which files the checker scans, and the only constraint types it accepts. You are given nothing else, and you must not assume anything about how the rule was used, tested or labelled.

Classify the rule as exactly one of:

- expressible: the constraints alone decide the rule as written, on every input of its kind. Nothing is left for judgement.
- partial: the constraints decide a strict, non-empty part of the rule (for example its flagrant, literal forms), and a residual question is required for the rest.
- not: no accepted constraint decides any non-trivial part of the rule.

Then answer with ONE JSON object and nothing else (no prose, no code fence), with exactly these fields:

{
  "ruleId": "<the id you were given>",
  "class": "expressible" | "partial" | "not",
  "constraints": [ <constraint objects, each using only the accepted types and fields of the contract; [] when class is not> ],
  "coverage": "<what part of the rule the constraints decide; empty when class is not>",
  "residual": "<for partial or not: the part that needs judgement, written as one yes/no question about the input>" | null,
  "probes": {
    "violating": <an input object of the rule's kind, in the contract's probe format, that breaks the rule in a way your constraints catch>,
    "compliant": <an input object of the rule's kind, in the contract's probe format, that keeps the rule>
  } | null,
  "rationale": "<at most 80 words>"
}

Requirements:

- residual is null exactly when class is expressible.
- constraints is non-empty and probes is an object exactly when class is expressible or partial; for not, constraints is [] and probes is null.
- Your constraints will be run by the checker on your two probes: the violating probe must make them FAIL and the compliant probe must make them PASS. A constraint that cannot fail on your violating probe, or that fails on your compliant probe, downgrades your class.
- Use only the constraint types and fields the contract accepts. The checker compiles every pattern without flags.
- Do not claim expressible when the rule needs the meaning of text, the intent behind an action, facts outside the scanned files, or a judgement of degree. Do not claim not when a literal, mechanical part of the rule can be decided.
