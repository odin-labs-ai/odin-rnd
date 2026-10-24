# MongoDB AI ecosystem observations — 24 October 2026

This is a local integration investigation, not a platform or model leaderboard.
The public observation packet is in `site/data/mongodb-ai-ecosystem/` and the field
note is `site/journal/mongodb-ai-ecosystem.html`.

Run the calculation audit from the repository root:

```sh
python3 experiments/mongodb-ai-ecosystem/audit.py
```

The audit reconstructs the 512-dimensional vectors from the raw model outputs,
recomputes all twelve authored relevance ranks and all forty-eight exact database
observations, checks the different score scales, and verifies memory/cache and
workflow observations plus the evidence hashes. It requires no downloaded model,
database, provider key or extra Python package.

To repeat the runtime trial, use a separate local working folder. Obtain the
official Q8_0 file and llama.cpp b11865 Darwin x64 runtime described by the
[official model card](https://huggingface.co/MongoDB/voyage-4-nano-GGUF). The recorded
model revision and SHA-256 are in the protocol. The model file is
`voyage-4-nano-Q8_0.gguf`; the binary path used by the harness is
`llama/llama-b11865/llama-server`. These large third-party assets are not bundled.
Other platforms need the matching runtime and an explicit harness path change;
this observation is the recorded Intel Mac CPU configuration.

Copy `model_trial.py`, `database_trial.py` and `run_integration.py` into that folder.
Preserve the recorded protocol and fixture before repeating: `model_trial.py`
writes its own local fixture, protocol and outputs. Run:

```sh
python3 model_trial.py
docker build -t odin-mongo-ai-probe:20261024 previous
python3 run_integration.py
```

The database images `mongodb/mongodb-atlas-local:preview` and
`pgvector/pgvector:pg17` must already be available locally. The harness resolves
their names to image IDs and records those IDs. Mutable tags do not promise
identical future versions. Its worker uses the pinned packages and Python base in
`previous/`. Runtime scripts create owned disposable containers with random
fixture credentials on an internal network, expose no host database ports, and
remove only their own containers and network. The embedding service uses an
authenticated local UNIX socket and is stopped after inference.

The earlier workflow trial can be repeated with
`python3 previous/run_trial.py`. That includes the earlier synthetic-vector
retrieval/cache checks; those do not become real-model quality evidence merely
because they share this directory. The first-party adapters are exercised rather
than replaced with mock database implementations.

The amended cache question was corrected after the first observation. Its original
wording could have been answered ALLOWED correctly. Both attempts and the amendment
are retained; only the explicit changed-policy question supports the targeted
incorrect-reuse diagnostic. The thresholds were unchanged, and this is not a
preregistered false-hit-rate study.

The cache answers and fact updates are manually supplied fixtures. No generative
model, autonomous fact extractor, Agent Engine runtime, hosted reranker, production
authorization or production recovery was exercised.
