"""EXP 008 (latent-handoff) mapper freeze values for the pre-registration (bundle 3 WO-05 -> bundle 4 WO-01).

  python3 experiments/latent-handoff/mapper_freeze.py --pair D1     writes mapper-freeze.json (stdlib only)

Refuses unless the binding parity gate passed for both mappers on the SAME weights the mapper record pins.
"""
import argparse
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def sha_file(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def write_bf16_evidence(parity, mappers, pair):
    """A descriptive property of the KV arms, not a gate: how far the bf16 run-time readout moves under float32-level
    differences in the mapped cache (MLX port vs torch reference)."""
    info = parity["informational"]
    a1path = os.path.join(HERE, "evidence", f"parity-{pair}-attempt1-gpu-reduced-precision.json")
    attempt1 = json.load(open(a1path)) if os.path.exists(a1path) else None
    rows = info["rows"]
    rec = {
        "schemaVersion": 1,
        "kind": "descriptive property of the A2 arms (not a gate)",
        "question": "decision stability under bf16 rounding: does the bf16 receiver's decision survive float32-level differences in a mapped cache?",
        "heldOut": {
            "items": info["items"],
            "receiverDtype": "bfloat16",
            "maxAbsDeltaKeys": max(r["maxAbsDeltaKeys"] for r in rows),
            "maxAbsDeltaValues": max(r["maxAbsDeltaValues"] for r in rows),
            "byMapper": {m: {"agree": v["agree"], "of": v["items"], "maxDp": v["maxDp"]} for m, v in info["verdict"].items()},
            "pStepNote": "near p = 0.5 one bf16 logit step moves p by about 0.03",
        },
        "attempt1": None if attempt1 is None else {
            "note": "Superseded parity attempt 1 (reduced-precision GPU matmul, so larger cache differences; read out on EXP items c001-c020, per-item values redacted).",
            "maxAbsDeltaKeys": attempt1["informational"]["maxAbsDeltaKeys"],
            "byMapper": {m: {"agree": v["agree"], "of": v["items"], "maxDp": v["maxDp"]} for m, v in attempt1["informational"]["verdict"].items()},
        },
        "weightsSha256": mappers["weights"]["sha256"],
        "forPrereg": "disclose in limits; pre-register as a descriptive secondary (decision stability under bf16 rounding), never as a gate change",
    }
    with open(os.path.join(HERE, "evidence", f"bf16-decision-stability-{pair}.json"), "w") as fh:
        json.dump(rec, fh, indent=2)
        fh.write("\n")


def freeze_pair(pair):
    mpath = os.path.join(HERE, f"mappers-{pair}.json")
    ppath = os.path.join(HERE, f"parity-{pair}.json")
    mappers = json.load(open(mpath))
    parity = json.load(open(ppath))
    binding = parity["binding"]
    if binding["weightsSha256"] != mappers["weights"]["sha256"] or parity["informational"]["weightsSha256"] != mappers["weights"]["sha256"]:
        raise SystemExit(f"{pair}: parity was run on other mapper weights")
    if not all(v["pass"] for v in binding["verdict"].values()):
        raise SystemExit(f"{pair}: the binding parity gate did not pass")
    write_bf16_evidence(parity, mappers, pair)
    return {
        "calibration": {k: mappers["calibration"][k] for k in ("sourcesSha256", "textSha256", "receiverTokens", "where", "machine", "wallSeconds")},
        "mapperRecordSha256": sha_file(mpath),
        "mapperWeightsSha256": mappers["weights"]["sha256"],
        "parityRecordSha256": sha_file(ppath),
        "parityBinding": binding["verdict"],
        "parityDefinition": {
            "frozenBefore": "any counted item is read out with a mapper (bundle 4 pre-registration)",
            "items": binding["items"],
            "contextsSha256": binding["contextsSha256"],
            "contexts": "segments of the pinned held-out public file in calib-sources.json parityHeldOut, minus every calibration and evaluation line; never an EXP 005 / 008-X item",
            "mapping": "kvmap MLX port on the GPU (split-precision float32 matmul) vs kvmap torch reference, float32 CPU",
            "readout": "receiver and cache in float32 on MLX's CPU stream (true float32)",
            "pass": "decision agreement 20/20 AND max |p_mlx - p_torch| <= 1e-3, for each mapper; any mismatch fails the run",
            "maxDp": binding["maxDp"],
            "rationale": "The gate proves the PORT is correct. A float32 readout removes the receiver's own rounding noise (bf16 activations, reduced-precision GPU float32 matmul), which would otherwise dominate a 1e-3 bar regardless of the port; the run-time bf16 sensitivity is recorded separately as a descriptive property of the arms, never as a gate.",
        },
        "bf16DecisionStabilitySha256": sha_file(os.path.join(HERE, "evidence", f"bf16-decision-stability-{pair}.json")),
        "implementations": {
            "A2a": mappers["labels"]["A2a"],
            "A2b": mappers["labels"]["A2b"] + "; the authors' repository had no released code, so our reimplementation is used (no authors' mappers available at freeze)",
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", default="D1,D1p")
    a = ap.parse_args()
    out = {
        "schemaVersion": 2,
        "pairs": {p: freeze_pair(p) for p in a.pairs.split(",")},
        "footprintsSha256": sha_file(os.path.join(HERE, "footprints.json")),
        "code": {f: sha_file(os.path.join(HERE, f)) for f in ("kvmap.py", "calibrate.py", "parity.py", "runner.py", "arms.mjs", "score.mjs", "timing.mjs", "mem-gate.mjs", "calib-sources.json", "readout.json")},
        "notes": [
            "calib-sources.json gained only its parityHeldOut entry between the D1 and D1' calibrations; the calibration text (textSha256) is identical for both pairs.",
            "Footprint bounds (footprints.json): D1 at the 24 GB design bound (measured 21.9 GB); D1' alone raised to 48 GB on measurement (measured 36.9 GB with A2b on L).",
        ],
    }
    with open(os.path.join(HERE, "mapper-freeze.json"), "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(json.dumps({p: {"weights": v["mapperWeightsSha256"][:12], "parity": v["parityRecordSha256"][:12]} for p, v in out["pairs"].items()}))


if __name__ == "__main__":
    main()
