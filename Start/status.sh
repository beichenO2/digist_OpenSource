#!/bin/bash
set -euo pipefail

if pgrep -f "daily-digest" > /dev/null 2>&1; then
    echo "running"
    exit 0
fi
echo "stopped"
exit 1
