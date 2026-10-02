"""EXP 008 (latent-handoff) served path, bundle 3 WO-08: mlx_lm.server with two handoff routes.

  <mlx python> experiments/latent-handoff/served.py --role sender|receiver --model <mlx dir> --port N [--pair D1]
      [any other mlx_lm.server flag]   (always bound to 127.0.0.1)

This IS mlx_lm.server: its own argument parser, model provider, prompt cache and HTTP handler, started through
mlx_lm.server.main(). Only the request handler is extended, with one route per role:

  sender    POST /latent-handoff/export {"text"}   the server's sender model prefills (template head + context block)
            and writes its cache (float32 safetensors) plus the context positions and character offsets.
  receiver  POST /latent-handoff/import {"export", "text", "mapper"}   the server's receiver maps that sender cache
            (kvmap, the WO-05 mapper weights) and inserts it into mlx_lm.server's OWN prompt cache, keyed by the
            receiver's (head + context block) tokens. It never runs the receiver over the context.

The gate answer then goes through the stock /v1/chat/completions route: mlx_lm.server finds the inserted prefix in
its prompt cache, prefills only the question tail, and reports `usage.prompt_tokens_details.cached_tokens`, so the
zero-prefill property is visible from outside the process.
"""
import json
import os
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import mlx_lm.server as S  # noqa: E402

import kvmap  # noqa: E402
from runner import load_json, model_shape, prefix_kv, render_parts, sha256_bytes  # noqa: E402

ROLE = {}
LOCK = threading.Lock()


def _reply(handler, code, body):
    handler._set_completion_headers(code)
    handler.end_headers()
    handler.wfile.write(json.dumps(body).encode())


def _body(handler):
    n = int(handler.headers.get("Content-Length", "0"))
    return json.loads(handler.rfile.read(n).decode())


def _model(handler):
    provider = handler.response_generator.model_provider
    model, tok = provider.load("default_model")
    return provider, model, tok


def export(handler):
    """Sender: prefill (head + block) and write the cache + positions + offsets for the receiver."""
    from safetensors.numpy import save_file
    import numpy as np

    req = _body(handler)
    provider, model, tok = _model(handler)
    with LOCK:
        kv, pos, offsets, _ = prefix_kv(model, tok, ROLE["key"], req["text"], ROLE["readout"])
        shape = model_shape(model)
        freqs = [kvmap.rope_freqs(layer.self_attn.rope, shape[2]) for layer in model.layers]
    out = os.path.join(ROLE["dir"], f"export-{sha256_bytes(req['text'].encode())[:16]}.safetensors")
    tensors = {f"l{l}.{i}": np.array(a) for l, (k, v) in kv.items() for i, a in (("k", k), ("v", v))}
    tensors.update({f"freqs.l{l}": f.astype(np.float64) for l, f in enumerate(freqs)})
    save_file(tensors, out)
    meta = {"file": out, "positions": pos, "offsets": offsets, "shape": list(shape), "model": ROLE["key"]}
    _reply(handler, 200, meta)


def import_(handler):
    """Receiver: map the sender export with the named mapper and insert it into mlx_lm.server's prompt cache."""
    import mlx.core as mx
    from mlx_lm.models.cache import make_prompt_cache
    from safetensors.numpy import load_file

    req = _body(handler)
    if req["mapper"] not in ("A2a", "A2b"):
        return _reply(handler, 400, {"error": "mapper must be A2a or A2b"})
    provider, model, tok = _model(handler)
    exp = req["export"]
    raw = load_file(exp["file"])
    n_s = exp["shape"][0]
    skv = {l: (mx.array(raw[f"l{l}.k"]), mx.array(raw[f"l{l}.v"])) for l in range(n_s)}
    sfreqs = [raw[f"freqs.l{l}"] for l in range(n_s)]
    with LOCK:
        rshape = model_shape(model)
        rfreqs = [kvmap.rope_freqs(layer.self_attn.rope, rshape[2]) for layer in model.layers]
        head, block, _ = render_parts(tok, ROLE["key"], req["text"], ROLE["readout"])
        head_ids = tok.encode(head, add_special_tokens=False)
        ctx_ids, r_offsets = kvmap.offsets_of(tok, block)
        aligned = kvmap.align(r_offsets, [tuple(o) for o in exp["offsets"]], len(block))
        maps = {l: ((ROLE["maps"][f"{req['mapper']}.l{l}.k.M"], ROLE["maps"][f"{req['mapper']}.l{l}.k.c"]),
                    (ROLE["maps"][f"{req['mapper']}.l{l}.v.M"], ROLE["maps"][f"{req['mapper']}.l{l}.v.c"])) for l in range(rshape[0])}
        rpos = list(range(len(head_ids), len(head_ids) + len(ctx_ids)))
        mapped = kvmap.map_to_receiver(kvmap.MLX(), skv, exp["positions"], aligned, maps, req["mapper"],
                                       tuple(exp["shape"]), rshape, sfreqs, rfreqs, rpos)
        # the template head is item-independent: its cache is the receiver's own, computed once (never the context)
        if ROLE.get("head_ids") != head_ids:
            hc = make_prompt_cache(model)
            model(mx.array([head_ids]), cache=hc)
            mx.eval([c.state for c in hc])
            ROLE["head_ids"], ROLE["head"] = head_ids, [(c.state[0], c.state[1]) for c in hc]
        cache = make_prompt_cache(model)
        for l, c in enumerate(cache):
            hk, hv = ROLE["head"][l]
            k, v = mapped[l]
            c.state = (mx.concatenate([hk, k[None].astype(hk.dtype)], axis=2), mx.concatenate([hv, v[None].astype(hv.dtype)], axis=2))
        mx.eval([c.state for c in cache])
        tokens = head_ids + ctx_ids
        handler.response_generator.prompt_cache.insert_cache(provider.model_key, tokens, cache)
    _reply(handler, 200, {"insertedTokens": len(tokens), "headTokens": len(head_ids), "contextTokens": len(ctx_ids)})


class Handler(S.APIHandler):
    def do_POST(self):
        route = {"sender": {"/latent-handoff/export": export}, "receiver": {"/latent-handoff/import": import_}}[ROLE["role"]]
        if self.path in route:
            try:
                return route[self.path](self)
            except Exception as e:  # report, never crash the server
                return _reply(self, 500, {"error": f"{type(e).__name__}: {e}"})
        return super().do_POST()


def run(host, port, model_provider):
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("served.py binds loopback only")
    prompt_cache = S.LRUPromptCache(model_provider.cli_args.prompt_cache_size)
    S._run_http_server(host, port, S.ResponseGenerator(model_provider, prompt_cache), handler_class=Handler)


def main():
    argv = sys.argv[1:]

    def take(flag, default=None):
        if flag in argv:
            i = argv.index(flag)
            v = argv[i + 1]
            del argv[i : i + 2]
            return v
        return default

    ROLE["role"] = take("--role")
    ROLE["key"] = take("--model-key")
    pair = take("--pair", "D1")
    if ROLE["role"] not in ("sender", "receiver") or not ROLE["key"]:
        raise SystemExit("usage: served.py --role sender|receiver --model-key <key> --model <dir> --port N [--pair D1]")
    if "--host" in argv and argv[argv.index("--host") + 1] not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("served.py binds loopback only")
    ROLE["readout"] = load_json(os.path.join(HERE, "readout.json"))
    ROLE["dir"] = tempfile.mkdtemp(prefix="lh-served-")
    import atexit
    import shutil

    atexit.register(shutil.rmtree, ROLE["dir"], True)
    if ROLE["role"] == "receiver":
        from safetensors.numpy import load_file

        cache_root = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))
        record = load_json(os.path.join(HERE, f"mappers-{pair}.json"))
        path = os.path.join(cache_root, "mappers", record["weights"]["file"])
        with open(path, "rb") as fh:
            if sha256_bytes(fh.read()) != record["weights"]["sha256"]:
                raise SystemExit("mapper weights differ from their record")
        ROLE["maps"] = load_file(path)
    S.run = run
    sys.argv = ["mlx_lm.server"] + argv
    S.main()


if __name__ == "__main__":
    main()
