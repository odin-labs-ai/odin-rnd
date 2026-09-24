# Laya vs Jev: a System-1 decision model without vendor lock-in

**Question.** Can an open-weight model answer the same typed decisions as a hosted System-One model (choice, score and yes/no probability answers, each with a confidence) on a laptop, with no API key, and how does it compare?

- **Laya** (`laya-typed-decisions`): a 421M-parameter ModernBERT-large encoder with a small decision head, Apache-2.0, published at [huggingface.co/convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya/tree/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/typed-decisions). Pinned to commit `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`; every file the runner loads is also pinned by sha256 in `run.py`.
- **Jev**: TypeSafe's hosted System-One model at `jev-ai.pro` (TypeSafe-compatible `/api/v1/systemone`), requested as release `jev-1.13.0`. It is an **optional** comparison. The experiment runs completely without a Jev key.

## What the runner does

1. Downloads the pinned Laya typed-decisions files from Hugging Face into `~/.cache/odin-rnd/laya/<sha>/` and checks each sha256. Weights are never committed.
2. Answers each of the 48 rows in [`corpus.json`](corpus.json) with an MLX port of the model ([`laya_mlx.py`](laya_mlx.py)) on the Apple GPU, one call at a time, and times each call.
3. **Parity check.** Answers every row again with the model repository's own Python (`rl_agent_api.py` / `rl_common.py`, read before use and pinned by sha256) using torch on the CPU. The run fails (exit 1) if any row has different token ids or a different decision, or if the probability of the top answer differs by more than 0.01.
4. If `JEV_AI_API_KEY` is set, sends the same rows to Jev (sequentially, 15 s timeout) and records accuracy, agreement with Laya, latency and cost. If the key is not set, Jev is recorded as `not run`.
5. Writes `results/laya-mlx-<date>.json`.

Every model component runs in MLX: the encoder, the decision head, the scorer and the act head. None falls back to torch-MPS. Tokenization uses the Hugging Face `tokenizers` library, which runs in Rust on the CPU and is not a model component. torch runs only in the CPU reference used for the parity check.

## Reproduce

Requirements: an Apple silicon Mac, [uv](https://docs.astral.sh/uv/), and about 2 GB of disk space (0.8 GB of weights plus the Python environment).

```sh
cd experiments/laya-vs-jev
uv venv -p 3.12 .venv
VIRTUAL_ENV=$PWD/.venv uv pip install -r requirements.txt
.venv/bin/python run.py            # add --out <file> to avoid overwriting today's recording
```

`requirements.txt` pins the complete environment used for the recording. Use an isolated venv. Running `uv run --with-requirements` on top of a system Python failed on the recording Mac because it loaded an unrelated `torchvision` into the environment, which broke `transformers` in the reference step.

To include Jev, put your own key in the environment for that command only, for example `JEV_AI_API_KEY=… .venv/bin/python run.py`. The runner reads the key only from the environment and never writes it anywhere. It sends the key only to `https://jev-ai.pro`.

Tests (offline: no weights, network or key needed):

```sh
.venv/bin/python -m unittest test_run.py                  # runner logic
node --test ../../scripts/laya-vs-jev.test.mjs            # recorded-results contract, also runs in `pnpm test`
```

## Measured on 24 September 2026

Source: [`results/laya-mlx-2026-09-24.json`](results/laya-mlx-2026-09-24.json). Measured on an Apple M5 Max with 128 GB RAM running macOS 26.6.1, using MLX 0.32.2. Other work was running on the machine at the same time (load average about 36–47). Treat the latencies as measurements taken under load, not best-case figures.

| | Laya typed-decisions (MLX, local) | Jev 1.13.0 (hosted) |
|---|---|---|
| Accuracy vs the hand-written answers (48 rows) | 0.81 (39/48) | 0.96 (46/48) |
| — choice / score / noul | 15/16 · 11/16 · 13/16 | 16/16 · 14/16 · 16/16 |
| Accuracy of answers with confidence ≥ 0.9 | 1.00, **but only 2 of 48 answers reached 0.9** | 1.00 (36 of 36) |
| Per-call latency p50 / p90 / max | 8.7 / 10.5 / 71.8 ms | 378 / 828 / 1176 ms |
| Cold load | 0.81 s (weights already cached) | — |
| Cost per 1,000 calls | none per call (runs locally) | $0.084 (see note) |
| Needs a key or network at run time | no (only the first download) | yes |

**Agreement:** Laya and Jev gave the same decision on 37 of 48 rows (77.1%).

**Parity:** the MLX port and the CPU reference gave the same decision on 48 of 48 rows, with identical token ids. The largest difference in top-answer probability was **0.0021**, below the 0.01 threshold. The CPU reference took 156 ms per call at p50 on 6 threads, compared with 8.7 ms for MLX.

What this shows:

- Laya runs locally on MLX and gives the same answers as its own reference implementation. The local path works without any vendor.
- On this small, hand-written corpus, Jev was more accurate: 46/48 against 39/48. Laya's errors were mostly on `score` questions (5 of 9), plus three yes/no rows it answered "no" and one build-log row. Both models were correct on every answer they gave at a confidence of at least 0.9.
- Laya's confidence values are low on this corpus: its median confidence is 0.20, compared with 1.00 for Jev. As a result, a 0.9 confidence gate would pass through almost none of its answers. Jev's confidence was 0.9 or higher on 36 of its 48 answers. For gating decisions, this matters more than raw accuracy.

## Boundaries

- The corpus has 48 invented, public rows, written together with their expected answers before any model ran. The corpus was committed on its own before the first run. The expected answers are the author's judgment. This is a mechanism-and-parity test and a small side-by-side comparison, not a benchmark, and it does not support claims about general accuracy.
- Jev's cost is the measured mean of 349 input tokens per call, multiplied by **$0.242 per 1M input tokens**. That rate is a vendor price **claim**: the highest annual-plan rate listed on jev-ai.pro/pricing, read on 24 September 2026, where the listed range is $0.124–$0.242 and output tokens are free. It is not an invoice.
- Jev's latency is the wall-clock time from this Mac over the public internet.
- The calibration row is small: 2 answers for Laya and 36 for Jev. Confidence is the value each model reports. Jev's yes/no answers include no confidence value, so for those, and for Laya's yes/no answers, the runner uses 1 minus the normalized entropy of [1 − p, p], which is the definition in Laya's own code.
- Vendor comparison pages are **claims** that were not reproduced here: Laya's model card reports 0.766 accuracy for `laya-typed-decisions` on its own 2,000-decision benchmark, and Laya's `eval/results.md`, jev-ai.pro/compare and madewithjev.com publish other figures. All were read on 24 September 2026.

## Failures kept as evidence

- `results/failed/laya-mlx-2026-09-24-jev-http403.json`: in the first recorded run, all 48 Jev calls failed with HTTP 403. Jev's edge blocks Python's default `Python-urllib` User-Agent (Cloudflare error 1010). The runner now sends an explicit `odin-rnd-laya-vs-jev/1` User-Agent. The Laya and parity results in that run matched the later run.
