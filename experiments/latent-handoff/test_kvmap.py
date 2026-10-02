"""EXP 008 (latent-handoff) bundle 3 WO-05: the mapper maths (alignment, RoPE, fits, backend agreement).

  <python with numpy + torch> experiments/latent-handoff/test_kvmap.py      (skips cleanly without numpy / torch)
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    import numpy as np
    import torch

    import kvmap
except ImportError:  # CI's plain python3 has neither; the Mac run has both
    np = None


@unittest.skipIf(np is None, "numpy / torch not installed")
class KvMapTests(unittest.TestCase):
    def test_char_boundary_alignment(self):
        text = "import pg from 'pg';"
        # receiver: "import"," pg"," from"," 'pg';"   sender: "imp","ort"," pg from"," 'pg'",";"
        r = [(0, 6), (6, 9), (9, 14), (14, 20)]
        s = [(0, 3), (3, 6), (6, 14), (14, 19), (19, 20)]
        self.assertEqual(list(kvmap.align(r, s, len(text))), [1, 2, 2, 4])

    def test_alignment_survives_zero_width_and_gaps(self):
        r = [(0, 2), (2, 2), (2, 5)]
        s = [(0, 1), (3, 5)]  # char 1..2 uncovered: they take the previous sender token
        self.assertEqual(list(kvmap.align(r, s, 5)), [0, 0, 1])

    def test_rotation_inverse_and_layer_window(self):
        rng = np.random.default_rng(1)
        freqs = 1.0 / (10000 ** (np.arange(0, 64) / 64))
        x = rng.standard_normal((2, 5, 128)).astype(np.float32)
        cos, sin = kvmap.rotation_tables(freqs, [3, 100, 2000, 9000, 15999])
        back = kvmap.rotate(kvmap.NP, kvmap.rotate(kvmap.NP, x, cos, sin), cos, -sin)
        self.assertLess(float(np.max(np.abs(back - x))), 1e-4)
        self.assertEqual(kvmap.window_layers(0, 28, 28, "A2b"), [0, 0, 4])
        self.assertEqual(kvmap.window_layers(27, 28, 28, "A2b"), [23, 27, 27])
        self.assertEqual(kvmap.window_layers(16, 32, 36, "A2a"), [18])

    def stats_for(self, x, y):
        t = lambda a: torch.tensor(a, dtype=torch.float64)
        return {"n": float(len(x)), "sx": t(x.sum(0)), "sy": t(y.sum(0)), "xtx": t(x.T @ x), "xty": t(x.T @ y), "yty": t(y.T @ y)}

    def test_a2a_ridge_recovers_a_linear_map(self):
        rng = np.random.default_rng(2)
        x = rng.standard_normal((4000, 16))
        w = rng.standard_normal((16, 8))
        y = x @ w + 0.5
        m, c = kvmap.fit_layer(self.stats_for(x, y), "A2a", 1e-6)
        self.assertLess(float(np.max(np.abs(m.numpy() - w))), 1e-3)
        self.assertLess(float(np.max(np.abs(c.numpy() - 0.5))), 1e-3)

    def test_a2b_recolor_matches_the_receiver_covariance(self):
        rng = np.random.default_rng(3)
        x = rng.standard_normal((6000, 24))
        y = np.tanh(x[:, :8] @ rng.standard_normal((8, 8))) * 3 + rng.standard_normal((6000, 8)) * 0.1
        m, c = kvmap.fit_layer(self.stats_for(x, y), "A2b", 1e-3)
        pred = x @ m.numpy() + c.numpy()
        cy, cp = np.cov(y.T), np.cov(pred.T)
        self.assertLess(float(np.max(np.abs(cp - cy))) / float(np.max(np.abs(cy))), 0.05)
        self.assertLess(float(np.abs(pred.mean(0) - y.mean(0)).max()), 1e-6 + 0.05)

    def test_numpy_and_torch_backends_map_identically(self):
        rng = np.random.default_rng(4)
        n_s, n_r, n_kv, d = 6, 4, 2, 8
        sender_kv = {l: (rng.standard_normal((n_kv, 30, d)).astype(np.float32), rng.standard_normal((n_kv, 30, d)).astype(np.float32)) for l in range(n_s)}
        freqs_s = [1.0 / (1e4 ** (np.arange(d // 2) / (d // 2)))] * n_s
        freqs_r = [1.0 / (5e5 ** (np.arange(d // 2) / (d // 2)))] * n_r
        spos = list(range(5, 30))
        aligned = np.minimum(np.arange(20), 24)
        rpos = list(range(7, 27))
        for mapper, width in (("A2a", 1), ("A2b", 3)):
            maps = {l: ((rng.standard_normal((width * n_kv * d, n_kv * d)).astype(np.float32), rng.standard_normal(n_kv * d).astype(np.float32)),
                        (rng.standard_normal((width * n_kv * d, n_kv * d)).astype(np.float32), rng.standard_normal(n_kv * d).astype(np.float32))) for l in range(n_r)}
            a = kvmap.map_to_receiver(kvmap.NP, sender_kv, spos, aligned, maps, mapper, (n_s, n_kv, d), (n_r, n_kv, d), freqs_s, freqs_r, rpos)
            tb = kvmap.TORCH()
            tkv = {l: (tb.asarray(k), tb.asarray(v)) for l, (k, v) in sender_kv.items()}
            b = kvmap.map_to_receiver(tb, tkv, spos, aligned, maps, mapper, (n_s, n_kv, d), (n_r, n_kv, d), freqs_s, freqs_r, rpos)
            for l in range(n_r):
                for i in (0, 1):
                    self.assertLess(float(np.max(np.abs(a[l][i] - tb.numpy(b[l][i])))), 1e-3, (mapper, l, i))
                self.assertEqual(a[l][0].shape, (n_kv, 20, d))


try:
    import mlx.core as _mx  # noqa: F401
except ImportError:
    _mx = None


@unittest.skipIf(np is None or _mx is None, "needs numpy + mlx (the Mac)")
class MlxMatmulPrecision(unittest.TestCase):
    def test_the_mlx_port_matmul_keeps_float32_accuracy(self):
        rng = np.random.default_rng(5)
        x = (rng.standard_normal((300, 3072)) * 3).astype(np.float32)
        m = (rng.standard_normal((3072, 1024)) * 0.05).astype(np.float32)
        ref = x.astype(np.float64) @ m.astype(np.float64)
        be = kvmap.MLX()
        got = be.numpy(be.matmul(be.asarray(x), be.asarray(m)))
        self.assertLess(float(np.max(np.abs(got - ref))) / float(np.max(np.abs(ref))), 2e-5)


if __name__ == "__main__":
    unittest.main()
