#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/data/runtime/wechat-bridge"
MIO_PID="$RUNTIME_DIR/mio.pid"
WECLAW_PID="$RUNTIME_DIR/weclaw.pid"
MIO_LOG="$RUNTIME_DIR/mio.log"
WECLAW_LOG="$RUNTIME_DIR/weclaw.log"

is_alive() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

ensure_port_free() {
  local port="$1"
  local label="$2"
  if ss -ltn | awk '{print $4}' | grep -Eq "(^|:)$port$"; then
    echo "$label port $port is already in use. Stop the existing process first or change the port." >&2
    exit 1
  fi
}

wait_for_url() {
  local url="$1"
  local seconds="$2"
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  exit 1
}

wait_for_auth_models() {
  local url="$1"
  local token="$2"
  local seconds="$3"
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS -H "Authorization: Bearer $token" "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for authenticated Mio OpenAI endpoint" >&2
  exit 1
}

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    export "$key=$value"
  done < <(node scripts/wechat-bridge/read-env.mjs "$env_file")
}

mkdir -p "$RUNTIME_DIR"
cd "$ROOT_DIR"
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"

node scripts/wechat-bridge/configure.mjs

load_env_file "$ROOT_DIR/.env"

MIO_HTTP_PORT="${MIO_HTTP_PORT:-3000}"
MIO_WECLAW_API_ADDR="${MIO_WECLAW_API_ADDR:-127.0.0.1:18011}"
MIO_WECLAW_BIN="${MIO_WECLAW_BIN:-$HOME/.local/bin/weclaw-mio-session}"
MIO_WECLAW_HOME="${MIO_WECLAW_HOME:-$HOME}"

if [[ ! -x "$MIO_WECLAW_BIN" ]]; then
  echo "Patched WeClaw binary not found, building it first..."
  MIO_WECLAW_BIN="$MIO_WECLAW_BIN" scripts/wechat-bridge/prepare-weclaw-session.sh
fi

npm run build

if is_alive "$MIO_PID"; then
  echo "Mio already running with pid $(cat "$MIO_PID")"
else
  ensure_port_free "$MIO_HTTP_PORT" "Mio HTTP"
  nohup setsid node dist/index.js serve --host 127.0.0.1 --port "$MIO_HTTP_PORT" >"$MIO_LOG" 2>&1 &
  echo "$!" > "$MIO_PID"
  echo "Started Mio pid $(cat "$MIO_PID"), log: $MIO_LOG"
fi

wait_for_url "http://127.0.0.1:$MIO_HTTP_PORT/health" 30

if [[ -n "${MIO_AUTH_TOKEN:-}" ]]; then
  wait_for_auth_models "http://127.0.0.1:$MIO_HTTP_PORT/v1/models" "$MIO_AUTH_TOKEN" 10
fi

if is_alive "$WECLAW_PID"; then
  echo "WeClaw already running with pid $(cat "$WECLAW_PID")"
else
  ensure_port_free "${MIO_WECLAW_API_ADDR##*:}" "WeClaw API"
  nohup setsid env HOME="$MIO_WECLAW_HOME" NO_PROXY="$NO_PROXY" no_proxy="$no_proxy" "$MIO_WECLAW_BIN" start --foreground --api-addr "$MIO_WECLAW_API_ADDR" >"$WECLAW_LOG" 2>&1 &
  echo "$!" > "$WECLAW_PID"
  echo "Started WeClaw pid $(cat "$WECLAW_PID"), log: $WECLAW_LOG"
fi

wait_for_url "http://$MIO_WECLAW_API_ADDR/health" 30

echo "Bridge is running."
echo "Mio:    http://127.0.0.1:$MIO_HTTP_PORT"
echo "WeClaw: http://$MIO_WECLAW_API_ADDR"
