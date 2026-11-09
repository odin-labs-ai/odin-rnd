# Laya in the browser — provenance and parity record

The page `site/projects/laya-browser/` runs the Laya typed-decisions checkpoint in the visitor's browser with ONNX Runtime Web. This folder holds what was used to decide which files the page may load, and the recorded results. Nothing large is stored here: weights are fetched from pinned, immutable Hugging Face URLs.

## Sources, as read on 24 September 2026

| What | Where | License |
|---|---|---|
| Checkpoint and reference code | `convaiinnovations/laya` at `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`, subfolder `typed-decisions/` (`model.safetensors` SHA-256 `4fa56de7…a24e`, the same blob as `convaiinnovations/laya-typed-decisions`) | Apache-2.0 |
| Browser build (int8 `q8e8`) | `VishalMysore/layaForWebTrained` at `dd0c52a2b563bea25279e2689689061dd0a1c382`, produced by `scripts/build_model.py` in the public `vishalmysore/layaForWeb` repository | Apache-2.0 |
| Runtime | `onnxruntime-web@1.30.0` (MIT) and `@huggingface/tokenizers@0.2.0` (Apache-2.0) from jsDelivr; bytes compared with the npm tarballs, SRI SHA-384 recorded in `site/assets/laya-browser.mjs` | MIT / Apache-2.0 |

`pins.json` records the commits and hashes. The reference code (`rl_common.py`, `rl_agent_api.py`) was read before use and is hash-checked by `laya_pinned.py` before it is imported; no `trust_remote_code` is involved. The PyPI `laya` package that layaForWeb uses was not imported; for string criteria its sequence layout matches the pinned code.

## Provenance check (`convert.py`)

The browser build names its base model (`convaiinnovations/laya-typed-decisions`) but no commit. `convert.py` rebuilds the int8 model from the pinned checkpoint with the same tool versions as layaForWeb (`requirements.txt`) and compares it with the hosted build.

- **Byte comparison: failed, retained.** Weights `1ef12aff…` (rebuilt) against `e5ac4bfe…` (hosted), both 442,221,312 bytes; graph files also differ (4.3 MB against 3.6 MB).
- **Tensor comparison: same source.** 363 named tensors on both sides with equal names, shapes and operator counts. Every float tensor, scale and the int8 embedding table is bit-identical; 5,259 of 369,099,776 int8 weight codes (0.0014%) differ, each by one step. A different checkpoint would change almost every code. Recorded in `provenance-2026-09-24.json`. On x86_64 (Linux and Windows) the rebuilt weights are byte-identical to the hosted ones (`e5ac4bfe…`, no differing codes); the graph files still differ.
- **Fixed hash seed.** `convert.py` runs its stages with `PYTHONHASHSEED=0` unless the variable is already set. With a random seed, some runs exported two small float32 constants (`expand_2`, `expand_3`, shape [1, 32, 1]) with values that differ from the hosted build's, and the comparison failed. With the seed fixed, the rebuild matches on every runner of the `laya reproduce smoke` workflow (Linux x86_64 and aarch64, Windows x64 and arm64, macOS 15 on Apple silicon).

The page therefore loads the hosted build, pinned to its commit and SHA-256, and the tokenizer and calibration file directly from the checkpoint commit (byte-identical to the copies in the browser build).

## Parity check (`reference.py` and the browser)

`cases.json` holds three hand-written public cases, fixed before any output was observed. `reference.py` answers them with the original float32 model on CPU (`reference-2026-09-24.json`, including the exact input token ids). The JavaScript sequence builder produced identical token ids and marker positions for all three with Tokenizers.js.

A headless Chromium run against the locally built site downloaded the real model and answered the three cases with the keyboard only (`browser-proof-2026-09-24.json`): same decision on all three, largest probability difference 0.0055 against a 0.02 limit. No request left the site before the download button was pressed; afterwards only GET downloads went to jsDelivr and Hugging Face.

These are three cases on one machine. They show the port reproduces the original on those inputs; they are not an accuracy evaluation.

## Reproduce

Needs Python 3.12 on 64-bit Linux (x86_64 or aarch64), Windows (x64 or arm64; the arm64 torch build comes from the PyTorch CPU index) or macOS 14 or later on Apple silicon. Intel Macs and macOS 13 or older are not supported: the pinned torch 2.14.0 and onnxruntime 1.25.0 publish no wheels for them. Run the commands from the repository root, inside a virtual environment, so nothing is installed into the system Python.

macOS or Linux:

```sh
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r research/laya-browser/requirements.txt
python research/laya-browser/reference.py --cache ~/.cache/odin-rnd-laya --out reference.json
python research/laya-browser/convert.py --cache ~/.cache/odin-rnd-laya
```

Windows (PowerShell). These commands call the virtual environment's Python directly, so they need no activation script, which the default execution policy can block:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r research/laya-browser/requirements.txt
.venv\Scripts\python research/laya-browser/reference.py --cache ~/.cache/odin-rnd-laya --out reference.json
.venv\Scripts\python research/laya-browser/convert.py --cache ~/.cache/odin-rnd-laya
```

The cache needs about 4 GB. Both scripts expand the `~` in `--cache` themselves, so it works in PowerShell too. `convert.py` exits non-zero if the hosted build does not match a rebuild from the pinned checkpoint.
