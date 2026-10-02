# EXP 008 — latent-handoff (stage 1 harness)

EXP 008 asks whether a receiver model can judge a change from a sender's transferred KV cache, across a tokenizer
boundary, without re-reading the context. This directory holds the stage 1 harness. It has not been pre-registered
and has no results yet.

| File | What it does |
|---|---|
| `models.json`, `pins.mjs` | Pins every model by HF revision and the sha256 of every source and converted (BF16 MLX) file. `--verify` recomputes every hash, checks the cache geometry against the design table, and checks that sender and receiver vocabularies differ within each pair. A control pair (SmolLM3-3B ↔ Llama-3.2-3B, which share Llama-3 ids) must fail that check. |
| `strata.mjs`, `count_tokens.py`, `strata-manifest.json` | Builds the S, M and L contexts for all 200 items (60 EXP 005 + 140 EXP 008-X), each corpus sha-asserted. L is padded to 16K ±10% tokens under both pinned tokenizers, and the padding share is disclosed per item. |
| `corpus-x/` | The 140 EXP 008-X items (c061..c200): quota-matched to EXP 005, bce-labelled, blind second pass, overlap fence. |
| `distractor/` | The L padding: the first 2500 lines of lodash 4.17.21 (MIT, licence included), pinned by sha256. |
| `mem-gate.mjs`, `timing.mjs` | The memory gate. Before every measured run and every item it requires all of: memory free ≥ 50%, enough headroom, no swap growth, no resident `mlx_lm.server`, a quiet load (timed runs only) and a measured pair footprint within its bound (`footprints.json`: 24 GB, and 48 GB for D1′ only). Until then it waits and never touches another process. `timing.mjs` holds the seeded, randomised timing protocol. |
| `runner.py`, `arms.mjs`, `readout.json`, `score.mjs` | The stage 1 arms. A0 is a text re-prefill, A1 a sender summary, C1 the receiver's own cache through the transfer plumbing (it must match A0 at KL < 1e-3 or the run stops), C2 a deranged cache and C3 no context. The frozen YES/NO readout is a softmax over two single-token answers. The runner never opens a label file (an audit hook refuses), and `score.mjs` is the only step that reads labels. An OOM or NaN is an abstention, counted as wrong. |
| `kvmap.py`, `calibrate.py`, `calib-sources.json`, `mappers-<pair>.json`, `parity.py`, `parity-<pair>.json` | The two labelled public baselines. **A2a** is our extension of arXiv 2608.03893 to a cross-tokenizer pair: per-layer ridge, RoPE-stripped keys, character-boundary alignment. **A2b** is our simplified reimplementation of HeteroFold (arXiv 2609.32259), closed-form fit, without its output-aware calibration stage, built from its description: sender layers -4/0/+4 and a Procrustes recolor. The shorter A2b labels in `arms.mjs`, `calibrate.py`, `kvmap.py` and `mapper-freeze.json` are hash-bound by the mapper freeze and stay as they are; this label supersedes them. Calibration text is pinned public MIT code and docs, disjoint from every evaluation line. The mapper weights are not published; their sha256 is. The parity gate checks the MLX port against a torch reference on 20 held-out non-item contexts (p01–p20). `mapper-freeze.json` holds the values the pre-registration freezes. |
| `served.py`, `h0_candidate.py` | `mlx_lm.server` (its own `main()`, loopback only) with one handoff route per role, and the proof that one sender → A2b → receiver pair answers the gate through the served path. Records the H0 lane candidate (`candidate-not-routed`). |
| `counter.py` | Zero-prefill counter. A KV arm's receiver may forward only the suffix tokens. |
| `ffr8.mjs`, `vendor/ffr/` | Emits ffr.v1 `handoff` events, validated against the vendored schema `ffr.v1@ad3aec7c87bc` (pinned by sha256). |
| `spend8.mjs` | The $100 spend guard: reserve before every paid call, never a $0 line, an unknown cost charged at its upper bound. |

## Disclosed limits

- **Mirrored weights.** Llama-3.2-3B-Instruct, Llama-3.1-8B-Instruct and Gemma-3-1B-it are pinned from ungated
  unsloth mirrors. Byte-identity to the upstream weights cannot be verified, because the gated upstream repos mask
  their LFS sha256s. For the two Llama models, only `model.safetensors.index.json` matches the upstream git oid.
- **Padding dominates L.** About 77–80% of every L context is distractor.
- **Calibration ran on the Mac only, with no GPU account,** per the WO's pre-stated fallback. `mappers-<pair>.json` records the machine and the wall time.
- **A2b is closed-form.** HeteroFold's output-aware calibration stage is not reproduced. A2b is a baseline built from the paper's description, not the authors' code (none was released).
- **Parity is judged in float32.** The binding gate reads out with the receiver in float32, so it tests the mapper port. At run time the receiver is bfloat16, and one bf16 ulp in a cache element can move p(yes) by a whole bf16 logit step. That comparison is recorded as informational, never as a pass.
- **MLX GPU float32 matmuls run at reduced precision.** We measured an error of 3.5e-2 against float64 on a 3072 × 1024 map. The port and the calibration statistics therefore use a split-precision product (error 1.3e-4). The first parity attempt failed on exactly this; its records are kept in `evidence/` (attempt 1).
- **Decision stability under bf16 rounding is a property of the KV arms.** Float32-level differences in a mapped cache move the bf16 readout by up to one bf16 logit step (`evidence/bf16-decision-stability-<pair>.json`). It is reported as a descriptive secondary, never as a gate.
- **Footprint bounds come from measurement on practice items** (`footprints.json`). D1 stays under the 24 GB design bound, with a measured peak of 21.9 GB on A2b at stratum L. D1′ alone is raised to 48 GB, because its text and control arms already peak at 26.9 GB on L and A2b reaches 36.9 GB. At the 50%-free floor a 128 GB Mac has 64 GB available, and the headroom criterion needs peak + 16 GB to fit within that.
- **Items c001–c020 are excluded from every claim.** c001–c005 were practice items. c006–c020 were read out unlabelled during an early parity attempt.
- **The five C2 donors c029, c081, c097, c112 and c144 are excluded too.** They were the C2 donors of c001–c005 in the harness smoke test and of c001 in the D1′ memory-footprint run (c081), so a receiver readout on each was recorded before the pre-registration. The analysed set is 175 items (the fallback 39).
- **Local compute is unpriced.** ffr.v1 events carry `costUsd: null` with the reason `local-unpriced`, never a zero.
