"""Question rendering and answer post-processing for Laya, without torch.

A line-for-line port of the input side of the upstream reference
(convaiinnovations/laya rl_common.py: render_options, build_sequence, temp_bucket,
confidence_from_probs; rl_agent_api.py: _to_internal and the answer shaping in
system_one). The runner proves the port by comparing token ids and answers with the
upstream python on every corpus row; a difference fails the run.
"""
import json
import math

import numpy as np

QTYPES = {"choice": 0, "score": 1, "noul": 2}
QTYPE_NAMES = {v: k for k, v in QTYPES.items()}


def to_internal(qdef):
    t = qdef["type"]
    crit = qdef.get("criteria")
    if t == "choice" and isinstance(crit, list):
        crit = {c: None for c in crit}
    ins = qdef["instructions"] if isinstance(qdef["instructions"], str) else json.dumps(qdef["instructions"])
    return {"t": t, "ins": ins, "crit": crit}


def serialize_state(state):
    return state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)


def render_options(q):
    t, crit = q["t"], q.get("crit")
    if t == "choice":
        return [k if not v else "%s: %s" % (k, v) for k, v in crit.items()]
    if t == "score":
        return ["level %d: %s" % (i, c) for i, c in enumerate(crit)]
    crit = crit or {}
    return ["false: " + (crit.get("false") or "no, the statement does not hold"),
            "true: " + (crit.get("true") or "yes, the statement holds")]


class Tok:
    """The subset of a Hugging Face fast tokenizer that build_sequence uses, on the `tokenizers` library."""

    def __init__(self, tokenizer_json):
        from tokenizers import Tokenizer
        self._t = Tokenizer.from_file(tokenizer_json)
        self.mask_token = "[MASK]"
        self.mask_token_id = self._t.token_to_id("[MASK]")
        self.cls_token_id = self._t.token_to_id("[CLS]")
        self.sep_token_id = self._t.token_to_id("[SEP]")
        self.pad_token_id = self._t.token_to_id("[PAD]")

    def ids(self, text):
        return self._t.encode(text, add_special_tokens=False).ids


def build_sequence(tok, state, q, max_len, head_max_len):
    """[CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP] -> (ids, marker positions)."""
    mask_tok = tok.mask_token
    opts = render_options(q)
    ins = str(q["ins"]).replace(mask_tok, " ")
    head_ids = tok.ids("%s question: %s" % (q["t"], ins))
    opt_ids = [[tok.mask_token_id] + tok.ids(" " + o.replace(mask_tok, " "))[:48] for o in opts]
    opt_budget = head_max_len - sum(len(o) for o in opt_ids)
    if opt_budget < 16:
        per = max(4, (head_max_len - 16) // max(1, len(opt_ids)))
        opt_ids = [o[:per] for o in opt_ids]
        opt_budget = head_max_len - sum(len(o) for o in opt_ids)
    head_ids = head_ids[:max(8, opt_budget)]
    ids = [tok.cls_token_id] + head_ids + [tok.sep_token_id]
    markers = []
    for o in opt_ids:
        markers.append(len(ids))
        ids.extend(o)
    ids.append(tok.sep_token_id)
    room = max(0, max_len - len(ids) - 1)
    st = tok.ids(serialize_state(state).replace(mask_tok, " "))[:room]
    ids = ids + st + [tok.sep_token_id]
    return ids[:max_len], [m for m in markers if m < max_len]


def temp_bucket(qtype, k):
    size = "2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+"
    return "%s:%s" % (QTYPE_NAMES[int(qtype)], size)


def confidence_from_probs(p, k):
    """Jev-style confidence: 1 - normalized entropy of the answer distribution."""
    if k < 2:
        return 1.0
    p = np.asarray(p, dtype=np.float64)[:k]
    ent = -(p * np.log(np.clip(p, 1e-12, 1))).sum()
    return float(1 - ent / math.log(k))


def calibrated_probs(logits, qtype, cfg):
    k = len(logits)
    temp = cfg.get("temperature_by_options", {}).get(temp_bucket(qtype, k), cfg.get("temperature", [1.0, 1.0, 1.0])[qtype])
    z = np.asarray(logits, dtype=np.float64) / temp
    p = np.exp(z - z.max())
    return p / p.sum()


def shape_answer(q, p, act_probability):
    """Same answer shape as upstream system_one (rounded to 4 decimals there, unrounded here)."""
    k = len(p)
    ext = {"act_probability": float(act_probability)}
    if q["t"] == "choice":
        keys = list(q["crit"].keys())
        return {"type": "choice", "choice": keys[int(np.argmax(p))], "probabilities": {kk: float(v) for kk, v in zip(keys, p)},
                "confidence": confidence_from_probs(p, k), "rl_agent": ext}
    if q["t"] == "score":
        return {"type": "score", "score": float((np.arange(k) * p).sum()), "legend": {str(i): c for i, c in enumerate(q["crit"])},
                "probabilities": {str(i): float(v) for i, v in enumerate(p)}, "confidence": confidence_from_probs(p, k), "rl_agent": ext}
    return {"type": "noul", "noul": float(p[1]), "rl_agent": ext}
