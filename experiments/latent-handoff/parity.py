"""EXP 008 (latent-handoff) mapper parity gate, bundle 3 WO-05.

  <mlx python> experiments/latent-handoff/parity.py --pair D1

For each of 20 held-out parity contexts (p01..p20: segments of the pinned held-out public file in calib-sources.json
"parityHeldOut", minus every line that is calibration or evaluation text; NEVER an EXP 005 / 008-X item, so parity reads
out no counted item) and each mapper (A2a, A2b), the same
sender cache is mapped twice: by the MLX port (the run-time path) and by the torch reference (kvmap on the TORCH
backend, float32 CPU). Both mapped caches are read out by the same MLX receiver. The gate PASSES only if the decisions
agree on 20/20 items and max |delta p(yes)| <= 1e-3 for both mappers; any mismatch FAILS the run (exit 1).

The BINDING gate (--dtype float32) reads out with the receiver and its cache in float32, on MLX's CPU stream (true
float32; the GPU float32 matmul is reduced precision), so the unit under test is the mapper port (run on the GPU). The run-time path keeps the receiver in bfloat16, where one bf16 ulp in a cache element can move the
readout by a whole bf16 logit step (about 0.03 in p near 0.5); that comparison is recorded as INFORMATIONAL
(--dtype bfloat16) and disclosed, never used to pass the gate.
Writes parity-<pair>.json: {binding, informational}, each with per item p values and max |delta| of the mapped K / V.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CACHE_ROOT_P = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))
from calibrate import disjoint, fetch_sources, segments  # noqa: E402
from runner import pair_bounds, PAUSED, Engine, install_guard, load_json, mem_check, render_parts, sha256_bytes, split_prompt  # noqa: E402

PARITY_ITEMS = [f"p{i:02d}" for i in range(1, 21)]
PARITY_CHARS = 1500
MAX_DP = 1e-3


def main():
    import mlx.core as mx

    install_guard()
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", required=True)
    ap.add_argument("--dtype", choices=["float32", "bfloat16"], default="float32")
    a = ap.parse_args()
    cache_root = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))
    readout = load_json(os.path.join(HERE, "readout.json"))
    models = load_json(os.path.join(HERE, "models.json"))
    spec = load_json(os.path.join(HERE, "calib-sources.json"))
    calib_lines = {l.strip() for l in fetch_sources(spec, os.path.join(CACHE_ROOT_P, "calib")).split("\n") if len(l.strip()) >= 8}
    held, _ = disjoint(fetch_sources(spec["parityHeldOut"], os.path.join(CACHE_ROOT_P, "calib")))
    held = "\n".join(l for l in held.split("\n") if l.strip() not in calib_lines)
    contexts = dict(zip(PARITY_ITEMS, segments(held, PARITY_CHARS)))
    if len(contexts) != len(PARITY_ITEMS):
        raise SystemExit("held-out parity text is too short for 20 contexts")
    record = load_json(os.path.join(HERE, f"mappers-{a.pair}.json"))
    pair = models["pairs"][a.pair]
    wpath = os.path.join(cache_root, "mappers", record["weights"]["file"])
    with open(wpath, "rb") as fh:
        if sha256_bytes(fh.read()) != record["weights"]["sha256"]:
            raise SystemExit("mapper weights differ from their record")
    footprint, bound = pair_bounds(models, pair)
    ok, verdict = mem_check(footprint, 0.0, bound_gb=bound)  # strict, before anything is resident
    if not ok:
        print(f"gate not clear: {verdict['failures']}", file=sys.stderr)
        sys.exit(PAUSED)
    engine = Engine(os.path.join(cache_root, "mlx", pair["receiver"]), pair["receiver"],
                    os.path.join(cache_root, "mlx", pair["sender"]), pair["sender"], readout,
                    receiver_dtype=a.dtype)
    engine.load_maps(wpath)
    rows = []
    t0 = time.time()
    for item in PARITY_ITEMS:
        own = (mx.get_active_memory() + mx.get_cache_memory()) / 2**30
        ok, verdict = mem_check(footprint, own, bound_gb=bound)  # adds this run's own memory back; a failure pauses (rerun to resume)
        if not ok:
            print(f"paused before {item}: {verdict['failures']}", file=sys.stderr)
            sys.exit(PAUSED)
        context = contexts[item]
        prefix, suffix = split_prompt(engine.rtok, engine.rkey, context, readout)
        head_text, block, _ = render_parts(engine.rtok, engine.rkey, context, readout)
        head_ids = engine.rtok.encode(head_text, add_special_tokens=False)
        head = engine.head_cache(head_ids)
        skv, spos, soff, _ = engine.sender_side(context)
        for mapper in ("A2a", "A2b"):
            out = {}
            mapped = {}
            for backend in ("mlx", "torch"):
                cache = engine.transfer(mapper, skv, spos, soff, block, head, len(head_ids), backend=backend)
                mapped[backend] = engine.last_mapped
                if a.dtype == "float32":
                    # the binding readout runs on MLX's CPU stream: its GPU float32 matmuls are reduced precision
                    # (see kvmap.MLX.matmul), which would put a ~2e-3 noise floor on p under the 1e-3 bar
                    with mx.stream(mx.cpu):
                        logits, _ = engine.prefill(suffix, cache)
                        _, r = engine.readout_from(logits)
                else:
                    logits, _ = engine.prefill(suffix, cache)
                    _, r = engine.readout_from(logits)
                out[backend] = r["pYesBin"]
            dk = max(float(mx.max(mx.abs(mapped["mlx"][l][0] - mapped["torch"][l][0])).item()) for l in mapped["mlx"])
            dv = max(float(mx.max(mx.abs(mapped["mlx"][l][1] - mapped["torch"][l][1])).item()) for l in mapped["mlx"])
            thr = readout["rejectThreshold"]
            rows.append({"item": item, "mapper": mapper, "pMlx": out["mlx"], "pTorch": out["torch"],
                         "dp": abs(out["mlx"] - out["torch"]), "agree": (out["mlx"] >= thr) == (out["torch"] >= thr),
                         "maxAbsDeltaKeys": dk, "maxAbsDeltaValues": dv})
        mx.clear_cache()
        print(f"{item}: " + ", ".join(f"{r['mapper']} dp={r['dp']:.2e}" for r in rows[-2:]), file=sys.stderr, flush=True)
    verdict = {}
    for mapper in ("A2a", "A2b"):
        rs = [r for r in rows if r["mapper"] == mapper]
        verdict[mapper] = {"items": len(rs), "agree": sum(r["agree"] for r in rs), "maxDp": max(r["dp"] for r in rs),
                           # the bfloat16 comparison is informational: it never passes or fails the gate
                           "pass": (all(r["agree"] for r in rs) and max(r["dp"] for r in rs) <= MAX_DP) if a.dtype == "float32" else None}
    result = {"schemaVersion": 1, "pair": a.pair, "receiverDtype": a.dtype, "items": PARITY_ITEMS,
              "contextsSha256": {k: sha256_bytes(v.encode()) for k, v in contexts.items()}, "maxDp": MAX_DP,
              "reference": "kvmap TORCH backend, float32 CPU", "port": "kvmap MLX backend",
              "weightsSha256": record["weights"]["sha256"], "verdict": verdict, "rows": rows,
              "wallSeconds": round(time.time() - t0, 1)}
    path = os.path.join(HERE, f"parity-{a.pair}.json")
    doc = load_json(path) if os.path.exists(path) else {}
    doc = {k: v for k, v in doc.items() if k in ("binding", "informational")}
    doc["binding" if a.dtype == "float32" else "informational"] = result
    with open(path, "w") as fh:
        json.dump(dict(sorted(doc.items())), fh, indent=2)
        fh.write("\n")
    print(json.dumps(verdict), file=sys.stderr)
    sys.exit(0 if a.dtype != "float32" or all(v["pass"] for v in verdict.values()) else 1)


if __name__ == "__main__":
    main()
