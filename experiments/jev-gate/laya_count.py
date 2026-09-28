"""Pre-cut Laya token counts for EXP 005 gate inputs (tokenizer only; no model is loaded or run).

Laya's build_sequence (../laya-vs-jev/laya_inputs.py) always cuts its input to fit: options to 48
tokens, the question head to the head budget, the state to the room left under max_len. A cut input
would silently change what the gate sees, so this script measures every part BEFORE the cut and
refuses anything that would be cut (the same refuse-if-it-does-not-fit rule as
../laya-vs-jev/run.py, which refuses a row whose options do not fit):

  * each option: len(ids(" " + option)) <= 48 (the per-option cut);
  * the options budget head_max_len - sum(option lengths) >= 16 (else every option is shortened);
  * the question head: len(ids("<type> question: <instructions>")) <= that budget (and so <= head_max_len);
  * the state: len(ids(state)) <= room, where room = max_len - (prefix length) - 1.

For an input that fits, it also checks that build_sequence returns exactly the uncut sequence.

  python laya_count.py [--model-dir DIR] < request.json > counts.json

request.json: {"question": {"type": "noul", "instructions": "..."}, "items": [{"id": "...", "state": "..."}]}
"""
import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "laya-vs-jev"))
import laya_inputs as li  # noqa: E402
from run import HF_SHA, PINNED, SUBDIR  # noqa: E402  (pinned file hashes of the EXP 004 recording)

OPTION_CAP = 48
MIN_OPTION_BUDGET = 16
PINNED_FILES = ("typed-decisions/tokenizer/tokenizer.json", "typed-decisions/rl_agent_config.json")


def sha256_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def load(model_dir):
    for rel in PINNED_FILES:
        path = os.path.join(model_dir, os.path.relpath(rel, SUBDIR))
        got = sha256_file(path)
        if got != PINNED[rel]:
            raise SystemExit("sha256 mismatch for %s: %s != %s" % (rel, got, PINNED[rel]))
    with open(os.path.join(model_dir, "rl_agent_config.json")) as f:
        cfg = json.load(f)
    tok = li.Tok(os.path.join(model_dir, "tokenizer", "tokenizer.json"))
    return tok, cfg["max_len"], cfg["head_max_len"]


def count(tok, state, q, max_len, head_max_len):
    """Pre-cut measurement of one input. Returns a dict; fits is False when build_sequence would cut anything."""
    opts = li.render_options(q)
    ins = str(q["ins"]).replace(tok.mask_token, " ")
    head = tok.ids("%s question: %s" % (q["t"], ins))
    raw_opts = [tok.ids(" " + o.replace(tok.mask_token, " ")) for o in opts]
    opt_ids = [[tok.mask_token_id] + o for o in raw_opts]
    opt_budget = head_max_len - sum(len(o) for o in opt_ids)
    prefix = 1 + len(head) + 1 + sum(len(o) for o in opt_ids) + 1
    room = max_len - prefix - 1
    st = tok.ids(li.serialize_state(state).replace(tok.mask_token, " "))
    reasons = []
    for i, o in enumerate(raw_opts):
        if len(o) > OPTION_CAP:
            reasons.append("option %d is %d tokens > %d" % (i, len(o), OPTION_CAP))
    if opt_budget < MIN_OPTION_BUDGET:
        reasons.append("options budget %d < %d" % (opt_budget, MIN_OPTION_BUDGET))
    if len(head) > max(8, opt_budget) or len(head) > head_max_len:
        reasons.append("question head %d tokens > budget %d" % (len(head), max(8, opt_budget)))
    if room < 0 or len(st) > room:
        reasons.append("state %d tokens > room %d" % (len(st), room))
    out = {"stateTokens": len(st), "room": room, "headTokens": len(head), "headBudget": opt_budget,
           "optionTokens": [len(o) for o in raw_opts], "totalTokens": prefix + len(st) + 1,
           "maxLen": max_len, "headMaxLen": head_max_len, "fits": not reasons, "reasons": reasons}
    if not reasons:
        # The uncut sequence must be exactly what build_sequence produces: nothing was cut.
        uncut = [tok.cls_token_id] + head + [tok.sep_token_id] + sum(opt_ids, []) + [tok.sep_token_id] + st + [tok.sep_token_id]
        ids, markers = li.build_sequence(tok, state, q, max_len, head_max_len)
        if ids != uncut or len(markers) != len(opts):
            raise SystemExit("build_sequence cut an input the pre-cut counts said fits")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cache = os.environ.get("LAYA_CACHE", os.path.expanduser("~/.cache/odin-rnd/laya"))
    ap.add_argument("--model-dir", default=os.path.join(cache, HF_SHA, SUBDIR))
    args = ap.parse_args()
    tok, max_len, head_max_len = load(args.model_dir)
    req = json.load(sys.stdin)
    q = li.to_internal(req["question"])
    items = {it["id"]: count(tok, it["state"], q, max_len, head_max_len) for it in req["items"]}
    json.dump({"tokenizer": {"hfRevision": HF_SHA, "tokenizerSha256": PINNED[PINNED_FILES[0]],
                             "configSha256": PINNED[PINNED_FILES[1]], "maxLen": max_len, "headMaxLen": head_max_len},
               "items": items}, sys.stdout, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
