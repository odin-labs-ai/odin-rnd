"""EXP 008 (latent-handoff) cross-tokenizer KV mapping, bundle 3 WO-05: the two labelled public baselines.

  A2a  OUR EXTENSION of the within-family per-head ridge mapper of arXiv 2608.03893 to a cross-tokenizer pair: keys
       are stripped of RoPE, every receiver context token is aligned to a sender token at the character boundary,
       and a ridge map from the sender's depth-matched layer predicts each receiver layer's keys and values.
  A2b  OUR REIMPLEMENTATION of HeteroFold (arXiv 2609.32259), built from the paper's description (its repository
       had no released code at planning): character-boundary alignment, sender layers (-4, 0, +4) around the
       depth-matched layer, and a Procrustes recolor onto the receiver's KV statistics. The paper's output-aware
       calibration stage is NOT reproduced here (closed-form fit only); that is a disclosed limit of this baseline.

Both maps are affine per receiver layer and per K / V: y = x @ M + c, fitted in closed form from streamed sufficient
statistics (calibrate.py, torch float64). map_to_receiver() runs the whole transfer on any backend: MLX at run time,
torch as the reference the parity gate compares against.

The interface the runner calls is transfer(sender_cache, sender_offsets, context_text) -> receiver cache. Reading the
text for alignment is allowed; the receiver is never run over the context (the zero-prefill counter checks it).
"""

import numpy as np

WINDOW = (-4, 0, 4)  # A2b: sender layers around the depth-matched layer, clipped to the sender's range


# ------------------------------------------------------------------------------------------------ RoPE, explicitly


def rope_freqs(rope, head_dim):
    """Recover the per-pair angular frequencies of an mlx-lm RoPE module (non-traditional layout) by probing it."""
    import mlx.core as mx

    half = head_dim // 2
    x = mx.concatenate([mx.ones((half,)), mx.zeros((half,))]).reshape(1, 1, 1, head_dim)
    y = np.array(rope(x, offset=1).astype(mx.float32)).reshape(-1)
    return np.arctan2(y[half:], y[:half]).astype(np.float64)


def rotation_tables(freqs, positions):
    """cos/sin for each (position, pair): float64 maths, float32 tables, shared by MLX and the torch reference."""
    ang = np.asarray(positions, dtype=np.float64)[:, None] * freqs[None, :]
    return np.cos(ang).astype(np.float32), np.sin(ang).astype(np.float32)


def check_rope(rope, freqs, head_dim, seed=0):
    """The explicit rotation must equal the module's own at a few offsets (fail closed)."""
    import mlx.core as mx

    rng = np.random.default_rng(seed)
    for p in (0, 7, 513, 15999):
        x = rng.standard_normal((1, 1, 3, head_dim)).astype(np.float32)
        want = np.array(rope(mx.array(x), offset=p).astype(mx.float32))
        cos, sin = rotation_tables(freqs, [p, p + 1, p + 2])
        got = rotate(NP, x, cos, sin)
        err = float(np.max(np.abs(want - got)))
        if err > 2e-3 * max(1.0, float(np.max(np.abs(want)))):
            raise AssertionError(f"explicit RoPE differs from the module by {err} at offset {p}")


# ------------------------------------------------------------------------------------------------ alignment


def char_to_token(offsets, n_chars):
    """Map every character of the text to the index of the token that covers it (gaps take the previous token)."""
    owner = np.full(n_chars, -1, dtype=np.int64)
    for t, (a, b) in enumerate(offsets):
        owner[a:b] = t
    last = 0
    for c in range(n_chars):
        if owner[c] < 0:
            owner[c] = last
        last = owner[c]
    return owner


def align(receiver_offsets, sender_offsets, n_chars):
    """Character-boundary alignment: receiver token j takes the sender token covering its last character."""
    owner = char_to_token(sender_offsets, n_chars)
    out = np.empty(len(receiver_offsets), dtype=np.int64)
    prev_end = 0
    for j, (a, b) in enumerate(receiver_offsets):
        end = b if b > a else max(prev_end, 1)
        out[j] = owner[min(end, n_chars) - 1]
        prev_end = end
    return out


def offsets_of(tokenizer, text):
    """Token ids + character offsets from the HF fast tokenizer behind an mlx-lm TokenizerWrapper."""
    hf = getattr(tokenizer, "_tokenizer", tokenizer)
    enc = hf(text, add_special_tokens=False, return_offsets_mapping=True)
    return list(enc["input_ids"]), [tuple(o) for o in enc["offset_mapping"]]


# ------------------------------------------------------------------------------------------------ layer matching


def matched_layer(l, n_receiver, n_sender):
    return int(round(l * (n_sender - 1) / max(1, n_receiver - 1)))


def window_layers(l, n_receiver, n_sender, mapper):
    s = matched_layer(l, n_receiver, n_sender)
    if mapper == "A2a":
        return [s]
    return [min(max(s + d, 0), n_sender - 1) for d in WINDOW]


# ------------------------------------------------------------------------------------------------ backends
# The same feature / map / rotate code runs on three array backends: numpy (calibration statistics), MLX (the
# runtime port) and torch (the parity reference). Rotation tables are always built in float64 numpy (float32 out).


class NP:
    name = "numpy"
    matmul = staticmethod(lambda a, b: a @ b)
    asarray = staticmethod(lambda a: np.asarray(a, dtype=np.float32))
    take = staticmethod(lambda a, idx, axis: np.take(a, np.asarray(idx), axis=axis))
    cat = staticmethod(lambda xs, axis: np.concatenate(xs, axis=axis))
    transpose = staticmethod(lambda a, axes: np.transpose(a, axes))
    numpy = staticmethod(lambda a: np.asarray(a))


class MLX:
    name = "mlx"

    def __init__(self):
        import mlx.core as mx

        self.mx = mx

    def asarray(self, a):
        return self.mx.array(np.asarray(a, dtype=np.float32)) if isinstance(a, np.ndarray) else a.astype(self.mx.float32)

    def take(self, a, idx, axis):
        return self.mx.take(a, self.mx.array(np.asarray(idx, dtype=np.int32)), axis=axis)

    def cat(self, xs, axis):
        return self.mx.concatenate(xs, axis=axis)

    def transpose(self, a, axes):
        return self.mx.transpose(a, axes)

    def numpy(self, a):
        return np.array(a.astype(self.mx.float32))

    def matmul(self, a, b):
        """float32 matmul at float32 accuracy on the GPU. MLX's Metal float32 matmul runs at reduced internal precision
        (measured: max |error| 3.5e-2 against float64 on a 3072 x 1024 map, vs 1e-4 on its CPU stream and in torch), so
        both operands are split into a bfloat16-exact high part and a float32 remainder and three products are summed
        (measured: 1.3e-4). The parity gate is what caught this."""
        mx = self.mx

        def split(t):
            hi = t.astype(mx.bfloat16).astype(mx.float32)
            return hi, t - hi

        ah, al = split(a)
        bh, bl = split(b)
        return ah @ bh + (ah @ bl + al @ bh)


class TORCH:
    name = "torch"

    def __init__(self):
        import torch

        self.t = torch

    def asarray(self, a):
        return self.t.from_numpy(np.ascontiguousarray(np.asarray(a, dtype=np.float32)))

    def take(self, a, idx, axis):
        return self.t.index_select(a, axis, self.t.from_numpy(np.asarray(idx, dtype=np.int64)))

    def cat(self, xs, axis):
        return self.t.cat(xs, dim=axis)

    def transpose(self, a, axes):
        return a.permute(*axes)

    def numpy(self, a):
        return a.detach().numpy()

    def matmul(self, a, b):
        return a @ b


def rotate(be, x, cos, sin):
    """RoPE (non-traditional halves) on x [..., T, D] with per-token tables [T, D/2] (inverse: pass -sin)."""
    half = x.shape[-1] // 2
    c, s = be.asarray(cos), be.asarray(sin)
    x1, x2 = x[..., :half], x[..., half:]
    return be.cat([x1 * c - x2 * s, x1 * s + x2 * c], axis=-1)


# ------------------------------------------------------------------------------------------------ feature extraction


def sender_features(be, sender_kv, sender_ctx_pos, sender_freqs, aligned, layers):
    """Per receiver context token: the aligned sender token's RoPE-stripped keys and values from `layers`.

    sender_kv[layer] = (keys, values) as backend arrays [n_kv, T, D] over the sender's whole prefix;
    sender_ctx_pos[i] is the absolute position of sender context token i. Returns (Xk, Xv) [n, len(layers)*n_kv*D]."""
    pos = np.asarray(sender_ctx_pos)[np.asarray(aligned)]
    n = len(pos)
    xs_k, xs_v = [], []
    for s in layers:
        k, v = sender_kv[s]
        cos, sin = rotation_tables(sender_freqs[s], pos)
        kk = rotate(be, be.take(k, pos, 1), cos, -sin)
        vv = be.take(v, pos, 1)
        xs_k.append(be.transpose(kk, (1, 0, 2)).reshape(n, -1))
        xs_v.append(be.transpose(vv, (1, 0, 2)).reshape(n, -1))
    return be.cat(xs_k, axis=1), be.cat(xs_v, axis=1)


def receiver_targets(be, receiver_kv, ctx_pos, receiver_freqs, l):
    """The receiver's own RoPE-stripped keys and values at its context positions (calibration targets)."""
    k, v = receiver_kv[l]
    n = len(ctx_pos)
    cos, sin = rotation_tables(receiver_freqs[l], ctx_pos)
    kk = rotate(be, be.take(k, ctx_pos, 1), cos, -sin)
    return be.transpose(kk, (1, 0, 2)).reshape(n, -1), be.transpose(be.take(v, ctx_pos, 1), (1, 0, 2)).reshape(n, -1)


# ------------------------------------------------------------------------------------------------ fitting (torch, f64)


def fit_layer(stats, mapper, alpha):
    """Closed-form fit from sufficient statistics {n, sx, sy, xtx, xty, yty} (float64 torch). Returns (M, c)."""
    import torch

    n = stats["n"]
    mx_, my = stats["sx"] / n, stats["sy"] / n
    cxx = stats["xtx"] - n * torch.outer(mx_, mx_)
    cxy = stats["xty"] - n * torch.outer(mx_, my)
    cyy = stats["yty"] - n * torch.outer(my, my)
    din = cxx.shape[0]
    lam = alpha * torch.trace(cxx) / din
    w = torch.linalg.solve(cxx + lam * torch.eye(din, dtype=cxx.dtype), cxy)
    if mapper == "A2a":
        m = w
    else:
        chh = w.T @ cxx @ w
        chy = w.T @ cxy

        def msqrt(c, inv):
            e, u = torch.linalg.eigh((c + c.T) / 2)
            e = torch.clamp(e, min=float(e.max()) * 1e-8)
            return (u * (e ** (-0.5 if inv else 0.5))) @ u.T

        a, b = msqrt(chh, True), msqrt(cyy, True)
        uu, _, vt = torch.linalg.svd(a @ chy @ b)
        q = uu @ vt
        m = w @ a @ q @ msqrt(cyy, False)
    c = my - mx_ @ m
    return m, c


# ------------------------------------------------------------------------------------------------ application


def map_to_receiver(be, sender_kv, sender_ctx_pos, aligned, maps, mapper, sender_shape, receiver_shape,
                    sender_freqs, receiver_freqs, receiver_ctx_pos):
    """The full transfer on one backend: features -> affine map per layer -> receiver RoPE at receiver positions.

    maps[l] = ((Mk, ck), (Mv, cv)) numpy float32. Returns {l: (keys, values)} backend arrays [n_kv, T, D]."""
    n_sender = sender_shape[0]
    n_layers, n_kv, head_dim = receiver_shape
    out = {}
    cache = {}
    for l in range(n_layers):
        layers = tuple(window_layers(l, n_layers, n_sender, mapper))
        if layers not in cache:
            cache = {layers: sender_features(be, sender_kv, sender_ctx_pos, sender_freqs, aligned, layers)}
        xk, xv = cache[layers]
        (mk, ck), (mv, cv) = maps[l]
        yk = be.matmul(xk, be.asarray(mk)) + be.asarray(ck)
        yv = be.matmul(xv, be.asarray(mv)) + be.asarray(cv)
        n = yk.shape[0]
        yk = be.transpose(yk.reshape(n, n_kv, head_dim), (1, 0, 2))
        yv = be.transpose(yv.reshape(n, n_kv, head_dim), (1, 0, 2))
        cos, sin = rotation_tables(receiver_freqs[l], receiver_ctx_pos)
        out[l] = (rotate(be, yk, cos, sin), yv)
    return out
