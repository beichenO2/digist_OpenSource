#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

if [ "$#" -ne 0 ]; then
  echo "DiGist Engine lifecycle is managed by PolarProcess; do not pass lifecycle arguments" >&2
  exit 2
fi

source "$PROJECT_DIR/scripts/ensure-node.sh" "$PROJECT_DIR"
NODE_BIN=$(command -v node)
TSX_BIN="$PROJECT_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "DiGist dependencies are not installed; run npm ci" >&2
  exit 1
fi

cd "$PROJECT_DIR"
export POLAR_RUNTIME_MANAGED=1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.agent-reach-venv/bin"
exec "$NODE_BIN" "$TSX_BIN" src/index.ts
