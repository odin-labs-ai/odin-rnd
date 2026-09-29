"""Offline tests for run_gates.py: no Jev key, no network beyond a local fake server, no Laya weights run.

  experiments/jev-gate/.venv/bin/python -m unittest experiments/jev-gate/test_run_gates.py

The Laya tests need the pinned tokenizer and config in the local cache (~/.cache/odin-rnd/laya) and skip
without them. The model itself is a fake that returns fixed logits; only a live run proves the MLX port here.
"""
import atexit
import contextlib
import http.server
import io
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr
from unittest import mock

# Signal-safe test scratch (bundle-3 refute r4 hygiene; the Python equivalent of scripts/jev-gate-scratch.mjs).
# Some tests copy an answer file (labels.json) into a temp dir. A TemporaryDirectory or addCleanup removes it on
# normal exit and on failures, but NOT on SIGINT/SIGTERM/SIGHUP, so a killed run (a Ctrl-C, a pkill, a timeout)
# strands the copy in a scanned temp root, where the counted pre-flight then refuses. So every scratch dir made
# here is also removed on those signals and at interpreter exit. A SIGKILL (kill -9) cannot be caught; the counted
# answer-key pre-flight is the catch for that, and the operator runs it before a counted run.
_SCRATCH = set()
_SCRATCH_INSTALLED = False


def _scratch_cleanup(*_a):
    for d in list(_SCRATCH):
        shutil.rmtree(d, ignore_errors=True)
        _SCRATCH.discard(d)


def _install_scratch_cleanup():
    global _SCRATCH_INSTALLED
    if _SCRATCH_INSTALLED:
        return
    _SCRATCH_INSTALLED = True
    atexit.register(_scratch_cleanup)
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        def handler(signum, frame):
            _scratch_cleanup()
            signal.signal(signum, signal.SIG_DFL)  # restore the default and re-raise, so the process still dies
            os.kill(os.getpid(), signum)
        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):
            pass  # signals can only be set from the main thread; the atexit hook still covers exit


def scratch_mkdtemp(label="scratch"):
    """A jev-gate-<label>- temp dir removed at interpreter exit and on SIGINT/SIGTERM/SIGHUP (pair with addCleanup)."""
    _install_scratch_cleanup()
    d = tempfile.mkdtemp(prefix="jev-gate-%s-" % label)
    _SCRATCH.add(d)
    return d


@contextlib.contextmanager
def scratch_dir(label="scratch"):
    """As scratch_mkdtemp, plus removal on normal block exit and on exceptions."""
    d = scratch_mkdtemp(label)
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)
        _SCRATCH.discard(d)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_gates as rg  # noqa: E402

# The answer-key pre-flight is no longer part of the guard --check (it is a slow machine scan): the runner runs it
# (answer_key_preflight -> runner-guard.mjs --preflight) before a paid loop. So guard(mode="counted") no longer
# scans, and the gate main() tests all use fixture pins (fixture runs skip the pre-flight) or refuse before it.

PINS = os.path.join(HERE, "fixtures", "pins.fixture.json")
KEY = "sk_test_never_written_0123456789"
LAYA_DIR = os.path.join(os.path.expanduser(os.environ.get("LAYA_CACHE", "~/.cache/odin-rnd/laya")), rg.exp004.HF_SHA, rg.exp004.SUBDIR)
HAVE_NODE = shutil.which(os.environ.get("NODE", "node")) is not None


class FakeJev(http.server.BaseHTTPRequestHandler):
    """Answers like jev-ai.pro/api/v1/systemone. Behaviour per call from the class-level script."""
    script = []
    seen = []
    date = "Tue, 29 Sep 2026 10:00:00 GMT"

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeJev.seen.append({"body": body, "auth": self.headers.get("Authorization"), "ua": self.headers.get("User-Agent")})
        mode = FakeJev.script[(len(FakeJev.seen) - 1) % len(FakeJev.script)]
        if mode == "503":
            self.send_response(503)
            self.send_header("X-Echo", self.headers.get("Authorization", ""))
            self.end_headers()
            self.wfile.write(b'{"error": "echo ' + KEY.encode() + b'"}')
            return
        model = "jev-0.9.0" if mode == "wrong-model" else "typesafe/jev-1.13.0"
        answer = {"type": "choice", "choice": "a"} if mode == "malformed" else {"type": "noul", "noul": 0.9 if mode == "wrong-model" else float(mode), "confidence": 0.42}
        payload = json.dumps({"model": model, "answers": {"q": answer}, **({} if mode == "0.2" else {"usage": {"input_tokens": 1000}})}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def date_time_string(self, timestamp=None):  # the one Date header send_response writes
        return FakeJev.date

    def log_message(self, *a):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeJev)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Pins(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "preregistration.json")) as f:
            cls.prereg = json.load(f)

    def test_exp004_code_carries_the_preregistered_pins(self):
        rg.assert_pins(self.prereg)

    def test_any_pin_difference_refuses(self):
        for attr, value in [("JEV_MODEL", "jev-1.14.0"), ("JEV_TIMEOUT_S", 30), ("JEV_USD_PER_1M_INPUT", 0.124),
                            ("HF_SHA", "0" * 40), ("JEV_ORIGIN", "https://example.com"), ("JEV_RELEASE_PREFIXES", ("jev",))]:
            with mock.patch.object(rg.exp004, attr, value), self.assertRaises(rg.Refused, msg=attr):
                rg.assert_pins(self.prereg)
        pinned = dict(rg.exp004.PINNED)
        pinned["typed-decisions/model.safetensors"] = "0" * 64
        with mock.patch.object(rg.exp004, "PINNED", pinned), self.assertRaises(rg.Refused):
            rg.assert_pins(self.prereg)

    def test_items_are_the_state_construction_and_hash(self):
        items = rg.load_items(self.prereg)
        self.assertEqual([i["id"] for i in items], sorted(i["id"] for i in items))
        self.assertEqual(len(items), 60)
        with self.assertRaises(rg.Refused):
            rg.load_items(self.prereg, ids=["c999"])
        with tempfile.TemporaryDirectory() as d:
            bad = os.path.join(d, "p.json")
            with open(bad, "w") as f:
                json.dump({"items": [{"id": "c001", "state": "x"}]}, f)
            with self.assertRaises(rg.Refused):
                rg.load_items(self.prereg, practice=bad)

    def test_decision_rule(self):
        self.assertEqual(rg.typed_record(self.prereg, self.prereg["decisionRules"]["decisionThreshold"])["decision"], "REJECT")
        r = rg.typed_record(self.prereg, 0.2, 0.9)
        self.assertEqual((r["decision"], round(r["confidence"], 6), r["reportedConfidence"]), ("ACCEPT", 0.8, 0.9))


@unittest.skipUnless(HAVE_NODE, "node is needed for runner-guard.mjs")
class Guard(unittest.TestCase):
    def test_practice_and_counted_pass_the_guard_with_amendment_02_frozen(self):
        practice = rg.guard(mode="practice")
        self.assertEqual((practice["fixture"], practice["mode"], practice["notBefore"]), (False, "practice", "2026-09-28T12:01:15Z"))
        self.assertEqual(practice["spendCap"]["countFrom"], "2026-09-28T12:01:15Z")
        self.assertEqual(practice["amendmentSha256"], "5ddd8df9920c71fb26a2da68a8859d95130c04f1279345da56b3fd7bf7933bbb")
        self.assertIn("experiments/jev-gate/run_gates.py", practice["code"])
        # A counted run now passes the guard (amendment 02 frozen, odin-rnd #14); its clock is amendment 02's mergedAt.
        counted = rg.guard(mode="counted")
        self.assertEqual((counted["mode"], counted["notBefore"]), ("counted", "2026-09-28T18:36:49Z"))
        self.assertEqual(counted["amendment02Sha256"], "75d231c255d70fa537cb3f4fc90e780be053b42aa5fc8997f003009297d8cb9b")
        self.assertEqual(counted["spendCap"]["countFrom"], "2026-09-28T18:36:49Z")

    def test_fixture_pins_pass_and_mark_fixture(self):
        self.assertTrue(rg.guard(PINS)["fixture"])

    def test_the_spend_cap_starts_from_the_amendment(self):
        cap = rg.guard(PINS)["spendCap"]
        self.assertEqual((cap["alreadySpentUsd"], cap["alreadySpentFrom"]), (1.128393, "amendment-01"))
        ledger = rg.SpendLedger(os.devnull, cap)
        self.assertEqual(ledger.spent(), 1.128393)

    def test_the_answer_key_preflight_scans_records_and_refuses(self):
        # The Python wrapper over runner-guard.mjs --preflight (bundle-3 refute B2): a practice override scans the
        # named dir and records it; a byte-for-byte copy refuses; the override is refused outright in a counted run.
        # A TemporaryDirectory context manager removes the dir (which holds a labels.json copy) on block exit, incl.
        # on failure, so a test run leaves nothing behind (refute r3 addendum).
        old = os.environ.get("JEV_GATE_PREFLIGHT_ROOTS")
        with scratch_dir("preflight") as d:
            os.environ["JEV_GATE_PREFLIGHT_ROOTS"] = d
            try:
                pf = rg.answer_key_preflight("practice")
                self.assertTrue(pf["ok"])
                self.assertEqual(pf["scanned"], [d])
                self.assertEqual(pf["override"], d)
                shutil.copyfile(os.path.join(HERE, "labels.json"), os.path.join(d, "labels.json"))
                with self.assertRaises(rg.Refused):
                    rg.answer_key_preflight("practice")
                with self.assertRaises(rg.Refused):  # the override is refused in a counted run
                    rg.answer_key_preflight("counted")
            finally:
                if old is None:
                    os.environ.pop("JEV_GATE_PREFLIGHT_ROOTS", None)
                else:
                    os.environ["JEV_GATE_PREFLIGHT_ROOTS"] = old

    @unittest.skipUnless(HAVE_NODE, "node is needed for runner-guard.mjs")
    def test_check_preflight_record_relays_refusals(self):
        # A counted run no longer scans; run_gates.check_preflight_record is a thin wrapper over runner-guard.mjs
        # --check-preflight and must refuse on no path, a missing record, and an altered record. The valid path and
        # every field check are covered by scripts/jev-gate-runners.test.mjs (checkPreflightRecord) (bundle-4).
        with self.assertRaises(rg.Refused):
            rg.check_preflight_record(None)
        with scratch_dir("pfrec") as d:
            with self.assertRaises(rg.Refused):
                rg.check_preflight_record(os.path.join(d, "missing.json"))
            forged = os.path.join(d, "forged.json")
            with open(forged, "w") as f:
                f.write('{"kind":"answer-key-preflight","mode":"counted","ok":true,"sha256":"00"}')
            with self.assertRaises(rg.Refused):
                rg.check_preflight_record(forged)

    def test_tests_leave_no_temp_dir_behind(self):
        # Every temp dir a test makes must be removed, so a byte-for-byte answer-file copy is never stranded in a
        # temp root for the counted pre-flight to find (refute r3 addendum, r4 hygiene). Static: any raw
        # tempfile.mkdtemp/TemporaryDirectory goes through the signal-safe scratch helper or a cleanup mechanism.
        # Dynamic: a scratch dir holding a labels.json copy is gone after the block, and on a signal/exit too.
        src = open(os.path.abspath(__file__)).read()
        if "tempfile.mkdtemp(" in src or "TemporaryDirectory(" in src:
            self.assertTrue(any(t in src for t in ("scratch_dir(", "scratch_mkdtemp(", "addCleanup(shutil.rmtree")),
                            "a test makes a temp dir without the scratch helper or addCleanup(rmtree)")
        with scratch_dir("leftover") as d:
            shutil.copyfile(os.path.join(HERE, "labels.json"), os.path.join(d, "labels.json"))
            self.assertTrue(os.path.exists(os.path.join(d, "labels.json")))
        self.assertFalse(os.path.exists(d), "the scratch dir (with its labels.json copy) was not removed on block exit")

    def test_a_fixture_run_never_reaches_a_real_jev(self):
        # Fixture mode needs a loopback --jev-origin; without one it refuses before any call (no key is
        # ever given to a counted run in these tests).
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            for origin in ([], ["--jev-origin", "https://jev-ai.pro"]):
                code = rg.main(["--gate", "jev", "--out", os.path.join(d, "o.json"), "--ledger", os.path.join(d, "l"), "--items", "c001", "--pins", PINS] + origin,
                               env={"JEV_AI_API_KEY": KEY})
                self.assertEqual(code, 1)
            self.assertFalse(os.path.exists(os.path.join(d, "o.json")))
            self.assertFalse(os.path.exists(os.path.join(d, "l")))


@unittest.skipUnless(HAVE_NODE, "node is needed for runner-guard.mjs")
class JevAgainstFakeServer(unittest.TestCase):
    def run_main(self, script, ids="c001,c002,c003,c004,c005,c006", ledger_lines=()):
        FakeJev.script, FakeJev.seen = script, []
        srv = serve()
        self.addCleanup(srv.shutdown)
        d = scratch_mkdtemp("jev")
        self.addCleanup(shutil.rmtree, d)
        out, ledger = os.path.join(d, "jev.json"), os.path.join(d, "spend.jsonl")
        with open(ledger, "w") as f:
            for line in ledger_lines:
                f.write(json.dumps(line) + "\n")
        code = rg.main(["--gate", "jev", "--out", out, "--ledger", ledger, "--items", ids, "--pins", PINS,
                        "--jev-origin", "http://127.0.0.1:%d" % srv.server_address[1]], env={"JEV_AI_API_KEY": KEY})
        with open(out) as f:
            raw = f.read()
        return code, json.loads(raw), raw, ledger

    def test_records_decisions_failures_date_header_and_cost_without_the_key(self):
        code, rec, raw, ledger = self.run_main(["0.9", "0.2", "503", "wrong-model", "malformed", "0.5"])
        self.assertEqual(code, 0)
        self.assertTrue(rec["fixture"])
        self.assertIn("FIXTURE", rec["banner"])
        calls = {c["id"]: c for c in rec["calls"]}
        self.assertEqual([c["id"] for c in rec["calls"]], ["c001", "c002", "c003", "c004", "c005", "c006"])
        self.assertEqual((calls["c001"]["decision"], round(calls["c001"]["confidence"], 6), calls["c001"]["reportedConfidence"]), ("REJECT", 0.9, 0.42))
        self.assertEqual(calls["c006"]["decision"], "REJECT", "p at the threshold rejects")
        self.assertEqual(calls["c002"]["decision"], "ACCEPT")
        self.assertIsNone(calls["c002"]["costUsd"], "no usage, no cost")
        self.assertAlmostEqual(calls["c001"]["costUsd"], 1000 * 0.242 / 1e6)
        self.assertEqual((calls["c003"]["status"], calls["c003"]["decision"], calls["c003"]["abstention"]), ("http-503", None, "failure"))
        self.assertEqual(calls["c004"]["status"], "unexpected-release")
        self.assertEqual(calls["c005"]["status"], "malformed-answer")
        self.assertEqual(calls["c003"]["dateHeader"], FakeJev.date, "the Date header is kept on errors too")
        self.assertTrue(all(c["excluded"] is None for c in rec["calls"]))
        # The request is the pre-registered one.
        seen = FakeJev.seen[0]
        self.assertEqual(seen["body"]["model"], "jev-1.13.0")
        self.assertEqual(seen["body"]["questions"], {"q": {"type": "noul", "instructions": "Does this change break any of these rules?"}})
        self.assertEqual(seen["ua"], rg.exp004.USER_AGENT)
        self.assertEqual(seen["auth"], "Bearer " + KEY)
        # Nothing of the key or any other header reaches the record or the ledger.
        with open(ledger) as f:
            ledger_raw = f.read()
        for text in (raw, ledger_raw):
            self.assertNotIn(KEY, text)
            self.assertNotIn("Bearer", text)
            self.assertNotIn("X-Echo", text)
        self.assertEqual(len(ledger_raw.strip().splitlines()), 6)
        # The Node schema accepts it.
        subprocess.run(["node", "-e", "import('./experiments/jev-gate/results.mjs').then(m => m.validateGateRun(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))))",
                        os.path.join(os.path.dirname(ledger), "jev.json")], cwd=rg.ROOT, check=True)

    def test_spend_cap_stops_before_the_call(self):
        cap = rg.guard(PINS)["spendCap"]
        code, rec, _, _ = self.run_main(["0.9"], ids="c001,c002", ledger_lines=[
            {"gate": "jev", "costUsd": cap["usd"] - cap["alreadySpentUsd"] - 0.00001}, {"gate": "jev", "costUsd": 0.001}])
        self.assertEqual(code, 3)
        self.assertEqual(rec["partial"]["reason"], "spend-cap")
        self.assertEqual(rec["calls"], [])
        self.assertEqual(FakeJev.seen, [], "no call was made")

    def test_a_date_header_before_not_before_excludes_the_call(self):
        old = FakeJev.date
        FakeJev.date = "Sun, 27 Sep 2026 10:00:00 GMT"
        try:
            _, rec, _, _ = self.run_main(["0.9"], ids="c001")
        finally:
            FakeJev.date = old
        self.assertEqual(rec["calls"][0]["excluded"], "Date header not after the not-before time")

    def test_no_key_records_jev_not_run(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "jev.json")
            self.assertEqual(rg.main(["--gate", "jev", "--out", out, "--ledger", os.path.join(d, "l"), "--items", "c001", "--pins", PINS, "--jev-origin", "http://127.0.0.1:9"], env={}), 2)
            with open(out) as f:
                self.assertIn("no JEV_AI_API_KEY", json.load(f)["partial"]["reason"])

    def test_a_fake_origin_needs_fixture_pins(self):
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            code = rg.main(["--gate", "jev", "--out", os.path.join(d, "o"), "--ledger", os.path.join(d, "l"), "--jev-origin", "http://127.0.0.1:9"], env={"JEV_AI_API_KEY": KEY})
        self.assertEqual(code, 1)


class FakeLaya:
    """Returns fixed logits: p(true) comes from the table, keyed by the state's first diff line."""

    def __init__(self, p_true):
        self.p_true, self.calls = p_true, 0

    def forward(self, ids, markers, qtype):
        import numpy as np
        self.calls += 1
        p = self.p_true
        return np.log(np.array([1 - p, p])), np.array([0.5])


@unittest.skipUnless(HAVE_NODE and os.path.exists(os.path.join(LAYA_DIR, "tokenizer", "tokenizer.json")), "needs node and the pinned Laya tokenizer (local only)")
class LayaWithFakeModel(unittest.TestCase):
    def run_main(self, model, ids="c001,c002", practice=None):
        import laya_inputs as li
        tok = li.Tok(os.path.join(LAYA_DIR, "tokenizer", "tokenizer.json"))
        with open(os.path.join(LAYA_DIR, "rl_agent_config.json")) as f:
            cfg = json.load(f)
        cfg = dict(cfg, temperature=[1.0, 1.0, 1.0], temperature_by_options={})
        d = scratch_mkdtemp("laya")
        self.addCleanup(shutil.rmtree, d)
        out = os.path.join(d, "laya.json")
        argv = ["--gate", "laya", "--out", out, "--pins", PINS] + (["--practice", practice] if practice else ["--items", ids])
        code = rg.main(argv, env={}, laya_loader=lambda cache: (model, tok, cfg))
        with open(out) as f:
            return code, json.load(f)

    def test_decisions_and_the_warm_up_is_not_a_gate_call(self):
        model = FakeLaya(0.8)
        code, rec = self.run_main(model)
        self.assertEqual(code, 0)
        self.assertEqual(model.calls, 3, "one warm-up plus one call per item")
        self.assertEqual([c["decision"] for c in rec["calls"]], ["REJECT", "REJECT"])
        self.assertAlmostEqual(rec["calls"][0]["confidence"], 0.8)
        self.assertEqual(rec["calls"][0]["costBasis"], "local-no-price")

    def test_an_input_that_would_be_cut_is_refused_not_cut(self):
        with open(os.path.join(HERE, "rules.txt")) as f:
            rules = f.read()
        long_state = rules + "\n\n" + "diff --git a/x b/x\n" + "+const x = 1;\n" * 2000
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"items": [{"id": "practice-long", "state": long_state}]}, f)
        self.addCleanup(os.unlink, f.name)
        model = FakeLaya(0.8)
        code, rec = self.run_main(model, practice=f.name)
        call = rec["calls"][0]
        self.assertTrue(call["status"].startswith("refused-input"), call["status"])
        self.assertIsNone(call["decision"])
        self.assertEqual(call["abstention"], "failure")
        self.assertEqual(model.calls, 1, "only the warm-up ran; the refused input never reached the model")


if __name__ == "__main__":
    unittest.main()
