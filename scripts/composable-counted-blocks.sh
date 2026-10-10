#!/usr/bin/env bash
# EXP 009 counted run: run the NEXT unfinished block under odin-labs' memory-window lease (bundle 5 WO-01).
#
#   bash scripts/composable-counted-blocks.sh --labs <odin-labs checkout> --merge-commit <40-hex>
#
# It asks the driver for the lowest block with no complete attempt, then runs
#   bash <labs>/.claude/scripts/mac-memory-window.sh run --label exp009-counted-bNN --max-wait 12h -- \
#     node scripts/composable-counted.mjs --merge-commit <id> --block NN
# The driver applies every gate itself (seed, not-before, EXP 008 finished, held lease); this script adds none and
# can relax none. After the wrapper exits it copies the run's sidecar (every sample and the close summary) to
# runs/composable-harness/counted/leases/<runId>.jsonl, refusing to overwrite. One block per invocation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABS=""
MERGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --labs) LABS="${2:-}"; shift 2 ;;
    --merge-commit) MERGE="${2:-}"; shift 2 ;;
    *) echo "composable-counted-blocks: unknown argument $1" >&2; exit 64 ;;
  esac
done
[ -n "$LABS" ] && [ -f "$LABS/.claude/scripts/mac-memory-window.sh" ] || { echo "composable-counted-blocks: --labs <odin-labs checkout> with .claude/scripts/mac-memory-window.sh is required" >&2; exit 64; }
[[ "$MERGE" =~ ^[0-9a-f]{40}$ ]] || { echo "composable-counted-blocks: --merge-commit <40 lower-case hex> is required" >&2; exit 64; }

cd "$ROOT"
NEXT="$(node scripts/composable-counted.mjs --next-block)"
if [ "$NEXT" = "none" ]; then echo "composable-counted-blocks: every block has a complete attempt" >&2; exit 0; fi
[[ "$NEXT" =~ ^[0-9]{2}$ ]] || { echo "composable-counted-blocks: unexpected next block '$NEXT'" >&2; exit 1; }

STATE_DIR="$HOME/.odin/state/mac-memory-window"
before="$(ls -1 "$STATE_DIR/runs" 2>/dev/null | sort || true)"
set +e
bash "$LABS/.claude/scripts/mac-memory-window.sh" run --label "exp009-counted-b$NEXT" --max-wait 12h -- \
  node scripts/composable-counted.mjs --merge-commit "$MERGE" --block "$NEXT"
rc=$?
set -e

# The sidecar this invocation created (a new runs/<runId>.jsonl whose runId carries the label).
after="$(ls -1 "$STATE_DIR/runs" 2>/dev/null | sort || true)"
new="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | grep -- "-exp009-counted-b$NEXT-" || true)"
if [ -n "$new" ] && [ "$(printf '%s\n' "$new" | wc -l | tr -d ' ')" = 1 ]; then
  dest="$ROOT/runs/composable-harness/counted/leases"
  mkdir -p "$dest"
  if [ -e "$dest/$new" ]; then
    echo "composable-counted-blocks: $dest/$new exists; not overwriting" >&2
  else
    cp -n "$STATE_DIR/runs/$new" "$dest/$new"
  fi
else
  echo "composable-counted-blocks: could not identify this run's sidecar (found: ${new:-none}); not copied" >&2
fi
exit "$rc"
