#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
POLARPORT_URL=${POLARPORT_URL:-http://127.0.0.1:11050}
PREFERRED_PORT=3800

if [ "$#" -ne 0 ]; then
  echo "DiGist API lifecycle is managed by PolarProcess; do not pass lifecycle arguments" >&2
  exit 2
fi

source "$PROJECT_DIR/scripts/ensure-node.sh" "$PROJECT_DIR"
NODE_BIN=$(command -v node)
TSX_BIN="$PROJECT_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "DiGist dependencies are not installed; run npm ci" >&2
  exit 1
fi

if ! curl -fsS --max-time 3 "$POLARPORT_URL/api/health" >/dev/null; then
  echo "PolarPort is unavailable; refusing preferred-port fallback" >&2
  exit 1
fi

source "$HOME/Polarisor/Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "digist-api" "digist" 3800)

if [ "$PORT" -ne "$PREFERRED_PORT" ]; then
  release_port "$PORT"
  echo "PolarPort returned $PORT, but DiGist API SSoT requires preferred port $PREFERRED_PORT" >&2
  exit 1
fi

POLARPRIVATE_PORT=$(curl -fsS --max-time 3 "$POLARPORT_URL/api/list" | python3 -c '
import json, sys
ports = json.load(sys.stdin)
matches = [p["port"] for p in ports if p.get("service_name") == "privportal-backend" and p.get("project") == "PolarPrivate" and p.get("status") == "active"]
if len(matches) != 1:
    raise SystemExit(1)
print(matches[0])
') || {
  release_port "$PORT"
  echo "PolarPrivate Backend has no unique active PolarPort record; refusing an unmanaged dependency target" >&2
  exit 1
}

cd "$PROJECT_DIR"
export PORT
export POLARPRIVATE_URL="http://127.0.0.1:$POLARPRIVATE_PORT"
export POLAR_RUNTIME_MANAGED=1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.agent-reach-venv/bin"
exec "$NODE_BIN" "$TSX_BIN" src/api/server.ts
