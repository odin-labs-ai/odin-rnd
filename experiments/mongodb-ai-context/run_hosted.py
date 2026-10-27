"""Fixed synthetic probe on a disposable Linux/amd64 GitHub-hosted runner."""
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import secrets
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent
FILES = {
    "Dockerfile", "requirements.lock", "run_hosted.py", "fixture.json",
    "protocol.json", "vectors.json", "score_fixture.py", "database_probe.py",
}
# Docker Hub manifest/config bytes were hash-verified through its registry API.
# The database configs match the retained successful 2026-10-24 runtime receipt.
IMAGES = {
    "mongo": {
        "reference": "mongodb/mongodb-atlas-local@sha256:51af3809fb7652d3e433ec1c95784339f782071a8675ac6098748ac165dec0c6",
        "config": "sha256:87e7d5b733329ad92bb14546715e3ce0e926baf83798e3be1f807f8d3c36452b",
    },
    "postgres": {
        "reference": "pgvector/pgvector@sha256:cd4ccfdaf62cbfeb5c6ee19ef0dd663406d4ed740c320b324d016a90e85385b3",
        "config": "sha256:151aa1c2e849e7828ed8aef2183ae15f692cbe887d2f28921d8b44b26e154d7e",
    },
    "python": {
        "reference": "python@sha256:2b4f19dae3a777dfc3b76730bda1e82e1f66ab2a2686fa93ca78edbfb4f04ffe",
        "config": "sha256:df18428df8a0f9189c84e7424d214b4c50092af1f9dca5842a00c41c39bda316",
    },
}
SEARCH_TMPFS = "/data/mongot:rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700"
SEARCH_BYTES = 512 * 1024 * 1024
FILESYSTEM_COMMAND = 'stat -f -c \'{"filesystemType":"%T","blockSize":%S,"blocks":%b,"blocksFree":%f,"blocksAvailable":%a}\' /data/mongot'
# Runs only in the already network-isolated worker, sharing MongoDB's loopback.
METRICS_COMMAND = """import urllib.request
names = {'mongot_system_disk_space_data_path_free_bytes', 'mongot_system_disk_space_data_path_total_bytes'}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open('http://127.0.0.1:9946/metrics', timeout=5) as response:
    body = response.read(2000001)
assert len(body) <= 2000000, 'bounded mongot metrics response exceeded'
for line in body.decode().splitlines():
    fields = line.split()
    if fields and fields[0].split('{', 1)[0] in names:
        print(line)
"""


def parse_disk_metrics(text):
    values = {}
    for line in text.splitlines():
        match = re.fullmatch(r'mongot_system_disk_space_data_path_(free|total)_bytes(?:\{[^}]*\})?\s+(\S+)', line)
        assert match, "unexpected or missing search disk metrics"
        name, value = match.groups()
        assert name not in values, "ambiguous search disk metrics"
        values[name] = float(value)
    assert set(values) == {"free", "total"}, "search disk metrics unavailable"
    assert all(math.isfinite(v) for v in values.values()), "invalid search disk metrics"
    assert 0 <= values["free"] <= values["total"] and values["total"] > 0, "invalid search disk capacity"
    return dict(freeBytes=values["free"], totalBytes=values["total"], usedFraction=1 - values["free"] / values["total"])


def verify_search_storage(snapshot):
    mongo = snapshot["containers"]["mongo"]
    assert all(key in mongo for key in ("searchFilesystem", "searchMount", "diskMetrics")), "search storage preflight evidence missing; inspect retained diagnostics"
    filesystem, metrics = mongo["searchFilesystem"], mongo["diskMetrics"]
    assert filesystem["filesystemType"] == "tmpfs", "search data must use the owned scratch tmpfs"
    assert filesystem["blocks"] * filesystem["blockSize"] == SEARCH_BYTES, "search tmpfs capacity differs"
    assert metrics["totalBytes"] == SEARCH_BYTES, "mongot data path differs from the bounded scratch filesystem"
    assert mongo["searchMount"] == {"/data/mongot": SEARCH_TMPFS.split(":", 1)[1]}, "search tmpfs options differ"
    assert metrics["usedFraction"] < .80, "search disk preflight requires less than 80% usage"
    assert 1 - filesystem["blocksAvailable"] / filesystem["blocks"] < .80, "search filesystem lacks headroom"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_payload(expected):
    assert re.fullmatch(r"[0-9a-f]{64}", expected), "final approved manifest SHA-256 required"
    manifest = ROOT / "payload-manifest.json"
    assert not manifest.is_symlink() and sha(manifest) == expected, "payload manifest digest mismatch"
    document = json.loads(manifest.read_text())
    assert set(document) == {"schema", "files"} and document["schema"] == "mongodb-ai-context-payload/1"
    assert set(document["files"]) == FILES, "complete fixed payload roster required"
    for name, expected_hash in document["files"].items():
        path = ROOT / name
        assert path.is_file() and not path.is_symlink() and sha(path) == expected_hash, name
    return document


def verify_result(path, repetition):
    result = json.loads(path.read_text())
    assert result["schema"] == "mongodb-context-adapter-result/1" and result["status"] == "passed"
    assert result["repetitionLabel"] == str(repetition)
    assert len(result["cache"]) == 240 and len(result["postgresControl"]) == 48
    assert all(row["adapterAnswers"] == (["YES"] if row["oracleHit"] else []) for row in result["cache"])
    memory = result["memory"]
    assert len(memory["corrections"]) == 8 and memory["deletedDirectCount"] == 0
    assert memory["deletedSemanticQueries"] == 8 and memory["neighborRecordsPreserved"] == 8
    assert memory["neighborBeforeSha256"] == memory["neighborAfterSha256"]
    return {"repetitionLabel": str(repetition), "sha256": sha(path), "cacheLookups": 240, "postgresObservations": 48}


def main():
    os.umask(0o077)
    assert os.environ.get("GITHUB_ACTIONS") == "true", "disposable hosted job only"
    assert platform.system() == "Linux" and platform.machine() == "x86_64", "Linux/amd64 required"
    payload = verify_payload(os.environ.get("PAYLOAD_MANIFEST_SHA256", ""))
    run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    assert run_id.isdigit() and attempt.isdigit()
    run = run_id + "-" + attempt
    label = "odin.mongo-ai-context=" + run
    network = "mai-context-" + run
    names = {kind: network + "-" + kind for kind in ("mongo", "postgres", "worker")}
    output = Path(os.environ["RUNNER_TEMP"]) / "mongodb-ai-context-results"
    output.mkdir(mode=0o700, exist_ok=True)
    passwords = {kind: secrets.token_urlsafe(30) for kind in ("mongo", "postgres")}
    owned = []
    network_created = False
    report = {
        "schema": "mongodb-ai-context-runtime/1", "runId": run_id, "runAttempt": attempt,
        "sourceRevision": os.environ["GITHUB_SHA"], "payload": payload,
        "manifestSha256": sha(ROOT / "payload-manifest.json"), "images": {},
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "repetitions": [251, 252], "cleanup": [], "status": "running",
        "boundary": "Fixed fixture repeated with separate database names; functional correctness only.",
        "searchStorageBoundary": "Owned 512 MiB scratch tmpfs inside the unchanged container memory cap; no index durability claim. Prior timeout cause remains unproven.",
    }

    def redacted(text):
        for password in passwords.values():
            text = text.replace(password, "[REDACTED]")
        return text

    def command(args, *, env=None, timeout=120, log=None):
        try:
            result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
            text = redacted(result.stdout + result.stderr)
        except subprocess.TimeoutExpired as error:
            def decoded(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else (value or "")
            text = redacted(decoded(error.stdout) + decoded(error.stderr))
            if log:
                (output / log).write_text(text)
            raise RuntimeError("bounded subprocess timed out: " + " ".join(args[:3])) from None
        if log:
            (output / log).write_text(text)
        if result.returncode:
            raise RuntimeError(" ".join(args[:3]) + " exited " + str(result.returncode) + ": " + text[-2000:])
        return text

    def inspect_image(reference):
        image = json.loads(command(["docker", "image", "inspect", reference]))[0]
        assert image["Os"] == "linux" and image["Architecture"] == "amd64"
        return image

    def capture_resources(stage):
        # Only fixed state fields and resource counters; never serialize container Config/Env.
        snapshot = {"stage": stage, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "containers": {}}
        state_format = '{"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}},"status":{{json .State.Status}},"pidsLimit":{{json .HostConfig.PidsLimit}}}'
        cgroup_read = 'for field in pids.current pids.max pids.events pids.peak; do file="/sys/fs/cgroup/$field"; if [ -r "$file" ]; then printf "%s\\n" "$field"; cat "$file"; fi; done'
        for kind, name in names.items():
            if name not in owned:
                continue
            row = snapshot["containers"][kind] = {}
            reads = (
                ("state", ["docker", "inspect", "--format", state_format, name], True),
                ("stats", ["docker", "stats", "--no-stream", "--format", "{{json .}}", name], True),
                ("cgroupPids", ["docker", "exec", name, "sh", "-c", cgroup_read], False),
            )
            for key, args, is_json in reads:
                try:
                    text = command(args, timeout=10)
                    row[key] = json.loads(text) if is_json else text
                except Exception as error:
                    # Diagnostics must retain their own failure without replacing the probe error.
                    row[key + "Error"] = redacted(str(error))
            if kind == "mongo":
                storage_reads = (
                    ("searchFilesystem", ["docker", "exec", name, "/bin/sh", "-c", FILESYSTEM_COMMAND], json.loads),
                    ("searchMount", ["docker", "inspect", "--format", "{{json .HostConfig.Tmpfs}}", name], json.loads),
                    ("diskMetrics", ["docker", "exec", names["worker"], "python", "-c", METRICS_COMMAND], parse_disk_metrics),
                )
                for key, args, decode in storage_reads:
                    try:
                        row[key] = decode(command(args, timeout=10, log=stage + "-" + key + ".log"))
                    except Exception as error:
                        row[key + "Error"] = redacted(str(error))
        report.setdefault("resources", []).append(snapshot)
        try:
            (output / ("resources-" + stage + ".json")).write_text(json.dumps(snapshot, indent=2) + "\n")
        except OSError as error:
            snapshot["writeError"] = redacted(str(error))
        return snapshot

    try:
        for kind, pin in IMAGES.items():
            command(["docker", "pull", "--platform", "linux/amd64", pin["reference"]], timeout=300, log=kind + "-pull.log")
            image = inspect_image(pin["reference"])
            assert image["Id"] == pin["config"] and pin["reference"] in image["RepoDigests"]
            report["images"][kind] = {"reference": pin["reference"], "id": image["Id"], "repoDigests": image["RepoDigests"], "architecture": image["Architecture"]}
        # Inspect the default image's overlay before any database service or case exists.
        # This fixed, keyless, read-only one-off removes its anonymous image volumes on exit.
        baseline_name = network + "-filesystem-baseline"
        owned.append(baseline_name)
        baseline = command(["docker", "run", "--rm", "--platform", "linux/amd64", "--name", baseline_name,
                            "--label", label, "--network", "none", "--read-only", "--cpus", "1",
                            "--memory", "128m", "--pids-limit", "32", "--entrypoint", "/bin/sh",
                            report["images"]["mongo"]["id"], "-c", FILESYSTEM_COMMAND],
                           timeout=20, log="default-search-filesystem.log")
        report["defaultSearchFilesystem"] = json.loads(baseline)
        worker_image = network + "-worker-image"
        command(["docker", "build", "--platform", "linux/amd64", "--label", label, "-t", worker_image, str(ROOT)], timeout=420, log="worker-build.log")
        image = inspect_image(worker_image)
        report["images"]["worker"] = {"id": image["Id"], "architecture": image["Architecture"], "dockerfileSha256": sha(ROOT / "Dockerfile"), "requirementsSha256": sha(ROOT / "requirements.lock")}
        command(["docker", "network", "create", "--internal", "--label", label, network])
        network_created = True
        for kind, memory in (("mongo", "1536m"), ("postgres", "512m"), ("worker", "768m")):
            env = dict(os.environ)
            args = ["docker", "run", "-d", "--platform", "linux/amd64", "--name", names[kind], "--label", label, "--cpus", "2", "--memory", memory, "--pids-limit", "1024" if kind == "mongo" else "256", "--network", "container:" + names["mongo"] if kind == "worker" else network]
            if kind == "mongo":
                args += ["--tmpfs", SEARCH_TMPFS]
                env.update(MONGODB_INITDB_ROOT_USERNAME="probe", MONGODB_INITDB_ROOT_PASSWORD=passwords[kind], JAVA_TOOL_OPTIONS="-Xms128m -Xmx256m")
                for key in ("MONGODB_INITDB_ROOT_USERNAME", "MONGODB_INITDB_ROOT_PASSWORD", "JAVA_TOOL_OPTIONS"):
                    args += ["-e", key]
            elif kind == "postgres":
                env.update(POSTGRES_USER="probe", POSTGRES_PASSWORD=passwords[kind], POSTGRES_DB="probe")
                for key in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"):
                    args += ["-e", key]
            else:
                env.update(MONGO_URI="mongodb://probe:" + passwords["mongo"] + "@127.0.0.1:27017/?authSource=admin&directConnection=true", PG_URI="postgresql://probe:" + passwords["postgres"] + "@" + names["postgres"] + ":5432/probe")
                args += ["-e", "MONGO_URI", "-e", "PG_URI", "-v", str(ROOT) + ":/work:ro", "-v", str(output) + ":/out:rw"]
            args += [report["images"][kind]["id"] if kind != "worker" else image["Id"]]
            if kind == "worker":
                args += ["sleep", "1800"]
            # Record the intended name before the create call so a partial create is cleaned too.
            owned.append(names[kind])
            command(args, env=env)
        ready = False
        for _ in range(120):
            state = json.loads(command(["docker", "inspect", "--format", "{{json .State}}", names["mongo"]]))
            if state.get("Health", {}).get("Status") == "healthy":
                ready = True
                break
            time.sleep(2)
        assert ready, "Atlas Local health deadline"
        command(["docker", "exec", names["postgres"], "pg_isready", "-h", "127.0.0.1", "-U", "probe", "-d", "probe"])
        assert json.loads(command(["docker", "network", "inspect", network]))[0]["Internal"]
        report["isolation"] = {}
        for kind, name in names.items():
            info = json.loads(command(["docker", "inspect", name]))[0]
            assert not info["HostConfig"]["PortBindings"]
            report["isolation"][kind] = {"networkMode": info["HostConfig"]["NetworkMode"], "portBindings": info["HostConfig"]["PortBindings"]}
        report["packages"] = json.loads(command(["docker", "exec", names["worker"], "python", "-m", "pip", "list", "--format=json"]))
        verify_search_storage(capture_resources("ready"))
        report["results"] = []
        for repetition in (251, 252):
            command(["docker", "exec", names["worker"], "python", "/work/database_probe.py", str(repetition)], timeout=600, log="worker-" + str(repetition) + ".log")
            capture_resources("after-worker-" + str(repetition))
            report["results"].append(verify_result(output / ("database-result-" + str(repetition) + ".json"), repetition))
        report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error=redacted(str(error)))
        capture_resources("failure")
    finally:
        for name in reversed(owned):
            try:
                found = command(["docker", "ps", "-aq", "--filter", "name=^/" + name + "$", "--filter", "label=" + label]).strip()
                if found:
                    try:
                        command(["docker", "logs", "--tail", "100", name], log=name + ".log")
                    except Exception as error:
                        (output / (name + "-log-error.txt")).write_text(redacted(str(error)))
                    command(["docker", "rm", "-fv", name])
                report["cleanup"].append({"container": name, "removed": not command(["docker", "ps", "-aq", "--filter", "name=^/" + name + "$", "--filter", "label=" + label]).strip()})
            except Exception as error:
                report["cleanup"].append({"container": name, "removed": False, "error": redacted(str(error))})
        if network_created:
            try:
                info = json.loads(command(["docker", "network", "inspect", network]))[0]
                assert info.get("Labels", {}).get("odin.mongo-ai-context") == run
                command(["docker", "network", "rm", network])
                report["networkRemoved"] = True
            except Exception as error:
                report["networkRemoved"] = False
                report["cleanupError"] = redacted(str(error))
        report["endedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if not all(row["removed"] for row in report["cleanup"]) or (network_created and not report.get("networkRemoved")):
            report["status"] = "failed"
        report["artifactDigestScope"] = "Completed files only; the enclosing live orchestrator.log and this receipt are excluded."
        report["artifacts"] = {p.name: sha(p) for p in sorted(output.iterdir()) if p.is_file() and p.name not in {"orchestrator.log", "runtime-receipt.json"}}
        (output / "runtime-receipt.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "run": run}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
