"""EXP 008 (latent-handoff) mapper calibration, bundle 3 WO-05 — Mac-only (the WO's pre-stated fallback).

  <mlx python> experiments/latent-handoff/calibrate.py --pair D1 --supervise

Memory: the strict gate is checked before the models are loaded. Between segments the run adds its own MLX footprint
back (it never waits on itself); if the gate still fails it writes its streamed statistics to a checkpoint and exits,
and the supervisor (which holds nothing) waits on the strict gate and resumes from the checkpoint.

1. Fetch the public calibration text (calib-sources.json: pinned commits, every file checked by sha256), concatenate
   it with file headers, drop every line that equals an added line of an EXP 005 / EXP 008-X patch (disjoint by
   construction), and cut it into segments of about SEGMENT_CHARS characters at line boundaries.
2. Run the sender and the receiver over every segment, each inside its own chat-template head (as at run time).
   The memory gate is waited on before every segment. Per receiver layer, stream the sufficient statistics of
   (sender features -> receiver targets) for keys and values: n, sums, X'X, X'Y, Y'Y (MLX float32 at float32 accuracy
   via kvmap.MLX.matmul, mean-shifted by the first segment so the centred covariances do not cancel).
3. Fit A2a (ridge on the depth-matched layer) and A2b (ridge on layers -4/0/+4 then Procrustes recolor) in torch
   float64 (kvmap.fit_layer), and write the maps (float32 safetensors) to the model cache.
4. Write mappers-<pair>.json: calibration text sha256 and token counts, the fit constants, the weight file sha256,
   the wall time. Mapper weights are never committed (v1 publishes no weights); their hashes are.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kvmap  # noqa: E402
from runner import pair_bounds, install_guard, load_json, mem_check, mem_gate, model_shape, prefix_kv  # noqa: E402

SEGMENT_CHARS = 6000
PAUSED = 75  # exit code: statistics checkpointed, the gate failed between segments; the supervisor resumes
ALPHA = 1e-3  # ridge strength: lambda = ALPHA * trace(Cxx) / d (frozen before any fit)
CACHE_ROOT = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))


def fetch_sources(spec, root):
    os.makedirs(root, exist_ok=True)
    parts = []
    for f in spec["files"]:
        path = os.path.join(root, f["repo"].replace("/", "_"), f["path"])
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with urllib.request.urlopen(f["url"]) as r:
                data = r.read()
            with open(path + ".part", "wb") as out:
                out.write(data)
            os.replace(path + ".part", path)
        with open(path, "rb") as fh:
            b = fh.read()
        if hashlib.sha256(b).hexdigest() != f["sha256"]:
            raise SystemExit(f"{f['repo']}/{f['path']}: sha256 differs from calib-sources.json")
        parts.append(f"=== {f['repo']}/{f['path']} ===\n" + b.decode("utf-8"))
    return "\n".join(parts)


def machine():
    """The calibration host, recorded for the pre-registration limits (model + chip + memory, no identifiers)."""
    import platform

    def sysctl(name):
        r = __import__("subprocess").run(["sysctl", "-n", name], capture_output=True, text=True)
        return r.stdout.strip()

    return {"model": sysctl("hw.model"), "chip": sysctl("machdep.cpu.brand_string"),
            "memoryGB": round(int(sysctl("hw.memsize") or 0) / 2**30), "os": platform.mac_ver()[0]}


def eval_lines():
    """Every added line (trimmed, >= 8 characters) of every EXP 005 and EXP 008-X patch: the evaluation text."""
    import glob

    out = set()
    for pattern in ("../jev-gate/corpus/c*.patch", "corpus-x/corpus/c*.patch"):
        for path in sorted(glob.glob(os.path.join(HERE, pattern))):
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("+") and not line.startswith("+++") and len(line[1:].strip()) >= 8:
                        out.add(line[1:].strip())
    return out


def disjoint(text):
    """Drop every calibration line that equals an evaluation line, so the calibration set is disjoint by construction
    (it removes generic lines such as `return true;`). Returns (text, dropped count)."""
    banned = eval_lines()
    kept, dropped = [], 0
    for line in text.split("\n"):
        if line.strip() in banned:
            dropped += 1
        else:
            kept.append(line)
    return "\n".join(kept), dropped


def segments(text, size=SEGMENT_CHARS):
    out, cur = [], []
    n = 0
    for line in text.split("\n"):
        if n + len(line) + 1 > size and cur:
            out.append("\n".join(cur))
            cur, n = [], 0
        cur.append(line)
        n += len(line) + 1
    if cur:
        out.append("\n".join(cur))
    # chat templates trim the user turn, so a segment carries no leading or trailing whitespace
    return [s.strip() for s in out if s.strip()]


def save_checkpoint(path, text_sha, stats, shift, next_index, tokens, elapsed):
    """Streamed statistics + shifts to disk (float32 .npz) and the position to resume from."""
    arrays = {}
    for (l, kind), st in stats.items():
        for f in ("sx", "sy", "xtx", "xty", "yty"):
            arrays[f"s.{l}.{kind}.{f}"] = np.array(st[f])
        arrays[f"n.{l}.{kind}"] = np.array(st["n"])
    for (l, kind), (xs, ys) in shift.items():
        arrays[f"shift.{l}.{kind}.x"], arrays[f"shift.{l}.{kind}.y"] = np.array(xs), np.array(ys)
    np.savez(path + ".tmp.npz", **arrays)
    os.replace(path + ".tmp.npz", path + ".npz")
    with open(path + ".json", "w") as fh:
        json.dump({"textSha256": text_sha, "next": next_index, "tokens": tokens, "elapsed": elapsed}, fh)


def load_checkpoint(path, text_sha):
    """(stats, shift, start, tokens, elapsed): empty for a fresh run; a checkpoint of other text is refused."""
    import mlx.core as mx

    if not os.path.exists(path + ".json"):
        return {}, {}, 0, 0, 0.0
    meta = load_json(path + ".json")
    if meta["textSha256"] != text_sha:
        raise SystemExit("checkpoint was written for different calibration text; remove it to start fresh")
    z = np.load(path + ".npz")
    stats, shift = {}, {}
    for name in z.files:
        parts = name.split(".")
        if parts[0] == "s":
            l, kind, f = int(parts[1]), parts[2], parts[3]
            stats.setdefault((l, kind), {})[f] = mx.array(z[name])
        elif parts[0] == "n":
            stats.setdefault((int(parts[1]), parts[2]), {})["n"] = int(z[name])
        else:
            l, kind, which = int(parts[1]), parts[2], parts[3]
            pair = shift.setdefault((l, kind), [None, None])
            pair[0 if which == "x" else 1] = mx.array(z[name])
    shift = {k: tuple(v) for k, v in shift.items()}
    print(f"resuming at segment {meta['next'] + 1} from the checkpoint", file=sys.stderr)
    return stats, shift, meta["next"], meta["tokens"], meta["elapsed"]


class Side:
    """One model (sender or receiver): its tokenizer, RoPE frequencies and a prefix-cache runner."""

    def __init__(self, key, readout):
        from mlx_lm import load

        self.key, self.readout = key, readout
        self.model, self.tok = load(os.path.join(CACHE_ROOT, "mlx", key))
        attn = [layer.self_attn for layer in self.model.layers]
        self.n_layers, self.n_kv, self.head_dim = model_shape(self.model)
        self.freqs = [kvmap.rope_freqs(a.rope, self.head_dim) for a in attn]
        for i in (0, self.n_layers - 1):
            kvmap.check_rope(attn[i].rope, self.freqs[i], self.head_dim)

    def shape(self):
        return (self.n_layers, self.n_kv, self.head_dim)

    def prefix_kv(self, context):
        kv, pos, offsets, _ = prefix_kv(self.model, self.tok, self.key, context, self.readout)
        return kv, pos, offsets


def calibrate(pair_name):
    import mlx.core as mx

    install_guard()
    readout = load_json(os.path.join(HERE, "readout.json"))
    models = load_json(os.path.join(HERE, "models.json"))
    spec = load_json(os.path.join(HERE, "calib-sources.json"))
    pair = models["pairs"][pair_name]
    text, dropped = disjoint(fetch_sources(spec, os.path.join(CACHE_ROOT, "calib")))
    segs = segments(text)
    footprint, bound = pair_bounds(models, pair)
    be = kvmap.MLX()
    ckpt = os.path.join(CACHE_ROOT, f"calib-ckpt-{pair_name}")
    text_sha = hashlib.sha256(text.encode()).hexdigest()
    stats, shift, start, tokens, elapsed = load_checkpoint(ckpt, text_sha)
    # a fresh invocation is judged on the raw reading: nothing of this run is resident yet
    ok, verdict = mem_check(footprint, 0.0, bound_gb=bound)
    if not ok:
        print(f"gate not clear before loading models: {verdict['failures']}", file=sys.stderr)
        sys.exit(PAUSED)
    t0 = time.time()
    sender, receiver = Side(pair["sender"], readout), Side(pair["receiver"], readout)
    n_r = receiver.n_layers
    for i in range(start, len(segs)):
        seg = segs[i]
        if i > start:
            own = (mx.get_active_memory() + mx.get_cache_memory()) / 2**30
            ok, verdict = mem_check(footprint, own, bound_gb=bound)
            if not ok:
                save_checkpoint(ckpt, text_sha, stats, shift, i, tokens, elapsed + time.time() - t0)
                print(f"paused before segment {i + 1}: {verdict['failures']}; checkpoint written", file=sys.stderr)
                sys.exit(PAUSED)
        skv, spos, soff = sender.prefix_kv(seg)
        rkv, rpos, roff = receiver.prefix_kv(seg)
        aligned = kvmap.align(roff, soff, len(seg))
        tokens += len(rpos)
        feats = {}
        for l in range(n_r):
            layers = tuple(kvmap.window_layers(l, n_r, sender.n_layers, "A2b"))
            if layers not in feats:
                feats = {layers: kvmap.sender_features(be, skv, spos, sender.freqs, aligned, layers)}
            xk, xv = feats[layers]
            yk, yv = kvmap.receiver_targets(be, rkv, rpos, receiver.freqs, l)
            for kind, x, y in (("k", xk, yk), ("v", xv, yv)):
                key = (l, kind)
                if key not in shift:
                    shift[key] = (mx.mean(x, axis=0), mx.mean(y, axis=0))
                x = x - shift[key][0]
                y = y - shift[key][1]
                s = stats.get(key)
                upd = {"n": x.shape[0], "sx": mx.sum(x, axis=0), "sy": mx.sum(y, axis=0),
                       "xtx": be.matmul(x.T, x), "xty": be.matmul(x.T, y), "yty": be.matmul(y.T, y)}
                stats[key] = upd if s is None else {k: s[k] + upd[k] for k in upd}
            mx.eval([stats[(l, kd)][f] for kd in ("k", "v") for f in ("sx", "sy", "xtx", "xty", "yty")])
        del skv, rkv, feats
        mx.clear_cache()
        print(f"segment {i + 1}/{len(segs)}: {len(rpos)} receiver tokens", file=sys.stderr, flush=True)
    calib_s = elapsed + time.time() - t0

    import torch
    from safetensors.numpy import save_file

    weights = {}
    n_s = sender.n_layers
    for l in range(n_r):
        layers = kvmap.window_layers(l, n_r, n_s, "A2b")
        mid = layers.index(kvmap.matched_layer(l, n_r, n_s))
        for kind in ("k", "v"):
            s = stats[(l, kind)]
            t = {k: (torch.tensor(np.array(v), dtype=torch.float64) if k != "n" else float(v)) for k, v in s.items()}
            d = sender.n_kv * sender.head_dim
            sl = slice(mid * d, (mid + 1) * d)
            t_a = {"n": t["n"], "sx": t["sx"][sl], "sy": t["sy"], "xtx": t["xtx"][sl, sl], "xty": t["xty"][sl], "yty": t["yty"]}
            sx_shift, sy_shift = (np.array(v, dtype=np.float64) for v in shift[(l, kind)])
            for mapper, st, xs in (("A2a", t_a, sx_shift[sl]), ("A2b", t, sx_shift)):
                m, c = kvmap.fit_layer(st, mapper, ALPHA)
                # undo the shift: the map was fitted on (x - xs) -> (y - ys), so y = x @ M + (c + ys - xs @ M)
                c = c.numpy() + sy_shift - xs @ m.numpy()
                weights[f"{mapper}.l{l}.{kind}.M"] = m.numpy().astype(np.float32)
                weights[f"{mapper}.l{l}.{kind}.c"] = c.astype(np.float32)
    out_dir = os.path.join(CACHE_ROOT, "mappers")
    os.makedirs(out_dir, exist_ok=True)
    wpath = os.path.join(out_dir, f"mappers-{pair_name}.safetensors")
    save_file(weights, wpath)
    with open(wpath, "rb") as fh:
        wsha = hashlib.sha256(fh.read()).hexdigest()
    record = {
        "schemaVersion": 1,
        "pair": pair_name,
        "sender": models["models"][pair["sender"]]["repo"],
        "receiver": models["models"][pair["receiver"]]["repo"],
        "labels": {
            "A2a": "our extension of arXiv 2608.03893 (per-head ridge, RoPE-stripped keys) to a cross-tokenizer pair",
            "A2b": "our reimplementation of HeteroFold (arXiv 2609.32259) from the paper's description; closed-form fit, output-aware calibration not reproduced",
        },
        "calibration": {
            "where": "Mac-only calibration (no GPU account), per pre-stated fallback",
            "machine": machine(),
            "sourcesSha256": hashlib.sha256(open(os.path.join(HERE, "calib-sources.json"), "rb").read()).hexdigest(),
            "textSha256": hashlib.sha256(text.encode()).hexdigest(),
            "linesDroppedAsEvalOverlap": dropped,
            "segments": len(segs),
            "segmentChars": SEGMENT_CHARS,
            "receiverTokens": tokens,
            "wallSeconds": round(calib_s, 1),
        },
        "fit": {"alpha": ALPHA, "lambda": "alpha * trace(Cxx) / d", "window": list(kvmap.WINDOW), "precision": "statistics MLX float32 (mean-shifted), fit torch float64, weights float32"},
        "weights": {"file": f"mappers-{pair_name}.safetensors", "sha256": wsha, "tensors": len(weights)},
        "toolchain": {"mlx": mx.__version__, "torch": torch.__version__},
    }
    with open(os.path.join(HERE, f"mappers-{pair_name}.json"), "w") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")
    for ext in (".npz", ".json"):
        if os.path.exists(ckpt + ext):
            os.remove(ckpt + ext)
    print(json.dumps(record["calibration"]), file=sys.stderr)


def supervise(pair_name):
    """Holds nothing in memory: waits on the strict gate, runs one calibration pass as a child, and resumes it from its
    checkpoint whenever the child pauses (exit PAUSED). Never touches any other process."""
    import subprocess

    models = load_json(os.path.join(HERE, "models.json"))
    pair = models["pairs"][pair_name]
    footprint, bound = pair_bounds(models, pair)
    while True:
        mem_gate(footprint, 0, untimed=True, bound_gb=bound)
        rc = subprocess.run([sys.executable, "-B", os.path.abspath(__file__), "--pair", pair_name]).returncode
        if rc != PAUSED:
            return rc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", required=True)
    ap.add_argument("--supervise", action="store_true", help="resume across memory-gate pauses (recommended)")
    a = ap.parse_args()
    sys.exit(supervise(a.pair) if a.supervise else calibrate(a.pair))
