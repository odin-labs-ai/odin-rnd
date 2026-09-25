"""Offline tests for the laya-vs-jev runner: no weights, no network, no Jev key.

  python -m unittest experiments/laya-vs-jev/test_run.py
"""
import glob
import hashlib
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import laya_inputs as li  # noqa: E402
import run  # noqa: E402

CORPUS = json.load(open(os.path.join(HERE, "corpus.json")))
TOP_KEYS = {"schemaVersion", "measuredAt", "machine", "models", "corpus", "perModel", "agreement", "notes"}
PER_MODEL_KEYS = {"accuracy", "calibratedAccuracy", "p50Ms", "p90Ms", "maxMs", "coldLoadS", "costPer1kUsd"}


class Corpus(unittest.TestCase):
    def test_size_balance_and_expected_answers(self):
        rows = CORPUS["rows"]
        self.assertGreaterEqual(len(rows), 45)
        self.assertEqual(len({r["id"] for r in rows}), len(rows))
        counts = {t: sum(1 for r in rows if r["question"]["type"] == t) for t in ("choice", "score", "noul")}
        self.assertEqual(len(set(counts.values())), 1, counts)
        for r in rows:
            q = r["question"]
            if q["type"] == "choice":
                self.assertIn(r["expected"], q["criteria"], r["id"])
            elif q["type"] == "score":
                self.assertIsInstance(r["expected"], int)
                self.assertTrue(0 <= r["expected"] < len(q["criteria"]), r["id"])
            else:
                self.assertIsInstance(r["expected"], bool, r["id"])


class Decisions(unittest.TestCase):
    def test_choice_score_noul(self):
        self.assertEqual(run.decision_of({"type": "choice", "choice": "b", "probabilities": {"a": 0.2, "b": 0.8}, "confidence": 0.3})["decision"], "b")
        d = run.decision_of({"type": "score", "score": 1.4, "probabilities": {"0": 0.1, "1": 0.2, "2": 0.7}})
        self.assertEqual((d["decision"], d["topProb"]), (2, 0.7))
        self.assertEqual(run.decision_of({"type": "score", "score": 1.6})["decision"], 2)
        n = run.decision_of({"type": "noul", "noul": 0.2})
        self.assertIs(n["decision"], False)
        self.assertAlmostEqual(n["topProb"], 0.8)
        self.assertEqual(n["confidenceSource"], "1-normalized-entropy")

    def test_confidence_is_one_minus_normalized_entropy(self):
        self.assertAlmostEqual(li.confidence_from_probs([0.5, 0.5], 2), 0.0)
        self.assertAlmostEqual(li.confidence_from_probs([1.0, 0.0], 2), 1.0, places=6)

    def test_temperature_bucket_matches_upstream_rule(self):
        self.assertEqual(li.temp_bucket(0, 2), "choice:2")
        self.assertEqual(li.temp_bucket(1, 4), "score:3-5")
        self.assertEqual(li.temp_bucket(2, 2), "noul:2")
        self.assertEqual(li.temp_bucket(0, 12), "choice:11+")

    def test_noul_options_are_false_then_true(self):
        self.assertEqual(li.render_options({"t": "noul", "crit": None})[1], "true: yes, the statement holds")


class Metrics(unittest.TestCase):
    def rows(self):
        return [{"id": "a", "type": "noul", "m": {"decision": True, "confidence": 0.95, "ms": 10}},
                {"id": "b", "type": "noul", "m": {"decision": False, "confidence": 0.2, "ms": 30}},
                {"id": "c", "type": "choice", "m": {"decision": None, "ms": 15000}}]

    def test_unanswered_counts_as_wrong_and_calibration_uses_high_confidence_only(self):
        s = run.summarize(self.rows(), "m", {"a": True, "b": True, "c": "x"})
        self.assertEqual((s["correct"], s["answered"], s["rows"]), (1, 2, 3))
        self.assertAlmostEqual(s["accuracy"], 1 / 3, places=4)
        self.assertEqual((s["highConfidenceAnswers"], s["calibratedAccuracy"]), (1, 1.0))
        self.assertEqual(s["maxMs"], 15000)


class Parity(unittest.TestCase):
    def pair(self, mlx_p, ref_p, ref_ids=None):
        rows = [{"id": "x", "question": {"type": "noul"}}]
        m = {"x": {"answer": {"type": "noul", "noul": mlx_p}, "ids": [1, 2], "markers": [1]}}
        r = {"x": {"answer": {"type": "noul", "noul": ref_p}, "ids": ref_ids or [1, 2], "markers": [1]}}
        return run.parity_report(m, r, rows)

    def test_small_delta_passes(self):
        self.assertTrue(self.pair(0.70, 0.705)["passed"])

    def test_decision_flip_fails(self):
        rep = self.pair(0.504, 0.497)
        self.assertFalse(rep["passed"])
        self.assertEqual(rep["sameDecision"], 0)

    def test_delta_over_threshold_fails(self):
        self.assertFalse(self.pair(0.80, 0.78)["passed"])

    def test_token_mismatch_fails(self):
        self.assertFalse(self.pair(0.7, 0.7, ref_ids=[1, 3])["passed"])


class Jev(unittest.TestCase):
    def test_no_key_means_not_run(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(run.run_jev(CORPUS["rows"][:1]))

    def test_http_error_records_status_only(self):
        secret = "test-" + "k" * 24  # synthetic stand-in, not a real credential
        err = urllib.error.HTTPError("https://jev-ai.pro/api/v1/systemone", 403, "Forbidden",
                                     {"X-Echo": secret}, io.BytesIO(secret.encode()))
        with mock.patch("urllib.request.urlopen", side_effect=err) as op:
            out = run.call_jev(secret, CORPUS["rows"][0])
        self.assertEqual(out["status"], "http-403")
        self.assertNotIn(secret, json.dumps(out))
        sent = op.call_args[0][0]
        self.assertEqual(sent.full_url, "https://jev-ai.pro/api/v1/systemone")
        self.assertTrue(sent.get_header("User-agent").startswith("odin-rnd-laya-vs-jev/"))

    def test_other_release_is_rejected(self):
        body = json.dumps({"model": "jev-2.0.0", "answers": {"q": {"type": "noul", "noul": 0.9}}}).encode()
        resp = mock.MagicMock()
        resp.__enter__.return_value.read.return_value = body
        with mock.patch("urllib.request.urlopen", return_value=resp):
            self.assertEqual(run.call_jev("k", CORPUS["rows"][32])["status"], "unexpected-release")


class RecordedResults(unittest.TestCase):
    def test_every_recorded_result_keeps_the_output_contract(self):
        paths = glob.glob(os.path.join(HERE, "results", "laya-mlx-*.json"))
        self.assertTrue(paths, "no recorded results")
        corpus_sha = hashlib.sha256(open(os.path.join(HERE, "corpus.json"), "rb").read()).hexdigest()
        for p in paths:
            d = json.load(open(p))
            self.assertTrue(TOP_KEYS <= set(d), p)
            self.assertEqual(d["corpus"]["sha256"], corpus_sha, p)
            for m in d["models"]:
                self.assertTrue({"id", "source", "sha", "license", "backend"} <= set(m), p)
            for mid, v in d["perModel"].items():
                self.assertTrue(PER_MODEL_KEYS <= set(v), (p, mid))
            self.assertIn("laya_vs_jev", d["agreement"])
            self.assertEqual(d["models"][0]["sha"], run.HF_SHA)
            self.assertTrue(d["parity"]["passed"], p)


if __name__ == "__main__":
    unittest.main()
