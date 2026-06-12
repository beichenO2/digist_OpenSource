#!/usr/bin/env bash
# Thin wrapper — delegates to start.sh status (PolarProcess looks up status.sh).
exec "$(cd "$(dirname "$0")" && pwd)/start.sh" status
