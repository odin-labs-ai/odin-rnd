"""The pull request's built site, taken from its verify run's artifact as DATA for the base-branch leak gate.

    python3 scripts/leak-screen-input.py <artifact.zip> <out-dir> <expected-head-sha>

Every byte of the zip is untrusted (the pull request's own code built it). Refused, before anything is written: an
entry name that is absolute, holds "..", a backslash or a NUL; a symbolic link or any entry that is not a file or a
directory; more than MAX_ENTRIES entries or MAX_BYTES uncompressed; a manifest.json that is missing, not the expected
format, or names another head sha than the one the run was for. Nothing in it is executed.
"""
import json
import os
import re
import stat
import sys
import zipfile

MAX_ENTRIES = 20000
MAX_BYTES = 1536 * 1024 * 1024


def fail(msg):
    print(f"leak-screen-input: {msg}", file=sys.stderr)
    sys.exit(2)


def check(z, head_sha):
    infos = z.infolist()
    if len(infos) > MAX_ENTRIES:
        fail(f"{len(infos)} entries, over {MAX_ENTRIES}")
    total = 0
    for info in infos:
        name = info.filename
        if not name or name.startswith("/") or "\\" in name or "\0" in name or re.match(r"^[A-Za-z]:", name):
            fail("an entry name is absolute or malformed")
        if any(part == ".." for part in name.split("/")):
            fail("an entry name climbs out of the output folder")
        # The file-type bits of a Unix mode: none recorded is a plain entry; anything but a file or a directory is refused.
        ftype = stat.S_IFMT((info.external_attr >> 16) & 0xFFFF)
        if ftype and ftype not in (stat.S_IFREG, stat.S_IFDIR):
            fail("an entry is a link or a special file")
        total += info.file_size
        if total > MAX_BYTES:
            fail(f"over {MAX_BYTES} bytes uncompressed")
    names = {i.filename for i in infos}
    if "manifest.json" not in names:
        fail("no manifest.json")
    try:
        manifest = json.loads(z.read("manifest.json"))
    except ValueError:
        fail("manifest.json is not JSON")
    if not isinstance(manifest, dict) or manifest.get("format") != "odin-leak-screen-input" or manifest.get("version") != 1:
        fail("manifest.json has the wrong format")
    if manifest.get("headSha") != head_sha:
        fail("the artifact was built for another head than this run's")
    if not any(n.startswith("dist/") for n in names):
        fail("no dist/ in the artifact")
    return infos, total


def main(zip_path, out_dir, head_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", head_sha):
        fail("the expected head sha is not 40 hex")
    try:
        z = zipfile.ZipFile(zip_path)
    except (OSError, zipfile.BadZipFile):
        fail("the artifact is not a readable zip")
    infos, total = check(z, head_sha)
    root = os.path.realpath(out_dir)
    os.makedirs(root, exist_ok=True)
    for info in infos:
        target = os.path.realpath(os.path.join(root, info.filename))
        if target != root and not target.startswith(root + os.sep):
            fail("an entry resolves outside the output folder")
        if info.is_dir():
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(info) as src, open(target, "wb") as dst:
            written = 0
            while True:
                chunk = src.read(1 << 20)
                if not chunk:
                    break
                written += len(chunk)
                if written > info.file_size:
                    fail("an entry is larger than its header says")
                dst.write(chunk)
    print(f"leak-screen-input: {len(infos)} entries, {total} bytes, built for {head_sha[:12]}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        fail("usage: leak-screen-input.py <artifact.zip> <out-dir> <expected-head-sha>")
    main(*sys.argv[1:])
