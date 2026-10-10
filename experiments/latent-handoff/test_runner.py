"""EXP 008 (latent-handoff) bundle 3 WO-04: the runner's control flow, guard and readout, without mlx (CI).

  python3 experiments/latent-handoff/test_runner.py
  LH_MLX_CANARY=1 <mlx python> test_runner.py     also: the single-token readout on every pinned receiver
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import counter  # noqa: E402
import runner  # noqa: E402
from counter import ForwardCounter, ZeroPrefillViolation  # noqa: E402

READOUT = json.load(open(os.path.join(HERE, "readout.json")))


class Tok:
    """Whitespace tokenizer with a two-part chat template (head + user content + tail)."""

    def apply_chat_template(self, msgs, add_generation_prompt, tokenize, **kw):
        return "<u> " + msgs[0]["content"] + " </u> <a>"

    def encode(self, s, add_special_tokens=False):
        return [hash(w) % 1000 for w in s.split()]


class MX:
    def reset_peak_memory(self):
        pass

    def get_peak_memory(self):
        return 2**30


class FakeEngine:
    """Runs the real run_item control flow; 'model' work is bookkeeping. Faults are injected per arm."""

    def __init__(self, oom_arm=None, nan_arm=None, kl=0.0, leak_arm=None):
        self.rtok, self.rkey, self.readout, self.mx = Tok(), "llama-3.2-3b", READOUT, MX()
        self.receiver = ForwardCounter(lambda x, cache=None: None)
        self.oom_arm, self.nan_arm, self._kl, self.leak_arm = oom_arm, nan_arm, kl, leak_arm
        self.arm = None

    def new_cache(self):
        return []

    def prefill(self, ids, cache):
        if self.arm == self.oom_arm:
            raise RuntimeError("[metal::malloc] Out of memory: attempting to allocate")
        if ids:
            self.receiver(ids)
            cache.append(len(ids))
        return "logits", 1.0

    def readout_from(self, logits):
        if self.arm == self.nan_arm:
            raise runner.Abstain("nan-logits")
        return "lp", {"lpYes": -1.0, "lpNo": -0.5, "pYes": 0.3, "pYesBin": 0.4}

    def kl(self, a, b):
        return self._kl

    def roundtrip(self, cache):
        if self.arm == self.leak_arm:  # a leaky "transfer" that re-reads the context through the receiver
            self.receiver(list(range(cache[0])))
        return list(cache)

    def summarise(self, context):
        return "a neutral summary", 3, 1.0


def run(engine, arms=("A0", "A1", "C1", "C2", "C3")):
    """Run each arm through the real run_item, tagging the fake with the arm so faults land on that arm only."""
    rows = []
    for arm in arms:
        engine.arm = arm
        wanted = ["A0", "C1"] if arm == "C1" else [arm]  # C1 is judged against A0 of the same item
        got = runner.run_item(engine, "c001", "ctx words here", "other ctx words", wanted, lint=lambda _: [])
        rows.extend(r for r in got if r["arm"] == arm)
    return rows


class RunnerTests(unittest.TestCase):
    def test_all_arms_produce_rows_with_the_counter_gate(self):
        rows = run(FakeEngine())
        self.assertEqual([r["arm"] for r in rows], ["A0", "A1", "C1", "C2", "C3"])
        for r in rows:
            self.assertFalse(r["abstain"])
            self.assertIn(r["decision"], ("ACCEPT", "REJECT"))
        kv = [r for r in rows if r["arm"] in ("C1", "C2")]
        for r in kv:
            self.assertEqual(sum(r["forwardCalls"]), r["suffixLen"])

    def test_a_simulated_oom_is_an_abstention_row_not_a_crash_or_a_skip(self):
        for arm in ("A0", "A1", "C2", "C3"):
            rows = run(FakeEngine(oom_arm=arm), arms=(arm,))
            self.assertEqual(len(rows), 1, arm)
            self.assertTrue(rows[0]["abstain"], arm)
            self.assertEqual(rows[0]["reason"], "oom")

    def test_nan_logits_abstain(self):
        rows = run(FakeEngine(nan_arm="C3"), arms=("C3",))
        self.assertEqual(rows[0]["reason"], "nan-logits")

    def test_c1_over_the_kl_bound_stops_the_run(self):
        with self.assertRaises(SystemExit) as e:
            run(FakeEngine(kl=2e-3), arms=("C1",))
        self.assertIn("STOP", str(e.exception))

    def test_a_leaky_transfer_fails_the_zero_prefill_gate(self):
        with self.assertRaises(ZeroPrefillViolation):
            run(FakeEngine(leak_arm="C2"), arms=("C2",))

    def test_timing_protocol_warmup_reps_and_permuted_order(self):
        e = FakeEngine()
        e.arm = "no-fault"
        rows = runner.run_item(e, "c001", "ctx words here", "other ctx", ["A0", "C1", "C3"], lint=lambda _: [],
                               order=["C1", "C3", "A0"], warmups=1, reps=5)
        self.assertEqual([r["arm"] for r in rows], ["C1", "C3", "A0"])
        for r in rows:
            self.assertEqual(len(r["msReps"]), 5)
            self.assertTrue(r["repsConsistent"])
            self.assertEqual(r["armOrder"], ["C1", "C3", "A0"])
        with self.assertRaises(ValueError):
            runner.run_item(e, "c001", "ctx", "other", ["A0", "C1"], lint=lambda _: [], order=["A0"])

    def test_the_counter_does_not_carry_over_into_the_next_items_reference_a0(self):
        # amendment 02: item N ends on a text arm (its forward calls stay in the counter); item N+1 puts C1 before A0,
        # so its untimed reference A0 runs first and must be checked on its own calls only
        e = FakeEngine()
        e.arm = "no-fault"
        first = runner.run_item(e, "c001", "ctx words here", "other ctx", ["A0", "C1", "C3"], lint=lambda _: [],
                                order=["A0", "C1", "C3"])
        self.assertEqual(first[-1]["arm"], "C3")
        self.assertGreater(e.receiver.total, 0)
        seen = []
        real = counter.check  # run_item imports check at call time, so the spy sees every check of item N+1

        def spy(arm, calls, suffix_len, prompt_len=None):
            seen.append((arm, list(calls), prompt_len))
            return real(arm, calls, suffix_len, prompt_len=prompt_len)

        counter.check = spy
        try:
            rows = runner.run_item(e, "c002", "other words in this context", "ctx", ["A0", "C1", "C3"], lint=lambda _: [],
                                   order=["C1", "A0", "C3"])
        finally:
            counter.check = real
        self.assertEqual([r["arm"] for r in rows], ["C1", "A0", "C3"])
        reference = seen[0]
        self.assertEqual(reference[0], "A0")
        self.assertEqual(sum(reference[1]), reference[2], "the reference A0 counted only its own prompt")
        c1 = rows[0]
        self.assertEqual(sum(c1["forwardCalls"]), c1["suffixLen"])

    def test_derangement_has_no_fixed_point_and_is_seeded(self):
        ids = [f"c{i:03d}" for i in range(1, 201)]
        d = runner.derangement(ids, 8008)
        self.assertEqual(sorted(d.values()), sorted(ids))
        self.assertTrue(all(k != v for k, v in d.items()))
        self.assertEqual(d, runner.derangement(list(reversed(ids)), 8008))

    def test_answer_words_must_be_single_tokens(self):
        class T:
            def encode(self, s, add_special_tokens=False):
                return [1] if s in ("YES", "NO") else [1, 2]

        self.assertEqual(set(runner.answer_ids(T(), READOUT)), {"yes", "no"})
        with self.assertRaises(ValueError):
            runner.answer_ids(T(), {**READOUT, "yes": "ABSOLUTELY"})

    def test_the_readout_question_is_the_exp005_gate_question(self):
        with open(os.path.join(HERE, "..", "jev-gate", "gate-question.json")) as f:
            self.assertEqual(json.load(f)["instructions"], READOUT["question"])


class GuardTests(unittest.TestCase):
    def test_a_runner_that_opens_labels_json_throws(self):
        code = (
            "import sys, os; sys.path.insert(0, sys.argv[1]); import runner; runner.install_guard()\n"
            "for name in ('labels.json', 'labels-x.json', 'manifest-x.json', 'second-pass-x.jsonl'):\n"
            "    try:\n"
            "        open(os.path.join(sys.argv[2], name))\n"
            "    except runner.GuardRefused:\n"
            "        print('refused', name)\n"
            "open(os.path.join(sys.argv[1], 'readout.json')).close(); print('readout ok')\n"
        )
        with tempfile.TemporaryDirectory(prefix="lh-guard-") as d:
            for name in ("labels.json", "labels-x.json", "manifest-x.json", "second-pass-x.jsonl"):
                open(os.path.join(d, name), "w").close()
            r = subprocess.run([sys.executable, "-c", code, HERE, d], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.count("refused"), 4)
        self.assertIn("readout ok", r.stdout)


@unittest.skipUnless(os.environ.get("LH_MLX_CANARY") == "1", "needs the pinned tokenizers (LH_MLX_CANARY=1)")
class ReadoutOnPinnedReceivers(unittest.TestCase):
    def test_yes_and_no_are_single_tokens_on_every_receiver_and_a_multi_token_word_throws(self):
        from transformers import AutoTokenizer

        root = os.environ.get("LH_MODEL_CACHE", os.path.expanduser("~/.cache/odin-rnd/latent-handoff"))
        models = json.load(open(os.path.join(HERE, "models.json")))
        receivers = sorted({p["receiver"] for p in models["pairs"].values()})
        for key in receivers:
            tok = AutoTokenizer.from_pretrained(os.path.join(root, "mlx", key))
            ids = runner.answer_ids(tok, READOUT)
            self.assertNotEqual(ids["yes"], ids["no"], key)
            with self.assertRaises(ValueError):
                runner.answer_ids(tok, {**READOUT, "yes": "INDUBITABLY"})


if __name__ == "__main__":
    unittest.main()
