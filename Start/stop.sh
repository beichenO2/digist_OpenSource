#!/bin/bash
set -euo pipefail

pkill -f "daily-digest" 2>/dev/null || true
exit 0
