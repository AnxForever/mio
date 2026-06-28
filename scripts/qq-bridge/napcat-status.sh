#!/usr/bin/env bash
set -euo pipefail

NAME="${MIO_NAPCAT_CONTAINER:-napcat-mio}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QR_PATH="$ROOT_DIR/data/runtime/qq-bridge/napcat-qrcode.png"

redact_webui_url() {
  printf '%s\n' "$1" | sed -E 's/(token=)[^&[:space:]]+/\1<redacted>/'
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not in PATH" >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -Fxq "$NAME"; then
  echo "ok   container running: $NAME"
else
  echo "fail container not running: $NAME"
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$NAME"; then
    docker ps -a --filter "name=^/${NAME}$" --format 'status={{.Status}} image={{.Image}}'
  fi
  exit 1
fi

webui_url="$(docker logs --tail 300 "$NAME" 2>&1 \
  | sed -n 's/.*WebUi User Panel Url: \(http:\/\/127\.0\.0\.1:6099\/webui?token=[^[:space:]]*\).*/\1/p' \
  | tail -1)"

if [[ -n "$webui_url" ]] && command -v curl >/dev/null 2>&1 && curl --noproxy '*' -fsS --max-time 3 "$webui_url" >/dev/null; then
  echo "ok   WebUI reachable: $(redact_webui_url "$webui_url")"
elif [[ -n "$webui_url" ]]; then
  echo "warn WebUI URL found but not reachable yet: $(redact_webui_url "$webui_url")"
else
  echo "warn WebUI URL not found in logs yet. Try: npm run qq:napcat:logs"
fi

docker ps --filter "name=^/${NAME}$" --format 'id={{.ID}} image={{.Image}} ports={{.Ports}}'

if docker cp "$NAME:/app/napcat/cache/qrcode.png" "$QR_PATH" >/dev/null 2>&1; then
  echo "ok   QR image exported: $QR_PATH"
fi
