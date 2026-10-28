"""Lab 05, "Can you tamper with the record?": the governed run's journal, checked row by row, and five ways to tamper
with it, each run through the same check.

    python3 scripts/rogue_tamper.py --vendor <journal.jsonl> --main <sha> --commit <sha> --at <iso> --checked <date> \
        --how "<how each commit was shown to be part of main>"
        (copies the journal's bytes unchanged to site/data/labs/rogue/journal.jsonl and writes
        site/data/labs/rogue/tamper.json and its sha256 pin, tamper.sha256)
    python3 scripts/rogue_tamper.py --check [--site <dir>]
        (re-derives tamper.json from the committed journal and tamper.json's own provenance block, and exits 1 unless
        both it and its pin are byte for byte the committed ones; the site's tests run this in CI)

The check is the engine's own rule (Journal.verify in the agent space's outbox): a row's hash is the sha256 of
json.dumps(the row without its hash, sort_keys=True, ensure_ascii=False), with Python's default separators, in UTF-8;
each row's prev is the hash of the row above, the first row's is 64 zeros. It runs in Python on purpose: a row's time
is a Python float (1793100004.0), which JavaScript would write as 1793100004, so a JavaScript re-hash would differ
from the engine's on every row. Standard library only. The private repository and its paths are given only on the
command line and are never written: --vendor reads a file the caller has already taken out of it.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
JOURNAL, OUT, PIN = "data/labs/rogue/journal.jsonl", "data/labs/rogue/tamper.json", "data/labs/rogue/tamper.sha256"
ZERO = "0" * 64
RULE = ("a row's hash is the sha256 of the row without its hash, written by Python's json.dumps with sorted keys, "
        "non-ASCII kept, and its default separators, in UTF-8; each row's prev is the hash of the row above, and the "
        "first row's is 64 zeros")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def row_hash(row: dict) -> str:
    body = {k: v for k, v in row.items() if k != "hash"}
    return sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8"))


def rows_of(data: bytes) -> list:
    return [json.loads(line) for line in data.decode("utf-8").splitlines() if line.strip()]


def check(rows: list) -> list:
    """Every row, both checks: its own hash recomputed, and its link to the row above."""
    out, prev = [], ZERO
    for i, r in enumerate(rows):
        out.append({"position": i + 1, "n": r["n"], "ownHash": "OK" if row_hash(r) == r["hash"] else "MISMATCH",
                    "prevLink": "OK" if r["prev"] == prev else "BROKEN"})
        prev = r["hash"]
    return out


def first_failure(result: list):
    for r in result:
        if r["ownHash"] != "OK":
            return {"check": "own-hash", "position": r["position"], "n": r["n"]}
        if r["prevLink"] != "OK":
            return {"check": "prev-link", "position": r["position"], "n": r["n"]}
    return None


def flip(rows: list, n: int, field: str, word: str):
    """One byte flipped: the first letter of the last `word` in `field` of row `n` changes case (one bit, 0x20)."""
    rows = json.loads(json.dumps(rows))
    row = rows[n - 1]
    before = row[field]
    i = before.rindex(word)
    after = before[:i] + chr(ord(before[i]) ^ 0x20) + before[i + 1:]
    row[field] = after
    return rows, before, after


def gallery(rows: list, head: str) -> list:
    cases = []
    # 1. A byte flipped in one row: the push target "main" becomes "Main".
    flipped, before, after = flip(rows, 2, "command", "main")
    res = check(flipped)
    cases.append({"id": "byte-flip", "did": "one byte of row 2 changed: in its command, one letter's case flipped",
                  "row": 2, "field": "command", "before": before, "after": after,
                  "result": res, "caught": first_failure(res), "head": flipped[-1]["hash"]})
    # 2. A row dropped: row 3 removed, the rest kept as they were.
    dropped = [r for r in rows if r["n"] != 3]
    res = check(dropped)
    cases.append({"id": "drop-row", "did": "row 3 removed, every other row kept byte for byte",
                  "result": res, "caught": first_failure(res), "head": dropped[-1]["hash"]})
    # 3. Two rows swapped: rows 2 and 3 change places.
    swapped = [rows[0], rows[2], rows[1], *rows[3:]]
    res = check(swapped)
    cases.append({"id": "reorder", "did": "rows 2 and 3 swapped, each kept byte for byte",
                  "result": res, "caught": first_failure(res), "head": swapped[-1]["hash"]})
    # 4. The last row cut off: every row left passes both checks; only the head, published apart, changes.
    cut = rows[:-1]
    res = check(cut)
    cases.append({"id": "drop-last", "did": f"the last row, row {rows[-1]['n']}, removed",
                  "result": res, "caught": first_failure(res) or ({"check": "head"} if cut[-1]["hash"] != head else None), "head": cut[-1]["hash"]})
    # 5. The same byte flip, then the chain rewritten: every hash and prev from row 2 on recomputed by the rule. The
    # row checks cannot catch this; only the head, published apart from the journal, can.
    rewritten, _, _ = flip(rows, 2, "command", "main")
    prev = ZERO
    for r in rewritten:
        r["prev"] = prev
        r["hash"] = row_hash(r)
        prev = r["hash"]
    res = check(rewritten)
    cases.append({"id": "rewrite-chain", "did": "the same byte flip, then every row's prev and hash from row 2 on recomputed by the rule",
                  "result": res, "caught": first_failure(res) or ({"check": "head"} if rewritten[-1]["hash"] != head else None),
                  "head": rewritten[-1]["hash"]})
    return cases


def derive(journal: bytes, vendored: dict) -> dict:
    rows = rows_of(journal)
    result = check(rows)
    head = rows[-1]["hash"]
    if first_failure(result) is not None:
        raise SystemExit(f"rogue_tamper: the journal does not verify: {first_failure(result)}")
    if [r["n"] for r in rows] != list(range(1, len(rows) + 1)):
        raise SystemExit("rogue_tamper: the journal's rows are not numbered 1..N in order")
    files = [f for f in vendored["files"] if f["role"] == "journal"]
    if len(files) != 1 or files[0]["sha256"] != sha256(journal):
        raise SystemExit(f"rogue_tamper: the journal's sha256 is {sha256(journal)}, not the one the provenance block cites")
    return {
        "format": "odin-lab-rogue-tamper", "version": 1,
        "vendored": vendored,
        "rule": RULE,
        "checkedWith": "this site's own Python check, standard library only, run when the journal was vendored and again in every CI run",
        "rows": [{"n": r["n"], "hash": r["hash"], "prev": r["prev"], "ownHash": c["ownHash"], "prevLink": c["prevLink"]} for r, c in zip(rows, result)],
        "head": head,
        "cases": gallery(rows, head),
    }


def serialise(record: dict) -> bytes:
    return (json.dumps(record, indent=1, ensure_ascii=False) + "\n").encode("utf-8")


def pin_line(data: bytes) -> bytes:
    return f"{sha256(data)}  tamper.json\n".encode("utf-8")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--vendor")
    p.add_argument("--main")
    p.add_argument("--commit")
    p.add_argument("--at")
    p.add_argument("--checked")
    p.add_argument("--how")
    p.add_argument("--check", action="store_true")
    p.add_argument("--site", default=str(SITE))
    a = p.parse_args(argv)
    site = Path(a.site)
    journal_path, out, pin = site / JOURNAL, site / OUT, site / PIN
    if a.check:
        committed = json.loads(out.read_text(encoding="utf-8"))
        want = serialise(derive(journal_path.read_bytes(), committed["vendored"]))
        same = want == out.read_bytes() and pin_line(want) == pin.read_bytes()
        print(f"rogue_tamper --check: {'SAME' if same else 'DIFFERENT'}; {len(committed['rows'])} rows, head {committed['head'][:16]}")
        return 0 if same else 1
    if not all([a.vendor, a.main, a.commit, a.at, a.checked, a.how]):
        p.error("--vendor needs --main, --commit, --at, --checked and --how")
    journal = Path(a.vendor).read_bytes()
    vendored = {
        "from": "the governed run's audit journal in the agent space's private repository, read at one commit, every row in full",
        "mainCheck": {"main": a.main, "how": a.how, "checked": a.checked, "commits": [a.commit]},
        "cites": [{"commit": a.commit, "at": a.at, "what": "the journal last rebuilt, after the read-only door changed"}],
        "files": [{"role": "journal", "what": "the governed run's hash-chained audit journal", "sha256": sha256(journal)}],
    }
    data = serialise(derive(journal, vendored))
    journal_path.write_bytes(journal)
    out.write_bytes(data)
    pin.write_bytes(pin_line(data))
    print(f"rogue_tamper: wrote {JOURNAL}, {OUT} and {PIN}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
