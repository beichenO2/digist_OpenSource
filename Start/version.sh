#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
git rev-parse --short HEAD 2>/dev/null || echo "unknown"
