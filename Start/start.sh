#!/usr/bin/env bash
set -euo pipefail

POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
SERVICE_ID=digist-api
ACTION=${1:-start}

curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null
case "$ACTION" in
  start|stop|restart)
    exec curl -fsS -X POST "$POLARPROCESS_URL/api/services/$SERVICE_ID/$ACTION"
    ;;
  status)
    exec curl -fsS "$POLARPROCESS_URL/api/services/$SERVICE_ID"
    ;;
  *)
    echo "Usage: bash Start/start.sh [start|stop|restart|status]" >&2
    exit 2
    ;;
esac
