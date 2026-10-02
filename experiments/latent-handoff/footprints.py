"""EXP 008 (latent-handoff) measured pair footprints for the memory gate (bundle 3 WO-06, D1-prime decision).

  python3 experiments/latent-handoff/footprints.py      reads evidence/*.rows.jsonl, writes footprints.json

The gate's pair-footprint criterion is judged on the MEASURED peak (practice items only), never on weights alone.
"""
import glob
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    pairs = {}
    for path in sorted(glob.glob(os.path.join(HERE, "evidence", "*.rows.jsonl"))):
        with open(path, "rb") as fh:
            raw = fh.read()
        for line in raw.decode().splitlines():
            r = json.loads(line)
            if r.get("abstain") or not r["itemId"] in {f"c{i:03d}" for i in range(1, 21)}:
                continue
            p = pairs.setdefault(r["pair"], {"peakGB": 0.0, "byArm": {}, "sources": {}})
            key = f"{r['stratum']}.{r['arm']}"
            p["byArm"][key] = round(max(p["byArm"].get(key, 0.0), r["peakMemGB"]), 2)
            p["peakGB"] = round(max(p["peakGB"], r["peakMemGB"]), 2)
            p["sources"][os.path.basename(path)] = hashlib.sha256(raw).hexdigest()
    models = json.load(open(os.path.join(HERE, "models.json")))
    for name, p in pairs.items():
        pair = models["pairs"][name]
        p["weightsGB"] = round(sum(models["models"][pair[k]]["convert"]["weightsGB"] for k in ("sender", "receiver")), 3)
        p["armsMeasured"] = sorted({k.split(".")[1] for k in p["byArm"]})
    # Per-pair footprint bounds. D1 keeps the design bound (24 GB). D1' alone is raised, on measurement: its text and
    # control arms already peak above 24 GB on L, and 48 GB is the most the gate admits consistently (at the 50%-free
    # floor a 128 GB Mac has 64 GB available; the headroom criterion needs peak + 16 GB <= available).
    bounds = {"D1p": {"boundGB": 48, "why": "measured peak above 24 GB (text/control arms on L); 48 = 64 GB available at 50% free - 16 GB headroom"}}
    for name, p in pairs.items():
        p.update(bounds.get(name, {"boundGB": 24, "why": "design bound (FINAL-SHAPE)"}))
    out = {"schemaVersion": 1,
           "note": "Measured peak MLX memory (mx.get_peak_memory) per pair on practice items c001-c020 only, from footprint-only runs (memory gate strict, CPU-load criterion skipped and recorded) and practice runs. The gate uses max(weights, measured peak) as the pair footprint.",
           "pairs": dict(sorted(pairs.items()))}
    with open(os.path.join(HERE, "footprints.json"), "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(json.dumps({k: (v["peakGB"], v["armsMeasured"]) for k, v in pairs.items()}))


if __name__ == "__main__":
    main()
