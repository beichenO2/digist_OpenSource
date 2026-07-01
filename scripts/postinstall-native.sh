#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=ensure-node.sh
source "$ROOT/scripts/ensure-node.sh" "$ROOT"
NPM_BIN="$(dirname "$(command -v node)")/npm"

cd "$ROOT"
if [ -d node_modules/better-sqlite3 ]; then
  "$NPM_BIN" rebuild better-sqlite3
fi
