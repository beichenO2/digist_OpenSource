#!/usr/bin/env bash
# Align PATH to the Node.js version required by this project (.nvmrc or package.json engines).
# Usage: source /path/to/digist/scripts/ensure-node.sh [PROJECT_DIR]

_ensure_node_project_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
_ensure_node_required=""

if [ -f "$_ensure_node_project_dir/.nvmrc" ]; then
  _ensure_node_required="$(tr -d 'v \t\r\n' < "$_ensure_node_project_dir/.nvmrc")"
elif [ -f "$_ensure_node_project_dir/package.json" ]; then
  _ensure_node_required="$(
    node -e "try{const p=require('$_ensure_node_project_dir/package.json');const e=p.engines?.node||'';const m=e.match(/>=(\d+)/);console.log(m?m[1]:'')}catch{}" 2>/dev/null || true
  )"
fi

if [ -n "$_ensure_node_required" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  _ensure_node_dir="$(
    ls -d "$HOME/.nvm/versions/node/v${_ensure_node_required}"* 2>/dev/null | sort -V | tail -1 || true
  )"
  if [ -n "$_ensure_node_dir" ] && [ -x "$_ensure_node_dir/bin/node" ]; then
    export PATH="$_ensure_node_dir/bin:$PATH"
  fi
fi

unset _ensure_node_project_dir _ensure_node_required _ensure_node_dir
