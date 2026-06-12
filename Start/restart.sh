#!/usr/bin/env bash
# Thin wrapper — delegates to start.sh restart (PolarProcess looks up restart.sh).
exec "$(cd "$(dirname "$0")" && pwd)/start.sh" restart
