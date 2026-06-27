#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < <(node scripts/wechat-bridge/read-env.mjs "$env_file")
}

load_env_file "$ROOT_DIR/.env"

MIO_HTTP_PORT="${MIO_HTTP_PORT:-3000}"
MIO_URL="http://127.0.0.1:${MIO_HTTP_PORT}"
ONEBOT_API_BASE="${MIO_ONEBOT_API_BASE:-}"
ONEBOT_TOKEN="${MIO_ONEBOT_ACCESS_TOKEN:-}"

ok=1

check_http() {
  local name="$1"
  local url="$2"
  shift 2
  if curl --noproxy '*' -fsS --max-time 3 "$@" "$url" >/tmp/mio-qq-status.json 2>/tmp/mio-qq-status.err; then
    echo "ok   $name"
  else
    ok=0
    echo "fail $name"
    sed -n '1,2p' /tmp/mio-qq-status.err
    if [[ "$name" == "NapCat OneBot /get_status" ]]; then
      if grep -qiE 'Connection reset|Recv failure|Empty reply' /tmp/mio-qq-status.err; then
        echo "hint NapCat is reachable, but its OneBot HTTP server is not ready. Scan the QQ QR code, then run: npm run qq:napcat:configure"
      elif grep -qiE 'Connection refused|Failed to connect' /tmp/mio-qq-status.err; then
        echo "hint NapCat OneBot HTTP server is not listening yet. After QQ login, run: npm run qq:napcat:configure"
      fi
    fi
  fi
}

echo "Mio QQ bridge status"
echo "root: $ROOT_DIR"
echo

check_http "Mio /health" "$MIO_URL/health"

auth_args=()
if [[ -n "${MIO_AUTH_TOKEN:-}" ]]; then
  auth_args=(-H "Authorization: Bearer ${MIO_AUTH_TOKEN}")
fi
check_http "Mio /onebot/v11/status" "$MIO_URL/onebot/v11/status" "${auth_args[@]}"

if [[ -n "$ONEBOT_API_BASE" ]]; then
  token_args=()
  if [[ -n "$ONEBOT_TOKEN" ]]; then
    token_args=(-H "Authorization: Bearer ${ONEBOT_TOKEN}")
  fi
  check_http "NapCat OneBot /get_status" "${ONEBOT_API_BASE%/}/get_status" \
    -X POST -H 'Content-Type: application/json' -d '{}' "${token_args[@]}"
else
  ok=0
  echo "fail NapCat OneBot API base not configured (MIO_ONEBOT_API_BASE)"
fi

echo
echo "MIO_ONEBOT_REPLY_MODE=${MIO_ONEBOT_REPLY_MODE:-auto}"
echo "MIO_ONEBOT_GROUP_MODE=${MIO_ONEBOT_GROUP_MODE:-mention}"
echo "MIO_ONEBOT_OUTBOUND_FORMAT=${MIO_ONEBOT_OUTBOUND_FORMAT:-string}"

if [[ "$ok" -eq 1 ]]; then
  echo
  echo "QQ bridge checks passed."
else
  echo
  echo "QQ bridge checks failed."
  exit 1
fi
