#!/usr/bin/env bash
set -euo pipefail

POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
SERVICE_ID=digist-api
curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null
exec curl -fsS -X POST "$POLARPROCESS_URL/api/services/$SERVICE_ID/stop"
