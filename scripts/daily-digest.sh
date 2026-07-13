#!/usr/bin/env bash
# Daily digest: scrape content across all platforms with even distribution.
# Scheduled via SOTAgent cron `digist-daily-digest` (launchd retired 2026-06-12).
#
# KEY DESIGN: scrapes are spread evenly with configurable delays between each
# platform to avoid burst traffic and account bans.
#
# Phase 1 = L1 open/免登 platforms (arxiv/hackernews/reddit/github/v2ex/bilibili/youtube).
# Phase 2 = L3 anti-detect browser platforms (bloomberg/zhihu). No Safari.
# twitter/xiaohongshu removed entirely (强风控高封号风险，停止采集).
# Schedule: 06:00, 08:00, 11:00, 14:00, 17:00, 20:00, 23:00

set -euo pipefail

DIGIST_DIR="$HOME/Polarisor/digist"
# shellcheck source=ensure-node.sh
source "$DIGIST_DIR/scripts/ensure-node.sh" "$DIGIST_DIR"
LOG_DIR="$DIGIST_DIR/data/logs"
OUTPUT_DIR="$DIGIST_DIR/data/daily"
DATE=$(date +%Y-%m-%d)
HOUR=$(date +%H)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOCK_DIR="$DIGIST_DIR/data/.daily-digest.lock"

# Delay between platform scrapes (seconds). Spread across the 3h window.
INTER_PLATFORM_DELAY="${DIGIST_INTER_PLATFORM_DELAY:-300}"  # 5 min default
MAX_ITEMS_PER_SCRAPE="${DIGIST_MAX_ITEMS:-10}"

mkdir -p "$LOG_DIR" "$OUTPUT_DIR/$DATE"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_DIR/digest-$DATE.log"; }

MAX_LOCK_AGE_SECONDS="${DIGIST_MAX_LOCK_AGE:-10800}"  # 3 hours default

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid"
    trap 'rm -rf "$LOCK_DIR"' EXIT
    return 0
  fi

  local existing_pid=""
  if [ -f "$LOCK_DIR/pid" ]; then
    existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi

  # Check lock age — auto-clear if older than MAX_LOCK_AGE_SECONDS
  if [ -d "$LOCK_DIR" ]; then
    local lock_age
    if [[ "$OSTYPE" == darwin* ]]; then
      lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR") ))
    else
      lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK_DIR") ))
    fi
    if [ "$lock_age" -gt "$MAX_LOCK_AGE_SECONDS" ]; then
      log "Lock is ${lock_age}s old (> ${MAX_LOCK_AGE_SECONDS}s), force-clearing stale lock"
      if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
        log "Killing hung process $existing_pid"
        kill "$existing_pid" 2>/dev/null || true
        sleep 2
        kill -9 "$existing_pid" 2>/dev/null || true
      fi
      rm -rf "$LOCK_DIR"
      if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_DIR/pid"
        trap 'rm -rf "$LOCK_DIR"' EXIT
        return 0
      fi
    fi
  fi

  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    log "Another daily digest run is active (pid=$existing_pid), skipping this trigger"
    exit 0
  fi

  log "Removing stale daily digest lock"
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid"
    trap 'rm -rf "$LOCK_DIR"' EXIT
    return 0
  fi

  log "Another daily digest run acquired the lock first, skipping this trigger"
  exit 0
}

acquire_lock

log "=== Daily Digest Run: $TIMESTAMP ==="
log "Inter-platform delay: ${INTER_PLATFORM_DELAY}s, max items: ${MAX_ITEMS_PER_SCRAPE}"

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
    return $?
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
    return $?
  fi

  python3 - "$seconds" "$@" <<'PY'
import subprocess
import sys

seconds = float(sys.argv[1])
cmd = sys.argv[2:]
try:
    raise SystemExit(subprocess.run(cmd, timeout=seconds).returncode)
except subprocess.TimeoutExpired:
    print(f"[timeout] command exceeded {int(seconds)}s: {' '.join(cmd)}", file=sys.stderr)
    raise SystemExit(124)
PY
}

# --- Phase 1: API-direct platforms ---
# These are always safe and have generous rate limits.

log "[Phase 1] API-direct platforms"

TOTAL=0
FAILED=0

# One scrape unit → its own log file (so parallel runs don't interleave).
run_scrape_to() {
  local platform="$1" query="$2" outfile="$3"
  if cd "$DIGIST_DIR" && run_with_timeout 120 bash bin/digist scrape "$platform" "$query" > "$outfile" 2>&1; then
    echo "OK"
  else
    echo "FAIL"
  fi
}

# Phase 1: L1 免登平台之间无登录态/风控关联，安全并发（不再逐平台 sleep 5min）。
# 并发度受 L1_CONCURRENCY 控制（默认 4），避免打爆外部 API 与本机。
L1_CONCURRENCY="${DIGIST_L1_CONCURRENCY:-4}"
log "[Phase 1] L1 免登平台并发采集 (concurrency=$L1_CONCURRENCY)"

L1_JOBS=(
  "hackernews|"
  "arxiv|large language model agent"
  "reddit|artificial intelligence"
  "github|trending"
  "v2ex|hot"
  "bilibili|hot"
  "bloomberg|"
  "youtube|AI agent framework"
  "youtube|quantitative trading crypto"
)

TMP_PHASE1="$(mktemp -d "${TMPDIR:-/tmp}/digest-p1-XXXXXX")"
running=0
idx=0
for spec in "${L1_JOBS[@]}"; do
  platform="${spec%%|*}"; query="${spec#*|}"
  idx=$((idx + 1))
  outfile="$TMP_PHASE1/${idx}-${platform}.log"
  log "  → [$platform] '$query' (bg)"
  ( result=$(run_scrape_to "$platform" "$query" "$outfile"); echo "$result" > "$outfile.status" ) &
  running=$((running + 1))
  if [ "$running" -ge "$L1_CONCURRENCY" ]; then
    wait -n 2>/dev/null || wait
    running=$((running - 1))
  fi
done
wait

for spec_idx in $(seq 1 "$idx"); do
  sf=$(ls "$TMP_PHASE1"/${spec_idx}-*.log.status 2>/dev/null | head -1)
  lf="${sf%.status}"
  [ -f "$lf" ] && cat "$lf" >> "$LOG_DIR/digest-$DATE.log"
  if [ "$(cat "$sf" 2>/dev/null)" = "OK" ]; then
    TOTAL=$((TOTAL + 1)); log "  ✓ $(basename "$lf" .log) done"
  else
    FAILED=$((FAILED + 1)); log "  ✗ $(basename "$lf" .log) failed"
  fi
done
rm -rf "$TMP_PHASE1"

# --- Phase 2: L3 browser platforms — SERIAL (L3 profile 不可并发) ---
# 仅 zhihu 走 L3 反检测浏览器。bloomberg 已改 CNBC RSS 进 Phase 1；
# twitter/xiaohongshu 已移除。
log "[Phase 2] L3 browser platforms (serial: shared L3 profile cannot run concurrently)"

run_scrape_serial() {
  local platform="$1" query="$2" delay="$3"
  log "Scraping [$platform] '$query'..."
  if cd "$DIGIST_DIR" && run_with_timeout 180 bash bin/digist scrape "$platform" "$query" 2>&1 | tee -a "$LOG_DIR/digest-$DATE.log"; then
    TOTAL=$((TOTAL + 1)); log "  ✓ $platform done"
  else
    FAILED=$((FAILED + 1)); log "  ✗ $platform '$query' failed"
  fi
  if [ "$delay" -gt 0 ]; then sleep $((delay + RANDOM % 30)); fi
}

BROWSER_DELAY="${DIGIST_BROWSER_DELAY:-30}"
run_scrape_serial zhihu "量化交易策略" "$BROWSER_DELAY"                 # L3

log "=== Scrape phase: $TOTAL done, $FAILED failed ==="

# --- Phase 3: Summarize and sync ---
log "[Phase 3] Generating daily summary..."
cd "$DIGIST_DIR"
if DIGIST_DAILY_DATE="$DATE" npx tsx scripts/summarize-daily.ts "$DATE" 2>&1 | tee -a "$LOG_DIR/digest-$DATE.log"; then
  log "Summary generated, syncing to KnowLever..."
  DIGIST_DAILY_DATE="$DATE" npx tsx scripts/sync-digest-to-knowlever.ts "$DATE" 2>&1 | tee -a "$LOG_DIR/digest-$DATE.log" || true
  log "KnowLever sync complete"
else
  log "WARN: Summary generation failed, skipping KnowLever sync"
fi

log "=== Daily Digest $TIMESTAMP finished ==="
