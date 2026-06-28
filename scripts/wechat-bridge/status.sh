#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/data/runtime/wechat-bridge"
cd "$ROOT_DIR"
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    export "$key=$value"
  done < <(node scripts/wechat-bridge/read-env.mjs "$env_file")
}

load_env_file "$ROOT_DIR/.env"

MIO_HTTP_PORT="${MIO_HTTP_PORT:-3000}"
MIO_WECLAW_API_ADDR="${MIO_WECLAW_API_ADDR:-127.0.0.1:18011}"

show_pid() {
  local name="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "$name pid: not managed"
    return
  fi
  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "$name pid: $pid running"
  else
    echo "$name pid: stale ($pid)"
  fi
}

show_url() {
  local label="$1"
  local url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "$label: ok"
  else
    echo "$label: not reachable"
  fi
}

echo "Mio WeChat bridge status"
echo
show_pid "Mio" "$RUNTIME_DIR/mio.pid"
show_pid "WeClaw" "$RUNTIME_DIR/weclaw.pid"
echo
show_url "Mio health" "http://127.0.0.1:$MIO_HTTP_PORT/health"
show_url "WeClaw health" "http://$MIO_WECLAW_API_ADDR/health"

if [[ -n "${MIO_AUTH_TOKEN:-}" ]]; then
  if curl -fsS -H "Authorization: Bearer $MIO_AUTH_TOKEN" "http://127.0.0.1:$MIO_HTTP_PORT/v1/models" >/dev/null 2>&1; then
    echo "Mio OpenAI auth: ok"
  else
    echo "Mio OpenAI auth: failed"
  fi
else
  echo "Mio OpenAI auth: disabled"
fi

echo "Strict OpenAI session: ${MIO_OPENAI_REQUIRE_SESSION:-false}"
echo
echo "Listening ports:"
ss -ltnp | grep -E ":($MIO_HTTP_PORT|${MIO_WECLAW_API_ADDR##*:})\\b" || true
echo
node - <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const configPath = path.join(process.env.MIO_WECLAW_HOME || os.homedir(), '.weclaw', 'config.json');
if (!fs.existsSync(configPath)) {
  console.log(`WeClaw config: missing (${configPath})`);
  process.exit(0);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const agent = config.agents?.mio ?? {};
console.log(`WeClaw config: ${configPath}`);
console.log(`  default_agent=${config.default_agent ?? ''}`);
console.log(`  api_addr=${config.api_addr ?? ''}`);
console.log(`  mio.endpoint=${agent.endpoint ?? ''}`);
console.log(`  mio.model=${agent.model ?? ''}`);
console.log(`  mio.api_key=${agent.api_key ? '<configured>' : '<missing>'}`);
NODE
