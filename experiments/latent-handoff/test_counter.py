"""EXP 008 (latent-handoff) bundle 3 WO-07: the zero-prefill counter.

  python3 experiments/latent-handoff/test_counter.py        stdlib tests (CI)
  LH_MLX_CANARY=1 <mlx python> test_counter.py              also the mlx-lm canary (pinned version, tiny random model)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from counter import ForwardCounter, ZeroPrefillViolation, check  # noqa: E402


class Shape:
    def __init__(self, n):
        self.shape = (1, n)


def fake_model(inputs, cache=None):
    if cache is not None:
        cache.append(inputs.shape[-1])
    return "logits"


CONTEXT, SUFFIX = 400, 23


class CounterTests(unittest.TestCase):
    def test_a0_counts_the_full_context(self):
        m = ForwardCounter(fake_model)
        m(Shape(CONTEXT + SUFFIX))
        self.assertEqual(check("A0", m.calls, SUFFIX, prompt_len=CONTEXT + SUFFIX), CONTEXT + SUFFIX)

    def test_a2a_counts_the_suffix_only(self):
        m = ForwardCounter(fake_model)
        m(Shape(SUFFIX), cache=[])  # the context arrived as a transferred cache
        self.assertEqual(check("A2a", m.calls, SUFFIX), SUFFIX)

    def test_a_leaky_transfer_fails_the_gate(self):
        m = ForwardCounter(fake_model)
        m(Shape(CONTEXT))  # the "transfer" secretly re-reads the context through the receiver
        m(Shape(SUFFIX))
        with self.assertRaises(ZeroPrefillViolation):
            check("A2a", m.calls, SUFFIX)

    def test_a_chunked_leak_fails_too(self):
        m = ForwardCounter(fake_model)
        for _ in range(CONTEXT // 50):
            m(Shape(50))
        m(Shape(SUFFIX))
        for arm in ("C1", "C2", "A2b", "A3"):
            with self.assertRaises(ZeroPrefillViolation):
                check(arm, m.calls, SUFFIX)

    def test_a_text_arm_that_skips_the_context_fails(self):
        m = ForwardCounter(fake_model)
        m(Shape(SUFFIX))
        with self.assertRaises(ZeroPrefillViolation):
            check("A0", m.calls, SUFFIX, prompt_len=CONTEXT + SUFFIX)

    def test_passthrough_and_attributes(self):
        class M:
            layers = [1, 2, 3]

            def __call__(self, x, cache=None):
                return x.shape[-1] * 2

        m = ForwardCounter(M())
        self.assertEqual(m(Shape(5)), 10)
        self.assertEqual(m.layers, [1, 2, 3])
        m.reset()
        self.assertEqual(m.calls, [])

    def test_unknown_arm_refused(self):
        with self.assertRaises(ValueError):
            check("Z9", [1], 1)


@unittest.skipUnless(os.environ.get("LH_MLX_CANARY") == "1", "mlx canary runs on the Mac with LH_MLX_CANARY=1")
class MlxCanary(unittest.TestCase):
    """The pinned mlx-lm still calls model(inputs, cache=...) with a [B, T] array: the counter sees every token."""

    def test_counter_hooks_the_pinned_mlx_lm(self):
        import mlx.core as mx
        import mlx_lm
        from mlx_lm.models import llama
        from mlx_lm.models.cache import make_prompt_cache

        self.assertEqual(mlx_lm.__version__, "0.31.3")
        args = llama.ModelArgs(
            model_type="llama", hidden_size=64, num_hidden_layers=2, intermediate_size=128,
            num_attention_heads=4, num_key_value_heads=2, rms_norm_eps=1e-5, vocab_size=100,
        )
        model = ForwardCounter(llama.Model(args))
        cache = make_prompt_cache(model)
        mx.eval(model(mx.array([list(range(30))]), cache=cache))
        mx.eval(model(mx.array([[1, 2, 3]]), cache=cache))
        self.assertEqual(model.calls, [30, 3])
        self.assertEqual(cache[0].offset, 33)
        self.assertEqual(check("C1", model.calls[1:], 3), 3)


if __name__ == "__main__":
    unittest.main()
