#!/usr/bin/env bash
# Thin wrapper — delegates to start.sh stop (PolarProcess looks up stop.sh).
exec "$(cd "$(dirname "$0")" && pwd)/start.sh" stop
