"""EXP 009 (composable-harness) MLX child, owned by the `mlx.model` component.

  <mlx python> experiments/composable-harness/components/mlx_gate.py --model-dir <mlx dir> --model-key <key> [--prefix-cache N]

One MLX model, one process, JSON lines on stdin/stdout (one request, one reply, in order):

  {"op": "eval", "state": <text>}   -> {"ok": true, "pin", "prefixKey", "cached", "lpYes", "lpNo", "pYesBin"}
  {"op": "memory"}                  -> {"ok": true, "activeBytes"}       (mx.get_active_memory)
  {"op": "keys"}                    -> {"ok": true, "prefixKeys": [...]} (the prefix cache, oldest first)
  {"op": "quit"}                    -> exits 0

With --http PORT (the H2 arm's plain-registry mlx.model, which speaks HTTP) the SAME evaluate function serves
  GET  /health          -> 200
  POST /v1/completions  {"prompt"} -> the eval reply. A first line "item:<sha256>" is the harness's tag (it keeps the
                        prompt's first 64 characters unique per item) and is stripped before evaluation.
bound to 127.0.0.1, with no stdin. H1 and H2 therefore read out through one implementation.

The readout is EXP 008's, imported as published (runner.py: split_prompt, answer_ids, install_guard; readout.json):
the user turn is <state> + "\\n\\n" + question + " " + answerInstruction in the model's chat template, and the
decision is the softmax over the YES / NO token ids at the first assistant position. Decoding is deterministic.

The prefix cache holds the KV state of (template head + state) under the key "<pin>:<sha256 of the prefix ids>", at
most N entries (least recently used dropped first). A hit rebuilds a fresh cache from the stored state, so a prefix
is never mutated by the suffix it serves. The process opens no labels file (EXP 008's audit-hook guard is installed).
"""
import argparse
import hashlib
import json
import os
import sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
LH = os.path.join(HERE, "..", "..", "latent-handoff")
sys.path.insert(0, LH)

from runner import answer_ids, install_guard, load_json, split_prompt  # noqa: E402

install_guard()


def build(args):
    """Load the model; return (evaluate, keys, memory)."""
    import math

    import mlx.core as mx
    from mlx_lm import load
    from mlx_lm.models.cache import make_prompt_cache

    readout = load_json(os.path.join(LH, "readout.json"))
    model, tok = load(args.model_dir)
    ids = answer_ids(tok, readout)
    pin = args.model_key
    cache = OrderedDict()

    def prefill(tokens, kv):
        step = readout["prefillStep"]
        logits = None
        for s in range(0, len(tokens), step):
            logits = model(mx.array([tokens[s : s + step]]), cache=kv)
            mx.eval(logits, [c.state for c in kv])
        return logits

    def evaluate(state):
        prefix, suffix = split_prompt(tok, pin, state, readout)
        key = pin + ":" + hashlib.sha256(json.dumps(prefix).encode()).hexdigest()
        kv = make_prompt_cache(model)
        cached = key in cache
        if cached:
            cache.move_to_end(key)
            for c, st in zip(kv, cache[key]):
                c.state = st
        else:
            prefill(prefix, kv)
            cache[key] = [c.state for c in kv]
            while len(cache) > args.prefix_cache:
                cache.popitem(last=False)
        logits = prefill(suffix, kv)
        last = logits[0, -1, :].astype(mx.float32)
        lp = last - mx.logsumexp(last)
        mx.eval(lp)
        ly, ln = lp[ids["yes"]].item(), lp[ids["no"]].item()
        if math.isnan(ly) or math.isnan(ln):
            return {"ok": False, "error": "nan-logits"}
        return {"ok": True, "pin": pin, "prefixKey": key, "cached": cached, "lpYes": ly, "lpNo": ln, "pYesBin": 1.0 / (1.0 + math.exp(ln - ly))}

    return evaluate, lambda: list(cache.keys()), mx.get_active_memory


def serve_http(args, evaluate):
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def reply(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.reply(200, {"ok": True}) if self.path == "/health" else self.reply(404, {"ok": False})

        def do_POST(self):
            if self.path != "/v1/completions":
                return self.reply(404, {"ok": False})
            req = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
            prompt = req["prompt"]
            if prompt.startswith("item:"):
                prompt = prompt.split("\n", 1)[1]
            out = evaluate(prompt)
            self.reply(200 if out.get("ok") else 500, out)

    HTTPServer(("127.0.0.1", args.http), Handler).serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--model-key", required=True)
    ap.add_argument("--prefix-cache", type=int, default=8)
    ap.add_argument("--http", type=int, default=None)
    args = ap.parse_args()
    evaluate, keys, memory = build(args)
    if args.http is not None:
        return serve_http(args, evaluate)
    pin = args.model_key
    print(json.dumps({"ready": True, "pid": os.getpid(), "pin": pin, "activeBytes": memory()}), flush=True)
    for line in sys.stdin:
        req = json.loads(line)
        op = req.get("op")
        if op == "eval":
            out = evaluate(req["state"])
        elif op == "memory":
            out = {"ok": True, "activeBytes": memory()}
        elif op == "keys":
            out = {"ok": True, "prefixKeys": keys()}
        elif op == "quit":
            return 0
        else:
            out = {"ok": False, "error": f"unknown op {op}"}
        print(json.dumps(out), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
