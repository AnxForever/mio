#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

IMAGE="${MIO_NAPCAT_IMAGE:-mlikiowa/napcat-docker:latest}"
NAME="${MIO_NAPCAT_CONTAINER:-napcat-mio}"
NETWORK="${MIO_NAPCAT_NETWORK:-bridge}"
CONFIG_DIR="${MIO_NAPCAT_CONFIG_DIR:-$ROOT_DIR/data/runtime/napcat/config}"
QQ_DIR="${MIO_NAPCAT_QQ_DIR:-$ROOT_DIR/data/runtime/napcat/qq}"
DOCKER_PUBLIC_CONFIG="${MIO_DOCKER_PUBLIC_CONFIG:-$ROOT_DIR/data/runtime/docker-public-config}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not in PATH" >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR" "$QQ_DIR" "$DOCKER_PUBLIC_CONFIG"
if [[ ! -f "$DOCKER_PUBLIC_CONFIG/config.json" ]]; then
  printf '{}\n' > "$DOCKER_PUBLIC_CONFIG/config.json"
fi

if docker ps --format '{{.Names}}' | grep -Fxq "$NAME"; then
  if [[ "${MIO_NAPCAT_RECREATE:-}" == "1" ]]; then
    echo "Stopping existing NapCat container for recreate: $NAME"
    docker stop "$NAME" >/dev/null
    echo "Removing existing NapCat container for recreate: $NAME"
    docker rm "$NAME" >/dev/null
  else
  echo "NapCat container is already running: $NAME"
  echo "WebUI: http://127.0.0.1:6099"
  echo "If this existing container was created with the wrong network mode, run: MIO_NAPCAT_RECREATE=1 npm run qq:napcat:up"
  exit 0
  fi
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$NAME"; then
  if [[ "${MIO_NAPCAT_RECREATE:-}" == "1" ]]; then
    echo "Removing existing NapCat container for recreate: $NAME"
    docker rm "$NAME" >/dev/null
  else
    echo "Starting existing NapCat container: $NAME"
    docker start "$NAME" >/dev/null
    echo "WebUI: http://127.0.0.1:6099"
    echo "If this existing container was created with the wrong network mode, run: MIO_NAPCAT_RECREATE=1 npm run qq:napcat:up"
    exit 0
  fi
fi

args=(
  run -d
  --name "$NAME"
  --restart unless-stopped
  -e "NAPCAT_UID=$(id -u)"
  -e "NAPCAT_GID=$(id -g)"
  -e TZ=Asia/Shanghai
  -v "$CONFIG_DIR:/app/napcat/config"
  -v "$QQ_DIR:/app/.config/QQ"
)

if [[ "$NETWORK" == "host" ]]; then
  args+=(--network host)
else
  args+=(
    -p 127.0.0.1:6099:6099
    -p 127.0.0.1:3001:3001
    --add-host=host.docker.internal:host-gateway
  )
fi

args+=("$IMAGE")

echo "Starting NapCat container: $NAME"
DOCKER_CONFIG="$DOCKER_PUBLIC_CONFIG" docker "${args[@]}" >/dev/null
echo "NapCat container started."
echo "WebUI: http://127.0.0.1:6099"
echo "Config dir: $CONFIG_DIR"
echo "QQ data dir: $QQ_DIR"
echo
echo "After QR login, configure NapCat WebUI using data/runtime/qq-bridge/README.md."
