#!/usr/bin/env python3
"""EXP 012 arm A1 — review, then verify (one ODIN_REVIEW_RECALL_REVIEWER_CMD per bundle).

Pass 1: the unchanged P1 review on the tool-free ollama-chat seat (reviewer-engine.sh copy frozen in
this directory), written to a private scratch log. Pass 2, only when pass 1 is not SHIP and has
findings: the same model re-reads the change and its own numbered findings (verify-prompt.txt) and
keeps a finding only with a concrete failing input. Final verdict: the pass-1 verdict with only kept
findings if any survive, else SHIP. Exactly one final row is appended to $ODIN_ADVERSARIAL_VERDICTS.

Pre-registered failure handling:
- pass 1 no-verdict -> the final row IS the pass-1 no-verdict row (counted conservatively by the scorer).
- pass 2 HTTP/transport failure, wrong model, or unparseable reply after one retry -> the final row is
  the pass-1 row unchanged, marked verifyFailed (the alarm stands: never silently SHIP).
Cost: pass-1 receipt cost + pass-2 receipt cost (exact, list price), written to reviews/<id>.cost.
"""
import json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, ".claude/scripts/review-recall/reviewer-engine.sh")
CHAT = os.path.join(HERE, ".claude/scripts/review-recall/ollama-chat-review.py")
MODEL = "minimax-m3.1-flash"
P_IN, P_OUT = 0.15, 0.60


def main():
    bundle_dir, bundle_id = sys.argv[1], sys.argv[2]
    final_log = os.environ["ODIN_ADVERSARIAL_VERDICTS"]
    reviews = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(bundle_dir))), "reviews")
    cost_file = os.path.join(reviews, bundle_id + ".cost")
    scratch = tempfile.mkdtemp(prefix="exp012-")
    p1_log = os.path.join(scratch, "pass1.jsonl")
    env = dict(os.environ, ODIN_ADVERSARIAL_VERDICTS=p1_log, ODIN_REVIEW_RECALL_SEAT="ollama-chat:" + MODEL,
               ODIN_REVIEW_RECALL_PROMPT_VARIANT="p1", ODIN_REVIEW_RECALL_PRICE_IN=str(P_IN),
               ODIN_REVIEW_RECALL_PRICE_OUT=str(P_OUT))
    rc = subprocess.run(["bash", ENGINE, bundle_dir, bundle_id], env=env).returncode
    if rc != 0:
        return rc  # a usage/config refusal: the harness aborts the pass, as for any seat
    row = json.loads(open(p1_log).read().splitlines()[-1])
    p1_cost = float(row.get("costUsd") or 0)
    row["exp012"] = {"arm": "A1", "pass1Verdict": row.get("verdict"), "pass1Findings": len(row.get("findings") or [])}
    findings = row.get("findings") or []
    if row.get("noVerdict") or row.get("verdict") == "SHIP" or not findings:
        row["exp012"]["verify"] = "not-needed"
        return finish(row, p1_cost, 0.0, final_log, cost_file)
    change = open(os.path.join(bundle_dir, "CHANGE.md"), encoding="utf-8", errors="replace").read() \
        if os.path.exists(os.path.join(bundle_dir, "CHANGE.md")) else ""
    diff = open(os.path.join(bundle_dir, "diff.patch"), encoding="utf-8", errors="replace").read()
    listing = "\n".join("%d. [%s] %s — %s" % (i + 1, f.get("severity", ""), f.get("file", ""), f.get("note", ""))
                        for i, f in enumerate(findings))
    prompt = open(os.path.join(HERE, "verify-prompt.txt")).read() \
        .replace("__CHANGE__", change).replace("__DIFF__", diff).replace("__FINDINGS__", listing)
    pf = os.path.join(scratch, "verify-prompt.txt"); open(pf, "w").write(prompt)
    v_cost, kept, cause = 0.0, None, None
    for attempt in (1, 2):
        cwd = tempfile.mkdtemp(prefix="exp012-cwd-")
        try:
            out = subprocess.run([CHAT, MODEL, pf], capture_output=True, text=True, cwd=cwd,
                                 timeout=int(os.environ.get("ODIN_REVIEW_RECALL_ENGINE_TIMEOUT", "900")) + 30)
            text, code = out.stdout, out.returncode
        except subprocess.TimeoutExpired:
            text, code = "", 124
        open(os.path.join(os.path.dirname(cost_file), "%s.verify.%d.txt" % (os.path.basename(cost_file)[:-5], attempt)), "w").write(text)
        rec = None
        for line in text.splitlines():
            if line.startswith("{") and '"ollama_chat_receipt"' in line:
                try: rec = json.loads(line)
                except ValueError: pass
        if rec:
            v_cost += (rec.get("promptTokens", 0) * P_IN + rec.get("evalTokens", 0) * P_OUT) / 1e6
        if code != 0:
            cause = "verify-rc-%d" % code; continue
        if not rec or rec.get("model") != MODEL:
            cause = "verify-model:%s" % (rec or {}).get("model"); continue
        m = re.search(r'\{\s*"keep"\s*:', text)
        try:  # decode exactly ONE object starting at {"keep": (the receipt line follows it)
            keep = json.JSONDecoder().raw_decode(text, m.start())[0]["keep"] if m else None
        except (ValueError, KeyError, TypeError):
            keep = None
        try:
            valid = validate_keep(keep, len(findings))
        except Exception:  # any validation fault = an invalid reply, never a crash of the run
            valid = None
        if valid is None:  # Amendment 01: ANY malformed entry invalidates the whole reply (never a silent SHIP)
            cause = "verify-unparseable"; continue
        kept = valid
        cause = None
        break
    if kept is None:
        row["exp012"].update({"verify": "failed", "verifyFailed": True, "verifyCause": cause})
        return finish(row, p1_cost, v_cost, final_log, cost_file)
    row["exp012"].update({"verify": "ok", "kept": len(kept), "dropped": len(findings) - len(kept)})
    row["findings"] = [findings[i - 1] for i in kept]
    if not kept:
        row["verdict"] = "SHIP"
    return finish(row, p1_cost, v_cost, final_log, cost_file)


def validate_keep(keep, n_findings):
    """Amendment 01. Return the sorted kept finding numbers, or None when the reply breaks the
    published schema: keep must be a list; every entry a dict whose "n" is an int (or an all-digit
    string) in 1..n_findings and whose "failing_input" is a non-empty string. One bad entry rejects
    the reply; an explicit empty list is valid (no finding survives)."""
    if not isinstance(keep, list):
        return None
    out = set()
    for k in keep:
        if not isinstance(k, dict):
            return None
        n, fi = k.get("n"), k.get("failing_input")
        if isinstance(n, bool) or not (isinstance(n, int) or (isinstance(n, str) and re.fullmatch(r"[0-9]+", n))):
            return None  # ASCII digits only: "²".isdigit() is True but int("²") raises (review 20:48Z)
        n = int(n)
        if not 1 <= n <= n_findings or not isinstance(fi, str) or not fi.strip():
            return None
        out.add(n)
    return sorted(out)


def finish(row, p1_cost, v_cost, final_log, cost_file):
    total = round(p1_cost + v_cost, 6)
    row["costUsd"] = total
    row["costSource"] = "exp012 A1: pass1 %.6f + verify %.6f (receipt tokens, list price)" % (p1_cost, v_cost)
    row["reviewer"] = "exp012-verify-seat.py"
    open(final_log, "a").write(json.dumps(row) + "\n")
    open(cost_file, "w").write("%.6f\n" % total)
    return 0


sys.exit(main())
