#!/usr/bin/env bash
# Одна «пульсация» мониторинга: печать в терминал + строка в лог (видно, что Proxy жив и что проверил).
set -euo pipefail

export GSD_PROJECT_HASH="${GSD_PROJECT_HASH:-fffb}"
export GSD_HUB_PORT="${GSD_HUB_PORT:-19996}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.planning/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/proxy-monitor.log"
HUB_URL="http://127.0.0.1:${GSD_HUB_PORT}/mcp"
HUB_CALL="${ROOT}/gsd-2/scripts/hub-call.sh"

TS="$(date '+%Y-%m-%d %H:%M:%S %z')"

hub_ok=0
if curl -s --max-time 2 "$HUB_URL" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"proxy-monitor","version":"1"}},"id":0}' \
  2>/dev/null | grep -qE 'gsd-2-hub|"result"'; then
  hub_ok=1
fi

tasks_summary="?"
if [[ -x "$HUB_CALL" ]] && [[ "$hub_ok" -eq 1 ]]; then
  tasks_summary="$(GSD_HUB_PORT="$GSD_HUB_PORT" GSD_PROJECT_HASH="$GSD_PROJECT_HASH" "$HUB_CALL" proxy hub_list_tasks '{}' 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  t=d.get('tasks',[])
  st={}
  for x in t: st[x.get('status','?')]=st.get(x.get('status','?'),0)+1
  print(','.join(f'{k}={v}' for k,v in sorted(st.items()))+f'|n={len(t)}')
except Exception as e:
  print('err:'+str(e)[:40])
" 2>/dev/null || echo "?")"
fi

ollama_n="$(curl -s --max-time 2 http://127.0.0.1:11434/api/tags 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('models',[])))" 2>/dev/null || echo -1)"

tmux_n="$(tmux list-sessions 2>/dev/null | grep -c '^g-'"${GSD_PROJECT_HASH}" || true)"
[[ -z "$tmux_n" ]] && tmux_n=0

tsc_ok=0
if (cd "$ROOT" && npx tsc --noEmit >/dev/null 2>&1); then tsc_ok=1; fi

LINE="[$TS] hub=$hub_ok tasks=[$tasks_summary] ollama_models=$ollama_n tmux_g-${GSD_PROJECT_HASH}=$tmux_n tsc=$tsc_ok"
echo "========== Proxy monitor $TS =========="
echo "$LINE"
echo "$LINE" >> "$LOG"
