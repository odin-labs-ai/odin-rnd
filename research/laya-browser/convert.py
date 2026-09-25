#!/usr/bin/env python3
"""Rebuild the browser model from the pinned checkpoint and compare it with the hosted build.

    python research/laya-browser/convert.py --cache ~/.cache/odin-rnd-laya

Stages (each in its own process to keep peak memory low):
  export   pinned typed-decisions checkpoint -> one float32 ONNX graph (encoder + typed decision heads)
  q8e8     weight-only int8 block-128 MatMulNBits + int8 embedding table
  compare  the rebuilt model against the hosted build pinned in pins.json: SHA-256 of the files,
           then every initializer tensor by name (the hosted build is accepted as coming from the
           pinned checkpoint only if all float tensors, scales and embeddings are bit-identical and
           int8 codes differ by at most one step in at most 0.01% of elements)

The export and quantization steps follow scripts/build_model.py in the layaForWeb repository
(Copyright 2026 vishalmysore, Apache-2.0), with two changes: the model is loaded through the
checkpoint's own pinned reference code instead of the PyPI `laya` package, and nothing is split or
uploaded. Outputs stay under --cache; nothing large is written to this repository.
"""
import argparse
import gc
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from laya_pinned import PINS, fetch, load_agent, sha256


def stage_export(cache):
    import onnx
    import torch
    from torch.export import Dim
    checkpoint = fetch(cache)
    agent = load_agent(checkpoint)
    from rl_common import QTYPES, build_sequence, collate_items
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    torch.backends.mha.set_fastpath_enabled(False)  # keep nn.TransformerEncoderLayer exportable
    max_len, head_max_len = int(agent.cfg["max_len"]), int(agent.cfg["head_max_len"])
    model = agent.model.eval().float()

    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
            logits, act = self.m(input_ids, attention_mask, marker_pos, marker_mask, qtype)
            return logits, act

    # The same sample inputs as layaForWeb, so the traced graph can be compared byte for byte.
    state = {"ticket": {"subject": "App crashes on launch", "text": "Since the last update, the app closes as soon as I open it."}}
    qs = [
        {"t": "choice", "ins": "Which team should handle this?", "crit": {"bug": "Something is broken", "how_to": "A usage question", "sales": "Pricing or plans"}},
        {"t": "score", "ins": "How urgent is this?", "crit": ["Can wait", "This week", "Today", "Right now"]},
        {"t": "noul", "ins": "The customer sounds angry", "crit": None},
    ]
    items = []
    for q in qs:
        seq, mk = build_sequence(agent.tok, state, q, max_len, head_max_len)
        items.append({"ids": seq, "markers": mk, "qtype": QTYPES[q["t"]], "target": [0.0] * len(mk), "label": -1,
                      "episode": 0, "ep_step": 0, "ep_len": 1})
    b = collate_items([items], agent.tok.pad_token_id)
    args = (b["input_ids"], b["attention_mask"], b["marker_pos"], b["marker_mask"], b["qtype"])
    batch, seq, kk = Dim("batch", min=1, max=64), Dim("seq", min=8, max=max_len), Dim("k", min=2, max=255)
    dyn = {"input_ids": {0: batch, 1: seq}, "attention_mask": {0: batch, 1: seq},
           "marker_pos": {0: batch, 1: kk}, "marker_mask": {0: batch, 1: kk}, "qtype": {0: batch}}
    onnx_dir = Path(cache) / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    prog = torch.onnx.export(Wrapper(model).eval(), args, dynamo=True, dynamic_shapes=dyn,
                             input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
                             output_names=["logits", "act_logits"], opset_version=18, optimize=True)
    raw = onnx_dir / "laya_fp32_raw.onnx"
    prog.save(str(raw), external_data=True)
    del prog, model, agent
    gc.collect()
    m = onnx.load(str(raw), load_external_data=False)
    del m.graph.value_info[:]  # stale shape annotations trip the quantizer
    onnx.save(m, str(onnx_dir / "laya_fp32.onnx"))


def _embedding_to_int8(m):
    import numpy as np
    from onnx import TensorProto, helper, numpy_helper
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    new_nodes, drop, added = [], set(), []
    for node in g.node:
        if node.op_type == "Gather" and node.input[0] in inits:
            t = inits[node.input[0]]
            if t.data_type == TensorProto.FLOAT and len(t.dims) == 2 and t.dims[0] > 1000:
                w = numpy_helper.to_array(t).astype(np.float32)
                scale = np.maximum(np.abs(w).max(axis=1, keepdims=True) / 127.0, 1e-8).astype(np.float32)
                q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
                n = t.name
                added += [numpy_helper.from_array(q, n + "_q8"), numpy_helper.from_array(scale.reshape(-1), n + "_scale")]
                new_nodes.append(helper.make_node("DequantizeLinear", [n + "_q8", n + "_scale"], [n + "_dq"], axis=0, name=n + "_DQ"))
                drop.add(n)
                node.input[0] = n + "_dq"
    keep = [i for i in g.initializer if i.name not in drop]
    del g.initializer[:]
    g.initializer.extend(keep)
    g.initializer.extend(added)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(new_nodes + nodes)


def stage_q8e8(cache):
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer
    onnx_dir = Path(cache) / "onnx"
    m = onnx.load(str(onnx_dir / "laya_fp32.onnx"), load_external_data=True)
    q = MatMulNBitsQuantizer(m, algo_config=DefaultWeightOnlyQuantConfig(block_size=128, is_symmetric=True, bits=8))
    q.process()
    tmp = onnx_dir / "laya_q8e8_tmp.onnx"
    q.model.save_model_to_file(str(tmp), use_external_data_format=True)
    del q, m
    gc.collect()
    mq = onnx.load(str(tmp), load_external_data=True)
    _embedding_to_int8(mq)
    onnx.save(mq, str(onnx_dir / "laya_q8e8.onnx"), save_as_external_data=True, all_tensors_to_one_file=True,
              location="laya_q8e8.onnx.data", size_threshold=1024)
    for f in (tmp, Path(str(tmp) + ".data")):
        f.unlink(missing_ok=True)


def _fetch_hosted(cache, base, hosted):
    """Download the hosted graph and reassemble its weight parts under <cache>/hosted."""
    dst = Path(cache) / "hosted"
    dst.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(base + hosted["onnx"], dst / hosted["onnx"])
    data = dst / hosted["data"]["name"]
    if not data.exists() or sha256(data) != hosted["data"]["sha256"]:
        with open(data, "wb") as out:
            for part in hosted["data"]["parts"]:
                with urllib.request.urlopen(base + part) as r:
                    shutil.copyfileobj(r, out)
    if sha256(data) != hosted["data"]["sha256"]:
        sys.exit("hosted weights do not match their own manifest")
    return dst / hosted["onnx"]


def _tensor_report(hosted_graph, rebuilt_graph):
    """Compare every initializer by name. Quantized codes (*_Q8) are compared element-wise."""
    import numpy as np
    import onnx
    from onnx import numpy_helper
    h = {t.name: numpy_helper.to_array(t) for t in onnx.load(str(hosted_graph), load_external_data=True).graph.initializer}
    r = {t.name: numpy_helper.to_array(t) for t in onnx.load(str(rebuilt_graph), load_external_data=True).graph.initializer}
    report = {"sameNames": sorted(h) == sorted(r), "tensors": len(h), "bitIdenticalTensors": 0,
              "quantizedCodes": 0, "differingCodes": 0, "maxCodeDifference": 0, "otherDifferingTensors": []}
    for name, a in h.items():
        b = r.get(name)
        if b is None or a.shape != b.shape or a.dtype != b.dtype:
            report["otherDifferingTensors"].append(name)
            continue
        if a.tobytes() == b.tobytes():
            report["bitIdenticalTensors"] += 1
        if name.endswith("_Q8"):
            d = np.abs(a.astype(np.int16) - b.astype(np.int16))
            report["quantizedCodes"] += int(a.size)
            report["differingCodes"] += int((d != 0).sum())
            report["maxCodeDifference"] = max(report["maxCodeDifference"], int(d.max()))
        elif a.tobytes() != b.tobytes():
            report["otherDifferingTensors"].append(name)
    return report


def stage_compare(cache):
    b = PINS["browserBuild"]
    base = f"https://huggingface.co/{b['repo']}/resolve/{b['revision']}/"
    with urllib.request.urlopen(base + "manifest.json") as r:
        manifest = json.load(r)
    hosted = manifest["variants"][b["variant"]]
    onnx_dir = Path(cache) / "onnx"
    hosted_graph = _fetch_hosted(cache, base, hosted)
    rebuilt = {"data": sha256(onnx_dir / hosted["data"]["name"]), "dataSize": (onnx_dir / hosted["data"]["name"]).stat().st_size,
               "graph": sha256(onnx_dir / hosted["onnx"])}
    result = {"hosted": {"repo": b["repo"], "revision": b["revision"], "manifestSource": manifest.get("source"),
                         "data": hosted["data"]["sha256"], "dataSize": hosted["data"]["size"], "graph": sha256(hosted_graph)},
              "rebuilt": rebuilt}
    result["byteIdentical"] = rebuilt["data"] == result["hosted"]["data"] and rebuilt["graph"] == result["hosted"]["graph"]
    t = result["tensors"] = _tensor_report(hosted_graph, onnx_dir / hosted["onnx"])
    # Same checkpoint and quantizer: every float tensor, scale and embedding identical, and int8 codes
    # differing by at most one step in a tiny fraction of elements (rounding at exact .5 ties).
    result["sameSource"] = (t["sameNames"] and not t["otherDifferingTensors"] and t["maxCodeDifference"] <= 1
                            and t["differingCodes"] <= t["quantizedCodes"] * 1e-4)
    (Path(cache) / "compare.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if not result["sameSource"]:
        sys.exit("the hosted build does not match a rebuild from the pinned checkpoint")


STAGES = {"export": stage_export, "q8e8": stage_q8e8, "compare": stage_compare}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True, help="working directory outside the repository (~3 GB)")
    ap.add_argument("--stage", choices=list(STAGES), help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.stage:
        STAGES[a.stage](a.cache)
        return
    onnx_dir = Path(a.cache) / "onnx"
    plan = [s for s, done in (("export", onnx_dir / "laya_fp32.onnx"), ("q8e8", onnx_dir / "laya_q8e8.onnx.data")) if not done.exists()]
    for stage in plan + ["compare"]:
        print(f"[convert] stage: {stage}", flush=True)
        r = subprocess.run([sys.executable, __file__, "--stage", stage, "--cache", a.cache])
        if r.returncode != 0:
            sys.exit(f"stage {stage} failed with exit code {r.returncode}")


if __name__ == "__main__":
    main()
