"""EXP 005 typed-gate runner (bundle 3 WO-01): Jev (hosted) and Laya (open weights, MLX) on the gate inputs.

  python experiments/jev-gate/run_gates.py --gate jev  --out <run.json> --ledger <spend.jsonl> [--items c001,c002 | --practice <file>]
  python experiments/jev-gate/run_gates.py --gate laya --out <run.json> [--items ... | --practice <file>]
  (fixture runs only: --pins <fixture pins.json> [--jev-origin http://127.0.0.1:<port>])

It reuses the EXP 004 code by import, not by copy: experiments/laya-vs-jev/run.py (call_jev, the pinned Laya
files and fetch_pinned), laya_inputs.py and laya_mlx.py, and laya_count.py for the no-cut rule. The only
addition around call_jev is a response handler that keeps the HTTP Date header (pre-registration, clock).

Before anything else it runs runner-guard.mjs, which refuses unless preregistration.json and
amendment-01.json are the published bytes, every pinned file still matches, and the not-before time has
passed. Then it asserts that the EXP 004 code carries the pre-registered pins (model, endpoint, served
prefixes, timeout, price, Laya revision and file hashes) and that every state is rules.txt + "\\n\\n" + diff.

One call per item, sequential, in id order, never retried. A failure is an abstention with its status only.
The Jev key is read from JEV_AI_API_KEY and never written; no request or response header except Date is kept.
Exit code: 0 complete, 1 refused, 2 infrastructure failure, 3 stopped early (partial: spend cap or clock).
"""
import argparse
import datetime as dt
import email.utils
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "laya-vs-jev"))
sys.path.insert(0, HERE)
import laya_inputs as li  # noqa: E402
import run as exp004  # noqa: E402  (experiments/laya-vs-jev/run.py, pinned by sha256 in the pre-registration)

FIXTURE_BANNER = "FIXTURE — produced by fake gates or fixture pins; not a measurement and never publishable"


class Refused(Exception):
    pass


# Local paths never belong in a record (the corpus lint flags them). The reviewer runner scrubs its records the
# same way; here the pre-flight's scanned roots and any error text are the only path sources. Collapse the
# operator's macOS per-user temp dir to <tmp> and the home dir to ~ (the shared /private/tmp, /tmp and var/tmp
# roots carry no operator id and are left as they are, without a trailing slash).
# The slashes are written \/ so the corpus lint (which flags a literal private path) does not flag this regex.
_SCRUB = [(re.compile(r"(\/private)?\/var\/folders\/[^\/]+\/[^\/]+\/T"), "<tmp>")]


def scrub(value):
    if isinstance(value, str):
        s = value
        for rx, to in _SCRUB:
            s = rx.sub(to, s)
        home = os.path.expanduser("~")
        return s.replace(home, "~")
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    return value


# ----------------------------------------------------------------------------- guard and pins
def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def guard(pins_file=None, node=None, mode="counted"):
    """runner-guard.mjs --check: both shas, every pinned file, the not-before time (amendment 02's for a counted run)."""
    cmd = [node or os.environ.get("NODE", "node"), os.path.join(HERE, "runner-guard.mjs"), "--check", "--mode", mode]
    if pins_file:
        cmd += ["--pins", pins_file]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Refused("runner guard gave no answer (exit %s): %s" % (r.returncode, r.stderr.strip()[:300]))
    if r.returncode != 0 or not out.get("ok"):
        raise Refused(out.get("error", "runner guard refused"))
    return out


def answer_key_preflight(mode, node=None):
    """runner-guard.mjs --preflight: the inline answer-key scan, used only for a PRACTICE run now (bundle-4).

    A counted run no longer scans here (see check_preflight_record): it reads the pre-flight record. Practice scans
    inline as before, over an override or the default roots; a practice scan is fast (a small override dir), so the
    old 3600 s counted-scan ceiling is gone. Returns {ok, scanned, skipped, override, copies, ...}.
    """
    cmd = [node or os.environ.get("NODE", "node"), os.path.join(HERE, "runner-guard.mjs"), "--preflight", "--mode", mode]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Refused("answer-key pre-flight gave no answer (exit %s): %s" % (r.returncode, r.stderr.strip()[:300]))
    if not out.get("ok"):
        if out.get("error"):
            raise Refused(out["error"])
        copies = out.get("copies", [])
        raise Refused("%d answer-key copies sit outside home; remove them before a %s run: %s"
                      % (len(copies), mode, ", ".join("%s (= %s)" % (c["path"], c["copyOf"]) for c in copies)))
    return out


def check_preflight_record(path, node=None):
    """runner-guard.mjs --check-preflight: validate the counted pre-flight record (bundle-4). No scan, so no long
    timeout: the record is a small JSON the commander wrote once with --write-record. Returns {sha256, endedAt, head,
    scanned} for the run to stamp, so scoring re-checks against those stamps, not the scorer's live environment."""
    if not path:
        raise Refused("a counted run needs a pre-flight record (--preflight-record); write one with "
                      "runner-guard.mjs --preflight --mode counted --write-record first")
    cmd = [node or os.environ.get("NODE", "node"), os.path.join(HERE, "runner-guard.mjs"), "--check-preflight", path, "--mode", "counted"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Refused("pre-flight record check gave no answer (exit %s): %s" % (r.returncode, r.stderr.strip()[:300]))
    if not out.get("ok"):
        raise Refused(out.get("error", "the pre-flight record is not valid"))
    return {"sha256": out["sha256"], "endedAt": out["endedAt"], "head": out["head"], "scanned": out["scanned"]}


def load_prereg(stamp):
    with open(os.path.join(HERE, "preregistration.json"), "rb") as f:
        raw = f.read()
    if sha256_bytes(raw) != stamp["parentSha256"]:
        raise Refused("preregistration.json changed after the guard checked it")
    return json.loads(raw)


def assert_pins(prereg, mod=exp004):
    """The EXP 004 code must carry exactly the pre-registered pins; any difference refuses."""
    jev, laya, cost = prereg["gates"]["jev"], prereg["gates"]["laya"], prereg["cost"]["jev"]
    checks = [
        ("jev model", mod.JEV_MODEL, jev["model"]),
        ("jev endpoint", mod.JEV_ORIGIN + "/api/v1/systemone", jev["endpoint"]),
        ("jev served prefixes", list(mod.JEV_RELEASE_PREFIXES), jev["acceptedServedModelPrefixes"]),
        ("jev timeout", mod.JEV_TIMEOUT_S, jev["timeoutSeconds"]),
        ("jev price basis", mod.JEV_USD_PER_1M_INPUT, cost["usdPerMillionInputTokens"]),
        ("laya revision", mod.HF_SHA, laya["revision"]),
        ("laya subdir", mod.SUBDIR, laya["subdir"]),
    ]
    for rel, want in laya["fileSha256"].items():
        checks.append(("laya file " + rel, mod.PINNED.get(rel), want))
    for name, got, want in checks:
        if got != want:
            raise Refused("%s is %r in the EXP 004 code, pre-registered %r" % (name, got, want))
    with open(os.path.join(HERE, "gate-question.json")) as f:
        if json.load(f) != prereg["gateQuestion"]:
            raise Refused("gate-question.json differs from the pre-registered gateQuestion")


def load_items(prereg, ids=None, practice=None):
    """Items in id order. Every state must be rules.txt + "\\n\\n" + diff and hash to its recorded sha."""
    with open(os.path.join(HERE, "inputs.json")) as f:
        inputs = json.load(f)
    with open(os.path.join(HERE, "rules.txt")) as f:
        rules = f.read()
    if inputs["stateConstruction"] != prereg["stateConstruction"]:
        raise Refused("inputs.json states a different state construction")
    corpus_ids = {i["id"] for i in inputs["items"]}
    if practice:
        with open(practice) as f:
            items = json.load(f)["items"]
        for i in items:
            if i["id"] in corpus_ids:
                raise Refused("practice row %s is a corpus id" % i["id"])
            i.setdefault("stateSha256", sha256_bytes(i["state"].encode()))
    else:
        items = inputs["items"]
        if ids:
            unknown = sorted(set(ids) - corpus_ids)
            if unknown:
                raise Refused("unknown corpus ids: %s" % ", ".join(unknown))
            items = [i for i in items if i["id"] in ids]
    for i in items:
        if not i["state"].startswith(rules + "\n\n"):
            raise Refused("%s: state is not rules.txt + blank line + diff" % i["id"])
        if sha256_bytes(i["state"].encode()) != i["stateSha256"]:
            raise Refused("%s: state does not hash to its recorded sha" % i["id"])
    return sorted(({"id": i["id"], "state": i["state"]} for i in items), key=lambda i: i["id"])


# ----------------------------------------------------------------------------- spend ledger
class SpendLedger:
    """Same file and rule as run_reviewer.mjs: stop before a paid call if spent + largest seen for the gate > cap."""

    def __init__(self, path, cap):
        self.path, self.cap = path, cap

    def entries(self):
        if not os.path.exists(self.path):
            return []
        with open(self.path) as f:
            lines = [json.loads(line) for line in f if line.strip()]
        # Lines at or before countFrom are already inside alreadySpentUsd (runner-guard effectiveSpendCap).
        start = self.cap.get("countFrom")
        # A line without a time is counted (the conservative side), as run_reviewer.mjs does.
        return [e for e in lines if not start or not e.get("ts") or parse_iso(e["ts"]) > parse_iso(start)]

    def spent(self):
        return self.cap["alreadySpentUsd"] + sum(e["costUsd"] for e in self.entries() if isinstance(e.get("costUsd"), (int, float)))

    def largest(self, gate):
        costs = [e["costUsd"] for e in self.entries() if e.get("gate") == gate and isinstance(e.get("costUsd"), (int, float))]
        seen = max(costs) if costs else 0
        return max(seen, self.cap["alreadySpentUsd"]) if gate == "reviewer" else seen

    def check(self, gate):
        spent, largest = self.spent(), self.largest(gate)
        return {"ok": not (spent + largest > self.cap["usd"]), "spent": spent, "largest": largest, "cap": self.cap["usd"]}

    def append(self, entry):
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with open(self.path, "a") as f:
            f.write(json.dumps(entry) + "\n")


# ----------------------------------------------------------------------------- Jev
class DateHeader(urllib.request.BaseHandler):
    """Keeps the Date header of every response, error responses included (runs before HTTPErrorProcessor)."""
    handler_order = 500

    def __init__(self):
        self.last = None

    def http_response(self, request, response):
        self.last = response.headers.get("Date")
        return response

    https_response = http_response


def install_date_capture():
    handler = DateHeader()
    urllib.request.install_opener(urllib.request.build_opener(handler))
    return handler


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def typed_record(prereg, p, reported_confidence=None):
    """The pre-registered decision rule: REJECT when p >= decisionThreshold; confidence = max(p, 1 - p)."""
    p = float(p)
    return {"p": p, "decision": "REJECT" if p >= prereg["decisionRules"]["decisionThreshold"] else "ACCEPT",
            "confidence": max(p, 1 - p), "reportedConfidence": reported_confidence}


def jev_call(prereg, key, item, not_before, date_capture, mod=exp004):
    date_capture.last = None
    started = utc_now()
    t = time.perf_counter()
    res = mod.call_jev(key, {"state": item["state"], "question": prereg["gateQuestion"]})
    wall_ms = (time.perf_counter() - t) * 1000
    ended = utc_now()
    rec = {"id": item["id"], "run": 1, "gate": "jev", "startedAt": iso(started), "endedAt": iso(ended),
           "latencyMs": round(wall_ms, 1), "status": res["status"], "servedModel": res.get("servedModel"),
           "dateHeader": date_capture.last, "inputTokens": None, "costUsd": None, "costBasis": "listed-price",
           "decision": None, "p": None, "confidence": None, "reportedConfidence": None, "abstention": "failure", "excluded": None}
    if res["status"] == "ok":
        ans = res["answer"]
        try:
            rec.update(typed_record(prereg, ans["noul"], ans.get("confidence")))
            rec["abstention"] = None
        except (KeyError, TypeError, ValueError):
            rec["status"] = "malformed-answer"
        tokens = res.get("inputTokens")
        if isinstance(tokens, int) and tokens >= 0:
            rec["inputTokens"] = tokens
            rec["costUsd"] = tokens * prereg["cost"]["jev"]["usdPerMillionInputTokens"] / 1e6
    nb = parse_iso(not_before)
    if not started > nb:
        rec["excluded"] = "local start not after the not-before time"
    elif rec["dateHeader"]:
        try:
            served_at = email.utils.parsedate_to_datetime(rec["dateHeader"])
            if not served_at > nb:
                rec["excluded"] = "Date header not after the not-before time"
        except (TypeError, ValueError):
            rec["excluded"] = "Date header unreadable"
    return rec


def run_jev(prereg, stamp, items, ledger, record, save, key, mod=exp004):
    date_capture = install_date_capture()
    for item in items:
        if not utc_now() > parse_iso(stamp["notBefore"]):
            record["partial"] = {"reason": "clock"}
            return
        g = ledger.check("jev")
        if not g["ok"]:
            record["partial"] = dict(reason="spend-cap", **g)
            return
        rec = jev_call(prereg, key, item, stamp["notBefore"], date_capture, mod)
        ledger.append({"ts": rec["endedAt"], "gate": "jev", "kind": record["mode"], "id": item["id"], "run": 1,
                       "costUsd": rec["costUsd"], "fixture": stamp["fixture"]})
        record["calls"].append(rec)
        save()


# ----------------------------------------------------------------------------- Laya
def laya_answer(model, tok, cfg, q, state):
    import laya_count
    counts = laya_count.count(tok, state, q, cfg["max_len"], cfg["head_max_len"])
    if not counts["fits"]:
        return None, counts
    ids, markers = li.build_sequence(tok, state, q, cfg["max_len"], cfg["head_max_len"])
    logits, act = model.forward(ids, markers, q["t"])
    p = li.calibrated_probs(logits, li.QTYPES[q["t"]], cfg)
    return li.shape_answer(q, p, act[0]), counts


def run_laya(prereg, stamp, items, record, save, model, tok, cfg):
    q = li.to_internal(prereg["gateQuestion"])
    t = time.perf_counter()
    laya_answer(model, tok, cfg, q, "warm-up: not a corpus item")  # compiles Metal kernels; not a gate call
    record["laya"] = {"firstCallMs": round((time.perf_counter() - t) * 1000, 1)}
    for item in items:
        if not utc_now() > parse_iso(stamp["notBefore"]):
            record["partial"] = {"reason": "clock"}
            return
        started = utc_now()
        t = time.perf_counter()
        rec = {"id": item["id"], "run": 1, "gate": "laya", "startedAt": iso(started), "costUsd": None, "costBasis": "local-no-price",
               "decision": None, "p": None, "confidence": None, "reportedConfidence": None, "abstention": "failure", "excluded": None}
        try:
            ans, counts = laya_answer(model, tok, cfg, q, item["state"])
            rec["tokens"] = counts["totalTokens"]
            if ans is None:
                rec["status"] = "refused-input: " + "; ".join(counts["reasons"])
            elif ans.get("type") != "noul":
                rec["status"] = "malformed-answer"
            else:
                rec.update(typed_record(prereg, ans["noul"], ans.get("confidence")))
                rec.update(status="ok", abstention=None)
        except Exception as e:  # a failed call is an abstention with its reason, never retried
            rec["status"] = "error:%s" % type(e).__name__
        rec["latencyMs"] = round((time.perf_counter() - t) * 1000, 1)
        rec["endedAt"] = iso(utc_now())
        record["calls"].append(rec)
        save()


def load_laya(cache):
    from laya_mlx import LayaMLX
    snapshot = exp004.fetch_pinned(cache)  # verifies every pinned file hash
    model_dir = os.path.join(snapshot, exp004.SUBDIR)
    model = LayaMLX(model_dir)
    tok = li.Tok(os.path.join(model_dir, "tokenizer", "tokenizer.json"))
    return model, tok, model.cfg


# ----------------------------------------------------------------------------- main
def main(argv=None, env=None, laya_loader=load_laya):
    env = os.environ if env is None else env
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gate", choices=["jev", "laya"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ledger")
    ap.add_argument("--items")
    ap.add_argument("--practice")
    ap.add_argument("--pins", help="fixture pins (tests and fake runs only; marks the record FIXTURE)")
    ap.add_argument("--jev-origin", help="fixture runs only: a fake Jev server")
    ap.add_argument("--preflight-record", help="counted runs: the answer-key pre-flight record written by runner-guard.mjs --preflight --write-record")
    ap.add_argument("--rehearsal", action="store_true",
                    help="build a counted-shaped record with the model call stubbed (no gate call, no spend); for the end-to-end scorer rehearsal test only")
    ap.add_argument("--cache", default=env.get("LAYA_CACHE", os.path.expanduser("~/.cache/odin-rnd/laya")))
    args = ap.parse_args(argv)
    try:
        stamp = guard(args.pins, mode="practice" if args.practice else "counted")
        prereg = load_prereg(stamp)
        assert_pins(prereg)
        if args.rehearsal and stamp["fixture"]:
            raise Refused("a rehearsal is a non-fixture dry check; do not pass --pins")
        if args.jev_origin and not stamp["fixture"]:
            raise Refused("--jev-origin is for fixture runs only")
        # A fixture Jev run only ever talks to a fake on this machine, never to the real endpoint.
        if stamp["fixture"] and args.gate == "jev" and not (args.jev_origin or "").startswith(("http://127.0.0.1:", "http://localhost:")):
            raise Refused("a fixture Jev run needs a loopback --jev-origin (a fake server)")
        items = load_items(prereg, args.items.split(",") if args.items else None, args.practice)
        # A counted run covers the whole corpus in one invocation, so the scorer sees a complete record (refute B1).
        if not args.practice and not stamp["fixture"] and args.items:
            raise Refused("a counted run covers the whole corpus in one invocation; do not pass --items")
        # A counted Jev run appends to the committed ledger, so the cap continues from the recorded total, not a
        # fresh file starting at alreadySpentUsd (refute N3). Laya is free, so it keeps no ledger.
        if not args.practice and not args.rehearsal and not stamp["fixture"] and args.gate == "jev":
            committed = os.path.join(ROOT, "experiments", "jev-gate", "spend-ledger.jsonl")
            if not args.ledger or os.path.abspath(args.ledger) != committed:
                raise Refused("a counted run appends to the committed ledger experiments/jev-gate/spend-ledger.jsonl; the cap must continue from the recorded total")
    except Refused as e:
        print("refused: %s" % e, file=sys.stderr)
        return 1

    record = {"schemaVersion": 1, "kind": "gate-run", "gate": args.gate, "mode": "practice" if args.practice else "counted",
              "fixture": stamp["fixture"], "parentSha256": stamp["parentSha256"], "amendmentSha256": stamp["amendmentSha256"],
              "amendment02Sha256": stamp.get("amendment02Sha256"),
              "notBefore": stamp["notBefore"], "code": stamp["code"], "startedAt": iso(utc_now()), "endedAt": None,
              "machine": {"os": platform.platform(), "arch": platform.machine(), "python": platform.python_version()},
              # partial stays {reason:in-progress} until the loop finishes normally (refute B1): a crash or a Python
              # exception then leaves a visibly partial record, so results.mjs gives it no state. main() sets it to
              # None on clean completion; an early stop (clock, spend-cap) sets the reason it stopped for.
              "items": [i["id"] for i in items], "partial": {"reason": "in-progress"}, "calls": []}
    if stamp["fixture"]:
        record["banner"] = FIXTURE_BANNER

    def save():
        record["endedAt"] = iso(utc_now())
        tmp = args.out + ".tmp"
        with open(tmp, "w") as f:
            json.dump(scrub(record), f, indent=2, ensure_ascii=False)  # scrub local paths at write time
            f.write("\n")
        os.replace(tmp, args.out)

    if args.rehearsal:
        # The record builder ran under the counted stamp (all its fields, including amendment02Sha256). Fill one
        # stubbed call per item and mark it rehearsal so it can never be published (refute r2, the class fix).
        record["rehearsal"] = True
        # A rehearsal carries a pre-flight record and validates + stamps it exactly as a counted run does (no scan is
        # run — the gate call is stubbed), so the scorer's pre-flight check is exercised by the class guard rather
        # than exempted (refute r5-B1). The stubbed call starts just after the record's scan ended (and so after the
        # not-before), inside the freshness window the scorer checks.
        try:
            pf = check_preflight_record(args.preflight_record)
        except Refused as e:
            record["partial"] = {"reason": "answer-key pre-flight record refused"}
            save()
            print("refused: %s" % e, file=sys.stderr)
            return 1
        record["head"] = pf["head"]
        record["preflightRoots"] = pf["scanned"]
        record["preflight"] = {"sha256": pf["sha256"], "endedAt": pf["endedAt"]}
        started = iso(parse_iso(pf["endedAt"]) + dt.timedelta(seconds=1))
        for item in items:
            # p and confidence are arbitrary decided-call values, deliberately chosen to be no spotlight threshold
            # (the "no threshold literal in runner code" test forbids any threshold value as a literal here).
            rec = {"id": item["id"], "run": 1, "gate": args.gate, "startedAt": started, "endedAt": started,
                   "latencyMs": 0.0, "status": "ok", "decision": "ACCEPT", "p": 0.2, "confidence": 0.8,
                   "reportedConfidence": 0.8, "abstention": None, "excluded": None}
            if args.gate == "jev":
                rec.update(servedModel=None, dateHeader=None, inputTokens=0, costUsd=0.0, costBasis="listed-price")
            else:
                rec.update(tokens=0, costUsd=None, costBasis="local-no-price")
            record["calls"].append(rec)
        record["partial"] = None
        save()
        print("wrote", args.out, "(rehearsal)")
        return 0

    # Answer-key pre-flight before any paid loop. A COUNTED run no longer scans here (a per-runner scan took over
    # an hour under fleet temp load, past the old 3600 s ceiling): it requires the pre-flight RECORD written once by
    # runner-guard.mjs --preflight --mode counted --write-record, and stores its path/sha/endedAt (bundle-4). A
    # PRACTICE run scans inline as before. Fixture runs skip it (they never reach a real gate).
    if not stamp["fixture"]:
        if record["mode"] == "counted":
            try:
                pf = check_preflight_record(args.preflight_record)
            except Refused as e:
                record["partial"] = {"reason": "answer-key pre-flight record refused"}
                save()
                print("refused: %s" % e, file=sys.stderr)
                return 1
            # Stamp the run-time head and the record's scanned roots and sha, so scoring re-checks the committed
            # record against what THIS run recorded, not the scorer's live git HEAD or temp roots (refute r5-B1).
            record["head"] = pf["head"]
            record["preflightRoots"] = pf["scanned"]
            record["preflight"] = {"sha256": pf["sha256"], "endedAt": pf["endedAt"]}
        else:
            try:
                pf = answer_key_preflight(record["mode"])
            except Refused as e:
                record["partial"] = {"reason": "answer-key pre-flight refused"}
                save()
                print("refused: %s" % e, file=sys.stderr)
                return 1
            record["preflight"] = {"scanned": pf["scanned"], "skipped": pf["skipped"], "override": pf.get("override"),
                                   "copies": [], "vanished": pf.get("vanished"), "permissionSkipped": pf.get("permissionSkipped"),
                                   "durationMs": pf.get("durationMs")}

    if args.gate == "jev":
        if not args.ledger:
            print("refused: --ledger is required for a paid gate", file=sys.stderr)
            return 1
        key = env.get("JEV_AI_API_KEY", "").strip()
        jev = prereg["gates"]["jev"]
        record["pins"] = {"model": jev["model"], "endpoint": jev["endpoint"], "timeoutSeconds": jev["timeoutSeconds"],
                          "userAgent": exp004.USER_AGENT, "priceBasis": prereg["cost"]["jev"]["basis"], "spendCap": stamp["spendCap"]}
        if not key:
            record["partial"] = {"reason": "not run: no JEV_AI_API_KEY in the environment"}
            save()
            return 2
        origin = exp004.JEV_ORIGIN
        if args.jev_origin:
            exp004.JEV_ORIGIN = args.jev_origin
            record["pins"]["endpoint"] = "FIXTURE fake server"
        try:
            run_jev(prereg, stamp, items, SpendLedger(args.ledger, stamp["spendCap"]), record, save, key)
        finally:
            exp004.JEV_ORIGIN = origin
            del key
    else:
        laya = prereg["gates"]["laya"]
        record["pins"] = {"revision": laya["revision"], "fileSha256": laya["fileSha256"], "backend": laya["backend"]}
        try:
            model, tok, cfg = laya_loader(args.cache)
        except Exception as e:
            record["partial"] = {"reason": "laya could not load: %s" % type(e).__name__}
            save()
            return 2
        run_laya(prereg, stamp, items, record, save, model, tok, cfg)
    if record["partial"] == {"reason": "in-progress"}:
        record["partial"] = None  # the loop finished normally
    save()
    print("wrote", args.out, "(partial: %s)" % record["partial"]["reason"] if record["partial"] else "")
    return 3 if record["partial"] else 0


if __name__ == "__main__":
    sys.exit(main())
