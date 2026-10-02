"""EXP 008 (latent-handoff) token counter for the strata builder (bundle 3 WO-02).

Reads one JSON request on stdin and writes one JSON answer on stdout. Tokenizers are loaded from the pinned
tokenizer.json files (no special tokens added; the counts are of the raw context text).

Request:  {"tokenizers": {"qwen3": <path>, "llama3": <path>}, "target": 16000,
           "items": [{"id", "head": <text before the distractor>, "tail": <text after it>}], "distractor": <text>}
Answer:   {"items": [{"id", "lines": n, "tokens": {"qwen3": .., "llama3": ..}, "padTokens": {...}}]}

For each item, `lines` is the largest number of leading distractor lines whose L context (head + distractor[:lines] +
tail) stays at or under the target under the MEAN of the two tokenizers (binary search; deterministic).
"""
import json
import sys

from tokenizers import Tokenizer


def main():
    req = json.load(sys.stdin)
    toks = {name: Tokenizer.from_file(path) for name, path in sorted(req["tokenizers"].items())}
    count = lambda text: {n: len(t.encode(text, add_special_tokens=False).ids) for n, t in toks.items()}
    lines = req["distractor"].split("\n")
    target = req["target"]
    out = []
    for item in req["items"]:
        def build(k):
            return item["head"] + "\n".join(lines[:k]) + item["tail"]

        mean = lambda c: sum(c.values()) / len(c)
        lo, hi = 0, len(lines)
        if mean(count(build(hi))) <= target:
            raise SystemExit(f"distractor too short for item {item['id']}")
        while lo < hi:  # largest k with mean(count(build(k))) <= target
            mid = (lo + hi + 1) // 2
            if mean(count(build(mid))) <= target:
                lo = mid
            else:
                hi = mid - 1
        full = count(build(lo))
        bare = count(build(0))
        out.append({"id": item["id"], "lines": lo, "tokens": full, "padTokens": {n: full[n] - bare[n] for n in full}})
    if req.get("count"):
        out_counts = [{"id": c["id"], "tokens": count(c["text"])} for c in req["count"]]
    else:
        out_counts = []
    json.dump({"items": out, "counts": out_counts}, sys.stdout, sort_keys=True)


if __name__ == "__main__":
    main()
