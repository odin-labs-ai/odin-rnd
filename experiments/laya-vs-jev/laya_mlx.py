"""Laya typed-decisions forward pass in MLX (Apple silicon), no torch.

Ports, component by component:
  * the ModernBERT-large encoder (transformers ModernBertModel: embeddings + LayerNorm,
    28 pre-norm layers with GeGLU MLP, rotary attention, global attention every 3rd layer
    and a +-64 token sliding window otherwise, final LayerNorm);
  * the upstream decision head (rl_common.DecisionModel: type embedding, two
    torch.nn.TransformerEncoderLayer blocks with norm_first=True and ReLU feed-forward,
    the per-option [MASK] scorer and the act head).
Weights are the pinned fp16 safetensors, computed in float32 like the CPU reference.
"""
import json
import math
import os

import mlx.core as mx
import numpy as np

from laya_inputs import QTYPES


def _gelu(x):  # exact (erf) GELU, as torch.nn.GELU() and transformers "gelu"
    return 0.5 * x * (1.0 + mx.erf(x / math.sqrt(2.0)))


def _ln(x, w, b, eps=1e-5):
    return mx.fast.layer_norm(x, w, b, eps)


def _rotate_half(x):
    h = x.shape[-1] // 2
    return mx.concatenate([-x[..., h:], x[..., :h]], axis=-1)


class LayaMLX:
    def __init__(self, model_dir, dtype=mx.float32):
        with open(os.path.join(model_dir, "rl_agent_config.json")) as f:
            self.cfg = json.load(f)
        with open(os.path.join(model_dir, "encoder", "config.json")) as f:
            self.ecfg = json.load(f)
        raw = mx.load(os.path.join(model_dir, "model.safetensors"))
        self.w = {k: v.astype(dtype) for k, v in raw.items()}
        mx.eval(list(self.w.values()))
        e = self.ecfg
        self.d = e["hidden_size"]
        self.n_heads = e["num_attention_heads"]
        self.head_dim = self.d // self.n_heads
        self.n_layers = e["num_hidden_layers"]
        self.layer_types = e["layer_types"]
        self.window = e["local_attention"] // 2
        self.eps = e["norm_eps"]
        self.inv_freq = {t: 1.0 / (p["rope_theta"] ** (np.arange(0, self.head_dim, 2, dtype=np.float32) / self.head_dim))
                         for t, p in e["rope_parameters"].items()}
        self.head_layers = self.cfg["head_layers"]
        self.head_heads = max(1, self.d // 64)

    # ------------------------------------------------------------------ encoder
    def _rope(self, n, layer_type):
        pos = np.arange(n, dtype=np.float32)
        freqs = pos[:, None] * self.inv_freq[layer_type][None, :]
        emb = np.concatenate([freqs, freqs], axis=-1)
        return mx.array(np.cos(emb)), mx.array(np.sin(emb))

    def _encoder(self, ids):
        w, n = self.w, len(ids)
        h = w["encoder.embeddings.tok_embeddings.weight"][mx.array(ids)][None]
        h = _ln(h, w["encoder.embeddings.norm.weight"], None, self.eps)
        rope = {t: self._rope(n, t) for t in set(self.layer_types)}
        idx = np.arange(n)
        far = np.abs(idx[:, None] - idx[None, :]) > self.window
        sliding_mask = mx.array(np.where(far, -np.inf, 0.0).astype(np.float32))
        for i in range(self.n_layers):
            p = "encoder.layers.%d." % i
            lt = self.layer_types[i]
            x = h if i == 0 else _ln(h, w[p + "attn_norm.weight"], None, self.eps)
            qkv = (x @ w[p + "attn.Wqkv.weight"].T).reshape(1, n, 3, self.n_heads, self.head_dim)
            q, k, v = (qkv[:, :, j].transpose(0, 2, 1, 3) for j in range(3))
            cos, sin = rope[lt]
            q = q * cos + _rotate_half(q) * sin
            k = k * cos + _rotate_half(k) * sin
            mask = sliding_mask if lt == "sliding_attention" else None
            a = mx.fast.scaled_dot_product_attention(q, k, v, scale=self.head_dim ** -0.5, mask=mask)
            a = a.transpose(0, 2, 1, 3).reshape(1, n, self.d)
            h = h + a @ w[p + "attn.Wo.weight"].T
            x = _ln(h, w[p + "mlp_norm.weight"], None, self.eps)
            inp, gate = mx.split(x @ w[p + "mlp.Wi.weight"].T, 2, axis=-1)
            h = h + (_gelu(inp) * gate) @ w[p + "mlp.Wo.weight"].T
        return _ln(h, w["encoder.final_norm.weight"], None, self.eps)

    # ------------------------------------------------------------------ decision head
    def _head_layer(self, h, i):
        w, p = self.w, "head.layers.%d." % i
        n = h.shape[1]
        x = _ln(h, w[p + "norm1.weight"], w[p + "norm1.bias"])
        qkv = x @ w[p + "self_attn.in_proj_weight"].T + w[p + "self_attn.in_proj_bias"]
        hd = self.d // self.head_heads
        q, k, v = (t.reshape(1, n, self.head_heads, hd).transpose(0, 2, 1, 3) for t in mx.split(qkv, 3, axis=-1))
        a = mx.fast.scaled_dot_product_attention(q, k, v, scale=hd ** -0.5)
        a = a.transpose(0, 2, 1, 3).reshape(1, n, self.d)
        h = h + a @ w[p + "self_attn.out_proj.weight"].T + w[p + "self_attn.out_proj.bias"]
        x = _ln(h, w[p + "norm2.weight"], w[p + "norm2.bias"])
        ff = mx.maximum(x @ w[p + "linear1.weight"].T + w[p + "linear1.bias"], 0)
        return h + ff @ w[p + "linear2.weight"].T + w[p + "linear2.bias"]

    def forward(self, ids, markers, qtype_name):
        """One sequence -> (uncalibrated option logits [k], act probabilities [n_act]) as numpy float64."""
        w = self.w
        h = self._encoder(ids)
        h = h + w["type_emb.weight"][QTYPES[qtype_name]][None, None, :]
        for i in range(self.head_layers):
            h = self._head_layer(h, i)
        m = h[0, mx.array(markers)]
        m = _ln(m, w["scorer.0.weight"], w["scorer.0.bias"])
        m = _gelu(m @ w["scorer.1.weight"].T + w["scorer.1.bias"])
        logits = (m @ w["scorer.3.weight"].T + w["scorer.3.bias"])[:, 0]
        p = mx.softmax(logits)
        k = len(markers)
        ent = -(p * mx.log(mx.maximum(p, 1e-9))).sum() / math.log(max(k, 2))
        top2 = mx.sort(p)[::-1][:2]
        feats = mx.stack([top2[0], top2[0] - top2[1], ent, mx.array(max(k, 2) / 255.0)])
        pooled = mx.concatenate([h[0, 0], feats])
        act = _gelu(pooled @ w["act_head.0.weight"].T + w["act_head.0.bias"]) @ w["act_head.2.weight"].T + w["act_head.2.bias"]
        act = mx.softmax(act)
        mx.eval(logits, act)
        return np.array(logits, dtype=np.float64), np.array(act, dtype=np.float64)
