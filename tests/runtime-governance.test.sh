#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local file=$1 text=$2
  grep -Fq "$text" "$file" || fail "$file does not contain $text"
}

assert_not_contains() {
  local file=$1 pattern=$2
  if grep -En "$pattern" "$file"; then
    fail "$file contains forbidden runtime behavior"
  fi
}

for launcher in "$ROOT/Start/api.sh" "$ROOT/Start/engine.sh"; do
  [ -x "$launcher" ] || fail "$launcher must exist and be executable"
  assert_contains "$launcher" 'exec '
  assert_contains "$launcher" 'ensure-node.sh'
  assert_not_contains "$launcher" '(^|[[:space:]])(nohup|disown|pkill|killall|kill|lsof)([[:space:]]|$)|PID_FILE|setsid|[^&]&[[:space:]]*$'
done

assert_contains "$ROOT/Start/api.sh" '127.0.0.1:11050'
assert_contains "$ROOT/Start/api.sh" '/api/health'
assert_contains "$ROOT/Start/api.sh" 'port-claim.sh'
assert_contains "$ROOT/Start/api.sh" 'claim_port "digist-api" "digist" 3800'
assert_contains "$ROOT/Start/api.sh" 'release_port'
assert_contains "$ROOT/Start/api.sh" 'service_name") == "privportal-backend"'
assert_contains "$ROOT/Start/api.sh" 'POLAR_RUNTIME_MANAGED=1'

assert_not_contains "$ROOT/Start/engine.sh" 'claim_port|POLARPORT|PORT='
assert_contains "$ROOT/Start/engine.sh" 'POLAR_RUNTIME_MANAGED=1'

assert_contains "$ROOT/src/api/server.ts" 'POLAR_RUNTIME_MANAGED'
assert_not_contains "$ROOT/src/api/server.ts" 'killPortOccupant|process\.kill|execAsync\(.lsof'
assert_not_contains "$ROOT/src/index.ts" 'PID_FILE|process\.kill|writeFileSync|readFileSync|unlinkSync|acquireLock|releaseLock'

assert_contains "$ROOT/scripts/register-runtime.sh" 'digist-api'
assert_contains "$ROOT/scripts/register-runtime.sh" 'digist-engine'
assert_contains "$ROOT/scripts/register-runtime.sh" 'digist-engine-worker'
assert_contains "$ROOT/scripts/register-runtime.sh" 'DiGist API (legacy retired)'
assert_contains "$ROOT/scripts/register-runtime.sh" 'DiGist Engine (legacy retired)'
assert_contains "$ROOT/scripts/register-runtime.sh" 'start_script_dir: "-"'
assert_contains "$ROOT/scripts/register-runtime.sh" 'MODE=${1:-prepare}'
assert_contains "$ROOT/scripts/register-runtime.sh" 'prepare|finalize'
assert_not_contains "$ROOT/scripts/register-runtime.sh" 'api/services/.*/(start|stop|restart)'

for client in \
  "$ROOT/Start/start.sh" \
  "$ROOT/Start/stop.sh" \
  "$ROOT/Start/restart.sh" \
  "$ROOT/Start/status.sh"; do
  assert_contains "$client" 'digist-api'
  assert_contains "$client" '127.0.0.1:11055'
  assert_not_contains "$client" '(^|[[:space:]])(nohup|disown|pkill|killall|kill|lsof)([[:space:]]|$)|PID_FILE|setsid|[^&]&[[:space:]]*$'
done

jq -e '
  .service_management.service_id == "digist-api" and
  .service_management.start_command == "bash Start/api.sh" and
  .service_management.auto_start == true and
  (.service_management.services | length) == 2 and
  ([.service_management.services[] | .service_id] | sort) == ["digist-api", "digist-engine-worker"] and
  ([.service_management.services[] | select(.service_id == "digist-api") | .preferred_port] == [3800]) and
  ([.service_management.services[] | select(.service_id == "digist-engine-worker") | .preferred_port] == [null])
' "$ROOT/polaris.json" >/dev/null || fail "polaris.json does not declare both governed services"

jq -e '
  .requirements[]
  | select(.id == "R6")
  | .features[]
  | select(.name == "runtime_governance")
  | .status == "in-progress" or .status == "tested" or .status == "done"
' "$ROOT/polaris.json" >/dev/null || fail "runtime_governance SSoT is missing"

printf 'digist runtime governance contract passed\n'
