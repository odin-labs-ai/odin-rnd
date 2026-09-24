"""Fetch the pinned Laya typed-decisions checkpoint and load its own reference code.

Every file is downloaded at the commit in pins.json and checked against a SHA-256 recorded there
before anything is imported. The reference code (rl_common.py, rl_agent_api.py) is the checkpoint
repository's own Python, read before use; nothing is loaded with trust_remote_code.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / "pins.json").read_text())


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(cache):
    """Download the pinned checkpoint into <cache>/checkpoint and return that directory."""
    from huggingface_hub import hf_hub_download
    src = PINS["source"]
    sub = src["subfolder"]
    dst = Path(cache) / "checkpoint"
    names = ["rl_common.py", "rl_agent_api.py", f"{sub}/model.safetensors", f"{sub}/rl_agent_config.json",
             f"{sub}/encoder/config.json", f"{sub}/tokenizer/tokenizer.json", f"{sub}/tokenizer/tokenizer_config.json"]
    for name in names:
        path = hf_hub_download(src["repo"], name, revision=src["revision"], cache_dir=str(Path(cache) / "hf"))
        target = dst / name.removeprefix(sub + "/")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.stat().st_size != Path(path).stat().st_size:
            shutil.copy(path, target)
    for name, digest in src["files"].items():
        actual = sha256(dst / name.removeprefix(sub + "/"))
        if actual != digest:
            sys.exit(f"{name}: sha256 {actual} does not match the pin {digest}")
    return dst


def load_agent(checkpoint):
    """Import the pinned reference code (hash-checked by fetch) and load the model on CPU in float32."""
    sys.path.insert(0, str(checkpoint))
    from rl_agent_api import RLAgent
    return RLAgent(str(checkpoint), device="cpu")
