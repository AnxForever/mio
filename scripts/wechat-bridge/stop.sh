#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/data/runtime/wechat-bridge"

stop_pid_file() {
  local name="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "$name: no pid file"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "$name: not running"
    rm -f "$pid_file"
    return
  fi

  kill "$pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      echo "$name: stopped"
      return
    fi
    sleep 1
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
  echo "$name: killed after timeout"
}

stop_pid_file "WeClaw" "$RUNTIME_DIR/weclaw.pid"
stop_pid_file "Mio" "$RUNTIME_DIR/mio.pid"
