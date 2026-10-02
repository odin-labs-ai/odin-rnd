"""EXP 008 (latent-handoff) zero-prefill counter, bundle 3 WO-07.

The counter wraps the RECEIVER's forward pass and records the token count of every call. The gate then checks the
count against the arm:

  - a KV arm (C1, C2, A2a, A2b, and A3, the generic pluggable-transfer slot) may forward ONLY the suffix (the gate question + the chat-template tail): the sum
    of forwarded tokens must equal the suffix length exactly. Anything more means the receiver re-read the context,
    so the "transfer" was a re-prefill in disguise, and the run FAILS.
  - a text arm (A0, A1, C3) forwards its whole prompt: the sum must equal that prompt's length.

Stdlib only at import time (no mlx), so the gate logic is tested in CI; the mlx-lm canary lives in the runner tests.
"""

KV_ARMS = frozenset({"C1", "C2", "A2a", "A2b", "A3"})
TEXT_ARMS = frozenset({"A0", "A1", "C3"})


class ZeroPrefillViolation(AssertionError):
    """The receiver forward-passed more tokens than the arm allows."""


def _tokens_in(inputs):
    shape = getattr(inputs, "shape", None)
    if shape is None:
        return len(inputs)
    if len(shape) == 0:
        raise ValueError("forward input has no token axis")
    return int(shape[-1])


class ForwardCounter:
    """Wraps a model callable; every call is counted, then passed through unchanged."""

    def __init__(self, model):
        self._model = model
        self.calls = []

    def __call__(self, inputs, *args, **kwargs):
        self.calls.append(_tokens_in(inputs))
        return self._model(inputs, *args, **kwargs)

    def __getattr__(self, name):
        # layers, args, make_cache ... resolve on the wrapped model
        return getattr(self._model, name)

    @property
    def total(self):
        return sum(self.calls)

    def reset(self):
        self.calls = []


def check(arm, calls, suffix_len, prompt_len=None):
    """Raise ZeroPrefillViolation unless the forwarded token count fits the arm. Returns the total on success."""
    total = sum(calls)
    if arm in KV_ARMS:
        if total != suffix_len:
            raise ZeroPrefillViolation(
                f"{arm}: receiver forwarded {total} tokens; a KV arm may forward only the {suffix_len}-token suffix"
            )
        return total
    if arm in TEXT_ARMS:
        if prompt_len is None:
            raise ValueError(f"{arm}: a text arm needs its prompt length")
        if total != prompt_len:
            raise ZeroPrefillViolation(f"{arm}: receiver forwarded {total} tokens; the prompt is {prompt_len}")
        return total
    raise ValueError(f"unknown arm {arm!r}")
