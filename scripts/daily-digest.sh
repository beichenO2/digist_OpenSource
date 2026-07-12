#!/usr/bin/env bash
# Daily digest: scrape content across all platforms with even distribution.
# Scheduled via SOTAgent cron `digist-daily-digest` (launchd retired 2026-06-12).
#
# KEY DESIGN: scrapes are spread evenly with configurable delays between each
# platform to avoid burst traffic and account bans.
#
# Phase 1 = L1 open/免登 platforms (arxiv/hackernews/reddit/github/v2ex/bilibili/youtube).
# Phase 2 = Safari→L3 fallback platforms (bloomberg/zhihu/xiaohongshu; twitter disabled).
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

run_scrape() {
  local platform="$1"
  local query="$2"
  local delay="$3"

  log "Scraping [$platform] '$query' (limit=$MAX_ITEMS_PER_SCRAPE)..."

  if cd "$DIGIST_DIR" && run_with_timeout 120 bash bin/digist scrape "$platform" "$query" 2>&1 | tee -a "$LOG_DIR/digest-$DATE.log"; then
    TOTAL=$((TOTAL + 1))
    log "  ✓ $platform done"
  else
    log "  ✗ $platform '$query' failed"
    FAILED=$((FAILED + 1))
  fi

  if [ "$delay" -gt 0 ]; then
    local jitter=$((RANDOM % 60))
    local actual_delay=$((delay + jitter))
    log "  Waiting ${actual_delay}s before next platform..."
    sleep "$actual_delay"
  fi
}

run_scrape hackernews "" "$INTER_PLATFORM_DELAY"
run_scrape arxiv "large language model agent" "$INTER_PLATFORM_DELAY"
run_scrape reddit "artificial intelligence" "$INTER_PLATFORM_DELAY"
run_scrape github "trending" "$INTER_PLATFORM_DELAY"
run_scrape v2ex "hot" "$INTER_PLATFORM_DELAY"
run_scrape bilibili "hot" "$INTER_PLATFORM_DELAY"
run_scrape youtube "AI agent framework" "$INTER_PLATFORM_DELAY"
run_scrape youtube "quantitative trading crypto" "$INTER_PLATFORM_DELAY"

# --- Phase 2: Safari-based platforms (twitter/zhihu/xiaohongshu/bloomberg) ---
# bilibili moved to Phase 1 (open-API, no browser); twitter disabled (banned).
log "[Phase 2] Safari scraper platforms (requires macOS + Safari login + Allow JS from Apple Events)"

BROWSER_DELAY=$((INTER_PLATFORM_DELAY * 2))

# twitter/X disabled — account suspended, no viable access (see risk-window-policy.ts)
# run_scrape twitter "cryptocurrency trading" "$BROWSER_DELAY"
# run_scrape twitter "AI research frontier paper" "$BROWSER_DELAY"
run_scrape bloomberg "economics markets" "$BROWSER_DELAY"
run_scrape xiaohongshu "加密货币 量化交易" "$BROWSER_DELAY"
run_scrape zhihu "量化交易策略" "$BROWSER_DELAY"
run_scrape xiaohongshu "AI工具 效率提升" "$BROWSER_DELAY"

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
