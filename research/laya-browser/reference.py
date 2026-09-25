#!/usr/bin/env python3
"""Answer the fixed cases with the original float32 PyTorch model (the reference for the browser proof).

    python research/laya-browser/reference.py --cache ~/.cache/odin-rnd-laya --out reference.json
"""
import argparse
import json
import platform
import time
from pathlib import Path

from laya_pinned import HERE, PINS, fetch, load_agent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True, help="directory for the ~843 MB checkpoint (outside the repository)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    import torch
    agent = load_agent(fetch(a.cache))
    from rl_common import build_sequence
    cases = json.loads((HERE / "cases.json").read_text())["cases"]
    results = []
    for case in cases:
        t0 = time.perf_counter()
        answer = agent.system_one(case["state"], {case["id"]: case["question"]})["answers"][case["id"]]
        seconds = round(time.perf_counter() - t0, 3)
        ids, markers = build_sequence(agent.tok, case["state"], agent._to_internal(case["question"]),
                                      agent.cfg["max_len"], agent.cfg["head_max_len"])
        results.append({"id": case["id"], "answer": answer, "seconds": seconds, "inputIds": ids, "markers": markers})
    report = {"model": PINS["source"], "runtime": {"python": platform.python_version(), "torch": torch.__version__,
              "device": "cpu", "dtype": "float32", "machine": platform.machine()},
              "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results}
    Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps([{"id": r["id"], "answer": r["answer"], "seconds": r["seconds"]} for r in results], indent=2))


if __name__ == "__main__":
    main()
