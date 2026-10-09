"""EXP 008 (latent-handoff) runner, bundle 3 WO-04: the text and control arms and the frozen YES/NO readout.

Arms (arms.mjs is the frozen list):
  A0  text re-prefill: the receiver prefills the whole prompt from text (in prefillStep chunks), then the suffix.
  A1  the sender writes a summary of at most summaryMaxTokens tokens from the frozen summary prompt (deterministic);
      the summary is lint-checked and becomes the receiver's context.
  C1  the receiver's OWN prefix cache, sent through the transfer plumbing (save -> load, mlx-lm prompt-cache format),
      then the suffix only. It must match A0 at KL < c1KlMax on the readout distribution, or the run STOPS.
  C2  a deranged cache: the receiver's prefix cache of ANOTHER item (seeded derangement), then the suffix only.
  C3  no context: the question alone.
  A2a / A2b  the labelled public-baseline mappers (kvmap.py), through the generic Engine.transfer() interface.

Readout: the user turn is <context> + "\\n\\n" + question + " " + answerInstruction, in the receiver's chat template.
The decision is softmax over the two answer token ids at the first assistant position; REJECT when the normalised
p(yes) >= rejectThreshold. Each answer word must be a single token, asserted per receiver.

Every receive phase runs through the zero-prefill counter (counter.py): a KV arm may forward only the suffix.
An OOM or a NaN is an abstention row, counted against the arm. Any other error stops the run.

Runner/scorer split: this runner reads only the strata contexts (sha-checked against strata-manifest.json), the
models and the readout. An audit hook refuses to open any labels / manifest / adjudication / second-pass file, so a
runner that tries to read the answer key throws. score.mjs, a separate process, reads the labels.

  <mlx python> experiments/latent-handoff/runner.py --pair D1 --stratum S --items c001,c002 --out rows.jsonl
"""
import argparse
import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FORBIDDEN = re.compile(r"^(labels.*\.json|manifest.*\.json|adjudication.*|second-pass.*)$")


class GuardRefused(PermissionError):
    pass


def install_guard():
    """Refuse, process-wide, to open the answer key or the author manifests."""

    def hook(event, args):
        if event == "open" and args and isinstance(args[0], (str, bytes, os.PathLike)):
            name = os.path.basename(os.fsdecode(args[0]))
            if FORBIDDEN.match(name):
                raise GuardRefused(f"runner guard: {name} is the scorer's, never the runner's")

    sys.addaudithook(hook)


ARMS_TEXT = ("A0", "A1", "C3")
ARMS_KV = ("C1", "C2", "A2a", "A2b")
ABSTAIN_PATTERNS = ("out of memory", "oom", "insufficient memory", "resource_exhausted")


class Abstain(Exception):
    pass


def load_json(path):
    with open(path) as f:
        return json.load(f)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------------------------------------------- prompt build


def chat_kwargs(model_key, readout):
    if model_key.startswith("qwen3"):
        return {"enable_thinking": False}
    if model_key.startswith("llama"):
        return {"date_string": readout["llamaDateString"]}
    return {}


def render_parts(tokenizer, model_key, context, readout):
    """Render the user turn in the model's chat template; return (head, block, tail) as text.

    The context block is the context with trailing whitespace removed plus the "\n\n" separator, so the block ends
    at a token boundary that whole-string tokenisation also respects (BPE pre-tokenisers merge punctuation with the
    newlines after it). head = template text before the block, tail = question + the template's closing and
    generation prompt. check_boundaries() asserts that whole-string and split tokenisation agree."""
    question = readout["question"] + " " + readout["answerInstruction"]
    block = (context.rstrip() + "\n\n") if context.strip() else ""
    rendered = tokenizer.apply_chat_template(
        [{"role": "user", "content": block + question}], add_generation_prompt=True, tokenize=False, **chat_kwargs(model_key, readout)
    )
    if not block:
        return "", "", rendered
    at = rendered.index(block)
    return rendered[:at], block, rendered[at + len(block):]


def check_boundaries(tokenizer, parts):
    """The split token sequence must equal the whole-string one (what a server tokenising the prompt would see)."""
    enc = lambda s: tokenizer.encode(s, add_special_tokens=False) if s else []
    if enc("".join(parts)) != enc(parts[0]) + enc(parts[1]) + enc(parts[2]):
        raise AssertionError("split tokenisation differs from whole-string tokenisation at a block boundary")


def split_prompt(tokenizer, model_key, context, readout):
    """(prefix_ids, suffix_ids), prefix = template head + context. Head, context and tail are tokenised SEPARATELY
    and concatenated, so the context tokens have clean character spans (the KV mappers align on them) and every arm
    sees the exact same token sequence."""
    head, ctx, tail = render_parts(tokenizer, model_key, context, readout)
    if ctx:
        check_boundaries(tokenizer, (head, ctx, tail))
    enc = lambda s: tokenizer.encode(s, add_special_tokens=False) if s else []
    return enc(head) + enc(ctx), enc(tail)


def answer_ids(tokenizer, readout):
    """The YES / NO token ids; each word must be exactly one token for this receiver."""
    out = {}
    for key in ("yes", "no"):
        ids = tokenizer.encode(readout[key], add_special_tokens=False)
        if len(ids) != 1:
            raise ValueError(f"answer word {readout[key]!r} is {len(ids)} tokens for this receiver; must be 1")
        out[key] = ids[0]
    return out


def derangement(ids, seed):
    """Sattolo's algorithm: a single cycle, so no item keeps its own cache. Deterministic for a seed + id list."""
    order = sorted(ids)
    perm = list(order)
    rng = random.Random(seed)
    for i in range(len(perm) - 1, 0, -1):
        j = rng.randrange(i)
        perm[i], perm[j] = perm[j], perm[i]
    return dict(zip(order, perm))


# ---------------------------------------------------------------------------------------------------- model work


def prefix_kv(model, tokenizer, model_key, context, readout):
    """Prefill (template head + context) on `model`; return the per-layer cache as float32 [n_kv, T, D] arrays, the
    absolute positions of the context tokens, their character offsets, and the head ids."""
    import mlx.core as mx
    from mlx_lm.models.cache import make_prompt_cache

    from kvmap import offsets_of

    head, ctx, _ = render_parts(tokenizer, model_key, context, readout)
    head_ids = tokenizer.encode(head, add_special_tokens=False)
    ctx_ids, offsets = offsets_of(tokenizer, ctx)
    if ctx_ids != tokenizer.encode(ctx, add_special_tokens=False):
        raise AssertionError(f"{model_key}: offset tokenisation differs from encode()")
    cache = make_prompt_cache(model)
    ids = head_ids + ctx_ids
    step = readout["prefillStep"]
    for s in range(0, len(ids), step):
        model(mx.array([ids[s : s + step]]), cache=cache)
        mx.eval([c.state for c in cache])
    kv = {l: (c.state[0][0].astype(mx.float32), c.state[1][0].astype(mx.float32)) for l, c in enumerate(cache)}
    return kv, list(range(len(head_ids), len(ids))), offsets, head_ids


def model_shape(model):
    attn = model.layers[0].self_attn
    head_dim = getattr(model.args, "head_dim", None) or model.args.hidden_size // attn.n_heads
    return (len(model.layers), attn.n_kv_heads, head_dim)


class Engine:
    """The mlx side. Imported lazily so the guard, the prompt logic and the scorer split test without mlx."""

    def __init__(self, receiver_dir, receiver_key, sender_dir, sender_key, readout, receiver_dtype=None):
        import mlx.core as mx
        from mlx_lm import load

        from counter import ForwardCounter

        self.mx = mx
        self.readout = readout
        model, tok = load(receiver_dir)
        if receiver_dtype is not None:  # the parity gate reads out in float32 so the mapper, not bf16 rounding, is tested
            model.set_dtype(getattr(mx, receiver_dtype))
        self.receiver = ForwardCounter(model)
        self.rtok = tok
        self.rkey = receiver_key
        self.sender_dir, self.skey = sender_dir, sender_key
        self._sender = None
        self.ids = answer_ids(tok, readout)

    def sender(self):
        if self._sender is None:
            from mlx_lm import load

            self._sender = load(self.sender_dir)
        return self._sender

    def new_cache(self):
        from mlx_lm.models.cache import make_prompt_cache

        return make_prompt_cache(self.receiver)

    def prefill(self, ids, cache):
        """Forward ids into cache in prefillStep chunks, through the counter. Returns (last logits, ms)."""
        mx = self.mx
        step = self.readout["prefillStep"]
        t0 = time.perf_counter()
        logits = None
        for s in range(0, len(ids), step):
            logits = self.receiver(mx.array([ids[s : s + step]]), cache=cache)
            mx.eval(logits, [c.state for c in cache])
        return logits, (time.perf_counter() - t0) * 1000.0

    def readout_from(self, logits):
        mx = self.mx
        last = logits[0, -1, :].astype(mx.float32)
        lp = last - mx.logsumexp(last)
        mx.eval(lp)
        if bool(mx.any(mx.isnan(lp)).item()):
            raise Abstain("nan-logits")
        ly, ln = lp[self.ids["yes"]].item(), lp[self.ids["no"]].item()
        p_bin = 1.0 / (1.0 + math.exp(ln - ly))
        return lp, {"lpYes": ly, "lpNo": ln, "pYes": math.exp(ly), "pYesBin": p_bin}

    def kl(self, lp_ref, lp):
        mx = self.mx
        v = mx.sum(mx.exp(lp_ref) * (lp_ref - lp))
        mx.eval(v)
        return max(0.0, v.item())

    def roundtrip(self, cache):
        """The transfer plumbing: serialise the cache (mlx-lm prompt-cache safetensors) and load it back."""
        from mlx_lm.models.cache import load_prompt_cache, save_prompt_cache

        with tempfile.TemporaryDirectory(prefix="lh-cache-") as d:
            path = os.path.join(d, "cache.safetensors")
            save_prompt_cache(path, cache)
            loaded = load_prompt_cache(path)
            self.mx.eval([c.state for c in loaded])
            return loaded

    def load_maps(self, path):
        """Mapper weights (calibrate.py output), checked against the sha256 recorded in mappers-<pair>.json."""
        from safetensors.numpy import load_file

        self.maps_file = path
        self._maps = load_file(path)

    def maps_for(self, mapper):
        n_layers = len(self.receiver.layers)
        return {l: ((self._maps[f"{mapper}.l{l}.k.M"], self._maps[f"{mapper}.l{l}.k.c"]),
                    (self._maps[f"{mapper}.l{l}.v.M"], self._maps[f"{mapper}.l{l}.v.c"])) for l in range(n_layers)}

    def head_cache(self, head_ids):
        """The receiver's cache of its own template head: item-independent, computed once, never over a context."""
        if getattr(self, "_head", None) is None or self._head[0] != head_ids:
            cache = self.new_cache()
            self.prefill(head_ids, cache)
            self._head = (head_ids, [(c.state[0], c.state[1]) for c in cache])
        return self._head[1]

    def sender_side(self, context):
        import kvmap

        model, tok = self.sender()
        if getattr(self, "_sfreqs", None) is None:
            self._sshape = model_shape(model)
            self._sfreqs = [kvmap.rope_freqs(layer.self_attn.rope, self._sshape[2]) for layer in model.layers]
            rshape = model_shape(self.receiver)
            self._rshape = rshape
            self._rfreqs = [kvmap.rope_freqs(layer.self_attn.rope, rshape[2]) for layer in self.receiver.layers]
            for i in (0, rshape[0] - 1):
                kvmap.check_rope(self.receiver.layers[i].self_attn.rope, self._rfreqs[i], rshape[2])
        t0 = time.perf_counter()
        kv, pos, offsets, _ = prefix_kv(model, tok, self.skey, context, self.readout)
        return kv, pos, offsets, (time.perf_counter() - t0) * 1000.0

    def transfer(self, mapper, sender_kv, sender_pos, sender_offsets, context, head_cache, head_len, backend="mlx"):
        # `context` is the context BLOCK (render_parts), the same text both sides tokenised
        """transfer(senderCache, senderTokenOffsets, contextText) -> receiver cache. Reads the context TEXT (for the
        receiver's own token offsets) but never runs the receiver over it. backend="torch" computes the same map with
        the torch reference (parity gate); the run time path is MLX."""
        import numpy as np

        import kvmap

        mx = self.mx
        ctx_ids, r_offsets = kvmap.offsets_of(self.rtok, context)
        aligned = kvmap.align(r_offsets, sender_offsets, len(context))
        rpos = list(range(head_len, head_len + len(ctx_ids)))
        if backend == "mlx":
            be, kv = kvmap.MLX(), sender_kv
        else:
            be = kvmap.TORCH()
            kv = {l: (be.asarray(np.array(k)), be.asarray(np.array(v))) for l, (k, v) in sender_kv.items()}
        mapped = kvmap.map_to_receiver(be, kv, sender_pos, aligned, self.maps_for(mapper), mapper,
                                       self._sshape, self._rshape, self._sfreqs, self._rfreqs, rpos)
        if backend != "mlx":
            mapped = {l: (mx.array(be.numpy(k)), mx.array(be.numpy(v))) for l, (k, v) in mapped.items()}
        self.last_mapped = mapped
        cache = self.new_cache()
        for l, c in enumerate(cache):
            hk, hv = head_cache[l]
            k, v = mapped[l]
            c.state = (mx.concatenate([hk, k[None].astype(hk.dtype)], axis=2), mx.concatenate([hv, v[None].astype(hv.dtype)], axis=2))
        mx.eval([c.state for c in cache])
        return cache

    def summarise(self, context):
        from mlx_lm.generate import generate_step

        model, tok = self.sender()
        prompt = self.readout["summaryPrompt"] + "\n\n" + context
        ids = tok.apply_chat_template(
            [{"role": "user", "content": prompt}], add_generation_prompt=True, tokenize=True, **chat_kwargs(self.skey, self.readout)
        )
        if hasattr(ids, "input_ids"):
            ids = ids["input_ids"]
        out = []
        t0 = time.perf_counter()
        for tok_id, _ in generate_step(self.mx.array(ids), model, max_tokens=self.readout["summaryMaxTokens"]):
            t = int(tok_id.item() if hasattr(tok_id, "item") else tok_id)
            if t in tok.eos_token_ids:
                break
            out.append(t)
        return tok.decode(out), len(out), (time.perf_counter() - t0) * 1000.0


# ---------------------------------------------------------------------------------------------------- one item


def lint_summary(text):
    """EXP 005 lint on the summary (gate-facing text), via stdin: never argv."""
    r = subprocess.run(["node", os.path.join(HERE, "lint-stdin.mjs")], input=text, capture_output=True, text=True)
    if r.returncode not in (0, 1):
        raise RuntimeError(f"lint-stdin exit {r.returncode}: {r.stderr}")
    return json.loads(r.stdout)


def run_item(engine, item_id, context, donor_context, arms, lint=lint_summary, order=None, warmups=0, reps=1):
    """Every arm for one item. Returns rows; raises on a C1 or zero-prefill failure.

    Timing protocol (timing.mjs PROTOCOL, passed in by arms.mjs): arms run in `order` (timing.mjs armOrder, a seeded
    permutation per item), each with `warmups` untimed calls then `reps` timed calls; the row reports the median
    ttftMs and every rep. Decoding is deterministic, so every rep must give the same decision (repsConsistent)."""
    from counter import check

    rows = []
    prefix, suffix = split_prompt(engine.rtok, engine.rkey, context, engine.readout)
    ref = {}

    def arm_row(arm, fn):
        engine.mx.reset_peak_memory()
        engine.receiver.reset()
        t0 = time.perf_counter()
        try:
            extra = fn()
        except Abstain as e:
            return {"arm": arm, "abstain": True, "reason": str(e)}
        except (MemoryError, RuntimeError) as e:
            msg = str(e).lower()
            if isinstance(e, MemoryError) or any(p in msg for p in ABSTAIN_PATTERNS):
                return {"arm": arm, "abstain": True, "reason": "oom"}
            raise
        ttft = (time.perf_counter() - t0) * 1000.0
        calls = list(engine.receiver.calls)
        # a KV arm reports its receiver-side time to first token (transfer + suffix); the sender's or donor's own
        # prefill is upstream work, reported separately as senderMs
        ttft = extra.pop("receiverMs", ttft)
        row = {"arm": arm, "abstain": False, "forwardCalls": calls, "suffixLen": len(suffix), "ttftMs": ttft,
               "peakMemGB": engine.mx.get_peak_memory() / 2**30}
        row.update(extra)
        row["decision"] = "REJECT" if row["pYesBin"] >= engine.readout["rejectThreshold"] else "ACCEPT"
        return row

    def a0():
        cache = engine.new_cache()
        _, ms_p = engine.prefill(prefix, cache)
        logits, ms_s = engine.prefill(suffix, cache)
        lp, r = engine.readout_from(logits)
        ref["lp"] = lp
        check("A0", engine.receiver.calls, len(suffix), prompt_len=len(prefix) + len(suffix))
        return {**r, "prefillTok": len(prefix) + len(suffix), "prefillMs": ms_p + ms_s, "promptLen": len(prefix) + len(suffix)}

    def kv_from(donor_prefix, arm):
        # the donor cache is built OUTSIDE the counted phase; the counted phase is the transfer AND the suffix, so a
        # transfer that re-reads the context through the receiver is caught
        cache = engine.new_cache()
        _, ms_donor = engine.prefill(donor_prefix, cache)
        engine.receiver.reset()
        t0 = time.perf_counter()
        moved = engine.roundtrip(cache)
        logits, ms = engine.prefill(suffix, moved)
        lp, r = engine.readout_from(logits)
        received = (time.perf_counter() - t0) * 1000.0
        check(arm, engine.receiver.calls, len(suffix))
        return lp, {**r, "prefillTok": len(suffix), "prefillMs": ms, "senderMs": ms_donor, "receiverMs": received}

    def c1():
        lp, r = kv_from(prefix, "C1")
        if "lp" not in ref:
            raise RuntimeError("C1 needs A0 in the same item")
        r["klVsA0"] = engine.kl(ref["lp"], lp)
        return r

    def c2():
        donor_prefix, _ = split_prompt(engine.rtok, engine.rkey, donor_context, engine.readout)
        _, r = kv_from(donor_prefix, "C2")
        return r

    def c3():
        p, s = split_prompt(engine.rtok, engine.rkey, "", engine.readout)
        cache = engine.new_cache()
        logits, ms = engine.prefill(p + s, cache)
        _, r = engine.readout_from(logits)
        check("C3", engine.receiver.calls, len(s), prompt_len=len(p) + len(s))
        return {**r, "prefillTok": len(p) + len(s), "prefillMs": ms, "promptLen": len(p) + len(s)}

    def a1():
        summary, n, ms_sender = engine.summarise(context)
        findings = lint(summary)
        if findings:
            raise Abstain("summary-fails-lint")
        p, s = split_prompt(engine.rtok, engine.rkey, summary, engine.readout)
        engine.receiver.reset()
        t0 = time.perf_counter()
        cache = engine.new_cache()
        logits, ms = engine.prefill(p + s, cache)
        _, r = engine.readout_from(logits)
        r["receiverMs"] = (time.perf_counter() - t0) * 1000.0
        check("A1", engine.receiver.calls, len(s), prompt_len=len(p) + len(s))
        return {**r, "prefillTok": len(p) + len(s), "prefillMs": ms, "promptLen": len(p) + len(s),
                "summaryTokens": n, "summarySha256": sha256_bytes(summary.encode()), "senderMs": ms_sender}

    def a2(mapper):
        def fn():
            # the sender reads the context and the receiver's head cache is item-independent: both happen before
            # the counted phase, which is the transfer plus the suffix
            head_text, block, _ = render_parts(engine.rtok, engine.rkey, context, engine.readout)
            head_ids = engine.rtok.encode(head_text, add_special_tokens=False)
            head = engine.head_cache(head_ids)
            skv, spos, soff, ms_sender = engine.sender_side(context)
            engine.receiver.reset()
            t0 = time.perf_counter()
            moved = engine.transfer(mapper, skv, spos, soff, block, head, len(head_ids))
            logits, ms = engine.prefill(suffix, moved)
            _, r = engine.readout_from(logits)
            received = (time.perf_counter() - t0) * 1000.0
            check(mapper, engine.receiver.calls, len(suffix))
            return {**r, "prefillTok": len(suffix), "prefillMs": ms, "senderMs": ms_sender, "receiverMs": received, "mapper": mapper}

        return fn

    fns = {"A0": a0, "A1": a1, "C1": c1, "C2": c2, "C3": c3, "A2a": a2("A2a"), "A2b": a2("A2b")}
    order = list(order) if order else (["A0"] + [a for a in arms if a != "A0"] if "C1" in arms else list(arms))
    if sorted(order) != sorted(arms):
        raise ValueError(f"arm order {order} is not a permutation of {arms}")
    c1_before_a0 = "C1" in arms and ("A0" not in arms or order.index("C1") < order.index("A0"))
    if c1_before_a0:
        engine.receiver.reset()
        a0()  # C1's reference distribution, untimed, when A0 has not run yet in this item's order
        engine.receiver.reset()
    for arm in order:
        for _ in range(warmups):
            arm_row(arm, fns[arm])
        runs = [arm_row(arm, fns[arm]) for _ in range(reps)]
        row = runs[-1]
        if not row["abstain"]:
            ms = sorted(r["ttftMs"] for r in runs if not r["abstain"])
            row["msReps"] = [r["ttftMs"] for r in runs]
            row["ttftMs"] = ms[len(ms) // 2] if len(ms) % 2 else (ms[len(ms) // 2 - 1] + ms[len(ms) // 2]) / 2
            row["repsConsistent"] = all(not r["abstain"] and r["decision"] == row["decision"] and r["pYesBin"] == row["pYesBin"] for r in runs)
            row["armOrder"] = order
        if arm == "C1" and not row["abstain"] and not row["klVsA0"] < engine.readout["c1KlMax"]:
            raise SystemExit(f"STOP: C1 KL {row['klVsA0']:.3e} >= {engine.readout['c1KlMax']} on {item_id}: fix the plumbing forward")
        row.update({"itemId": item_id, "prefixLen": len(prefix)})
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------------------------------- driver


def mem_gate(footprint_gb, peak_gb, untimed=False, bound_gb=24.0):
    """Wait on the shared memory gate (mem-gate.mjs --wait); returns its readings for the row. `untimed` (calibration,
    downloads) drops only the load criterion, which protects timings; memory, swap, server and footprint still hold."""
    cmd = ["node", os.path.join(HERE, "mem-gate.mjs"), "--wait", "--footprint-gb", str(footprint_gb), "--peak-gb", str(peak_gb),
           "--max-footprint-gb", str(bound_gb)]
    r = subprocess.run(cmd + (["--untimed"] if untimed else []), capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"mem-gate exit {r.returncode}: {r.stderr.strip()}")
    return json.loads(r.stdout)["readings"]


PAUSED = 75  # exit code: the gate failed between items; rows so far are kept and the driver resumes the run


def pair_footprint(models, pair):
    """The pair's footprint for the memory gate: max(weights, measured peak in footprints.json)."""
    return pair_bounds(models, pair)[0]


def pair_bounds(models, pair):
    """(footprint, bound): footprint = max(weights, measured peak); bound = the pair's boundGB (24 GB by default)."""
    weights = sum(models["models"][pair[k]]["convert"]["weightsGB"] for k in ("sender", "receiver"))
    path = os.path.join(HERE, "footprints.json")
    measured, bound = 0.0, 24.0
    if os.path.exists(path):
        for name, p in load_json(path)["pairs"].items():
            if models["pairs"].get(name) == pair:
                measured, bound = p["peakGB"], p.get("boundGB", 24.0)
    return round(max(weights, measured), 2), bound


def mem_check(footprint_gb, own_gb=0.0, untimed=True, peak_gb=0.0, bound_gb=24.0):
    """One non-blocking gate reading (mem-gate.mjs --check). own_gb is what the calling run itself holds, added back so
    a resumable run never waits on its own memory. Returns (ok, verdict)."""
    cmd = ["node", os.path.join(HERE, "mem-gate.mjs"), "--check", "--footprint-gb", str(footprint_gb), "--own-gb", f"{own_gb:.2f}",
           "--peak-gb", str(peak_gb), "--max-footprint-gb", str(bound_gb)]
    r = subprocess.run(cmd + (["--untimed"] if untimed else []), capture_output=True, text=True)
    if r.returncode not in (0, 4):
        raise SystemExit(f"mem-gate exit {r.returncode}: {r.stderr.strip()}")
    v = json.loads(r.stdout)
    return v["ok"], v


def load_context(strata_dir, manifest, item_id, stratum):
    entry = next((i for i in manifest["items"] if i["id"] == item_id), None)
    if entry is None:
        raise SystemExit(f"{item_id} is not in strata-manifest.json")
    with open(os.path.join(strata_dir, f"{item_id}.{stratum}.txt"), "rb") as f:
        b = f.read()
    if sha256_bytes(b) != entry["strata"][stratum]["sha256"]:
        raise SystemExit(f"{item_id}.{stratum}: context bytes differ from strata-manifest.json")
    return b.decode()


def main(argv=None):
    install_guard()
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", required=True)
    ap.add_argument("--stratum", required=True, choices=["S", "M", "L"])
    ap.add_argument("--items", required=True)
    ap.add_argument("--arms", default="A0,A1,C1,C2,C3")
    ap.add_argument("--out", required=True)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--peak-gb", type=float, default=0.0)
    ap.add_argument("--orders", help="JSON file {itemId: [arm, ...]} from timing.mjs armOrder (arms.mjs writes it)")
    ap.add_argument("--warmups", type=int, default=0)
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--attempt", type=int, default=0, help="timing re-queue attempt (arms.mjs)")
    ap.add_argument("--untimed", action="store_true", help="a memory-only measurement: the load criterion is skipped (recorded)")
    ap.add_argument("--strata-dir", default=os.path.join(os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff")), "strata"))
    a = ap.parse_args(argv)

    readout = load_json(os.path.join(HERE, "readout.json"))
    gate_q = load_json(os.path.join(HERE, "..", "jev-gate", "gate-question.json"))
    if gate_q["instructions"] != readout["question"]:
        raise SystemExit("readout.json question differs from the EXP 005 gate question")
    models = load_json(os.path.join(HERE, "models.json"))
    manifest = load_json(os.path.join(HERE, "strata-manifest.json"))
    pair = models["pairs"][a.pair]
    cache_root = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))
    footprint, bound = pair_bounds(models, pair)
    arms = a.arms.split(",")
    items = a.items.split(",")
    all_ids = [i["id"] for i in manifest["items"]]
    donors = derangement(all_ids, readout["derangementSeed"])

    # resume: an item whose every requested arm already has a row for this run id is done
    done = set()
    if os.path.exists(a.out):
        have = {}
        with open(a.out) as fh:
            for line in fh:
                r = json.loads(line)
                if r.get("runId") == a.run_id and r.get("attempt", 0) == a.attempt:
                    have.setdefault(r["itemId"], set()).add(r["arm"])
        done = {i for i, got in have.items() if set(arms) <= got}
    items = [i for i in items if i not in done]
    if not items:
        return
    # the strict gate, before anything of this run is resident
    ok, verdict = mem_check(footprint, 0.0, untimed=a.untimed, peak_gb=a.peak_gb, bound_gb=bound)
    if not ok:
        print(f"gate not clear: {verdict['failures']}", file=sys.stderr)
        sys.exit(PAUSED)
    engine = Engine(os.path.join(cache_root, "mlx", pair["receiver"]), pair["receiver"],
                    os.path.join(cache_root, "mlx", pair["sender"]), pair["sender"], readout)
    if any(x in arms for x in ("A2a", "A2b")):
        record = load_json(os.path.join(HERE, f"mappers-{a.pair}.json"))
        wpath = os.path.join(cache_root, "mappers", record["weights"]["file"])
        with open(wpath, "rb") as fh:
            if sha256_bytes(fh.read()) != record["weights"]["sha256"]:
                raise SystemExit(f"{wpath}: mapper weights differ from mappers-{a.pair}.json")
        engine.load_maps(wpath)
    with open(a.out, "a") as out:
        for n, item_id in enumerate(items):
            # between items the run adds its own resident memory back, so it never waits on itself; a failing gate
            # pauses the run (rows kept) and the driver resumes it once the strict gate passes again
            own = 0.0 if n == 0 else (engine.mx.get_active_memory() + engine.mx.get_cache_memory()) / 2**30
            ok, verdict = (True, verdict) if n == 0 else mem_check(footprint, own, untimed=a.untimed, peak_gb=a.peak_gb, bound_gb=bound)
            if not ok:
                print(f"paused before {item_id}: {verdict['failures']}", file=sys.stderr)
                sys.exit(PAUSED)
            gate = {**verdict["readings"], "ownGB": round(own, 2)}
            context = load_context(a.strata_dir, manifest, item_id, a.stratum)
            donor = load_context(a.strata_dir, manifest, donors[item_id], a.stratum) if "C2" in arms else None
            orders = load_json(a.orders) if a.orders else {}
            item_rows = run_item(engine, item_id, context, donor, arms, order=orders.get(item_id), warmups=a.warmups, reps=a.reps)
            own_after = (engine.mx.get_active_memory() + engine.mx.get_cache_memory()) / 2**30
            _, after = mem_check(footprint, own_after, untimed=a.untimed, peak_gb=a.peak_gb, bound_gb=bound)
            gate_after = {**after["readings"], "ownGB": round(own_after, 2)}
            for row in item_rows:
                row.update({"runId": a.run_id, "pair": a.pair, "stratum": a.stratum, "gate": gate, "gateAfter": gate_after,
                            "attempt": a.attempt, "loadCheckSkipped": a.untimed,
                            "sender": models["models"][pair["sender"]]["repo"], "receiver": models["models"][pair["receiver"]]["repo"],
                            "donor": donors[item_id] if row["arm"] == "C2" else None,
                            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                out.write(json.dumps(row, sort_keys=True) + "\n")
                out.flush()
            engine.mx.clear_cache()


if __name__ == "__main__":
    main()
