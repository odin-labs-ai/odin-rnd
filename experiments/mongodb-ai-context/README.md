# MongoDB AI context diagnostic

This is the fixed authored fixture for the dated R&D field note, with actual recorded Voyage outputs and MongoDB adapter observations. It is not a production authorization, durability or benchmark result.

The exact executed eight-file payload is sealed by `payload-manifest.json`. To repeat the hosted trial, copy those eight files plus the manifest into `research/mongodb-ai-context-20261025/` in your own GitHub repository, and copy the passive `hosted-workflow.yml` example into `.github/workflows/`. It runs on Linux/amd64 GitHub-hosted Ubuntu24.04 with pinned images, 54 pinned hash-checked Python packages, internal networks, no provider secrets and bounded owned cleanup. This example is not activated in the public R&D repository. Docker image and package downloads require egress; the measured database/worker network is internal.

From this directory, audit the public numerical records with standard-library Python:

```sh
python3 audit.py ../../site/data/mongodb-ai-context
```

The audit is a separate calculation on saved observations, not an independent database execution. The public runtime receipt projects the two scientific result hashes from the original artifact digest map; administrative infrastructure logs are kept privately and the original receipt SHA256 is retained.

`observations/model-result.json` preserves the complete decoded inference record, including all64 original2048-coordinate responses and the512-coordinate vectors actually used. JSON whitespace is compacted. The original model-record export normalization is explicitly declared in that record.

To repeat embedding inference, obtain official MongoDB/voyage-4-nano-GGUF revision03547551689253732502486d62de4cd0970d6564 Q8_0 weight (SHA256c6ed6cc898d50ae1a4492809affadc6c0d023f8ac05c07a37abe20c563152560) and llama.cpp b11865 Darwinx86_64 into a local asset directory matching `embed_fixture.py`. Set VOYAGE_FIXTURE_ASSETS to that directory. The public script differs from the executed script only in that asset-path selection; source-export.json records both hashes. `prepare.py` documents fixture authorship; do not rerun it over the existing frozen protocol.

The cache fixture intentionally has one cached answer per family and key arm. It retains changed-policy, same-policy polarity and valid paraphrase cases at all three fixed thresholds. It uses document/query instruction asymmetry as the configured retrieval embedding interface does; symmetric cache embeddings remain untested. Labels251/252 identify fresh database names for the same fixture, not independent samples.

The first two attempts failed before cache observations; an earlier completed pair and the final format-only verification are all retained in attempts.json. Table counts use the final reviewed payload only. Search-index tmpfs is disposable and does not test crash durability.
