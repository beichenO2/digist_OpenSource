#!/usr/bin/env bash
# digist-api lifecycle script — PolarProcess + PolarPort convention.
#
# Managed by PolarProcess (registered in shared_services with start_script_dir).
# Replaces the old launchd plist + standalone nohup launch.
#
# Daemonization uses POSIX setsid (new session, detached from controlling
# terminal) — NOT nohup. macOS ships no `setsid` binary, so we invoke the
# identical syscall via python3 `os.setsid()`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$SCRIPT_DIR/.pid"
SERVICE_NAME="digist-api"
PROJECT="digist"
PREFERRED_PORT=3800

cd "$PROJECT_DIR"

# ── Dynamic port allocation via PolarPort ────────────────
source "$PROJECT_DIR/../Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "$SERVICE_NAME" "$PROJECT" "$PREFERRED_PORT")
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

# ── Node version alignment (engines.node >= 22) ──────────
REQUIRED_NODE=""
if [ -f ".nvmrc" ]; then
    REQUIRED_NODE=$(cat .nvmrc)
elif [ -f "package.json" ]; then
    REQUIRED_NODE=$(node -e "try{const p=require('./package.json');const e=p.engines?.node||'';const m=e.match(/>=(\d+)/);console.log(m?m[1]:'')}catch{}" 2>/dev/null || true)
fi
if [ -n "${REQUIRED_NODE:-}" ] && [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -d "$HOME/.nvm/versions/node/v${REQUIRED_NODE}"* 2>/dev/null | sort -V | tail -1 || true)
    if [ -n "$NODE_DIR" ] && [ -x "$NODE_DIR/bin/node" ]; then
        export PATH="$NODE_DIR/bin:$PATH"
    fi
fi

# ── External tools (yt-dlp / ffmpeg / ffprobe) on PATH ───
# digestVideo shells out to these; ensure they resolve regardless of launcher.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.agent-reach-venv/bin:$PATH"

LOG_FILE="$PROJECT_DIR/data/logs/api-stdout.log"
mkdir -p "$PROJECT_DIR/data/logs"

# setsid replacement: new session + exec, no controlling terminal, no nohup.
# Invoked inline (not via a function) so $! is the execed node PID, not a
# bash subshell wrapper — keeps the PID file pointing at the real server.
SETSID_EXEC='import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])'

do_start() {
    OCCUPANT_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
    if [ -n "$OCCUPANT_PID" ]; then
        echo "Already running pid=$OCCUPANT_PID port=$PORT"
        exit 0
    fi

    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            echo "Already running pid=$OLD_PID port=$PORT"
            exit 0
        fi
        rm -f "$PID_FILE"
    fi

    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
        echo "Installing dependencies..."
        npm ci 2>&1 || npm install 2>&1
    fi

    local node_bin tsx_bin
    node_bin="$(command -v node)"
    tsx_bin="$PROJECT_DIR/node_modules/.bin/tsx"

    export PORT
    python3 -c "$SETSID_EXEC" "$node_bin" "$tsx_bin" src/api/server.ts >> "$LOG_FILE" 2>&1 < /dev/null &
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"

    for i in $(seq 1 30); do
        if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
            echo "Started pid=$DAEMON_PID port=$PORT"
            exit 0
        fi
        if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
            echo "Process exited immediately" >&2
            rm -f "$PID_FILE"
            exit 1
        fi
        sleep 1
    done

    echo "Timed out waiting for health endpoint on port $PORT" >&2
    rm -f "$PID_FILE"
    exit 1
}

do_stop() {
    # Collect every PID involved: the recorded launcher PID plus whatever is
    # actually listening on the port (tsx may exec a child that binds it).
    local pids=""
    if [ -f "$PID_FILE" ]; then
        pids="$(cat "$PID_FILE" 2>/dev/null || true)"
    fi
    pids="$pids $(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null || true)"
    pids=$(printf '%s\n' $pids | grep -E '^[0-9]+$' | sort -u || true)

    if [ -z "$pids" ]; then
        echo "Not running"
        rm -f "$PID_FILE"
        exit 0
    fi

    echo "Stopping pids: $(printf '%s ' $pids)"
    for p in $pids; do kill "$p" 2>/dev/null || true; done
    for i in $(seq 1 10); do
        local alive=""
        for p in $pids; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
        [ -z "$alive" ] && break
        sleep 1
    done
    for p in $pids; do kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null || true; done
    rm -f "$PID_FILE"
    echo "Stopped"
}

do_restart() { do_stop; do_start; }

do_status() {
    local pid=""
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE" 2>/dev/null || true)
    fi
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "Running pid=$pid port=$PORT"
        exit 0
    fi
    local occ
    occ=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
    if [ -n "$occ" ]; then
        echo "Running pid=$occ port=$PORT (PID file stale)"
        echo "$occ" > "$PID_FILE"
        exit 0
    fi
    echo "Not running"
    exit 1
}

case "${1:-start}" in
    start)   do_start   ;;
    stop)    do_stop    ;;
    restart) do_restart ;;
    status)  do_status  ;;
    *)
        echo "Usage: bash Start/start.sh [start|stop|restart|status]" >&2
        exit 1
        ;;
esac
