"""Laya vs Jev: typed decisions answered locally on Apple silicon (MLX), with optional hosted Jev comparison.

  python run.py [--out results/laya-mlx-<date>.json] [--no-jev] [--no-reference]

Steps:
  1. fetch the pinned Laya typed-decisions files from Hugging Face (or reuse the cache) and verify sha256;
  2. answer every corpus row with the MLX port (laya_mlx.py) and time it;
  3. parity: answer every row with the upstream python (rl_agent_api.py, torch on CPU) and compare;
  4. if JEV_AI_API_KEY is set in the environment, send the same rows to Jev; otherwise mark Jev "not run";
  5. write the results JSON.

The Jev key is read from the environment only and is never written anywhere.
Exit code: 0 when the run completed and parity held, 1 on a parity failure, 2 on infrastructure failure.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import urllib.error
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import laya_inputs as li  # noqa: E402

HF_REPO = "convaiinnovations/laya"
HF_SHA = "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"
SUBDIR = "typed-decisions"
# sha256 of every file the runner loads, recorded when the files were read on 2026-09-24.
PINNED = {
    "typed-decisions/model.safetensors": "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e",
    "typed-decisions/rl_agent_config.json": "ebf0cd524d92342a6be5e48e9fca3d7c2babfb5a56ccd79d2171ef5d8c7f7be8",
    "typed-decisions/encoder/config.json": "5268d24ad3b77c8151de5dcb0762ba4391619aad9ab0bda33e36fb083cfeae6d",
    "typed-decisions/tokenizer/tokenizer.json": "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30",
    "typed-decisions/tokenizer/tokenizer_config.json": "08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1",
    # upstream reference python, read in full before use (no trust_remote_code anywhere)
    "rl_agent_api.py": "be3b46819c9999c3ef88e0f2ecf6d3ab1cdfed1d9a8b466fc89811e34d44031b",
    "rl_common.py": "8d83611d480c971d640a7b7d3aa2f2219c5e8455e9cc2329fd073681bd8be23e",
}

JEV_ORIGIN = "https://jev-ai.pro"
JEV_MODEL = "jev-1.13.0"
JEV_RELEASE_PREFIXES = ("jev-1.13", "typesafe/jev-1.13")
JEV_TIMEOUT_S = 15
# Jev's edge answers the default "Python-urllib/x.y" agent with HTTP 403 (Cloudflare error 1010); a first recorded
# run on 2026-09-24 lost every call to it (results/failed/). An explicit, honest agent string is sent instead.
USER_AGENT = "odin-rnd-laya-vs-jev/1 (+https://github.com/odin-labs-ai/odin-rnd)"
# Vendor price CLAIM read from jev-ai.pro/pricing on 2026-09-24: $0.124-$0.242 per 1M input tokens on annual
# plans, output tokens free. The highest listed rate is used; this is a claim, not a measured invoice.
JEV_USD_PER_1M_INPUT = 0.242

PARITY_MAX_TOP_DELTA = 0.01
HIGH_CONFIDENCE = 0.9


# ----------------------------------------------------------------------------- helpers
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def percentile(values, q):
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=np.float64), q))


def fetch_pinned(cache_root):
    root = os.path.join(cache_root, HF_SHA)
    for rel, want in PINNED.items():
        dest = os.path.join(root, rel)
        if not (os.path.exists(dest) and sha256_file(dest) == want):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            url = "https://huggingface.co/%s/resolve/%s/%s" % (HF_REPO, HF_SHA, rel)
            print("fetch", url, flush=True)
            tmp = dest + ".part"
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(tmp, dest)
        got = sha256_file(dest)
        if got != want:
            raise RuntimeError("sha256 mismatch for %s: %s != %s" % (rel, got, want))
    return root


def machine_info():
    def sysctl(key):
        try:
            return subprocess.run(["sysctl", "-n", key], capture_output=True, text=True, timeout=5).stdout.strip()
        except OSError:
            return None
    mem = sysctl("hw.memsize")
    return {"chip": sysctl("machdep.cpu.brand_string") or platform.processor(),
            "ramGb": round(int(mem) / 2 ** 30) if mem and mem.isdigit() else None,
            "os": "macOS %s" % platform.mac_ver()[0] if platform.mac_ver()[0] else platform.platform(),
            "arch": platform.machine(), "python": platform.python_version(),
            "loadAverageAtStart": [round(x, 1) for x in os.getloadavg()]}


def decision_of(answer):
    """Normalized decision + top probability + confidence from a typed answer (Laya or Jev shape)."""
    t = answer.get("type")
    if t == "noul":
        p = float(answer["noul"])
        conf = answer.get("confidence")
        return {"decision": p >= 0.5, "topProb": max(p, 1 - p),
                "confidence": float(conf) if conf is not None else li.confidence_from_probs([1 - p, p], 2),
                "confidenceSource": "reported" if conf is not None else "1-normalized-entropy"}
    probs = answer.get("probabilities") or {}
    if t == "choice":
        top = max(probs.values()) if probs else None
        decision = answer["choice"]
    elif t == "score":
        if probs:
            key = max(probs, key=lambda k: probs[k])
            decision, top = int(key), probs[key]
        else:
            decision, top = int(round(float(answer["score"]))), None
    else:
        raise ValueError("unknown answer type %r" % t)
    conf = answer.get("confidence")
    if conf is None and probs:
        conf = li.confidence_from_probs(list(probs.values()), len(probs))
    return {"decision": decision, "topProb": None if top is None else float(top),
            "confidence": None if conf is None else float(conf), "confidenceSource": "reported"}


def summarize(rows, key, expected):
    """accuracy over ALL rows (an unanswered row counts as wrong), calibratedAccuracy over answers with confidence >= 0.9."""
    answered = [r for r in rows if r.get(key) and r[key].get("decision") is not None]
    correct = [r for r in answered if r[key]["decision"] == expected[r["id"]]]
    hi = [r for r in answered if (r[key].get("confidence") or 0) >= HIGH_CONFIDENCE]
    hi_ok = [r for r in hi if r[key]["decision"] == expected[r["id"]]]
    ms = [r[key]["ms"] for r in rows if r.get(key) and r[key].get("ms") is not None]
    by_type = {}
    for t in ("choice", "score", "noul"):
        sub = [r for r in rows if r["type"] == t]
        ok = [r for r in sub if r.get(key) and r[key].get("decision") == expected[r["id"]]]
        by_type[t] = {"correct": len(ok), "rows": len(sub)}
    return {"accuracy": round(len(correct) / len(rows), 4) if rows else None,
            "correct": len(correct), "answered": len(answered), "rows": len(rows),
            "calibratedAccuracy": round(len(hi_ok) / len(hi), 4) if hi else None,
            "highConfidenceAnswers": len(hi), "highConfidenceCorrect": len(hi_ok),
            "p50Ms": round(percentile(ms, 50), 2) if ms else None, "p90Ms": round(percentile(ms, 90), 2) if ms else None,
            "maxMs": round(max(ms), 2) if ms else None, "byType": by_type}


# ----------------------------------------------------------------------------- Laya (MLX)
def run_laya_mlx(model_dir, corpus_rows):
    import mlx.core as mx
    from laya_mlx import LayaMLX
    t0 = time.perf_counter()
    model = LayaMLX(model_dir)
    tok = li.Tok(os.path.join(model_dir, "tokenizer", "tokenizer.json"))
    cold = time.perf_counter() - t0

    def answer(row):
        q = li.to_internal(row["question"])
        ids, markers = li.build_sequence(tok, row["state"], q, model.cfg["max_len"], model.cfg["head_max_len"])
        if len(markers) != len(li.render_options(q)):
            raise ValueError("row %s: options do not fit in head_max_len" % row["id"])
        logits, act = model.forward(ids, markers, q["t"])
        p = li.calibrated_probs(logits, li.QTYPES[q["t"]], model.cfg)
        return li.shape_answer(q, p, act[0]), ids, markers

    t1 = time.perf_counter()
    answer(corpus_rows[0])  # first call compiles Metal kernels; timed separately, excluded from p50/p90/max
    first_call_ms = (time.perf_counter() - t1) * 1000
    out = {}
    for row in corpus_rows:
        t = time.perf_counter()
        ans, ids, markers = answer(row)
        ms = (time.perf_counter() - t) * 1000
        out[row["id"]] = {"answer": ans, "ids": ids, "markers": markers, "ms": ms}
    return {"coldLoadS": cold, "firstCallMs": first_call_ms, "mlxVersion": mx.__version__,
            "device": str(mx.default_device()), "rows": out}


# ----------------------------------------------------------------------------- reference (upstream python, torch CPU)
def run_reference(snapshot_root, model_dir, corpus_rows):
    sys.path.insert(0, snapshot_root)
    import torch
    import transformers
    import rl_common
    from rl_agent_api import RLAgent
    t0 = time.perf_counter()
    agent = RLAgent(model_dir, device="cpu")
    cold = time.perf_counter() - t0
    out = {}
    for row in corpus_rows:
        q = li.to_internal(row["question"])
        ids, markers = rl_common.build_sequence(agent.tok, row["state"], q, agent.cfg["max_len"], agent.cfg["head_max_len"])
        t = time.perf_counter()
        ans = agent.system_one(row["state"], {"q": row["question"]})["answers"]["q"]
        out[row["id"]] = {"answer": ans, "ids": ids, "markers": markers, "ms": (time.perf_counter() - t) * 1000}
    return {"coldLoadS": cold, "torchVersion": torch.__version__, "transformersVersion": transformers.__version__,
            "threads": torch.get_num_threads(), "rows": out}


def parity_report(mlx_rows, ref_rows, corpus_rows):
    mismatches, max_top, max_any = [], 0.0, 0.0
    for row in corpus_rows:
        m, r = mlx_rows[row["id"]], ref_rows[row["id"]]
        dm, dr = decision_of(m["answer"]), decision_of(r["answer"])
        top_delta = abs(dm["topProb"] - dr["topProb"])
        if row["question"]["type"] == "noul":
            any_delta = abs(m["answer"]["noul"] - r["answer"]["noul"])
        else:
            pm, pr = m["answer"]["probabilities"], r["answer"]["probabilities"]
            any_delta = max(abs(pm[k] - pr[k]) for k in pr)
        max_top, max_any = max(max_top, top_delta), max(max_any, any_delta)
        problems = []
        if m["ids"] != r["ids"] or m["markers"] != r["markers"]:
            problems.append("token ids differ")
        if dm["decision"] != dr["decision"]:
            problems.append("decision %r != reference %r" % (dm["decision"], dr["decision"]))
        if top_delta > PARITY_MAX_TOP_DELTA:
            problems.append("top-probability delta %.4f > %.2f" % (top_delta, PARITY_MAX_TOP_DELTA))
        if problems:
            mismatches.append({"id": row["id"], "problems": problems})
    return {"rows": len(corpus_rows), "sameDecision": len(corpus_rows) - sum(
                1 for x in mismatches if any(p.startswith("decision") for p in x["problems"])),
            "maxTopProbDelta": round(max_top, 6), "maxAnyProbDelta": round(max_any, 6),
            "threshold": PARITY_MAX_TOP_DELTA, "mismatches": mismatches, "passed": not mismatches,
            "note": "Reference probabilities are the upstream system_one output, which rounds to 4 decimals; "
                    "rounding contributes at most 0.00005 to each delta."}


# ----------------------------------------------------------------------------- Jev (optional, hosted)
def call_jev(key, row):
    body = json.dumps({"model": JEV_MODEL, "state": row["state"], "questions": {"q": row["question"]}}).encode()
    req = urllib.request.Request(JEV_ORIGIN + "/api/v1/systemone", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                                          "User-Agent": USER_AGENT})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=JEV_TIMEOUT_S) as r:
            data = json.loads(r.read().decode())
        status = "ok"
    except urllib.error.HTTPError as e:  # status code only; never headers or body, which could echo request details
        return {"status": "http-%d" % e.code, "ms": (time.perf_counter() - t) * 1000}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        return {"status": "error:%s" % type(e).__name__, "ms": (time.perf_counter() - t) * 1000}
    ms = (time.perf_counter() - t) * 1000
    served = str(data.get("model", ""))[:64]
    if not served.startswith(JEV_RELEASE_PREFIXES):
        return {"status": "unexpected-release", "servedModel": served, "ms": ms}
    ans = (data.get("answers") or {}).get("q")
    if not isinstance(ans, dict) or ans.get("type") != row["question"]["type"]:
        return {"status": "malformed-answer", "servedModel": served, "ms": ms}
    return {"status": status, "servedModel": served, "answer": ans, "ms": ms,
            "inputTokens": (data.get("usage") or {}).get("input_tokens")}


def run_jev(corpus_rows):
    key = os.environ.get("JEV_AI_API_KEY", "").strip()
    if not key:
        return None
    out = {}
    for row in corpus_rows:  # sequential on purpose: one call at a time
        out[row["id"]] = call_jev(key, row)
    del key
    return out


# ----------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    ap.add_argument("--corpus", default=os.path.join(HERE, "corpus.json"))
    ap.add_argument("--cache", default=os.environ.get("LAYA_CACHE", os.path.expanduser("~/.cache/odin-rnd/laya")))
    ap.add_argument("--no-jev", action="store_true", help="do not call Jev even if JEV_AI_API_KEY is set")
    ap.add_argument("--no-reference", action="store_true", help="skip the torch-CPU parity run (parity then reads 'not run')")
    args = ap.parse_args(argv)

    measured_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    out_path = args.out or os.path.join(HERE, "results", "laya-mlx-%s.json" % measured_at.date().isoformat())
    with open(args.corpus, "rb") as f:
        corpus_bytes = f.read()
    corpus = json.loads(corpus_bytes)
    rows = corpus["rows"]
    expected = {r["id"]: r["expected"] for r in rows}
    notes = []
    machine = machine_info()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        print("MLX needs Apple silicon (Darwin arm64); this is %s %s" % (platform.system(), platform.machine()), file=sys.stderr)
        return 2

    try:
        snapshot = fetch_pinned(args.cache)
    except (OSError, RuntimeError, urllib.error.URLError) as e:
        print("could not fetch pinned weights: %s" % e, file=sys.stderr)
        return 2
    model_dir = os.path.join(snapshot, SUBDIR)

    print("laya: MLX pass over %d rows" % len(rows), flush=True)
    laya = run_laya_mlx(model_dir, rows)
    notes.append("Backend: every model component (ModernBERT-large encoder, decision head, scorer, act head) runs in MLX "
                 "on the Apple GPU in float32; no component falls back to torch-MPS. Tokenization uses the Hugging Face "
                 "`tokenizers` library (Rust, CPU), which is not a model component.")
    notes.append("coldLoadS = reading and upcasting the pinned safetensors plus the tokenizer, after Python imports and "
                 "after the one-off download. The first call (%.0f ms, Metal kernel compilation) is excluded from "
                 "p50/p90/max, which cover one call per corpus row, batch size 1, sequential." % laya["firstCallMs"])

    parity = {"passed": None, "status": "not run"}
    reference_meta = None
    if not args.no_reference:
        print("reference: upstream rl_agent_api.py on torch CPU", flush=True)
        ref = run_reference(snapshot, model_dir, rows)
        parity = parity_report(laya["rows"], ref["rows"], rows)
        parity["status"] = "passed" if parity["passed"] else "FAILED"
        ref_ms = [r["ms"] for r in ref["rows"].values()]
        reference_meta = {"implementation": "%s@%s rl_agent_api.RLAgent.system_one" % (HF_REPO, HF_SHA[:12]),
                          "device": "cpu", "torch": ref["torchVersion"], "transformers": ref["transformersVersion"],
                          "threads": ref["threads"], "coldLoadS": round(ref["coldLoadS"], 2),
                          "p50Ms": round(percentile(ref_ms, 50), 2), "p90Ms": round(percentile(ref_ms, 90), 2),
                          "maxMs": round(max(ref_ms), 2)}
        for r in rows:
            laya["rows"][r["id"]]["reference"] = decision_of(ref["rows"][r["id"]]["answer"])
    else:
        notes.append("Parity against the upstream reference was NOT run in this invocation (--no-reference).")

    jev = None if args.no_jev else run_jev(rows)
    jev_status = "run" if jev is not None else ("not run: --no-jev" if args.no_jev else "not run: no JEV_AI_API_KEY in the environment")

    # per-row records
    per_row = []
    for r in rows:
        lr = laya["rows"][r["id"]]
        d = decision_of(lr["answer"])
        rec = {"id": r["id"], "type": r["question"]["type"], "expected": r["expected"],
               "laya": dict(d, ms=round(lr["ms"], 2), tokens=len(lr["ids"])), "reference": lr.get("reference")}
        if jev is not None:
            j = jev[r["id"]]
            if j["status"] == "ok":
                rec["jev"] = dict(decision_of(j["answer"]), ms=round(j["ms"], 2), status="ok",
                                  servedModel=j["servedModel"], inputTokens=j.get("inputTokens"))
            else:
                rec["jev"] = {"decision": None, "status": j["status"], "ms": round(j["ms"], 2),
                              "servedModel": j.get("servedModel")}
        per_row.append(rec)

    laya_sum = summarize(per_row, "laya", expected)
    per_model = {"laya-typed-decisions": {
        "accuracy": laya_sum["accuracy"], "calibratedAccuracy": laya_sum["calibratedAccuracy"],
        "p50Ms": laya_sum["p50Ms"], "p90Ms": laya_sum["p90Ms"], "maxMs": laya_sum["maxMs"],
        "coldLoadS": round(laya["coldLoadS"], 3), "costPer1kUsd": None,
        "detail": {k: laya_sum[k] for k in ("correct", "answered", "rows", "highConfidenceAnswers", "highConfidenceCorrect", "byType")}
        | {"firstCallMs": round(laya["firstCallMs"], 1)}}}
    models = [{"id": "laya-typed-decisions", "source": "https://huggingface.co/%s/tree/%s/%s" % (HF_REPO, HF_SHA, SUBDIR),
               "sha": HF_SHA, "license": "Apache-2.0", "backend": "mlx %s (%s), float32" % (laya["mlxVersion"], laya["device"])}]
    agreement = {"laya_vs_jev": None}
    notes.append("costPer1kUsd is null for Laya: it runs locally and no per-call price applies; electricity and hardware were not measured.")

    if jev is not None:
        jev_sum = summarize(per_row, "jev", expected)
        ok = [r for r in per_row if r.get("jev", {}).get("status") == "ok"]
        tokens = [r["jev"]["inputTokens"] for r in ok if isinstance(r["jev"].get("inputTokens"), (int, float))]
        cost = round(float(np.mean(tokens)) * JEV_USD_PER_1M_INPUT / 1e6 * 1000, 6) if tokens else None
        served = sorted({r["jev"]["servedModel"] for r in ok})
        per_model["jev"] = {"accuracy": jev_sum["accuracy"], "calibratedAccuracy": jev_sum["calibratedAccuracy"],
                            "p50Ms": jev_sum["p50Ms"], "p90Ms": jev_sum["p90Ms"], "maxMs": jev_sum["maxMs"],
                            "coldLoadS": None, "costPer1kUsd": cost,
                            "detail": {k: jev_sum[k] for k in ("correct", "answered", "rows", "highConfidenceAnswers", "highConfidenceCorrect", "byType")}
                            | {"meanInputTokens": round(float(np.mean(tokens)), 1) if tokens else None,
                               "failures": {s: sum(1 for r in per_row if r["jev"]["status"] == s) for s in {r["jev"]["status"] for r in per_row} if s != "ok"},
                               "servedModels": served}}
        models.append({"id": "jev", "source": JEV_ORIGIN + "/api/v1/systemone (hosted, TypeSafe-compatible)",
                       "sha": None, "license": "proprietary, hosted", "backend": "hosted API, requested model %s" % JEV_MODEL})
        both = [r for r in ok if r["laya"]["decision"] is not None]
        agree = sum(1 for r in both if r["laya"]["decision"] == r["jev"]["decision"])
        agreement["laya_vs_jev"] = {"percent": round(100.0 * agree / len(both), 2) if both else None,
                                    "agree": agree, "comparedRows": len(both)}
        notes.append("Jev: %d sequential calls, %d s timeout, requested %s; served-model labels seen: %s. Latency is wall time "
                     "from this Mac over the public internet, including failed calls. Accuracy counts an unanswered row as wrong."
                     % (len(rows), JEV_TIMEOUT_S, JEV_MODEL, ", ".join(served) or "none"))
        notes.append("Jev costPer1kUsd = measured mean input tokens per call x $%.3f per 1M input tokens, a vendor price CLAIM "
                     "(jev-ai.pro/pricing, read 2026-09-24, highest listed annual-plan rate; listed range $0.124-$0.242; output "
                     "tokens free). It is not an invoice." % JEV_USD_PER_1M_INPUT)
    else:
        per_model["jev"] = {"accuracy": None, "calibratedAccuracy": None, "p50Ms": None, "p90Ms": None, "maxMs": None,
                            "coldLoadS": None, "costPer1kUsd": None, "status": jev_status}
        notes.append("Jev %s." % jev_status)

    notes.append("calibratedAccuracy = accuracy of the answers whose confidence is >= %.1f (confidence = the model's reported "
                 "value; for Laya noul answers, which carry none, 1 - normalized entropy of [1-p, p])." % HIGH_CONFIDENCE)
    notes.append("Decisions: choice = top key; score = most probable level; noul = probability >= 0.5.")
    notes.append("Corpus: %d hand-written public rows authored before any model ran; the expected answers are the author's "
                 "judgment. A small authored corpus is not a benchmark; it supports mechanism and parity claims, not "
                 "general accuracy claims." % len(rows))
    notes.append("Vendor figures (Laya eval/results.md, jev-ai.pro/compare) are CLAIMS and are not reproduced here.")
    machine["loadAverageAtEnd"] = [round(x, 1) for x in os.getloadavg()]
    notes.append("The Mac was shared with other work during the run (load average %s at start, %s at end); latencies are "
                 "under that load." % (machine["loadAverageAtStart"], machine["loadAverageAtEnd"]))

    result = {
        "schemaVersion": 1,
        "measuredAt": measured_at.isoformat().replace("+00:00", "Z"),
        "machine": machine,
        "models": models,
        "corpus": {"rows": len(rows), "sha256": hashlib.sha256(corpus_bytes).hexdigest(),
                   "path": "experiments/laya-vs-jev/corpus.json",
                   "byType": {t: sum(1 for r in rows if r["question"]["type"] == t) for t in ("choice", "score", "noul")}},
        "perModel": per_model,
        "agreement": agreement,
        "parity": parity | ({"reference": reference_meta} if reference_meta else {}),
        "weights": {"repo": HF_REPO, "sha": HF_SHA, "subdir": SUBDIR, "fileSha256": PINNED},
        "runtime": {"mlx": laya["mlxVersion"], "numpy": np.__version__, "python": platform.python_version()},
        "jevStatus": jev_status,
        "rows": per_row,
        "notes": notes,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, out_path)

    print("wrote", out_path)
    print("laya  accuracy %s  calibrated %s  p50 %s ms  cold %.2f s" % (laya_sum["accuracy"], laya_sum["calibratedAccuracy"],
                                                                     laya_sum["p50Ms"], laya["coldLoadS"]))
    print("parity", parity.get("status"), "max top-prob delta", parity.get("maxTopProbDelta"))
    print("jev   ", jev_status, "" if jev is None else "accuracy %s agreement %s" % (per_model["jev"]["accuracy"], agreement["laya_vs_jev"]))
    if parity.get("passed") is False:
        for m in parity["mismatches"]:
            print("PARITY MISMATCH", m["id"], "; ".join(m["problems"]), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
