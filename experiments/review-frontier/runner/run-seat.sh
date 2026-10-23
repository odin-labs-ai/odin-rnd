#!/usr/bin/env bash
# EXP 017 counted run — one seat, one replicate, all 58 changes of the sealed corpus. Frozen by sha256 in
# experiments/review-frontier/preregistration.json; it runs the PRIVATE review-recall harness of Odin's
# engineering repository and refuses unless every pinned private file matches its hash.
#
#   run-seat.sh <seat> <run a|b> <cap-usd>
#
# Environment:
#   EXP017_LABS        a checkout of the engineering repository at the pinned commit (never edited during a run)
#   EXP017_SCORER      a byte-frozen copy of the review-recall scorer (verify-panel-recall.ts)
#   EXP017_OUT         directory for the private raw outputs of this run
#   OPENROUTER_API_KEY the experiment's dedicated, capped key (env only; never argv, never printed)
#
# Output: $EXP017_OUT/<seat>-<run>/ holding the harness report, the scratch verdict log, the per-change cost
# files and key-usage.json (the key's usage counter read before and after the run). collect.mjs turns that
# into the public experiments/review-frontier/runs/<seat>-<run>.json.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREREG="$HERE/../preregistration.json"
SEAT="${1:?seat}"; RUN="${2:?run a|b}"; CAP="${3:?cap-usd}"
: "${EXP017_LABS:?}" "${EXP017_SCORER:?}" "${EXP017_OUT:?}" "${OPENROUTER_API_KEY:?}"
case "$RUN" in a|b) ;; *) echo "run-seat: run must be a or b" >&2; exit 1 ;; esac

read -r MODEL PRICE_IN PRICE_OUT < <(node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const s = p.seats.find(x => x.id === process.argv[2]);
if (!s) process.exit(1);
console.log(s.model, s.listPrice.inputPer1mUsd, s.listPrice.outputPer1mUsd);' "$PREREG" "$SEAT") \
  || { echo "run-seat: unknown seat $SEAT" >&2; exit 1; }

# Every pinned private file must match the pre-registration, or nothing runs.
node -e '
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
let bad = 0;
for (const [file, want] of Object.entries(p.harness.sha256)) {
  const abs = file === "scorer" ? process.argv[3] : path.join(process.argv[2], file);
  const got = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  if (got !== want) { console.error(`run-seat: REFUSED — ${file} sha256 ${got} != pinned ${want}`); bad++; }
}
process.exit(bad ? 1 : 0);' "$PREREG" "$EXP017_LABS" "$EXP017_SCORER" || exit 1

DIR="$EXP017_OUT/$SEAT-$RUN"
mkdir -p "$DIR"
# One run at a time per checkout: the harness names its run dir by time and pid, and this script copies the
# newest one, so two concurrent runs in one checkout could copy each other's. Concurrent streams use
# separate checkouts of the same pinned commit.
LOCK="$EXP017_LABS/.ai/scratch/exp017-run.lock"
mkdir -p "$EXP017_LABS/.ai/scratch"
mkdir "$LOCK" 2>/dev/null || { echo "run-seat: REFUSED — another EXP 017 run holds $LOCK" >&2; exit 1; }
trap 'rmdir "$LOCK"' EXIT
[ -e "$DIR/key-usage.json" ] && { echo "run-seat: REFUSED — $DIR already holds a finished run" >&2; exit 1; }
usage() { curl -sS --max-time 30 -K <(printf 'header = "Authorization: Bearer %s"\n' "$OPENROUTER_API_KEY") \
  https://openrouter.ai/api/v1/key | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;console.log(JSON.stringify({usage:d.usage,limit:d.limit,limitReset:d.limit_reset}))})'; }
BEFORE="$(usage)"; START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

ODIN_REVIEW_RECALL_SCORER="$EXP017_SCORER" \
ODIN_REVIEW_RECALL_REVIEWER_CMD="$EXP017_LABS/.claude/scripts/review-recall/reviewer-engine.sh" \
ODIN_REVIEW_RECALL_SEAT="openrouter-chat:$MODEL" ODIN_REVIEW_RECALL_PROMPT_VARIANT=p1 \
ODIN_REVIEW_RECALL_PRICE_IN="$PRICE_IN" ODIN_REVIEW_RECALL_PRICE_OUT="$PRICE_OUT" \
  bash "$EXP017_LABS/.claude/scripts/review-recall/review-recall-run.sh" --mode real --cap-usd "$CAP" --out "$DIR/report.json" \
  > "$DIR/harness.log" 2>&1
RC=$?
END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# The harness keeps its run dir under the engineering checkout; copy the newest one for this run.
RUNDIR="$(ls -td "$EXP017_LABS"/.ai/scratch/review-recall/run-* 2>/dev/null | head -1)"
[ -n "$RUNDIR" ] && cp -R "$RUNDIR/reviews" "$DIR/reviews" && cp "$RUNDIR/verdicts.jsonl" "$DIR/verdicts.jsonl"
AFTER="$(usage)"
node -e 'const [b,a,s,e,rc,seat,run,model]=process.argv.slice(1);console.log(JSON.stringify({seat,run,model,start:s,end:e,harnessExit:Number(rc),keyBefore:JSON.parse(b),keyAfter:JSON.parse(a)}))' \
  "$BEFORE" "$AFTER" "$START" "$END" "$RC" "$SEAT" "$RUN" "$MODEL" > "$DIR/key-usage.json"
echo "run-seat: $SEAT-$RUN harness exit $RC ($START → $END)"
exit 0
