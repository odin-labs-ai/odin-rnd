"""EXP 008 (latent-handoff) bundle 3 WO-08: the KV-compatible receiver pair as an H0 lane CANDIDATE (not routed).

  <mlx python> experiments/latent-handoff/h0_candidate.py --pair D1 --harness-rows <rows.jsonl> --out <record.json>

1. Selection, written before choosing and checked against config.json: every layer is attention (no recurrent or
   Mamba layer), the vocab hashes differ, the combined BF16 footprint is <= 24 GB, and the cache geometry is recorded.
2. Stand-up under the memory gate: sender and receiver as mlx_lm.server (served.py: the stock server with one handoff
   route each), bound to 127.0.0.1 on free ports outside the service-registry table.
3. Served-path proof: one real completion from each server; then for 3 practice items, sender export -> A2b mapper ->
   receiver gate answer through /v1/chat/completions. Each decision must match the harness A2b decision for the same
   item (from --harness-rows), and mlx_lm.server must report the whole (head + context) prefix as cached tokens.
4. Both servers are stopped; `pgrep -f` finds no server and no listener is left on either port.
The record carries `status: candidate-not-routed`. Routing traffic to the pair is a separate founder decision.
"""
import argparse
import hashlib
import json
import math
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from runner import install_guard, load_context, load_json, mem_gate, render_parts  # noqa: E402

PORTS = (18381, 18382)
# rule 04's service-registry table (odin-labs): never bind one of these
REGISTRY_PORTS = {1999, 2026, 2200, *range(3000, 3021), 3100}
ITEMS = ("c001", "c002", "c003")
STRATUM = "S"
CACHE_ROOT = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))
SERVER_PATTERN = "mlx_lm[.]server|latent-handoff/served[.]py"


def sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()


def http(port, path, body=None, timeout=600):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def port_free(p):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", p)) != 0


def selection(models, pair_name):
    pair = models["pairs"][pair_name]
    out = {"rule": "every layer is attention; vocab hashes differ; combined BF16 footprint <= 24 GB; geometry recorded",
           "pair": pair_name, "models": {}}
    ok = True
    for side in ("sender", "receiver"):
        key = pair[side]
        m = models["models"][key]
        cfg = load_json(os.path.join(CACHE_ROOT, "hf", key, "config.json"))
        c = cfg.get("text_config", cfg)
        types = c.get("layer_types") or c.get("layers_block_type")
        attention = sum(1 for t in types if "attention" in t) if types else c["num_hidden_layers"]
        all_attention = attention == c["num_hidden_layers"]
        ok &= all_attention
        out["models"][side] = {"key": key, "repo": m["repo"], "revision": m["revision"], "layers": c["num_hidden_layers"],
                               "attentionLayers": attention, "allAttention": all_attention, "geometry": m["geometry"],
                               "vocabSha256": m["vocab"]["sha256"], "weightsGB": m["convert"]["weightsGB"]}
    s, r = out["models"]["sender"], out["models"]["receiver"]
    out["vocabDiffers"] = s["vocabSha256"] != r["vocabSha256"]
    out["footprintGB"] = round(s["weightsGB"] + r["weightsGB"], 3)
    out["footprintOk"] = out["footprintGB"] <= 24
    out["pass"] = bool(ok and out["vocabDiffers"] and out["footprintOk"])
    return out


def wait_health(port, proc, seconds=600):
    t0 = time.time()
    while time.time() - t0 < seconds:
        if proc.poll() is not None:
            raise SystemExit(f"server on {port} exited with {proc.returncode}")
        try:
            if http(port, "/health", timeout=5).get("status") == "ok":
                return
        except Exception:
            time.sleep(2)
    raise SystemExit(f"server on {port} never became healthy")


def stop(procs):
    for p in procs:
        if p.poll() is None:
            p.send_signal(signal.SIGINT)
    for p in procs:
        try:
            p.wait(timeout=60)
        except subprocess.TimeoutExpired:
            p.terminate()
            p.wait(timeout=30)


def main():
    install_guard()
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="D1")
    ap.add_argument("--harness-rows", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    readout = load_json(os.path.join(HERE, "readout.json"))
    models = load_json(os.path.join(HERE, "models.json"))
    manifest = load_json(os.path.join(HERE, "strata-manifest.json"))
    pair = models["pairs"][a.pair]
    sel = selection(models, a.pair)
    if not sel["pass"]:
        raise SystemExit(f"selection fails: {json.dumps(sel)}")
    harness = {}
    with open(a.harness_rows) as fh:
        for line in fh:
            r = json.loads(line)
            if r["arm"] == "A2b" and r["pair"] == a.pair and r["stratum"] == STRATUM:
                harness[r["itemId"]] = r
    missing = [i for i in ITEMS if i not in harness]
    if missing:
        raise SystemExit(f"harness rows lack A2b for {missing}")

    for p in PORTS:
        if p in REGISTRY_PORTS or not port_free(p):
            raise SystemExit(f"port {p} is in the registry table or already in use")
    gate = mem_gate(sel["footprintGB"], 0, untimed=True)
    logs = os.path.join(CACHE_ROOT, "served")
    os.makedirs(logs, exist_ok=True)
    py = sys.executable
    procs = []
    transcripts = []
    try:
        for role, port in zip(("sender", "receiver"), PORTS):
            key = pair[role]
            cmd = [py, os.path.join(HERE, "served.py"), "--role", role, "--model-key", key, "--pair", a.pair,
                   "--model", os.path.join(CACHE_ROOT, "mlx", key), "--host", "127.0.0.1", "--port", str(port),
                   "--max-tokens", "16"]
            procs.append(subprocess.Popen(cmd, stdout=open(os.path.join(logs, f"{role}.log"), "w"), stderr=subprocess.STDOUT))
        for p, port in zip(procs, PORTS):
            wait_health(port, p)

        completions = {}
        for role, port in zip(("sender", "receiver"), PORTS):
            key = pair[role]
            kw = {"enable_thinking": False} if key.startswith("qwen3") else ({"date_string": readout["llamaDateString"]} if key.startswith("llama") else {})
            body = {"messages": [{"role": "user", "content": "Reply with exactly one word: ready"}], "max_tokens": 8,
                    "temperature": 0.0, "chat_template_kwargs": kw}
            resp = http(PORTS[0] if role == "sender" else PORTS[1], "/v1/chat/completions", body)
            completions[role] = {"content": resp["choices"][0]["message"]["content"], "usage": resp.get("usage")}
            transcripts.append({"step": f"completion-{role}", "request": sha(body), "response": sha(resp)})

        proofs = []
        rkey = pair["receiver"]
        rkw = {"date_string": readout["llamaDateString"]} if rkey.startswith("llama") else ({"enable_thinking": False} if rkey.startswith("qwen3") else {})
        for item in ITEMS:
            context = load_context(os.path.join(CACHE_ROOT, "strata"), manifest, item, STRATUM)
            exp = http(PORTS[0], "/latent-handoff/export", {"text": context})
            imp = http(PORTS[1], "/latent-handoff/import", {"export": exp, "text": context, "mapper": "A2b"})
            if "error" in exp or "error" in imp:
                raise SystemExit(f"{item}: handoff route failed: {exp.get('error') or imp.get('error')}")
            _, block, _ = render_parts(_tokenizer(rkey), rkey, context, readout)
            body = {"messages": [{"role": "user", "content": block + readout["question"] + " " + readout["answerInstruction"]}],
                    "max_tokens": 1, "temperature": 0.0, "logprobs": True, "top_logprobs": 10, "chat_template_kwargs": rkw}
            resp = http(PORTS[1], "/v1/chat/completions", body)
            top = resp["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
            lp = {t["token"]: t["logprob"] for t in top}
            ly, ln = lp.get(readout["yes"]), lp.get(readout["no"])
            if ly is None or ln is None:
                raise SystemExit(f"{item}: YES/NO not both in the served top-10 logprobs: {list(lp)}")
            p_yes = 1.0 / (1.0 + math.exp(ln - ly))
            decision = "REJECT" if p_yes >= readout["rejectThreshold"] else "ACCEPT"
            usage = resp["usage"]
            cached = usage.get("prompt_tokens_details", {}).get("cached_tokens")
            proofs.append({"item": item, "servedDecision": decision, "servedPYesBin": p_yes,
                           "harnessDecision": harness[item]["decision"], "harnessPYesBin": harness[item]["pYesBin"],
                           "match": decision == harness[item]["decision"], "insertedTokens": imp["insertedTokens"],
                           "promptTokens": usage["prompt_tokens"], "cachedTokens": cached,
                           "zeroPrefill": cached == imp["insertedTokens"],
                           "generated": resp["choices"][0]["message"]["content"]})
            transcripts.append({"step": f"handoff-{item}", "export": sha({k: v for k, v in exp.items() if k != "file"}),
                                "import": sha(imp), "request": sha(body), "response": sha(resp)})
    finally:
        stop(procs)

    leftover = subprocess.run(["pgrep", "-f", SERVER_PATTERN], capture_output=True, text=True).stdout.split()
    listeners = [p for p in PORTS if not port_free(p)]
    record = {
        "schemaVersion": 1,
        "experiment": "EXP 008 (latent-handoff)",
        "status": "candidate-not-routed",
        "note": "An H0 lane CANDIDATE: a KV-compatible sender -> receiver pair proven through the served path. It is not a routed lane; no tier, routing or lane registration changed. Routing to it is a separate founder decision at H2.",
        "selection": sel,
        "pinsSha256": hashlib.sha256(open(os.path.join(HERE, "models.json"), "rb").read()).hexdigest(),
        "mappersSha256": load_json(os.path.join(HERE, f"mappers-{a.pair}.json"))["weights"]["sha256"],
        "server": "mlx_lm.server (mlx-lm 0.31.3) started through its own main(), handler extended by served.py; loopback only",
        "ports": {"sender": PORTS[0], "receiver": PORTS[1]},
        "gateBeforeStandUp": gate,
        "completions": completions,
        "proof": proofs,
        "transcriptSha256": transcripts,
        "stopped": {"pgrepServer": leftover, "listeners": listeners, "clean": not leftover and not listeners},
        "pass": all(p["match"] and p["zeroPrefill"] for p in proofs) and len(proofs) == len(ITEMS) and not leftover and not listeners,
    }
    with open(a.out, "w") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")
    print(json.dumps({"pass": record["pass"], "proof": [(p["item"], p["match"], p["zeroPrefill"]) for p in proofs], "stopped": record["stopped"]}))
    sys.exit(0 if record["pass"] else 1)


_TOKS = {}


def _tokenizer(key):
    if key not in _TOKS:
        from transformers import AutoTokenizer

        _TOKS[key] = AutoTokenizer.from_pretrained(os.path.join(CACHE_ROOT, "mlx", key))
    return _TOKS[key]


if __name__ == "__main__":
    main()
