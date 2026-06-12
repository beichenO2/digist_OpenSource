#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

bash scripts/daily-digest.sh &
DAEMON_PID=$!
echo "pid=$DAEMON_PID"
exit 0
