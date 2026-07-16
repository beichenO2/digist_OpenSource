#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
MODE=${1:-prepare}

case "$MODE" in
  prepare) API_AUTO_START=false ;;
  finalize) API_AUTO_START=true ;;
  *)
    echo "Usage: bash scripts/register-runtime.sh [prepare|finalize]" >&2
    exit 2
    ;;
esac

register_service() {
  local id=$1 name=$2 command=$3 auto_start=$4 restart_on_failure=$5 max_restarts=$6 port=$7 health_url=$8
  local payload
  payload=$(jq -n \
    --arg id "$id" \
    --arg name "$name" \
    --arg command "$command" \
    --arg work_dir "$PROJECT_DIR" \
    --arg health_check_url "$health_url" \
    --argjson auto_start "$auto_start" \
    --argjson restart_on_failure "$restart_on_failure" \
    --argjson max_restarts "$max_restarts" \
    --argjson port "$port" \
    '{
      id: $id,
      name: $name,
      command: $command,
      work_dir: $work_dir,
      device_id: "any",
      auto_start: $auto_start,
      restart_on_failure: $restart_on_failure,
      max_restarts: $max_restarts,
      port: $port,
      health_check_url: (if $health_check_url == "" then null else $health_check_url end),
      start_script_dir: "-"
    }')

  curl -fsS -X POST "$POLARPROCESS_URL/api/services/register" \
    -H 'Content-Type: application/json' \
    -d "$payload"
  printf '\n'
}

curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null
register_service digist "DiGist API (legacy retired)" "/usr/bin/false" false false 0 null ""
register_service digist-api "DiGist API" "bash Start/api.sh" "$API_AUTO_START" true 10 3800 "http://127.0.0.1:3800/api/health"
register_service digist-engine "DiGist Engine (legacy retired)" "/usr/bin/false" false false 0 null ""
register_service digist-engine-worker "DiGist Engine Worker" "bash Start/engine.sh" "$API_AUTO_START" true 5 null ""
